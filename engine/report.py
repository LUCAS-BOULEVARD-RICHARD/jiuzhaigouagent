# -*- coding: utf-8 -*-
"""十段式报告：先生成结构化 blocks，再分别渲染为 Markdown 与 Word。

证据标注规则：
- 用户填写且注明来源 → 【资料事实】/【项目参数】
- 未填、由程序补齐 → 【假设】(表格中加 †)
- 由参数计算或仿真得出 → 【仿真结果】/【计算结果】
"""
import datetime
import math
from .schema import FIELDS, FIELD_MAP


# ---------------------------------------------------------------- blocks
class Doc:
    def __init__(self):
        self.blocks = []

    def h1(self, t):
        self.blocks.append({"t": "h1", "v": t})

    def h2(self, t):
        self.blocks.append({"t": "h2", "v": t})

    def h3(self, t):
        self.blocks.append({"t": "h3", "v": t})

    def p(self, t):
        self.blocks.append({"t": "p", "v": t})

    def note(self, t):
        self.blocks.append({"t": "note", "v": t})

    def ul(self, items):
        self.blocks.append({"t": "ul", "v": list(items)})

    def table(self, head, rows, note="", widths=None):
        b = {"t": "table", "head": list(head), "rows": [list(r) for r in rows], "note": note}
        if widths:
            b["widths"] = list(widths)
        self.blocks.append(b)


def _fmt(v, unit=""):
    if v is None or v == "":
        return "未填"
    if isinstance(v, bool):
        return "是" if v else "否"
    if isinstance(v, (int, float)):
        v = float(v)
        if unit == "0-1":
            return f"{v:.2f}（{v:.0%}）"
        if abs(v - round(v)) < 1e-9:
            return f"{int(round(v)):,}"
        if abs(v) < 10:
            return f"{v:.2f}".rstrip("0").rstrip(".")
        return f"{v:,.1f}"
    return str(v)


def _clean(text):
    return str(text).replace("\n", " ").replace("|", "／").strip()


