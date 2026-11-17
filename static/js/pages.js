/* ==========================================================================
   景枢 DispatchOS · 页面渲染注册表
   每页只负责“把快照画出来”，所有动作通过 data-action 交给 app.js。
   ========================================================================== */
(function (global) {
  "use strict";
  const DOS = global.DOS;
  const U = DOS.util;
  const I = DOS.icons;
  const UI = DOS.ui;
  const { esc, fmt, pctFrac, pctNum, signed, timeHM } = U;

  const pages = (DOS.pages = {});
  const ROLE_LABEL = {
    command: "指挥中心",
    dispatcher: "调度员",
    fleet: "车队负责人",
    driver: "车队人员",
    duty: "值班领导",
  };
  const MODE_LABEL = { realtime: "实时协同", semi: "半实时协同", low: "低协同" };
  const TASK_LABEL = {
    dispatched: "待接单",
    accepted: "已接单",
    reported: "已回执",
    done: "已完成",
  };
  const REPORT_LABEL = { normal: "正常", crowded: "拥挤", full: "爆满" };

  function btn(label, action, opts) {
    opts = opts || {};
    return '<button type="button" class="btn ' + (opts.cls || "") + '" data-action="' + esc(action) + '"' +
      (opts.attrs || "") + (opts.disabled ? " disabled" : "") + ">" +
      (opts.icon ? I.icon(opts.icon) : "") + esc(label) + "</button>";
  }

  function iconBtn(label, action, icon, opts) {
    opts = opts || {};
    return '<button type="button" class="icon-btn" title="' + esc(label) + '" aria-label="' + esc(label) +
      '" data-action="' + esc(action) + '"' + (opts.attrs || "") + ">" + I.icon(icon) + "</button>";
  }

  function sectionLabel(text) {
    return '<div class="section-label">' + esc(text) + "</div>";
  }

  function stateText(state) {
    const map = {
      pending: "待审核",
      approved: "已批准",
      dispatched: "已下发",
      accepted: "已接单",
      reported: "已回执",
      rejected: "已拒绝",
    };
    return map[state] || state || "—";
  }

  function miniSpark(values, color) {
    const list = (values || []).map(Number).filter(Number.isFinite);
    if (list.length < 2) return "";
    const w = 250;
    const h = 24;
    const min = Math.min.apply(null, list);
    const max = Math.max.apply(null, list);
    const span = max - min || 1;
    const pts = list.map((v, i) => {
      const x = (i / (list.length - 1)) * (w - 4) + 2;
      const y = h - 3 - ((v - min) / span) * (h - 7);
      return U.round(x, 1) + "," + U.round(y, 1);
    });
    return '<svg class="profile-spark" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="M' + pts.join(" L") + '" fill="none" stroke="' + color + '" stroke-width="1.4" stroke-linecap="round"/></svg>';
  }

  function projectHasMissing(p) {
    return Number(p.p0_filled) < Number(p.p0_total) || Number(p.completeness) < 1;
  }

  /* ==========================================================================
     01 景区档案
     ========================================================================== */
  pages.scenic = function (app) {
    const s = app.snap;
    const a = s.archive || {};
    const projects = a.projects || [];
    const cur = s.meta.project || {};

    const hero = '<section class="scenic-hero">' +
      '<div class="hero-copy">' +
        '<div class="eyebrow">九寨景枢 · 调度工作台</div>' +
        '<h2 class="hero-title">' + esc(cur.name || "未命名景区") + '</h2>' +
        '<p class="hero-desc">从当前景区开始，查看运行实况、安排班次或处理调度建议。</p>' +
        '<div class="hero-actions">' +
          '<button class="btn btn-primary btn-lg" data-nav="overview">' + I.icon("gauge") + '进入运行实况</button>' +
          '<button class="btn btn-lg" data-nav="params">' + I.icon("sliders") + '打开工作台</button>' +
          '<button class="btn btn-lg" data-action="project-new">' + I.icon("plus") + '新建景区</button>' +
        '</div>' +
      '</div>' +
    '</section>';

    const cards = projects.map((p) => {
      const isCurrent = p.id === cur.id;
      const pct = Math.round(Number(p.completeness || 0) * 100);
      return '<article class="project-card ' + (isCurrent ? "is-current" : "") + '">' +
        '<div class="project-card-top">' +
          '<div class="project-glyph">' + esc((p.name || "?").slice(0, 1)) + "</div>" +
          '<div style="min-width:0"><div class="project-name">' + esc(p.name || p.id) + "</div>" +
          '<div class="project-id">' + esc(p.id) + (p.demo ? " · DEMO" : "") + "</div></div>" +
        "</div>" +
        '<p class="project-note">' + esc(p.note || "未填写项目说明。") + "</p>" +
        '<div class="project-foot">' +
          '<div class="project-meter"><i style="width:' + Math.max(2, pct) + '%"></i></div>' +
          '<span class="project-pct">' + pct + "%</span>" +
          '<div class="project-actions">' +
            (isCurrent
              ? '<button type="button" class="btn btn-sm" data-nav="params">台账</button>'
              : '<button type="button" class="btn btn-sm" data-project-enter="' + esc(p.id) + '">进入</button>') +
            iconBtn("复制景区", "project-duplicate", "copy", { attrs: ' data-project="' + esc(p.id) + '"' }) +
            (projects.length > 1
              ? iconBtn("删除景区", "project-delete", "trash", { attrs: ' data-project="' + esc(p.id) + '"' })
              : "") +
          "</div>" +
        "</div>" +
      "</article>";
    }).join("");

    return '<div class="page">' +
      UI.pageHead({
        kicker: "SCENIC ARCHIVE / 景区档案",
        title: "欢迎使用景枢",
        actions: btn("新建景区", "project-new", { cls: "btn-primary", icon: "plus" }),
      }) +
      hero +
      '<div class="row-between mt-18" style="margin-bottom:10px">' +
        '<div><div class="section-label" style="margin-bottom:2px">已建景区 / PROJECTS</div>' +
        '<div class="tiny muted">共 ' + projects.length + " 个 · 当前项目会带入全部页面</div></div>" +
        '<button type="button" class="btn btn-sm" data-action="project-new">' + I.icon("plus") + "新建</button>" +
      "</div>" +
      '<div class="project-grid">' + (cards || UI.empty("还没有景区", "新建一个景区，从 43 项参数开始。")) + "</div>" +
      '<footer class="page-footer"><div><b>景枢 DispatchOS</b> · ' + esc(s.meta.version) +
        " · 演示日期 " + esc(s.meta.date) + '</div><div class="footer-right">景区档案 · 数据源 ' +
        esc(s.meta.source.label) + "</div></footer>" +
    "</div>";
  };

  /* ==========================================================================
     02 工作台
     ========================================================================== */
  pages.params = function (app) {
    const s = app.snap;
    const p = s.params;
    const counts = p.counts || {};
    const dirtyCount = Object.keys(app.state.dirty).length;
    const canEdit = app.can("edit_params");
    const groups = p.groups || [];
    const selectedGroup = app.state.params.group || "all";
    const flag = app.state.params.flag || "all";

    const groupChips = '<button type="button" class="filter-chip ' + (selectedGroup === "all" ? "is-active" : "") +
      '" data-param-group="all">全部<span class="count">' + (p.fields || []).length + "</span></button>" +
      groups.map((g) => '<button type="button" class="filter-chip ' + (selectedGroup === g.id ? "is-active" : "") +
        '" data-param-group="' + esc(g.id) + '">' + esc(g.name) +
        '<span class="count">' + Number(g.filled || 0) + "/" + Number(g.total || 0) + "</span></button>").join("");

    const flagDefs = [
      ["all", "全部", (p.fields || []).length],
      ["missing", "缺项", counts.missing || 0],
      ["assumed", "† 假设", counts.assumed || 0],
      ["suspect", "可疑", counts.suspect || 0],
      ["p0", "仅 P0", counts.p0 || (p.fields || []).filter((f) => f.prio === "P0").length],
    ];
    const flagChips = flagDefs.map(([id, label, count]) =>
      '<button type="button" class="filter-chip ' + (flag === id ? "is-active" : "") + '" data-param-flag="' + id + '">' +
      label + '<span class="count">' + count + "</span></button>").join("");

    const assumptions = p.assumptions || {};
    const assumptionList = Object.keys(assumptions).length
      ? Object.keys(assumptions).map((k) => {
          const a = assumptions[k];
          return '<div class="history-item"><div class="history-time">' + esc(k) + '</div><div class="history-text"><b>' +
            esc(a.label || k) + "</b> 按 <b>" + esc(a.value) + "</b> 补全<br><span>" + esc(a.why || "") + "</span></div></div>";
        }).join("")
      : '<div class="history-empty">当前参数没有程序补全项。</div>';

    const missing = (p.missing_p0 || []).map((k) => {
      const f = (p.fields || []).find((x) => x.key === k);
      return f ? f.label : k;
    });

    return '<div class="page">' +
      UI.pageHead({
        kicker: "WORKBENCH / 工作台",
        title: "工作台",
        actions: "",
      }) +
      '<div class="ledger-bar">' +
        '<div class="ledger-ring">' + UI.ring(Number(p.completeness || 0), {
          size: 52, cls: "ledger-ring", label: Math.round(Number(p.completeness || 0) * 100) + "%",
          track: "var(--line)", color: "var(--moss)", textColor: "var(--ink)",
        }) + "</div>" +
        '<div class="ledger-main"><div class="ledger-title">参数完整度 <span>' +
          (p.p0_filled || 0) + "/" + (p.p0_total || 16) + " 项 P0 · 共 " + (p.fields || []).length + " 项</span></div>" +
          '<div class="ledger-stats">' +
            '<span class="ledger-stat ' + (counts.missing ? "is-red" : "") + '">缺项 <b>' + (counts.missing || 0) + "</b></span>" +
            '<span class="ledger-stat ' + (counts.assumed ? "is-amber" : "") + '">假设† <b>' + (counts.assumed || 0) + "</b></span>" +
            '<span class="ledger-stat ' + (counts.suspect ? "is-red" : "") + '">可疑 <b>' + (counts.suspect || 0) + "</b></span>" +
            '<span class="ledger-stat">已填 <b>' + (counts.filled || 0) + "</b></span>" +
            '<span class="ledger-stat" data-dirty-count="1">待保存 <b>' + dirtyCount + "</b></span>" +
          "</div>" +
        "</div>" +
        '<div class="ledger-actions">' +
          (counts.missing ? UI.tag("P0 有缺口", "red") : UI.tag("P0 已齐", "green")) +
          (canEdit ? "" : UI.tag("只读", "slate")) +
        "</div>" +
      "</div>" +
      '<div class="param-toolbar">' +
        '<div class="search-box">' + I.icon("search") +
          '<input class="search-input" type="search" placeholder="搜索参数名 / key / 说明" data-param-search="1" value="' +
          esc(app.state.params.q || "") + '" autocomplete="off"></div>' +
        '<div class="filter-chips">' + groupChips + "</div>" +
      "</div>" +
      '<div class="filter-chips" style="margin-bottom:12px">' + flagChips +
        '<span class="spacer"></span><span class="tiny muted">证据：' +
        (s.meta.evidence || []).map((e) => UI.evidence(s.meta, e.id)).join(" ") + "</span></div>" +
      (missing.length ? '<div class="card" style="border-color:rgba(171,64,48,.28);margin-bottom:12px"><div class="card-body row" style="align-items:flex-start;gap:10px">' +
        '<span class="tag tag--red">P0 缺口</span><div class="small">' + esc(missing.join("、")) +
        " 未填。<span class=\"muted\">这些项会阻塞“可执行”判断；建议先补景区侧真实数据。</span></div></div></div>" : "") +
      '<div id="param-list-root">' + app.paramsListHtml() + "</div>" +
      '<div class="save-bar">' +
        '<div class="save-bar-text">已修改 <b data-dirty-count="1">' + dirtyCount + "</b> 项；保存后按新参数重算全站。" +
          (canEdit ? "" : " <span class=\"tag tag--slate\">只读</span>") + "</div>" +
        '<button type="button" class="btn btn-ghost" data-action="param-reset">放弃修改</button>' +
        '<button type="button" class="btn btn-primary" data-action="save-params" data-save-params="1"' +
          (!canEdit || !dirtyCount ? " disabled" : "") + ">" + I.icon("check") + "保存并重算</button>" +
      "</div>" +
      '<div class="card mt-14"><div class="card-head"><div><div class="card-title">' + I.icon("info") + " 程序补全的假设†</div>" +
        '<div class="card-sub">这些不是景区填的数，答辩时应逐条说明</div></div>' +
        '<span class="tag tag--amber">' + Object.keys(assumptions).length + " 项</span></div>" +
        '<div class="card-body"><div class="history">' + assumptionList + "</div>" +
        '<div class="desk-note" style="margin-top:10px">缺项会以默认值补齐并标 †；可疑值会阻断“可执行”判断，但不会悄悄改数。</div></div></div>' +
      '<footer class="page-footer"><div><b>景枢 DispatchOS</b> · 参数口径 v1 · ' + esc(p.granularity || "整点粒度") +
        '</div><div class="footer-right">来源：' + esc(p.note || "景区填报 / 项目测算 / 假设") + "</div></footer>" +
    "</div>";
  };

  /* ==========================================================================
     03 运行实况
     ========================================================================== */
  pages.overview = function (app) {
    const s = app.snap;
    const o = s.overview;
    const curve = o.curve || {};
    const mode = s.mode || o.mode || {};
    const kpis = (o.kpis || []).map((k) => UI.kpi(k, s.meta)).join("");

    const alerts = (o.alerts || []).map((a) => {
      const tone = UI.riskClass(a.risk);
      const clickable = !!a.card_id;
      return '<button type="button" class="alert ' + tone + '" data-alert-card="' + esc(a.card_id || "") + '"' +
        (clickable ? ' title="查看建议卡"' : ' disabled') + ">" +
        '<span class="alert-ic">' + I.icon(a.risk === "red" ? "alert" : a.risk === "warn" ? "alert" : "info") + "</span>" +
        '<span class="alert-main"><span class="alert-title">' + esc(a.title) + "</span>" +
        '<span class="alert-detail">' + esc(a.detail) + "</span>" +
        '<span class="alert-meta">' + UI.tag(UI.riskLabel(a.risk), a.risk === "red" ? "red" : a.risk === "warn" ? "amber" : "blue") +
          (a.time ? " · " + esc(a.time) : "") + (clickable ? ' · <span class="alert-go">查看建议卡 ' + I.icon("arrowRight") + "</span>" : "") +
        "</span></span></button>";
    }).join("");

    const bottleneck = (o.bottleneck || []).map((b) =>
      '<div class="bottleneck"><span class="bottleneck-rank">' + String(b.rank).padStart(2, "0") + "</span>" +
      '<div class="bottleneck-name">' + esc(b.name) + '<span class="bottleneck-note">' + esc(b.note) + "</span></div>" +
      '<span class="tag tag--' + (b.risk === "red" ? "red" : b.risk === "warn" ? "amber" : "slate") + '">' +
      esc(UI.riskLabel(b.risk)) + "</span></div>").join("");

    const sensRows = (s.overview.sensitivity || []).map((x) => {
      const util = Number(x.util || 0);
      const gap = Number(x.gap || 0);
      return "<tr><td>" + esc(x.name) + "</td><td class=\"num\">" + fmt(x.veh) +
        "</td><td class=\"num\">" + fmt(x.capacity) + "</td><td class=\"num " + (gap > 0 ? "is-red" : "is-ok") + "\">" +
        (gap > 0 ? "缺 " + fmt(gap) : "余 " + fmt(-gap)) + "</td><td><div class=\"sens-bar " +
        (util > 0.95 ? "is-red" : util > 0.85 ? "is-warn" : "") + '"><i style="width:' + U.clamp(util * 100, 2, 100) +
        '%"></i></div></td></tr>';
    }).join("");

    const steps = (mode.base && mode.base.steps || []).slice(0, 3).map((x, i) =>
      '<div class="mode-step"><i>' + (i + 1) + "</i><span>" + esc(x) + "</span></div>").join("");

    return '<div class="page">' +
      UI.pageHead({
        kicker: "OPERATIONS OVERVIEW / 运行实况",
        title: "运行实况",
        actions: '<button type="button" class="btn" data-action="refresh">' + I.icon("refresh") + "刷新" +
          '</button><button type="button" class="btn btn-primary" data-nav="desk">' + I.icon("decision") + "去调度建议</button>",
      }) +
      '<div class="grid grid-4">' + kpis + "</div>" +
      '<div class="grid grid-main mt-14">' +
        '<div class="stack">' +
          '<section class="card"><div class="card-head"><div><div class="card-title">分时需求 vs 有效运力</div>' +
            '<div class="card-sub">' + esc(curve.note || "整点粒度；安全线按 15% 余量折算") + "</div></div>" +
            '<div class="row">' + UI.evidence(s.meta, "calculated") + '<span class="tag tag--outline">' + esc(curve.unit || "人/小时") + "</span></div></div>" +
            '<div class="card-body">' +
              UI.timeChart({
                labels: curve.labels || [],
                series: [
                  { name: "需求", values: curve.demand || [], type: "area", color: "#b87a3f" },
                  { name: "有效运力", values: curve.capacity || [], type: "line", color: "#2e6a55", width: 2.2 },
                  { name: "15% 安全线", values: (curve.capacity || []).map((v) => Math.round(Number(v) * 0.85)), type: "dash", color: "#ab4030", dots: false },
                ],
                tip: (curve.labels || []).map((l, i) => l + ":00 · 需求 " + fmt(curve.demand[i]) + " · 运力 " + fmt(curve.capacity[i]) + " · 余量 " + pctNum(curve.margin[i])),
                aria: "分时需求与有效运力对比",
              }) +
              UI.marginStrip(curve) +
            "</div></section>" +
          '<section class="card"><div class="card-head"><div><div class="card-title">瓶颈排序</div>' +
            '<div class="card-sub">不是所有异常都值得动手，先处理最靠前的</div></div></div>' +
            '<div class="card-body"><div class="bottleneck-list">' + (bottleneck || UI.empty("当前无瓶颈")) + "</div></div></section>" +
          '<div class="grid grid-2">' +
            '<section class="card"><div class="card-head"><div><div class="card-title">当前调度模式</div>' +
              '<div class="card-sub">由系统协同能力与延迟决定，不靠拍脑袋</div></div></div>' +
              '<div class="card-body"><div class="mode-head"><span class="mode-level is-' + esc(mode.level || "semi") + '">' +
                esc(MODE_LABEL[mode.level] || mode.level || "半实时") + "</span>" +
                '<span class="tiny muted">延迟 ' + esc(mode.latency || "—") + " 分钟</span></div>" +
                '<div class="mode-name">' + esc(mode.base && mode.base.name || "待判断") + "</div>" +
                '<div class="mode-summary">' + esc(mode.base && mode.base.summary || "") + "</div>" +
                '<div class="mode-steps">' + steps + "</div>" +
                '<div class="row mt-10"><button class="btn btn-sm" data-action="mode">' + I.icon("layers") + "查看方案库</button>" +
                '<button class="btn btn-sm btn-ghost" data-nav="desk">去调度建议 ' + I.icon("arrowRight") + "</button></div>" +
              "</div></section>" +
            '<section class="card"><div class="card-head"><div><div class="card-title">线路骨架</div>' +
              '<div class="card-sub">无 GIS 坐标，用拓扑示意替代</div></div></div>' +
              '<div class="card-body">' + UI.skeletonSvg(o.skeleton) + "</div></section>" +
          "</div>" +
        "</div>" +
        '<div class="stack">' +
          '<section class="card"><div class="card-head"><div><div class="card-title">实时预警</div>' +
            '<div class="card-sub">' + (o.alerts || []).length + " 条 · 按风险排序</div></div>" +
            '<span class="tag tag--red">' + ((o.alerts || []).filter((a) => a.risk === "red").length) + " 红线</span></div>" +
            '<div class="card-body"><div class="alert-list">' + (alerts || UI.empty("暂无预警", "当前所有检查项都在安全线以上。")) + "</div></div></section>" +
          '<section class="card"><div class="card-head"><div><div class="card-title">敏感性 · 5 档</div>' +
            '<div class="card-sub">没有置信区间，用“车数 / 循环时间”两档做不确定性表达</div></div>' +
            UI.evidence(s.meta, "calculated") + "</div>" +
            '<div class="card-body" style="padding-top:0"><div class="table-wrap"><table class="table sens-table"><thead><tr>' +
              "<th>情景</th><th>车数</th><th>运力</th><th>缺口</th><th>利用率</th></tr></thead><tbody>" +
              (sensRows || '<tr><td colspan="5" class="muted">暂无敏感性结果</td></tr>') + "</tbody></table></div>" +
            "</div></section>" +
        "</div>" +
      "</div>" +
      '<footer class="page-footer"><div><b>景枢 DispatchOS</b> · 数据截至 ' + esc(o.as_of || s.meta.date) +
        '</div><div class="footer-right">预警口径：红线 / 警示 / 提示 · 安全线 15%</div></footer>' +
    "</div>";
  };

  /* ==========================================================================
     04 运行计划
     ========================================================================== */
  pages.plan = function (app) {
    const s = app.snap;
    const p = s.plan || {};
    const rows = p.rows || [];
    const sum = p.summary || {};
    const peak = rows.find((r) => r.slot === sum.peak_slot) || rows.slice().sort((a, b) => Number(b.flow) - Number(a.flow))[0] || {};
    const canEdit = app.can("plan");
    const locked = rows.filter((r) => r.locked).length;
    const edited = rows.filter((r) => r.edited).length;
    const opt = app.state.optimizerResult;
    const optRows = (opt && opt.status === "feasible" && opt.rows) || [];
    const optBySlot = Object.fromEntries(optRows.map((r) => [r.slot, r]));
    const optCompare = optRows.map((r) => {
      const current = rows.find((x) => x.slot === r.slot) || {};
      return '<tr><td>' + esc(r.slot) + '</td><td class="num">' + fmt(current.veh) + '</td>' +
        '<td class="num">' + fmt(r.veh) + '</td><td class="num">' + fmt(r.capacity) + '</td>' +
        '<td class="num">' + pctNum(r.util * 100) + '</td><td class="num">' + fmt(r.gap) + '</td></tr>';
    }).join("");

    const tableRows = rows.map((r) => {
      const st = UI.planStatus(r);
      return '<tr class="' + (r.edited ? "is-edited " : "") + (r.over ? "is-over" : "") + '">' +
        '<td class="nowrap"><b>' + esc(r.slot) + "</b>" + (r.edited ? UI.tag("已调", "ochre") : "") + "</td>" +
        '<td class="num">' + fmt(r.flow) + "</td>" +
        '<td><input class="table-input" type="number" min="0" step="1" value="' + esc(r.veh) +
          '" data-plan-input="' + esc(r.slot) + '"' + (canEdit ? "" : " disabled") + "></td>" +
        '<td class="num">' + (Number(r.headway) ? Number(r.headway).toFixed(1) : "—") + "</td>" +
        '<td class="num">' + fmt(r.capacity) + "</td>" +
        '<td><span class="tag tag--' + (st.tone === "green" ? "green" : st.tone) + '">' + pctNum(r.margin) + "</span></td>" +
        "<td>" + UI.tag(st.label, st.tone === "green" ? "green" : st.tone) + "</td>" +
        '<td class="nowrap">' + (optBySlot[r.slot] ? '<span class="tag tag--outline" title="优化建议">建议 ' + fmt(optBySlot[r.slot].veh) + '</span> ' : '') +
          '<button type="button" class="lock-btn ' + (r.locked ? "is-on" : "") +
          '" data-plan-lock="' + esc(r.slot) + '" title="' + (r.locked ? "解锁" : "锁定") + '">' +
          I.icon(r.locked ? "lock" : "unlock") + "</button>" +
          '<button type="button" class="btn btn-sm row-apply" data-plan-apply="' + esc(r.slot) + '"' + (canEdit ? "" : " disabled") +
          ">应用</button></td></tr>";
    }).join("");

    const simRows = ((p.sim && p.sim.rows) || []).map((r) =>
      "<tr><td>" + esc(r.name) + '</td><td class="num">' + (Number(r.headway) ? Number(r.headway).toFixed(2) : "—") +
      '</td><td class="num">' + fmt(r.mean_wait, 1) + '</td><td class="num">' + fmt(r.p90_wait, 1) +
      '</td><td class="num">' + fmt(r.max_queue) + '</td><td class="num ' + (Number(r.residual) > 0 ? "is-red" : "") + '">' +
      fmt(r.residual) + "</td></tr>").join("");

    const sensRows = (p.sensitivity || []).map((x) =>
      "<tr><td>" + esc(x.name) + '</td><td class="num">' + fmt(x.veh) + '</td><td class="num">' + fmt(x.capacity) +
      '</td><td class="num ' + (Number(x.gap) > 0 ? "is-red" : "is-ok") + '">' +
      (Number(x.gap) > 0 ? "缺 " + fmt(x.gap) : "余 " + fmt(-x.gap)) + "</td></tr>").join("");

    const driverTone = Number(sum.driver_gap) > 0 ? "red" : "ok";
    const vehTone = Number(sum.veh_gap) > 0 ? "warn" : "ok";

    return '<div class="page">' +
      UI.pageHead({
        kicker: "OPERATIONS PLAN / 运行计划",
        title: "运行计划",
        desc: "上半是需求曲线，下半是班次表。两者是同一个动作的两半，所以不拆成两页。",
        actions: (canEdit ? '<button class="btn" data-action="plan-optimize">生成优化建议</button>' : '') +
          '<button class="btn" data-action="refresh">' + I.icon("refresh") + "刷新</button>" +
          '<button class="btn btn-primary" data-action="plan-submit">' + I.icon("decision") + "去审批</button>",
      }) +
      '<div class="grid grid-4">' +
        UI.stat("高峰目标车数", fmt(sum.target_veh), "辆", "缺口 " + fmt(sum.veh_gap) + " 辆 · 按 15% 安全线反算", vehTone) +
        UI.stat("司机工时缺口", fmt(sum.driver_gap), "人·小时", "需求 " + fmt(sum.target_driver_hours) + " · 当前 " + fmt(sum.driver_hours), driverTone) +
        UI.stat("峰值时段", esc(sum.peak_slot || "—"), "", "需求 " + fmt(sum.peak_flow) + " 人/小时", "warn") +
        UI.stat("已锁定 / 已调整", locked + " / " + edited, "段", "锁定段不参与批量重排", "ok") +
      "</div>" +
      (opt ? '<section class="card mt-14"><div class="card-head"><div><div class="card-title">OR-Tools 分时排班建议</div>' +
        '<div class="card-sub">' + esc(opt.message || '') + ' · 输入摘要 ' + esc((opt.input_fingerprint || '').slice(0, 12)) + '</div></div>' +
        (opt.status === 'feasible' && canEdit ? '<button class="btn btn-primary" data-action="plan-optimize-apply">人工确认并应用</button>' : '') +
        '</div><div class="card-body"><div class="tiny muted">' +
        esc((opt.assumptions || []).join('；')) + (opt.assumptions && opt.assumptions.length ? '。' : '') +
        ' 应用后仍须走现有审批流程；离线模式不运行求解器。</div>' +
        (opt.status === 'feasible' ? '<div class="tiny mt-10">总车时 ' + fmt(opt.objective.vehicles_total_hours) +
          ' · 相邻时段车辆变化 ' + fmt(opt.objective.vehicle_changes) + '</div>' : '') +
        (opt.status === 'feasible' ? '<div class="table-wrap mt-10"><table class="table"><thead><tr><th>时段</th><th>当前车数</th><th>建议车数</th><th>建议运力</th><th>利用率</th><th>余量</th></tr></thead><tbody>' + optCompare + '</tbody></table></div>' : '') +
        '</div></section>' : (!app.state.online ? '<div class="tiny muted mt-10">离线快照不运行 OR-Tools 求解。</div>' : '')) +
      '<div class="grid grid-main mt-14">' +
        '<div class="stack">' +
          '<section class="card"><div class="card-head"><div><div class="card-title">分时客流与计划运力</div>' +
            '<div class="card-sub">' + esc(p.source && p.source.text || "整点粒度") + "</div></div>" +
            '<div class="row">' + UI.evidence(s.meta, p.source && p.source.tag) + "</div></div>" +
            '<div class="card-body">' +
              UI.timeChart({
                labels: rows.map((r) => r.slot.slice(0, 2)),
                series: [
                  { name: "预测需求", values: rows.map((r) => r.flow), type: "area", color: "#b87a3f" },
                  { name: "计划运力", values: rows.map((r) => r.capacity), type: "line", color: "#2e6a55", width: 2.1 },
                ],
                tip: rows.map((r) => r.slot + " · 需求 " + fmt(r.flow) + " · 计划 " + fmt(r.veh) + " 辆 · 运力 " + fmt(r.capacity) + " · 余量 " + pctNum(r.margin)),
                aria: "运行计划分时运力",
              }) +
            "</div></section>" +
          '<section class="card"><div class="card-head"><div><div class="card-title">逐时班次表</div>' +
            '<div class="card-sub">车数可直接改；锁定后不参与批量重排，应用只影响本时段</div></div>' +
            '<span class="tag tag--outline">' + rows.length + " 个整点</span></div>" +
            '<div class="card-body" style="padding-top:0"><div class="table-wrap"><table class="table"><thead><tr>' +
              "<th>时段</th><th>需求</th><th>车数</th><th>间隔/分</th><th>运力</th><th>余量</th><th>状态</th><th>操作</th>" +
              "</tr></thead><tbody>" + (tableRows || '<tr><td colspan="8" class="muted">暂无班次</td></tr>') +
            "</tbody></table></div>" +
            '<div class="tiny muted mt-10">目标车数按 <b>需求 ÷（单车小时运力 × 85%）</b> 反算；' +
            "循环 " + esc(sum.cycle) + " 分 · 座位 " + esc(sum.seats) + " · 可派 " + esc(sum.available) + " 辆。</div>" +
            "</div></section>" +
          '<section class="card"><div class="card-head"><div><div class="card-title">运行预测</div>' +
            '<div class="card-sub">单站单方向泊松到达，只用于比较不同间隔，不是真实候车承诺</div></div>' +
            UI.evidence(s.meta, "simulated") + "</div>" +
            '<div class="card-body" style="padding-top:0"><div class="table-wrap"><table class="table"><thead><tr>' +
              "<th>方案</th><th>间隔/分</th><th>平均候车</th><th>P90 候车</th><th>最大队列</th><th>滞留</th></tr></thead><tbody>" +
              (simRows || '<tr><td colspan="6" class="muted">暂无仿真</td></tr>') + "</tbody></table></div>" +
            '<p class="chart-note">' + esc(p.sim && p.sim.note || "仿真仅作相对比较") + "</p></div></section>" +
        "</div>" +
        '<div class="stack">' +
          '<section class="card"><div class="card-head"><div><div class="card-title">敏感性 · 车数 / 循环</div>' +
            '<div class="card-sub">先看哪一档会跌破安全线</div></div></div>' +
            '<div class="card-body" style="padding-top:0"><table class="table sens-table"><thead><tr>' +
              "<th>情景</th><th>车数</th><th>运力</th><th>余量</th></tr></thead><tbody>" +
              (sensRows || '<tr><td colspan="4" class="muted">暂无</td></tr>') + "</tbody></table></div></section>" +
          '<section class="card"><div class="card-head"><div><div class="card-title">计划口径</div></div></div>' +
            '<div class="card-body"><div class="matrix-row"><span>计划日期</span><b>' + esc(p.date || s.meta.date) + "</b></div>" +
              '<div class="matrix-row"><span>可派车辆</span><b>' + fmt(sum.available) + " 辆</b></div>" +
              '<div class="matrix-row"><span>循环时间</span><b>' + esc(sum.cycle) + " 分</b></div>" +
              '<div class="matrix-row"><span>单车小时运力</span><b>' + fmt(sum.cap_unit, 1) + " 人</b></div>" +
              '<div class="matrix-row"><span>运营时长</span><b>' + esc(sum.op_hours) + " 小时</b></div>" +
            "</div></section>" +
        "</div>" +
      "</div>" +
      '<footer class="page-footer"><div><b>景枢 DispatchOS</b> · 运行计划 · ' + esc(p.date || s.meta.date) +
        '</div><div class="footer-right">目标车数按 15% 安全线反算；改动需审批后生效</div></footer>' +
    "</div>";
  };

  /* ==========================================================================
     05 调度建议
     ========================================================================== */
  pages.desk = function (app) {
    const s = app.snap;
    const d = s.desk || {};
    const cards = d.cards || [];
    const filter = app.state.caseFilter || "all";
    const filters = [
      ["all", "全部", cards.length],
      ["pending", "待审核", cards.filter((c) => c.state === "pending").length],
      ["active", "执行中", cards.filter((c) => ["approved", "dispatched", "accepted"].includes(c.state)).length],
      ["done", "已办结", cards.filter((c) => ["reported", "rejected"].includes(c.state)).length],
    ];
    const visible = cards.filter((c) => {
      if (filter === "pending") return c.state === "pending";
      if (filter === "active") return ["approved", "dispatched", "accepted"].includes(c.state);
      if (filter === "done") return ["reported", "rejected"].includes(c.state);
      return true;
    });
    const selected = cards.find((c) => c.id === app.state.selectedCardId) || visible[0] || cards[0];

    const rail = '<aside class="case-rail">' +
      '<div class="case-rail-head"><span class="case-rail-title">建议卡 / CASES</span>' +
        '<span class="tiny muted">' + d.counts.pending + " 待批</span></div>" +
      '<div class="case-filters">' + filters.map(([id, label, n]) =>
        '<button type="button" class="case-filter ' + (filter === id ? "is-active" : "") +
        '" data-case-filter="' + id + '">' + label + " " + n + "</button>").join("") + "</div>" +
      (visible.length ? visible.map((c) => {
        const active = selected && c.id === selected.id;
        return '<button type="button" class="case-item ' + (active ? "is-active " : "") +
          (c.kind === "emergency" ? "is-emergency" : "") + '" data-card-id="' + esc(c.id) + '">' +
          '<div class="case-item-top"><span class="case-item-kind">' + (c.kind === "emergency" ? "EMERGENCY" : "NORMAL") + "</span>" +
            '<span class="case-item-state">' + UI.stateBadge(c.state, c.state_label) + "</span></div>" +
          '<div class="case-item-title">' + esc(c.title) + "</div>" +
          '<div class="case-item-because">' + esc(c.because) + "</div>" +
          '<div class="case-item-foot"><span>' + esc(c.owner || "—") + " · " + esc(c.deadline || "—") + "</span>" +
            (c.state === "pending" ? '<b>待批</b>' : '<span>' + (c.state_label || stateText(c.state)) + "</span>") + "</div>" +
        "</button>";
      }).join("") : '<div class="case-empty">该筛选下没有建议卡。<br>切换场景或筛选试试。</div>') +
    "</aside>";

    if (!selected) {
      return '<div class="page">' + UI.pageHead({
        kicker: "DECISION DESK / 调度建议",
        title: "先有触发，再有建议",
        desc: "建议不是报警：每一张卡都要给出依据、候选、代价、审批与回执。",
      }) + UI.empty("当前没有建议卡", "早高峰或雨雪场景会自动生成建议；也可以去总览查看预警。", "decision") + "</div>";
    }

    const c = selected;
    const canApprove = c.kind === "emergency" ? app.can("decide_emergency") : app.can("decide_normal");
    const canDispatch = app.can("dispatch");
    const selectedId = app.state.candidate[c.id] || c.selected || c.recommended || (c.candidates[0] && c.candidates[0].id);
    const cand = (c.candidates || []).find((x) => x.id === selectedId) || c.candidates[0] || null;

    const candidateHtml = (c.candidates || []).map((x) => {
      const isSel = cand && x.id === cand.id;
      const m = Number(x.after && x.after.margin || 0) * 100;
      const tone = UI.marginTone(m);
      return '<button type="button" class="candidate ' + (isSel ? "is-selected " : "") +
        (x.recommended ? "is-recommended" : "") + '" data-card-id="' + esc(c.id) + '" data-candidate="' + esc(x.id) + '">' +
        '<span class="candidate-check"></span>' +
        '<div class="candidate-main"><div class="candidate-name">' + esc(x.name) +
          (x.recommended ? UI.tag("推荐", "ochre") : "") + "</div>" +
          '<div class="candidate-summary">' + esc(x.summary) + "</div>" +
          '<div class="candidate-meta"><span>到位 <b>' + esc(x.eta) + "</b></span>" +
            "<span>动作 " + esc(effectText(x.effect)) + "</span></div>" +
          '<div class="candidate-cost"><b>代价</b> ' + esc(x.cost) + "</div>" +
          '<div class="candidate-tradeoff">' + esc(x.tradeoff) + "</div>" +
        "</div>" +
        '<div class="candidate-after"><div class="candidate-after-label">批准后余量</div>' +
          '<div class="candidate-after-value ' + (tone === "ok" ? "" : "is-" + tone) + '">' + pctFrac(x.after && x.after.margin, 1) + "</div>" +
          '<div class="candidate-after-target">目标 ≥ 15%</div>' + UI.evidence(s.meta, x.evidence) + "</div>" +
      "</button>";
    }).join("");

    let beforeAfter = "";
    if (cand) {
      const after = cand.after || {};
      const delta = cand.delta || {};
      const before = {
        margin: (Number(after.margin || 0) * 100 - Number(delta.margin_pts || 0)) / 100,
        capacity: Number(after.capacity || 0) - Number(delta.capacity || 0),
        gap: Number(after.gap || 0) - Number(delta.gap || 0),
        driver_gap: Number(after.driver_gap || 0) - Number(delta.driver_gap || 0),
      };
      beforeAfter = '<div class="before-after">' +
        '<div class="ba-col"><div class="ba-title"><span>调整前</span><span>BEFORE</span></div>' +
          baRow("余量", pctFrac(before.margin, 1), UI.marginTone(before.margin * 100)) +
          baRow("有效运力", fmt(before.capacity), "neutral") +
          baRow("余量（人/小时）", signed(-before.gap), before.gap > 0 ? "bad" : "good") +
          baRow("司机余量", signed(-before.driver_gap), before.driver_gap > 0 ? "bad" : "good") +
        "</div>" +
        '<div class="ba-col is-after"><div class="ba-title"><span>调整后</span><span>AFTER</span></div>' +
          baRow("余量", pctFrac(after.margin, 1), UI.marginTone(Number(after.margin || 0) * 100)) +
          baRow("有效运力", fmt(after.capacity), "good") +
          baRow("余量（人/小时）", signed(-after.gap), Number(after.gap) > 0 ? "bad" : "good") +
          baRow("司机余量", signed(-after.driver_gap), Number(after.driver_gap) > 0 ? "bad" : "good") +
        "</div>" +
      "</div>";
    }

    const trigger = c.trigger || {};
    const triggerStatus = trigger.status || "warn";
    const history = (c.history || []).map((h) => {
      const action = h.action || "";
      const label = {
        approve: "批准", approve_dispatch: "批准并下发", dispatch: "下发任务单",
        reject: "拒绝", task_accept: "司机接单", task_report: "现场报数",
        runtime_reset: "重置演示",
      }[action] || action;
      const extra = h.reason ? " · " + h.reason : h.candidate ? " · " + h.candidate : "";
      return '<div class="history-item"><div class="history-time">' + esc(timeHM(h.at)) + "</div>" +
        '<div class="history-text"><b>' + esc(label) + "</b> <span>" + esc(h.actor || "") + extra + "</span></div></div>";
    }).join("");

    const tasks = (c.tasks || []).map((t) =>
      '<div class="task-mini-item"><b>' + esc(t.id) + "</b><span>" + esc(t.driver || "") + " · " +
      esc(t.vehicle || t.plate || "") + " · " + esc(t.depart || "") + "</span>" +
      UI.tag(TASK_LABEL[t.status] || t.status, t.status === "reported" ? "green" : "cyan") + "</div>").join("");

    const flowStates = (d.state_flow || ["pending", "approved", "dispatched", "accepted", "reported"]).map((x) =>
      typeof x === "string" ? { state: x, label: stateText(x) } : x);
    const currentState = c.state === "rejected" ? "pending" : c.state;
    const currentIndex = flowStates.findIndex((x) => x.state === currentState);

    const flow = '<div class="flow">' + flowStates.map((x, i) => {
      const done = currentIndex > i;
      const current = currentIndex === i;
      return '<div class="flow-step ' + (done ? "is-done " : "") + (current ? "is-current" : "") + '">' +
        '<span class="flow-dot">' + (done ? "✓" : i + 1) + "</span>" +
        '<span class="flow-label">' + esc(x.label || stateText(x.state)) + "</span></div>";
    }).join("") + (c.state === "rejected" ? '<div class="flow-step is-current" style="flex:.8"><span class="flow-dot" style="background:var(--brick);border-color:var(--brick);color:#fff">×</span><span class="flow-label">已拒绝</span></div>' : "") + "</div>";

    const approval = approvalBar(app, c, canApprove, canDispatch, cand);
    const rejectBox = app.state.rejecting === c.id
      ? '<div class="reject-box"><textarea data-reject-reason="1" placeholder="拒绝必须写理由：是数据不足、方案代价不可接受，还是超出授权边界？"></textarea>' +
        '<div class="reject-actions"><button class="btn btn-sm btn-ghost" data-action="reject-cancel">取消</button>' +
        '<button class="btn btn-sm btn-danger" data-action="reject-confirm">确认拒绝并留痕</button></div></div>'
      : "";

    const detail = '<section class="card detail">' +
      '<div class="detail-head"><div class="detail-head-main">' +
        '<div class="detail-kicker">' + UI.tag(c.kind === "emergency" ? "应急协同" : "常规调度", c.kind === "emergency" ? "red" : "ochre") +
          UI.stateBadge(c.state, c.state_label) + UI.evidence(s.meta, c.evidence) +
          '<span class="tiny muted">' + esc(c.id) + "</span></div>" +
        '<div class="detail-title">' + esc(c.title) + "</div>" +
        '<div class="detail-sub">' + esc(c.short || c.because) + "</div>" +
      "</div>" +
      '<button class="icon-btn" data-action="refresh" title="刷新">' + I.icon("refresh") + "</button></div>" +
      '<div class="detail-body">' +
        '<div class="detail-section">' + sectionLabel("触发依据 / WHY") +
          '<div class="because">' + esc(c.because) + "</div>" +
          '<div class="trigger-row mt-10">' +
            '<div class="trigger-cell is-' + esc(triggerStatus) + '"><span>' + esc(trigger.label || "触发值") + "</span><b>" +
              esc(trigger.value || "—") + '</b><span style="margin-top:2px">阈值 ' + esc(trigger.threshold || "—") + "</span></div>" +
            '<div class="trigger-cell"><span>审批人 / 时限</span><b style="font-size:11px">' + esc(c.owner || "—") + "</b>" +
              '<span style="margin-top:2px">' + esc(c.deadline || "—") + " 前</span></div>" +
            '<div class="trigger-cell"><span>来源</span><b style="font-size:11px">' + esc(c.source_ref || "引擎") + "</b>" +
              '<span style="margin-top:2px">' + esc(c.opened_at || "") + " 生成</span></div>" +
          "</div>" +
          (c.escalation ? '<div class="desk-note mt-10"><b>升级条件</b>：' + esc(c.escalation) + "</div>" : "") +
        "</div>" +
        '<div class="detail-section">' + sectionLabel("候选动作 / OPTIONS") +
          '<div class="candidate-list">' + candidateHtml + "</div>" +
          '<div class="tiny muted mt-6">选择候选只改变“批准后”的预览；批准后才会重算并生成任务单。</div>' +
        "</div>" +
        '<div class="detail-section">' + sectionLabel("调整前后 / BEFORE → AFTER") + beforeAfter +
          (cand ? '<div class="row mt-10 wrap"><span class="tag tag--outline">' + esc(cand.name) + "</span>" +
            '<span class="tiny muted">' + esc(cand.summary) + "</span></div>" : "") +
        "</div>" +
        '<div class="detail-section">' + sectionLabel("审批与留痕 / DECISION") + approval + rejectBox + flow +
          '<div class="history mt-10">' + (history || '<div class="history-empty">尚无审批记录。批准、拒绝、下发、报数都会写进审计。</div>') + "</div>" +
          (tasks ? '<div class="task-mini mt-10">' + tasks + "</div>" : "") +
          (c.reject_reason ? '<div class="desk-note mt-10" style="border-color:rgba(171,64,48,.25)"><b>拒绝理由</b>：' + esc(c.reject_reason) + "</div>" : "") +
        "</div>" +
      "</div></section>";

    const matrix = (Array.isArray(d.approval_matrix) ? d.approval_matrix : Object.keys(d.approval_matrix || {}).map((k) => ({
      role: k, ...(d.approval_matrix[k] || {}),
    }))).map((x) => {
      const bits = [];
      if (x.normal) bits.push("常规 ✓");
      if (x.emergency) bits.push("应急 ✓");
      if (x.dispatch) bits.push("下发 ✓");
      if (x.kind === "normal" && !x.normal) bits.push("常规 ✓");
      if (x.kind === "emergency" && !x.emergency) bits.push("应急 ✓");
      if (x.deadline) bits.push(x.deadline);
      return '<div class="matrix-row"><b>' + esc(x.role || x.name) + "</b><span>" + esc(bits.join(" · ")) + "</span></div>";
    }).join("");

    const side = '<aside class="desk-side">' +
      '<div class="side-card"><div class="side-title">' + I.icon("shield") + "审批规则</div>" +
        (matrix || '<div class="tiny muted">常规卡：值班调度长；应急卡：值班领导。</div>') +
        '<div class="desk-note" style="margin-top:8px">' + (d.note || "审批是责任动作：必须留痕，必须能拒绝。") + "</div></div>" +
      '<div class="side-card"><div class="side-title">' + I.icon("list") + "审批原则</div><ul class=\"side-list\">" +
        (d.principles || []).map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul></div>" +
      '<div class="side-card"><div class="side-title">' + I.icon("alert") + "失效场景库</div>" +
        (s.badcases && s.badcases.cases ? s.badcases.cases.slice(0, 3).map((x) =>
          '<div class="matrix-row"><b>' + esc(x.name) + "</b><span>" + esc(x.trigger) + "</span></div>").join("") : "") +
        '<button class="btn btn-sm btn-ghost mt-6" data-action="badcases">查看 11 条失效场景 ' + I.icon("arrowRight") + "</button></div>" +
    "</aside>";

    return '<div class="page">' +
      UI.pageHead({
        kicker: "DECISION DESK / 调度建议",
        title: "调度建议",
        actions: '<button class="btn" data-action="badcases">' + I.icon("alert") + "失效场景 " +
          '<span class="tag tag--outline" style="margin-left:2px">11</span></button>',
      }) +
      '<div class="desk-layout">' + rail + detail + side + "</div>" +
      '<footer class="page-footer"><div><b>景枢 DispatchOS</b> · 建议卡 ' + cards.length + " 张 · 待批 " + d.counts.pending +
        '</div><div class="footer-right">审计台账 ' + (d.audit || []).length + " 条 · 决策会写入 decisions.jsonl</div></footer>" +
    "</div>";
  };

  function effectText(effect) {
    if (!effect) return "—";
    const parts = [];
    if (effect.vehicles) parts.push("加开 " + effect.vehicles + " 辆");
    if (effect.demand_factor) parts.push("削峰 " + Math.round((1 - effect.demand_factor) * 100) + "%");
    if (effect.cycle_factor) parts.push("循环 ×" + effect.cycle_factor);
    return parts.join(" · ") || "—";
  }

  function baRow(label, value, tone) {
    const cls = tone === "good" ? "is-good" : tone === "bad" ? "is-bad" : "";
    return '<div class="ba-row"><span>' + esc(label) + '</span><b class="' + cls + '">' + esc(value) + "</b></div>";
  }

  function approvalBar(app, c, canApprove, canDispatch, cand) {
    if (c.state === "pending") {
      if (!canApprove) {
        return '<div class="approve-bar"><div class="approve-note">当前角色是 <b>' + esc(app.snap.meta.role.name) +
          "</b>，没有" + (c.kind === "emergency" ? "应急审批权" : "审批权") + "。演示版可切换角色，权限仅示意。</div>" +
          '<div class="approve-actions">' +
            (c.kind === "emergency" ? '<button class="btn btn-sm btn-ochre" data-action="switch-duty">切换值班领导</button>' : "") +
            '<button class="btn btn-sm btn-ghost" data-nav="overview">返回总览</button></div></div>';
      }
      return '<div class="approve-bar"><div class="approve-note">审批人 <b>' + esc(c.owner) + "</b> · 时限 <b>" + esc(c.deadline) +
        "</b> · 当前选择 <b>" + esc(cand && cand.name || "—") + "</b>。批准后立即重算并留痕。</div>" +
        '<div class="approve-actions">' +
          (canDispatch ? '<button class="btn btn-primary" data-action="approve-dispatch">' + I.icon("check") + "批准并下发</button>" : "") +
          '<button class="btn" data-action="approve-only">仅批准</button>' +
          '<button class="btn btn-danger" data-action="reject-open">拒绝</button>' +
        "</div></div>";
    }
    if (c.state === "approved") {
      return '<div class="approve-bar"><div class="approve-note">已批准，等待下发。审批人 <b>' + esc(c.decided_by || c.owner) +
        "</b> · " + esc(timeHM(c.decided_at)) + "。下发后生成 1–3 张任务单。</div>" +
        '<div class="approve-actions">' +
          (canDispatch ? '<button class="btn btn-primary" data-action="dispatch-card">' + I.icon("bus") + "下发任务单</button>" : "") +
          '<button class="btn btn-ghost" data-action="reject-open">撤回并拒绝</button></div></div>';
    }
    if (c.state === "rejected") {
      return '<div class="approve-bar"><div class="approve-note">已拒绝 · <b>' + esc(c.decided_by || "") + "</b> · " +
        esc(timeHM(c.decided_at)) + "。理由已写入审计，可重新发起。</div></div>";
    }
    if (c.state === "dispatched" || c.state === "accepted") {
      return '<div class="approve-bar"><div class="approve-note">任务单已下发，状态 <b>' + esc(c.state_label) +
        "</b>。司机接单或报数后，卡片会同步回执；全部回执才转“已回执”。</div>" +
        "</div>";
    }
    return '<div class="approve-bar"><div class="approve-note">已办结。' + esc(c.state_label || "") +
      " · 回执与偏差会进入复盘。</div><div class=\"approve-actions\"><button class=\"btn btn-sm\" data-nav=\"review\">去复盘</button></div></div>";
  }

  /* ==========================================================================
     06 司机中枢
     ========================================================================== */
  pages.driver = function (app) {
    const s = app.snap;
    const d = s.driver || {};
    const tasks = d.tasks || [];
    const statusCount = (key) => tasks.filter((t) => (t.status || "dispatched") === key).length;
    const dispatched = statusCount("dispatched");
    const accepted = statusCount("accepted");
    const reported = statusCount("reported");
    const completion = tasks.length ? Math.round(reported / tasks.length * 100) : 0;
    const byDriver = {};
    tasks.forEach((t) => {
      const key = t.driver || "未分配";
      const row = byDriver[key] || (byDriver[key] = { name: key, vehicles: new Set(), total: 0, dispatched: 0, accepted: 0, reported: 0 });
      if (t.vehicle) row.vehicles.add(t.vehicle);
      row.total += 1;
      row[t.status || "dispatched"] = (row[t.status || "dispatched"] || 0) + 1;
    });
    const driverRows = Object.values(byDriver).sort((a, b) => b.total - a.total).map((x) =>
      "<tr><td><b>" + esc(x.name) + "</b></td><td>" + esc(Array.from(x.vehicles).join("、") || "—") +
      "</td><td class=\"num\">" + x.total + "</td><td class=\"num\">" + x.dispatched +
      "</td><td class=\"num\">" + x.accepted + "</td><td class=\"num\">" + x.reported + "</td></tr>").join("");
    const taskById = Object.fromEntries(tasks.map((t) => [t.id, t]));
    const taskReports = tasks.flatMap((t) => (t.reports || []).map((r) => Object.assign({}, r, { driver: t.driver, task_id: t.id })));
    const taskReportIds = new Set(taskReports.map((r) => r.task_id));
    const stationReports = (d.station && d.station.reports || []).map((r) => Object.assign({}, r, { driver: (taskById[r.task_id] || {}).driver || "—" }));
    const reports = taskReports.concat(stationReports.filter((r) => !r.task_id || !taskReportIds.has(r.task_id)))
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    const reportRows = reports.slice(0, 20).map((r) =>
      "<tr><td>" + esc(r.at || "—") + "</td><td>" + esc(r.driver || "—") + "</td><td>" + esc(r.station || (d.station && d.station.name) || "—") +
      "</td><td>" + esc(r.label || r.action || "—") + "</td><td class=\"num\">" + fmt(r.queue || 0) + " 人</td><td>" + esc(r.task_id || "—") + "</td></tr>").join("");
    const station = d.station || {};
    const isDriverRole = (app.state && app.state.role) === "driver";
    const driverHref = "driver.html?role=driver";
    return '<div class="page">' + UI.pageHead({
      kicker: "DRIVER OPERATIONS / 司机中枢",
      title: "司机中枢",
      desc: "司机在手机端接单、报数、回执；提交后按司机、车辆与站点汇总到这里。",
      actions: UI.evidence(s.meta, "demo") +
        '<button class="btn" data-action="refresh">' + I.icon("refresh") + "刷新</button>",
    }) +
      '<div class="driver-split">' +
        '<div class="ds-icon">' + I.icon("phone") + "</div>" +
        '<div class="ds-text"><b>' + (isDriverRole ? "当前以司机身份登录" : "司机端负责执行，中枢负责汇总") + "</b>" +
          "<span>" + (isDriverRole
            ? "接单、现场报数、回执都在司机端完成；这里只看汇总，不代替司机操作。"
            : "任务下发与现场回执在司机端（手机页面）完成，本页实时汇总司机、车辆与站点数据，两侧不互相替代。") +
          "</span></div>" +
        '<a class="btn btn-primary" href="' + driverHref + '" target="_blank" rel="noopener">' +
          (isDriverRole ? "进入司机端处理任务" : "打开司机端") + I.icon("arrowUpRight") + "</a>" +
      "</div>" +
      '<div class="grid grid-4">' +
        UI.stat("任务总量", fmt(tasks.length), "张", "当前项目任务单", "ok") +
        UI.stat("待接单", fmt(dispatched), "张", "已下发，等待司机确认", dispatched ? "warn" : "ok") +
        UI.stat("执行中", fmt(accepted), "张", "已接单，等待现场回执", accepted ? "warn" : "ok") +
        UI.stat("回执完成率", completion + "%", "", reported + " / " + tasks.length + " 张已回执", completion >= 90 ? "ok" : "warn") +
      "</div>" +
      '<div class="grid grid-main mt-14"><div class="stack">' +
        '<section class="card"><div class="card-head"><div><div class="card-title">司机任务统计</div><div class="card-sub">按当前景区任务单汇总司机、车辆及处理状态</div></div></div>' +
          '<div class="card-body" style="padding-top:0"><div class="table-wrap"><table class="table"><thead><tr><th>司机</th><th>车辆</th><th>任务</th><th>待接单</th><th>执行中</th><th>已回执</th></tr></thead><tbody>' +
            (driverRows || '<tr><td colspan="6" class="muted">暂无司机任务记录</td></tr>') +
          '</tbody></table></div></div></section>' +
        '<section class="card"><div class="card-head"><div><div class="card-title">现场回执记录</div><div class="card-sub">司机与站点报数汇总</div></div></div>' +
          '<div class="card-body" style="padding-top:0"><div class="table-wrap"><table class="table"><thead><tr><th>时间</th><th>司机</th><th>站点</th><th>状态</th><th>队列</th><th>任务号</th></tr></thead><tbody>' +
            (reportRows || '<tr><td colspan="6" class="muted">暂无现场回执记录</td></tr>') +
          '</tbody></table></div></div></section>' +
      '</div><div class="stack">' +
        '<section class="card"><div class="card-head"><div><div class="card-title">站点现场状态</div><div class="card-sub">最近一次司机/站点报数</div></div>' + UI.evidence(s.meta, "demo") + '</div>' +
          '<div class="card-body"><div class="kpi-value">' + fmt(station.queue || 0) + '<small>人排队</small></div>' +
            '<div class="matrix-row"><span>站点</span><b>' + esc(station.name || "—") + '</b></div>' +
            '<div class="matrix-row"><span>报数时间</span><b>' + esc((station.reports && station.reports[0] && station.reports[0].at) || "暂无") + '</b></div>' +
          '</div></section>' +
        '<section class="card"><div class="card-head"><div><div class="card-title">任务状态</div></div></div><div class="card-body">' +
          '<div class="matrix-row"><span>待接单</span><b>' + dispatched + '</b></div><div class="matrix-row"><span>执行中</span><b>' + accepted + '</b></div><div class="matrix-row"><span>已回执</span><b>' + reported + '</b></div>' +
        '</div></section>' +
      '</div></div>' +
      '<footer class="page-footer"><div><b>景枢 DispatchOS</b> · 司机中枢 · ' + esc(s.meta.date) +
        '</div><div class="footer-right">统计来源：任务单与现场回执 · ' + esc(s.meta.source && s.meta.source.label || "") + '</div></footer></div>';
  };

  /* ==========================================================================
     07 运营复盘
     ========================================================================== */
  pages.review = function (app) {
    const s = app.snap;
    const r = s.review || {};
    if (!r.available) {
      return '<div class="page">' + UI.pageHead({
        kicker: "OPERATIONS REVIEW / 运营复盘",
        title: "今天错的，明天自动改",
        desc: "计划 vs 实际、三项偏差、写回参数。复盘不是写检讨，是把经验变成下一版的输入。",
      }) + UI.empty("复盘尚未解锁", r.preview || "收班后（第 4 幕）再来看。", "chart") + "</div>";
    }

    const kpis = (r.kpis || []).map((k) => UI.kpi({
      label: k.label, value: k.value, display: k.value, unit: k.unit,
      status: k.status, hint: k.hint, target: "",
    }, s.meta)).join("");

    const deviations = (r.deviations || []).map((d) => {
      const tone = d.status === "red" ? "is-red" : d.status === "ok" ? "is-ok" : "";
      return '<div class="deviation ' + tone + '"><div><div class="deviation-label"><b>' + esc(d.label) + "</b>" +
        UI.tag(d.status === "red" ? "偏差" : "关注", d.status === "red" ? "red" : "amber") + "</div>" +
        '<div class="deviation-diff">计划 <b>' + esc(d.plan) + " " + esc(d.unit || "") + "</b> → 实际 <b>" +
        esc(d.actual) + " " + esc(d.unit || "") + "</b>" + (d.rate !== undefined ? " · " + pctFrac(d.rate) : "") + "</div></div>" +
        '<div class="deviation-value">' + esc(d.diff) + "</div>" +
        '<div class="deviation-why">' + esc(d.why) + "</div></div>";
    }).join("");

    const writebacks = (r.writebacks || []).map((w) => {
      const applied = !!w.applied;
      return '<div class="writeback"><div class="writeback-head"><span class="writeback-name">' + esc(w.label) + "</span>" +
        UI.tag(applied ? "已写回" : "建议", applied ? "green" : "ochre") + "</div>" +
        '<div class="writeback-values"><span class="old">' + esc(w.old) + '</span><span class="arrow">→</span><span class="new">' + esc(w.new) + "</span></div>" +
        '<div class="writeback-why">' + esc(w.why) + "</div>" +
        '<div class="writeback-foot"><span class="tiny muted">影响参数 <b>' + esc(w.key) + "</b> · " + UI.evidence(s.meta, w.evidence) + "</span>" +
          (applied ? '<span class="writeback-applied">' + I.icon("checkCircle") + " 已写回</span>"
            : app.can("writeback") ? '<button class="btn btn-sm btn-ochre" data-writeback="' + esc(w.key) + '">写回参数</button>'
              : '<span class="tiny muted">无写回权限</span>') +
        "</div></div>";
    }).join("");

    const notCollected = (r.not_collected || []).map((x) =>
      '<span class="not-chip" title="' + esc(x.why) + '"><b>' + esc(x.name) + "</b> 本期未采集</span>").join("");

    return '<div class="page">' +
      UI.pageHead({
        kicker: "OPERATIONS REVIEW / 运营复盘",
        title: "运营复盘",
        actions: '<button class="btn" data-action="refresh">' + I.icon("refresh") + "刷新</button>" +
          '<button class="btn btn-primary" data-action="review-next">' + I.icon("calendar") + "生成次日建议</button>",
      }) +
      '<div class="grid grid-4">' + kpis + "</div>" +
      '<div class="review-grid mt-14">' +
        '<div class="stack">' +
          '<section class="card"><div class="card-head"><div><div class="card-title">计划 vs 实际 · 分时</div>' +
            '<div class="card-sub">' + esc(r.note || "实际客流为演示值") + "</div></div>" +
            '<div class="row">' + UI.evidence(s.meta, "demo") + '<span class="tag tag--outline">' + esc(r.date || s.meta.date) + "</span></div></div>" +
            '<div class="card-body">' +
              UI.timeChart({
                labels: r.curve && r.curve.labels || [],
                series: [
                  { name: "计划", values: r.curve && r.curve.planned || [], type: "line", color: "#b87a3f", width: 2 },
                  { name: "实际", values: r.curve && r.curve.actual || [], type: "area", color: "#2e6a55" },
                ],
                tip: (r.curve && r.curve.labels || []).map((l, i) => l + ":00 · 计划 " + fmt(r.curve.planned[i]) + " · 实际 " + fmt(r.curve.actual[i])),
                aria: "计划与实际分时客流",
              }) +
              '<div class="source-note" style="color:var(--muted-2);margin-top:6px"><i class="dot dot--muted"></i><span>' +
              esc(r.source || "演示数据†") + "</span></div>" +
            "</div></section>" +
          '<div class="grid grid-2">' +
            '<section class="card"><div class="card-head"><div><div class="card-title">三项偏差</div>' +
              '<div class="card-sub">不是所有偏差都值得写回</div></div></div><div class="card-body"><div class="deviation-list">' +
              (deviations || UI.empty("暂无偏差")) + "</div></div></section>" +
            '<section class="card"><div class="card-head"><div><div class="card-title">写回参数</div>' +
              '<div class="card-sub">"今天错的，明天自动改"</div></div>' +
              '<span class="tag tag--outline">' + (r.writeback_count || 0) + ' 项</span></div><div class="card-body"><div class="writeback-list">' +
              (writebacks || UI.empty("暂无写回建议")) + "</div></div></section>" +
          "</div>" +
        "</div>" +
        '<div class="stack">' +
          '<section class="card"><div class="card-head"><div><div class="card-title">本期未采集</div>' +
            '<div class="card-sub">不显示、不估算、不编</div></div></div><div class="card-body"><div class="not-collected">' +
            (notCollected || '<span class="not-chip">暂无</span>') + "</div>" +
            '<div class="desk-note mt-10">空驶里程、响应时间、违规次数需要 GPS / 工单数据，本期未接入，因此复盘页不展示这三项。</div></div></section>' +
          '<section class="card"><div class="card-head"><div><div class="card-title">复盘动作</div></div></div><div class="card-body">' +
            '<div class="matrix-row"><span>确认偏差</span><b>' + (r.deviations || []).length + " 项</b></div>" +
            '<div class="matrix-row"><span>写回参数</span><b>' + (r.writeback_count || 0) + " 项</b></div>" +
            '<div class="matrix-row"><span>次日建议</span><b>基于写回后参数</b></div>' +
            '<div class="row mt-10"><button class="btn btn-sm" data-nav="plan">打开运行计划</button>' +
            '<button class="btn btn-sm btn-ghost" data-nav="params">查看工作台</button></div>' +
            '<div class="desk-note mt-10">写回会修改项目参数并追加审计；离线快照下只改本地，不重算。</div>' +
          "</div></section>" +
          '<div class="card is-dark" style="padding:18px"><div class="eyebrow" style="color:var(--ochre)">CLOSING THE LOOP</div>' +
            '<div style="font-size:17px;font-weight:650;line-height:1.4;margin-top:4px">计划 → 审批 → 执行 → 回执 → 复盘 → 写回</div>' +
            '<div style="margin-top:6px;color:rgba(244,234,215,.56);font-size:10.5px;line-height:1.6">闭环不是一句口号：每个节点都有一个人、一个时间、一条留痕。</div></div>' +
        "</div>" +
      "</div>" +
      '<footer class="page-footer"><div><b>景枢 DispatchOS</b> · 运营复盘 · ' + esc(r.date || s.meta.date) +
        '</div><div class="footer-right">实际值为演示数据† · 未接入票务 / 闸机 / GPS</div></footer>' +
    "</div>";
  };

  pages.guest = function (app) {
    const snap = window.GuestIntegration ? window.GuestIntegration.getState() : {slots:[],bookingOpen:false};
    const slots = snap.slots || [];
    const total = slots.reduce((n, x) => n + Number(x.booked || 0), 0);
    const rows = slots.map((x) => '<tr><td>' + esc(x.label) + '</td><td>' + esc(x.route) + '</td><td class="num">' +
      fmt(x.booked) + ' / ' + fmt(x.capacity) + '</td><td class="num">' + fmt(x.onsite) + '</td><td>' +
      UI.evidence(app.snap.meta, x.evidence || 'demo') + '</td></tr>').join('');
    const demand = slots.map((x) => Number(x.booked || 0));
    const suggestion = total > 60 ? '预约需求集中，建议复核高峰班次并生成调度方案。' : '当前预约需求处于演示阈值内；仍需结合运力余量审批。';
    return '<div class="page">' + UI.pageHead({kicker:'GUEST RESERVATION / 游客预约',title:'让预约进入调度闭环',actions:'<a class="btn btn-primary" href="guest.html" target="_blank" rel="noopener">打开游客端 ↗</a>'}) +
      '<div class="grid grid-4">' + UI.kpi({label:'确认预约',value:total,unit:'人次',evidence:'demo'},app.snap.meta) +
      UI.kpi({label:'预约入口',value:snap.bookingOpen?'开放':'已关闭',unit:'游客端',evidence:'demo'},app.snap.meta) +
      UI.kpi({label:'预约池',value:'70%',unit:'班次容量分配',evidence:'input'},app.snap.meta) +
      UI.kpi({label:'现场池',value:'30%',unit:'班次容量分配',evidence:'input'},app.snap.meta)+'</div>'+
      '<div class="grid grid-main mt-14"><div class="stack"><section class="card"><div class="card-head"><div><div class="card-title">逐时预约需求</div><div class="card-sub">本地演示订单聚合；计划曲线接入后与客流预测叠加</div></div>'+UI.evidence(app.snap.meta,'demo')+'</div><div class="card-body">'+UI.timeChart({labels:slots.map(x=>x.label.slice(0,5)),series:[{name:'确认预约',values:demand,type:'area',color:'#2e6a55'}],tip:slots.map(x=>x.label+' · 已确认 '+x.booked+' · 预约池容量 '+x.capacity),aria:'预约需求演示曲线'})+'</div></section>'+
      '<section class="card"><div class="card-head"><div><div class="card-title">逐时预约与容量池</div><div class="card-sub">预约锁上车名额，不分配座位</div></div></div><div class="card-body" style="padding-top:0"><div class="table-wrap"><table class="table"><thead><tr><th>时段</th><th>线路</th><th>预约池使用</th><th>现场池</th><th>证据</th></tr></thead><tbody>'+rows+'</tbody></table></div></div></section></div>'+
      '<div class="stack"><section class="card is-accent"><div class="card-head"><div><div class="card-title">预约缺口建议卡</div><div class="card-sub">触发依据：逐时确认预约聚合 · '+esc(suggestion)+'</div></div>'+UI.evidence(app.snap.meta,'demo')+'</div><div class="card-body"><div class="desk-note"><b>候选动作 A</b><br>复核缺口时段的车辆与司机配置，按运力公式重算；达到审批阈值后提交值班领导。</div><div class="desk-note mt-6"><b>代价</b><br>加密班次会占用其他方向车辆；调拨会拉长原时段间隔。当前缺少票务实数和此预约场景的实时车辆数据，不能自动给出车数。</div><button class="btn btn-primary mt-10" data-nav="desk">进入调度建议审批</button><div class="row mt-10">'+slots.map(x=>'<button class="btn btn-sm" data-action="guest-slot-gate" data-slot="'+esc(x.id)+'" data-open="'+String(x.bookingOpen!==false)+'">'+(x.bookingOpen===false?'重新开放 ':'关闭 ')+esc(x.label)+'</button>').join('')+'</div><p class="tiny muted mt-6">按线路/日期/时段控制游客端入口；关闭不影响已确认预约，操作原因与操作者由线上服务端留痕。</p></div></section>'+
      '<section class="card"><div class="card-head"><div><div class="card-title">站点核销演示</div><div class="card-sub">HID 扫码枪输入框常驻焦点 · QR 主码 / Code128 兜底</div></div></div><div class="card-body"><label class="field-label">预约码（演示）<input data-checkin-code placeholder="扫码枪扫码后回车" autocomplete="off" autofocus></label><label class="tiny muted"><input type="checkbox" data-checkin-offline> 模拟断网：本地排队，恢复后补传</label><button class="btn btn-primary mt-6" data-action="guest-checkin">执行核销</button><div data-checkin-result class="desk-note mt-10">正常放行 / 早到超 15 分钟等待 / 异站异时段红屏。重复扫码幂等；离线记录本地排队。</div></div></section>'+
      '<section class="card"><div class="card-head"><div><div class="card-title">每日对账与复盘指标</div></div></div><div class="card-body"><div class="matrix-row"><span>预约履约率</span><b>未接入 · 演示†</b></div><div class="matrix-row"><span>爽约率</span><b>未接入 · 演示†</b></div><div class="matrix-row"><span>预约池 / 现场池差异</span><b>待接票务台账</b></div><div class="matrix-row"><span>票务池对账差异</span><b>'+esc(snap.lastReconcile||'未对账')+'</b></div></div></section></div></div>'+
      '<footer class="page-footer"><div>官方客户端适配：'+esc(window.GuestIntegration.adapter)+' adapter · contract v1</div><div class="footer-right">通过能力协商接入官方 WebView / 小程序桥或 HTTPS API；当前未连接官方客户端</div></footer></div>';
  };

  /* 供 app.js 使用 */
  DOS.pageMeta = {
    ROLE_LABEL,
    MODE_LABEL,
    TASK_LABEL,
    REPORT_LABEL,
  };

  global.DOS = DOS;
})(window);




