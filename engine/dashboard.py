# -*- coding: utf-8 -*-
"""数据装配层：把 analyze() 的结果整理成界面要的形状。

这里不重新发明计算结论。所有百分比、缺口、班次都来自 calc / sim / modes / badcases；
本模块只做四件事：换单位、加证据标签、把“结论”拆成“可以操作的卡片”、补 UI 所需的元信息。
"""
import math
from datetime import datetime

import config
from . import badcases, calc, modes, scenes, sim, validate, workflow
from .schema import FIELDS, FIELD_MAP, GROUPS, P0_KEYS

STATUS_LABEL = {
    "red": "越线", "warn": "警戒", "ok": "正常", "info": "提示",
    "missing": "缺项", "assumed": "假设", "suspect": "可疑", "filled": "已填",
}


def _num(v, default=0):
    try:
        if v is None or v == "":
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def _int(v):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return 0


def _pct(v, digits=1):
    try:
        return f"{float(v) * 100:.{digits}f}%"
    except (TypeError, ValueError):
        return "—"


def _margin_status(margin):
    if margin < 0:
        return "red"
    if margin < 0.15:
        return "warn"
    return "ok"


def _evidence(source, fallback="input"):
    if isinstance(source, dict) and source.get("evidence"):
        e = source["evidence"]
        ids = {x["id"] for x in config.EVIDENCE} | {x["label"] for x in config.EVIDENCE}
        if e in ids:
            return e
    return fallback


def _role(role_id=None):
    if isinstance(role_id, dict):
        return role_id
    return config.ROLE_MAP.get(role_id or config.DEFAULT_ROLE, config.ROLE_MAP[config.DEFAULT_ROLE])


def _public_role(role):
    return {k: role[k] for k in ("id", "name", "short", "desc", "default_page", "perms")}


def _permissions(role):
    ps = set(role.get("perms") or [])
    return {
        "view": True,
        "edit_params": "edit_params" in ps,
        "plan": "plan" in ps,
        "decide_normal": "decide_normal" in ps,
        "decide_emergency": "decide_emergency" in ps,
        "dispatch": "dispatch" in ps,
        "report": "report" in ps,
        "writeback": "writeback" in ps,
        "export": "export" in ps,
    }


def _pages_for(role):
    rid = role["id"]
    return [p["id"] for p in config.PAGES if rid in config.PAGE_ACCESS.get(p["id"], set())]


def _project(project, name, project_id):
    project = project or {}
    pid = project.get("id") or project_id or "demo"
    pname = project.get("name") or name or pid
    demo = bool(project.get("demo", True))
    return {
        "id": pid, "name": pname, "demo": demo,
        "note": project.get("note", ""), "saved": project.get("saved", ""),
        "date": config.DEMO_DATE if demo else datetime.now().strftime("%Y-%m-%d"),
    }


def _field_display(f, v):
    if v in (None, "", [], {}):
        dv = f.get("default")
        if dv in (None, "", [], {}):
            return ""
        v = dv
    typ = f.get("type")
    if typ == "multi":
        opts = dict((str(a), b) for a, b in (f.get("options") or []))
        vals = v if isinstance(v, list) else [v]
        return " / ".join(opts.get(str(x), str(x)) for x in vals if str(x) != "")
    if typ == "select":
        opts = dict((str(a), b) for a, b in (f.get("options") or []))
        return opts.get(str(v), str(v))
    if typ == "bool":
        return "是" if bool(v) else "否"
    if typ == "num":
        try:
            fv = float(v)
            if FIELD_MAP[f["key"]].get("unit") == "0-1":
                return f"{fv:g}（{fv:.0%}）"
            if abs(fv - round(fv)) < 1e-9:
                return f"{int(round(fv)):,}"
            return f"{fv:,.1f}"
        except (TypeError, ValueError):
            return str(v)
    return str(v)


