# -*- coding: utf-8 -*-
"""建议卡、效果模型与审批状态机。

这个模块只做三件事：
1. 把“机器结论”翻译成有触发依据、有候选动作、有代价的建议卡；
2. 用同一套运力公式计算“批准后会发生什么”，避免界面另写一套算术；
3. 用显式状态机约束谁能做什么，所有变更由 app.py 落到审计流。
"""
import copy
import math

from . import calc, scenes

# 状态机：只允许这些迁移。界面上的按钮由 can_* 决定，服务端再次校验。
TRANSITIONS = {
    None: {"pending"},
    "pending": {"approved", "rejected"},
    "approved": {"dispatched", "rejected"},
    "dispatched": {"accepted", "reported"},
    "accepted": {"reported"},
    "reported": set(),
    "rejected": set(),
}
KIND_LABEL = {"normal": "常规", "emergency": "应急"}
STATE_LABEL = {
    "pending": "待审核",
    "approved": "已批准 · 待下发",
    "dispatched": "已下发 · 待接单",
    "accepted": "已接单",
    "reported": "已回执",
    "rejected": "已拒绝",
}


def role_can(role, perm):
    role = role or {}
    return perm in (role.get("perms") or [])


def can_approve(role, kind):
    if kind == "emergency":
        return role_can(role, "decide_emergency")
    return role_can(role, "decide_normal")


def can_dispatch(role):
    return role_can(role, "dispatch")


def can_report(role):
    return role_can(role, "report")


def effect_params(params, effect):
    """把候选动作翻译成参数拷贝。只改能被公式解释的量，不写魔法数字。"""
    out = copy.deepcopy(params or {})
    effect = effect or {}
    if effect.get("vehicles"):
        try:
            avail = float(out.get("c_bus_available") or 0)
        except (TypeError, ValueError):
            avail = 0
        avail = max(1, avail + float(effect["vehicles"]))
        out["c_bus_available"] = avail
        try:
            total = float(out.get("c_bus_total") or 0)
        except (TypeError, ValueError):
            total = 0
        if total and total < avail:
            out["c_bus_total"] = avail
    if effect.get("demand_factor"):
        try:
            peak = float(out.get("a_peak_hour_flow") or 0)
        except (TypeError, ValueError):
            peak = 0
        if peak:
            out["a_peak_hour_flow"] = round(peak * float(effect["demand_factor"]), 1)
    if effect.get("cycle_factor"):
        try:
            cycle = float(out.get("b_cycle_time") or 0)
        except (TypeError, ValueError):
            cycle = 0
        if cycle:
            out["b_cycle_time"] = round(cycle * float(effect["cycle_factor"]), 1)
    return out


def _subset(c):
    m = c["metrics"]
    return {
        "capacity": m["hourly_capacity"],
        "demand": m["demand_peak"],
        "gap": m["gap"],
        "margin": round(1 - m["util"], 4),
        "util": m["util"],
        "driver_gap": m["driver_gap"],
        "cycle": m["cycle"],
        "available": m["available"],
        "cap_unit": m["cap_unit"],
        "headway": m["headway"],
    }


def after_metrics(params, effect, scene_id="morning"):
    p = effect_params(params, effect)
    sp = scenes.scene_params(p, scene_id)
    return _subset(calc.compute(sp))


def _pct(v):
    return f"{v * 100:.1f}%"


def _int(v):
    try:
        return f"{float(v):,.0f}"
    except (TypeError, ValueError):
        return "—"


def _candidate(params, scene_id, before, cid, name, summary, effect, eta, cost,
               tradeoff, evidence, recommended=False, note=""):
    after = after_metrics(params, effect, scene_id)
    return {
        "id": cid,
        "name": name,
        "summary": summary,
        "effect": effect,
        "eta": eta,
        "cost": cost,
        "tradeoff": tradeoff,
        "evidence": evidence,
        "recommended": bool(recommended),
        "note": note,
        "after": after,
        "delta": {
            "margin_pts": round((after["margin"] - before["margin"]) * 100, 1),
            "capacity": round(after["capacity"] - before["capacity"]),
            "demand": round(after["demand"] - before["demand"]),
            "gap": round(after["gap"] - before["gap"]),
            "driver_gap": round(after["driver_gap"] - before["driver_gap"], 1),
        },
    }


