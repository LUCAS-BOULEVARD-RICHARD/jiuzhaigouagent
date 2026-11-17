# 景枢 DispatchOS

景区运力调度工作台。把「参数 → 计算 → 审批 → 任务 → 复盘」做成一条可演示、可留痕的闭环，而不是一张参数表。

- 6 个业务页 + 1 个景区入口
- 四幕演示阶段：前夜 20:00 / 07:40 / 12:10 / 18:30，可点击切换场景
- 常规建议卡与雨雪应急卡共用一套审批状态机
- 在线走真实引擎；断网双击 `static/index.html` 走离线快照
- 不依赖任何第三方前端库、外部字体或 CDN
- P0 游客端原型：`static/guest.html`；含车辆拥挤实况，游客预约与景区端通过版本化 Snapshot Adapter / BroadcastChannel 同步演示
- 景区端“司机中枢”汇总任务单、司机分配和现场回执；数据来自任务接口，管理页面不嵌入司机手机演示界面
- 司机端与司机中枢是两套界面，各走各的路：司机端 `static/driver.html`（手机页）负责接单、现场报数、回执；司机中枢负责按司机/车辆/站点汇总，页面与右下角入口都能一键「打开司机端」

## 快速开始

### 可选：OR-Tools 分时排班建议

基础系统仍只依赖 Python 标准库。需要启用在线优化时，在本目录执行 `python -m pip install -r requirements.txt`，然后重启服务。运行计划页点击“生成优化建议”，检查建议与假设后点击“人工确认并应用”；这只更新计划，不会下发任务，后续仍走现有审批流程。离线快照不运行求解器。第一阶段按小时做车辆数配置，司机约束只按同时在岗人数保守限额，不代表真实班次或连续驾驶合规。

### 可选：只读调度助手

助手支持资料提取、复盘归纳和白名单只读工具分析；不具备审批、派车、改计划工具。默认调用 OpenAI Responses API 和 `gpt-4.1-mini`。

启用方式（任选其一，界面配置优先、改完即生效）：

1. 打开工作台右下角「✦ 调度助手 → ⚙」，先在「服务商」下拉里选 OpenAI 官方 / DeepSeek / 阿里百炼 / 智谱 / Kimi / 硅基流动 / OpenRouter / 本地 Ollama（一键填好地址与默认模型），再填该服务商的 API Key；点「获取列表」可拉取账户实际可用的对话模型（也可直接手填任意模型名），最后点「保存并测试连接」；配置写到本机 `data/llm.json`，改完即生效。
2. 部署时用环境变量，适合不开放界面的场景：

```powershell
$env:OPENAI_API_KEY = "你的 OpenAI API 密钥"
python app.py --port 8787
```

其它可选环境变量：`DISPATCHOS_LLM_MODEL`（默认 `gpt-4.1-mini`）、`DISPATCHOS_LLM_BASE_URL`（默认 `https://api.openai.com/v1`）。使用云厂商或中转时，填其 OpenAI 兼容的 `/v1` 根地址即可，程序会自动改走 `/chat/completions`；地址也可直接写到 `/responses`。Azure OpenAI 使用 `api-key` 头与 `api-version` 参数，与本程序的 Bearer 认证不兼容，需经兼容网关转换后接入。问答和 Agent 会把问题及所需快照字段发送至模型服务；资料提取会发送用户粘贴/导入的原文。密钥只保存在服务端，接口只回显掩码。资料提取仅支持 TXT / CSV / Markdown 或粘贴文本，结果先展示原文依据，勾选并点击“写入已选参数”后才调用现有参数权限接口。有限工具 Agent 仅开放当前快照、建议卡、运营复盘和四幕场景比较；写操作工具不在白名单。只有服务在线且配置密钥时可用，离线快照不支持问答。

### 服务态（推荐，数据实时）

双击项目根目录的 `启动.bat`，或在本目录执行：

```bash
python app.py --port 8787
```

打开 <http://127.0.0.1:8787>。首次启动会自动读取 `data/projects/jiuzhaigou.json` 的演示项目。

### 离线态（断网兜底）

直接双击 `static/index.html`。页面读取 `static/demo_snapshot.js` 中预生成的四个场景快照；审批、任务、计划、写回在浏览器本地完成，并保存到 localStorage。

### 四幕直达

