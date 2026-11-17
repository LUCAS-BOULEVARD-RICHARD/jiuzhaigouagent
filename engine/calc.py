# -*- coding: utf-8 -*-
"""运力计算、安全校验、分时排班、敏感性分析。

口径：
- 平均循环时间 = 车辆从起点发车回到起点的平均时间，往返，含上下客与站内排队。
- 小时有效运力 = 可用车辆数 × 单车有效座位数 × 60 ÷ 平均循环时间 × 运营修正系数。
- 单车有效座位数 = 核定载客量 × 1（不额外打折）；运营修正系数单独承担折减，两者不重复折算。
"""
import math
from .schema import FIELD_MAP


def _num(v):
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _str(v):
    return (v or "").strip() if isinstance(v, str) else ("" if v is None else str(v))


def parse_profile(text):
    out = []
    for part in _str(text).replace("，", ",").replace("；", ",").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(float(part))
        except ValueError:
            return []
    return out


def _curve(t):
    a = math.exp(-((t - 0.30) ** 2) / (2 * 0.10 ** 2))
    b = math.exp(-((t - 0.78) ** 2) / (2 * 0.09 ** 2))
    return 0.45 + 0.55 * a + 0.25 * b


def resolve(params):
    """把可缺省参数补齐，并记录每一处假设（key -> 理由）。"""
    asm = {}

    def need(key, default, why):
        v = _num(params.get(key))
        if v is None:
            asm[key] = {"label": FIELD_MAP[key]["label"], "value": default, "why": why}
            return float(default)
        return v

    total = _num(params.get("c_bus_total"))
    spare = _num(params.get("c_bus_spare"))
    avail_raw = _num(params.get("c_bus_available"))
    if avail_raw is not None:
        available = avail_raw
    elif total is not None:
        available = max(1.0, total - (spare or 0))
        asm["c_bus_available"] = {"label": "可投入运营车辆数",
                                  "value": available,
                                  "why": "按车辆总数扣除备用车推算，备用车数亦可能为假设"}
    else:
        available = 10.0
        asm["c_bus_available"] = {"label": "可投入运营车辆数", "value": 10,
                                  "why": "缺车辆数据，取 10 辆作演示性假设，结论仅供框架参考"}

    seats = need("c_seats", 35, "景区观光车常见 30-40 座，取 35 座中值；与实际车型可能不符")
    cycle = need("b_cycle_time", 90, "取 90 分钟往返循环作为分析假设")
    coef = need("c_load_coef", 0.85, "取 0.85 折算上下客波动、排队与调度空档")
    start = need("d_op_start", 8.0, "按 08:00 开园假设")
    end = need("d_op_end", 18.0, "按 18:00 末班假设")
    op_hours = max(0.5, end - start)

    daily = None
    for k in ("a_daily_holiday", "a_daily_weekend", "a_daily_normal"):
        daily = _num(params.get(k))
        if daily:
            break
    if not daily:
        daily = 8000.0
        asm["a_daily_normal"] = {"label": "日客流量", "value": 8000,
                                 "why": "缺客流数据，取 8000 人/日演示性假设"}

    peak = _num(params.get("a_peak_hour_flow"))
    if peak is None:
        share = _num(params.get("a_peak_share")) or 0.16
        peak = daily * share
        asm["a_peak_hour_flow"] = {"label": "高峰小时客流", "value": round(peak, 1),
                                   "why": f"按日客流 × 高峰占比 {share:.2f} 折算，占比缺省取 0.16"}

    split = _num(params.get("a_direction_split"))
    if split is None:
        split = 0.6
        asm["a_direction_split"] = {"label": "主导方向占比", "value": split,
                                    "why": "缺方向数据，按去程 60%/返程 40% 假设"}
    top2 = _num(params.get("a_top2_share"))
    if top2 is None:
        top2 = 0.5
        asm["a_top2_share"] = {"label": "前两站上车占比", "value": top2,
                               "why": "缺站点分布，按前两站 50% 假设"}

    driver = _num(params.get("c_driver_total"))
    if driver is None:
        driver = available
        asm["c_driver_total"] = {"label": "可排班司机人数", "value": driver,
                                 "why": "缺司机数据，按一车一人假设，真实情况通常更紧"}
    shift = need("c_driver_shift", 8, "按单班 8 小时假设")
    dmax = need("c_driver_max", 8, "按日驾驶上限 8 小时兜底，需与当地规定核对")

    r = {
        "available": available, "total": total, "spare": spare,
        "seats": seats, "cycle": cycle, "coef": coef,
        "start": start, "end": end, "op_hours": op_hours,
        "daily": daily, "peak": peak, "split": split, "top2": top2,
        "driver": driver, "shift": shift, "dmax": dmax,
    }
    return r, asm


def _capacity(vehicles, seats, cycle, coef):
    if cycle <= 0:
        return 0.0
    return vehicles * seats * 60.0 / cycle * coef