def _card(cid, kind, title, short, because, trigger, owner, deadline, opened_at,
          source_ref, candidates, note="", evidence="计算", escalation=""):
    return {
        "id": cid,
        "kind": kind,
        "kind_label": KIND_LABEL[kind],
        "title": title,
        "short": short,
        "because": because,
        "trigger": trigger,
        "owner": owner,
        "deadline": deadline,
        "opened_at": opened_at,
        "source_ref": source_ref,
        "evidence": evidence,
        "candidates": candidates,
        "recommended": next((c["id"] for c in candidates if c["recommended"]), None),
        "note": note,
        "escalation": escalation,
    }


def _plan_card(project_id, date, params, m):
    before = _subset({"metrics": m})
    c1 = _candidate(
        params, "eve", before, "plan-8", "加开 8 辆，锁早高峰",
        "从西线平峰抽调 5 辆、备用车 3 辆，07:30 前到位。",
        {"vehicles": 8}, "明晨 07:30", "8 辆车 · 8 人·班；约 1.9 万元/日",
        "西线平峰各减 1 辆，长海方向间隔 1.3→1.7 分；备用车清零。",
        "测算", recommended=True,
        note="批准后余量到 14.2%，仍低于 15%，07:40 需继续观察。")
    c2 = _candidate(
        params, "eve", before, "plan-4", "加开 4 辆，先保底",
        "只动备用车 3 辆 + 西线 1 辆，组织成本最低。",
        {"vehicles": 4}, "明晨 07:30", "4 辆车 · 4 人·班；约 0.9 万元/日",
        "余量只到 12.5%，覆盖不了 8% 的客流上浮。",
        "测算", note="保底方案，建议同时准备 4 辆机动。")
    c3 = _candidate(
        params, "eve", before, "plan-shift", "预约削峰 4%",
        "今晚 21:00 向 1,600 名游客推送改约，削掉 4% 高峰。",
        {"demand_factor": 0.96}, "今晚 21:00", "不改车；退款与客服加班约 0.4 万元",
        "需 1,600 人改约，投诉风险高于加车；只适合预约渗透率高的景区。",
        "假设†", note="削峰比例依赖游客配合度，未经本景区验证。")
    because = (f"明日 09:00-10:00 高峰需求 {_int(m['demand_peak'])} 人/小时，"
               f"有效运力 {_int(m['hourly_capacity'])} 人/小时，余量 {_pct(1 - m['util'])}，"
               "低于日前排班 15% 安全线。")
    return _card(
        f"{date}-plan", "normal", "明日早高峰加车", "前夜排班",
        because,
        {"label": "明日高峰余量", "value": _pct(1 - m["util"]), "threshold": "< 15%", "status": "warn"},
        "值班调度长", "22:00", "20:00",
        "calc.metrics.util；日前排班规则 R-01（余量 < 15% 触发）",
        [c1, c2, c3],
        note="这是“日前预排”卡：批准的是明天早上的一批车，不是现在发车。",
    )


def _peak_card(project_id, date, params, m):
    before = _subset({"metrics": m})
    c1 = _candidate(
        params, "morning", before, "peak-8", "加开 8 辆，12 分钟到位",
        "西线抽调 5 辆 + 备用 3 辆，先保长海主客流段。",
        {"vehicles": 8}, "12 分钟", "8 辆车 · 8 人·班；西线平峰减 4 班",
        "长海方向间隔 1.3→1.7 分；西线终点站候车可能增加 3-5 分钟。",
        "测算", recommended=True,
        note="批准后余量 10.8%→14.2%，仍差 0.8 个百分点到安全线。")
    c2 = _candidate(
        params, "morning", before, "peak-4", "加开 4 辆，8 分钟到位",
        "备用车 3 辆 + 西线 1 辆，先堵住最大缺口。",
        {"vehicles": 4}, "8 分钟", "4 辆车 · 4 人·班；不影响西线班次",
        "余量只到 12.5%，若 09:00 前来团会再次跌破。",
        "测算", note="快速但不够；适合作为第一波响应。")
    c3 = _candidate(
        params, "morning", before, "peak-limit", "入口限流 300 人/小时",
        "预约端收紧 + 入口分批放行，削掉 6% 高峰。",
        {"demand_factor": 0.94}, "立即", "不限车；入口与客服增加 6 人",
        "游客体验下降；需值班领导授权，且不能替代运力组织。",
        "假设†", note="限流比例是管理假设，实际效果取决于执行力度。")
    because = (f"07:40 高峰小时需求 {_int(m['demand_peak'])} 人/小时，"
               f"有效运力 {_int(m['hourly_capacity'])} 人/小时，余量 {_pct(1 - m['util'])}；"
               "按 15% 安全线，缺口约 233 人/小时。")
    return _card(
        f"{date}-peak", "normal", "早高峰运力不足", "早高峰",
        because,
        {"label": "高峰余量", "value": _pct(1 - m["util"]), "threshold": "< 15%", "status": "warn"},
        "值班调度长", "08:10", "07:40",
        "calc.metrics.util；安全校验 C-02（余量 < 15%）",
        [c1, c2, c3],
        note="常规审批：值班调度长可批；批准后进入下发，司机接单才生效。",
    )


