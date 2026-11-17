/* ==========================================================================
   景枢 DispatchOS · 应用控制器
   在线走 /api/bootstrap；连不上服务时自动回落到 demo_snapshot.js。
   ========================================================================== */
(function (global) {
  "use strict";
  const DOS = global.DOS;
  if (!DOS) {
    console.error("[DispatchOS] core.js 未加载");
    return;
  }
  const U = DOS.util;
  const I = DOS.icons;
  const UI = DOS.ui;
  const $ = U.$;
  const $$ = U.$$;
  const esc = U.esc;

  const PREFS = {
    role: "dispatchos.role",
    project: "dispatchos.project",
    scene: "dispatchos.scene",
    page: "dispatchos.page",
  };

  const PAGE_DEFS = {
    scenic: { name: "景区档案", short: "档案", icon: "archive" },
    params: { name: "工作台", short: "工作台", icon: "sliders" },
    overview: { name: "运行实况", short: "实况", icon: "gauge" },
    plan: { name: "运行计划", short: "计划", icon: "calendar" },
    desk: { name: "调度建议", short: "建议", icon: "decision" },
    driver: { name: "司机中枢", short: "司机中枢", icon: "phone" },
    review: { name: "运营复盘", short: "复盘", icon: "chart" },
    guest: { name: "游客预约", short: "游客预约", icon: "phone" },
  };

  const PAGE_GROUPS = [
    { title: "入口", pages: ["scenic"] },
    { title: "日常调度", pages: ["params", "overview", "plan"] },
    { title: "决策", pages: ["desk", "guest"] },
    { title: "司机中枢", pages: ["driver", "review"] },
  ];

  const PAGE_ACCESS = {
    command: ["scenic", "overview", "driver", "review"],
    dispatcher: ["scenic", "params", "overview", "plan", "desk", "driver", "review"],
    fleet: ["scenic", "plan", "desk", "driver", "review"],
    driver: ["scenic", "driver"],
    duty: ["scenic", "params", "overview", "plan", "desk", "driver", "review"],
  };

  const ROLE_PERMS = {
    command: { view: true, export: true, report: false, dispatch: false, edit_params: false, plan: false, decide_normal: false, decide_emergency: false, writeback: false },
    dispatcher: { view: true, edit_params: true, plan: true, decide_normal: true, decide_emergency: true, dispatch: true, report: true, writeback: true, export: true },
    fleet: { view: true, edit_params: false, plan: true, decide_normal: false, decide_emergency: false, dispatch: true, report: true, writeback: false, export: true },
    driver: { view: true, edit_params: false, plan: false, decide_normal: false, decide_emergency: false, dispatch: false, report: true, writeback: false, export: true },
    duty: { view: true, edit_params: true, plan: true, decide_normal: true, decide_emergency: true, dispatch: true, report: true, writeback: true, export: true },
  };

  const LOCAL_FLEET = [
    { driver: "张伟", vehicle: "川U·A1234", plate: "川U·A1234", phone: "138****2101" },
    { driver: "李强", vehicle: "川U·A1288", plate: "川U·A1288", phone: "138****2102" },
    { driver: "王敏", vehicle: "川U·A1366", plate: "川U·A1366", phone: "138****2103" },
    { driver: "赵磊", vehicle: "川U·A1399", plate: "川U·A1399", phone: "138****2104" },
  ];

  const App = {
    boot: null,
    seq: 0,
    state: {
      snap: null,
      projects: [],
      online: false,
      loading: true,
      role: "dispatcher",
      scene: "morning",
      project: null,
      page: null,
      selectedCardId: null,
      caseFilter: "all",
      params: { group: "all", flag: "all", q: "" },
      dirty: {},
      rejecting: null,
      optimizerResult: null,
      candidate: {},
      navOpen: false,
      busy: false,
    },

    get snap() {
      return this.state.snap;
    },

    can(perm) {
      const p = (this.state.snap && this.state.snap.meta && this.state.snap.meta.permissions) || {};
      return !!p[perm];
    },

    /* ------------------------------------------------------------------ 启动 */
    async init() {
      this.boot = global.DISPATCH_BOOT || null;
      const qs = new URLSearchParams(location.search);
      this.state.role = qs.get("role") || U.readJSON(PREFS.role) || "dispatcher";
      this.state.scene = qs.get("scene") || U.readJSON(PREFS.scene) || "morning";
      this.state.project = qs.get("project") || U.readJSON(PREFS.project) ||
        (this.boot && this.boot.default_project) || null;
      this.state.page = this.pageFromHash() || U.readJSON(PREFS.page) || null;
      this.bind();
      this.showBoot();
      await this.load({ initial: true });
    },

    pageFromHash() {
      const h = String(location.hash || "").replace(/^#\/?/, "");
      return PAGE_DEFS[h] ? h : null;
    },

    /* ------------------------------------------------------------------ 读取快照 */
    async load(opts) {
      opts = opts || {};
      const seq = ++this.seq;
      if (opts.initial) this.showBoot();
      this.state.loading = true;

      let data = null;
      let error = null;
      try {
        const params = new URLSearchParams({
          project: this.state.project || "",
          role: this.state.role || "dispatcher",
          scene: this.state.scene || "morning",
        });
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 3800);
        let res;
        try {
          res = await fetch("/api/bootstrap?" + params.toString(), {
            cache: "no-store",
            signal: ctl.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) throw new Error("服务返回 HTTP " + res.status);
        data = await res.json();
        if (!data || !data.snapshot) throw new Error("服务没有返回快照");
      } catch (err) {
        error = err;
      }

      if (seq !== this.seq) return;

      if (data) {
        this.state.online = true;
        this.state.snap = data.snapshot;
        this.state.projects = data.projects || (data.snapshot.archive && data.snapshot.archive.projects) || [];
      } else {
        const snap = this.offlineSnapshot();
        if (!snap) {
          this.fatal(error);
          return;
        }
        this.state.online = false;
        this.state.snap = snap;
        this.state.projects = (this.boot && this.boot.projects) ||
          (snap.archive && snap.archive.projects) || [];
      }

      this.afterLoad(opts, error);
    },

    afterLoad(opts, error) {
      const s = this.state.snap;
      const meta = s.meta || {};
      // 页面可见性以服务端 meta.pages 为准，同时并上前端口径：服务端未重启、
      // 仍加载旧配置时，“司机中枢”也不会从导航里消失。
      const roleId = (meta.role && meta.role.id) || this.state.role;
      const clientPages = PAGE_ACCESS[roleId] || PAGE_ACCESS.dispatcher;
      const pages = (meta.pages || []).slice();
      clientPages.forEach((p) => {
        if (PAGE_DEFS[p] && pages.indexOf(p) < 0) pages.push(p);
      });
      meta.pages = pages;
      const allowed = pages;

      this.state.project = (meta.project && meta.project.id) || this.state.project;
      this.state.role = (meta.role && meta.role.id) || this.state.role;
      this.state.scene = (meta.scene && meta.scene.id) || this.state.scene;

      let page = this.state.page;
      const sceneFocus = meta.scene && meta.scene.focus;
      if (opts.focus && sceneFocus) page = sceneFocus;
      if (opts.initial) {
        const hash = this.pageFromHash();
        if (hash) page = hash;
      }
      if (!page || allowed.indexOf(page) < 0) {
        page = meta.default_page || allowed[0] || "overview";
      }
      this.state.page = page;
      this.state.loading = false;
      this.ensureSelection();
      this.savePrefs();
      this.render({ top: true });
      this.hideBoot();
      this.setHash(page, true);

      if (!this.state.online && opts.initial) {
        this.toast("未连接服务，已加载离线快照。审批、任务与写回只保存在本机。", "warn", 5600);
      } else if (error && opts.initial) {
        this.toast("服务暂时不可用，已切换离线快照。", "warn", 4800);
      }
    },

    offlineSnapshot() {
      const project = this.state.project ||
        (this.boot && this.boot.default_project) ||
        (this.boot && this.boot.projects && this.boot.projects[0] && this.boot.projects[0].id) ||
        "jiuzhaigou";
      let raw = null;
      try {
        raw = U.readJSON(this.offlineKey(project, this.state.scene));
      } catch (e) {
        raw = null;
      }
      if (!raw && this.boot) {
        const set = this.boot.snapshots || {};
        raw = set[this.state.scene] || this.boot.snapshot || null;
        if (raw && raw.snapshot) raw = raw.snapshot;
      }
      if (!raw) return null;
      const snap = U.clone(raw);
      const projects = (this.boot && this.boot.projects) || (snap.archive && snap.archive.projects) || [];
      const p = projects.find((x) => x.id === project);
      if (p && snap.meta) {
        snap.meta.project = {
          id: p.id,
          name: p.name || p.id,
          demo: !!p.demo,
          note: p.note || "",
          saved: p.saved || "",
          date: snap.meta.date,
        };
      }
      if (!snap.archive) snap.archive = {};
      snap.archive.projects = projects;
      this.applyOfflineRole(snap);
      snap.meta.source = {
        mode: "offline",
        label: "离线快照",
        note: "demo_snapshot.js 离线数据；审批、任务、写回保存在本机",
      };
      snap.server = { now: U.isoNow(), time: "离线", api_version: 1 };
      return snap;
    },

    applyOfflineRole(snap) {
      const roles = snap.meta.roles || [];
      const role = roles.find((r) => r.id === this.state.role) ||
        roles.find((r) => r.id === "dispatcher") ||
        { id: "dispatcher", name: "调度员", desc: "演示角色", default_page: "overview" };
      let perms = role.perms;
      if (Array.isArray(perms)) {
        const tmp = {};
        perms.forEach((p) => { tmp[p] = true; });
        perms = tmp;
      }
      perms = Object.assign({}, ROLE_PERMS[role.id] || ROLE_PERMS.dispatcher, perms || {});
      const pages = PAGE_ACCESS[role.id] || PAGE_ACCESS.dispatcher;
      snap.meta.role = role;
      snap.meta.permissions = perms;
      snap.meta.pages = pages.filter((p) => PAGE_DEFS[p]);
      snap.meta.default_page = role.default_page || pages[0] || "overview";
      snap.meta.role_notice = "演示版权限为示意，不做登录";
      if (snap.desk) {
        snap.desk.role = role;
        snap.desk.permissions = perms;
      }
      if (snap.driver) {
        snap.driver.can_report = !!perms.report;
        snap.driver.can_dispatch = !!perms.dispatch;
      }
    },

    offlineKey(project, scene) {
      return "dispatchos.offline." + (project || "demo") + "." + (scene || "morning");
    },

    saveOffline(snap) {
      try {
        localStorage.setItem(this.offlineKey(this.state.project, this.state.scene), JSON.stringify(snap));
      } catch (e) {
        this.toast("本机存储已满，离线改动未能保留。", "warn");
      }
    },

    /* ------------------------------------------------------------------ 渲染 */
    render(opts) {
      opts = opts || {};
      const s = this.state.snap;
      if (!s) return;
      const meta = s.meta || {};
      const allowed = meta.pages || [];
      if (allowed.indexOf(this.state.page) < 0) {
        this.state.page = meta.default_page || allowed[0] || "overview";
      }
      const page = this.state.page;
      let inner = "";
      try {
        const fn = (DOS.pages && DOS.pages[page]) || (DOS.pages && DOS.pages.overview);
        inner = fn ? fn(this) : UI.empty("页面不存在", "这个页面还没有注册。");
      } catch (err) {
        console.error("[DispatchOS] page render failed", page, err);
        inner = '<div class="page"><div class="card"><div class="card-body">' +
          '<div class="eyebrow">RENDER ERROR</div><h2 class="page-title">页面渲染失败</h2>' +
          '<p class="page-desc">' + esc(err && err.message || String(err)) + "</p>" +
          '<button class="btn btn-primary mt-10" data-action="refresh">重新加载</button></div></div></div>';
      }
      $("#app").innerHTML = this.shell(inner);
      this.state.navOpen = false;
      document.title = (PAGE_DEFS[page] ? PAGE_DEFS[page].name : "调度台") + " · " + (meta.app || "景枢 DispatchOS");
      this.syncDirtyUI();
      if (page === "guest") { const scan = $("[data-checkin-code]"); if (scan) scan.focus(); }
      if (opts.top) window.scrollTo(0, 0);
      this.hideBoot();
    },

    shell(inner) {
      const s = this.state.snap;
      const meta = s.meta || {};
      const role = meta.role || {};
      const page = this.state.page;
      const allowed = meta.pages || [];
      const project = meta.project || {};
      const projects = this.state.projects || [];
      const scene = meta.scene || {};
      const p = s.params || {};
      const counts = p.counts || {};
      const p0 = Number(p.p0_filled || 0);
      const p0Total = Number(p.p0_total || 16);
      const completeness = Math.round(Number(p.completeness || 0) * 100);

      const nav = PAGE_GROUPS.map((g) => {
        const items = g.pages.filter((x) => allowed.indexOf(x) >= 0);
        if (!items.length) return "";
        return '<div class="nav-group"><div class="nav-group-title">' + esc(g.title) + "</div>" +
          items.map((id) => {
            const def = PAGE_DEFS[id];
            const n = this.navCount(id);
            return '<button type="button" class="nav-item ' + (page === id ? "is-active" : "") +
              '" data-nav="' + id + '"><span class="nav-icon">' + I.icon(def.icon) + "</span>" +
              '<span class="nav-label">' + esc(def.name) + "</span>" +
              (n ? '<span class="nav-count">' + n + "</span>" : "") + "</button>";
          }).join("") + "</div>";
      }).join("");

      const projectOptions = (projects.length ? projects : [project]).map((x) =>
        '<option value="' + esc(x.id) + '"' + (x.id === project.id ? " selected" : "") + ">" +
        esc(x.name || x.id) + (x.demo ? " · 演示" : "") + "</option>").join("");
      const roleOptions = (meta.roles || []).map((r) =>
        '<option value="' + esc(r.id) + '"' + (r.id === role.id ? " selected" : "") + ">" +
        esc(r.name) + "</option>").join("");

      return '<div class="shell">' +
        '<div class="scrim" data-action="close-nav"></div>' +
        '<aside class="sidebar" id="sidebar"><div class="sidebar-inner">' +
          '<div class="brand"><div class="brand-mark">景</div><div class="brand-text"><div class="brand-name">九寨景枢</div>' +
            '<div class="brand-sub">DISPATCH<b>OS</b></div></div></div>' +
          '<button type="button" class="project-mini" data-nav="scenic">' +
            '<div class="project-mini-top"><span class="project-mini-name">' + esc(project.name || "选择景区") + "</span>" +
              (project.demo ? '<span class="tag tag--red tag--mark">演示†</span>' : "") + "</div>" +
            '<div class="project-mini-meta">' + p0 + "/" + p0Total + " P0 · 完整度 " + completeness + '%</div>' +
            '<div class="project-mini-bar"><i style="width:' + Math.max(2, completeness) + '%"></i></div>' +
          "</button>" +
          '<div class="nav">' + nav + "</div>" +
          '<div class="sidebar-foot">' +
            '<div class="role-card"><div class="role-avatar">' + esc((role.name || "调").slice(0, 1)) + "</div>" +
              '<div class="role-card-main"><b>' + esc(role.name || "调度员") + "</b><small>" + esc(role.desc || "演示角色") + "</small></div>" +
              '<span class="role-lock">' + I.icon(role.id === "driver" ? "phone" : "shield") + "</span></div>" +
            '<div class="source-note"><i class="dot ' + (this.state.online ? "dot--ok" : "dot--warn") + '"></i><span>' +
              esc(meta.source && meta.source.note || "在线引擎") + "</span></div>" +
            '<div class="version-line">v' + esc(meta.version || "1.0.0") + " · API " + esc(meta.api_version || 1) +
              " · 演示日期 " + esc(meta.date || "") + "</div>" +
          "</div>" +
        "</div></aside>" +
        '<main class="main">' +
          '<header class="topbar"><div class="topbar-left">' +
            '<button type="button" class="icon-btn mobile-menu" data-action="toggle-nav" aria-label="菜单">' + I.icon("menu") + "</button>" +
            '<div class="crumb"><span class="crumb-project">' + esc(project.name || "") + '</span><span class="crumb-sep">/</span>' +
              '<span class="crumb-page">' + esc(PAGE_DEFS[page] ? PAGE_DEFS[page].name : "") + '</span><span class="crumb-sep">/</span>' +
              '<span class="crumb-date">' + esc(meta.date || "") + " · " + esc(meta.scene && meta.scene.time || "") + "</span></div>" +
          "</div>" +
          '<div class="top-actions">' +


            '<label class="select-wrap" title="切换景区">' + I.icon("archive") +
              '<select class="select select-project" data-select="project" aria-label="切换景区">' + projectOptions + "</select></label>" +
            '<label class="select-wrap select-role-wrap" title="切换角色">' + I.icon("user") +
              '<select class="select select-role" data-select="role" aria-label="切换角色">' + roleOptions + "</select></label>" +
            '<details class="menu"><summary class="btn btn-sm">' + I.icon("export") + '<span class="mobile-hide">导出</span></summary>' +
              '<div class="menu-pop">' +
                '<button type="button" data-action="export-report">运行快报 · Markdown</button>' +
                '<button type="button" data-action="export-snapshot">当前快照 · JSON</button>' +
                '<button type="button" data-action="export-params">项目参数 · JSON</button>' +
              "</div></details>" +
            '<details class="menu"><summary class="icon-btn" title="更多">' + I.icon("menu") + "</summary>" +
              '<div class="menu-pop">' +
                '<button type="button" data-action="about">关于与演示边界</button>' +
                '<button type="button" data-action="mode">调度模式库</button>' +
                '<button type="button" data-action="badcases">失效场景库 · 11</button>' +
                '<button type="button" data-action="reset">重置演示运行时</button>' +
              "</div></details>" +
          "</div></header>" +
          '<div class="content">' + inner + "</div>" +
        "</main></div>";
    },

    navCount(id) {
      const s = this.state.snap;
      if (!s) return 0;
      if (id === "desk") return Number(s.summary && s.summary.pending || 0);
      if (id === "driver") return ((s.driver && s.driver.tasks) || []).filter((t) => ["dispatched", "accepted"].indexOf(t.status) >= 0).length;
      if (id === "params") return Number(s.params && s.params.counts && (s.params.counts.missing || 0) + (s.params.counts.suspect || 0) || 0);
      return 0;
    },

    /* ------------------------------------------------------------------ 工作台 */
    valueOf(field) {
      if (Object.prototype.hasOwnProperty.call(this.state.dirty, field.key)) return this.state.dirty[field.key];
      return field.value;
    },

    filteredFields() {
      const p = this.state.snap.params || {};
      const fields = p.fields || [];
      const group = this.state.params.group || "all";
      const flag = this.state.params.flag || "all";
      const q = String(this.state.params.q || "").trim().toLowerCase();
      return fields.filter((f) => {
        if (group !== "all" && f.group !== group) return false;
        if (flag === "missing" && f.status !== "missing") return false;
        if (flag === "assumed" && f.status !== "assumed") return false;
        if (flag === "suspect" && f.status !== "suspect") return false;
        if (flag === "p0" && f.prio !== "P0") return false;
        if (q) {
          const hay = [f.label, f.key, f.help, f.impact, f.source, f.assumption && f.assumption.why]
            .filter(Boolean).join(" ").toLowerCase();
          if (hay.indexOf(q) < 0) return false;
        }
        return true;
      });
    },

    paramsListHtml() {
      const p = this.state.snap.params || {};
      const fields = this.filteredFields();
      const groups = p.groups || [];
      const selected = this.state.params.group || "all";
      const groupDefs = selected === "all" ? groups : groups.filter((g) => g.id === selected);
      let out = "";
      groupDefs.forEach((g) => {
        const list = fields.filter((f) => f.group === g.id);
        if (!list.length) return;
        const pct = Math.round(Number(g.completeness || 0) * 100);
        out += '<section class="param-group"><div class="param-group-head">' +
          '<div class="param-group-letter">' + esc(g.id) + "</div>" +
          '<div class="param-group-main"><div class="param-group-name">' + esc(g.name) + "</div>" +
            '<div class="param-group-desc">' + esc(g.desc || "") + "</div></div>" +
          '<div class="param-group-count">' + Number(g.filled || 0) + "/" + Number(g.total || 0) + "</div>" +
          '<div class="param-group-meter"><i style="width:' + Math.max(2, pct) + '%"></i></div></div>' +
          '<div class="param-list">' + list.map((f) => this.paramRow(f)).join("") + "</div></section>";
      });
      if (!out) {
        out = UI.empty("没有匹配的参数", "换一个分组、状态或搜索词。", "search");
      }
      return out;
    },

    paramRow(f) {
      const value = this.valueOf(f);
      const dirty = Object.prototype.hasOwnProperty.call(this.state.dirty, f.key);
      const status = f.status || "filled";
      const evidence = f.evidence ? UI.evidence(this.state.snap.meta, f.evidence) : "";
      const p0 = f.prio === "P0" ? '<span class="tag tag-p0">P0</span>' : '<span class="tag tag-p1">P1</span>';
      const meta = [];
      meta.push(UI.statusTag(status, f.status_label || (status === "filled" ? "已填" : status)));
      if (f.source) meta.push('<span class="param-source" title="来源">' + esc(f.source) + "</span>");
      if (f.conf) meta.push('<span class="param-conf">置信度 ' + esc(f.conf) + "</span>");
      if (f.default_display !== undefined && status === "assumed") meta.push('<span class="param-source">默认 ' + esc(f.default_display) + "</span>");

      return '<div class="param-row ' + (status === "missing" ? "is-missing " : status === "assumed" ? "is-assumed " : status === "suspect" ? "is-suspect" : "") +
        '" data-param-row="' + esc(f.key) + '">' +
        '<div class="param-info"><div class="param-name-line"><span class="param-name">' + esc(f.label) + "</span>" + p0 + evidence + "</div>" +
          '<div class="param-key">' + esc(f.key) + (f.unit ? " · " + esc(f.unit) : "") + "</div>" +
          '<div class="param-help">' + esc(f.help || "") + "</div>" +
          (f.impact ? '<div class="param-impact"><b>影响</b> ' + esc(f.impact) + "</div>" : "") +
          (f.assumption ? '<div class="param-impact" style="color:var(--ochre)"><b>假设†</b> ' + esc(f.assumption.value) + " — " + esc(f.assumption.why || "") + "</div>" : "") +
          (f.issue ? '<div class="param-impact" style="color:var(--brick)"><b>可疑</b> ' + esc(f.issue.msg || f.issue) + "</div>" : "") +
        "</div>" +
        '<div class="param-control">' + this.paramControl(f, value, dirty) + "</div>" +
        '<div class="param-meta">' + meta.join("") + "</div>" +
      "</div>";
    },

    paramControl(f, value, dirty) {
      const disabled = this.can("edit_params") ? "" : " disabled";
      const cls = "input" + (dirty ? " is-dirty" : "");
      const key = esc(f.key);
      const common = ' data-param-key="' + key + '" data-param-type="' + esc(f.type) + '"' + disabled;
      if (f.type === "num") {
        return '<div class="input-wrap"><input class="' + cls + (f.unit ? " has-unit" : "") + '" type="number" step="any" value="' +
          esc(value === null || value === undefined ? "" : value) + '"' + common + ">" +
          (f.unit ? '<span class="input-unit">' + esc(f.unit) + "</span>" : "") + "</div>";
      }
      if (f.type === "multi") {
        const arr = Array.isArray(value) ? value : (value ? String(value).split(/[,，]/) : []);
        return '<div class="check-grid" data-param-multi="' + key + '">' +
          (f.options || []).map((o) => {
            const v = Array.isArray(o) ? o[0] : o.value;
            const l = Array.isArray(o) ? o[1] : o.label;
            return '<label class="check-item"><input type="checkbox" value="' + esc(v) + '"' + common +
              (arr.map(String).indexOf(String(v)) >= 0 ? " checked" : "") + "><span>" + esc(l) + "</span></label>";
          }).join("") + "</div>";
      }
      if (f.type === "bool") {
        const on = U.truthy(value);
        return '<label class="switch"><input type="checkbox"' + common + (on ? " checked" : "") +
          '><span class="switch-track"></span><span>' + (on ? "是" : "否") + "</span></label>";
      }
      if (f.type === "select") {
        const opts = f.options || [];
        return '<select class="' + cls + ' select-input"' + common + '><option value="">未填</option>' +
          opts.map((o) => {
            const v = Array.isArray(o) ? o[0] : o.value;
            const l = Array.isArray(o) ? o[1] : o.label;
            return '<option value="' + esc(v) + '"' + (String(value) === String(v) ? " selected" : "") + ">" + esc(l) + "</option>";
          }).join("") + "</select>";
      }
      if (f.key === "a_profile" || String(f.help || "").length > 64) {
        return '<textarea class="' + cls + ' textarea"' + common + ">" + esc(value === null || value === undefined ? "" : value) + "</textarea>";
      }
      return '<input class="' + cls + '" type="text" value="' + esc(value === null || value === undefined ? "" : value) + '"' + common + ">";
    },

    captureParam(target) {
      const key = target.getAttribute("data-param-key");
      if (!key) return;
      const type = target.getAttribute("data-param-type");
      let value;
      if (type === "multi") {
        const box = target.closest("[data-param-multi]") || target.closest(".param-row");
        value = box ? Array.from(box.querySelectorAll('input[type="checkbox"][data-param-key]'))
          .filter((x) => x.checked).map((x) => x.value) : [];
      } else if (type === "bool") {
        value = !!target.checked;
      } else {
        value = target.value;
      }
      this.state.dirty[key] = value;
      const control = target.closest(".param-control");
      if (control) control.classList.add("has-dirty");
      if (target.classList.contains("input")) target.classList.add("is-dirty");
      this.syncDirtyUI();
    },

    refreshParamList() {
      const root = $("#param-list-root");
      if (root) root.innerHTML = this.paramsListHtml();
      this.syncDirtyUI();
    },

    syncDirtyUI() {
      const n = Object.keys(this.state.dirty).length;
      $$("[data-dirty-count]").forEach((el) => {
        const b = el.querySelector("b");
        if (b) b.textContent = String(n);
        else el.textContent = String(n);
      });
      const can = this.can("edit_params");
      $$("[data-save-params]").forEach((b) => { b.disabled = !can || !n; });
    },

    async saveParams() {
      if (!this.state.online) {
        this.toast("离线快照不能保存参数。启动 `python app.py` 后重试。", "warn");
        return;
      }
      const keys = Object.keys(this.state.dirty);
      if (!keys.length) {
        this.toast("没有待保存的修改。", "info");
        return;
      }
      const params = {};
      keys.forEach((k) => { params[k] = this.state.dirty[k]; });
      try {
        const data = await this.request("/api/params", this.apiBody({
          name: this.state.snap.meta.project.name,
          params: params,
        }));
        this.state.dirty = {};
        this.applyResult(data, "参数已保存，结论已按新参数重算。");
      } catch (err) {
        this.toast(err.message || "保存失败", "error");
      }
    },

    /* ------------------------------------------------------------------ 审批 / 任务 / 计划 / 复盘 */
    selectedCard() {
      const cards = (this.state.snap.desk && this.state.snap.desk.cards) || [];
      return cards.find((c) => c.id === this.state.selectedCardId) || cards[0] || null;
    },

    cardCandidate(card) {
      if (!card) return null;
      const id = this.state.candidate[card.id] || card.selected || card.recommended ||
        (card.candidates && card.candidates[0] && card.candidates[0].id);
      return (card.candidates || []).find((x) => x.id === id) || (card.candidates || [])[0] || null;
    },

    ensureSelection() {
      const cards = (this.state.snap.desk && this.state.snap.desk.cards) || [];
      if (!cards.length) {
        this.state.selectedCardId = null;
        return;
      }
      if (!cards.some((c) => c.id === this.state.selectedCardId)) {
        const pending = cards.find((c) => c.state === "pending");
        this.state.selectedCardId = (pending || cards[0]).id;
      }
    },

    async decide(action, reason) {
      const card = this.selectedCard();
      if (!card) return;
      const cand = this.cardCandidate(card);
      if (!cand) {
        this.toast("这张卡没有可执行候选，不能审批。", "warn");
        return;
      }
      if (action === "reject" && !String(reason || "").trim()) {
        this.toast("拒绝必须写理由。", "warn");
        return;
      }
      if (!this.state.online) {
        this.localDecision(action, reason, card, cand);
        return;
      }
      try {
        const data = await this.request("/api/decision", this.apiBody({
          card_id: card.id,
          action: action,
          candidate: cand.id,
          reason: reason || "",
        }));
        this.state.rejecting = null;
        this.applyResult(data, data.message || "审批已记录。");
      } catch (err) {
        this.toast(err.message || "审批失败", "error");
      }
    },

    localDecision(action, reason, card, cand) {
      const s = this.state.snap;
      const at = U.isoNow();
      const actor = s.meta.role.name;
      const oldState = card.state;
      if (action === "reject") {
        card.state = "rejected";
        card.state_label = "已拒绝";
        card.reject_reason = reason;
      } else if (action === "approve" || action === "approve_dispatch") {
        card.state = action === "approve" ? "approved" : "dispatched";
        card.state_label = action === "approve" ? "已批准·待下发" : "已下发·待接单";
        if (action === "approve_dispatch") {
          const tasks = this.makeLocalTasks(card, cand, at);
          this.attachTasks(card, tasks);
          s.driver.tasks = tasks.concat(s.driver.tasks || []);
        }
      } else if (action === "dispatch") {
        if (oldState !== "approved") {
          this.toast("只有“已批准”的卡可以下发。", "warn");
          return;
        }
        card.state = "dispatched";
        card.state_label = "已下发·待接单";
        const tasks = this.makeLocalTasks(card, cand, at);
        this.attachTasks(card, tasks);
        s.driver.tasks = tasks.concat(s.driver.tasks || []);
      } else {
        return;
      }
      card.selected = cand.id;
      card.decision = cand.name;
      card.decided_by = actor;
      card.decided_at = at;
      card.permissions = { approve: false, reject: false, dispatch: false, report: false };
      const entry = {
        id: "A-" + Math.random().toString(16).slice(2, 10).toUpperCase(),
        at: at, project: s.meta.project.id, actor: actor, role: s.meta.role.id,
        action: action, card_id: card.id, candidate: cand.name, reason: reason || "",
      };
      card.history = [entry].concat(card.history || []);
      s.desk.audit = [entry].concat(s.desk.audit || []);
      this.state.rejecting = null;
      this.updateCounts();
      this.saveOffline(s);
      this.render({ top: false });
      this.toast(action === "reject" ? "已拒绝并留痕。" : action === "approve" ? "已批准，等待下发。" : "已下发任务单。", "ok");
    },

    makeLocalTasks(card, cand, at) {
      const s = this.state.snap;
      const effect = cand.effect || {};
      const count = Math.max(1, Math.min(3, Math.ceil(Number(effect.vehicles || 0) / 4) || 1));
      const base = card.kind === "emergency" ? "RAIN" : "PEAK";
      const date = String(s.meta.date || "").replace(/-/g, "");
      const routes = ["沟口 → 长海", "沟口 → 诺日朗", "诺日朗 → 沟口", "沟口 → 五花海"];
      return Array.from({ length: count }, (_, i) => {
        const f = LOCAL_FLEET[i % LOCAL_FLEET.length];
        return {
          id: "T-" + date + "-" + base + String(i + 1).padStart(2, "0"),
          project: s.meta.project.id,
          card_id: card.id,
          title: (card.short || card.title) + " · " + cand.name,
          vehicle: f.vehicle,
          plate: f.plate,
          driver: f.driver,
          phone: f.phone,
          route: routes[i % routes.length],
          depart: U.addMinutes(s.meta.scene && s.meta.scene.time || "07:40", 12 + i * 8),
          change_note: cand.summary,
          status: "dispatched",
          created_at: at,
          reports: [],
          receipt: "",
          demo: true,
        };
      });
    },

    attachTasks(card, tasks) {
      card.tasks = tasks;
      card.task = tasks[0] || null;
    },

    async acceptTask(taskId) {
      if (!this.state.online) {
        this.localTask(taskId, "accept", null);
        return;
      }
      try {
        const data = await this.request("/api/task", this.apiBody({ task_id: taskId, action: "accept" }));
        this.applyResult(data, "已接单。");
      } catch (err) {
        this.toast(err.message || "接单失败", "error");
      }
    },

    async reportTask(taskId, report) {
      if (!this.state.online) {
        this.localTask(taskId, "report", report);
        this.closeModal();
        return;
      }
      try {
        const data = await this.request("/api/task", this.apiBody({
          task_id: taskId,
          action: "report",
          report: report,
        }));
        this.closeModal();
        this.applyResult(data, "报数已回传，回执已生成。");
      } catch (err) {
        this.toast(err.message || "报数失败", "error");
      }
    },

    localTask(taskId, action, report) {
      const s = this.state.snap;
      const task = (s.driver.tasks || []).find((t) => t.id === taskId);
      if (!task) {
        this.toast("找不到任务单。", "error");
        return;
      }
      const at = U.isoNow();
      if (action === "accept") {
        task.status = "accepted";
        task.accepted_at = at;
      } else {
        task.status = "reported";
        task.receipt = "R-" + Math.random().toString(16).slice(2, 6).toUpperCase();
        task.reports = (task.reports || []).concat([{
          action: report.action, label: (DOS.pageMeta.REPORT_LABEL || {})[report.action] || report.action,
          queue: Number(report.queue || 0), note: report.note || "", at: at,
        }]);
        if (s.driver.station) {
          s.driver.station.queue = Number(report.queue || 0);
          s.driver.station.reports = [{
            station: s.driver.station.name, queue: Number(report.queue || 0),
            action: report.action, label: (DOS.pageMeta.REPORT_LABEL || {})[report.action] || report.action,
            at: at, note: report.note || "",
          }].concat(s.driver.station.reports || []);
        }
      }
      const card = (s.desk.cards || []).find((c) => c.id === task.card_id);
      if (card) {
        const related = (s.driver.tasks || []).filter((t) => t.card_id === card.id);
        card.tasks = related;
        card.task = related[0] || null;
        const reported = related.filter((t) => t.status === "reported").length;
        if (reported === related.length && reported > 0) {
          card.state = "reported";
          card.state_label = "已回执";
        } else if (reported > 0) {
          card.state = "accepted";
          card.state_label = "执行中·部分回执";
        } else if (related.some((t) => t.status === "accepted")) {
          card.state = "accepted";
          card.state_label = "已接单";
        }
        const entry = {
          id: "A-" + Math.random().toString(16).slice(2, 10).toUpperCase(), at: at,
          project: s.meta.project.id, actor: s.meta.role.name, role: s.meta.role.id,
          action: action === "accept" ? "task_accept" : "task_report", card_id: card.id,
          task_id: task.id, report: report ? report.action : "",
        };
        card.history = [entry].concat(card.history || []);
        s.desk.audit = [entry].concat(s.desk.audit || []);
      }
      this.updateCounts();
      this.saveOffline(s);
      this.render({ top: false });
      this.toast(action === "accept" ? "已接单。" : "报数已回传，回执 " + task.receipt + "。", "ok");
    },

    async planSet(slot, veh, locked) {
      const n = Math.max(1, Math.min(999, Math.floor(Number(veh) || 1)));
      if (!this.state.online) {
        this.localPlan(slot, n, locked);
        return;
      }
      try {
        const data = await this.request("/api/plan", this.apiBody({ slot: slot, veh: n, locked: !!locked }));
        this.applyResult(data, "班次已更新。");
      } catch (err) {
        this.toast(err.message || "班次更新失败", "error");
      }
    },

    async optimizePlan() {
      if (!this.state.online) {
        this.state.optimizerResult = {
          status: "unavailable",
          message: "当前为离线快照，不能运行 OR-Tools 求解；启动在线服务并安装求解依赖后再试。",
          rows: [], assumptions: [], input_fingerprint: "", objective: {},
        };
        this.render({ top: false });
        return;
      }
      try {
        const data = await this.request("/api/plan/optimize", this.apiBody({}));
        this.state.optimizerResult = data.recommendation;
        this.render({ top: false });
        this.toast(data.recommendation.message || "优化建议已生成。",
          data.recommendation.status === "feasible" ? "ok" : "warn");
      } catch (err) { this.toast(err.message || "优化失败", "error"); }
    },

    async applyOptimizedPlan() {
      const result = this.state.optimizerResult;
      if (!result || result.status !== "feasible") return;
      if (!window.confirm("确认将优化建议写入运行计划？此操作不会下发车辆，仍需后续审批。")) return;
      try {
        const data = await this.request("/api/plan/optimize/apply", this.apiBody({
          input_fingerprint: result.input_fingerprint, rows: result.rows,
        }));
        this.state.optimizerResult = null;
        this.applyResult(data, data.message || "优化建议已应用。重新生成计划后可继续审批。");
      } catch (err) { this.toast(err.message || "应用优化建议失败", "error"); }
    },

    localPlan(slot, veh, locked) {
      const s = this.state.snap;
      const row = ((s.plan && s.plan.rows) || []).find((r) => r.slot === slot);
      if (!row) return;
      const sum = s.plan.summary || {};
      const n = Math.max(1, Math.min(999, Math.floor(Number(veh) || 1)));
      row.veh = n;
      row.edited = true;
      row.locked = !!locked;
      row.capacity = Math.round(n * Number(sum.cap_unit || 0));
      row.headway = n ? Number(sum.cycle || 0) / n : 0;
      row.util = row.capacity ? Number(row.flow) / row.capacity : 1;
      row.margin = (1 - row.util) * 100;
      row.gap = row.capacity - Number(row.flow);
      row.over = row.gap < 0;
      row.status = row.over ? "red" : row.margin < 15 ? "warn" : "ok";
      sum.locked = (s.plan.rows || []).filter((r) => r.locked).length;
      sum.edited = (s.plan.rows || []).filter((r) => r.edited).length;
      this.saveOffline(s);
      this.render({ top: false });
      this.toast("本时段班次已更新（离线）。", "ok");
    },

    async writeback(key) {
      if (!this.state.online) {
        this.localReview(key);
        return;
      }
      try {
        const data = await this.request("/api/review", this.apiBody({ key: key }));
        this.applyResult(data, "已写回参数，并追加审计。");
      } catch (err) {
        this.toast(err.message || "写回失败", "error");
      }
    },

    localReview(key) {
      const s = this.state.snap;
      const wb = ((s.review && s.review.writebacks) || []).find((w) => w.key === key);
      if (!wb) return;
      if (wb.applied) {
        this.toast("这项已经写回过了。", "info");
        return;
      }
      wb.applied = true;
      wb.applied_at = U.isoNow();
      s.review.writeback_count = Number(s.review.writeback_count || 0) + 1;
      const field = (s.params.fields || []).find((f) => f.key === wb.key);
      if (field) {
        field.value = wb.new;
        field.display = String(wb.new);
        field.empty = false;
        field.status = "filled";
        field.status_label = "已填";
      }
      s.desk.audit = [{
        id: "A-" + Math.random().toString(16).slice(2, 10).toUpperCase(), at: wb.applied_at,
        project: s.meta.project.id, actor: s.meta.role.name, role: s.meta.role.id,
        action: "writeback", key: wb.key, value: wb.new,
      }].concat(s.desk.audit || []);
      this.saveOffline(s);
      this.render({ top: false });
      this.toast("已写回 " + wb.label + "（离线）。", "ok");
    },

    updateCounts() {
      const s = this.state.snap;
      const cards = (s.desk && s.desk.cards) || [];
      const counts = {};
      cards.forEach((c) => { counts[c.state] = (counts[c.state] || 0) + 1; });
      if (s.desk) {
        s.desk.counts = Object.assign({}, s.desk.counts, counts, { total: cards.length, pending: counts.pending || 0 });
      }
      if (s.summary) s.summary.pending = counts.pending || 0;
      if (s.driver) {
        const tasks = s.driver.tasks || [];
        s.driver.counts = {
          total: tasks.length,
          dispatched: tasks.filter((t) => t.status === "dispatched").length,
          accepted: tasks.filter((t) => t.status === "accepted").length,
          reported: tasks.filter((t) => t.status === "reported").length,
        };
      }
      if (s.runtime) s.runtime.task_count = ((s.driver && s.driver.tasks) || []).length;
    },

    applyResult(data, message) {
      if (data && data.snapshot) {
        this.state.snap = data.snapshot;
        this.state.projects = data.projects || this.state.projects;
        this.ensureSelection();
        this.savePrefs();
        this.render({ top: false });
      }
      if (message || (data && data.message)) this.toast(message || data.message, "ok");
    },

    /* ------------------------------------------------------------------ 项目 / 角色 / 场景 */
    openCreateModal() {
      if (!this.state.online) {
        this.toast("离线模式不能新建景区。启动服务后再试。", "warn");
        return;
      }
      const body = '<form data-form="create-project">' +
        '<div class="form-row"><label class="form-label">景区名称 *</label>' +
          '<input class="form-input" name="name" required placeholder="例如：黄龙风景区"></div>' +
        '<div class="form-row"><label class="form-label">项目 ID（可选）</label>' +
          '<input class="form-input" name="id" placeholder="huanglong" pattern="[A-Za-z0-9_-]{1,64}">' +
          '<div class="form-help">用于文件名与 URL，留空自动生成。</div></div>' +
        '<div class="form-row"><label class="form-label">一句话说明</label>' +
          '<input class="form-input" name="note" placeholder="例如：高原彩池景区，团队客为主"></div>' +
        '<div class="modal-foot"><button type="button" class="btn btn-ghost" data-close-modal="1">取消</button>' +
          '<button type="submit" class="btn btn-primary">创建并进入</button></div></form>';
      this.openModal({ title: "新建景区", sub: "建议先用 16 项 P0 跑通，再补 P1。", body: body, wide: false });
    },

    async submitCreate(form) {
      const fd = new FormData(form);
      const name = String(fd.get("name") || "").trim();
      const id = String(fd.get("id") || "").trim();
      const note = String(fd.get("note") || "").trim();
      if (!name) {
        this.toast("景区名称不能为空。", "warn");
        return;
      }
      const before = (this.state.projects || []).map((p) => p.id);
      try {
        const data = await this.request("/api/projects", this.apiBody({ action: "create", name: name, id: id, note: note }));
        this.closeModal();
        const list = data.projects || [];
        const added = list.find((p) => before.indexOf(p.id) < 0) ||
          (data.snapshot && data.snapshot.meta.project) || null;
        const newId = (added && added.id) || (data.project && data.project.id) || data.project_id || id;
        if (newId) {
          await this.switchProject(newId);
        } else {
          await this.load({});
        }
        this.toast("景区已创建。", "ok");
      } catch (err) {
        this.toast(err.message || "创建失败", "error");
      }
    },

    async duplicateProject(id) {
      if (!this.state.online) {
        this.toast("离线模式不能复制景区。", "warn");
        return;
      }
      if (!id) return;
      const before = (this.state.projects || []).map((p) => p.id);
      try {
        const data = await this.request("/api/projects", this.apiBody({
          action: "duplicate", source_id: id, project_id: id,
        }));
        const list = data.projects || [];
        this.state.projects = list;
        const added = list.find((p) => before.indexOf(p.id) < 0);
        if (added) await this.switchProject(added.id);
        else this.render({ top: false });
        this.toast("景区已复制。", "ok");
      } catch (err) {
        this.toast(err.message || "复制失败", "error");
      }
    },

    openDeleteModal(id) {
      if (!this.state.online) {
        this.toast("离线模式不能删除景区。", "warn");
        return;
      }
      const p = (this.state.projects || []).find((x) => x.id === id);
      if (!p) return;
      if ((this.state.projects || []).length <= 1) {
        this.toast("至少保留一个景区项目。", "warn");
        return;
      }
      const body = '<div class="desk-note" style="border-color:rgba(171,64,48,.3)">' +
        "将删除 <b>" + esc(p.name) + "</b>（" + esc(p.id) + "）及其运行时数据。该动作不可撤销，但不会删除审计日志。</div>" +
        '<form data-form="delete-project" data-project="' + esc(id) + '"><div class="modal-foot">' +
        '<button type="button" class="btn btn-ghost" data-close-modal="1">取消</button>' +
        '<button type="submit" class="btn btn-danger">确认删除</button></div></form>';
      this.openModal({ title: "删除景区", sub: "只保留一个项目时不允许删除。", body: body });
    },

    async submitDelete(form) {
      const id = form.getAttribute("data-project");
      try {
        const data = await this.request("/api/projects", this.apiBody({
          action: "delete", project_id: id, id: id,
        }));
        this.closeModal();
        this.state.projects = data.projects || this.state.projects.filter((p) => p.id !== id);
        if (this.state.project === id) {
          this.state.project = (this.state.projects[0] && this.state.projects[0].id) || null;
          this.state.page = "scenic";
          await this.load({});
        } else {
          this.render({ top: false });
        }
        this.toast("景区已删除。", "ok");
      } catch (err) {
        this.toast(err.message || "删除失败", "error");
      }
    },

    async switchProject(id) {
      if (!id || id === this.state.project) return;
      if (!this.confirmDiscard()) return;
      this.state.project = id;
      this.state.dirty = {};
      this.state.page = this.state.page || "scenic";
      await this.load({});
    },

    async switchRole(id, opts) {
      opts = opts || {};
      if (!id || id === this.state.role) return;
      if (!this.confirmDiscard()) return;
      this.state.role = id;
      this.state.dirty = {};
      if (!opts.keepPage) this.state.page = null;
      U.writeJSON(PREFS.role, id);
      await this.load({});
      if (opts.keepPage) this.state.page = opts.page || "desk";
      const role = ((this.state.snap.meta.roles || []).find((r) => r.id === id) || {});
      this.toast("已切换为 " + (role.name || id) + "（权限为示意）。", "info");
    },

    async switchScene(id) {
      if (!id || id === this.state.scene) return;
      if (!this.confirmDiscard()) return;
      this.state.scene = id;
      this.state.page = null;
      this.state.dirty = {};
      U.writeJSON(PREFS.scene, id);
      await this.load({ focus: true });
      const sc = (this.state.snap.meta.scenes || []).find((x) => x.id === id) || {};
      this.toast("已切到第 " + (sc.act || 1) + " 幕 · " + (sc.label || id) + "。", "info");
    },

    confirmDiscard() {
      if (!Object.keys(this.state.dirty).length) return true;
      if (!window.confirm("工作台还有未保存修改，继续后将恢复为当前已保存值。确定？")) return false;
      this.state.dirty = {};
      this.refreshParamList();
      return true;
    },

    go(page) {
      if (!page || !PAGE_DEFS[page]) return;
      const allowed = this.state.snap.meta.pages || [];
      if (allowed.indexOf(page) < 0) {
        this.toast("当前角色没有这个页面的访问权。", "warn");
        return;
      }
      if (page !== "params" && !this.confirmDiscard()) return;
      if (page === this.state.page) {
        this.closeNav();
        return;
      }
      this.state.page = page;
      this.state.navOpen = false;
      U.writeJSON(PREFS.page, page);
      this.setHash(page, true);
      this.render({ top: true });
    },

    setHash(page, replace) {
      const h = "#" + page;
      if (location.hash === h) return;
      try {
        if (replace) history.replaceState(null, "", h);
        else location.hash = h;
      } catch (e) {
        /* file:// 下 history 可能不可用，忽略 */
      }
    },

    savePrefs() {
      U.writeJSON(PREFS.role, this.state.role);
      U.writeJSON(PREFS.project, this.state.project);
      U.writeJSON(PREFS.scene, this.state.scene);
      if (this.state.page) U.writeJSON(PREFS.page, this.state.page);
    },

    /* ------------------------------------------------------------------ 导出 / 弹窗 / Toast */
    exportFile(kind) {
      if (this.state.online) {
        const map = { report: "/api/export/report", snapshot: "/api/export/snapshot", params: "/api/export/params" };
        const url = map[kind] + "?project=" + encodeURIComponent(this.state.project || "");
        window.location.href = url;
        return;
      }
      if (kind === "report") {
        U.download("dispatchos-report-" + this.state.project + "-" + this.state.scene + ".md", this.buildReport(), "text/markdown;charset=utf-8");
      } else if (kind === "snapshot") {
        U.download("dispatchos-snapshot-" + this.state.project + "-" + this.state.scene + ".json",
          JSON.stringify(this.state.snap, null, 2), "application/json;charset=utf-8");
      } else {
        const params = {};
        ((this.state.snap.params && this.state.snap.params.fields) || []).forEach((f) => { params[f.key] = f.value; });
        U.download("dispatchos-params-" + this.state.project + ".json",
          JSON.stringify(params, null, 2), "application/json;charset=utf-8");
      }
      this.toast("离线导出已生成。", "ok");
    },

    buildReport() {
      const s = this.state.snap;
      const o = s.overview || {};
      const lines = [];
      lines.push("# 景枢 DispatchOS · 运行快报");
      lines.push("");
      lines.push("- 景区：" + (s.meta.project.name || "") + "（" + s.meta.project.id + "）");
      lines.push("- 场景：" + (s.meta.scene.label || "") + " " + (s.meta.scene.time || ""));
      lines.push("- 角色：" + s.meta.role.name);
      lines.push("- 生成：" + s.meta.built_at);
      lines.push("");
      lines.push("## 结论");
      lines.push("");
      lines.push(s.summary.headline || "");
      lines.push("");
      (o.kpis || []).forEach((k) => { lines.push("- " + k.label + "：" + k.display + (k.unit || "") + "（" + (k.hint || "") + "）"); });
      lines.push("");
      lines.push("## 建议卡");
      lines.push("");
      ((s.desk && s.desk.cards) || []).forEach((c) => {
        lines.push("### " + c.title + " · " + c.state_label);
        lines.push("");
        lines.push("- 触发：" + c.because);
        lines.push("- 审批人：" + c.owner + " · 时限 " + c.deadline);
        (c.candidates || []).forEach((x) => {
          lines.push("- 候选：" + x.name + "；批准后余量 " + Math.round((x.after.margin || 0) * 1000) / 10 + "%；代价：" + x.cost);
        });
        lines.push("");
      });
      lines.push("## 复盘");
      lines.push("");
      lines.push((s.review && s.review.source) || "复盘为演示数据†");
      return lines.join("\n");
    },

    openModal(o) {
      const root = $("#modal-root");
      root.innerHTML = '<div class="modal-backdrop" data-close-modal="1"></div>' +
        '<div class="modal-panel ' + (o.wide ? "is-wide" : "") + '" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '">' +
          '<div class="modal-head"><div><div class="modal-title">' + esc(o.title || "") + "</div>" +
            (o.sub ? '<div class="modal-sub">' + esc(o.sub) + "</div>" : "") + "</div>" +
            '<button type="button" class="icon-btn" data-close-modal="1" aria-label="关闭">' + I.icon("close") + "</button></div>" +
          '<div class="modal-body">' + (o.body || "") + "</div></div>";
      root.classList.add("is-open");
      document.body.style.overflow = "hidden";
      const first = root.querySelector("input,textarea,select,button");
      if (first) setTimeout(() => first.focus(), 30);
    },

    closeModal() {
      const root = $("#modal-root");
      if (!root) return;
      root.classList.remove("is-open");
      root.innerHTML = "";
      document.body.style.overflow = "";
    },

    openReport(taskId, preset) {
      const task = ((this.state.snap.driver && this.state.snap.driver.tasks) || []).find((t) => t.id === taskId);
      if (!task) return;
      const actions = [
        ["normal", "正常", "排队 < 15 人，按计划发车"],
        ["crowded", "拥挤", "15–40 人，建议加密或加开"],
        ["full", "爆满", "> 40 人，触发应急建议"],
      ];
      const body = '<form data-form="report" data-task="' + esc(taskId) + '">' +
        '<div class="report-choice">' + actions.map((a) =>
          '<label class="report-choice-item"><input type="radio" name="action" value="' + a[0] + '"' +
          ((preset || "normal") === a[0] ? " checked" : "") + '><span><b>' + a[1] + "</b><small>" + a[2] + "</small></span></label>").join("") +
        "</div>" +
        '<div class="form-row"><label class="form-label">当前队列人数</label>' +
          '<input class="form-input" type="number" name="queue" min="0" step="1" value="' +
          esc((this.state.snap.driver.station && this.state.snap.driver.station.queue) || 0) + '"></div>' +
        '<div class="form-row"><label class="form-label">现场备注（可选）</label>' +
          '<textarea class="form-input" name="note" rows="3" placeholder="例如：旅行团集中到达，站台已满"></textarea></div>' +
        '<div class="modal-foot"><button type="button" class="btn btn-ghost" data-close-modal="1">取消</button>' +
          '<button type="submit" class="btn btn-primary">提交报数并生成回执</button></div></form>';
      this.openModal({ title: "现场报数", sub: task.id + " · " + (task.route || ""), body: body, wide: false });
    },

    openBadcases() {
      const cases = (this.state.snap.badcases && this.state.snap.badcases.cases) || [];
      const body = cases.map((c) =>
        '<div class="modal-case"><div class="modal-case-head"><b>' + esc(c.name) + "</b>" +
        '<span class="tag tag--outline">' + esc(c.trigger) + "</span></div>" +
        '<p class="small">' + esc(c.why) + "</p>" +
        '<div class="desk-note"><b>兜底</b> ' + esc(c.fallback) + "</div>" +
        '<div class="tiny muted mt-6">信号：' + esc(c.signal) + " · 需要：" + esc(c.need) + "</div></div>").join("");
      this.openModal({
        title: "失效场景库", sub: "11 条“机器失效时人怎么接”的兜底，不是功能清单。",
        body: body || UI.empty("暂无场景"), wide: true,
      });
    },

    openMode() {
      const mode = this.state.snap.mode || {};
      const base = mode.base || {};
      const alts = (mode.alternatives || []).map((x) =>
        '<div class="modal-case"><div class="modal-case-head"><b>' + esc(x.name) + "</b>" +
        UI.tag(x.level || "备选", "outline") + "</div><p class=\"small\">" + esc(x.summary || "") + "</p></div>").join("");
      const catalog = (mode.catalog || []).map((x) =>
        '<div class="matrix-row"><b>' + esc(x.name || x.id) + "</b><span>" + esc(x.summary || x.desc || "") + "</span></div>").join("");
      const body = '<div class="card is-flat"><div class="card-body">' +
        '<div class="mode-head"><span class="mode-level is-' + esc(mode.level || "semi") + '">' +
        esc((DOS.pageMeta.MODE_LABEL || {})[mode.level] || mode.level) + "</span>" +
        '<span class="tiny muted">延迟 ' + esc(mode.latency || "—") + " 分钟</span></div>" +
        '<div class="mode-name">' + esc(base.name || "") + "</div>" +
        '<p class="small">' + esc(base.summary || "") + "</p>" +
        '<div class="desk-note">' + esc(base.why || "") + "</div>" +
        '<div class="desk-note mt-6">风险：' + esc(base.risk || "—") + "</div></div></div>" +
        '<div class="section-label">备选方案</div>' + (alts || UI.empty("暂无备选")) +
        '<div class="section-label">能力目录</div>' + (catalog || UI.empty("暂无目录"));
      this.openModal({
        title: "调度模式库", sub: "系统先判断自己能协同到什么程度，再给方案。",
        body: body, wide: true,
      });
    },

    openAbout() {
      const meta = this.state.snap.meta || {};
      const body = '<div class="small">' + esc(meta.subtitle || "景区运力调度工作台") + " · v" + esc(meta.version) + "</div>" +
        '<div class="section-label">数据源</div><div class="desk-note">' + esc(meta.source && meta.source.note || "") + "</div>" +
        '<div class="section-label">演示边界</div><ul class="side-list">' +
        (meta.limits || []).map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" +
        '<div class="section-label">证据标签</div><div class="row wrap">' +
        (meta.evidence || []).map((e) => UI.evidence(meta, e.id)).join(" ") + "</div>" +
        '<div class="section-label">角色</div>' +
        (meta.roles || []).map((r) => '<div class="matrix-row"><b>' + esc(r.name) + "</b><span>" + esc(r.desc || "") + "</span></div>").join("") +
        '<div class="desk-note mt-10">演示版不登录，角色切换器只用于展示权限边界；所有决策仍会记录操作者与时间。</div>';
      this.openModal({ title: "关于景枢 DispatchOS", sub: "先讲边界，再讲能力。", body: body, wide: true });
    },

    openReset() {
      const body = '<div class="desk-note">将把当前景区的建议卡、任务单、班次调整和写回恢复为演示初态。</div>' +
        '<div class="small muted mt-6">审计日志会保留；接口会追加一条 <code>runtime_reset</code> 记录。</div>' +
        '<div class="modal-foot"><button type="button" class="btn btn-ghost" data-close-modal="1">取消</button>' +
        '<button type="button" class="btn btn-danger" data-action="reset-confirm">确认重置</button></div>';
      this.openModal({ title: "重置演示运行时", sub: "不会删除项目参数与审计。", body: body });
    },

    async doReset() {
      if (!this.state.online) {
        Object.keys(localStorage).filter((k) => k.indexOf("dispatchos.offline.") === 0).forEach((k) => U.remove(k));
        this.closeModal();
        this.state.page = "overview";
        await this.load({});
        this.toast("离线快照已恢复演示初态。", "ok");
        return;
      }
      try {
        const data = await this.request("/api/reset", this.apiBody({}));
        this.closeModal();
        this.applyResult(data, "演示运行时已重置，审计保留。");
      } catch (err) {
        this.toast(err.message || "重置失败", "error");
      }
    },

    toast(message, type, ms) {
      const root = $("#toast-root");
      if (!root) return;
      const el = document.createElement("div");
      el.className = "toast " + (type ? "is-" + type : "");
      el.innerHTML = (type === "error" || type === "warn" ? I.icon("alert") : type === "info" ? I.icon("info") : I.icon("checkCircle")) +
        "<span>" + esc(message) + "</span>";
      root.appendChild(el);
      setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translateY(6px)";
        setTimeout(() => el.remove(), 220);
      }, ms || 3000);
    },

    showBoot() {
      const b = $("#boot-splash");
      if (b) b.style.display = "flex";
    },

    hideBoot() {
      const b = $("#boot-splash");
      if (b) b.style.display = "none";
    },

    fatal(err) {
      this.state.loading = false;
      this.hideBoot();
      const app = $("#app");
      if (!app) return;
      app.innerHTML = '<div class="page"><div class="card" style="max-width:640px;margin:12vh auto"><div class="card-body">' +
        '<div class="eyebrow">BOOT ERROR</div><h1 class="page-title">调度台没有起来</h1>' +
        '<p class="page-desc">没有连上本地服务，也没有找到离线快照。启动服务后刷新：</p>' +
        '<pre class="desk-note" style="white-space:pre-wrap">cd DispatchOS\npython app.py</pre>' +
        '<div class="small muted mt-10">' + esc(err && err.message || String(err)) + "</div>" +
        '<button class="btn btn-primary mt-14" onclick="location.reload()">重新加载</button></div></div></div>';
    },

    /* ------------------------------------------------------------------ 事件 */
    bind() {
      const app = $("#app");
      if (!app) return;
      app.addEventListener("click", (e) => {
        try { this.onClick(e); } catch (err) { console.error(err); this.toast("操作失败：" + err.message, "error"); }
      });
      app.addEventListener("change", (e) => {
        try { this.onChange(e); } catch (err) { console.error(err); this.toast("操作失败：" + err.message, "error"); }
      });
      app.addEventListener("input", (e) => {
        try { this.onInput(e); } catch (err) { console.error(err); }
      });
      app.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.matches("[data-checkin-code]")) {
          e.preventDefault(); this.runGuestCheckin(e.target.value);
        }
      });
      if (global.GuestIntegration) global.GuestIntegration.subscribe((msg) => {
        if (msg && msg.kind && msg.kind.indexOf("booking.") === 0 && this.state.page === "guest") this.render({ top: false });
      });

      const modal = $("#modal-root");
      if (modal) {
        modal.addEventListener("click", (e) => {
          if (e.target.closest("[data-close-modal]")) this.closeModal();
        });
        modal.addEventListener("submit", (e) => {
          const form = e.target.closest("form");
          if (!form) return;
          e.preventDefault();
          this.onSubmit(form).catch((err) => this.toast(err.message || "提交失败", "error"));
        });
      }

      document.addEventListener("click", (e) => {
        if (!e.target.closest(".menu")) {
          $$("details.menu[open]").forEach((d) => d.removeAttribute("open"));
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          if ($("#modal-root").classList.contains("is-open")) this.closeModal();
          else this.closeNav();
        }
      });
      window.addEventListener("beforeunload", (e) => {
        if (Object.keys(this.state.dirty).length) {
          e.preventDefault();
          e.returnValue = "";
        }
      });
    },

    onClick(e) {
      const t = e.target;
      const pick = (sel) => (t && t.closest ? t.closest(sel) : null);
      const close = pick("[data-close-modal]");
      if (close) { this.closeModal(); return; }

      let el = pick("[data-nav]");
      if (el) { e.preventDefault(); this.go(el.getAttribute("data-nav")); return; }

      el = pick("[data-scene]");
      if (el) { this.switchScene(el.getAttribute("data-scene")); return; }

      el = pick("[data-project-enter]");
      if (el) { this.switchProject(el.getAttribute("data-project-enter")); return; }

      el = pick("[data-report-task]");
      if (el) {
        this.openReport(el.getAttribute("data-report-task"), el.getAttribute("data-report-action"));
        return;
      }

      el = pick("[data-task-action]");
      if (el && el.getAttribute("data-task-action") === "accept") {
        this.acceptTask(el.getAttribute("data-task"));
        return;
      }

      el = pick("[data-plan-apply]");
      if (el) {
        const slot = el.getAttribute("data-plan-apply");
        const input = $$("[data-plan-input]").find((x) => x.getAttribute("data-plan-input") === slot);
        const row = ((this.state.snap.plan && this.state.snap.plan.rows) || []).find((r) => r.slot === slot);
        if (input && row) this.planSet(slot, input.value, row.locked);
        return;
      }

      el = pick("[data-plan-lock]");
      if (el) {
        const slot = el.getAttribute("data-plan-lock");
        const row = ((this.state.snap.plan && this.state.snap.plan.rows) || []).find((r) => r.slot === slot);
        if (row) this.planSet(slot, row.veh, !row.locked);
        return;
      }

      el = pick("[data-writeback]");
      if (el) { this.writeback(el.getAttribute("data-writeback")); return; }

      el = pick("[data-candidate]");
      if (el) {
        const cardId = el.getAttribute("data-card-id");
        if (cardId) {
          this.state.selectedCardId = cardId;
          this.state.candidate[cardId] = el.getAttribute("data-candidate");
          this.render({ top: false });
        }
        return;
      }

      el = pick("[data-card-id]");
      if (el) {
        this.state.selectedCardId = el.getAttribute("data-card-id");
        this.state.rejecting = null;
        this.render({ top: false });
        return;
      }

      el = pick("[data-alert-card]");
      if (el) {
        const cid = el.getAttribute("data-alert-card");
        if (cid) {
          this.state.selectedCardId = cid;
          this.go("desk");
        } else {
          this.toast("这条预警没有对应的建议卡。", "info");
        }
        return;
      }

      el = pick("[data-case-filter]");
      if (el) { this.state.caseFilter = el.getAttribute("data-case-filter"); this.render({ top: false }); return; }

      el = pick("[data-param-group]");
      if (el) {
        this.state.params.group = el.getAttribute("data-param-group");
        this.render({ top: false });
        return;
      }

      el = pick("[data-param-flag]");
      if (el) {
        this.state.params.flag = el.getAttribute("data-param-flag");
        this.render({ top: false });
        return;
      }

      el = pick("[data-action]");
      if (el) {
        e.preventDefault();
        this.handleAction(el.getAttribute("data-action"), el).catch((err) => {
          console.error(err);
          this.toast(err.message || "操作失败", "error");
        });
        return;
      }
    },

    onChange(e) {
      const t = e.target;
      if (t.matches('select[data-select="project"]')) {
        this.switchProject(t.value);
        return;
      }
      if (t.matches('select[data-select="role"]')) {
        this.switchRole(t.value);
        return;
      }
      if (t.matches("[data-param-key]")) {
        this.captureParam(t);
        if (t.type === "checkbox" || t.tagName === "SELECT") {
          /* 多选与布尔即时反映状态文案 */
          const row = t.closest(".param-row");
          if (row && t.type === "checkbox" && t.getAttribute("data-param-type") === "bool") {
            const span = t.parentElement && t.parentElement.querySelector("span:last-child");
            if (span) span.textContent = t.checked ? "是" : "否";
          }
        }
      }
    },

    onInput(e) {
      const t = e.target;
      if (t.matches("[data-param-search]")) {
        this.state.params.q = t.value;
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => this.refreshParamList(), 130);
        return;
      }
      if (t.matches("[data-param-key]")) {
        this.captureParam(t);
      }
    },

    async onSubmit(form) {
      const kind = form.getAttribute("data-form");
      if (kind === "create-project") return this.submitCreate(form);
      if (kind === "delete-project") return this.submitDelete(form);
      if (kind === "report") {
        const taskId = form.getAttribute("data-task");
        const fd = new FormData(form);
        return this.reportTask(taskId, {
          action: String(fd.get("action") || "normal"),
          queue: Number(fd.get("queue") || 0),
          note: String(fd.get("note") || ""),
        });
      }
    },

    async handleAction(action, el) {
      switch (action) {
        case "plan-optimize": return this.optimizePlan();
        case "plan-optimize-apply": return this.applyOptimizedPlan();
        case "guest-close": {
          const open = !global.GuestIntegration.getState().bookingOpen;
          if (open || window.confirm("关闭游客端线上预约入口？已确认预约不受影响。")) {
            global.GuestIntegration.setBookingOpen(open, "DispatchOS 景区端手动操作");
            this.render({ top: false });
            this.toast(open ? "游客端预约入口已开放" : "预约入口已关闭，已确认预约保留", "info");
          }
          return;
        }
        case "guest-slot-gate": {
          const slotId = el && el.getAttribute("data-slot");
          const wasOpen = el && el.getAttribute("data-open") === "true";
          if (!wasOpen || window.confirm("关闭这个时段的游客端线上预约？已确认预约不受影响。")) {
            global.GuestIntegration.setBookingOpen(!wasOpen, "DispatchOS 时段预约入口控制", slotId);
            this.render({ top: false });
            this.toast(wasOpen ? "该时段预约入口已关闭" : "该时段预约入口已开放", "info");
          }
          return;
        }
        case "guest-checkin":
          return this.runGuestCheckin($("[data-checkin-code]")?.value);
        case "toggle-nav": {
          this.state.navOpen = !this.state.navOpen;
          const sidebar = $("#sidebar");
          const scrim = $(".scrim");
          if (sidebar) sidebar.classList.toggle("is-open", this.state.navOpen);
          if (scrim) scrim.classList.toggle("is-open", this.state.navOpen);
          return;
        }
        case "close-nav":
          return this.closeNav();
        case "refresh":
          return this.load({});
        case "save-params":
          return this.saveParams();
        case "param-reset":
          this.state.dirty = {};
          this.render({ top: false });
          this.toast("已放弃未保存的修改。", "info");
          return;
        case "project-new":
          return this.openCreateModal();
        case "project-duplicate":
          return this.duplicateProject(el.getAttribute("data-project"));
        case "project-delete":
          return this.openDeleteModal(el.getAttribute("data-project"));
        case "switch-duty":
          return this.switchRole("duty", { keepPage: true, page: "desk" });
        case "switch-driver":
          return this.switchRole("driver", { keepPage: true, page: "driver" });
        case "approve-dispatch":
          return this.decide("approve_dispatch");
        case "approve-only":
          return this.decide("approve");
        case "reject-open":
          this.state.rejecting = this.selectedCard() && this.selectedCard().id;
          this.render({ top: false });
          setTimeout(() => {
            const box = $("[data-reject-reason]");
            if (box) box.focus();
          }, 50);
          return;
        case "reject-cancel":
          this.state.rejecting = null;
          this.render({ top: false });
          return;
        case "reject-confirm": {
          const box = $("[data-reject-reason]");
          const reason = box ? box.value : "";
          if (!String(reason).trim()) {
            this.toast("拒绝必须写理由。", "warn");
            if (box) box.focus();
            return;
          }
          return this.decide("reject", reason);
        }
        case "dispatch-card":
          return this.decide("dispatch");
        case "plan-submit":
          this.go("desk");
          this.toast("已把计划带到工作台；审批后再下发任务单。", "info");
          return;
        case "badcases":
          return this.openBadcases();
        case "mode":
          return this.openMode();
        case "about":
          return this.openAbout();
        case "reset":
          return this.openReset();
        case "reset-confirm":
          return this.doReset();
        case "review-next":
          this.go("plan");
          this.toast("已按写回后的参数打开运行计划。", "info");
          return;
        case "export-report":
          return this.exportFile("report");
        case "export-snapshot":
          return this.exportFile("snapshot");
        case "export-params":
          return this.exportFile("params");
        default:
          this.toast("未知操作：" + action, "warn");
      }
    },

    runGuestCheckin(code) {
      const offline = $("[data-checkin-offline]");
      const result = global.GuestIntegration.simulateCheckin(String(code || "").trim(), "诺日朗", "slot-0900", !!(offline && offline.checked));
      const box = $("[data-checkin-result]");
      if (box) {
        box.textContent = result.branch === "allow" ? "正常放行" : result.branch === "duplicate" ?
          "已于 " + new Date(result.firstAt).toLocaleTimeString("zh-CN", {hour:"2-digit",minute:"2-digit"}) + " 在" + result.station + "核销" :
          "拒绝核销：" + (result.reason || result.message || "请人工核验");
        box.classList.toggle("is-red", result.branch === "reject");
      }
      this.toast(result.message || result.reason || (result.branch === "allow" ? "正常放行" : "核销已处理"), result.branch === "reject" ? "warn" : "info");
    },

    closeNav() {
      this.state.navOpen = false;
      const sidebar = $("#sidebar");
      const scrim = $(".scrim");
      if (sidebar) sidebar.classList.remove("is-open");
      if (scrim) scrim.classList.remove("is-open");
    },

    /* ------------------------------------------------------------------ 网络 */
    apiBody(extra) {
      return Object.assign({
        project: this.state.project,
        role: this.state.role,
        scene: this.state.scene,
      }, extra || {});
    },

    async request(path, body, method) {
      const res = await fetch(path, {
        method: method || (body ? "POST" : "GET"),
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      let data;
      try {
        data = await res.json();
      } catch (e) {
        throw new Error("服务返回了非 JSON 响应（HTTP " + res.status + "）");
      }
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || ("请求失败（HTTP " + res.status + "）"));
      }
      return data;
    },
  };

  global.App = App;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => App.init());
  } else {
    App.init();
  }
})(window);