# ---------------------------------------------------------------- build
def build(params, ctx):
    d = Doc()
    calc = ctx["calc"]
    m = calc["metrics"]
    val = ctx["validation"]
    modes = ctx["modes"]
    bc = ctx["badcases"]
    sim = ctx["sim"]
    name = ctx.get("name") or "目标景区"
    ts = ctx.get("generated_at") or datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    sources = params.get("_sources") or {}
    asm = calc["assumptions"]

    def ev(key):
        src = sources.get(key) or {}
        s = (src.get("source") or "").strip()
        conf = (src.get("conf") or "").strip()
        if key in asm:
            return "未填→假设†", "低（假设）"
        if s:
            return s, (conf or "中（未注明）")
        return "用户填写未注明出处", (conf or "中（未注明）")

    d.h1(f"{name} · 景区车辆调度策略适配分析报告")
    d.p(f"生成时间：{ts}　｜　参数完整度：{val['p0_filled']}/{val['p0_total']} 项必填（{val['completeness']:.0%}）"
        f"　｜　调度模式判定：{_level_name(modes['level'])}（数据延迟 {modes['latency']:g} 分钟）")
    d.note("本报告是决策支持材料，不是调度指令。所有涉及车辆调度、限流和发车的动作，必须由有权限的工作人员审核后执行；"
           "报告中标注 † 的数值为分析假设，不得当作景区实测数据引用。")

    # ---------------- 1
    d.h2("1. 结论摘要")
    d.p(_summary(modes, m, val, name))

    # ---------------- 2
    d.h2("2. 参数画像")
    rows = []
    for f in FIELDS:
        k = f["key"]
        v = params.get(k)
        filled = v not in (None, "", [], {})
        if not filled and f["prio"] != "P0":
            continue
        if f["type"] == "select":
            disp = dict((o[0], o[1]) for o in f.get("options", [])).get(v, _fmt(v))
        elif f["type"] == "multi":
            disp = "、".join(f.get("options") and dict((o[0], o[1]) for o in f["options"]).get(x, x) or x
                             for x in (v or [])) or "未填"
        else:
            unit = f["unit"] if f["unit"] not in ("0-1",) else ""
            disp = _fmt(v, f["unit"]) + (f" {unit}" if unit and v not in (None, "") else "")
        src, conf = ev(k)
        rows.append([f"{f['group']}·{f['label']}", disp, src, conf,
                     "缺失，按假设参与计算" if k in asm else "—"])
    has_asm = any(k in asm for k in params)
    head2 = ["参数", "当前值", "来源", "可信度"] + (["假设影响"] if has_asm else [])
    body2 = rows if has_asm else [r[:4] for r in rows]
    d.table(head2, body2,
            "† 表示该值由程序按假设补齐；填“未填”的必填项会直接削弱结论强度。",
            widths=[0.22, 0.28, 0.26, 0.14, 0.10] if has_asm else [0.24, 0.32, 0.28, 0.16])
    if val["missing_p0"]:
        d.note("必填项缺失：" + "、".join(FIELD_MAP[k]["label"] for k in val["missing_p0"])
               + "。这些缺失项各自的默认假设已在表中标 †，替换为实测值后结论可能改变。")

    # ---------------- 3
    d.h2("3. 九寨沟参考机制拆解")
    d.note("证据状态说明：本次未提供九寨沟的可核验运营资料（制度文件、调度台账、公开的技术报告），"
           "以下机制条目按“公开讨论中常见的调度组织方式”归纳，均为【待核实】，不构成对九寨沟实际运营事实的陈述。"
           "迁移判断一栏只依据本报告第 2 章的参数，判断的是“机制成立所需条件是否具备”，不是“九寨沟是否这样运行”。")
    mech_rows = _mechanisms(params, m, val)
    d.table(["机制（证据状态）", "解决的问题", "所需数据与组织条件", "规则或触发条件", "潜在收益", "主要风险",
             "目标景区迁移判断"],
            [[f"{r[0]}（{r[7]}）"] + r[1:7] for r in mech_rows],
            "“可迁移 / 有条件迁移 / 暂不适用”只反映本景区当前条件，条件补齐后判断会变。",
            widths=[0.13, 0.15, 0.19, 0.17, 0.11, 0.12, 0.13])

    # ---------------- 4
    d.h2("4. 目标景区与参考案例比较")
    cmp_rows = _compare(params, m, modes)
    d.table(["维度", "参考机制隐含的前提（待核实）", "目标景区现状", "对调度方案的影响"], cmp_rows,
            "参考案例一侧写的是机制成立所需的前提，不是九寨沟的实测值。",
            widths=[0.13, 0.26, 0.31, 0.30])

    # ---------------- 5
    d.h2("5. 推荐调度方案")
    d.p(f"选择路径：先按数据条件判定可用的调度层级（{_level_name(modes['level'])}），"
        f"再按需求压力（高峰利用率 {m['util']:.0%}）与客流结构（主导方向 {_pct(params.get('a_direction_split'), 0.6)}、"
        f"前两站占比 {_pct(params.get('a_top2_share'), 0.5)}）决定增强项。"
        "以下四套方案并列给出，不是择优淘汰关系。")

    _plan_block(d, "基准方案", modes["base"])
    d.p("关键参数与触发点：")
    d.ul([
        f"高峰小时在运 {m['n_service']} 辆，理论间隔 {m['headway']:g} 分钟，小时有效运力 {m['hourly_capacity']:.0f} 人",
        f"平峰在运 {modes['params']['n_off']} 辆，间隔 {modes['params']['headway_off']:g} 分钟",
        f"备用车 {modes['params']['spare']} 辆待命，触发阈值：单站候车 ≥ {modes['params']['queue_trigger']} 人或预计等待 > {modes['params']['wait_trigger']} 分钟",
    ])
    d.p("人工审批点：加车、跨线调车、缩短间隔至安全下限以下，均由值班调度长确认；涉及限流与单向组织，由景区运营负责人确认。")

    for i, alt in enumerate(modes["alternatives"], start=1):
        _plan_block(d, f"备选方案 {i}", alt)
        d.p(f"适用条件：{alt.get('conditions', '')}；不适用：{alt.get('not_for', '')}")
        if alt.get("approvals"):
            d.p(f"审批点：{alt['approvals']}")

    _plan_block(d, "当前数据条件下的简化方案", modes["simplified"])
    _plan_block(d, "数据完善后的升级方案", modes["upgrade"])
    d.p("升级前需具备的条件：")
    d.ul(modes["upgrade"]["prerequisites"])
    d.note(modes["note"])

    # ---------------- 6
    d.h2("6. 运力与约束分析")
    d.p("计算口径：小时有效运力 = 可用车辆数 × 单车有效座位数 × 60 ÷ 平均循环时间 × 运营修正系数。"
        "其中“有效座位数”取核定载客量（不再二次打折），“平均循环时间”为车辆从起点发车回到起点的往返时间（含上下客与站内排队），"
        "“运营修正系数”折算上下客波动、站台排队、限速与调度空档，是经验参数而非实测值。")
    calc_rows = [
        ["可用车辆数", f"{m['available']:.0f} 辆", _src(params, "c_bus_available"), "决定运力上限"],
        ["单车核定载客", f"{m['seats']:.0f} 座", _src(params, "c_seats"), "按行驶证核定，不是座位数猜测"],
        ["平均循环时间", f"{m['cycle']:.0f} 分钟", _src(params, "b_cycle_time"), "往返含停靠口径"],
        ["运营修正系数", f"{m['coef']:.2f}", _src(params, "c_load_coef"), "经验值，需试点校准"],
        ["单车小时运力", f"{m['cap_unit']:.1f} 人/小时·辆", "计算", f"{m['seats']:.0f}×60÷{m['cycle']:.0f}×{m['coef']:.2f}"],
        ["小时有效运力", f"{m['hourly_capacity']:.0f} 人/小时", "计算", f"{m['available']:.0f} 辆 × {m['cap_unit']:.1f}"],
        ["高峰小时需求", f"{m['demand_peak']:.0f} 人/小时", _src(params, "a_peak_hour_flow"), "双向上车合计"],
        ["需求运力比", f"{m['util']:.0%}", "计算", ">100% 即有人上不了车"],
        ["理论需配车辆", f"{m['fleet_need']} 辆", "计算", "满足高峰需求的最小值"],
        ["实际可投放在运", f"{m['n_service']} 辆", "计算", "受可用车数约束"],
        ["对应发车间隔", f"{m['headway']:g} 分钟", "计算", "循环时间 ÷ 在运车数"],
        ["满载率", f"{m['actual_load']:.0%}", "计算", f"需求 ÷ ({m['n_service']} 辆 × 单车小时运力)"],
        ["运营时段", f"{m['op_hours']:g} 小时", _src(params, "d_op_start"), "开园至末班"],
        ["所需司机工时", f"{m['driver_need_hours']:.0f} 人·小时", "计算", f"{m['n_service']} 辆 × {m['op_hours']:g} 小时"],
        ["可提供司机工时", f"{m['driver_avail_hours']:.0f} 人·小时", _src(params, "c_driver_total"), "按 90% 出勤折减"],
    ]
    d.table(["输入/结果", "数值", "来源", "说明"], calc_rows, widths=[0.22, 0.24, 0.26, 0.28])
    d.p(f"代入：{m['available']:.0f} 辆 × {m['seats']:.0f} 座 × 60 ÷ {m['cycle']:.0f} 分钟 × {m['coef']:.2f} "
        f"= {m['hourly_capacity']:.0f} 人/小时；高峰需求 {m['demand_peak']:.0f} 人/小时，"
        f"利用率 {m['util']:.0%}，缺口 {m['gap']:.0f} 人/小时（负值表示余量）。"
        "该估算不反映：方向不均衡导致的空驶、站点间需求差异、上下客时间的非均匀分布、"
        "车辆在站台的排队等待，以及司机交接班造成的运力空档。")

    d.h3("6.1 安全与约束检查")
    d.table(["等级", "事项", "判断依据", "说明"],
            [[c["level"], c["title"], c["basis"], c["detail"]] for c in calc["checks"]],
            widths=[0.09, 0.26, 0.35, 0.30])

    d.h3("6.2 敏感性分析")
    d.table(["场景", "在运车数", "循环时间(分)", "小时有效运力", "需求", "缺口", "利用率"],
            [[s["name"], f"{s['veh']:.0f}", f"{s['cycle']:.0f}", f"{s['capacity']:.0f}",
              f"{s['demand']:.0f}", f"{s['gap']:+.0f}", f"{s['util']:.0%}"] for s in calc["sensitivity"]],
            "缺口为正值表示运力不足。", widths=[0.24, 0.11, 0.13, 0.14, 0.12, 0.11, 0.15])

    d.h3("6.3 分时排班建议（计算结果，非真实运行）")
    sched = calc["schedule"]
    d.p(f"客流曲线来源：{sched['source']}。车辆数与间隔按小时需求 ÷ 单车小时运力向上取整，"
        "并受可用车数约束；满载率超过 100% 的时段以“超”标注，表示该时段运力不足。")
    d.table(["时段", "需求(人/小时)", "在运车辆", "发车间隔(分)", "满载率"],
            [[r["slot"], f"{r['flow']}", f"{r['veh']}", f"{r['headway']:g}",
              (f"{r['util']:.0%}" + (" 超" if r["over"] else ""))] for r in sched["rows"]],
            widths=[0.22, 0.22, 0.18, 0.20, 0.18])

    d.h3("6.4 简化排队仿真（相对比较，不是候车时间预测）")
    sim_note = sim["note"] + f"；重复 {sim['reps']} 次取均值，窗口 {sim['window']} 分钟，主导方向到达率 {sim['rate_per_min']} 人/分钟"
    if all(r["residual"] <= 0 for r in sim["rows"]):
        sim_note += ("。本参数下各档均未出现末班后滞留，说明约束在总运力与车数，而不在发车间隔本身："
                     "间隔只改变候车时间，减少不了总量缺口")
    d.table(["方案", "发车间隔(分)", "到达人数", "运送人数", "平均候车(分)", "P90 候车(分)", "最大队列(人)", "窗口末滞留(人)"],
            [[r["name"], f"{r['headway']:g}", r["arrived"], r["served"],
              f"{r['mean_wait']:g}", f"{r['p90_wait']:g}", r["max_queue"], f"{r['residual']:g}"] for r in sim["rows"]],
            sim_note, widths=[0.20, 0.11, 0.11, 0.11, 0.12, 0.12, 0.11, 0.12])

    if asm:
        d.h3("6.5 本次使用的假设清单")
        d.ul([f"{v['label']}：取 {v['value']}（{v['why']}）" for k, v in asm.items()])

    # ---------------- 7
    d.h2("7. Bad Cases 与降级方案")
    d.table(["场景", "触发条件", "失效原因", "影响范围", "监测信号与降级处理", "待补充能力"],
            [[c["name"], c["trigger"], c["why"], c["impact"],
              f"监测：{c['signal']}　降级：{c['fallback']}", c["need"]] for c in bc["cases"]],
            bc["note"], widths=[0.12, 0.20, 0.18, 0.15, 0.22, 0.13])

    # ---------------- 8
    d.h2("8. 验证设计")
    d.p("验证目标是“机制适配是否成立”，不是“模型是否聪明”。对照组用现有规则，实验组用日前预排班 + 日内滚动调度，"
        "两组在同一客流日、同一车辆条件下比较，避免把客流变化当成方案效果。")
    d.table(["组别", "排班方式", "调度触发", "信息链路"],
            [["对照组", f"现行规则（{_rule_name(params.get('d_dispatch_rule'))}）",
              "值班人员经验判断，无固定阈值", f"{_chan_name(params.get('f_channel'))}，无回执要求"],
             ["实验组 A", "日前预排班（按近 4 周同时段数据）", f"站点候车 ≥ {modes['params']['queue_trigger']} 人或等待 > 15 分钟",
              "上报—确认—下发—回执，全部留痕"],
             ["实验组 B", "实验组 A + 高峰加密与备用车调度", "同 A，并允许跨线调车（≤20% 运力）", "同 A"]],
            widths=[0.12, 0.34, 0.34, 0.20])
    d.table(["指标", "定义", "数据来源", "目标方向"],
            [["平均候车时间", "旅客到站至上车的时间均值", "站点观测或票务/闸机时序", "下降"],
             ["P90 候车时间", "90 分位候车时间", "同上", "下降且 ≤ 20 分钟"],
             ["最大站点滞留人数", "单站同时候车人数峰值", "站点计数或人工点数", "不超过 1.5 车容量"],
             ["高峰小时有效运力", "实际运送人数/小时", "发车记录 × 实载人数", "不低于计算结果"],
             ["满载率", "实载人数 ÷ 核定载客", "发车记录", "70%-90% 区间"],
             ["空驶率", "空驶车公里 ÷ 总车公里", "GPS 里程", "不上升"],
             ["调度响应时间", "触发至车辆实际发车的时间差", "调度台账", "≤ 15 分钟"],
             ["安全违规次数", "超载、超时驾驶、违规停靠", "稽查与车载记录", "0"],
             ["方案执行率", "按计划发出的班次 ÷ 计划班次", "班表与实际发车比对", "≥ 90%"],
             ["数据缺失率", "缺失或异常记录 ÷ 应记录数", "系统日志", "≤ 5%"]],
            widths=[0.22, 0.34, 0.24, 0.20])
    d.table(["验证场景", "构造方式", "观察重点"],
            [["普通客流日", "工作日，客流接近普通日均值", "方案是否引入不必要的复杂度"],
             ["节假日高峰", "节假日，客流接近核定量", "缺口是否被削峰与加密共同覆盖"],
             ["周转时间延长", f"循环时间上调 {_inc(m['cycle'], m['cycle_rain'])}（{m['cycle']:.0f}→{m['cycle_rain']:.0f} 分钟）", "间隔是否被动拉长、是否及时减班"],
             ["局部突发大客流", "单站 15 分钟候车达 2 车容量", "空车直放与分批引导的响应速度"],
             ["部分车辆故障", "可用车减少 2 辆", "备用车调用是否及时"],
             ["数据中断", "关闭站点计数或延迟 30 分钟", "是否按预设规则降级，而不是继续按旧数据调度"]],
            widths=[0.18, 0.48, 0.34])
    d.p("样本与隔离：若用历史数据回放，训练（预排班参数标定）与测试（评估）必须按日期隔离，"
        "至少留出 20% 的完整运营日不参与标定，且测试集中不得出现与训练集同一天的数据；"
        "若跨景区验证，需按景区隔离。只有一组景区参数时，本设计只能支持案例规则整理与原型验证，"
        "不能声称模型已具备跨景区泛化能力。")

    # ---------------- 9
    d.h2("9. 部署建议")
    d.table(["配置等级", "所需数据", "系统能力", "人工流程", "适用条件"],
            [["最低可行", "循环时间、可用车数、核定载客、运营时段（纸面台账即可）",
              "无，Excel + 对讲机", "调度长每日排班、站务员整点口报、台账记录", "无实时数据、客流日间波动可预排"],
             ["标准", "上述 + 站点人工计数（15 分钟粒度）+ 车辆位置",
              "班表工具 + 对讲回执", "触发—确认—下发—回执，每日复盘", f"数据延迟 ≤ 30 分钟（当前 {modes['latency']:g} 分钟）"],
             ["增强", "上述 + 闸机/票务分时数据 + GPS 全覆盖（刷新 ≤ 30 秒）",
              "滚动调度看板 + 自动建议 + 人工确认", "阈值告警、建议生成、人工确认、执行反馈闭环", "数据缺失率 ≤ 5%，指令链路有回执"]],
            "三档是递进关系，不建议跳过最低可行直接上增强配置：没有台账与回执，实时系统只会放大错误。",
            widths=[0.12, 0.26, 0.18, 0.26, 0.18])

    # ---------------- 10
    d.h2("10. 待补充信息")
    gaps = []
    for k in val["missing_p0"]:
        f = FIELD_MAP[k]
        gaps.append([f"【{f['group']}】{f['label']}", f["prio"], f["impact"], "向调度/票务/运营部门索取台账或系统导出"])
    for k in ["a_top2_share", "a_direction_split", "f_history", "b_rain_increase", "c_bus_spare"]:
        if k in asm and k not in val["missing_p0"]:
            f = FIELD_MAP[k]
            gaps.append([f"【{f['group']}】{f['label']}", f["prio"], f["impact"], "用一周站点台账或 GPS 轨迹反推"])
    if not params.get("a_profile"):
        gaps.append(["【A】分时客流曲线（每小时上车量）", "P1",
                     "未提供时 6.3 分时排班只能用假设曲线（早高峰 10:00、返程 16:30 前后），排班时刻与真实峰值可能错位",
                     "票务/闸机按小时导出，取近 4 周同时段均值"])
    if not params.get("f_history"):
        gaps.append(["【F】可回放的历史运营数据", "P1",
                     "没有历史数据就无法校准循环时间、修正系数与 Bad Case 阈值，方案只能停留在框架层面",
                     "调度台账、发车记录、GPS 轨迹按日归档"])
    gaps.append(["【B】站点级上车/下车量与排队人数", "P1",
                 "当前按全线合计分析；站点级数据决定短线车折返点与调车路径，缺失时备选方案只能暂缓",
                 "站点人工计数或闸机分站数据，15 分钟粒度"])
    gaps.append(["【E】异常事件台账（天气、封路、故障）", "P2",
                 "缺台账时 Bad Case 阈值按经验设定，无法用历史事件检验降级方案是否有效",
                 "近 1-2 年值班记录与气象数据对照整理"])
    d.table(["缺项", "优先级", "为什么关键", "获取方式"], gaps,
            "这些缺项会改变方案的定量结论；普通信息缺失不影响继续分析，但以上各项会直接影响推荐方案的选择。",
            widths=[0.26, 0.08, 0.40, 0.26])

    d.h2("免责声明与使用边界")
    d.p("本报告由规则与计算模型生成，用于方案讨论、评审与试点设计。它不掌握实时车辆状态，也不具有调度权限。"
        "所有发车、加车、调车、限流与单向组织动作，必须由具备相应权限的工作人员依据现场情况确认后执行；"
        "涉及道路通行与运输合规的措施，须经交通管理部门与景区运营主体审核。报告中的仿真与计算结果不得表述为真实落地成效。")

    return {"blocks": d.blocks, "markdown": to_markdown(d.blocks)}


