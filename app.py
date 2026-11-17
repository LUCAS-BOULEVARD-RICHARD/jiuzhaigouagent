# -*- coding: utf-8 -*-
"""景枢 DispatchOS 本地服务。

只依赖 Python 标准库。所有页面、审批、任务和复盘写回都走同一套引擎，
避免“界面上一个数、接口里另一个数”。

启动：
    python app.py
    python app.py --port 8788
"""
import argparse
import base64
import hmac
import json
import mimetypes
import os
import socket
import sys
import traceback
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import config
from engine import dashboard, scenes, validate, workflow, optimizer
from engine import assistant
from engine.schema import FIELD_MAP, blank_params
from storage import (
    AuditLog, ProjectStore, RuntimeStore, default_runtime, demo_runtime,
    now_hm, now_iso, safe_id,
)

PROJECTS = ProjectStore()
RUNTIMES = RuntimeStore()
AUDIT = AuditLog()
OPTIMIZER_CANDIDATES = {}

REPORT_ACTIONS = {
    "normal": ("正常", "ok"),
    "crowded": ("拥挤", "warn"),
    "full": ("爆满", "red"),
}


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


# ---------------------------------------------------------------- helpers
def _role(role_id):
    return config.ROLE_MAP.get(role_id or config.DEFAULT_ROLE,
                               config.ROLE_MAP[config.DEFAULT_ROLE])


def _scene(scene_id):
    return scene_id if scene_id in scenes.SCENE_MAP else scenes.DEFAULT_SCENE


def _project_id(pid=None):
    wanted = (pid or "").strip()
    if wanted and PROJECTS.exists(wanted):
        return wanted
    if PROJECTS.exists(config.DEMO_PROJECT):
        return config.DEMO_PROJECT
    items = PROJECTS.list()
    if items:
        return items[0]["id"]
    raise ApiError("尚无景区项目，请先在“景区档案”新建。", 404)


def _project_meta(project):
    a = validate.validate(project["params"])
    return {
        "id": project["id"],
        "name": project["name"],
        "saved": project.get("saved", ""),
        "created": project.get("created", ""),
        "demo": bool(project.get("demo")),
        "note": project.get("note", ""),
        "p0_filled": a["p0_filled"],
        "p0_total": a["p0_total"],
        "completeness": a["completeness"],
        "missing_p0": a["missing_p0"],
        "blocking": a["blocking"],
    }


def all_projects():
    out = []
    for item in PROJECTS.list():
        try:
            out.append(_project_meta(PROJECTS.load(item["id"])))
        except Exception:
            continue
    return out


def build_snapshot(pid=None, role_id=None, scene_id=None, source=None):
    pid = _project_id(pid)
    role = _role(role_id)
    scene = _scene(scene_id)
    project = PROJECTS.load(pid)
    runtime = RUNTIMES.load(pid)
    audit = AUDIT.tail(pid, 60, since_reset=True)
    snapshot = dashboard.build(
        project["params"], project["name"], project["id"], scene, runtime,
        role, all_projects(), audit, project,
        source=source or {
            "mode": "live", "label": "实时引擎",
            "note": "数字由本地引擎按当前参数现算；审批、任务与写回已持久化。",
        },
    )
    snapshot["runtime"] = {
        "updated": runtime.get("updated", ""),
        "task_count": len(runtime.get("tasks") or []),
        "cards": len(runtime.get("cards") or {}),
        "writebacks": len((runtime.get("review") or {}).get("writebacks") or {}),
    }
    snapshot["server"] = {
        "now": now_iso(),
        "time": datetime.now().strftime("%H:%M"),
        "api_version": config.API_VERSION,
    }
    return snapshot


def save_runtime(pid, runtime):
    return RUNTIMES.save(pid, runtime)


def _find_card(snapshot, card_id):
    for card in (snapshot.get("desk") or {}).get("cards") or []:
        if card.get("id") == card_id:
            return card
    return None


def _find_candidate(card, candidate_id):
    for c in card.get("candidates") or []:
        if c.get("id") == candidate_id:
            return c
    return None


def _default_candidate(card):
    selected = card.get("selected")
    if selected and _find_candidate(card, selected):
        return _find_candidate(card, selected)
    for c in card.get("candidates") or []:
        if c.get("recommended"):
            return c
    return (card.get("candidates") or [None])[0]


def _task_change_note(card, cand, index, count):
    return (
        f"执行「{card['title']}」·{cand['name']}：{cand['summary']} "
        f"本组 {index}/{count}，到位后向调度台回执。"
    )


