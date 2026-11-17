# -*- coding: utf-8 -*-
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import config
from engine import dashboard
from storage import ProjectStore, RuntimeStore

p = ProjectStore().load(config.DEMO_PROJECT)
r = RuntimeStore().load(config.DEMO_PROJECT)
projects = [{"id": p["id"], "name": p["name"], "demo": p["demo"], "saved": p["saved"],
             "note": p["note"], "p0_filled": 16, "p0_total": 16, "completeness": 1.0}]
for scene in ("eve", "morning", "noon", "evening"):
    s = dashboard.build(p["params"], p["name"], p["id"], scene, r, "dispatcher",
                        projects, [], p)
    print(scene, json.dumps({
        "summary": s["summary"],
        "kpis": [(k["label"], k["display"], k["unit"], k["status"]) for k in s["overview"]["kpis"]],
        "cards": [(c["id"], c["state"], c["kind"], [(x["id"], x["after"]["margin"]) for x in c["candidates"]]) for c in s["desk"]["cards"]],
        "plan_gap": s["plan"]["summary"],
        "review": s["review"]["deviations"],
        "len": len(json.dumps(s, ensure_ascii=False)),
    }, ensure_ascii=False))