# ---------------------------------------------------------------- helpers
def _level_name(level):
    return {"realtime": "实时数据驱动（可做日内滚动）", "semi": "半实时（人工确认型滚动）",
            "low": "低数据依赖（固定班次为主）"}[level]


def _chan_name(v):
    return {"radio": "对讲机", "phone": "电话", "app": "APP/系统推送", "paper": "纸质班表"}.get(v or "", "未登记")


def _rule_name(v):
    return {"fixed": "固定间隔发车", "full_load": "满员即发", "mixed": "混合发车"}.get(v or "", "未登记")


def _src(params, key):
    s = (params.get("_sources") or {}).get(key) or {}
    return (s.get("source") or "").strip() or "用户填写"


def _summary(modes, m, val, name):
    base = modes["base"]["name"].replace("（基准）", "")
    addons = "、".join(modes["base"]["addons"][:3])
    if m["gap"] > 0:
        gap_txt = f"缺口约 {m['gap']:.0f} 人/小时，需削峰或增车"
    else:
        gap_txt = f"余量约 {abs(m['gap']):.0f} 人/小时"
    limits = []
    if m["util"] > 1:
        limits.append("运力硬缺口")
    if m["driver_gap"] > 0:
        limits.append("司机工时不足")
    if m["daily_ratio"] is not None and m["daily_ratio"] > 0.85:
        limits.append("接近核定承载量")
    if modes["level"] == "low":
        limits.append("数据条件不足")
    if val["missing_p0"]:
        limits.append(f"{len(val['missing_p0'])} 项必填缺失")
    limit = "、".join(limits) if limits else "人工确认环节与现场执行偏差"
    s = (f"推荐以{base}为主干，叠加{addons}。高峰小时需求 {m['demand_peak']:.0f} 人、"
         f"有效运力 {m['hourly_capacity']:.0f} 人（利用率 {m['util']:.0%}），{gap_txt}。"
         f"最大限制是{limit}。方案为决策支持，须经值班人员确认后执行。")
    return s if len(s) <= 200 else s[:197] + "…"