def compute(params):
    r, asm = resolve(params)
    seats, cycle, coef = r["seats"], r["cycle"], r["coef"]
    available, peak = r["available"], r["peak"]

    cap_unit = seats * 60.0 / cycle * coef           # 单车小时有效运力（人/小时·辆）
    hourly_capacity = _capacity(available, seats, cycle, coef)
    util = peak / hourly_capacity if hourly_capacity else 0.0
    fleet_need = int(math.ceil(peak / cap_unit)) if cap_unit else 0
    n_service = int(min(max(1, fleet_need), max(1, int(available))))
    headway = cycle / n_service if n_service else cycle
    actual_load = peak / (n_service * cap_unit) if n_service and cap_unit else 0.0

    rain = _num(params.get("b_rain_increase"))
    if rain is None:
        rain = 0.2
        asm["b_rain_increase"] = {"label": "雨天循环时间增幅", "value": rain, "why": "缺天气记录，按 +20% 假设"}
    cycle_rain = cycle * (1 + rain)
    cap_rain = _capacity(available, seats, cycle_rain, coef)

    need_driver_hours = n_service * r["op_hours"]
    avail_driver_hours = r["driver"] * r["shift"] * 0.9
    driver_need_fte = math.ceil(need_driver_hours / (r["shift"] * 0.9)) if r["shift"] else 0
    driver_gap = need_driver_hours - avail_driver_hours

    cap_daily = _num(params.get("d_capacity_daily"))
    daily_ratio = (r["daily"] / cap_daily) if cap_daily else None

    metrics = {
        "available": available, "total": r["total"], "spare": r["spare"],
        "seats": seats, "cycle": cycle, "coef": coef,
        "cap_unit": round(cap_unit, 1),
        "hourly_capacity": round(hourly_capacity, 0),
        "demand_peak": round(peak, 0),
        "util": round(util, 3),
        "gap": round(peak - hourly_capacity, 0),
        "fleet_need": fleet_need, "n_service": n_service,
        "headway": round(headway, 1),
        "actual_load": round(actual_load, 3),
        "op_hours": r["op_hours"],
        "driver_need_hours": round(need_driver_hours, 1),
        "driver_avail_hours": round(avail_driver_hours, 1),
        "driver_need_fte": driver_need_fte,
        "driver_total": r["driver"],
        "driver_gap": round(driver_gap, 1),
        "daily_demand": round(r["daily"], 0),
        "daily_cap": cap_daily,
        "daily_ratio": round(daily_ratio, 3) if daily_ratio is not None else None,
        "cycle_rain": round(cycle_rain, 1),
        "cap_rain": round(cap_rain, 0),
        "gap_rain": round(peak - cap_rain, 0),
        "spare_ratio": round((r["spare"] or 0) / r["total"], 3) if r["total"] else None,
    }

    checks = _checks(params, metrics, r)
    schedule = _schedule(params, metrics, r, cap_unit)
    sensitivity = _sensitivity(metrics, r, seats, coef, rain)
    return {
        "metrics": metrics,
        "assumptions": asm,
        "checks": checks,
        "schedule": schedule,
        "sensitivity": sensitivity,
        "resolved": {k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items()},
    }