```text
http://127.0.0.1:8787/?scene=eve#plan       前夜 · 运行计划
http://127.0.0.1:8787/?scene=morning#overview 早高峰 · 运行实况
http://127.0.0.1:8787/?scene=noon#desk      午后 · 应急建议卡
http://127.0.0.1:8787/?scene=evening#review 收班 · 运营复盘
```

角色可用右上角切换器切换；演示版不做登录，界面会注明「权限为示意」。

### 游客端 P0 演示

在线服务打开 `http://127.0.0.1:8787/guest.html`，或在景区端右下角点「打开游客端演示」。游客端使用本地快照，可创建/退订演示预约；切回景区端「游客预约」查看聚合曲线、预约池表、缺口建议卡、入口开关、站点核销与复盘指标。两页通过版本化 `dispatchos.guest` 契约和同源 BroadcastChannel 同步，离线原型使用 localStorage 持久化。

游客端首页在「车辆运行」与「可预约时段」之间提供「车辆拥挤实况」：按 ETA 列出 5 辆演示观光车，显示载客/核定座位、四档拥挤等级（空闲 <40%、适中 40–70%、拥挤 70–90%、满员 ≥90%）、数据新鲜度（实时/推算/计划）和最近上报时间；点车辆可看载客率、余座、下一站与近 8 次上报趋势，右上角「刷新」可立即模拟一次上报。数据每 15 秒在浏览器本地模拟，关闭页面即停止；不写 localStorage，也不跨标签页同步，避免把演示车辆误当成真实车队。线路页同步增加拥挤程度规则和四档图例。

任务单、接单和现场报数通过现有任务接口记录，并汇总到景区端“司机中枢”。

P0 不连接真实票务、GPS/北斗、车载客流计数或官方客户端。预约码为演示文本码，不是真实 QR；HID 扫码输入和核销分支为界面原型。定位新鲜度、断链提示、预约容量规则均以演示数据表达。车辆载客数同样为本地模拟，不能用于真实拥挤判断；真实接入需由景区提供车载客流计数、票务核销或站点报数口径。游客端通过 `dispatchos.guest` v1 adapter、localStorage 和 BroadcastChannel 同源同步预约、退订与逐时关停；本地文件模式若浏览器隔离 `file://` 存储，则两页不能跨文件同步。

### 官方客户端扩展接口

`static/guest-adapter.js` 定义可替换的 `GuestIntegration` adapter：`connect / getState / subscribe / getVehicles / refreshVehicles / createBooking / cancelBooking / setBookingOpen / simulateCheckin`。协议字段带 `contract` 与 `version`，连接结果返回 `capabilities`；车辆拥挤相关能力为 `vehicle.crowding.read`、`vehicle.crowding.subscribe`，上报事件为 `vehicle.crowding.changed`（仅通知当前页面，不跨标签页广播）。后续可增加 `official-webview`、小程序 JSBridge 或 HTTPS API adapter，而不改游客页面组件。接入真实官方客户端前，需由景区确认容器、登录/实名票务授权、签名校验、回调白名单、隐私和网络安全要求；P0 不假设这些能力已存在。

## 页面结构

| 导航 | 交接点 | 主要职责 |
| --- | --- | --- |
| 景区档案 | 入口 | 多景区隔离，选择当前工作区 |
| 工作台 | ① 数据进来 | 43 项输入、16 项 P0；缺项 / 假设† / 可疑值三色标记 |
| 运行实况 | ② 机器出结论 | 余量、瓶颈、三色风险、右栏预警流、线路骨架 |
| 运行计划 | ② 机器出结论 | 分时曲线、逐时班次、15% 安全线、仿真与敏感性 |
| 调度建议 | ③ 人做决定 | 触发依据、2–3 个候选、代价、审批、留痕、下发任务 |
| 司机端 | ④ 司机端 | 任务单、接单、三键报数、R-XXXX 回执、站点排队 |
| 运营复盘 | ④ 司机端 | 计划 vs 实际、三项偏差、写回参数、次日建议 |

## 目录