def _plan_block(d, title, plan):
    name = plan["name"]
    head = name if name == title or name.startswith(title) else f"{title}：{name}"
    d.h3(head)
    d.p(plan.get("summary", ""))
    d.p(f"适用理由：{plan.get('why', '')}")
    if plan.get("addons"):
        d.p("包含的增强项：" + "、".join(plan["addons"]))
    d.p("运行流程：")
    d.ul(plan.get("steps", []))
    if plan.get("risk"):
        d.p(f"主要风险：{plan['risk']}")


def _pct(v, default):
    try:
        return f"{float(v):.0%}"
    except (TypeError, ValueError):
        return f"假设 {default:.0%}"


def _mechanisms(params, m, val):
    systems = set(params.get("f_systems") or [])
    topo = params.get("b_topology") or "single_line"
    lat = modes_lat = None

    def num(k, d=None):
        try:
            v = params.get(k)
            return float(v) if v not in (None, "") else d
        except (TypeError, ValueError):
            return d

    lat = num("f_latency")
    top2 = num("a_top2_share", 0.5)
    split = num("a_direction_split", 0.6)
    spare = m["spare"] or 0
    drv_gap = m["driver_gap"]

    def judge(ok, why):
        return ("可迁移：" if ok else "有条件迁移：") + why

    rows = [
        ["预约/客流约束", "把不可控的到园峰值转为可预测的分时额度",
         "预约或分时入园系统；与小时运力匹配的额度规则",
         "额度按小时分配，余量不足时停止放量",
         "削峰、降低站台瞬时压力",
         "额度与运力脱节时，限流反而制造新的排队点",
         judge("ticketing" in systems, "需预约系统；" + ("已登记票务/预约系统" if "ticketing" in systems else "未登记预约系统")),
         "待核实"],
        ["日前需求预判与预排班", "把排班从当天临时决定改为前一天确定",
         "历史同时段客流、车辆与司机可用性",
         "按近 4 周同时段均值 × 节假日系数预排",
         "减少临时调车、司机排班更稳",
         "预测偏差大时会同时造成空驶与滞留",
         judge(bool(params.get("f_history")), "需可回放历史数据；" + ("已确认有历史数据" if params.get("f_history") else "未确认历史数据可导出")),
         "待核实"],
        ["分级响应", "让不同严重程度的事件对应不同的处置权限",
         "统一阈值、分级标准、值班权限表",
         "按候车人数/满载率/延迟分级触发",
         "响应一致，避免每次重新决策",
         "阈值未校准时误报或漏报",
         judge(bool(lat is not None and lat <= 30), f"需可观测的触发信号；当前数据延迟 {lat:g} 分钟" if lat is not None else "需可观测的触发信号；数据延迟未登记"),
         "待核实"],
        ["车辆调配与发车频率调整", "把运力挪到缺的地方、把间隔压到需要的密度",
         "在运车数、循环时间、司机工时余量",
         "高峰加密、平峰减班、跨线调车",
         "直接改善候车时间",
         "调车转移缺口、加密推高空驶",
         judge(m["util"] > 0.6 and drv_gap <= 0,
               f"高峰利用率 {m['util']:.0%}，" + ("司机工时有余量" if drv_gap <= 0 else "司机工时已不足")),
         "待核实"],
        ["单向或分区组织", "应对方向严重不均衡，减少对流空驶",
         "方向客流数据、可单向通行的道路、换乘点",
         "按方向比例与返程滞后决定是否单向",
         "减少空驶、提高周转",
         "增加部分旅客换乘次数，引发投诉",
         judge(split >= 0.62 and topo in ("single_line", "loop", "branch"),
               f"主导方向 {split:.0%}、拓扑 {_topo_name(topo)}"),
         "待核实"],
        ["实时分流", "在站点之间动态引导旅客，避免单点积压",
         "站点实时计数、广播与现场人员",
         "单站候车超阈值时引导至相邻站点或错峰",
         "快速缓解局部积压",
         "引导不当造成次生拥堵与投诉",
         judge(bool(lat is not None and lat <= 5) and ("station_count" in systems or "gate" in systems),
               f"需分钟级站点数据；当前延迟 {lat:g} 分钟" if lat is not None else "需分钟级站点数据；数据延迟未登记"),
         "待核实"],
        ["现场人员协同", "让调度指令在现场被执行，而不是停在纸面",
         "站务员岗位、对讲链路、回执机制",
         "站务员按点上报，调度员确认后下发",
         "缩短发现到处置的时间",
         "人员不足时上报失真",
         judge(bool(params.get("b_station_count")) and bool(params.get("f_channel")),
               f"需站务与调度在岗；{params.get('b_station_count') or '各'} 个站点需配站务员与回执链路"),
         "待核实"],
        ["应急预案调用", "在故障、封路、异常天气时快速切换到预设方案",
         "分级预案、调用权限、备用车与备用司机",
         "触发即调用，事后补审批",
         "缩短异常处置时间",
         "预案与现场不符时反而添乱",
         judge(spare >= 1, f"需备用运力；当前备用车 {spare:.0f} 辆"),
         "待核实"],
        ["执行反馈与运营复盘", "让每次调度动作可追溯，形成校准闭环",
         "调度台账、发车记录、指标口径",
         "每日复盘执行率、响应时长、缺失率",
         "参数逐步从假设变为实测",
         "台账流于形式时无法校准",
         judge(bool(params.get("f_history")) or bool(params.get("d_approval")), "需台账与责任人；当前登记有限"),
         "待核实"],
    ]
    return rows


