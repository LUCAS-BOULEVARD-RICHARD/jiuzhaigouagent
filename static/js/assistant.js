/* 只读调度助手浮层；所有回答来自服务端当前快照。 */
(function () {
  "use strict";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const stored = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (_) { return d; } };
  const project = () => stored("dispatchos.project", "");
  const scene = () => stored("dispatchos.scene", "morning");
  const role = () => stored("dispatchos.role", "dispatcher");
  // 本地偏好可能是旧版本写入的对象或数字，统一转成接口需要的字符串 id。
  const idOf = (v) => (v && typeof v === "object") ? String(v.id == null ? "" : v.id) : (v == null ? "" : String(v));
  // 常见 OpenAI 兼容服务商预设：选中后只填地址与模型，密钥需各自申请。
  const PRESETS = {
    openai: { base: "https://api.openai.com/v1", model: "gpt-4.1-mini",
      models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o", "o4-mini"] },
    deepseek: { base: "https://api.deepseek.com/v1", model: "deepseek-chat",
      models: ["deepseek-chat", "deepseek-reasoner"] },
    dashscope: { base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus",
      models: ["qwen-plus", "qwen-turbo", "qwen-max", "qwen-long"] },
    zhipu: { base: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash",
      models: ["glm-4-flash", "glm-4-air", "glm-4-plus"] },
    moonshot: { base: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k",
      models: ["moonshot-v1-8k", "moonshot-v1-32k", "kimi-k2-0711-preview"] },
    siliconflow: { base: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct",
      models: ["Qwen/Qwen2.5-7B-Instruct", "Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3"] },
    openrouter: { base: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini",
      models: ["openai/gpt-4o-mini", "openai/gpt-4o", "deepseek/deepseek-chat"] },
    ollama: { base: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b",
      models: ["qwen2.5:7b", "qwen2.5:14b", "llama3.1:8b"] },
  };
  const sameBase = (a, b) => String(a || "").replace(/\/+$/, "") === String(b || "").replace(/\/+$/, "");
  const root = document.createElement("div");
  root.innerHTML = '<button class="assistant-launch" type="button" aria-expanded="false">✦ 调度助手</button>' +
    '<section class="assistant-panel" aria-label="只读调度助手" hidden>' +
    '<header class="assistant-head"><div><strong>只读调度助手</strong><small>依据当前快照回答 · 不执行调度操作</small></div>' +
    '<div class="assistant-head-actions">' +
    '<button class="assistant-gear" type="button" aria-label="模型接入设置" aria-expanded="false" title="模型接入设置">⚙</button>' +
    '<button class="assistant-close" type="button" aria-label="关闭">×</button></div></header>' +
    '<div class="assistant-notice"></div>' +
    '<section class="assistant-settings" aria-label="模型接入设置" hidden>' +
    '<div class="assistant-field"><label for="as-preset">服务商</label>' +
    '<select id="as-preset"><option value="">保持当前配置</option>' +
    '<option value="openai">OpenAI 官方</option><option value="deepseek">DeepSeek 深度求索</option>' +
    '<option value="dashscope">阿里百炼（通义千问）</option><option value="zhipu">智谱 GLM</option>' +
    '<option value="moonshot">月之暗面 Kimi</option><option value="siliconflow">硅基流动</option>' +
    '<option value="openrouter">OpenRouter</option><option value="ollama">本地 Ollama</option></select></div>' +
    '<div class="assistant-field"><label for="as-base">接口地址</label>' +
    '<input id="as-base" type="url" autocomplete="off" spellcheck="false" placeholder="https://api.openai.com/v1"></div>' +
    '<div class="assistant-field"><label for="as-key">API Key</label>' +
    '<input id="as-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-… 留空表示沿用已保存的密钥"></div>' +
    '<div class="assistant-field"><label for="as-model">模型</label>' +
    '<div class="assistant-model-row">' +
    '<input id="as-model" list="as-models" autocomplete="off" spellcheck="false" placeholder="gpt-4.1-mini">' +
    '<button type="button" class="assistant-models-btn" data-act="models">获取列表</button></div>' +
    '<datalist id="as-models"><option value="gpt-4.1-mini"></option><option value="gpt-4.1"></option>' +
    '<option value="gpt-4o-mini"></option><option value="gpt-4o"></option><option value="o4-mini"></option></datalist></div>' +
    '<p class="assistant-hint">密钥只写入本机 <code>data/llm.json</code>，不会回传到浏览器；国内网络通常无法直连 api.openai.com，需配置代理，或把地址改为云厂商/中转的 OpenAI 兼容 <code>/v1</code> 地址。</p>' +
    '<div class="assistant-settings-actions">' +
    '<button type="button" data-act="save">保存</button>' +
    '<button type="button" data-act="test">保存并测试连接</button></div>' +
    '<div class="assistant-settings-status" aria-live="polite"></div></section>' +
    '<div class="assistant-messages" aria-live="polite"></div>' +
    '<div class="assistant-tools"><button type="button" data-act="agent">有限工具 Agent 分析</button><button type="button" data-act="extract-open">从资料提取参数</button></div>' +
    '<section class="assistant-extract" hidden><label>粘贴资料，或导入 TXT / CSV / Markdown（最多 16000 字）</label><input type="file" data-material-file accept=".txt,.csv,.md,text/plain,text/csv"><textarea data-material rows="5" maxlength="16000" placeholder="粘贴客流、线路、车辆等资料原文…"></textarea><div class="assistant-extract-actions"><button type="button" data-act="extract">提取候选</button><button type="button" data-act="apply" disabled>写入已选参数</button></div><div class="assistant-extract-results"></div></section>' +
    '<div class="assistant-prompts"><button type="button">当前主要风险是什么？</button><button type="button">解释推荐方案和代价</button></div>' +
    '<form class="assistant-form"><textarea maxlength="1200" rows="2" placeholder="询问当前调度快照…" aria-label="输入问题"></textarea>' +
    '<button type="submit">发送</button></form></section>';
  document.body.appendChild(root);

  const launch = root.querySelector(".assistant-launch"), panel = root.querySelector(".assistant-panel");
  const messages = root.querySelector(".assistant-messages"), notice = root.querySelector(".assistant-notice");
  const settings = root.querySelector(".assistant-settings"), gear = root.querySelector(".assistant-gear");
  const fields = {
    base: root.querySelector("#as-base"),
    key: root.querySelector("#as-key"),
    model: root.querySelector("#as-model"),
    preset: root.querySelector("#as-preset"),
  };
  const settingsStatus = root.querySelector(".assistant-settings-status");
  const extractPanel = root.querySelector(".assistant-extract"), extractText = root.querySelector("[data-material]");
  root.querySelector("[data-material-file]").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    if (file.size > 100000) { append("bot error", "文件不能超过 100 KB"); e.target.value = ""; return; }
    extractText.value = (extractText.value ? extractText.value + "\n\n" : "") + await file.text();
    if (extractText.value.length > 16000) extractText.value = extractText.value.slice(0, 16000);
  });
  const extractResults = root.querySelector(".assistant-extract-results"), applyExtract = root.querySelector('[data-act="apply"]');
  const saveBtn = root.querySelector('[data-act="save"]'), testBtn = root.querySelector('[data-act="test"]');
  const form = root.querySelector("form"), input = form.querySelector("textarea"), send = form.querySelector("button");

  const append = (who, text) => {
    const item = document.createElement("div"); item.className = "assistant-message " + who;
    item.textContent = text; messages.appendChild(item); messages.scrollTop = messages.scrollHeight;
  };
  const setNotice = (s) => {
    notice.textContent = s.enabled
      ? "已接入 " + s.model + " · " + s.provider + "（密钥来源：" + s.source + "）。问题会连同当前快照发送到该模型服务。"
      : "尚未配置模型密钥。点右上角 ⚙ 填写 API Key 并保存，或设置 OPENAI_API_KEY 后重启服务。";
  };
  const fillSettings = (s) => {
    fields.base.value = s.base_url || "";
    fields.model.value = s.model_default || s.model || "";
    fields.key.value = "";
    fields.key.placeholder = s.key_hint ? "已保存：" + s.key_hint + "（留空沿用）" : "sk-…";
    fields.preset.value = "";
    Object.keys(PRESETS).forEach((id) => { if (sameBase(PRESETS[id].base, s.base_url)) fields.preset.value = id; });
  };

  const loadStatus = async () => {
    const s = await fetch("/api/assistant/status").then(r => r.json());
    setNotice(s); fillSettings(s);
    return s;
  };

  const postJson = async (url, body) => {
    let response;
    try { response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch (err) { if (err instanceof TypeError) throw new Error("无法连接本地工作台服务。请关闭离线页面，改用项目根目录“启动.bat”打开在线版；离线快照不支持模型问答。"); throw err; }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || "请求失败（HTTP " + response.status + "）");
    return data;
  };

  async function saveSettings(withTest) {
    const payload = { base_url: fields.base.value.trim(), model: fields.model.value.trim(), api_key: fields.key.value.trim() };
    saveBtn.disabled = true; testBtn.disabled = true;
    settingsStatus.className = "assistant-settings-status";
    settingsStatus.textContent = "正在保存…";
    try {
      const data = await postJson("/api/assistant/settings", payload);
      fillSettings(data.settings); setNotice(data.settings);
      settingsStatus.textContent = "已保存：" + data.settings.model + " · " + data.settings.provider;
      if (withTest) {
        settingsStatus.textContent += "，正在测试连接…";
        const t = await postJson("/api/assistant/test", {});
        settingsStatus.className = "assistant-settings-status ok";
        settingsStatus.textContent = "连接成功：" + t.model + " · " + t.provider + " · " + t.latency_ms + " ms · 回复「" + t.reply + "」";
      }
    } catch (err) {
      settingsStatus.className = "assistant-settings-status error";
      settingsStatus.textContent = err.message || "保存失败，请检查配置。";
    } finally {
      saveBtn.disabled = false; testBtn.disabled = false;
    }
  }

  launch.addEventListener("click", async () => {
    panel.hidden = !panel.hidden; launch.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) {
      try { await loadStatus(); } catch (_) { notice.textContent = "离线快照模式不支持大模型问答；启动服务并配置模型后可用。"; }
      input.focus();
    }
  });
  gear.addEventListener("click", () => {
    settings.hidden = !settings.hidden;
    gear.setAttribute("aria-expanded", String(!settings.hidden));
    if (!settings.hidden) fields.key.focus();
  });
  saveBtn.addEventListener("click", () => saveSettings(false));
  testBtn.addEventListener("click", () => saveSettings(true));
  const datalist = root.querySelector("#as-models");
  fields.preset.addEventListener("change", () => {
    const preset = PRESETS[fields.preset.value];
    if (!preset) return;
    fields.base.value = preset.base;
    fields.model.value = preset.model;
    datalist.innerHTML = preset.models.map(m => '<option value="' + esc(m) + '"></option>').join("");
    settingsStatus.className = "assistant-settings-status";
    settingsStatus.textContent = "已填入 " + fields.preset.selectedOptions[0].textContent + " 的地址与模型；请填写该服务商的 API Key，再点「保存并测试」。";
    fields.key.focus();
  });
  const modelsBtn = root.querySelector('[data-act="models"]');
  modelsBtn.addEventListener("click", async () => {
    modelsBtn.disabled = true; const label = modelsBtn.textContent; modelsBtn.textContent = "获取中…";
    try {
      const data = await fetch("/api/assistant/models").then(r => r.json());
      if (!data.ok) throw new Error(data.error || "获取模型列表失败");
      datalist.innerHTML = data.models.map(m => '<option value="' + esc(m) + '"></option>').join("");
      settingsStatus.className = "assistant-settings-status ok";
      settingsStatus.textContent = "账户共有 " + data.count + " 个可用对话模型：点击模型框展开选择，也可直接输入名称。";
    } catch (err) {
      settingsStatus.className = "assistant-settings-status error";
      settingsStatus.textContent = (err.message || "获取模型列表失败") + "；仍可手动填写模型名。";
    } finally { modelsBtn.disabled = false; modelsBtn.textContent = label; }
  });
  root.querySelector(".assistant-close").addEventListener("click", () => { panel.hidden = true; launch.setAttribute("aria-expanded", "false"); });
  root.querySelectorAll(".assistant-prompts button").forEach(b => b.addEventListener("click", () => { input.value = b.textContent; form.requestSubmit(); }));
  root.querySelector('[data-act="extract-open"]').addEventListener("click", () => { extractPanel.hidden = !extractPanel.hidden; });
  root.querySelector('[data-act="extract"]').addEventListener("click", async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = "提取中…"; extractResults.textContent = ""; applyExtract.disabled = true;
    try {
      const data = await postJson("/api/assistant/extract", { material: extractText.value });
      if (!data.items.length) { extractResults.textContent = "没有找到带有明确原文依据的参数。"; return; }
      extractResults.innerHTML = data.items.map((item, i) => '<label class="assistant-extract-item"><input type="checkbox" checked data-index="' + i + '"><span><b>' + esc(item.label) + '</b> · ' + esc(JSON.stringify(item.value)) + ' ' + esc(item.unit || "") + '<small>依据：“' + esc(item.source_quote) + '”</small></span></label>').join("");
      extractResults._items = data.items; applyExtract.disabled = false;
    } catch (err) { extractResults.textContent = err.message || "提取失败"; }
    finally { btn.disabled = false; btn.textContent = "提取候选"; }
  });
  applyExtract.addEventListener("click", async () => {
    const items = extractResults._items || [];
    const selected = Array.from(extractResults.querySelectorAll("[data-index]:checked")).map(el => items[Number(el.dataset.index)]).filter(Boolean);
    if (!selected.length) { extractResults.insertAdjacentText("afterbegin", "请先勾选参数。 "); return; }
    applyExtract.disabled = true;
    try {
      const params = Object.fromEntries(selected.map(item => [item.key, item.value]));
      await postJson("/api/params", { project: idOf(project()), role: idOf(role()) || "dispatcher", scene: idOf(scene()) || "morning", params });
      append("bot", "已按你的确认写入 " + selected.length + " 项参数。请回到参数台账核对，并查看重新计算后的结果。");
      extractPanel.hidden = true;
    } catch (err) { append("bot error", err.message || "参数写入失败"); }
    finally { applyExtract.disabled = false; }
  });
  root.querySelector('[data-act="agent"]').addEventListener("click", async () => {
    const question = input.value.trim() || "分析当前景区运行情况，找出主要风险并说明依据";
    append("user", "Agent：" + question); send.disabled = true;
    try {
      const data = await postJson("/api/assistant/agent", { message: question, project: idOf(project()), role: idOf(role()) || "dispatcher", scene: idOf(scene()) || "morning" });
      append("bot", data.answer + "\n\n已调用只读工具：" + data.tools.join("、") + "。审批与执行仍由工作人员完成。");
      input.value = "";
    } catch (err) { append("bot error", err.message || "Agent 请求失败"); }
    finally { send.disabled = false; }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); const question = input.value.trim(); if (!question || send.disabled) return;
    const draft = input.value;
    append("user", question); input.value = ""; send.disabled = true; send.textContent = "…";
    const pending = document.createElement("div"); pending.className = "assistant-message bot pending"; pending.textContent = "正在根据当前快照分析…"; messages.appendChild(pending);
    try {
      let response;
      try { response = await fetch("/api/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, project: idOf(project()), role: idOf(role()) || "dispatcher", scene: idOf(scene()) || "morning" }) }); }
      catch (err) { if (err instanceof TypeError) throw new Error("无法连接本地工作台服务。请用项目根目录“启动.bat”打开在线版；离线快照不支持模型问答。"); throw err; }
      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = {}; }
      pending.remove();
      if (!response.ok || !data.ok) throw new Error(data.error || "请求失败（HTTP " + response.status + "）");
      append("bot", data.answer + "\n\n依据：当前景区快照。建议和执行仍需人工核实与审批。");
    } catch (err) {
      pending.remove();
      if (!input.value) input.value = draft;
      append("bot error", err.message || "助手暂时不可用，请稍后重试。");
    }
    finally { send.disabled = false; send.textContent = "发送"; input.focus(); }
  });
  // 回车发送、Shift+回车换行；输入法组合中的回车不触发。
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
})();
