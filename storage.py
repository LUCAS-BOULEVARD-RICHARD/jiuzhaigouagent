# -*- coding: utf-8 -*-
"""持久化：项目参数、运行时状态、决策/任务审计。

三本账分开存，理由：
- 项目 JSON 是可移植的“参数资产”，可以被复制、导出、评审；
- runtime JSON 是当天的工作状态（卡、任务、手工排班、写回），可以单独清空；
- decisions.jsonl 是只追加的审计流，任何界面重算都不能改写它。
"""
import json
import os
import re
import threading
import uuid
from datetime import datetime
from pathlib import Path

import config
from engine.schema import blank_params

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_WRITE_LOCK = threading.Lock()


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def now_hm():
    return datetime.now().strftime("%H:%M")


def safe_id(value):
    value = (value or "").strip()
    if not _ID_RE.match(value):
        raise ValueError("项目 id 只能包含字母、数字、下划线和短横线（1-64 位）")
    return value


def _write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    text = json.dumps(data, ensure_ascii=False, indent=2)
    with _WRITE_LOCK:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)


def _read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def default_runtime(project_id=""):
    return {
        "project": project_id,
        "cards": {},
        "tasks": [],
        "plan": {"overrides": {}},
        "review": {"writebacks": {}},
        "station_reports": [],
        "notes": [],
        "updated": "",
    }


def demo_tasks():
    """预置两条演示任务，让司机端第一次打开就有东西可看。

    任务单号、车牌、司机姓名均为示例；页面上必须继续标“演示任务单†”。
    """
    return [
        {
            "id": "T-20261112-001",
            "project": config.DEMO_PROJECT,
            "card_id": "",
            "title": "早高峰加开 8 辆 · 沟口—长海区间",
            "vehicle": "川U·A1234",
            "plate": "川U·A1234",
            "driver": "张伟",
            "phone": "138****2210",
            "route": "沟口 → 长海（区间车）",
            "depart": "08:12",
            "change_note": "西线抽调 5 辆、备用车 3 辆，首班前 12 分钟到位；只跑主客流段，不进入原始森林支线。",
            "status": "dispatched",
            "created_at": "2026-11-12 07:52",
            "reports": [],
            "receipt": "",
            "demo": True,
        },
        {
            "id": "T-20261112-002",
            "project": config.DEMO_PROJECT,
            "card_id": "",
            "title": "诺日朗站补位 · 站点报数复核",
            "vehicle": "川U·A1288",
            "plate": "川U·A1288",
            "driver": "李强",
            "phone": "139****7086",
            "route": "诺日朗 → 沟口（返程）",
            "depart": "09:18",
            "change_note": "站点上报候车 38 人，临时插入一班返程；到站后由站务员复核队列。",
            "status": "reported",
            "created_at": "2026-11-12 09:06",
            "reports": [
                {"action": "crowded", "label": "拥挤", "queue": 38, "at": "09:26",
                 "note": "长海方向候车约 38 人，已引导至相邻站台"}
            ],
            "receipt": "R-7F3A",
            "demo": True,
        },
    ]


def demo_runtime(project_id=config.DEMO_PROJECT):
    r = default_runtime(project_id)
    r["tasks"] = demo_tasks()
    r["station_reports"] = [
        {"station": "诺日朗站", "queue": 34, "action": "crowded",
         "label": "拥挤", "at": "12:05", "note": "雨雪，候车 34 人，已加开一班"}
    ]
    r["updated"] = "2026-11-12 12:05"
    return r