def _topo_name(v):
    return {"single_line": "单线往返", "loop": "环线", "branch": "主线+支线", "network": "多线网络"}.get(v, v)


def _sys_name(s):
    return {"ticketing": "票务/预约", "gate": "闸机计数", "gps": "车辆 GPS",
            "video": "视频计数", "station_count": "站点人工计数"}.get(s, s)


def _inc(a, b):
    try:
        return f"+{float(b) / float(a) - 1:.0%}"
    except (TypeError, ValueError, ZeroDivisionError):
        return "按天气档位"


def _compare(params, m, modes):
    topo = _topo_name(params.get("b_topology") or "single_line")
    split = params.get("a_direction_split") or 0.6
    lat = modes["latency"]
    cap_txt = f"{m['daily_cap']:,.0f}" if m.get("daily_cap") else "未填"
    return [
        ["线路拓扑与换乘", "单线往返或环线，折返点有限，车辆按固定循环运行",
         f"{topo}，{params.get('b_station_count') or '站数未填'} 个站点，循环 {m['cycle']:.0f} 分钟",
         "拓扑决定单向/区间车是否成立；折返点不足时只能整线调度"],
        ["客流集中程度", "高峰集中在若干主站，方向不均衡明显",
         f"主导方向 {float(split):.0%}，前两站占比 {_pct(params.get('a_top2_share'), 0.5)}",
         "集中度高时短线车收益大；分散时加密全程车更稳妥"],
        ["车辆与备用能力", "车数充足、保留 10% 以上备用",
         f"可用 {m['available']:.0f} 辆，备用 {m['spare'] or 0:.0f} 辆，备用率 {(m['spare_ratio'] or 0):.0%}",
         "备用不足时任何故障都直接变成站台滞留"],
        ["周转与道路条件", "循环时间稳定、道路可双向通行",
         f"循环 {m['cycle']:.0f} 分钟，雨天 {m['cycle_rain']:.0f} 分钟",
         "循环时间波动越大，固定间隔越难维持，越需要滚动调整"],
        ["数据可用性与更新速度", "有票务、闸机与车辆定位，数据延迟在分钟级",
         f"延迟 {lat:g} 分钟，系统：{'、'.join(_sys_name(s) for s in modes['systems']) or '未登记'}",
         f"当前判定为{_level_name(modes['level'])}，实时方案只能列为升级目标"],
        ["运营主体与职责", "调度、站务、司机三方职责清晰，有审批链",
         f"审批人：{params.get('d_approval') or '未登记'}；指令链路：{_chan_name(params.get('f_channel'))}",
         "职责不清时，任何方案都会在'谁确认'这一步停滞"],
        ["安全限制与应急", "承载量、工时、道路管制有硬约束与预案",
         f"核定日承载 {cap_txt}，日客流 {m['daily_demand']:,.0f}",
         "安全红线优先于效率，方案必须在红线内留余量"],
    ]


