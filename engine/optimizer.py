# -*- coding: utf-8 -*-
"""Optional CP-SAT optimizer for hourly fleet allocation.

This module accepts only server-built, already validated schedule inputs. OR-Tools
is optional so installations without the native wheel keep the baseline planner.
"""
import hashlib
import json
import math


def input_fingerprint(rows, available, cap_unit, safety=0.15, locked=None):
    payload = {
        "rows": [{"slot": r["slot"], "flow": int(round(r["flow"]))} for r in rows],
        "available": int(available), "cap_unit": round(float(cap_unit), 6),
        "safety": round(float(safety), 6), "locked": locked or {},
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest(), payload


def validate_solution(rows, vehicles, available, cap_unit, safety, locked):
    """Independent business checks; solver status alone is never trusted."""
    errors = []
    if len(rows) != len(vehicles):
        return ["时段数量与建议数量不一致"]
    for i, (row, veh) in enumerate(zip(rows, vehicles)):
        if not isinstance(veh, int) or veh < 0 or veh > available:
            errors.append("%s 车辆数越界" % row["slot"])
            continue
        if row["slot"] in locked and veh != int(locked[row["slot"]]):
            errors.append("%s 锁定值被改变" % row["slot"])
        required = math.ceil(float(row["flow"]) * (1 + safety) / cap_unit) if cap_unit > 0 else available + 1
        if veh < required:
            errors.append("%s 未达到安全运力要求" % row["slot"])
    return errors


def optimize(rows, available, cap_unit, locked=None, safety=0.15, change_weight=20,
             time_limit=3.0, force_status=None):
    """Return JSON-safe candidate. `force_status` exists for deterministic failure tests."""
    locked = {str(k): int(v) for k, v in (locked or {}).items()}
    available = max(0, int(available))
    safety = float(safety)
    fingerprint, payload = input_fingerprint(rows, available, cap_unit, safety, locked)
    assumptions = []
    if any(r.get("assumed") for r in rows):
        assumptions.append("分时客流含程序生成或缺失值推算，须核实后使用")
    assumptions.append("司机数量未作为本阶段约束：已有字段无法推导逐时在岗与休息；须另做司机班次模型")
    if force_status:
        return {"status": force_status, "message": "优化器不可用或未能求解；现有计划未改变。",
                "rows": [], "assumptions": assumptions, "input_fingerprint": fingerprint,
                "objective": {}}
    try:
        from ortools.sat.python import cp_model
    except ImportError:
        return {"status": "unavailable", "message": "未安装 OR-Tools；可安装 requirements.txt 后重启服务。现有计划不受影响。",
                "rows": [], "assumptions": assumptions, "input_fingerprint": fingerprint,
                "objective": {}}

    model = cp_model.CpModel()
    xs = [model.NewIntVar(0, available, "vehicles_%d" % i) for i in range(len(rows))]
    short = []
    for i, row in enumerate(rows):
        if row["slot"] in locked:
            value = locked[row["slot"]]
            if value < 0 or value > available:
                return {"status": "infeasible", "message": "%s 锁定车辆数超出可用车辆上限。" % row["slot"],
                        "rows": [], "assumptions": assumptions, "input_fingerprint": fingerprint,
                        "objective": {}}
            model.Add(xs[i] == value)
        demand = int(math.ceil(float(row["flow"]) * (1 + safety)))
        cap_int = max(1, int(math.floor(float(cap_unit) * 1000)))
        # capacity is scaled to milli-passengers to avoid floating point in CP-SAT.
        gap = model.NewIntVar(0, max(demand, 1), "shortage_%d" % i)
        model.Add(xs[i] * cap_int + gap * 1000 >= demand * 1000)
        short.append(gap)
    moves = []
    for i in range(1, len(xs)):
        diff = model.NewIntVar(0, available, "move_%d" % i)
        model.AddAbsEquality(diff, xs[i] - xs[i - 1])
        moves.append(diff)
    # Shortage dominates all secondary costs, so it is only used when hard
    # fleet/lock constraints make full coverage impossible; that is reported.
    max_secondary = max(1, len(xs) * available + change_weight * max(0, len(xs) - 1) * available)
    model.Minimize(sum(short) * (max_secondary + 1) + sum(xs) + change_weight * sum(moves))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(0.05, float(time_limit))
    solver.parameters.num_search_workers = 1
    try:
        status = solver.Solve(model)
    except Exception as exc:
        return {"status": "error", "message": "OR-Tools 求解失败：%s" % str(exc), "rows": [],
                "assumptions": assumptions, "input_fingerprint": fingerprint, "objective": {}}
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        state = "timeout" if status == cp_model.UNKNOWN else "infeasible"
        return {"status": state, "message": "求解超时，未得到候选方案。" if state == "timeout" else "当前车辆上限和锁定计划下无法生成候选方案。",
                "rows": [], "assumptions": assumptions, "input_fingerprint": fingerprint,
                "objective": {}}

    values = [int(solver.Value(x)) for x in xs]
    errors = validate_solution(rows, values, available, cap_unit, safety, locked)
    # If the optimizer had to use shortage variables, expose the infeasibility
    # explicitly rather than presenting an under-capacity plan as feasible.
    shortages = [int(solver.Value(x)) for x in short]
    if errors or any(shortages):
        uncovered = [rows[i]["slot"] for i, gap in enumerate(shortages) if gap]
        return {"status": "infeasible", "message": "可用车辆或锁定值不足以满足安全运力：%s" % ("、".join(uncovered) or "独立校验未通过"),
                "rows": [], "assumptions": assumptions, "input_fingerprint": fingerprint,
                "objective": {"validation_errors": errors}}
    result_rows = []
    for row, veh in zip(rows, values):
        capacity = int(round(veh * cap_unit))
        util = float(row["flow"]) / capacity if capacity else (1.0 if row["flow"] else 0.0)
        result_rows.append({"slot": row["slot"], "flow": int(row["flow"]), "veh": veh,
                            "capacity": capacity, "util": round(util, 3),
                            "gap": capacity - int(row["flow"]), "locked": row["slot"] in locked})
    return {"status": "feasible", "message": "候选方案通过独立运力与锁定项校验；应用前仍需人工确认。",
            "rows": result_rows, "assumptions": assumptions, "input_fingerprint": fingerprint,
            "objective": {"vehicles_total_hours": sum(values), "vehicle_changes": sum(abs(values[i]-values[i-1]) for i in range(1, len(values))),
                          "status": "optimal" if status == cp_model.OPTIMAL else "feasible"},
            "input_summary": {"hours": len(rows), "available_vehicles": available,
                              "capacity_per_vehicle_hour": round(float(cap_unit), 2),
                              "safety_margin": safety, "locked_slots": len(locked)}}