# ---------------------------------------------------------------- params
def build_params(params, analysis, field_errors=None):
    issues = {}
    for i in (analysis.get("issues") or []):
        k = i.get("key")
        if not k:
            continue
        # missing 优先于 assumed，suspect 单独覆盖
        old = issues.get(k)
        if not old or i.get("status") == "suspect" or (i.get("status") == "missing" and old.get("status") != "suspect"):
            issues[k] = i
    assumptions = analysis.get("assumptions") or {}
    sources = params.get("_sources") or {}
    rows = []
    group_counts = {g["id"]: {"total": 0, "filled": 0, "p0": 0, "p0_filled": 0, "missing": 0, "assumed": 0, "suspect": 0}
                    for g in GROUPS}
    for f in FIELDS:
        k = f["key"]
        v = params.get(k)
        empty = v in (None, "", [], {})
        issue = issues.get(k)
        asm = assumptions.get(k)
        if empty and f["prio"] == "P0":
            status = "missing"
        elif issue:
            status = issue.get("status") or ("suspect" if not empty else "assumed")
        elif empty:
            status = "assumed" if (asm or f.get("default") not in (None, "", [], {})) else "empty"
        else:
            status = "filled"
        src = sources.get(k) if isinstance(sources.get(k), dict) else {}
        ev = _evidence(src, "assumed" if status in ("assumed", "missing") else "input")
        row = {
            "key": k, "label": f["label"], "group": f["group"], "type": f["type"],
            "unit": f.get("unit", ""), "prio": f["prio"], "help": f.get("help", ""),
            "impact": f.get("impact", ""), "options": f.get("options") or [],
            "value": v, "display": _field_display(f, v), "empty": empty,
            "status": status, "status_label": STATUS_LABEL.get(status, status),
            "evidence": ev,
            "source": src.get("source") or ("程序默认/假设" if empty else "项目填报"),
            "conf": src.get("conf") or ("—" if empty else "未核验"),
            "assumption": asm,
            "issue": issue,
            "default": f.get("default"),
            "default_display": _field_display(f, f.get("default")),
        }
        rows.append(row)
        g = group_counts[f["group"]]
        g["total"] += 1
        g["filled"] += 0 if empty else 1
        if f["prio"] == "P0":
            g["p0"] += 1
            if not empty:
                g["p0_filled"] += 1
        if status == "missing":
            g["missing"] += 1
        elif status == "assumed":
            g["assumed"] += 1
        elif status == "suspect":
            g["suspect"] += 1
    counts = {
        "total": len(rows),
        "filled": sum(1 for r in rows if r["status"] == "filled"),
        "assumed": sum(1 for r in rows if r["status"] in ("assumed", "missing")),
        "missing": sum(1 for r in rows if r["status"] == "missing"),
        "suspect": sum(1 for r in rows if r["status"] == "suspect"),
        "p0": len(P0_KEYS),
        "p0_filled": analysis.get("p0_filled", 0),
        "p1": sum(1 for r in rows if r["prio"] == "P1"),
    }
    groups = []
    for g in GROUPS:
        c = group_counts[g["id"]]
        groups.append({
            "id": g["id"], "name": g["name"], "desc": g["desc"],
            "total": c["total"], "filled": c["filled"], "p0": c["p0"],
            "p0_filled": c["p0_filled"], "missing": c["missing"],
            "assumed": c["assumed"], "suspect": c["suspect"],
            "completeness": round(c["p0_filled"] / c["p0"], 3) if c["p0"] else 1,
        })
    assumption_list = []
    for k, a in assumptions.items():
        f = FIELD_MAP.get(k) or {}
        assumption_list.append({
            "key": k, "label": a.get("label") or f.get("label", k),
            "value": a.get("value"), "why": a.get("why", ""),
            "group": f.get("group", ""), "impact": f.get("impact", ""),
        })
    return {
        "fields": rows,
        "groups": groups,
        "counts": counts,
        "issues": analysis.get("issues") or [],
        "assumptions": assumption_list,
        "completeness": analysis.get("completeness", 0),
        "p0_total": analysis.get("p0_total", len(P0_KEYS)),
        "p0_filled": analysis.get("p0_filled", 0),
        "missing_p0": analysis.get("missing_p0") or [],
        "blocking": analysis.get("blocking") or [],
        "sources": config.EVIDENCE,
        "note": "空值不会被静默当成真数：程序补齐的每一项都在“假设†”里写明理由；带“演示†”的是为讲清交互构造的数据。",
        "granularity": "整点",
    }