class ProjectStore:
    def __init__(self, base=None):
        self.base = Path(base or config.PROJECTS)
        self.base.mkdir(parents=True, exist_ok=True)

    def path(self, project_id):
        return self.base / (safe_id(project_id) + ".json")

    def exists(self, project_id):
        try:
            return self.path(project_id).exists()
        except ValueError:
            return False

    def list(self):
        out = []
        for p in sorted(self.base.glob("*.json")):
            data = _read_json(p, {})
            if not isinstance(data, dict):
                continue
            pid = data.get("id") or p.stem
            out.append({
                "id": pid,
                "name": data.get("name") or pid,
                "saved": data.get("saved", ""),
                "created": data.get("created", ""),
                "demo": bool(data.get("demo")),
                "note": data.get("note", ""),
                "has_params": bool(data.get("params")),
            })
        out.sort(key=lambda x: (not x["demo"], x["name"]))
        return out

    def load(self, project_id):
        pid = safe_id(project_id)
        data = _read_json(self.path(pid))
        if not isinstance(data, dict):
            raise FileNotFoundError("项目不存在：%s" % pid)
        params = data.get("params")
        if not isinstance(params, dict):
            params = blank_params()
        base = blank_params()
        base.update(params)
        base["_sources"] = params.get("_sources") or {}
        base["_name"] = data.get("name") or params.get("_name") or pid
        return {
            "id": pid,
            "name": data.get("name") or pid,
            "saved": data.get("saved", ""),
            "created": data.get("created", ""),
            "demo": bool(data.get("demo")),
            "note": data.get("note", ""),
            "params": base,
        }

    def save(self, project_id, name, params, demo=None, note="", preserve=False):
        pid = safe_id(project_id)
        old = _read_json(self.path(pid), {}) or {}
        params = dict(params or {})
        params["_name"] = name or params.get("_name") or pid
        data = {
            "id": pid,
            "name": name or params.get("_name") or pid,
            "saved": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "created": old.get("created") or datetime.now().strftime("%Y-%m-%d %H:%M"),
            "demo": bool(old.get("demo")) if demo is None else bool(demo),
            "note": note if note != "" else old.get("note", ""),
            "params": params,
        }
        _write_json(self.path(pid), data)
        return data

    def create(self, project_id, name, params=None, demo=False, note=""):
        pid = safe_id(project_id)
        if self.path(pid).exists():
            raise ValueError("项目 id 已存在")
        p = blank_params()
        p.update(params or {})
        p["_name"] = name
        return self.save(pid, name, p, demo=demo, note=note)

    def duplicate(self, source_id, new_id, new_name=None):
        src = self.load(source_id)
        name = new_name or (src["name"] + " 复制")
        return self.create(new_id, name, src["params"], demo=False,
                           note=src.get("note", ""))

    def delete(self, project_id):
        pid = safe_id(project_id)
        p = self.path(pid)
        if not p.exists():
            raise FileNotFoundError("项目不存在：%s" % pid)
        p.unlink()
        rt = config.RUNTIME / (pid + ".json")
        if rt.exists():
            rt.unlink()


class RuntimeStore:
    def __init__(self, base=None):
        self.base = Path(base or config.RUNTIME)
        self.base.mkdir(parents=True, exist_ok=True)

    def path(self, project_id):
        return self.base / (safe_id(project_id) + ".json")

    def load(self, project_id):
        pid = safe_id(project_id)
        data = _read_json(self.path(pid))
        if not isinstance(data, dict):
            return demo_runtime(pid) if pid == config.DEMO_PROJECT else default_runtime(pid)
        base = default_runtime(pid)
        for k, v in data.items():
            if k in ("cards", "tasks", "plan", "review", "station_reports", "notes"):
                if isinstance(v, type(base[k])) or (isinstance(v, dict) and isinstance(base[k], dict)):
                    base[k] = v
                else:
                    base[k] = v
            else:
                base[k] = v
        # 老版本/手工编辑缺字段时补齐
        base.setdefault("cards", {})
        base.setdefault("tasks", [])
        base.setdefault("plan", {"overrides": {}})
        base["plan"].setdefault("overrides", {})
        base.setdefault("review", {"writebacks": {}})
        base["review"].setdefault("writebacks", {})
        base.setdefault("station_reports", [])
        base.setdefault("notes", [])
        base["project"] = pid
        return base

    def save(self, project_id, runtime):
        pid = safe_id(project_id)
        runtime = dict(runtime or {})
        runtime["project"] = pid
        runtime["updated"] = now_iso()
        _write_json(self.path(pid), runtime)
        return runtime


class AuditLog:
    def __init__(self, path=None):
        self.path = Path(path or config.AUDIT)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def append(self, project, actor, role, action, **fields):
        rec = {
            "id": "A-" + uuid.uuid4().hex[:8].upper(),
            "at": now_iso(),
            "project": project,
            "actor": actor,
            "role": role,
            "action": action,
        }
        rec.update({k: v for k, v in fields.items() if v not in (None, "")})
        line = json.dumps(rec, ensure_ascii=False)
        with self._lock:
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        return rec

    def tail(self, project=None, limit=50, since_reset=False):
        if not self.path.exists():
            return []
        lines = self.path.read_text(encoding="utf-8").splitlines()
        out = []
        for line in reversed(lines):
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if project and rec.get("project") != project:
                continue
            if since_reset and rec.get("action") == "runtime_reset":
                break
            out.append(rec)
            if len(out) >= limit:
                break
        return out
