/* ==========================================================================
   景枢 DispatchOS · 核心工具与通用组件
   无构建、无依赖；file:// 与 http:// 均可运行。
   ========================================================================== */
(function (global) {
  "use strict";

  const DOS = (global.DOS = global.DOS || {});
  DOS.appName = "智调中枢";
  const U = (DOS.util = {});
  const I = (DOS.icons = {});
  const UI = (DOS.ui = {});

  /* ------------------------------------------------------------------ 工具 */
  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  U.esc = function (v) {
    if (v === null || v === undefined) return "";
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  U.attr = U.esc;

  U.fmt = function (v, digits) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    const d = digits === undefined ? 0 : digits;
    return n.toLocaleString("zh-CN", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  };

  U.num = function (v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback === undefined ? 0 : fallback;
  };

  U.round = function (v, d) {
    const p = Math.pow(10, d || 0);
    return Math.round((Number(v) + Number.EPSILON) * p) / p;
  };

  U.clamp = function (v, min, max) {
    return Math.max(min, Math.min(max, v));
  };

  U.pctFrac = function (v, digits) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return (n * 100).toFixed(digits === undefined ? 1 : digits) + "%";
  };

  U.pctNum = function (v, digits) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toFixed(digits === undefined ? 1 : digits) + "%";
  };

  U.signed = function (v, digits) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    const d = digits === undefined ? 0 : digits;
    return (n > 0 ? "+" : "") + n.toLocaleString("zh-CN", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  };

  U.signedPctFrac = function (v, digits) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    const d = digits === undefined ? 1 : digits;
    return (n > 0 ? "+" : "") + (n * 100).toFixed(d) + "%";
  };

  U.niceMax = function (v) {
    const n = Math.max(1, Number(v) || 1);
    const p = Math.pow(10, Math.floor(Math.log10(n)));
    const x = n / p;
    const m = x <= 1 ? 1 : x <= 2 ? 2 : x <= 2.5 ? 2.5 : x <= 5 ? 5 : x <= 7.5 ? 7.5 : 10;
    return m * p;
  };

  U.clone = function (v) {
    if (global.structuredClone) {
      try { return global.structuredClone(v); } catch (e) { /* fall through */ }
    }
    return JSON.parse(JSON.stringify(v));
  };

  U.readJSON = function (key, fallback) {
    try {
      const raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  };

  U.writeJSON = function (key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  };

  U.remove = function (key) {
    try { global.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  };

  U.uid = function (prefix) {
    const s = Math.random().toString(36).slice(2, 8).toUpperCase();
    return (prefix || "ID") + "-" + s;
  };

  U.debounce = function (fn, wait) {
    let t = 0;
    return function () {
      const args = arguments;
      const ctx = this;
      global.clearTimeout(t);
      t = global.setTimeout(() => fn.apply(ctx, args), wait);
    };
  };

  U.timeHM = function (v) {
    if (!v) return "—";
    const s = String(v);
    if (s.indexOf("T") > -1) return s.slice(11, 16);
    if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
    return s;
  };

  U.isoNow = function () {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const abs = Math.abs(off);
    return (
      d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) +
      sign + pad(Math.floor(abs / 60)) + ":" + pad(abs % 60)
    );
  };

  U.addMinutes = function (hhmm, minutes) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || "00:00"));
    let total = (m ? Number(m[1]) * 60 + Number(m[2]) : 0) + Number(minutes || 0);
    total = ((total % 1440) + 1440) % 1440;
    return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
  };

  U.download = function (filename, content, mime) {
    const blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    global.setTimeout(() => URL.revokeObjectURL(url), 800);
  };

  U.truthy = function (v) {
    return v === true || v === 1 || v === "1" || v === "true" || v === "on";
  };

  U.byId = function (list, id) {
    return (list || []).find((x) => String(x.id) === String(id));
  };

  U.debounceInput = U.debounce;

  /* ------------------------------------------------------------------ 图标 */
  I.paths = {
    archive: '<rect x="3.5" y="5" width="17" height="4" rx="1"/><path d="M5.2 9v9.4c0 .9.7 1.6 1.6 1.6h10.4c.9 0 1.6-.7 1.6-1.6V9"/><path d="M9.5 13h5"/>',
    sliders: '<path d="M4 7h8M16 7h4M4 17h4M12 17h8"/><circle cx="14" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    gauge: '<path d="M4.5 17a8 8 0 1 1 15 0"/><path d="M12 13l3.5-3.5"/><circle cx="12" cy="13" r="1"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/><path d="M8.5 14h2M13.5 14h2M8.5 17h2"/>',
    decision: '<path d="M6 4.5v6a3 3 0 0 0 3 3h7"/><path d="M13.5 10.5 17 13.5l-3.5 3"/><path d="M6 19.5v-3"/>',
    phone: '<rect x="7" y="2.8" width="10" height="18.4" rx="2.2"/><path d="M10.5 5h3M11 18.6h2"/>',
    chart: '<path d="M4 19.5V4.5M4 19.5h16"/><path d="M7.5 15.5l3.2-4.2 2.7 2.2 4.6-6"/>',
    export: '<path d="M12 3.5v11"/><path d="m8.5 11 3.5 3.5 3.5-3.5"/><path d="M5 17.5v1.3c0 .9.7 1.6 1.6 1.6h10.8c.9 0 1.6-.7 1.6-1.6v-1.3"/>',
    download: '<path d="M12 3.5v11"/><path d="m8.5 11 3.5 3.5 3.5-3.5"/><path d="M5 18.5h14"/>',
    chevronRight: '<path d="m9 5 7 7-7 7"/>',
    chevronDown: '<path d="m5 9 7 7 7-7"/>',
    arrowRight: '<path d="M4 12h16"/><path d="m14 6 6 6-6 6"/>',
    arrowUpRight: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="m5 5 14 14M19 5 5 19"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
    unlock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 7.5-1.8"/>',
    check: '<path d="m4.5 12.5 5 5 10-11"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16.5 9"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    shield: '<path d="M12 3.2 19 6v5.5c0 4.4-3 7.2-7 9.3-4-2.1-7-4.9-7-9.3V6z"/><path d="m9 12 2 2 4-4"/>',
    route: '<circle cx="5.5" cy="18" r="2"/><circle cx="18.5" cy="6" r="2"/><path d="M7.5 18h3.2c2 0 3.1-1.2 3.8-3.1l1-2.8c.7-1.9 1.8-3.1 3.8-3.1h.7"/>',
    bus: '<rect x="5" y="3.5" width="14" height="14" rx="2.5"/><path d="M5 9h14M8 17.5v2M16 17.5v2"/><circle cx="8.5" cy="14" r="1"/><circle cx="15.5" cy="14" r="1"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c.4-3.4 2.5-5.4 5.5-5.4s5.1 2 5.5 5.4"/><path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.9M17 14.8c2 .5 3.3 2.3 3.6 5.2"/>',
    alert: '<path d="M12 3.5 21 20H3z"/><path d="M12 9v5M12 17.2v.2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.2"/>',
    fileText: '<path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5v5h5M9 12h6M9 15.5h6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
    plus: '<path d="M12 4.5v15M4.5 12h15"/>',
    trash: '<path d="M4.5 7h15M9 7V4.5h6V7M6.5 7l.9 13h9.2l.9-13"/><path d="M10 11v6M14 11v6"/>',
    refresh: '<path d="M20 7v5h-5"/><path d="M19.2 12a7.5 7.5 0 1 1-2.2-5.3L20 9.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/>',
    rain: '<path d="M7 15.5a4 4 0 1 1 .8-7.9A5 5 0 0 1 17.5 9a3.2 3.2 0 0 1 .5 6.4"/><path d="m8 18-1 2M12.5 18l-1 2M17 18l-1 2"/>',
    cloud: '<path d="M7 18a4.2 4.2 0 0 1-.5-8.4A5.4 5.4 0 0 1 17.2 11 3.5 3.5 0 0 1 17 18z"/>',
    cloudRain: '<path d="M7 14.5a4 4 0 1 1 .8-7.9A5 5 0 0 1 17.5 8a3.2 3.2 0 0 1 .5 6.4"/><path d="m8 17-1 2M12.5 17l-1 2M17 17l-1 2"/>',
    map: '<path d="m3.8 6.2 5.2-2 6 2 5.2-2v13.6l-5.2 2-6-2-5.2 2z"/><path d="M9 4.2v13.6M15 6.2v13.6"/>',
    layers: '<path d="m12 3.5 8.5 4.5L12 12.5 3.5 8z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    spark: '<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4-5.7-1.8L10.2 9z"/>',
    list: '<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><circle cx="4.5" cy="6.5" r=".9"/><circle cx="4.5" cy="12" r=".9"/><circle cx="4.5" cy="17.5" r=".9"/>',
    inbox: '<path d="M4 5.5h16v13H4z"/><path d="M4 14h4l1.5 2h5L16 14h4"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.4-4 3-6 7-6s6.6 2 7 6"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
    play: '<path d="M8 5.5v13l10-6.5z"/>',
    flag: '<path d="M6 21V4M6 4h12l-2.5 4L18 12H6"/>',
    wifi: '<path d="M3.5 9.5a13 13 0 0 1 17 0M6.5 13a8.5 8.5 0 0 1 11 0M9.5 16.4a4 4 0 0 1 5 0"/><circle cx="12" cy="19.5" r=".9"/>',
    battery: '<rect x="3" y="8" width="16" height="8" rx="1.5"/><path d="M21 11v2"/><rect x="5" y="10" width="10" height="4" rx=".5" fill="currentColor" stroke="none"/>',
  };

  I.icon = function (name, cls) {
    const p = I.paths[name] || I.paths.info;
    return (
      '<svg class="' + (cls || "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + "</svg>"
    );
  };

  /* ------------------------------------------------------------------ 标签 */
  UI.evidence = function (meta, id, fallback) {
    const list = (meta && meta.evidence) || [];
    const ev = list.find((x) => x.id === id) || {
      id: id || "input",
      label: fallback || id || "填报",
      color: "slate",
      mark: "",
    };
    const mark = ev.mark || (ev.id === "assumed" || ev.id === "demo" ? "†" : "");
    return (
      '<span class="tag tag--' + U.esc(ev.color || "slate") + ' tag--mark" title="' +
      U.esc(ev.desc || ev.label) + '">' + U.esc(ev.label) +
      (mark ? "<i>" + U.esc(mark) + "</i>" : "") + "</span>"
    );
  };

  UI.tag = function (text, tone, extraCls) {
    return '<span class="tag tag--' + (tone || "slate") + (extraCls ? " " + extraCls : "") + '">' + text + "</span>";
  };

  UI.statusTag = function (status, label) {
    return '<span class="state state--' + U.esc(status || "neutral") + '">' +
      '<i class="dot" style="background:currentColor"></i>' + U.esc(label || status || "—") + "</span>";
  };

  UI.stateBadge = function (state, label) {
    return '<span class="state state--' + U.esc(state || "neutral") + '">' +
      '<i class="dot" style="background:currentColor"></i>' + U.esc(label || state || "—") + "</span>";
  };

  UI.riskClass = function (risk) {
    if (risk === "red" || risk === "danger") return "is-red";
    if (risk === "warn" || risk === "warning") return "is-warn";
    if (risk === "info") return "is-info";
    return "is-ok";
  };

  UI.riskLabel = function (risk) {
    return risk === "red" ? "红线" : risk === "warn" ? "警示" : risk === "info" ? "提示" : "安全";
  };

  UI.marginTone = function (pct) {
    const n = Number(pct);
    if (!Number.isFinite(n)) return "ok";
    if (n < 0) return "red";
    if (n < 15) return "warn";
    return "ok";
  };

  UI.marginClass = function (pct) {
    return "is-" + UI.marginTone(pct);
  };

  UI.planStatus = function (row) {
    if (row.over) return { tone: "red", label: "超载" };
    if (Number(row.margin) < 0) return { tone: "red", label: "缺口" };
    if (Number(row.margin) < 15) return { tone: "warn", label: "偏紧" };
    return { tone: "green", label: "安全" };
  };

  /* ------------------------------------------------------------------ 组件 */
  UI.pageHead = function (o) {
    return (
      '<div class="page-head">' +
        '<div class="page-head-copy">' +
          (o.kicker ? '<div class="eyebrow">' + U.esc(o.kicker) + "</div>" : "") +
          '<h1 class="page-title">' + U.esc(o.title || "") + "</h1>" +
          (o.desc ? '<p class="page-desc">' + o.desc + "</p>" : "") +
        "</div>" +
        (o.actions ? '<div class="page-actions">' + o.actions + "</div>" : "") +
      "</div>"
    );
  };

  UI.ring = function (pct, o) {
    o = o || {};
    const size = o.size || 74;
    const value = U.clamp(Number(pct) || 0, 0, 1);
    const r = 42;
    const c = 2 * Math.PI * r;
    const off = c * (1 - value);
    return (
      '<div class="' + (o.cls || "ring") + '" style="width:' + size + "px;height:" + size + 'px">' +
        '<svg viewBox="0 0 100 100" style="width:' + size + "px;height:" + size + 'px">' +
          '<circle class="bg" cx="50" cy="50" r="' + r + '" stroke="' + (o.track || "rgba(244,234,215,.16)") + '"></circle>' +
          '<circle class="fg" cx="50" cy="50" r="' + r + '" stroke="' + (o.color || "var(--ochre)") +
            '" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '"></circle>' +
        "</svg>" +
        '<span style="color:' + (o.textColor || "inherit") + '">' + (o.label || Math.round(value * 100) + "%") + "</span>" +
      "</div>"
    );
  };

  UI.sparkline = function (values, color, w, h) {
    const list = (values || []).map(Number).filter(Number.isFinite);
    const width = w || 72;
    const height = h || 26;
    if (list.length < 2) return "";
    const min = Math.min.apply(null, list);
    const max = Math.max.apply(null, list);
    const span = max - min || 1;
    const pts = list.map((v, i) => {
      const x = (i / (list.length - 1)) * (width - 4) + 2;
      const y = height - 3 - ((v - min) / span) * (height - 7);
      return U.round(x, 1) + "," + U.round(y, 1);
    });
    return (
      '<svg class="kpi-spark" viewBox="0 0 ' + width + " " + height + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<path d="M' + pts.join(" L") + '" fill="none" stroke="' + (color || "var(--moss)") +
        '" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path>' +
      "</svg>"
    );
  };

  UI.kpi = function (o, meta, options = {}) {
    const tone = o.status === "red" ? "is-red" : o.status === "warn" ? "is-warn" : "is-ok";
    return (
      '<article class="kpi ' + tone + (options.featured ? ' kpi-featured' : '') + '">' +
        '<div class="kpi-top">' +
          '<span class="kpi-label" title="' + U.esc(o.label) + '">' + U.esc(o.label) + "</span>" +
          (o.evidence ? UI.evidence(meta, o.evidence) : "") +
        "</div>" +
        '<div class="kpi-value">' + U.esc(o.display !== undefined ? o.display : o.value) +
          (o.unit ? "<small>" + U.esc(o.unit) + "</small>" : "") + "</div>" +
        '<div class="kpi-meta">' +
          (o.target ? '<span class="kpi-target">' + U.esc(o.target) + "</span>" : "") +
          (o.delta ? '<span class="kpi-delta">' + U.esc(o.delta) + "</span>" : "") +
          (options.status ? UI.tag(options.status, o.status === "red" ? "red" : o.status === "warn" ? "amber" : "green") : "") +
        "</div>" +
        (o.hint ? '<p class="kpi-hint" title="' + U.esc(o.hint) + '">' + U.esc(o.hint) + "</p>" : "") +
        (o.trend && o.trend.length > 1 ? UI.sparkline(o.trend, tone === "is-red" ? "#ab4030" : tone === "is-warn" ? "#b37d20" : "#2b7a5b") : "") +
      "</article>"
    );
  };

  UI.stat = function (label, value, unit, note, tone) {
    return (
      '<div class="kpi ' + (tone ? "is-" + tone : "is-ok") + '">' +
        '<div class="kpi-top"><span class="kpi-label">' + U.esc(label) + "</span></div>" +
        '<div class="kpi-value">' + U.esc(value) + (unit ? "<small>" + U.esc(unit) + "</small>" : "") + "</div>" +
        (note ? '<p class="kpi-hint">' + U.esc(note) + "</p>" : "") +
      "</div>"
    );
  };

  UI.empty = function (title, text, iconName) {
    return (
      '<div class="empty">' + I.icon(iconName || "inbox") +
        "<b>" + U.esc(title || "暂无数据") + "</b>" +
        (text ? "<p>" + U.esc(text) + "</p>" : "") +
      "</div>"
    );
  };

  UI.marginStrip = function (curve) {
    if (!curve || !curve.labels) return "";
    return (
      '<div class="margin-strip">' +
        curve.labels.map((label, i) => {
          const m = Number(curve.margin[i]);
          const tone = UI.marginTone(m);
          const width = U.clamp(Math.abs(m) / 15 * 100, 4, 100);
          return '<span class="margin-cell ' + (tone === "ok" ? "" : "is-" + tone) +
            '" data-tip="' + U.esc(label + ":00 余量 " + U.pctNum(m, 1)) + '"><i style="width:' + width + '%"></i></span>';
        }).join("") +
      "</div>"
    );
  };

  /* ------------------------------------------------------------------ 图表 */
  UI.timeChart = function (o) {
    const labels = o.labels || [];
    const series = (o.series || []).filter((s) => s && s.values && s.values.length);
    const W = 760;
    const H = o.height || 232;
    const pad = { l: 46, r: 16, t: 18, b: 28 };
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;
    const n = labels.length;
    if (!n || !series.length) return '<div class="chart-empty">暂无可绘制数据</div>';

    let max = 1;
    series.forEach((s) => s.values.forEach((v) => {
      const nv = Number(v);
      if (Number.isFinite(nv)) max = Math.max(max, nv);
    }));
    if (o.target) max = Math.max(max, Number(o.target));
    const yMax = o.yMax || U.niceMax(max * 1.08);
    const y = (v) => pad.t + innerH - (U.clamp(Number(v) || 0, 0, yMax) / yMax) * innerH;
    const band = innerW / n;
    const x = (i) => pad.l + (i + 0.5) * band;
    const barW = Math.max(8, band * 0.44);

    let svg = '<svg class="chart-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' +
      U.esc(o.aria || "分时曲线") + '" preserveAspectRatio="xMidYMid meet">';

    for (let i = 0; i <= 4; i++) {
      const gy = pad.t + (innerH / 4) * i;
      const val = yMax * (1 - i / 4);
      svg += '<line class="grid-line" x1="' + pad.l + '" y1="' + gy + '" x2="' + (W - pad.r) + '" y2="' + gy + '"/>';
      svg += '<text class="axis-text" x="' + (pad.l - 8) + '" y="' + (gy + 3) + '" text-anchor="end">' + U.fmt(val) + "</text>";
    }

    series.forEach((s) => {
      const pts = s.values.map((v, i) => [x(i), y(v)]);
      if (s.type === "bar") {
        s.values.forEach((v, i) => {
          const yv = y(v);
          const h = Math.max(0, y(0) - yv);
          svg += '<rect x="' + (x(i) - barW / 2) + '" y="' + yv + '" width="' + barW + '" height="' + h +
            '" rx="2" fill="' + s.color + '" fill-opacity="' + (s.opacity === undefined ? 0.22 : s.opacity) + '"/>';
        });
      } else if (s.type === "area") {
        const path = "M" + pts.map((p) => U.round(p[0], 1) + "," + U.round(p[1], 1)).join(" L") +
          " L" + U.round(pts[pts.length - 1][0], 1) + "," + y(0) +
          " L" + U.round(pts[0][0], 1) + "," + y(0) + " Z";
        svg += '<path class="series-area" d="' + path + '" fill="' + s.color + '" fill-opacity="' +
          (s.fillOpacity === undefined ? 0.14 : s.fillOpacity) + '"/>';
        svg += '<path class="series-line" d="M' + pts.map((p) => U.round(p[0], 1) + "," + U.round(p[1], 1)).join(" L") +
          '" stroke="' + s.color + '" stroke-width="' + (s.width || 2) + '"/>';
      } else if (s.type === "line" || s.type === "dash" || !s.type) {
        svg += '<path class="series-line" d="M' + pts.map((p) => U.round(p[0], 1) + "," + U.round(p[1], 1)).join(" L") +
          '" stroke="' + s.color + '" stroke-width="' + (s.width || 2) + '"' +
          (s.type === "dash" ? ' stroke-dasharray="5 4"' : "") + "/>";
      }
      if (s.dots !== false && s.type !== "bar") {
        pts.forEach((p, i) => {
          const tip = o.tip && o.tip[i] ? o.tip[i] : (labels[i] + " " + s.name + " " + U.fmt(s.values[i]));
          svg += '<circle class="dot-mark" cx="' + U.round(p[0], 1) + '" cy="' + U.round(p[1], 1) +
            '" r="2.4" fill="' + s.color + '"><title>' + U.esc(tip) + "</title></circle>";
        });
      }
    });

    if (o.target) {
      const ty = y(o.target);
      svg += '<line class="target-line" x1="' + pad.l + '" y1="' + ty + '" x2="' + (W - pad.r) + '" y2="' + ty + '"/>';
      svg += '<text class="target-text" x="' + (W - pad.r) + '" y="' + (ty - 5) + '" text-anchor="end">' +
        U.esc(o.targetLabel || "警戒线") + "</text>";
    }

    labels.forEach((label, i) => {
      if (n > 14 && i % 2) return;
      svg += '<text class="axis-label" x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + U.esc(label) + "</text>";
      const bandX = pad.l + i * band;
      const tip = o.tip && o.tip[i] ? o.tip[i] : labels[i];
      svg += '<rect class="hover-band" x="' + bandX + '" y="' + pad.t + '" width="' + band + '" height="' + innerH + '">' +
        "<title>" + U.esc(tip) + "</title></rect>";
    });

    svg += "</svg>";
    const legend = o.legend === false ? "" : (
      '<div class="legend">' + series.map((s) => {
        if (s.type === "bar" || s.type === "area") {
          return '<span class="legend-item"><i class="legend-area" style="background:' + s.color + '"></i>' + U.esc(s.name) + "</span>";
        }
        return '<span class="legend-item"><i class="legend-line' + (s.type === "dash" ? " is-dash" : "") +
          '" style="background:' + (s.type === "dash" ? "transparent" : s.color) + ";border-color:" + s.color + '"></i>' +
          U.esc(s.name) + "</span>";
      }).join("") + "</div>"
    );
    return '<div class="chart">' + svg + legend + (o.note ? '<p class="chart-note">' + U.esc(o.note) + "</p>" : "") + "</div>";
  };

  UI.skeletonSvg = function (sk) {
    if (!sk || !sk.nodes || !sk.nodes.length) return UI.empty("暂无线路骨架");
    const nodes = sk.nodes;
    const W = 680;
    const H = 152;
    const pad = 44;
    const y0 = 56;
    const step = (W - pad * 2) / Math.max(1, nodes.length - 1);
    const pos = {};
    nodes.forEach((n, i) => { pos[n.id] = { x: pad + step * i, y: y0, node: n }; });

    let svg = '<svg class="skeleton-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="线路骨架示意图">';
    (sk.edges || []).forEach((e) => {
      const a = pos[e[0]];
      const b = pos[e[1]];
      if (!a || !b) return;
      const branch = Math.abs(nodes.findIndex((n) => n.id === e[0]) - nodes.findIndex((n) => n.id === e[1])) > 1;
      if (branch) {
        const mx = (a.x + b.x) / 2;
        svg += '<path class="skeleton-edge is-branch" d="M' + a.x + " " + (a.y + 12) + " Q" + mx + " 132 " + b.x + " " + (b.y + 12) + '"/>';
        svg += '<text x="' + mx + '" y="145" text-anchor="middle" fill="var(--ochre-2)" font-size="7.5">支线（示意）</text>';
      } else {
        svg += '<line class="skeleton-edge" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>';
      }
    });
    nodes.forEach((n) => {
      const p = pos[n.id];
      const cls = n.role === "入口" ? "is-entry" : n.role === "换乘" ? "is-hub" : "";
      svg += '<g class="skeleton-node ' + cls + '">';
      svg += '<circle cx="' + p.x + '" cy="' + p.y + '" r="11"/>';
      svg += '<text x="' + p.x + '" y="' + (p.y + 27) + '" text-anchor="middle">' + U.esc(n.name) + "</text>";
      svg += '<text class="role" x="' + p.x + '" y="' + (p.y + 38) + '" text-anchor="middle">' + U.esc(n.role) + "</text>";
      svg += "</g>";
    });
    const dirs = (sk.direction || []).map((d) => d.name + " " + Math.round(d.share * 100) + "%").join(" · ");
    svg += '<text x="' + (W - 4) + '" y="12" text-anchor="end" fill="var(--muted-2)" font-size="8">' + U.esc(dirs) + "</text>";
    svg += "</svg>";
    return (
      '<div class="skeleton-wrap">' + svg +
        '<div class="skeleton-legend"><span><i></i>主线路</span><span><i class="is-branch"></i>支线</span>' +
        '<span>' + U.esc(sk.note || "线路骨架示意，无 GIS 坐标") + "</span></div>" +
      "</div>"
    );
  };

  /* ------------------------------------------------------------------ 其它 */
  UI.icon = I.icon;

  UI.plant = function (name) {
    return I.icon(name);
  };

  UI.escape = U.esc;

  global.DOS = DOS;
})(window);