def _checks(params, m, r):
    out = []

    def add(level, title, detail, basis):
        out.append({"level": level, "title": title, "detail": detail, "basis": basis})

    if m["daily_ratio"] is not None:
        if m["daily_ratio"] > 1:
            add("红线", "日客流已超核定承载量",
                f"日客流 {m['daily_demand']:.0f} 人 > 核定 {m['daily_cap']:.0f} 人（{m['daily_ratio']:.0%}）。"
                "任何加密发车的方案都不能替代限流，必须先按承载量核定执行预约与分流。",
                "核定承载量是安全红线，优先于效率与成本")
        elif m["daily_ratio"] > 0.85:
            add("警示", "日客流接近核定承载量",
                f"已达 {m['daily_ratio']:.0%}，站内积压风险上升，需预置限流与分批放行。",
                "余量不足 15% 时，调度应服从限流")

    if m["util"] > 1.0:
        add("红线", "高峰小时运力不足",
            f"高峰小时需求 {m['demand_peak']:.0f} 人 > 小时有效运力 {m['hourly_capacity']:.0f} 人，"
            f"缺口约 {abs(m['gap']):.0f} 人/小时，按现有车与循环时间满载率需 {m['actual_load']:.0%}。"
            "只能通过削峰（预约分时、错峰引导）、缩短循环时间或增加车辆解决。",
            "满载率超过 100% 意味着有人上不了车，属运力硬缺口")
    elif m["util"] > 0.9:
        add("警示", "高峰小时无安全余量",
            f"利用率 {m['util']:.0%}，任一车辆故障或循环时间延长即出现滞留。", "调度需保留 10%-15% 余量")
    else:
        add("提示", "高峰小时运力有余量",
            f"利用率 {m['util']:.0%}，可支撑小幅加密或临时加车。", "余量可用于吸收客流波动")

    if m["driver_gap"] > 0:
        add("红线", "司机工时不足，加车方案不可执行",
            f"维持 {m['n_service']} 辆车需要约 {m['driver_need_hours']:.0f} 人·小时，"
            f"可排班司机仅能提供 {m['driver_avail_hours']:.0f} 人·小时（按 90% 出勤折减）。"
            "不得用延长工时的办法补足。",
            "连续驾驶与日工时上限是法规红线")
    elif m["driver_gap"] > -0.1 * m["driver_avail_hours"]:
        add("警示", "司机工时余量不足 10%",
            f"需 {m['driver_need_hours']:.0f} 人·小时 / 可用 {m['driver_avail_hours']:.0f} 人·小时，"
            "临时加车空间很小，突发大客流只能靠调间隔与跨线调车。",
            "司机是比车辆更常见的真实瓶颈")

    if m["spare_ratio"] is not None and m["spare_ratio"] < 0.1:
        add("警示", "备用车比例偏低",
            f"备用率 {m['spare_ratio']:.0%}，低于 10% 时故障顶班能力不足。", "应急运力需留 10% 以上备用")

    lat = _num(params.get("f_latency"))
    if lat is not None and lat > 15:
        add("提示", "数据延迟不支持分钟级滚动调度",
            f"端到端延迟 {lat:g} 分钟，只能做 30 分钟级的人工确认型调整，不宜上实时自动派车。",
            "决策周期必须与数据延迟匹配")

    systems = params.get("f_systems") or []
    if not systems:
        add("提示", "未登记任何数据系统",
            "运力与客流判断将依赖人工上报，方案默认按低数据依赖设计。", "数据条件是方案分档的前提")

    if not params.get("c_load_coef"):
        add("提示", "运营修正系数取默认 0.85",
            "该系数直接放大或缩小运力结论，试点期应用实测上下客时间校准。", "系数为经验值而非实测")
    return out


def _schedule(params, m, r, cap_unit):
    start, end = r["start"], r["end"]
    n_hours = int(round(end - start))
    n_hours = max(1, n_hours)
    prof = parse_profile(params.get("a_profile"))
    if prof and len(prof) >= 2:
        profile, prof_src = prof, "用户提供分时数据"
        scale = (r["peak"] / max(profile)) if max(profile) > 0 else 1.0
        flows = [p * scale for p in profile]
        if len(flows) != n_hours:
            flows = _resample(flows, n_hours)
    else:
        vals = [_curve((i + 0.5) / n_hours) for i in range(n_hours)]
        mx = max(vals)
        flows = [r["peak"] * v / mx for v in vals]
        prof_src = "假设日内曲线（早高峰 10:00 附近，下午返程次高峰）"

    rows = []
    for i, flow in enumerate(flows):
        need = flow / cap_unit if cap_unit else 0
        veh = int(min(max(1, math.ceil(need)), max(1, int(r["available"]))))
        headway = r["cycle"] / veh
        util = need / veh if veh else 0
        h0 = start + i
        rows.append({
            "slot": f"{int(h0):02d}:00-{int(h0) + 1:02d}:00",
            "flow": round(flow), "veh": veh,
            "headway": round(headway, 1),
            "util": round(util, 3),
            "over": util > 1.0,
        })
    return {"rows": rows, "source": prof_src, "peak": round(r["peak"])}


def _resample(vals, n):
    out = []
    for i in range(n):
        pos = i * (len(vals) - 1) / max(1, n - 1)
        lo = int(math.floor(pos))
        hi = min(len(vals) - 1, lo + 1)
        out.append(vals[lo] + (vals[hi] - vals[lo]) * (pos - lo))
    return out


def _sensitivity(m, r, seats, coef, rain):
    peak = r["peak"]
    base = dict(veh=r["available"], cycle=r["cycle"], seats=seats, coef=coef)
    scenarios = [
        ("基线（当前参数）", dict(base), "按当前车数、循环时间与修正系数"),
        (f"雨天循环时间 +{rain:.0%}", dict(base, cycle=r["cycle"] * (1 + rain)), "湿滑限速与上下客变慢"),
        ("可用车减少 2 辆", dict(base, veh=max(1, r["available"] - 2)), "故障、维保或充电占用"),
        ("循环时间 +30%", dict(base, cycle=r["cycle"] * 1.3), "拥堵、临时绕行、会车等待"),
        ("高峰客流 +15%", dict(base), "预测偏低或团队集中到园"),
    ]
    out = []
    for name, cfg, note in scenarios:
        cap = _capacity(cfg["veh"], cfg["seats"], cfg["cycle"], cfg["coef"])
        dem = peak * 1.15 if name.startswith("高峰客流") else peak
        out.append({
            "name": name,
            "veh": round(cfg["veh"], 1), "cycle": round(cfg["cycle"], 1),
            "capacity": round(cap), "demand": round(dem),
            "gap": round(dem - cap, 0),
            "util": round(dem / cap, 3) if cap else 0,
            "note": note,
        })
    return out
