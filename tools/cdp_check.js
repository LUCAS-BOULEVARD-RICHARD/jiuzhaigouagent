/* DispatchOS · 用 Edge CDP 做一次真实点击链路验收
 * 先启动：msedge --headless=new --remote-debugging-port=9222 ...
 * 再运行：node tools/cdp_check.js
 */
const http = require("http");

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function targets() {
  const res = await fetch("http://127.0.0.1:9222/json/list");
  return res.json();
}

async function main() {
  const list = await targets();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let seq = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") {
      logs.push("EXCEPTION " + JSON.stringify(msg.params.exceptionDetails));
    } else if (msg.method === "Runtime.consoleAPICalled") {
      const text = (msg.params.args || []).map((a) => a.value || a.description || "").join(" ");
      if (msg.params.type === "error" || msg.params.type === "warning") logs.push(msg.params.type + ": " + text);
    }
  });

  function send(method, params) {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  async function ev(expression, awaitPromise) {
    const r = await send("Runtime.evaluate", {
      expression,
      awaitPromise: !!awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception || {}));
    }
    return r.result.value;
  }

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:8787/?role=dispatcher&scene=morning#desk" });

  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const ready = await ev("!!(window.App && App.state && App.state.snap && App.state.snap.desk)");
    if (ready) break;
  }

  const result = {};
  result.initial = await ev("({page: App.state.page, role: App.state.role, cards: App.state.snap.desk.cards.map(c => ({id:c.id, state:c.state, perms:c.permissions}))})");
  result.approve = await ev("(async () => { App.state.selectedCardId='2026-11-12-peak'; App.state.candidate['2026-11-12-peak']='peak-8'; await App.decide('approve_dispatch'); const c=App.state.snap.desk.cards.find(x=>x.id==='2026-11-12-peak'); return {state:c.state, tasks:(c.tasks||[]).length, count:App.state.snap.driver.tasks.length}; })()", true);
  await sleep(300);

  result.toDriver = await ev("(async () => { await App.switchRole('driver'); return {page:App.state.page, role:App.state.role, tasks:App.state.snap.driver.tasks.map(t=>({id:t.id,state:t.status,card:t.card_id}))}; })()", true);
  result.accept = await ev("(async () => { const t=App.state.snap.driver.tasks.find(x=>x.card_id==='2026-11-12-peak'); await App.acceptTask(t.id); const c=App.state.snap.desk.cards.find(x=>x.id==='2026-11-12-peak'); return {task:t.id, taskState:t.status, cardState:c.state}; })()", true);
  result.report = await ev("(async () => { const t=App.state.snap.driver.tasks.find(x=>x.card_id==='2026-11-12-peak'); await App.reportTask(t.id,{action:'crowded',queue:27,note:'CDP 验收'}); const c=App.state.snap.desk.cards.find(x=>x.id==='2026-11-12-peak'); return {taskState:t.status, receipt:t.receipt, cardState:c.state}; })()", true);

  result.toDuty = await ev("(async () => { await App.switchRole('duty'); return {page:App.state.page, role:App.state.role, perms:App.state.snap.meta.permissions}; })()", true);
  result.writeback = await ev("(async () => { App.go('review'); await App.writeback('a_peak_share'); const w=(App.state.snap.review.writebacks||[]).find(x=>x.key==='a_peak_share'); return {page:App.state.page, applied:w && w.applied, new:w && w.new}; })()", true);

  result.logs = logs.slice(-10);
  console.log(JSON.stringify(result, null, 2));
  ws.close();
}

main().catch((e) => {
  console.error("CDP CHECK FAILED:", e.stack || e);
  process.exit(1);
});