def _apply_decision(pid, body, role):
    action = (body.get("action") or "").strip()
    card_id = (body.get("card_id") or "").strip()
    reason = (body.get("reason") or "").strip()
    scene = _scene(body.get("scene"))
    if action not in ("approve", "reject", "dispatch", "approve_dispatch"):
        raise ApiError("不支持的审批动作")

    snapshot = build_snapshot(pid, role["id"], scene)
    card = _find_card(snapshot, card_id)
    if not card:
        raise ApiError("找不到这张建议卡（可能已过当前场景）", 404)

    pid = _project_id(pid)
    now = now_iso()
    runtime = RUNTIMES.load(pid)

    if action == "reject":
        if not reason:
            raise ApiError("拒绝必须填写理由，否则无法留痕。")
        if card["state"] not in ("pending", "approved"):
            raise ApiError("当前状态不能拒绝", 409)
        if not card["permissions"].get("reject"):
            raise ApiError("当前角色没有这张卡的拒绝权", 403)
        rec = runtime["cards"].get(card_id) or {}
        rec.update({
            "state": "rejected", "decision": "reject", "reason": reason,
            "by": role["name"], "at": now,
        })
        runtime["cards"][card_id] = rec
        save_runtime(pid, runtime)
        AUDIT.append(pid, role["name"], role["id"], "reject",
                     card_id=card_id, reason=reason, kind=card["kind"])
        return "已拒绝并留痕", build_snapshot(pid, role["id"], scene)

    if action in ("approve", "approve_dispatch"):
        if card["state"] != "pending":
            raise ApiError("这张卡已经不是待审核状态", 409)
        if not card["permissions"].get("approve"):
            raise ApiError(
                "当前角色无权审批：常规卡需值班调度长，应急卡需值班领导。", 403)
        cand = _default_candidate(card) if not body.get("candidate") else _find_candidate(card, body["candidate"])
        if not cand:
            raise ApiError("请选择一个候选动作")
        rec = runtime["cards"].get(card_id) or {}
        rec.update({
            "state": "approved", "candidate": cand["id"], "decision": "approve",
            "by": role["name"], "at": now,
        })
        runtime["cards"][card_id] = rec
        save_runtime(pid, runtime)
        AUDIT.append(pid, role["name"], role["id"], "approve",
                     card_id=card_id, candidate=cand["id"], candidate_name=cand["name"],
                     kind=card["kind"])
        if action == "approve":
            return "已批准，等待下发", build_snapshot(pid, role["id"], scene)

        if not workflow.can_dispatch(role):
            raise ApiError("已批准，但当前角色没有下发权限；请切到调度员或车队负责人。", 403)
        return _dispatch_task(pid, card, cand, role, scene, now)

    # dispatch only
    if card["state"] != "approved":
        raise ApiError("只有“已批准·待下发”的卡才能下发", 409)
    if not card["permissions"].get("dispatch"):
        raise ApiError("当前角色没有下发权限", 403)
    cand = _default_candidate(card)
    if not cand:
        raise ApiError("这张卡没有可下发的候选动作", 400)
    return _dispatch_task(pid, card, cand, role, scene, now)


