/* DispatchOS · 司机中枢 / 司机端 端到端验收
 * 前置：一个带 --remote-debugging-port=9223 的 Edge 已启动（无头亦可）。
 * 运行：node tools/hub_check.js
 * 流程：指挥角色看中枢 → 在司机端接单并报数 → 回中枢确认已汇总。
 */
const fs = require("fs");
const path = require("path");
const http = require("http");

const PORT = Number(process.env.CDP_PORT || 9223);
const BASE = process.env.BASE || "http://127.0.0.1:8799";
const OUT = path.join(__dirname, "..", "out");

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function targets() {
  const res = await fetch("http://127.0.0.1:" + PORT + "/json/list");
  return res.json();
}

async function main() {
  const list = await targets();
  const page = list.find((t) => t.type === "page" && !t.url.startsWith("http")) || list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let seq = 0;
  const pending = new Map();
  const problems = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") {
      problems.push("EXCEPTION " + JSON.stringify(msg.params.exceptionDetails.text));
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      problems.push("console.error " + (msg.params.args || []).map((a) => a.value || a.description || "").join(" "));
    }
  });

  function send(method, params) {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  async function ev(expression) {
    const r = await send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception || {}));
    }
    return r.result.value;
  }

  async function goto(url) {
    await send("Page.navigate", { url });
    await sleep(400);
    for (let i = 0; i < 40; i++) {
      const ready = await ev("!!document.querySelector('#app .page, #driver-app .driver-page-head')");
      if (ready) break;
      await sleep(250);
    }
    await sleep(500);
  }

  async function shot(name) {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    console.log("shot " + file);
  }

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  // 1) 指挥角色打开司机中枢（#driver 直达）
  await goto(BASE + "/index.html?role=command#driver");
  const hub = await ev(`(() => {
    const nav = Array.from(document.querySelectorAll('.nav-item')).map((b) => b.textContent.trim());
    const h1 = document.querySelector('.page-title');
    const split = document.querySelector('.driver-split .ds-text b');
    const link = document.querySelector('.driver-split a');
    return {
      role: (document.querySelector('.role-switch select') || {}).value || '',
      nav, title: h1 ? h1.textContent.trim() : '',
      split: split ? split.textContent.trim() : '',
      driverLink: link ? link.getAttribute('href') : '',
      rows: document.querySelectorAll('.card .table tbody tr').length,
    };
  })()`);
  console.log("HUB", JSON.stringify(hub, null, 1));
  await shot("verify_hub_command.png");

  // 2) 司机端接单 + 报数
  await goto(BASE + "/driver.html?role=driver");
  for (let i = 0; i < 30; i++) {
    if (await ev(`location.pathname.indexOf('driver.html') >= 0 && document.querySelectorAll('.driver-task').length > 0`)) break;
    await sleep(300);
  }
  const pendingTask = await ev(`(() => {
    const b = document.querySelector('[data-accept]');
    return b ? b.getAttribute('data-accept') : '';
  })()`);
  console.log("待接单任务", pendingTask);
  if (!pendingTask) throw new Error("司机端没有待接单任务，无法走通接单链路");
  await ev(`document.querySelector('[data-accept="${pendingTask}"]').click()`);
  let opened = false;
  for (let i = 0; i < 20; i++) {
    if (await ev(`!!document.querySelector('[data-open-report="${pendingTask}"]')`)) { opened = true; break; }
    await sleep(400);
  }
  if (!opened) {
    const state = await ev(`(() => {
      const card = Array.from(document.querySelectorAll('.driver-task')).find((c) => c.textContent.includes('${pendingTask}'));
      return { card: card ? card.textContent.replace(/\\s+/g, ' ').slice(0, 120) : 'none', toast: (document.querySelector('#toast') || {}).textContent || '' };
    })()`);
    throw new Error("接单后没有出现报数按钮: " + JSON.stringify(state));
  }
  await ev(`document.querySelector('[data-open-report="${pendingTask}"]').click()`);
  await sleep(800);
  await ev(`(() => {
    const q = document.querySelector('#queue-count');
    q.value = '42';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-report-mode="crowded"]').click();
    return true;
  })()`);
  await sleep(600);
  await shot("verify_driver_report.png");
  const toast = await ev(`(() => {
    document.querySelector('[data-submit-report="${pendingTask}"]').click();
    return 'clicked';
  })()`);
  await sleep(1800);
  const afterReport = await ev(`(() => {
    const card = Array.from(document.querySelectorAll('.driver-task')).find((c) => c.textContent.includes('${pendingTask}'));
    return card ? card.textContent.replace(/\\s+/g, ' ').slice(0, 160) : 'no card';
  })()`);
  console.log("司机端回执后卡片:", afterReport, toast);
  await shot("verify_driver_after.png");

  // 3) 回中枢，确认汇总
  await goto(BASE + "/index.html?role=command#driver");
  const agg = await ev(`(() => {
    const text = document.querySelector('.page').textContent.replace(/\\s+/g, ' ');
    const rows = Array.from(document.querySelectorAll('.table tbody tr')).map((r) => r.textContent.replace(/\\s+/g, ' '));
    return {
      hasTask: text.includes('${pendingTask}'),
      receiptRow: rows.filter((r) => r.includes('${pendingTask}') && r.includes('42')),
      receipt: (text.match(/回执完成率[^%]*%/) || [''])[0],
    };
  })()`);
  console.log("HUB-AGG", JSON.stringify(agg, null, 1));
  await shot("verify_hub_after.png");

  if (problems.length) console.log("PAGE PROBLEMS:\n" + problems.join("\n"));
  const ok = hub.nav.join(",").includes("司机中枢") && hub.split.includes("司机端负责执行") &&
    agg.hasTask && agg.receiptRow.length > 0;
  console.log(ok ? "RESULT PASS" : "RESULT FAIL");
  ws.close();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error("FAILED", err.message); process.exit(1); });
