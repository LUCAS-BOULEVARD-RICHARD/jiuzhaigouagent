# -*- coding: utf-8 -*-
"""参数校验：缺项、可疑值、口径冲突。"""
from .schema import FIELDS, FIELD_MAP, P0_KEYS


def _num(v):
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def validate(params):
    issues = []
    for f in FIELDS:
        k = f["key"]
        v = params.get(k)
        empty = v in (None, "", [], {})
        if empty and f["prio"] == "P0":
            issues.append({
                "key": k, "label": f["label"], "prio": f["prio"], "status": "missing",
                "msg": "必填项缺失：" + f["impact"],
            })
        elif empty and f["prio"] == "P1":
            issues.append({
                "key": k, "label": f["label"], "prio": f["prio"], "status": "assumed",
                "msg": "未填，将按默认假设计算：" + f["impact"],
            })

    n = lambda k: _num(params.get(k))
    cycle, oneway = n("b_cycle_time"), n("b_oneway_time")
    if cycle and oneway and cycle < oneway * 1.5:
        issues.append({"key": "b_cycle_time", "label": "平均循环时间", "prio": "P0", "status": "suspect",
                       "msg": f"循环时间 {cycle:g} 分钟不足单程 {oneway:g} 分钟的 1.5 倍，口径可能写成了单程"})
    peak, daily = n("a_peak_hour_flow"), max([x for x in [n("a_daily_holiday"), n("a_daily_normal")] if x] or [0])
    if peak and daily and peak > daily:
        issues.append({"key": "a_peak_hour_flow", "label": "高峰小时客流", "prio": "P0", "status": "suspect",
                       "msg": "高峰小时客流大于日客流，两者口径不一致"})
    if peak and daily and daily and peak / daily > 0.45:
        issues.append({"key": "a_peak_share", "label": "峰均结构", "prio": "P1", "status": "suspect",
                       "msg": f"高峰小时占日客流 {peak / daily:.0%}，极端集中，需核对是否为瞬时积压"})
    seats = n("c_seats")
    if seats and (seats < 6 or seats > 70):
        issues.append({"key": "c_seats", "label": "单车核定载客量", "prio": "P0", "status": "suspect",
                       "msg": f"{seats:g} 座/辆超出常见景区观光车范围，确认是否为车型均值"})
    tot, avail = n("c_bus_total"), n("c_bus_available")
    if tot and avail and avail > tot:
        issues.append({"key": "c_bus_available", "label": "可投入运营车辆数", "prio": "P0", "status": "suspect",
                       "msg": "可投入车辆数大于车辆总数"})
    share = n("a_peak_share")
    if share is not None and 0 <= share <= 1 and share < 0.02:
        issues.append({"key": "a_peak_share", "label": "高峰小时占比", "prio": "P1", "status": "suspect",
                       "msg": "比例低于 2%，可能是百分数误填（16 应为 0.16）"})
    for k in ("a_direction_split", "a_top2_share", "c_load_coef", "b_rain_increase", "f_missing"):
        val = n(k)
        if val is not None and (val < 0 or val > 1):
            issues.append({"key": k, "label": FIELD_MAP[k]["label"], "prio": "P1", "status": "suspect",
                           "msg": "取值应在 0-1 之间"})
    s, e = n("d_op_start"), n("d_op_end")
    if s is not None and e is not None and e <= s:
        issues.append({"key": "d_op_end", "label": "运营结束时刻", "prio": "P0", "status": "suspect",
                       "msg": "结束时刻不晚于开始时刻"})
    lat = n("f_latency")
    if lat is not None and lat < 0:
        issues.append({"key": "f_latency", "label": "数据可用延迟", "prio": "P0", "status": "suspect",
                       "msg": "延迟不能为负"})

    filled_p0 = sum(1 for k in P0_KEYS if params.get(k) not in (None, "", [], {}))
    return {
        "issues": issues,
        "p0_total": len(P0_KEYS),
        "p0_filled": filled_p0,
        "completeness": round(filled_p0 / len(P0_KEYS), 3),
        "missing_p0": [k for k in P0_KEYS if params.get(k) in (None, "", [], {})],
        "blocking": [i for i in issues if i["status"] == "missing"],
    }
