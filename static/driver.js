(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
  const params = new URLSearchParams(location.search);
  const boot = window.DISPATCH_BOOT || {};
  const sceneId = params.get("scene") || localStorage.getItem("dispatchos.scene") || boot.default_scene || "morning";
  let projectId = params.get("project") || localStorage.getItem("dispatchos.project") || boot.default_project || "jiuzhaigou";
  let snap = null;
  let online = false;
  let page = "tasks";
  let activeTaskId = "";
  let reportMode = "normal";
  let reportQueue = 0;
  let reportNote = "";
  const labels = { dispatched: "待接单", accepted: "执行中", reported: "已回执", normal: "正常", crowded: "拥挤", full: "爆满" };
  const reportActions = [
    ["normal", "正常", "畅通"],
    ["crowded", "拥挤", "排队"],
    ["full", "爆满", "溢出"],
  ];

  function tasks() { return (snap && snap.driver && snap.driver.tasks) || []; }
  function currentTask() {
    return tasks().find((t) => t.id === activeTaskId) ||
      tasks().find((t) => t.status === "accepted") ||
      tasks().find((t) => t.status === "dispatched") || tasks()[0] || null;
  }
  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2400);
  }
  function taskCard(t) {
    const status = t.status || "dispatched";
    return '<article class="driver-task"><div class="task-top"><b>' + esc(t.id) + '</b><span class="task-state ' + esc(status) + '">' + esc(labels[status] || status) + '</span></div>' +
      '<h2>' + esc(t.title || "运行任务") + '</h2><p class="task-route">' + esc(t.route || "景区观光线路") + '</p>' +
      '<div class="task-grid"><div><small>车辆</small><b>' + esc(t.vehicle || "待安排") + '</b></div><div><small>发车</small><b>' + esc(t.depart || "—") + '</b></div>' +
      '<div><small>司机</small><b>' + esc(t.driver || "—") + '</b></div><div><small>回执</small><b>' + esc(t.receipt || "待回传") + '</b></div></div>' +
      (t.change_note ? '<p class="task-note">' + esc(t.change_note) + '</p>' : "") +
      (status === "dispatched" ? '<button class="primary" data-accept="' + esc(t.id) + '">确认接单</button>' : "") +
      (status === "accepted" ? '<button class="secondary" data-open-report="' + esc(t.id) + '">现场报数</button>' : "") +
      (status === "reported" && t.receipt ? '<div class="receipt">回执号 <b>' + esc(t.receipt) + '</b></div>' : "") + '</article>';
  }
  function tasksPage() {
    return '<div class="driver-page-head"><small>今日任务 · ' + esc((snap.meta && snap.meta.date) || "") + '</small><h1>任务</h1><p>已分配 ' + tasks().length + ' 项</p></div>' +
      (tasks().map(taskCard).join("") || '<div class="empty"><b>暂无任务</b><p>新任务下发后会显示在这里。</p></div>');
  }
  function reportPage() {
    const t = currentTask();
    if (!t) return '<div class="driver-page-head"><small>现场回传</small><h1>现场报数</h1></div><div class="empty"><b>暂无可报数任务</b><p>接到任务后可在这里回传现场状态。</p></div>';
    if (t.status === "dispatched") return '<div class="driver-page-head"><small>现场回传</small><h1>现场报数</h1></div>' + taskCard(t) + '<div class="notice">请先确认接单，再提交现场状态。</div>';
    if (t.status === "reported") return '<div class="driver-page-head"><small>现场回传</small><h1>现场报数</h1></div>' + taskCard(t);
    const station = (snap.driver && snap.driver.station && snap.driver.station.name) || "诺日朗站";
    return '<div class="driver-page-head"><small>' + esc(station) + ' · ' + esc(t.id) + '</small><h1>现场报数</h1></div>' +
      '<section class="report-card"><label>现场排队人数<input id="queue-count" type="number" min="0" step="1" value="' + esc(reportQueue) + '" inputmode="numeric"></label>' +
      '<div class="report-options">' + reportActions.map(([id, label, sub]) => '<button class="report-option ' + (reportMode === id ? "selected" : "") + '" data-report-mode="' + id + '"><b>' + label + '</b><small>' + sub + '</small></button>').join("") + '</div>' +
      '<label>补充说明 <textarea id="report-note" rows="3" placeholder="选填">' + esc(reportNote) + '</textarea></label>' +
      '<button class="primary" data-submit-report="' + esc(t.id) + '">提交现场回执</button></section>';
  }
  function mePage() {
    const t = currentTask();
    const d = snap.driver || {};
    return '<div class="driver-page-head"><small>个人信息</small><h1>我的</h1></div>' +
      '<section class="profile-card"><div class="profile-avatar">' + esc((t && t.driver || "司").slice(0, 1)) + '</div><h2>' + esc((t && t.driver) || "司机") + '</h2>' +
      '<div class="profile-row"><span>当前车辆</span><b>' + esc((t && t.vehicle) || "未分配") + '</b></div>' +
      '<div class="profile-row"><span>负责站点</span><b>' + esc((d.station && d.station.name) || "—") + '</b></div>' +
      '<div class="profile-row"><span>服务状态</span><b>' + (online ? "在线" : "离线演示") + '</b></div></section>';
  }
  function render() {
    const views = { tasks: tasksPage, report: reportPage, me: mePage };
    $("#driver-app").innerHTML = views[page]();
    document.querySelectorAll("#driver-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  }
  function offlineSnapshot() {
    const source = (boot.snapshots && boot.snapshots[sceneId]) || (boot.snapshots && boot.snapshots[boot.default_scene]) || {};
    snap = JSON.parse(JSON.stringify(source));
    const key = "dispatchos.driver." + projectId + "." + sceneId;
    try {
      const local = JSON.parse(localStorage.getItem(key) || "null");
      if (local && snap.driver) snap.driver = Object.assign(snap.driver, local);
    } catch (_) {}
  }
  async function load() {
    try {
      const q = new URLSearchParams({ role: "driver", project: projectId, scene: sceneId });
      const r = await fetch("/api/bootstrap?" + q.toString(), { cache: "no-store" });
      if (!r.ok) throw new Error("offline");
      const data = await r.json();
      snap = data.snapshot;
      projectId = snap.meta.project.id;
      online = true;
    } catch (_) {
      offlineSnapshot();
      online = false;
    }
    render();
  }
  function saveOffline() {
    const d = snap.driver || {};
    localStorage.setItem("dispatchos.driver." + projectId + "." + sceneId, JSON.stringify({ tasks: d.tasks || [], station: d.station || {} }));
  }
  async function action(body) {
    body.project = projectId;
    body.role = "driver";
    body.scene = sceneId;
    if (online) {
      const r = await fetch("/api/task", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok || data.ok === false) throw new Error(data.error || "提交失败");
      snap = data.snapshot;
      return data.message || "已更新";
    }
    const t = tasks().find((x) => x.id === body.task_id);
    if (!t) throw new Error("找不到任务");
    if (body.action === "accept") {
      t.status = "accepted";
    } else {
      const rep = body.report || {};
      t.status = "reported";
      t.receipt = "R-" + Math.random().toString(16).slice(2, 6).toUpperCase();
      t.reports = (t.reports || []).concat([{ label: labels[rep.action], action: rep.action, queue: rep.queue, note: rep.note }]);
      if (snap.driver.station) snap.driver.station.queue = rep.queue;
    }
    saveOffline();
    return body.action === "accept" ? "已确认接单" : "现场回执已保存到本机";
  }
  document.addEventListener("click", async (e) => {
    const tab = e.target.closest("[data-page]");
    if (tab) { page = tab.dataset.page; render(); return; }
    const mode = e.target.closest("[data-report-mode]");
    if (mode) {
      reportQueue = Number($("#queue-count").value || 0);
      reportNote = $("#report-note").value;
      reportMode = mode.dataset.reportMode;
      render();
      return;
    }
    const openReport = e.target.closest("[data-open-report]");
    if (openReport) { activeTaskId = openReport.dataset.openReport; page = "report"; render(); return; }
    const accept = e.target.closest("[data-accept]");
    if (accept) {
      try { toast(await action({ task_id: accept.dataset.accept, action: "accept" })); await load(); }
      catch (err) { toast(err.message); }
      return;
    }
    const submit = e.target.closest("[data-submit-report]");
    if (submit) {
      const queue = Math.max(0, Math.floor(Number($("#queue-count").value || 0)));
      const note = $("#report-note").value.trim();
      try {
        toast(await action({ task_id: submit.dataset.submitReport, action: "report", station: (snap.driver.station && snap.driver.station.name) || "诺日朗站", report: { action: reportMode, queue: queue, note: note } }));
        page = "tasks";
        await load();
      } catch (err) { toast(err.message); }
    }
  });
  load();
})();
