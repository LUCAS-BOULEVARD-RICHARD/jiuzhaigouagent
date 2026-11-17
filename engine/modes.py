# -*- coding: utf-8 -*-
"""调度模式库与方案生成。

选择逻辑按"数据条件 → 需求压力 → 拓扑与客流结构"三层判断，
不因模式先进而推荐；数据不足时明确降级到低数据依赖方案。
"""
import math


def _num(v, d=None):
    try:
        if v is None or v == "":
            return d
        return float(v)
    except (TypeError, ValueError):
        return d


def _data_level(params):
    systems = set(params.get("f_systems") or [])
    lat = _num(params.get("f_latency"), 60)
    has_gps = "gps" in systems
    has_count = ("station_count" in systems) or ("gate" in systems)
    if lat is not None and lat <= 5 and has_gps and has_count:
        return "realtime", lat, systems
    if lat is not None and lat <= 30 and (has_count or "ticketing" in systems):
        return "semi", lat, systems
    return "low", lat, systems


def _params_of(m, r):
    cap_unit = m["cap_unit"] or 1
    peak = m["demand_peak"]
    cycle = m["cycle"]
    off_flow = max(1.0, peak / 3.0)
    n_off = max(1, int(math.ceil(off_flow / cap_unit)))
    n_peak = max(1, int(m["n_service"]))
    n_off = min(n_off, max(1, int(m["available"])))
    extra = max(0, int(m["fleet_need"]) - int(m["available"]))
    spare = int(m["spare"] or 0) or max(1, int(round(m["available"] * 0.1)))
    return {
        "peak_flow": peak, "off_flow": round(off_flow),
        "n_peak": n_peak, "n_off": n_off,
        "headway_peak": round(cycle / n_peak, 1),
        "headway_off": round(cycle / n_off, 1),
        "extra": extra, "spare": spare,
        "queue_trigger": int(round(m["seats"] * 1.5)),
        "wait_trigger": 15,
        "capacity": m["hourly_capacity"],
    }


def _flow_fixed(p):
    return [
        f"开园前 30 分钟：按 {p['n_off']} 辆上线，首班准点发出，间隔 {p['headway_off']:g} 分钟",
        f"进入高峰（到园客流达到 {p['peak_flow']:.0f} 人/小时）：在运车辆增至 {p['n_peak']} 辆，间隔 {p['headway_peak']:g} 分钟",
        f"高峰持续期间：每 30 分钟核对一次站台上车量，偏差超 15% 时按班表调整在运车数",
        f"高峰回落：逐级减至 {p['n_off']} 辆，末班前 60 分钟不再减车，保留 {p['spare']} 辆备用待命",
        "闭园前：末班车按固定时刻发出，站务员确认无滞留后报调度收班",
    ]


def _flow_triggered(p):
    return [
        "日前：按历史同时段客流预排班表，确定各时段基础在运车数与间隔",
        f"日内：站务员每 15 分钟上报站点候车人数；候车人数 ≥ {p['queue_trigger']} 人或预计候车 > {p['wait_trigger']} 分钟即触发加车",
        "调度员核对车辆与司机可用性，确认后从备用车或低负荷线路调车，下达发车指令",
        "司机回执后记录实际发车时刻，调度员在台账登记触发原因与处置结果",
        "高峰结束后 30 分钟内完成一次复盘：触发次数、响应时长、是否出现新滞留点",
    ]


def _flow_data(p):
    return [
        "日前：用近 4 周同时段数据预排班表，标注高峰阈值与备用车投放位置",
        "日内：系统每 5 分钟刷新各站点候车人数与车辆位置，超阈值自动生成加车建议",
        f"建议进入人工确认：调度员核对道路与车辆状态，确认后下发指令（阈值：候车 ≥ {p['queue_trigger']} 人或 GPS 显示区间间隔 > {p['headway_peak'] * 1.5:g} 分钟）",
        "执行反馈：司机端确认接单与实际发车，系统比对计划与实际偏差",
        "闭环复盘：每日输出计划执行率、数据缺失率、平均响应时长",
    ]