# ---------------------------------------------------------------- overview
def build_overview(scene, scene_c, plan, analysis, mode, project_name):
    m = scene_c["metrics"]
    margin = 1 - m["util"]
    status = _margin_status(margin)
    cap = m["hourly_capacity"]
    demand = m["demand_peak"]
    gap = m["gap"]
    dgap = m["driver_gap"]
    dstatus = "red" if dgap > 0 else ("warn" if dgap > -0.1 * m["driver_avail_hours"] else "ok")
    kpis = [
        {
            "key": "margin", "label": "高峰运力余量", "value": round(margin * 100, 1),
            "display": f"{margin * 100:.1f}", "unit": "%", "status": status,
            "target": "≥ 15%", "delta": f"{margin * 100 - 15:+.1f}pp",
            "hint": f"有效运力 {cap:,.0f} − 高峰需求 {demand:,.0f}",
            "evidence": "calculated", "trend": [round((1 - r["util"]) * 100, 1) for r in plan["rows"]],
        },
        {
            "key": "capacity", "label": "小时有效运力", "value": cap,
            "display": f"{cap:,.0f}", "unit": "人/小时", "status": "ok",
            "target": "", "delta": "",
            "hint": f"{m['available']:g} 辆 × {m['seats']:g} 座 × 60 ÷ {m['cycle']:g} 分 × {m['coef']:g}",
            "evidence": "calculated",
            "trend": [r["capacity"] for r in plan["rows"]],
        },
        {
            "key": "gap", "label": "运力余量", "value": -gap,
            "display": f"{-gap:+,.0f}", "unit": "人/小时",
            "status": "red" if gap > 0 else ("warn" if margin < 0.15 else "ok"),
            "target": "≥ 0", "delta": f"{margin * 100 - 15:+.1f}pp 安全线",
            "hint": ("需求大于运力" if gap > 0 else "需求小于运力，但安全余量不足" if margin < 0.15 else "需求小于运力"),
            "evidence": "calculated",
            "trend": [r["gap"] for r in plan["rows"]],
        },
        {
            "key": "driver", "label": "司机工时余量", "value": abs(dgap),
            "display": f"{abs(dgap):,.0f}", "unit": "人·小时", "status": dstatus,
            "target": "≥ 0", "delta": ("缺 " if dgap > 0 else "余 ") + f"{abs(dgap):,.0f}",
            "hint": f"需 {m['driver_need_hours']:,.0f} / 可供 {m['driver_avail_hours']:,.0f}（出勤 90%）",
            "evidence": "calculated",
            "trend": [],
        },
    ]

    checks = list(scene_c.get("checks") or [])
    if scene.get("rain"):
        checks.insert(0, {
            "level": "红线", "title": "雨雪使循环时间 +20%",
            "detail": f"循环时间由 {m['cycle'] / 1.2:.0f} 分钟升至 {m['cycle']:g} 分钟，"
                      f"小时有效运力降至 {cap:,.0f} 人，余量 {_pct(margin)}。",
            "basis": "天气参数 b_rain_increase=0.2；运力与循环时间成反比",
        })
    risk_map = {"红线": "red", "警示": "warn", "提示": "info"}
    alerts = []
    for i, c in enumerate(checks):
        risk = risk_map.get(c.get("level"), "info")
        card_id = None
        if scene.get("rain") and ("雨" in c.get("title", "") or risk == "red"):
            card_id = f"{plan['date']}-rain"
        elif "运力" in c.get("title", "") or "司机" in c.get("title", ""):
            card_id = f"{plan['date']}-peak"
        alerts.append({
            "id": f"AL-{i + 1:02d}", "level": c.get("level"), "risk": risk,
            "title": c.get("title"), "detail": c.get("detail"), "basis": c.get("basis"),
            "time": scene.get("time") if i == 0 else f"{int(str(scene.get('time', '07:40'))[:2]):02d}:{min(59, int(str(scene.get('time', '07:40'))[3:5]) + i * 4):02d}",
            "card_id": card_id, "action": "去处理" if card_id else "看依据",
        })
    alerts.sort(key=lambda a: {"red": 0, "warn": 1, "info": 2}.get(a["risk"], 3))

    bottleneck = []
    for i, a in enumerate([x for x in alerts if x["risk"] in ("red", "warn")][:4], 1):
        bottleneck.append({
            "rank": i, "name": a["title"], "risk": a["risk"],
            "note": (a["detail"] or "")[:72] + ("…" if len(a["detail"] or "") > 72 else ""),
        })
    if not bottleneck:
        bottleneck = [{"rank": 1, "name": "无阻断性瓶颈", "risk": "ok",
                       "note": "当前参数下余量高于 15%，保持观察即可。"}]

    level_label = {"realtime": "实时滚动", "semi": "半自动 · 人工确认", "low": "低数据依赖"}.get(mode.get("level"), "低数据依赖")
    base = mode.get("base") or {}
    mode_view = {
        "level": mode.get("level"), "level_label": level_label,
        "latency": mode.get("latency"), "systems": mode.get("systems") or [],
        "name": base.get("name"), "summary": base.get("summary"),
        "why": base.get("why"), "risk": base.get("risk"),
        "steps": (base.get("steps") or [])[:4],
        "note": mode.get("note"),
    }

    nodes, edges, direction = _skeleton(params=scene_c.get("_params") or {}, project_name=project_name)
    return {
        "kpis": kpis,
        "curve": {
            "labels": [r["label"] for r in plan["rows"]],
            "slots": [r["slot"] for r in plan["rows"]],
            "demand": [r["flow"] for r in plan["rows"]],
            "capacity": [r["capacity"] for r in plan["rows"]],
            "margin": [round((1 - r["util"]) * 100, 1) for r in plan["rows"]],
            "target": 15.0,
            "unit": "人/小时",
            "note": "整点粒度；容量线按当前排班车数计算。",
        },
        "alerts": alerts,
        "checks": alerts,
        "bottleneck": bottleneck,
        "mode": mode_view,
        "sensitivity": scene_c.get("sensitivity") or [],
        "skeleton": {"nodes": nodes, "edges": edges, "direction": direction,
                     "note": "线路骨架示意，无 GIS 坐标；站点级到达人数本期未采集。"},
        "headline": scene.get("summary"),
        "status": "red" if status == "red" else ("warn" if status == "warn" else "ok"),
        "safe_line": 15,
        "as_of": scene.get("time"),
        "evidence": {"calculated": "测算", "input": "填报", "assumed": "假设†"},
    }


