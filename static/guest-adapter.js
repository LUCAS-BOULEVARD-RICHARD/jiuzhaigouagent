/* Integration boundary. Replace SnapshotAdapter with an official client bridge/API adapter. */
(function (g) {
  'use strict';

  const KEY = 'dispatchos.guest.v1';
  const CHANNEL = 'dispatchos-guest-v1';
  const listeners = new Set();
  const STOPS = ['游客中心', '诺日朗', '长海'];
  const LEVELS = { empty: '空闲', normal: '适中', crowded: '拥挤', full: '满员' };
  const SEATS = 39;

  /* 同源双标签页同步：只同步预约相关事件，车辆模拟不跨标签页广播。 */
  let bus = null;
  try {
    bus = new BroadcastChannel(CHANNEL);
    bus.onmessage = (e) => {
      if (e.data && e.data.payload) {
        try {
          const s = read();
          const p = e.data.payload;
          if (e.data.kind === 'booking.gate.changed') {
            s.bookingOpen = !!p.bookingOpen;
            s.closedSlots = p.closedSlots || [];
            persist(s);
          } else if (e.data.kind === 'booking.created' || e.data.kind === 'booking.cancelled') {
            if (p.aggregate) {
              s.slots = p.aggregate.slots.map((x) => Object.assign({}, s.slots.find((y) => y.id === x.slotId), { booked: x.confirmed }));
              s.bookings = s.bookings.filter((x) => !p.booking || x.id !== p.booking.id);
              if (p.booking) s.bookings.unshift(p.booking);
              persist(s);
            }
          }
        } catch (_) { /* 本地快照损坏时保持原状态 */ }
      }
      listeners.forEach((fn) => fn(e.data));
    };
  } catch (_) { /* 不支持 BroadcastChannel 时退化为单标签页 */ }

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const defaults = {
    contract: 'dispatchos.guest',
    version: 1,
    updatedAt: new Date().toISOString(),
    bookingOpen: true,
    closedSlots: [],
    slots: [
      { id: 'slot-0900', label: '09:00–10:00', route: '游客中心方向', stop: '诺日朗', booked: 18, capacity: 30, onsite: 13, evidence: 'demo' },
      { id: 'slot-1000', label: '10:00–11:00', route: '游客中心方向', stop: '诺日朗', booked: 21, capacity: 30, onsite: 13, evidence: 'demo' },
      { id: 'slot-1100', label: '11:00–12:00', route: '长海方向', stop: '诺日朗', booked: 16, capacity: 28, onsite: 12, evidence: 'demo' }
    ],
    bookings: [],
    vehicle: {
      nextStop: '诺日朗', etaMinutes: 4, varianceMinutes: 1,
      reportedAt: new Date(Date.now() - 24000).toISOString(),
      lat: 33.26, lng: 103.91, speed: 18, direction: 72,
      evidence: 'demo', nextStopEvidence: 'demo'
    },
    vehicles: [],
    lastReconcile: '演示数据†'
  };

  /* 5 辆观光车的演示初始状态；后续每次上报在内存中随机游走，不写入 localStorage。 */
  function seedVehicles() {
    const now = Date.now();
    const make = (id, plate, stopIndex, dir, etaMinutes, load, ageSeconds, trend) => ({
      id, plate, stopIndex, dir, etaMinutes, load, seats: SEATS,
      reportedAt: new Date(now - ageSeconds * 1000).toISOString(),
      trend, evidence: 'demo'
    });
    return [
      make('V-03', '观光03', 1, 1, 2, 36, 25, [78, 82, 85, 88, 90, 91, 92]),
      make('V-12', '观光12', 1, -1, 4, 22, 40, [52, 54, 56, 57, 56]),
      make('V-07', '观光07', 2, 1, 6, 28, 70, [66, 68, 70, 71, 72]),
      make('V-18', '观光18', 0, -1, 8, 9, 150, [24, 23, 22, 23]),
      make('V-21', '观光21', 1, 1, 11, 31, 250, [72, 74, 75, 77, 78, 79])
    ];
  }

  let vehicles = seedVehicles();
  let vehiclesUpdatedAt = new Date().toISOString();
  let timer = null;

  function freshnessOf(reportedAt, now) {
    let age = (now - new Date(reportedAt).getTime()) / 1000;
    if (!isFinite(age) || age < 0) age = 0;
    if (age <= 60) return { key: 'realtime', label: '实时', ageSeconds: Math.round(age) };
    if (age <= 180) return { key: 'estimated', label: '推算', ageSeconds: Math.round(age) };
    return { key: 'planned', label: '计划', ageSeconds: Math.round(age) };
  }

  function normalizeVehicle(v, now) {
    const seats = Math.max(1, Math.round(Number(v.seats) || SEATS));
    let load = Math.round(Number(v.load) || 0);
    load = Math.max(0, Math.min(seats, load));
    const pct = Math.round((load / seats) * 100);
    const level = pct >= 90 ? 'full' : pct >= 70 ? 'crowded' : pct >= 40 ? 'normal' : 'empty';
    const fresh = freshnessOf(v.reportedAt, now);
    const stopIndex = Math.max(0, Math.min(STOPS.length - 1, Math.round(Number(v.stopIndex) || 0)));
    const dir = Number(v.dir) === -1 ? -1 : 1;
    const rawTrend = Array.isArray(v.trend) && v.trend.length ? v.trend : [pct];
    const trend = rawTrend.slice(-8).map((x) => Math.max(0, Math.min(100, Math.round(Number(x) || 0))));
    return Object.assign({}, v, {
      seats, load, loadRatio: load / seats, loadPct: pct, seatsFree: seats - load,
      level, levelLabel: LEVELS[level], nextStop: STOPS[stopIndex],
      route: dir > 0 ? '长海方向' : '游客中心方向',
      freshness: fresh.key, freshLabel: fresh.label, ageSeconds: fresh.ageSeconds,
      trend, evidence: 'demo', etaMinutes: Math.max(1, Math.round(Number(v.etaMinutes) || 1))
    });
  }

  /* 车辆状态只在内存里模拟，预约写入时不要把 vehicles 一并固化到 localStorage。 */
  function persist(s) {
    const copy = Object.assign({}, s);
    delete copy.vehicles;
    delete copy.vehiclesUpdatedAt;
    localStorage.setItem(KEY, JSON.stringify(copy));
  }

  function read() {
    let s;
    try {
      s = Object.assign(clone(defaults), JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch (_) {
      s = clone(defaults);
    }
    const now = Date.now();
    s.vehicles = vehicles.map((v) => normalizeVehicle(v, now));
    /* 顶部“车辆运行”跟随最近一辆车，保证两个模块的到站信息一致。 */
    const nearest = s.vehicles.slice().sort((a, b) => a.etaMinutes - b.etaMinutes || a.id.localeCompare(b.id))[0];
    if (nearest) {
      s.vehicle = Object.assign({}, defaults.vehicle, s.vehicle, {
        nextStop: nearest.nextStop,
        etaMinutes: nearest.etaMinutes,
        varianceMinutes: nearest.etaMinutes >= 6 ? 2 : 1,
        reportedAt: nearest.reportedAt,
        evidence: 'demo',
        nextStopEvidence: 'demo'
      });
    }
    s.vehiclesUpdatedAt = vehiclesUpdatedAt;
    return s;
  }

  function emit(kind, payload, localOnly) {
    const msg = {
      contract: 'dispatchos.guest.event', version: 1,
      id: 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      kind, createdAt: new Date().toISOString(), evidence: 'demo', payload
    };
    if (!localOnly) {
      try { bus && bus.postMessage(msg); } catch (_) { /* 忽略跨页同步失败 */ }
    }
    listeners.forEach((fn) => fn(msg));
    return msg;
  }

  function slotOpen(s, id) {
    return s.bookingOpen && !(s.closedSlots || []).includes(id);
  }

  function advance(v) {
    const next = v.stopIndex + v.dir;
    if (next >= STOPS.length) {
      v.dir = -1;
      v.stopIndex = STOPS.length - 2;
    } else if (next < 0) {
      v.dir = 1;
      v.stopIndex = 1;
    } else {
      v.stopIndex = next;
    }
    v.etaMinutes = 3 + Math.round(Math.random() * 3);
  }

  /* 每 15 秒模拟一次车载上报：载客随机游走，到站后推进站点。 */
  function simulate(force) {
    if (!force && typeof document !== 'undefined' && document.hidden) return false;
    const now = Date.now();
    let reported = 0;
    vehicles.forEach((v) => {
      if (!force && Math.random() > 0.82) return; /* 偶尔漏报，演示新鲜度降级 */
      reported++;
      v.load = Math.max(4, Math.min(v.seats, v.load + Math.round(Math.random() * 8) - 4));
      if (v.etaMinutes <= 1) advance(v);
      else if (Math.random() < 0.5) v.etaMinutes -= 1;
      v.reportedAt = new Date(now).toISOString();
      v.trend = (v.trend || []).concat(Math.round((v.load / v.seats) * 100)).slice(-8);
    });
    if (!reported && !force) return false;
    vehiclesUpdatedAt = new Date(now).toISOString();
    emit('vehicle.crowding.changed', {
      vehicles: vehicles.map((v) => normalizeVehicle(v, now)),
      updatedAt: vehiclesUpdatedAt
    }, true);
    return true;
  }

  g.GuestIntegration = {
    contract: 'dispatchos.guest',
    version: 1,
    capabilities: [
      'booking.read', 'booking.create', 'booking.cancel', 'booking.close',
      'location.read', 'ticket.validate.mock', 'station.checkin.mock',
      'vehicle.crowding.read', 'vehicle.crowding.subscribe'
    ],
    adapter: 'snapshot',
    connect() {
      if (!timer) timer = setInterval(() => simulate(false), 15000);
      return Promise.resolve({
        contract: this.contract,
        version: this.version,
        capabilities: this.capabilities,
        adapter: this.adapter
      });
    },
    getState() { return read(); },
    getVehicles() { return read().vehicles; },
    refreshVehicles() {
      simulate(true);
      return read().vehicles;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    createBooking(input) {
      const s = read();
      if (!slotOpen(s, input.slotId)) throw Error('该时段线上预约入口已关闭');
      if (s.bookings.some((b) => b.ticketRef === input.ticketRef && b.status === 'confirmed')) throw Error('一票一约：该票号已有有效预约');
      const slot = s.slots.find((x) => x.id === input.slotId);
      if (!slot || slot.booked >= slot.capacity) throw Error('预约池已满，请选择其他时段');
      const b = {
        id: 'BK-' + Date.now().toString().slice(-8),
        ticketRef: input.ticketRef, slotId: slot.id, route: slot.route, stop: slot.stop,
        slot: slot.label, status: 'confirmed', createdAt: new Date().toISOString(), evidence: 'demo',
        code: 'GUEST-' + Math.random().toString(36).slice(2, 10).toUpperCase()
      };
      s.bookings.unshift(b);
      slot.booked++;
      s.updatedAt = new Date().toISOString();
      persist(s);
      emit('booking.created', { booking: b, aggregate: this.aggregate(s) });
      return b;
    },
    cancelBooking(id) {
      const s = read();
      const b = s.bookings.find((x) => x.id === id && x.status === 'confirmed');
      if (!b) return false;
      b.status = 'cancelled';
      const slot = s.slots.find((x) => x.id === b.slotId);
      if (slot) slot.booked = Math.max(0, slot.booked - 1);
      persist(s);
      emit('booking.cancelled', { booking: b, aggregate: this.aggregate(s) });
      return true;
    },
    setBookingOpen(open, reason, slotId) {
      const s = read();
      s.closedSlots = s.closedSlots || [];
      if (slotId) {
        s.closedSlots = s.closedSlots.filter((x) => x !== slotId);
        if (!open) s.closedSlots.push(slotId);
      } else {
        s.bookingOpen = !!open;
      }
      s.updatedAt = new Date().toISOString();
      persist(s);
      emit('booking.gate.changed', {
        bookingOpen: s.bookingOpen,
        closedSlots: s.closedSlots,
        slotId,
        reason: reason || 'DispatchOS演示操作',
        aggregate: this.aggregate(s)
      });
      return s.bookingOpen;
    },
    aggregate(s) {
      s = s || read();
      return {
        slots: s.slots.map((x) => ({
          slotId: x.id, route: x.route, stop: x.stop, label: x.label,
          confirmed: x.booked, reservationCapacity: x.capacity,
          onsiteCapacity: x.onsite, evidence: x.evidence,
          bookingOpen: slotOpen(s, x.id)
        })),
        totalConfirmed: s.slots.reduce((a, x) => a + x.booked, 0),
        bookingOpen: s.bookingOpen,
        closedSlots: s.closedSlots || [],
        updatedAt: s.updatedAt,
        evidence: 'demo'
      };
    },
    simulateCheckin(code, station, slotId, offline) {
      const s = read();
      const b = s.bookings.find((x) => x.code === code);
      if (!b) return { branch: 'reject', reason: '未找到有效预约码' };
      if (b.status === 'checked_in') return { branch: 'duplicate', message: '该预约已核销', firstAt: b.checkedAt, station: b.checkedStation };
      if (offline) {
        emit('checkin.queued', {
          bookingId: b.id, code, station, slotId,
          firstAt: new Date().toISOString(), syncStatus: 'queued'
        });
        return { branch: 'offline', message: '离线待补传' };
      }
      if (b.stop !== station || b.slotId !== slotId) return { branch: 'reject', reason: '非本站或非本时段' };
      b.status = 'checked_in';
      b.checkedAt = new Date().toISOString();
      b.checkedStation = station;
      persist(s);
      emit('checkin.accepted', { bookingId: b.id, checkedAt: b.checkedAt, station });
      return { branch: 'allow', message: '正常放行' };
    }
  };
})(window);