def recommend(params, metrics, sim=None):
    level, lat, systems = _data_level(params)
    p = _params_of(metrics, {})

    util = metrics["util"]
    top2 = _num(params.get("a_top2_share"), 0.5)
    split = _num(params.get("a_direction_split"), 0.6)
    lag = _num(params.get("a_return_lag"), 2.0)
    topo = params.get("b_topology") or "single_line"
    daily_ratio = metrics.get("daily_ratio")
    gate = (daily_ratio is not None and daily_ratio > 0.85) or util > 1.0

    cat = []

    def add(mid, name, tag, applies, reason, conditions, not_for, data_needs, constraints, approvals, flow):
        cat.append({
            "id": mid, "name": name, "tag": tag, "applies": applies, "reason": reason,
            "conditions": conditions, "not_for": not_for, "data_needs": data_needs,
            "constraints": constraints, "approvals": approvals, "flow": flow,
        })

    add("fixed", "固定间隔发车", "低数据依赖",
        True,
        f"按循环时间 {metrics['cycle']:g} 分钟与在运车数即可算出间隔，不依赖实时数据；作为任何方案的地基。",
        "站点固定、循环时间稳定、客流日间波动可预排",
        "循环时间波动超过 30%、或站点间需求差异极大的场景",
        "循环时间与在运车数",
        "间隔过短会导致车辆在站内排队，占用站台",
        "调度长确认班表",
        _flow_fixed(p))

    add("peak_boost", "高峰加密", "低数据依赖",
        util > 0.75,
        f"高峰小时利用率 {util:.0%}，加密是最直接的运力响应；需车辆与司机同时具备。" if util > 0.75
        else f"高峰小时利用率 {util:.0%}，尚未到必须加密的程度，加密会推高空驶。",
        "有可增投车辆且司机工时有余量",
        "司机工时已用满时不可执行（本景区司机余量 " +
        (f"{metrics['driver_avail_hours'] - metrics['driver_need_hours']:.0f} 人·小时" ) + "）",
        "分时客流与车辆可用性",
        "不得以延长工时补运力",
        "值班经理确认加车",
        ["高峰前 30 分钟完成车辆与司机到位", _flow_fixed(p)[1], "高峰结束后按计划减车，避免空驶"])

    add("shuttle", "区间车/短线车", "中数据依赖",
        top2 >= 0.55,
        f"前两站上车占比 {top2:.0%}，集中度高，短线车可缩短周转、提高单位时间运力。" if top2 >= 0.55
        else f"前两站上车占比 {top2:.0%}，客流分散，短线车的收益有限，反而增加换乘与站台压力。",
        "存在明显的主客流段与可折返的中间站点",
        "站点间距均匀、客流全程分布均匀时不适用",
        "站点上下车量与折返点条件",
        "折返点需具备停车与掉头空间，不得占用消防通道",
        "调度长确认折返点与班次",
        ["选定折返站，明确短线车只跑主客流段", "短线车间隔按主客流段需求单独计算", "与全程车错开发车，避免站台同时积压", "向乘客公示短线车终点，避免误乘"])

    add("oneway", "单向循环/分区运营", "中数据依赖",
        split >= 0.62 and lag >= 1.5 and topo in ("single_line", "loop", "branch"),
        f"主导方向占比 {split:.0%}、返程高峰滞后 {lag:g} 小时，方向不均衡明显，单向组织可减少空驶。"
        if (split >= 0.62 and lag >= 1.5) else
        f"方向占比 {split:.0%}、滞后 {lag:g} 小时，方向不均衡不明显，单向组织会额外增加乘客换乘。",
        "道路允许单向组织，且有可用的换乘点",
        "双向需求接近、或道路不具备单向通行条件时不适用",
        "方向客流、道路通行条件",
        "单向组织可能延长部分乘客的乘车时间，需评估可接受度",
        "景区运营负责人 + 交通管理部门",
        ["确定单向区段与换乘点", "重新计算单向循环时间", "编制换乘引导与广播词", "试运行 1-2 天并观测投诉与滞留"])

    add("standby", "备用车待命与临时加车", "低数据依赖",
        True,
        f"备用车 {p['spare']} 辆，是全方案唯一的故障与突发兜底手段。",
        "有可随时顶班的车辆与司机",
        "备用车同时承担维保或充电任务时不可用",
        "车辆状态与司机待命安排",
        "备用车不得计入常规排班",
        "调度员直接调用，事后报备",
        ["备用车停放在 15 分钟内可达主要站点的位置", "司机待命期间不计驾驶工时，但需在岗", "调用后 2 小时内补齐备用车"])

    add("reservation", "预约引导与分时段返程", "需求侧",
        gate,
        "客流接近或超过承载量/运力时，削峰比加车更安全、更便宜。" if gate else
        "当前未触及承载量或运力红线，预约引导的边际收益低于运力组织。",
        "已有预约或分时入园机制",
        "无预约系统时无法执行，只能靠广播与团队错峰",
        "预约量与分时入园数据",
        "不得以削峰为名超售",
        "运营负责人",
        ["按小时设定预约额度，额度与小时运力匹配", "返程高峰前 2 小时推送分时返程提示", "对团队客单独排定到园与离园时段"])

    add("manual_rolling", "人工上报驱动的滚动调度", "中数据依赖",
        level == "semi",
        f"数据延迟 {lat:g} 分钟、具备闸机或站点计数，可支撑 15-30 分钟级的人工确认调整。",
        "有稳定的站点上报与对讲/电话链路",
        "数据缺失率高或上报不及时时不适用",
        "站点候车人数、车辆位置、对讲链路",
        "上报口径需统一，否则触发阈值失真",
        "调度员 + 值班经理",
        _flow_triggered(p))

    add("data_rolling", "GPS/闸机驱动的滚动调度", "高数据依赖",
        level == "realtime",
        f"数据延迟 {lat:g} 分钟且有 GPS 与计数设备，具备 5-15 分钟决策周期的条件。"
        if level == "realtime" else
        f"当前数据延迟 {lat:g} 分钟或缺少 GPS/计数设备，暂不具备实时滚动调度条件，只能作为升级目标。",
        "GPS 覆盖全部运营车辆、站点计数准确率可接受、指令链路有回执",
        "数据延迟 > 5 分钟、或无法接收执行反馈时不适用",
        "GPS、闸机/站点计数、指令下发与回执",
        "自动建议必须保留人工确认，不得由模型直接派车",
        "调度员确认，值班经理对超阈值调整负责",
        _flow_data(p))

    base_id = {"realtime": "data_rolling", "semi": "manual_rolling", "low": "fixed"}[level]
    if level == "low":
        base_id = "fixed"
    addons = ["peak_boost"] if util > 0.75 else []
    if top2 >= 0.55:
        addons.append("shuttle")
    # 单向/分区组织组织成本高，只作为备选方案，不放进基准增强项
    if gate:
        addons.append("reservation")
    addons.append("standby")

    by_id = {c["id"]: c for c in cat}
    base = by_id[base_id]

    def plan(pid, name, summary, addon_ids, why, risk):
        return {
            "id": pid, "name": name, "summary": summary,
            "why": why, "risk": risk,
            "steps": base["flow"] if pid in ("base", "upgrade", "simplified") else by_id[pid]["flow"],
            "addons": [by_id[a]["name"] for a in addon_ids],
            "params": p,
        }

    base_plan = plan("base", base["name"],
                     f"以前述「{base['name']}」为主干，叠加 {len(addons)} 项增强（各项成本与组织要求见下）。",
                     addons, base["reason"],
                     "基准方案依赖当前数据条件，若数据中断需降级到固定班次。")

    alt_pool = [c for c in cat if c["id"] in ("shuttle", "oneway", "reservation") and c["applies"]]
    alt_pool.sort(key=lambda c: {"shuttle": 0, "oneway": 1, "reservation": 2}[c["id"]])
    alternatives = []
    for c in alt_pool[:2]:
        alternatives.append({
            "id": c["id"], "name": c["name"],
            "summary": f"以{c['name']}为主线的备选，解决同一问题的不同路径。",
            "why": c["reason"], "conditions": c["conditions"], "not_for": c["not_for"],
            "constraints": c["constraints"], "approvals": c["approvals"],
            "steps": c["flow"], "risk": "切换主线的组织成本高于基准方案，需先小范围试运行。",
        })

    simplified = {
        "id": "simplified", "name": "当前数据条件下的简化方案",
        "summary": "固定间隔 + 高峰加密 + 备用车待命，全部由纸面班表与对讲机执行，不依赖实时数据。",
        "why": f"数据延迟 {lat:g} 分钟、指令链路为{_chan_name(params.get('f_channel'))}，实时调度不具备可执行条件；"
               "该方案在现有条件下即可运行，可覆盖靠经验预判得到的日内波动，但突发波动只能被动响应。",
        "risk": "对突发大客流只能被动响应，响应时长取决于人工发现速度（通常 10-20 分钟）。",
        "steps": _flow_fixed(p), "addons": ["高峰加密", "备用车待命"], "params": p,
    }

    upgrade = {
        "id": "upgrade", "name": "数据完善后的升级方案",
        "summary": "日前预排班 + 日内 GPS/站点计数驱动的滚动调度，保留人工确认。",
        "why": "把决策周期从 30 分钟压到 10 分钟以内，前提是 GPS 全覆盖、计数准确率可接受、指令有回执。",
        "risk": "数据错误会直接转化为错误派车；必须设置数据质量门限与自动降级。",
        "steps": _flow_data(p), "addons": ["滚动调度", "备用车待命", "预约削峰"], "params": p,
        "prerequisites": [
            f"端到端数据延迟 ≤ 5 分钟（当前 {lat:g} 分钟）",
            "GPS 覆盖全部运营车辆，位置刷新 ≤ 30 秒",
            "站点计数或闸机数据缺失率 ≤ 5%",
            "指令下发有回执（对讲回执或司机端确认）",
        ],
    }

    return {
        "level": level, "latency": lat, "systems": sorted(systems),
        "base": base_plan, "alternatives": alternatives,
        "simplified": simplified, "upgrade": upgrade,
        "catalog": cat, "params": p,
        "note": "模式推荐由数据条件、需求压力与客流结构三层规则得出，不是最优解求解；最终方案须由有权限的工作人员确认。",
    }


def _chan_name(v):
    return {"radio": "对讲机", "phone": "电话", "app": "APP/系统推送", "paper": "纸质班表"}.get(v or "", "未登记")
