/* 诊断移动端横向溢出：node tools/cdp_mobile.js */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  });
  const send = (method, params) => {
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
    return new Promise((resolve, reject) => pending.set(n, { resolve, reject }));
  };
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Page.navigate", { url: "http://127.0.0.1:8787/?role=driver&scene=morning&v=" + Date.now() + "#driver" });
  for (let i = 0; i < 30; i++) {
    await sleep(250);
    if (await ev("!!(window.App && App.state.snap)")) break;
  }
  const out = await ev(`(() => {
    const w = window.innerWidth;
    const all = [...document.querySelectorAll('body *')];
    const bad = all.map(el => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, cls: String(el.className || '').slice(0,70), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
    }).filter(x => x.right > w + 1 || x.left < -1).slice(0, 20);
    return { innerWidth: w, docScroll: document.documentElement.scrollWidth, bodyScroll: document.body.scrollWidth, bad };
  })()`);
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  require("fs").writeFileSync("out/mobile-driver-cdp.png", Buffer.from(shot.data, "base64"));
  console.log(JSON.stringify(out, null, 2));
  ws.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