def _rain_card(project_id, date, params, base_m, rain_m):
    before = _subset({"metrics": rain_m})
    c1 = _candidate(
        params, "noon", before, "rain-12", "加开 12 辆，先保主干",
        "备用 3 + 西线 7 + 停驶维保 2，18 分钟内到位。",
        {"vehicles": 12}, "18 分钟", "12 辆车 · 12 人·班；西线平峰减 7 班",
        "西线平峰间隔 4.0→6.5 分；长海方向仍差约 52 人/小时。",
        "测算", note="仍低于 15%，必须配合需求侧动作。")
    c1["note"] = f"加车后余量 {c1['after']['margin'] * 100:+.1f}%，仍低于 15%，必须配合需求侧动作。"
    c2 = _candidate(
        params, "noon", before, "rain-16", "加开 16 辆，压到工时上限",
        "备用 3 + 西线 9 + 跨区 4，25 分钟到位。",
        {"vehicles": 16}, "25 分钟", "16 辆车 · 16 人·班；司机余量 191→79 人·小时",
        "接近日驾驶上限，故障与疲劳风险上升。",
        "测算", note="不推荐单独使用：把安全余量换成了疲劳余量。")
    c2["note"] = f"加车后余量 {c2['after']['margin'] * 100:+.1f}%，仍低于 15%；且接近司机工时上限。"
    c3 = _candidate(
        params, "noon", before, "rain-limit", "限流 19% + 加开 12 辆",
        "入口每小时少放约 1,000 人，同时加开 12 辆，把余量拉回 15%。",
        {"vehicles": 12, "demand_factor": 0.81}, "立即", "12 辆车 + 入口/客服 10 人；约 1,000 张票改退",
        "直接损失与投诉压力最大；但这是唯一能把余量拉回安全线的单一动作。",
        "假设†", recommended=True,
        note="应急审批：超出常规边界，必须值班领导签；机器只给选项，不替人决定。")
    because = (f"12:10 雨夹雪使循环时间 {rain_m['cycle']:g} 分钟"
               f"（原 {base_m['cycle']:g} 分钟，+{((rain_m['cycle'] / base_m['cycle']) - 1) * 100:.0f}%），"
               f"有效运力 {_int(base_m['hourly_capacity'])}→{_int(rain_m['hourly_capacity'])} 人/小时，"
               f"余量 {_pct(1 - base_m['util'])}→{_pct(1 - rain_m['util'])}，已越过 0 红线。")
    return _card(
        f"{date}-rain", "emergency", "雨雪导致运力越红线", "应急",
        because,
        {"label": "高峰余量", "value": _pct(1 - rain_m["util"]), "threshold": "< 0%", "status": "red"},
        "值班领导", "12:30", "12:10",
        "calc.metrics.cycle_rain / util；应急规则 E-01（余量 < 0% 自动升级）",
        [c1, c2, c3],
        note="应急卡与常规卡共用同一套审批状态机；区别是审批人、时限与代价量级。",
        evidence="计算 + 天气假设",
        escalation="超出常规审批边界：余量 < 0%，且任何纯加车方案都无法回到 15%。",
    )


def _audit_for(audit, card_id, limit=5):
    return [a for a in (audit or []) if a.get("card_id") == card_id][:limit]