```text
DispatchOS/
├─ app.py                    HTTP 服务、API、静态文件、导出
├─ config.py                 角色 / 页面 / 权限 / 演示边界
├─ storage.py                项目、运行时、审计日志
├─ engine/
│  ├─ schema.py              43 项参数定义、A–F 分组
│  ├─ validate.py            缺项 / 假设 / 可疑值
│  ├─ calc.py                运力、班次、敏感性
│  ├─ sim.py                 排队仿真（相对比较）
│  ├─ modes.py               调度模式建议
│  ├─ badcases.py            11 条失效场景
│  ├─ scenes.py              四幕场景与雨雪修正
│  ├─ workflow.py            建议卡、审批状态机、任务单
│  ├─ dashboard.py           快照装配、计划、复盘、快报
│  └─ report.py              报告块模型
├─ static/
│  ├─ index.html             单页外壳
│  ├─ style.css              视觉系统
│  ├─ demo_snapshot.js       四幕离线快照
│  └─ js/{core,pages,app}.js 组件库 / 页面注册表 / 控制器
├─ tools/
│  ├─ seed_demo.py           生成九寨沟演示项目
│  ├─ build_snapshot.py      重生成 demo_snapshot.js
│  ├─ cdp_check.js           Edge CDP 审批→任务→复盘链路验收
│  └─ cdp_mobile.js          390px 移动端截图与溢出检查
├─ data/projects/            项目参数
├─ data/runtime/             卡片、任务、计划、写回状态
└─ data/audit/               追加式决策审计 JSONL
```

## 数据口径

- 运力：`车数 × 座位 × 60 ÷ 循环时间 × 载客系数`
- 余量：`1 − 高峰需求 ÷ 小时有效运力`
- 目标车数：按 15% 安全线反算，`ceil(峰值 ÷ (单车小时运力 × 0.85))`
- 雨雪：循环时间 `×(1 + 雨雪增幅)`，不污染原始参数
- 仿真：单站单方向泊松排队，只能做相对比较，不是现场预测
- 复盘「实际值」是演示数据†；任务号、车号、司机姓名同样为示例

界面只做展示与交互，不另造计算结论；批准后预览与计划页的现算使用与 `calc.py` 相同的公式。

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/bootstrap` | 首屏快照（项目 / 角色 / 场景） |
| GET | `/api/snapshot` | 当前快照 |
| GET | `/api/projects` | 项目列表 + 完整度 |
| POST | `/api/decision` | 批准 / 拒绝 / 下发 / 批准并下发 |
| POST | `/api/task` | 接单 / 报数 / 回执 |
| POST | `/api/plan` | 逐时车数、锁定、应用 |
| POST | `/api/review` | 确认写回参数 |
| POST | `/api/params` | 保存工作台 |
| POST | `/api/projects` | 新建 / 复制 / 删除景区 |
| POST | `/api/reset` | 恢复演示运行时（审计保留） |
| GET | `/api/export/report` | 运行快报 Markdown |
| GET | `/api/export/snapshot` | 当前快照 JSON |
| GET | `/api/export/params` | 项目参数 JSON |

所有写操作都带 `project / role / scene`；审批与任务在服务端再次校验角色权限。

## 扩展方式（为后续功能预留）

1. **新增业务页**：在 `config.PAGES` 与 `config.PAGE_ACCESS` 注册；在 `static/js/app.js` 的 `PAGE_DEFS` 加图标/分组；在 `static/js/pages.js` 注册 `DOS.pages.xxx(app)`；在 `engine/dashboard.py` 的 `build()` 中增加快照键。
2. **新增动作**：页面只输出 `data-action`，在 `app.js` 的 `handleAction` 接一个方法；在线走 API，离线在本地快照上做同样的状态迁移。
3. **新增场景**：在 `engine/scenes.py` 的 `SCENES` 加一幕，`tools/build_snapshot.py` 会自动多生成一份离线快照。
4. **新增建议卡**：在 `engine/workflow.py` 的 `_plan_card / _peak_card / _rain_card` 旁增加构造器；候选统一使用 `effect` 与 `after_metrics()`，审批状态机不需要改。
5. **新增数据源**：在 `engine/` 加模块，由 `dashboard.build()` 装配；页面不直接读文件或数据库。

## 验收命令

```bash
python tools/seed_demo.py          # 重建演示项目
python tools/build_snapshot.py     # 重建离线快照
python tools/_smoke_build.py       # 四幕快照冒烟
node tools/cdp_check.js            # 需 Edge 9222：审批→接单→报数→写回
node tools/cdp_mobile.js           # 需 Edge 9222：390px 截图与溢出检查
```

> 演示数据仅用于 UI 标定与答辩叙事，不得用于真实调度。