# ---------------------------------------------------------------- render
def to_markdown(blocks):
    out = []
    for b in blocks:
        t = b["t"]
        if t == "h1":
            out.append(f"# {b['v']}\n")
        elif t == "h2":
            out.append(f"\n## {b['v']}\n")
        elif t == "h3":
            out.append(f"\n### {b['v']}\n")
        elif t == "p":
            out.append(b["v"] + "\n")
        elif t == "note":
            out.append("> " + b["v"].replace("\n", " ") + "\n")
        elif t == "ul":
            out.append("\n".join(f"- {i}" for i in b["v"]) + "\n")
        elif t == "table":
            head = [_clean(h) for h in b["head"]]
            out.append("| " + " | ".join(head) + " |")
            out.append("|" + "|".join(["---"] * len(head)) + "|")
            for r in b["rows"]:
                out.append("| " + " | ".join(_clean(c) for c in r) + " |")
            if b.get("note"):
                out.append(f"\n*{b['note']}*")
            out.append("")
    return "\n".join(out)


def _repeat_header(row):
    """表头跨页重复。"""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    trPr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:tblHeader")
    el.set(qn("w:val"), "true")
    trPr.append(el)


def _no_split(row):
    """禁止单行跨页拆分（避免表格在分页处被切成半行）。"""
    from docx.oxml import OxmlElement
    trPr = row._tr.get_or_add_trPr()
    trPr.append(OxmlElement("w:cantSplit"))