def _skeleton(params, project_name):
    try:
        n = int(_num(params.get("b_station_count"), 5))
    except Exception:
        n = 5
    n = max(3, min(8, n or 5))
    if "九寨" in (project_name or ""):
        pool = ["沟口", "盆景滩", "诺日朗", "长海", "五花海", "原始森林", "树正", "则查洼"]
    else:
        pool = ["入口", "站 1", "换乘中心", "主沟", "支沟", "终点", "站 7", "站 8"]
    names = pool[:n]
    nodes = [{"id": f"n{i}", "name": name, "role": "入口" if i == 0 else ("换乘" if i == 2 else "站点")}
             for i, name in enumerate(names)]
    edges = [[f"n{i}", f"n{i + 1}"] for i in range(n - 1)]
    if n >= 5:
        edges.append(["n2", f"n{n - 1}"])
    try:
        split = float(params.get("a_direction_split") or 0.6)
    except (TypeError, ValueError):
        split = 0.6
    direction = [
        {"name": "去程", "share": round(split, 2)},
        {"name": "返程", "share": round(1 - split, 2)},
    ]
    return nodes, edges, direction


# ---------------------------------------------------------------- plan
def build_plan(scene, scene_c, runtime, params):
    m = scene_c["metrics"]
    # 用未四舍五入的精确单位运力，避免 target_veh 因 cap_unit=29.1 被抬高一档。
    cap_unit = (m["seats"] * 60.0 / m["cycle"] * m["coef"]) if m.get("cycle") else (m["cap_unit"] or 1)
    sched = scene_c["schedule"]
    overrides = ((runtime or {}).get("plan") or {}).get("overrides") or {}
    rows = []
    for r in sched["rows"]:
        # 班次表按 15% 安全线反推车数，而不是刚好把需求拉平；
        # 这正是“目标车数 / 车辆缺口”与逐时表能对上的原因。
        safe_veh = int(math.ceil(r["flow"] / (cap_unit * 0.85))) if cap_unit else int(r["veh"])
        base_veh = max(int(r["veh"]), safe_veh)
        ov = overrides.get(r["slot"]) or {}
        veh = int(_num(ov.get("veh"), base_veh))
        veh = max(1, min(999, veh))
        cap = veh * cap_unit
        util = (r["flow"] / cap) if cap else 0
        rows.append({
            "slot": r["slot"],
            "label": r["slot"][:2],
            "flow": int(r["flow"]),
            "veh": veh,
            "baseline_veh": base_veh,
            "headway": round(m["cycle"] / veh, 1),
            "capacity": round(cap),
            "util": round(util, 3),
            "margin": round((1 - util) * 100, 1),
            "gap": round(r["flow"] - cap),
            "status": "red" if util > 1 else ("warn" if util > 0.85 else "ok"),
            "over": bool(util > 1),
            "locked": bool(ov.get("locked")),
            "edited": bool(ov.get("veh")),
        })
    peak_row = max(rows, key=lambda x: x["flow"]) if rows else None
    target_veh = int(math.ceil(m["demand_peak"] / (cap_unit * 0.85))) if cap_unit else 0
    target_driver = target_veh * m["op_hours"]
    veh_gap = max(0, target_veh - int(m["available"]))
    driver_gap = max(0, round(target_driver - m["driver_avail_hours"], 1))
    sim_rows = sim.simulate(
        m, params,
        headways=[
            ("当前计划", m["headway"]),
            ("加密 20%", max(0.2, m["headway"] * 0.8)),
            (f"加开 8 辆", round(m["cycle"] / max(1, m["available"] + 8), 1)),
        ],
        seats=int(m["seats"]),
    )
    source = sched.get("source") or ""
    return {
        "date": scene.get("date") or datetime.now().strftime("%Y-%m-%d"),
        "rows": rows,
        "summary": {
            "target_veh": target_veh,
            "veh_gap": veh_gap,
            "target_driver_hours": round(target_driver, 1),
            "driver_gap": driver_gap,
            "peak_slot": peak_row["slot"] if peak_row else "",
            "peak_flow": peak_row["flow"] if peak_row else 0,
            "over_slots": sum(1 for r in rows if r["over"]),
            "locked": sum(1 for r in rows if r["locked"]),
            "edited": sum(1 for r in rows if r["edited"]),
            "available": m["available"],
            "cycle": m["cycle"],
            "seats": m["seats"],
            "cap_unit": cap_unit,
            "op_hours": m["op_hours"],
        },
        "source": {
            "text": source,
            "tag": "假设曲线†" if "假设" in source else "实测/填报",
            "note": "整点粒度；若有分时客流则按峰值缩放，否则用程序内置曲线。",
        },
        "sim": sim_rows,
        "sensitivity": scene_c.get("sensitivity") or [],
        "note": "等效间隔按“多站点合计发车”口径计算，不是单站发车间隔。",
        "evidence": "calculated",
    }


