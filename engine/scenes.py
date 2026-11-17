# -*- coding: utf-8 -*-
"""演示四幕：时间轴不是装饰，它同时是场景参数、页面默认值与叙事开关。

四幕与提纲 8.3 一一对应：
  1 前夜 20:00  运行计划
  2 07:40       运行实况 → 建议卡
  3 12:10       雨雪 → 应急卡
  4 18:30       运营复盘
"""

SCENES = [
    {
        "id": "eve", "act": 1, "label": "前夜", "time": "20:00", "day": "T-1",
        "weather": "晴", "temp": "6°C", "rain": False,
        "title": "前夜 · 把明天的账算完",
        "hint": "读预约与天气，生成次日分时曲线与班次表",
        "focus": "plan",
        "summary": "明日高峰余量 10.8%，建议加开 8 辆并锁定早高峰班次。",
    },
    {
        "id": "morning", "act": 2, "label": "早高峰", "time": "07:40", "day": "T",
        "weather": "晴", "temp": "11°C", "rain": False,
        "title": "早高峰 · 余量跌破警戒线",
        "hint": "高峰余量 10.8% < 15%，三个候选动作等待审批",
        "focus": "overview",
        "summary": "早高峰余量 10.8%，低于 15% 警戒线；建议在 08:10 前完成一次加车审批。",
    },
    {
        "id": "noon", "act": 3, "label": "午后", "time": "12:10", "day": "T",
        "weather": "雨夹雪", "temp": "3°C", "rain": True,
        "title": "午后 · 雨雪把循环时间拉长",
        "hint": "循环时间 +20%，有效运力下降，超出常规审批边界",
        "focus": "desk",
        "summary": "雨雪使循环时间 +20%，高峰余量转为 −7.0%；应急加车仍不足，需值班领导决定是否限流。",
    },
    {
        "id": "evening", "act": 4, "label": "收班", "time": "18:30", "day": "T",
        "weather": "雨转阴", "temp": "7°C", "rain": False,
        "title": "收班 · 把今天的偏差写回明天",
        "hint": "计划 vs 实际，三项偏差，确认后写回参数",
        "focus": "review",
        "summary": "今日收班：执行率 96.4%，平均候车比计划多 3.2 分钟；两项参数建议写回。",
    },
]
SCENE_MAP = {s["id"]: s for s in SCENES}
DEFAULT_SCENE = "morning"


def get(scene_id):
    return SCENE_MAP.get(scene_id) or SCENE_MAP[DEFAULT_SCENE]


def scene_params(params, scene_id):
    """返回该幕生效的参数拷贝。雨雪只改循环时间，不碰用户原值。"""
    s = get(scene_id)
    out = dict(params or {})
    if s.get("rain"):
        try:
            cycle = float(out.get("b_cycle_time") or 0)
        except (TypeError, ValueError):
            cycle = 0
        try:
            inc = float(out.get("b_rain_increase") or 0.2)
        except (TypeError, ValueError):
            inc = 0.2
        if cycle > 0:
            out["b_cycle_time"] = round(cycle * (1 + inc), 1)
        out["_scene_rain"] = True
    return out


def scene_public(s):
    return {
        "id": s["id"], "act": s["act"], "label": s["label"], "time": s["time"],
        "day": s["day"], "weather": s["weather"], "temp": s["temp"],
        "rain": s["rain"], "title": s["title"], "hint": s["hint"],
        "focus": s["focus"], "summary": s["summary"],
    }


def public_scenes():
    return [scene_public(s) for s in SCENES]