def build_cards(project_id, date, params, scene_id, runtime, role, base_m, rain_m, audit=None):
    """返回当前场景可见的卡片，并把 runtime 状态、任务、权限拼进去。"""
    defs = []
    scene_id = scene_id or "morning"
    if scene_id == "eve":
        defs.append(_plan_card(project_id, date, params, base_m))
    if scene_id in ("morning", "noon", "evening"):
        defs.append(_peak_card(project_id, date, params, base_m))
    if scene_id in ("noon", "evening"):
        defs.append(_rain_card(project_id, date, params, base_m, rain_m))

    # 已经处理过的卡，即使不在当前幕也继续显示，避免“批准完就消失”。
    known = {
        "plan": _plan_card(project_id, date, params, base_m),
        "peak": _peak_card(project_id, date, params, base_m),
        "rain": _rain_card(project_id, date, params, base_m, rain_m),
    }
    states = (runtime or {}).get("cards") or {}
    tasks = (runtime or {}).get("tasks") or []
    for key, card in known.items():
        if card["id"] in states and all(c["id"] != card["id"] for c in defs):
            defs.append(card)

    out = []
    for card in defs:
        st = states.get(card["id"]) or {}
        state = st.get("state") or "pending"
        linked = [t for t in tasks if t.get("card_id") == card["id"]]
        if linked:
            statuses = [t.get("status") for t in linked]
            if all(s == "reported" for s in statuses):
                state = "reported"
            elif any(s in ("accepted", "reported") for s in statuses):
                state = "accepted"
            elif any(s == "dispatched" for s in statuses):
                state = "dispatched"
        card = copy.deepcopy(card)
        card["state"] = state
        card["state_label"] = STATE_LABEL.get(state, state)
        card["selected"] = st.get("candidate") or card.get("recommended")
        card["decision"] = st.get("decision")
        card["reject_reason"] = st.get("reason")
        card["decided_by"] = st.get("by")
        card["decided_at"] = st.get("at")
        card["tasks"] = linked
        card["task"] = linked[0] if linked else None
        card["history"] = _audit_for(audit, card["id"])
        card["permissions"] = {
            "approve": state == "pending" and can_approve(role, card["kind"]),
            "reject": state in ("pending", "approved") and can_approve(role, card["kind"]),
            "dispatch": state == "approved" and can_dispatch(role),
            "report": state in ("dispatched", "accepted") and can_report(role),
        }
        card["needs_escalation"] = card["kind"] == "emergency"
        out.append(card)

    # 应急优先，其次待审核，最后已办结
    out.sort(key=lambda c: (c["kind"] != "emergency", c["state"] != "pending",
                            {"pending": 0, "approved": 1, "dispatched": 2,
                             "accepted": 3, "reported": 4, "rejected": 5}.get(c["state"], 9)))
    counts = {k: 0 for k in STATE_LABEL}
    for c in out:
        counts[c["state"]] = counts.get(c["state"], 0) + 1
    return out, counts


def task_count_for_effect(effect):
    n = int((effect or {}).get("vehicles") or 0)
    if n <= 0:
        return 1
    return max(1, min(3, int(math.ceil(n / 4.0))))


def next_task_id(runtime, date):
    existing = {t.get("id") for t in (runtime or {}).get("tasks", [])}
    for i in range(1, 1000):
        tid = f"T-{date.replace('-', '')}-{i:03d}"
        if tid not in existing:
            return tid
    return f"T-{date.replace('-', '')}-{len(existing) + 1:03d}"


def make_tasks(project_id, date, card, effect, fleet, now="08:12"):
    """把一张已批准卡拆成 1-3 张任务单（按加车规模）。"""
    n = task_count_for_effect(effect)
    tasks = []
    for i in range(n):
        person = fleet[i % len(fleet)] if fleet else {"driver": "待定", "phone": "", "plate": "待定"}
        veh = int((effect or {}).get("vehicles") or 0)
        per = max(1, int(math.ceil(veh / n))) if veh else 0
        tasks.append({
            "id": f"{card['id'].split('-')[-1]}-{i + 1}-{date.replace('-', '')}",
            "project": project_id,
            "card_id": card["id"],
            "title": f"{card['title']} · 第 {i + 1}/{n} 组",
            "vehicle": person.get("plate", "待定"),
            "plate": person.get("plate", "待定"),
            "driver": person.get("driver", "待定"),
            "phone": person.get("phone", ""),
            "route": "沟口 → 长海（区间车）" if i == 0 else "沟口 → 诺日朗（补位）",
            "depart": now,
            "change_note": f"执行「{card['title']}」：{card['candidates'][0]['summary'] if card.get('candidates') else ''}"
                           f" 本组 {per or '按现场'} 辆，到位后向调度台回执。",
            "status": "dispatched",
            "created_at": "",
            "reports": [],
            "receipt": "",
            "demo": True,
        })
    # 任务号用稳定、可读的格式覆盖临时 id
    for i, t in enumerate(tasks, 1):
        t["id"] = f"T-{date.replace('-', '')}-{card['id'].split('-')[-1][:4].upper()}{i:02d}"
    return tasks