# ---------------------------------------------------------------- driver
def build_driver(runtime, role, scene):
    tasks = list((runtime or {}).get("tasks") or [])
    counts = {}
    for t in tasks:
        counts[t.get("status")] = counts.get(t.get("status"), 0) + 1
    reports = list((runtime or {}).get("station_reports") or [])
    return {
        "tasks": tasks,
        "counts": counts,
        "station": {
            "name": "诺日朗站",
            "queue": reports[0]["queue"] if reports else 0,
            "reports": reports,
            "note": "站点报数为演示数据†；真实系统需接站点计数或人工上报。",
        },
        "can_report": workflow.can_report(role),
        "can_dispatch": workflow.can_dispatch(role),
        "demo_notice": "任务单号、车号、司机姓名为示例；本页全部标“演示†”。",
        "as_of": scene.get("time"),
        "quick_actions": [
            {"id": "normal", "label": "正常", "tone": "ok", "desc": "队列正常，按计划发车"},
            {"id": "crowded", "label": "拥挤", "tone": "warn", "desc": "候车增多，建议加密"},
            {"id": "full", "label": "爆满", "tone": "red", "desc": "车辆满载，需立即加车"},
        ],
    }


# ---------------------------------------------------------------- review
def build_review(scene, base_c, runtime, params):
    m = base_c["metrics"]
    plan_rows = base_c["schedule"]["rows"]
    actual_daily = int(round(m["daily_demand"]))
    forecast_daily = int(round(actual_daily * 0.976 / 100.0) * 100)
    actual_peak = int(round(m["demand_peak"] * 1.027 / 10.0) * 10)
    plan_trips = int(round(m["n_service"] * m["op_hours"]))
    actual_trips = int(round(plan_trips * 0.964))
    execution = round(actual_trips / plan_trips, 3) if plan_trips else 0
    plan_wait = 14.0
    actual_wait = 17.2
    factors = [0.98, 1.03, 1.06, 1.05, 1.02, 1.00, 0.99, 0.98, 0.97, 0.96, 0.95]
    actual_curve = []
    for i, r in enumerate(plan_rows):
        f = factors[i % len(factors)]
        actual_curve.append(round(r["flow"] * f))
    deviations = [
        {
            "key": "demand", "label": "客流", "plan": forecast_daily, "actual": actual_daily,
            "unit": "人/日", "diff": actual_daily - forecast_daily,
            "rate": round((actual_daily - forecast_daily) / forecast_daily, 3),
            "status": "warn", "why": "团队预约集中到园，叠加天气转晴，实际比预测多约 1,000 人。",
        },
        {
            "key": "trips", "label": "班次", "plan": plan_trips, "actual": actual_trips,
            "unit": "班", "diff": actual_trips - plan_trips,
            "rate": round(execution - 1, 3),
            "status": "red" if execution < 0.97 else "warn",
            "why": "8 辆车晚到 18 分钟、2 辆故障；执行率 96.4%，缺口集中在 08:00-09:00。",
        },
        {
            "key": "wait", "label": "平均候车", "plan": plan_wait, "actual": actual_wait,
            "unit": "分钟", "diff": round(actual_wait - plan_wait, 1),
            "rate": round((actual_wait - plan_wait) / plan_wait, 3),
            "status": "warn", "why": "09:40 长海方向队列 38 人，区间车未及时插入；站台引导起了作用，未出现滞留。",
        },
    ]
    writeback_state = ((runtime or {}).get("review") or {}).get("writebacks") or {}
    writebacks = [
        {
            "key": "a_peak_share", "label": "高峰小时占日客流比例",
            "old": round(m["demand_peak"] / m["daily_demand"], 4) if m["daily_demand"] else 0.16,
            "new": round(actual_peak / actual_daily, 4),
            "why": f"实际峰值 {actual_peak:,} 人，占日客流 {actual_peak / actual_daily:.1%}；原参数偏低 0.3pp。",
            "evidence": "demo", "applied": "a_peak_share" in writeback_state,
            "applied_at": (writeback_state.get("a_peak_share") or {}).get("at", ""),
        },
        {
            "key": "b_cycle_time", "label": "平均循环时间",
            "old": m["cycle"], "new": round(m["cycle"] + 3, 1),
            "why": "雨天实测循环 73 分钟，原参数 70 分钟偏低；建议按天气分档写回，而不是全年改。",
            "evidence": "demo", "applied": "b_cycle_time" in writeback_state,
            "applied_at": (writeback_state.get("b_cycle_time") or {}).get("at", ""),
        },
    ]
    return {
        "available": True,
        "preview": scene.get("id") != "evening",
        "demo": True,
        "date": scene.get("date") or datetime.now().strftime("%Y-%m-%d"),
        "kpis": [
            {"label": "实际日客流", "value": f"{actual_daily:,}", "unit": "人", "status": "warn",
             "hint": f"预测 {forecast_daily:,}，偏差 {actual_daily - forecast_daily:+,}（{(actual_daily - forecast_daily) / forecast_daily:+.1%}）"},
            {"label": "实际峰值", "value": f"{actual_peak:,}", "unit": "人/小时", "status": "warn",
             "hint": "09:40，长海方向；整点口径为 09:00-10:00"},
            {"label": "班次执行率", "value": f"{execution:.1%}", "unit": "", "status": "warn",
             "hint": f"{actual_trips:,} / {plan_trips:,} 班；缺口集中在 08:00-09:00"},
            {"label": "平均候车", "value": f"{actual_wait:.1f}", "unit": "分钟", "status": "warn",
             "hint": f"计划 {plan_wait:.1f}，偏差 +{actual_wait - plan_wait:.1f}（+22.9%）"},
        ],
        "curve": {
            "labels": [r["slot"][:2] for r in plan_rows],
            "planned": [r["flow"] for r in plan_rows],
            "actual": actual_curve,
            "unit": "人/小时",
            "note": "实际曲线为演示数据†；只有整点，没有 15 分钟粒度。",
        },
        "deviations": deviations,
        "writebacks": writebacks,
        "not_collected": [
            {"name": "空驶里程", "why": "sim 只出候车/队列/滞留，未接 GPS 里程"},
            {"name": "响应时间", "why": "任务状态有时间戳，但缺少“发现—确认”链路"},
            {"name": "违规次数", "why": "未接执法/安全台账"},
            {"name": "站点级到达人数", "why": "只有线级 + 方向级，没有站点级字段"},
        ],
        "source": f"演示数据† · {actual_daily:,} 人 / 09:40 / {execution:.1%} / {actual_wait} 分钟",
        "note": "本页实际值为演示数据†，用于展示“计划 vs 实际—偏差—写回”的闭环；不得当作现场实测。",
        "evidence": "demo",
        "writeback_count": sum(1 for w in writebacks if w["applied"]),
    }


