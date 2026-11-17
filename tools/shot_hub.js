/* 司机中枢的两处收尾截图：指挥角色 / 司机角色 */
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "..", "out");
const PORT = Number(process.env.CDP_PORT || 9223);
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  });
  const send = (method, params) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params: params || {} })); return new Promise((res, rej) => pending.set(id, { res, rej })); };
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  for (const [role, file] of [["command", "final_hub_command.png"], ["driver", "final_hub_driver.png"]]) {
    await send("Page.navigate", { url: BASE + "/index.html?role=" + role + "#driver" });
    for (let i = 0; i < 40; i++) { if (await ev("!!document.querySelector('.page .driver-split')")) break; await sleep(250); }
    await sleep(700);
    const info = await ev(`(() => {
      const t = (s) => { const el = document.querySelector(s); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : ''; };
      return { title: t('.page-title'), desc: t('.page-desc'), split: t('.ds-text'), cta: t('.driver-split .btn'), nav: Array.from(document.querySelectorAll('.nav-item')).map((b) => b.textContent.trim()) };
    })()`);
    console.log(role, JSON.stringify(info));
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(shot.data, "base64"));
    console.log("shot", file);
  }

  // 司机端手机页（任务列表）
  await send("Emulation.setDeviceMetricsOverride", { width: 430, height: 900, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: BASE + "/driver.html?role=driver" });
  for (let i = 0; i < 40; i++) { if (await ev("document.querySelectorAll('.driver-task').length > 0")) break; await sleep(250); }
  await sleep(600);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "final_driver_tasks.png"), Buffer.from(shot.data, "base64"));
  console.log("shot final_driver_tasks.png");
  ws.close();
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
