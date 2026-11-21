# -*- coding: utf-8 -*-
"""DispatchOS 全局配置。

设计原则：界面里出现的每个“能不能做”，都在这里有一处声明；
后续加页面、加角色、加审批动作时，只改配置与对应注册表，不改路由主循环。
"""
from pathlib import Path
import os

BASE = Path(__file__).resolve().parent
DATA = Path(os.environ.get("DISPATCHOS_DATA_DIR", str(BASE / "data"))).resolve()
PROJECTS = DATA / "projects"
RUNTIME = DATA / "runtime"
AUDIT = DATA / "decisions.jsonl"
STATIC = BASE / "static"
SNAPSHOT_JS = STATIC / "demo_snapshot.js"

APP_NAME = "景枢 DispatchOS"
APP_SUBTITLE = "景区运力调度工作台"
VERSION = "1.0.0"
API_VERSION = 1
HOST = "127.0.0.1"
PORT = 8787

# 演示固定日：让跨天也能重复讲同一套四幕故事。
# 真实部署时由 bootstrap 的 server_date 覆盖；界面会标注“演示日期”。
DEMO_DATE = "2026-11-12"
DEMO_PROJECT = "jiuzhaigou"

# ---------------------------------------------------------------- 角色
# perms: view / edit_params / plan / decide_normal / decide_emergency /
#        dispatch / report / writeback / export
ROLES = [
    {
        "id": "command", "name": "指挥中心", "short": "指挥",
        "desc": "看全局与预警，不改参数、不代签审批",
        "default_page": "overview",
        "perms": ["view", "export"],
    },
    {
        "id": "dispatcher", "name": "调度员", "short": "调度",
        "desc": "填参数、排班、提建议、下发任务",
        "default_page": "overview",
        "perms": ["view", "edit_params", "plan", "decide_normal", "dispatch",
                  "report", "writeback", "export"],
    },
    {
        "id": "fleet", "name": "车队负责人", "short": "车队",
        "desc": "看班次、接执行、反馈运力",
        "default_page": "plan",
        "perms": ["view", "plan", "dispatch", "report", "export"],
    },
    {
        "id": "driver", "name": "司机中枢", "short": "司机中枢",
        "desc": "接收任务、现场报数、回执",
        "default_page": "driver",
        "perms": ["view", "report"],
    },
    {
        "id": "duty", "name": "值班领导", "short": "值班",
        "desc": "审批常规与应急、复盘写回",
        "default_page": "overview",
        "perms": ["view", "edit_params", "decide_normal", "decide_emergency",
                  "dispatch", "report", "writeback", "export"],
    },
]
ROLE_MAP = {r["id"]: r for r in ROLES}
DEFAULT_ROLE = "dispatcher"

# 页面注册表：前端按 id 渲染；后端只用于角色可见性与默认页。
PAGES = [
    {"id": "scenic", "name": "景区档案", "short": "档案", "icon": "mountain",
     "group": "入口", "desc": "多景区并存，选一个进入"},
    {"id": "params", "name": "工作台", "short": "工作台", "icon": "sliders",
     "group": "前置", "desc": "43 项输入、16 项必填、缺项与假设清单"},
    {"id": "overview", "name": "运行实况", "short": "实况", "icon": "grid",
     "group": "运行", "desc": "余量、瓶颈、三色风险与预警流"},
    {"id": "plan", "name": "运行计划", "short": "计划", "icon": "calendar",
     "group": "运行", "desc": "分时曲线、班次表、车/人缺口"},
    {"id": "desk", "name": "调度建议", "short": "建议", "icon": "inbox",
     "group": "决策", "desc": "候选动作、代价、审批、留痕"},
    {"id": "driver", "name": "司机中枢", "short": "司机中枢", "icon": "truck",
     "group": "司机中枢", "desc": "任务单、报数、回执"},
    {"id": "review", "name": "运营复盘", "short": "复盘", "icon": "chart",
     "group": "司机中枢", "desc": "计划 vs 实际、三项偏差、写回参数"},
    {"id": "guest", "name": "游客预约", "short": "游客预约", "icon": "phone",
     "group": "决策", "desc": "预约需求曲线、建议审批、入口控制"},
]
PAGE_MAP = {p["id"]: p for p in PAGES}
PAGE_ACCESS = {
    "scenic": {"command", "dispatcher", "fleet", "driver", "duty"},
    "params": {"command", "dispatcher", "fleet", "duty"},
    "overview": {"command", "dispatcher", "fleet", "duty"},
    "plan": {"command", "dispatcher", "fleet", "duty"},
    "desk": {"command", "dispatcher", "fleet", "duty"},
    "driver": {"command", "dispatcher", "fleet", "driver", "duty"},
    "review": {"command", "dispatcher", "fleet", "duty"},
    "guest": {"command", "dispatcher", "fleet", "duty"},
}

# ---------------------------------------------------------------- 证据
EVIDENCE = [
    {"id": "measured", "label": "实测", "mark": "", "color": "green",
     "desc": "有台账、票据、设备或现场记录，可追溯到来源"},
    {"id": "calculated", "label": "测算", "mark": "", "color": "blue",
     "desc": "由已登记参数按公式计算，口径可复核"},
    {"id": "simulated", "label": "仿真", "mark": "", "color": "cyan",
     "desc": "简化排队模型结果，只用于相对比较"},
    {"id": "assumed", "label": "假设", "mark": "†", "color": "amber",
     "desc": "缺项由程序补齐，改动它会改变结论"},
    {"id": "demo", "label": "演示", "mark": "†", "color": "violet",
     "desc": "为讲清交互而构造的演示数据，不是现场实测"},
    {"id": "input", "label": "填报", "mark": "", "color": "slate",
     "desc": "用户录入，尚未经过现场核验"},
]

# ---------------------------------------------------------------- 演示口径
DEMO_LIMITS = {
    "granularity": "整点",
    "station_level": False,
    "confidence_interval": False,
    "gis": False,
    "actuals": "演示数据†",
}

# 演示车队名册（任务单用；姓名与车牌均为示例）
DEMO_FLEET = [
    {"driver": "张伟", "phone": "138****2210", "plate": "川U·A1234"},
    {"driver": "李强", "phone": "139****7086", "plate": "川U·A1288"},
    {"driver": "王敏", "phone": "136****5531", "plate": "川U·B0521"},
    {"driver": "赵磊", "phone": "137****9042", "plate": "川U·B0673"},
]