def _plus_minutes(hhmm, minutes):
    try:
        h, m = [int(x) for x in str(hhmm).split(":")[:2]]
    except (TypeError, ValueError):
        return now_hm()
    total = (h * 60 + m + int(minutes)) % (24 * 60)
    return "%02d:%02d" % (total // 60, total % 60)


def _dispatch_task(pid, card, cand, role, scene, now):
    runtime = RUNTIMES.load(pid)
    snap = build_snapshot(pid, role["id"], scene)
    date = snap["meta"]["date"]
    demo = snap["meta"].get("is_demo")
    base_time = scenes.get(scene).get("time") if demo else now_hm()
    depart = _plus_minutes(base_time, 12)
    tasks = workflow.make_tasks(pid, date, card, cand.get("effect") or {},
                                config.DEMO_FLEET, depart)
    for i, task in enumerate(tasks, 1):
        task["created_at"] = now
        task["change_note"] = _task_change_note(card, cand, i, len(tasks))
        task["demo"] = True
    runtime["tasks"].extend(tasks)
    rec = runtime["cards"].get(card["id"]) or {}
    rec.update({
        "state": "dispatched", "candidate": cand["id"],
        "dispatched_by": role["name"], "dispatched_at": now,
        "task_ids": [t["id"] for t in tasks],
    })
    runtime["cards"][card["id"]] = rec
    save_runtime(pid, runtime)
    AUDIT.append(pid, role["name"], role["id"], "dispatch",
                 card_id=card["id"], candidate=cand["id"],
                 task_ids=[t["id"] for t in tasks])
    return "已下发 %d 张任务单" % len(tasks), build_snapshot(pid, role["id"], scene)


def _apply_task(pid, body, role):
    action = (body.get("action") or "").strip()
    task_id = (body.get("task_id") or "").strip()
    if action not in ("accept", "report"):
        raise ApiError("不支持的任务动作")
    if not workflow.can_report(role):
        raise ApiError("当前角色没有接单/报数权限", 403)

    pid = _project_id(pid)
    runtime = RUNTIMES.load(pid)
    task = next((t for t in runtime.get("tasks") or [] if t.get("id") == task_id), None)
    if not task:
        raise ApiError("找不到任务单", 404)
    now = now_iso()
    if action == "accept":
        if task.get("status") != "dispatched":
            raise ApiError("只有“已下发·待接单”的任务可以接单", 409)
        task["status"] = "accepted"
        task["accepted_by"] = role["name"]
        task["accepted_at"] = now
        AUDIT.append(pid, role["name"], role["id"], "task_accept",
                     card_id=task.get("card_id") or "", task_id=task_id)
        save_runtime(pid, runtime)
        return "已接单", build_snapshot(pid, role["id"], body.get("scene"))

    if task.get("status") not in ("dispatched", "accepted"):
        raise ApiError("只有“已下发/已接单”的任务可以报数", 409)
    report = body.get("report") or {}
    action_id = report.get("action") or "normal"
    if action_id not in REPORT_ACTIONS:
        raise ApiError("报数只能是 normal / crowded / full")
    label, risk = REPORT_ACTIONS[action_id]
    try:
        queue = max(0, int(report.get("queue") or 0))
    except (TypeError, ValueError):
        raise ApiError("排队人数必须是整数")
    receipt = "R-" + uuid.uuid4().hex[:4].upper()
    rec = {
        "action": action_id, "label": label, "queue": queue,
        "at": now_hm(), "note": (report.get("note") or "").strip(),
        "risk": risk,
    }
    task.setdefault("reports", []).append(rec)
    task["status"] = "reported"
    task["receipt"] = receipt
    task["reported_at"] = now
    runtime.setdefault("station_reports", []).insert(0, {
        "station": body.get("station") or "诺日朗站",
        "queue": queue, "action": action_id, "label": label,
        "at": now_hm(), "note": rec["note"], "task_id": task_id,
    })
    AUDIT.append(pid, role["name"], role["id"], "task_report",
                 card_id=task.get("card_id") or "", task_id=task_id,
                 report=label, queue=queue, receipt=receipt)
    save_runtime(pid, runtime)
    return "已回执 %s" % receipt, build_snapshot(pid, role["id"], body.get("scene"))


def _apply_plan(pid, body, role):
    if not workflow.role_can(role, "plan"):
        raise ApiError("当前角色没有排班调整权限", 403)
    pid = _project_id(pid)
    scene = _scene(body.get("scene"))
    snapshot = build_snapshot(pid, role["id"], scene)
    slot = (body.get("slot") or "").strip()
    row = next((r for r in (snapshot.get("plan") or {}).get("rows") or []
                if r.get("slot") == slot), None)
    if not row:
        raise ApiError("找不到这个时段", 404)
    runtime = RUNTIMES.load(pid)
    overrides = runtime.setdefault("plan", {}).setdefault("overrides", {})
    ov = overrides.get(slot) or {}
    if body.get("veh") is not None:
        try:
            veh = int(body["veh"])
        except (TypeError, ValueError):
            raise ApiError("车数必须是整数")
        if not (1 <= veh <= 999):
            raise ApiError("车数需在 1–999 之间")
        ov["veh"] = veh
    if body.get("locked") is not None:
        ov["locked"] = bool(body["locked"])
    if not ov:
        overrides.pop(slot, None)
    else:
        overrides[slot] = ov
    save_runtime(pid, runtime)
    AUDIT.append(pid, role["name"], role["id"], "plan_edit",
                 slot=slot, veh=ov.get("veh"), locked=ov.get("locked"))
    return "班次已更新", build_snapshot(pid, role["id"], scene)


def _optimizer_input(pid, role, scene):
    """Build solver input from trusted server state only."""
    project = PROJECTS.load(pid)
    runtime = RUNTIMES.load(pid)
    snap = build_snapshot(pid, role["id"], scene)
    plan = snap.get("plan") or {}
    summary = plan.get("summary") or {}
    locked = {r["slot"]: int(r["veh"]) for r in plan.get("rows", []) if r.get("locked")}
    source = plan.get("source") or {}
    rows = [{"slot": r["slot"], "flow": int(r["flow"]),
             "assumed": "假设" in (source.get("text") or "")}
            for r in plan.get("rows", [])]
    # The same per-hour driver availability is a conservative concurrent cap,
    # not a substitute for a real shift/continuous-driving schedule.
    p = project["params"]
    try:
        driver_cap = int(float(p.get("c_driver_total")))
    except (TypeError, ValueError):
        driver_cap = int(summary.get("available") or 0)
    available = max(0, min(int(float(summary.get("available") or 0)), driver_cap))
    safety = float(p.get("d_safety_margin") or 0.15)
    fingerprint, _ = optimizer.input_fingerprint(rows, available, summary.get("cap_unit") or 0,
                                                  safety, locked)
    return project, runtime, snap, rows, available, float(summary.get("cap_unit") or 0), safety, locked, fingerprint


def _optimize_plan(pid, body, role):
    if not workflow.role_can(role, "plan"):
        raise ApiError("当前角色没有排班查看权限", 403)
    pid = _project_id(pid)
    scene = _scene(body.get("scene"))
    _, _, _, rows, available, cap_unit, safety, locked, fingerprint = _optimizer_input(pid, role, scene)
    result = optimizer.optimize(rows, available, cap_unit, locked, safety)
    if result.get("status") == "feasible":
        OPTIMIZER_CANDIDATES[(pid, role["id"], result["input_fingerprint"])] = result
    return result


def _apply_optimized_plan(pid, body, role):
    if not workflow.role_can(role, "plan"):
        raise ApiError("当前角色没有排班调整权限", 403)
    pid = _project_id(pid)
    scene = _scene(body.get("scene"))
    _, runtime, snap, rows, available, cap_unit, safety, locked, fingerprint = _optimizer_input(pid, role, scene)
    supplied = body.get("input_fingerprint")
    if not supplied or supplied != fingerprint:
        raise ApiError("优化输入已变化，请重新生成建议后再应用。", 409)
    candidate = OPTIMIZER_CANDIDATES.pop((pid, role["id"], supplied), None)
    if not candidate or candidate.get("status") != "feasible":
        raise ApiError("找不到有效的待应用优化建议，请重新生成。", 409)
    recommendations = candidate.get("rows") or []
    if len(recommendations) != len(rows):
        raise ApiError("服务端候选方案格式无效，请重新生成。", 409)
    values = [r["veh"] for r in recommendations]
    errors = optimizer.validate_solution(rows, values, available, cap_unit, safety, locked)
    if errors:
        raise ApiError("优化建议复核失败：" + "；".join(errors), 409)
    overrides = runtime.setdefault("plan", {}).setdefault("overrides", {})
    for row, veh in zip(rows, values):
        if row["slot"] not in locked:
            previous = overrides.get(row["slot"]) or {}
            overrides[row["slot"]] = {"veh": veh, **({"locked": previous["locked"]} if "locked" in previous else {})}
    save_runtime(pid, runtime)
    AUDIT.append(pid, role["name"], role["id"], "plan_optimizer_apply",
                 input_fingerprint=fingerprint, slots=len(rows), vehicles=sum(values))
    return "已应用优化建议；计划仍需按现有流程审批后方可下发。", build_snapshot(pid, role["id"], scene)


def _apply_review(pid, body, role):
    if not workflow.role_can(role, "writeback"):
        raise ApiError("当前角色没有复盘写回权限", 403)
    key = (body.get("key") or "").strip()
    scene = _scene(body.get("scene") or "evening")
    snapshot = build_snapshot(pid, role["id"], scene)
    wb = next((w for w in (snapshot.get("review") or {}).get("writebacks") or []
               if w.get("key") == key), None)
    if not wb:
        raise ApiError("没有这条写回建议", 404)
    if wb.get("applied"):
        raise ApiError("这条参数已经写回过", 409)

    pid = _project_id(pid)
    project = PROJECTS.load(pid)
    params = project["params"]
    params[key] = wb["new"]
    PROJECTS.save(pid, project["name"], params, demo=project["demo"], note=project["note"])
    runtime = RUNTIMES.load(pid)
    runtime.setdefault("review", {}).setdefault("writebacks", {})[key] = {
        "at": now_iso(), "by": role["name"], "old": wb["old"], "new": wb["new"],
    }
    save_runtime(pid, runtime)
    AUDIT.append(pid, role["name"], role["id"], "writeback",
                 key=key, old=wb["old"], new=wb["new"])
    return "已写回参数 %s" % key, build_snapshot(pid, role["id"], scene)


def _apply_params(pid, body, role):
    if not workflow.role_can(role, "edit_params"):
        raise ApiError("当前角色没有参数编辑权限", 403)
    pid = _project_id(pid)
    project = PROJECTS.load(pid)
    params = dict(project["params"])
    incoming = body.get("params") or {}
    if not isinstance(incoming, dict):
        raise ApiError("params 必须是对象")
    changed = []
    for key, value in incoming.items():
        f = FIELD_MAP.get(key)
        if not f:
            continue
        typ = f.get("type")
        try:
            if typ == "num":
                value = "" if value in (None, "") else float(value)
                if isinstance(value, float) and value.is_integer():
                    value = int(value)
            elif typ == "multi":
                if isinstance(value, str):
                    value = [x.strip() for x in value.split(",") if x.strip()]
                if not isinstance(value, list):
                    raise ValueError
            elif typ == "bool":
                value = bool(value)
            else:
                value = "" if value is None else str(value)
        except (TypeError, ValueError):
            raise ApiError("参数 %s 的格式不正确" % f.get("label", key))
        params[key] = value
        changed.append(key)
    if not changed:
        raise ApiError("没有可保存的参数")
    name = (body.get("name") or project["name"]).strip()
    PROJECTS.save(pid, name, params, demo=project["demo"], note=project["note"])
    AUDIT.append(pid, role["name"], role["id"], "params_save",
                 keys=changed, count=len(changed))
    return "已保存 %d 项参数" % len(changed), build_snapshot(pid, role["id"], body.get("scene"))


def _projects_action(body, role):
    action = (body.get("action") or "create").strip()
    if action == "create":
        name = (body.get("name") or "").strip()
        pid = (body.get("id") or "").strip()
        if not pid:
            pid = "project-" + datetime.now().strftime("%m%d%H%M%S")
        try:
            pid = safe_id(pid)
        except ValueError:
            raise ApiError("项目 id 只能包含字母、数字、下划线、短横线，长度 1–64。")
        if PROJECTS.exists(pid):
            raise ApiError("项目 id 已存在")
        params = blank_params()
        params["_name"] = name or pid
        params["_note"] = "新建项目：先补 16 项 P0，再看结论。"
        PROJECTS.create(pid, name or pid, params, demo=False,
                        note="新建项目：先补 16 项 P0，再看结论。")
        RUNTIMES.save(pid, default_runtime(pid))
        AUDIT.append(pid, role["name"], role["id"], "project_create", name=name or pid)
        return "项目已创建", pid
    if action == "duplicate":
        try:
            source = safe_id(body.get("source_id") or "")
        except ValueError:
            raise ApiError("源项目 id 不合法。")
        new_id = (body.get("new_id") or "").strip()
        if not new_id:
            new_id = source + "-copy-" + datetime.now().strftime("%H%M%S")
        try:
            new_id = safe_id(new_id)
        except ValueError:
            raise ApiError("目标项目 id 不合法。")
        if PROJECTS.exists(new_id):
            raise ApiError("目标 id 已存在")
        PROJECTS.duplicate(source, new_id, (body.get("name") or "").strip() or None)
        RUNTIMES.save(new_id, default_runtime(new_id))
        AUDIT.append(new_id, role["name"], role["id"], "project_duplicate", source=source)
        return "已复制项目", new_id
    if action == "delete":
        try:
            pid = safe_id(body.get("id") or "")
        except ValueError:
            raise ApiError("项目 id 不合法。")
        if len(PROJECTS.list()) <= 1:
            raise ApiError("至少保留一个项目")
        PROJECTS.delete(pid)
        AUDIT.append(pid, role["name"], role["id"], "project_delete")
        return "已删除项目", _project_id(None)
    raise ApiError("不支持的项目动作")


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "DispatchOS/" + config.VERSION
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    # ---- responses
    def _send(self, status, body=b"", content_type="application/octet-stream", extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store" if content_type.startswith("application/json")
                         else "no-cache")
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _error(self, exc):
        if isinstance(exc, ApiError):
            self._json({"ok": False, "error": exc.message}, exc.status)
        else:
            traceback.print_exc()
            self._json({"ok": False, "error": "服务内部错误：%s" % exc}, 500)

    def _authorized(self):
        if urlparse(self.path).path == "/healthz":
            return True
        expected_user = os.environ.get("DISPATCHOS_ACCESS_USER", "")
        expected_password = os.environ.get("DISPATCHOS_ACCESS_PASSWORD", "")
        if not expected_user and not expected_password:
            return True
        header = self.headers.get("Authorization", "")
        scheme, _, token = header.partition(" ")
        try:
            decoded = base64.b64decode(token, validate=True).decode("utf-8") if scheme.lower() == "basic" else ""
        except (ValueError, UnicodeDecodeError):
            decoded = ""
        username, separator, password = decoded.partition(":")
        if (separator and hmac.compare_digest(username, expected_user)
                and hmac.compare_digest(password, expected_password)):
            return True
        self._send(401, b"Authentication required", "text/plain; charset=utf-8", {
            "WWW-Authenticate": 'Basic realm="DispatchOS", charset="UTF-8"',
        })
        return False

    def _read_json(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0:
            return {}
        if n > 2 * 1024 * 1024:
            raise ApiError("请求体过大", 413)
        raw = self.rfile.read(n)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise ApiError("请求不是合法 JSON")
        if not isinstance(data, dict):
            raise ApiError("请求体必须是对象")
        return data

    def _static(self, path):
        rel = unquote(path).lstrip("/") or "index.html"
        if rel == "favicon.ico":
            self._send(204)
            return
        target = (config.STATIC / rel).resolve()
        root = config.STATIC.resolve()
        try:
            if os.path.commonpath([str(target), str(root)]) != str(root):
                raise ApiError("非法路径", 403)
        except ValueError:
            raise ApiError("非法路径", 403)
        if not target.is_file():
            raise ApiError("文件不存在", 404)
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype)

    def _snapshot_response(self, pid=None, role=None, scene=None):
        snap = build_snapshot(pid, role, scene)
        return {"ok": True, "snapshot": snap, "projects": all_projects()}

    # ---- GET
    def do_GET(self):
        if not self._authorized():
            return
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/healthz":
                self._send(200, b"ok", "text/plain; charset=utf-8")
                return
            q = parse_qs(parsed.query)
            q1 = {k: (v[0] if v else "") for k, v in q.items()}
            path = parsed.path

            if path == "/api/health":
                self._json({"ok": True, "app": config.APP_NAME,
                            "version": config.VERSION, "projects": len(PROJECTS.list())})
                return
            if path == "/api/assistant/status":
                self._json({"ok": True, **assistant.status()})
                return
            if path == "/api/assistant/models":
                try:
                    result = assistant.list_models()
                except assistant.NotConfigured as exc:
                    raise ApiError(str(exc), 503)
                except RuntimeError as exc:
                    raise ApiError(str(exc), 502)
                self._json({"ok": True, **result})
                return
            if path == "/api/bootstrap":
                self._json(self._snapshot_response(q1.get("project"), q1.get("role"),
                                                  q1.get("scene")))
                return
            if path == "/api/snapshot":
                self._json(self._snapshot_response(q1.get("project"), q1.get("role"),
                                                  q1.get("scene")))
                return
            if path == "/api/projects":
                self._json({"ok": True, "projects": all_projects()})
                return
            if path == "/api/audit":
                pid = _project_id(q1.get("project"))
                limit = max(1, min(200, int(q1.get("limit") or 40)))
                self._json({"ok": True, "audit": AUDIT.tail(pid, limit)})
                return
            if path == "/api/export/report":
                pid = _project_id(q1.get("project"))
                snap = build_snapshot(pid, q1.get("role"), q1.get("scene"))
                md = dashboard.export_markdown(snap)
                body = md.encode("utf-8")
                name = "DispatchOS-%s-%s.md" % (snap["meta"]["date"], snap["meta"]["scene"]["id"])
                self._send(200, body, "text/markdown; charset=utf-8", {
                    "Content-Disposition": "attachment; filename=\"%s\"; filename*=UTF-8''%s"
                    % (name, quote(name))
                })
                return
            if path == "/api/export/snapshot":
                pid = _project_id(q1.get("project"))
                snap = build_snapshot(pid, q1.get("role"), q1.get("scene"))
                body = json.dumps(snap, ensure_ascii=False, indent=2).encode("utf-8")
                name = "DispatchOS-snapshot-%s.json" % snap["meta"]["date"]
                self._send(200, body, "application/json; charset=utf-8", {
                    "Content-Disposition": "attachment; filename=\"%s\"" % name
                })
                return
            if path == "/api/export/params":
                pid = _project_id(q1.get("project"))
                p = PROJECTS.load(pid)
                body = json.dumps(p, ensure_ascii=False, indent=2).encode("utf-8")
                name = "DispatchOS-params-%s.json" % p["id"]
                self._send(200, body, "application/json; charset=utf-8", {
                    "Content-Disposition": "attachment; filename=\"%s\"" % name
                })
                return
            if path.startswith("/api/"):
                raise ApiError("未知接口", 404)
            self._static(path)
        except Exception as exc:
            self._error(exc)

    # ---- POST
    def do_POST(self):
        if not self._authorized():
            return
        try:
            parsed = urlparse(self.path)
            body = self._read_json()
            path = parsed.path
            role = _role(body.get("role"))
            if path == "/api/assistant/chat":
                message = str(body.get("message") or "").strip()
                if not message:
                    raise ApiError("请先输入问题")
                if len(message) > 1200:
                    raise ApiError("问题不能超过 1200 字")
                pid = _project_id(body.get("project"))
                snap = build_snapshot(pid, role["id"], body.get("scene"))
                try:
                    answer = assistant.ask(message, assistant.context_from_snapshot(snap))
                except assistant.NotConfigured as exc:
                    raise ApiError(str(exc), 503)
                except RuntimeError as exc:
                    raise ApiError(str(exc), 502)
                self._json({"ok": True, "answer": answer})
                return
            if path == "/api/assistant/extract":
                material = str(body.get("material") or "").strip()
                if not material:
                    raise ApiError("请先粘贴资料内容")
                try:
                    items = assistant.extract_material(material)
                except ValueError as exc:
                    raise ApiError(str(exc))
                except assistant.NotConfigured as exc:
                    raise ApiError(str(exc), 503)
                except RuntimeError as exc:
                    raise ApiError(str(exc), 502)
                self._json({"ok": True, "items": items})
                return
            if path == "/api/assistant/agent":
                question = str(body.get("message") or "").strip()
                if not question or len(question) > 1200:
                    raise ApiError("请输入问题（最多 1200 字）")
                pid = _project_id(body.get("project"))
                scene_id = _scene(body.get("scene"))
                current_snap = build_snapshot(pid, role["id"], scene_id)
                def compact(snap):
                    return assistant.context_from_snapshot(snap)
                def compare_scenes():
                    rows = []
                    for sc in scenes.SCENES:
                        snap = build_snapshot(pid, role["id"], sc["id"])
                        rows.append({"scene": sc.get("label"), "summary": snap.get("summary"),
                                     "overview": snap.get("overview"), "plan": snap.get("plan")})
                    return rows
                tools = {
                    "get_snapshot": lambda: compact(current_snap),
                    "get_review": lambda: current_snap.get("review", {}),
                    "get_recommendations": lambda: (current_snap.get("desk") or {}).get("cards", []),
                    "compare_scenes": compare_scenes,
                }
                try:
                    result = assistant.run_agent(question, tools)
                except assistant.NotConfigured as exc:
                    raise ApiError(str(exc), 503)
                except RuntimeError as exc:
                    raise ApiError(str(exc), 502)
                self._json({"ok": True, **result})
                return
            if path == "/api/assistant/settings":
                try:
                    saved = assistant.save_settings(body)
                except ValueError as exc:
                    raise ApiError(str(exc))
                self._json({"ok": True, "settings": saved})
                return
            if path == "/api/assistant/test":
                try:
                    result = assistant.test_connection()
                except assistant.NotConfigured as exc:
                    raise ApiError(str(exc), 503)
                except RuntimeError as exc:
                    raise ApiError(str(exc), 502)
                self._json({"ok": True, **result})
                return
            if path == "/api/decision":
                msg, snap = _apply_decision(body.get("project"), body, role)
                self._json({"ok": True, "message": msg, "snapshot": snap,
                            "projects": all_projects()})
                return
            if path == "/api/task":
                msg, snap = _apply_task(body.get("project"), body, role)
                self._json({"ok": True, "message": msg, "snapshot": snap,
                            "projects": all_projects()})
                return
            if path == "/api/plan":
                msg, snap = _apply_plan(body.get("project"), body, role)
                self._json({"ok": True, "message": msg, "snapshot": snap,
                            "projects": all_projects()})
                return
            if path == "/api/plan/optimize":
                result = _optimize_plan(body.get("project"), body, role)
                self._json({"ok": True, "recommendation": result})
                return
            if path == "/api/plan/optimize/apply":
                msg, snap = _apply_optimized_plan(body.get("project"), body, role)
                self._json({"ok": True, "message": msg, "snapshot": snap,
                            "projects": all_projects()})
                return
            if path == "/api/review":
                msg, snap = _apply_review(body.get("project"), body, role)
                self._json({"ok": True, "message": msg, "snapshot": snap,
                            "projects": all_projects()})
                return
            if path == "/api/params":
                msg, snap = _apply_params(body.get("project"), body, role)
                self._json({"ok": True, "message": msg, "snapshot": snap,
                            "projects": all_projects()})
                return
            if path == "/api/projects":
                msg, pid = _projects_action(body, role)
                snap = build_snapshot(pid, role["id"], body.get("scene"))
                self._json({"ok": True, "message": msg, "snapshot": snap,
                            "projects": all_projects(), "project_id": pid})
                return
            if path == "/api/reset":
                pid = _project_id(body.get("project"))
                runtime = demo_runtime(pid) if pid == config.DEMO_PROJECT else default_runtime(pid)
                RUNTIMES.save(pid, runtime)
                AUDIT.append(pid, role["name"], role["id"], "runtime_reset")
                self._json({"ok": True, "message": "运行时已重置",
                            "snapshot": build_snapshot(pid, role["id"], body.get("scene")),
                            "projects": all_projects()})
                return
            raise ApiError("未知接口", 404)
        except Exception as exc:
            self._error(exc)

    def do_HEAD(self):
        self.do_GET()

    def do_OPTIONS(self):
        if not self._authorized():
            return
        self._send(204, b"", "text/plain", {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        })


def ensure_started():
    if not PROJECTS.list():
        pid = "jiuzhaigou"
        seed_path = config.BASE / "seed" / (pid + ".json")
        seed = {}
        try:
            seed = json.loads(seed_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        params = seed.get("params") if isinstance(seed.get("params"), dict) else blank_params()
        name = seed.get("name") or "九寨沟风景名胜区"
        params["_name"] = name
        PROJECTS.create(pid, name, params, demo=True,
                        note=seed.get("note") or "演示项目")
        RUNTIMES.save(pid, demo_runtime(pid))


class ExclusiveHTTPServer(ThreadingHTTPServer):
    """Windows 上禁用地址复用。

    默认 allow_reuse_address=1 会打开 SO_REUSEADDR，Windows 允许同一端口上叠加
    多个监听：旧进程结束后套接字仍占着端口，新进程却能“启动成功”却收不到请求，
    浏览器只会一直超时。独占绑定让第二个进程立刻得到明确的“端口被占用”。
    """

    allow_reuse_address = False

    def server_bind(self):
        if os.name == "nt":
            try:
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            except (AttributeError, OSError):
                pass
        super().server_bind()


def main():
    parser = argparse.ArgumentParser(description=config.APP_NAME)
    parser.add_argument("--host", default=os.environ.get("DISPATCHOS_HOST", config.HOST))
    parser.add_argument("--port", type=int,
                        default=int(os.environ.get("DISPATCHOS_PORT", str(config.PORT))))
    args = parser.parse_args()
    if os.environ.get("DISPATCHOS_REQUIRE_AUTH") == "1" and not (
            os.environ.get("DISPATCHOS_ACCESS_USER") and
            os.environ.get("DISPATCHOS_ACCESS_PASSWORD")):
        print("公网部署已要求登录；请设置 DISPATCHOS_ACCESS_USER 和 DISPATCHOS_ACCESS_PASSWORD。")
        return 2
    ensure_started()
    try:
        server = ExclusiveHTTPServer((args.host, args.port), Handler)
    except OSError as exc:
        print("端口 %s:%d 无法绑定，通常是被其它进程占用。" % (args.host, args.port))
        print("原因：%s" % exc)
        print("换个端口再试，例如：python app.py --port 8788")
        return 1
    print("%s %s" % (config.APP_NAME, config.VERSION))
    print("http://%s:%d" % (args.host, args.port))
    print("Ctrl+C 停止。所有审批、任务与写回写入 data/decisions.jsonl。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