def _apply_widths(tbl, ratios, total_cm):
    """按比例设定列宽（固定布局，避免 Word 再按内容重新分配）。"""
    from docx.shared import Cm
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    tbl.autofit = False
    tblPr = tbl._tbl.tblPr
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tblPr.append(layout)
    s = sum(ratios) or 1.0
    widths = [Cm(total_cm * r / s) for r in ratios]
    for row in tbl.rows:
        for i, w in enumerate(widths):
            if i < len(row.cells):
                row.cells[i].width = w


def to_docx(blocks, path, title=""):
    from docx import Document
    from docx.shared import Pt, Cm, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.oxml.ns import qn

    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(1.8)
    sec.top_margin = sec.bottom_margin = Cm(2.0)

    normal = doc.styles["Normal"]
    normal.font.name = "宋体"
    normal.font.size = Pt(10.5)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
    normal.paragraph_format.space_after = Pt(4)
    normal.paragraph_format.line_spacing = 1.35

    for lvl, size in ((1, 16), (2, 13), (3, 11.5)):
        st = doc.styles[f"Heading {lvl}"]
        st.font.name = "黑体"
        st.font.size = Pt(size)
        st.font.color.rgb = RGBColor(0x1F, 0x38, 0x64)
        st.element.rPr.rFonts.set(qn("w:eastAsia"), "黑体")
        st.paragraph_format.space_before = Pt(10 if lvl == 1 else 8)
        st.paragraph_format.space_after = Pt(4)

    for b in blocks:
        t = b["t"]
        if t == "h1":
            doc.add_heading(b["v"], level=1)
        elif t == "h2":
            doc.add_heading(b["v"], level=2)
        elif t == "h3":
            doc.add_heading(b["v"], level=3)
        elif t == "p":
            p = doc.add_paragraph(b["v"])
            p.paragraph_format.first_line_indent = Pt(21)
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        elif t == "note":
            p = doc.add_paragraph()
            run = p.add_run(b["v"])
            run.font.size = Pt(9)
            run.font.color.rgb = RGBColor(0x59, 0x59, 0x59)
            p.paragraph_format.left_indent = Cm(0.6)
            p.paragraph_format.space_before = Pt(2)
        elif t == "ul":
            for item in b["v"]:
                p = doc.add_paragraph(item, style="List Bullet")
                p.paragraph_format.space_after = Pt(2)
                p.paragraph_format.line_spacing = 1.25
        elif t == "table":
            head = b["head"]
            tbl = doc.add_table(rows=1, cols=len(head))
            tbl.style = "Table Grid"
            tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
            tbl.autofit = True
            _repeat_header(tbl.rows[0])
            _no_split(tbl.rows[0])
            for i, h in enumerate(head):
                cell = tbl.rows[0].cells[i]
                cell.text = ""
                run = cell.paragraphs[0].add_run(_clean(h))
                run.font.bold = True
                run.font.size = Pt(9)
                run.font.name = "黑体"
                run.element.rPr.rFonts.set(qn("w:eastAsia"), "黑体")
            for r in b["rows"]:
                row = tbl.add_row()
                _no_split(row)
                cells = row.cells
                for i, c in enumerate(r[:len(head)]):
                    cells[i].text = ""
                    run = cells[i].paragraphs[0].add_run(_clean(c))
                    run.font.size = Pt(8.5)
                    run.font.name = "宋体"
                    run.element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
            if b.get("note"):
                p = doc.add_paragraph()
                run = p.add_run(b["note"])
                run.font.size = Pt(8.5)
                run.font.color.rgb = RGBColor(0x59, 0x59, 0x59)
                p.paragraph_format.space_before = Pt(2)
            if b.get("widths"):
                _apply_widths(tbl, b["widths"], 21.0 - 3.6)
    doc.save(path)
    return path