# ---------------------------------------------------------------- archive
def build_archive(projects, current_id):
    rows = []
    for p in (projects or []):
        rows.append({
            "id": p.get("id"), "name": p.get("name"),
            "saved": p.get("saved", ""), "demo": bool(p.get("demo")),
            "note": p.get("note", ""), "current": p.get("id") == current_id,
            "p0_filled": p.get("p0_filled"), "p0_total": p.get("p0_total"),
            "completeness": p.get("completeness"),
            "missing_p0": p.get("missing_p0") or [],
        })
    return {
        "projects": rows,
        "stats": {
            "total": len(rows),
            "demo": sum(1 for r in rows if r["demo"]),
            "complete": sum(1 for r in rows if (r.get("completeness") or 0) >= 1),
        },
        "note": "一套系统服务多个景区时，参数按项目隔离，不串味。",
    }


# ---------------------------------------------------------------- build
def build(params, name="", project_id="", scene_id="morning", runtime=None,
          role=None, projects=None, audit=None, project=None, source=None, date=None):
    role = _role(role)
    project = _project(project, name, project_id)
    scene = scenes.get(scene_id)
    scene = dict(scenes.scene_public(scene))
    scene["date"] = date or project["date"]
    scene["_params"] = params

    analysis = validate.validate(params)
    base_c = calc.compute(params)
    rain_c = calc.compute(scenes.scene_params(params, "noon"))
    scene_params = scenes.scene_params(params, scene["id"])
    scene_c = calc.compute(scene_params)
    scene_c["_params"] = scene_params

    sim_scene = sim.simulate(scene_c["metrics"], scene_params)
    mode = modes.recommend(scene_params, scene_c["metrics"], sim_scene)
    cases = badcases.build(scene_params, scene_c["metrics"], sim_scene, mode)

    plan = build_plan(scene, scene_c, runtime, scene_params)
    plan["skeleton"] = _skeleton(scene_params, project["name"])
    overview = build_overview(scene, scene_c, plan, analysis, mode, project["name"])

    cards, counts = workflow.build_cards(
        project["id"], project["date"], params, scene["id"], runtime or {},
        role, base_c["metrics"], rain_c["metrics"], audit or [],
    )
    desk = {
        "cards": cards,
        "counts": counts,
        "audit": audit or [],
        "role": _public_role(role),
        "permissions": _permissions(role),
        "principles": [
            "先给依据：每张卡都写清 because，不用“系统建议”四个字糊弄。",
            "再给选择：2–3 个候选动作，各自标代价与对别处的影响。",
            "人做决定：常规由值班调度长批，应急由值班领导批；拒绝必须写理由。",
        ],
        "state_flow": [
            {"id": "pending", "label": "待审核", "hint": "机器出结论，人未签字"},
            {"id": "approved", "label": "已批准", "hint": "责任已落，等待下发"},
            {"id": "dispatched", "label": "已下发", "hint": "任务单到人，等待接单"},
            {"id": "accepted", "label": "已接单", "hint": "司机确认执行"},
            {"id": "reported", "label": "已回执", "hint": "现场报数已回写"},
        ],
        "approval_matrix": [
            {"kind": "normal", "label": "常规卡", "role": "值班调度长", "deadline": "30 分钟内"},
            {"kind": "emergency", "label": "应急卡", "role": "值班领导", "deadline": "20 分钟内"},
        ],
        "note": "演示版不做登录：角色切换只改变可见操作与默认首页，审批留痕仍写入审计流。",
    }
    driver = build_driver(runtime, role, scene)
    review = build_review(scene, base_c, runtime, params)
    archive = build_archive(projects or [], project["id"])

    pending = counts.get("pending", 0)
    status = "red" if scene.get("rain") else ("warn" if (1 - scene_c["metrics"]["util"]) < 0.15 else "ok")
    if scene["id"] == "evening":
        next_text, next_page = "去复盘写回", "review"
    elif pending:
        next_text, next_page = "去调度建议审批", "desk"
    else:
        next_text, next_page = "查看运行计划", "plan"
    summary = {
        "headline": scene.get("summary"),
        "status": status,
        "alerts": sum(1 for a in overview["alerts"] if a["risk"] in ("red", "warn")),
        "pending": pending,
        "margin": round((1 - scene_c["metrics"]["util"]) * 100, 1),
        "next": next_text,
        "next_page": next_page,
    }

    permissions = _permissions(role)
    meta = {
        "app": config.APP_NAME, "subtitle": config.APP_SUBTITLE,
        "version": config.VERSION, "api_version": config.API_VERSION,
        "built_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "date": project["date"], "is_demo": project["demo"],
        "role": _public_role(role),
        "roles": [_public_role(r) for r in config.ROLES],
        "permissions": permissions,
        "pages": _pages_for(role),
        "default_page": role.get("default_page", "overview"),
        "scenes": scenes.public_scenes(),
        "scene": {k: v for k, v in scene.items() if not k.startswith("_")},
        "evidence": config.EVIDENCE,
        "limits": config.DEMO_LIMITS,
        "source": source or {"mode": "live", "label": "实时引擎",
                             "note": "数字由本地引擎按当前参数现算"},
        "role_notice": "演示版：角色切换只改变可见操作与默认首页，不做登录鉴权；审批留痕仍写入审计流。",
        "project": project,
    }
    return {
        "meta": meta,
        "summary": summary,
        "params": build_params(params, analysis),
        "overview": overview,
        "plan": plan,
        "desk": desk,
        "driver": driver,
        "review": review,
        "archive": archive,
        "evidence": config.EVIDENCE,
        "badcases": cases,
        "mode": mode,
    }


