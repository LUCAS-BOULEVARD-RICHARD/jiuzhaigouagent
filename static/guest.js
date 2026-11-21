(function () {
  'use strict';

  const A = window.GuestIntegration;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  let page = 'home';
  let chosen = 'slot-0900';
  let offlineCheckin = false;
  let detailId = null;

  const nav = { home: '首页', booking: '预约乘车', trips: '我的行程', routes: '线路与站点' };
  const LEVEL_NAMES = { empty: '空闲', normal: '适中', crowded: '拥挤', full: '满员' };

  function evidence(v) {
    return ({
      measured: '实测', calculated: '测算', simulated: '仿真',
      assumed: '假设†', demo: '演示†', input: '填报'
    })[v] || '演示†';
  }

  function locFresh(v) {
    const age = (Date.now() - new Date(v.reportedAt).getTime()) / 1000;
    return age <= 60 ? ['实时', 'realtime'] : age <= 180 ? ['推算', 'estimated'] : ['计划', 'planned'];
  }

  function showToast(t) {
    const x = $('#toast');
    x.textContent = t;
    x.classList.add('show');
    setTimeout(() => x.classList.remove('show'), 2300);
  }

  function state() { return A.getState(); }

  function setPage(p) {
    page = p;
    $('.tabbar').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.page === p));
    render();
    window.scrollTo(0, 0);
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  function ageText(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    if (s < 60) return s + ' 秒前';
    return Math.floor(s / 60) + ' 分钟前';
  }

  function levelClass(v) {
    return LEVEL_NAMES[v.level] ? v.level : 'empty';
  }

  /* ---------- 车辆运行（顶部模块，跟随最近一辆车） ---------- */
  function vehicleSection(s) {
    const f = locFresh(s.vehicle);
    const broken = f[1] === 'planned';
    const loc = s.vehicle;
    const off = $('#offline');
    if (off) off.hidden = !broken;
    return `<section class="section" id="vehicle-live" aria-live="off"><div class="section-title"><div><small>车辆运行</small><h2>${esc(loc.nextStop)}方向</h2></div><span class="badge ${f[1]}">${f[0]} · ${evidence(loc.evidence)}</span></div><div class="eta"><strong>约 ${loc.etaMinutes} 分钟</strong><span>波动 ±${loc.varianceMinutes} 分钟</span></div><div class="source">${broken ? '位置超过 3 分钟未更新，展示计划班次' : '车载定位上报约每 15 秒一次'} · 到站为估计，不是承诺</div><div class="route-line"><span>游客中心</span><i></i><b>诺日朗</b><i></i><span>长海</span></div><div class="source">线路骨架示意 · 无 GIS 坐标，不代表地图</div></section>`;
  }

  /* ---------- 车辆拥挤实况 ---------- */
  function vehicleRow(v) {
    const lvl = levelClass(v);
    const fresh = v.freshLabel || locFresh(v)[0];
    const freshKey = v.freshness || locFresh(v)[1];
    return `<button class="veh-row level-${lvl}" data-veh="${esc(v.id)}" aria-label="${esc(v.plate)}，${esc(v.route)}，下一站${esc(v.nextStop)}，约${v.etaMinutes}分钟，载客${v.load}人，共${v.seats}座，${esc(v.levelLabel || LEVEL_NAMES[lvl])}"><span class="veh-main"><span class="veh-head"><b>${esc(v.plate)}</b><span class="veh-dir">${esc(v.route)}</span><span class="veh-level ${lvl}">${esc(v.levelLabel || LEVEL_NAMES[lvl])}</span></span><span class="veh-sub">下一站 ${esc(v.nextStop)} · 约 ${v.etaMinutes} 分钟 · <span class="fresh ${freshKey}">${esc(fresh)}</span></span><span class="load-line"><span class="load-track"><i style="width:${v.loadPct}%"></i></span><span class="load-num"><b>${v.load}</b>/${v.seats}</span></span></span><span class="veh-chev" aria-hidden="true">›</span></button>`;
  }

  function crowdSection(s) {
    const list = (s.vehicles || []).slice().sort((a, b) => a.etaMinutes - b.etaMinutes || a.plate.localeCompare(b.plate));
    const crowded = list.filter((v) => v.level === 'crowded' || v.level === 'full').length;
    const avg = list.length ? Math.round(list.reduce((a, v) => a + v.loadPct, 0) / list.length) : 0;
    return `<section class="section crowd-section" id="crowd-module" aria-live="off"><div class="section-title"><div><small>LIVE OCCUPANCY</small><h2><span class="live-dot" aria-hidden="true"></span>车辆拥挤实况</h2></div><div class="crowd-tools"><span class="badge demo">演示†</span><button class="link crowd-refresh" data-action="crowd-refresh" aria-label="刷新车辆拥挤程度" title="刷新车辆拥挤程度">刷新</button></div></div><div class="crowd-summary">${list.length} 辆运行中 · ${crowded} 辆拥挤或满员 · 平均载客 ${avg}% · 最近上报 ${fmtTime(s.vehiclesUpdatedAt || s.updatedAt)}</div>${list.length ? `<div class="veh-list">${list.map(vehicleRow).join('')}</div>` : '<div class="notice">暂无车辆上报，请稍后刷新。</div>'}<p class="source">拥挤度 = 载客 ÷ 核定座位 · 满员按 ≥90% 运营阈值提示 · 每 15 秒本地模拟；真实系统需接车载客流计数</p></section>`;
  }

  /* ---------- 站点人流与分流建议 ---------- */
  function stationGuide(station) {
    if (station.level !== 'crowded' && station.level !== 'full') return '';
    const rest = station.restArea || {};
    const alternative = station.alternativeStop || {};
    return `<div class="station-guide"><b>当前人流较多，建议分流：</b>${rest.name ? `<span>先至 ${esc(rest.name)} 休息（约 ${rest.walkMinutes} 分钟）</span>` : ''}${alternative.name ? `<span>或改到 ${esc(alternative.name)} 候车（约 ${alternative.walkMinutes} 分钟）</span>` : ''}</div>`;
  }

  function stationRow(station) {
    const level = levelClass(station);
    return `<article class="station-flow-row level-${level}"><div class="station-flow-head"><div><b>${esc(station.name)}</b><span class="station-flow-status ${level}">${esc(station.levelLabel || LEVEL_NAMES[level])}</span></div><div class="station-flow-count"><b>${station.people}</b><span>人</span></div></div><div class="station-flow-meta">当前人流 ${station.crowdPct}% · ${esc(station.freshLabel || '实时')}上报 ${ageText(station.ageSeconds)}</div><div class="station-flow-track"><i style="width:${station.crowdPct}%"></i></div>${stationGuide(station)}</article>`;
  }

  function stationCrowdSection(s) {
    const stations = (s.stations || []).slice();
    const crowded = stations.filter((station) => station.level === 'crowded' || station.level === 'full').length;
    return `<section class="section station-crowd-section" id="station-crowd-module" aria-live="polite"><div class="section-title"><div><small>STATION FLOW</small><h2>站点人流量</h2></div><div class="crowd-tools"><span class="badge demo">演示†</span><button class="link crowd-refresh" data-action="station-refresh" aria-label="刷新站点人流量" title="刷新站点人流量">刷新</button></div></div><div class="station-flow-summary">${stations.length} 个站点 · ${crowded} 个站点人流较多 · 最近更新 ${fmtTime(s.stationsUpdatedAt || s.updatedAt)}</div>${stations.length ? `<div class="station-flow-list">${stations.map(stationRow).join('')}</div>` : '<div class="notice">暂无站点人流上报，请稍后刷新。</div>'}<p class="source">人流较多（≥70%）时，显示已配置的最近休息区与替代乘车点；路线与步行时间为演示†，请以现场导视和工作人员指引为准。</p></section>`;
  }

  /* ---------- 车辆详情弹窗 ---------- */
  function vehicleDetail(s, id) {
    const v = (s.vehicles || []).find((x) => x.id === id);
    if (!v) return '<h2>车辆信息不可用</h2><p>该车可能已退出运行，请刷新后重试。</p>';
    const lvl = levelClass(v);
    const fresh = v.freshLabel || locFresh(v)[0];
    const trend = v.trend && v.trend.length ? v.trend : [v.loadPct];
    const min = Math.min(...trend);
    const max = Math.max(...trend);
    const span = max - min;
    const bars = trend.map((p) => {
      const h = span >= 4 ? 18 + ((p - min) / span) * 82 : 45 + (p - min) * 4;
      return `<i style="height:${Math.max(8, Math.min(100, Math.round(h)))}%" title="${p}%"></i>`;
    }).join('');
    return `<div class="veh-detail level-${lvl}"><div class="veh-detail-head"><div><small>VEHICLE LIVE</small><h2>${esc(v.plate)}</h2><p>${esc(v.route)} · 下一站 ${esc(v.nextStop)}</p></div><span class="veh-level ${lvl}">${esc(v.levelLabel || LEVEL_NAMES[lvl])}</span></div><div class="veh-pct"><strong>${v.loadPct}%</strong><span>载客率</span></div><div class="load-track big"><i style="width:${v.loadPct}%"></i></div><div class="veh-facts"><div class="veh-fact"><small>载客 / 座位</small><b>${v.load} / ${v.seats}</b></div><div class="veh-fact"><small>剩余座位</small><b>${v.seatsFree} 个</b></div><div class="veh-fact"><small>预计到下一站</small><b>约 ${v.etaMinutes} 分钟</b></div><div class="veh-fact"><small>数据状态</small><b>${esc(fresh)} · ${ageText(v.ageSeconds)}</b></div></div><div class="spark-title">近 ${trend.length} 次上报载客率 · ${min}%–${max}%（相对趋势）</div><div class="spark" role="img" aria-label="最近 ${trend.length} 次上报载客率：${trend.map((p) => p + '%').join('、')}">${bars}</div><p class="source">演示†：载客数为本地模拟，每 15 秒更新，不代表真实车载客流计数。</p></div>`;
  }

  function openVehicle(id) {
    detailId = id;
    $('#dialog-content').innerHTML = vehicleDetail(state(), id);
    const d = $('#dialog');
    if (!d.open) d.showModal();
  }

  function refreshDetail() {
    if (!detailId) return;
    const d = $('#dialog');
    if (!d || !d.open) return;
    $('#dialog-content').innerHTML = vehicleDetail(state(), detailId);
  }

  /* 只替换两个实况区块，避免每 15 秒重绘整个首页、打断滚动与表单。 */
  function updateLive() {
    if (page === 'home') {
      const s = state();
      const vs = $('#vehicle-live');
      if (vs) vs.outerHTML = vehicleSection(s);
      const refreshFocused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.action === 'crowd-refresh';
      const cs = $('#crowd-module');
      if (cs) cs.outerHTML = crowdSection(s);
      const stationRefreshFocused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.action === 'station-refresh';
      const ss = $('#station-crowd-module');
      if (ss) ss.outerHTML = stationCrowdSection(s);
      if (refreshFocused) {
        const b = document.querySelector('[data-action="crowd-refresh"]');
        if (b) b.focus();
      }
      if (stationRefreshFocused) {
        const b = document.querySelector('[data-action="station-refresh"]');
        if (b) b.focus();
      }
      refreshDetail();
    } else if (page === 'routes') {
      render();
      refreshDetail();
    }
  }

  /* ---------- 首页 ---------- */
  function home() {
    const s = state();
    const slots = s.slots;
    return `<section class="hero"><div class="eyebrow">SCENIC TRANSIT · 九寨沟景区</div><h1>把好风景，<br><em>交给从容的旅程。</em></h1><p>查看观光车运行与预约上车名额</p><div class="hero-land" aria-hidden="true"><i></i><b></b><span></span></div></section>${vehicleSection(s)}${crowdSection(s)}${stationCrowdSection(s)}<section class="section"><div class="section-title"><div><small>可预约时段</small><h2>选择上车名额</h2></div><button class="link" data-go="booking">查看全部</button></div>${s.bookingOpen ? slots.slice(0, 2).map((x) => `<button class="slot-card" data-slot="${x.id}"><span><b>${esc(x.label)}</b><small>${esc(x.route)} · ${esc(x.stop)}上车</small></span><span class="slot-open">预约开放 <b>›</b></span></button>`).join('') : '<div class="notice">当前时段线上预约入口已关闭。已确认预约仍按原规则处理。</div>'}<p class="source">预约锁定上车名额，不指定座位 · 容量按班次 70% 预约池 / 30% 现场池分配</p></section><section class="section note-card"><b>乘车提示</b><p>请按预约时段到指定站点核销。车辆状态会按数据新鲜度显示为实时、推算或计划。</p></section>`;
  }

  /* ---------- 预约 ---------- */
  function booking() {
    const s = state();
    const open = s.bookingOpen && !(s.closedSlots || []).includes(chosen);
    return `<div class="page-title"><small>BOOK A RIDE</small><h1>预约乘车</h1><p>一票一约，预约上车名额，不选座位</p></div>${!open ? '<div class="notice">该时段线上预约入口已关闭，请选择其他开放时段或现场池安排。</div>' : ''}<form id="booking-form"><label class="field">有效观光车票号<input name="ticket" required placeholder="输入票号（演示环境仅本地校验）" autocomplete="off"></label><label class="field">乘车时段<select name="slot">${s.slots.map((x) => `<option value="${x.id}" ${chosen === x.id ? 'selected' : ''}>${esc(x.label)} · ${esc(x.route)} · ${esc(x.stop)}${(s.closedSlots || []).includes(x.id) ? ' · 已关闭' : ''}</option>`).join('')}</select></label><div class="notice">班次容量按 70% 预约池 + 30% 现场池分配。预约余量以提交时校验为准；退票或改签成功后自动释放名额。</div><label class="agree"><input type="checkbox" required> 我确认所选车票有效，并同意实名票号仅用于预约校验。</label><button class="primary" ${open ? '' : 'disabled'}>确认预约</button></form><div class="privacy">演示†：此页面不会向景区官方客户端或外部服务发送票号。</div>`;
  }

  /* ---------- 我的行程 ---------- */
  function trips() {
    const s = state();
    const bs = s.bookings;
    return `<div class="page-title"><small>MY TRIPS</small><h1>我的行程</h1><p>预约码仅用于指定站点和时段核销</p></div>${bs.length ? bs.map((b) => `<article class="booking-card"><div class="booking-top"><span class="state ${b.status}">${({ confirmed: '已确认', cancelled: '已取消', checked_in: '已核销' })[b.status] || b.status}</span><span class="source">${evidence(b.evidence)}</span></div><h2>${esc(b.slot)} · ${esc(b.route)}</h2><p>上车站：${esc(b.stop)}　预约单：${esc(b.id)}</p>${b.status === 'confirmed' ? `<div class="qr" aria-label="演示核销码">${esc(b.code)}</div><small class="source">P0 演示码（非真实二维码）· 核销码由官方服务端签发后接入</small><button class="secondary" data-cancel="${b.id}">退订并释放名额</button>` : ''}</article>`).join('') : '<div class="empty"><div>旅程从一张有效车票开始</div><p>预约成功后，行程和核销码会显示在这里。</p><button class="primary" data-go="booking">去预约</button></div>'}<section class="section"><div class="section-title"><h2>站点客流提示</h2><span class="badge demo">演示†</span></div><p>空 · 适中 · 拥挤状态由站点端报数；P0 使用演示状态，不代表实时客流。</p></section>`;
  }

  /* ---------- 线路与站点 ---------- */
  function routes() {
    const s = state();
    const list = s.vehicles || [];
    const crowded = list.filter((v) => v.level === 'crowded' || v.level === 'full').length;
    return `<div class="page-title"><small>ROUTES & STOPS</small><h1>线路与站点</h1><p>线路骨架示意，不提供地图定位</p></div><div class="route-map"><div><i>1</i><b>游客中心</b></div><span></span><div><i>2</i><b>诺日朗</b></div><span></span><div><i>3</i><b>长海</b></div></div>${stationCrowdSection(s)}<section class="section"><h2>定位状态规则</h2><p>≤60 秒：实时；60 秒至 3 分钟：推算；超过 3 分钟：计划。定位断链时顶部灰条说明，不弹窗。</p><div class="source">当前车辆数据：${evidence(s.vehicle.evidence)} · ${list.length} 辆 · 更新于 ${fmtTime(s.vehiclesUpdatedAt || s.updatedAt)}</div></section><section class="section" id="crowd-rules"><h2>拥挤程度规则</h2><p>拥挤度 = 载客 ÷ 核定座位，按四档显示：</p><div class="crowd-legend"><span class="legend-item"><i class="legend-dot empty"></i>空闲 &lt;40%</span><span class="legend-item"><i class="legend-dot normal"></i>适中 40–70%</span><span class="legend-item"><i class="legend-dot crowded"></i>拥挤 70–90%</span><span class="legend-item"><i class="legend-dot full"></i>满员 ≥90%</span></div><p class="source">当前 ${list.length} 辆运行，${crowded} 辆拥挤或满员 · 演示† 数据每 15 秒本地更新，真实系统需接车载客流计数与票务核销数据</p><button class="link" data-go="home">查看车辆拥挤实况 ›</button></section><section class="section"><h2>乘车规则</h2><p>预约绑定实名票号，一票一约；改签或退票成功自动释放原名额。班次容量由预约池与现场池共同分配。</p></section>`;
  }

  function render() {
    const f = { home, booking, trips, routes };
    $('#guest-app').innerHTML = f[page]();
  }

  function bind() {
    document.addEventListener('click', (e) => {
      const p = e.target.closest('[data-page]');
      if (p) { setPage(p.dataset.page); return; }
      const go = e.target.closest('[data-go]');
      if (go) { setPage(go.dataset.go); return; }
      const sl = e.target.closest('[data-slot]');
      if (sl) { chosen = sl.dataset.slot; setPage('booking'); return; }
      const ca = e.target.closest('[data-cancel]');
      if (ca) {
        A.cancelBooking(ca.dataset.cancel);
        showToast('预约已取消，名额已释放');
        render();
        return;
      }
      const veh = e.target.closest('[data-veh]');
      if (veh) { openVehicle(veh.dataset.veh); return; }
      const act = e.target.closest('[data-action]');
      if (!act) return;
      if (act.dataset.action === 'close') { $('#dialog').close(); return; }
      if (act.dataset.action === 'help') {
        $('#dialog-content').innerHTML = '<h2>出行帮助</h2><p>到站时间按定位新鲜度降级显示为分钟估计。预约是上车名额，不含座位号。</p><p class="source">车辆拥挤度按载客 ÷ 核定座位计算，每 15 秒更新；演示† 数据不接真实车载客流。</p>';
        $('#dialog').showModal();
        return;
      }
      if (act.dataset.action === 'crowd-refresh') {
        A.refreshVehicles();
        showToast('车辆拥挤度已刷新');
      }
      if (act.dataset.action === 'station-refresh') {
        A.refreshStations();
        showToast('站点人流量已刷新');
      }
    });

    document.addEventListener('submit', (e) => {
      if (e.target.id !== 'booking-form') return;
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        A.createBooking({ ticketRef: String(fd.get('ticket')).trim(), slotId: fd.get('slot') });
        showToast('预约成功，名额已确认');
        setPage('trips');
      } catch (err) {
        showToast(err.message);
      }
    });

    document.addEventListener('change', (e) => {
      if (e.target.name === 'slot') chosen = e.target.value;
    });

    const d = $('#dialog');
    d.addEventListener('close', () => { detailId = null; });
  }

  A.connect().then((x) => {
    document.documentElement.dataset.adapter = x.adapter;
  }).catch(() => {});

  A.subscribe((m) => {
    if (m && (m.kind === 'vehicle.crowding.changed' || m.kind === 'station.crowding.changed')) {
      updateLive();
      return;
    }
    if (m && m.kind === 'booking.gate.changed') {
      showToast(m.payload.bookingOpen ? '该时段已重新开放预约' : '预约入口已关闭');
      render();
    } else if (m && m.kind && m.kind.startsWith('booking.')) {
      render();
    }
  });

  bind();
  render();
})();