def export_markdown(snapshot):
    """运行快报：给评委/值班群一份可带走的 Markdown，不引入第二套计算。"""
    meta = snapshot.get("meta") or {}
    s = snapshot.get("summary") or {}
    o = snapshot.get("overview") or {}
    p = snapshot.get("plan") or {}
    d = snapshot.get("desk") or {}
    r = snapshot.get("review") or {}
    lines = []
    lines.append(f"# {meta.get('app', '景枢 DispatchOS')} · 运行快报")
    lines.append("")
    lines.append(f"- 项目：{meta.get('project', {}).get('name', '—')}")
    lines.append(f"- 日期：{meta.get('date', '—')}　场景：{meta.get('scene', {}).get('label', '—')} {meta.get('scene', {}).get('time', '')}")
    lines.append(f"- 角色：{meta.get('role', {}).get('name', '—')}（演示版，权限为示意）")
    lines.append(f"- 数据源：{meta.get('source', {}).get('label', '—')}")
    lines.append("")
    lines.append("## 一、结论")
    lines.append(f"- {s.get('headline', '')}")
    lines.append(f"- 高峰余量：{s.get('margin', '—')}%　预警：{s.get('alerts', 0)} 条　待审批：{s.get('pending', 0)} 张")
    lines.append("")
    lines.append("## 二、运行实况")
    for k in o.get("kpis") or []:
        lines.append(f"- {k.get('label')}：{k.get('display')}{k.get('unit', '')}（{k.get('hint')}）")
    lines.append("")
    lines.append("## 三、运行计划")
    lines.append(f"- 峰值时段：{p.get('summary', {}).get('peak_slot', '—')}，{p.get('summary', {}).get('peak_flow', 0):,} 人/小时")
    lines.append(f"- 按 15% 安全线：需 {p.get('summary', {}).get('target_veh', 0)} 辆，现有 {p.get('summary', {}).get('available', 0):g} 辆，缺 {p.get('summary', {}).get('veh_gap', 0)} 辆")
    lines.append(f"- 司机工时：需 {p.get('summary', {}).get('target_driver_hours', 0):,.0f} 人·小时，缺 {p.get('summary', {}).get('driver_gap', 0):,.0f}")
    lines.append("")
    lines.append("## 四、建议与审批")
    for c in d.get("cards") or []:
        lines.append(f"### {c.get('title')}（{c.get('kind_label')} · {c.get('state_label')}）")
        lines.append(f"- 依据：{c.get('because')}")
        lines.append(f"- 审批人：{c.get('owner')}　时限：{c.get('deadline')}")
        for cand in c.get("candidates") or []:
            mark = "【推荐】" if cand.get("recommended") else ""
            lines.append(f"- {mark}{cand.get('name')}：{cand.get('summary')} 代价：{cand.get('cost')}；影响：{cand.get('tradeoff')}")
        if c.get("reject_reason"):
            lines.append(f"- 拒绝理由：{c.get('reject_reason')}")
        lines.append("")
    lines.append("## 五、复盘")
    lines.append(f"- {r.get('source', '')}")
    for dev in r.get("deviations") or []:
        lines.append(f"- {dev.get('label')}：计划 {dev.get('plan')} → 实际 {dev.get('actual')}（{dev.get('rate', 0):+.1%}）")
    lines.append("")
    lines.append("---")
    lines.append("本快报由 DispatchOS 本地引擎生成；整点粒度，无站点级到达人数、无 GIS 坐标；复盘实际值为演示数据†。")
    return "\n".join(lines)

