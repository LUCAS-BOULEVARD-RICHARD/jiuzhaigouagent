# -*- coding: utf-8 -*-
"""简化排队仿真：单站、单方向、按发车间隔成批放行。

边界（必须在报告中原样保留）：
- 只模拟主导方向主站的候车队列，不模拟两端同时装载、车辆在站内的交织与超车限制；
- 到达按泊松过程，服务按"每班车最多 seats 人、先到先上"；
- 未上车的乘客留在队列里，窗口结束仍滞留的计为 residual；
- 结果仅用于比较不同发车间隔与容量的相对效果，不是真实候车时间预测。
"""
import math
import random

REPS = 60
WINDOW_MIN = 60
SEED = 20261111


def _arrivals(rate_per_min, minutes, rng):
    """泊松到达的到达时刻（分钟）。"""
    times, t = [], 0.0
    while True:
        t += rng.expovariate(rate_per_min) if rate_per_min > 0 else float("inf")
        if t >= minutes:
            break
        times.append(t)
    return times


def _one_run(arrivals, headway, seats, minutes):
    departs = []
    t = headway
    while t <= minutes - 1e-9:
        departs.append(t)
        t += headway
    # 收尾班：窗口结束时刻补一班，避免"末班后到站"被误算成滞留，滞留只反映运力不足
    if not departs or departs[-1] < minutes - 1e-9:
        departs.append(minutes)
    waits, queue, idx, max_q, served = [], [], 0, 0, 0
    for d in departs:
        while idx < len(arrivals) and arrivals[idx] <= d:
            queue.append(arrivals[idx])
            idx += 1
        max_q = max(max_q, len(queue))
        take = min(len(queue), seats)
        for _ in range(take):
            waits.append(d - queue.pop(0))
        served += take
    residual = len(queue) + (len(arrivals) - idx)
    return waits, max_q, residual, served, len(departs)


def simulate(metrics, params=None, headways=None, seats=None):
    seats = int(seats or metrics.get("seats") or 35)
    split = 0.6
    if params:
        try:
            split = float(params.get("a_direction_split") or 0.6)
        except (TypeError, ValueError):
            split = 0.6
    peak = float(metrics.get("demand_peak") or 0)
    rate = max(0.01, peak * split / WINDOW_MIN)   # 主导方向 人/分钟

    if headways is None:
        h = float(metrics.get("headway") or 10)
        headways = [("现状/建议间隔", h), ("加密 20%", h * 0.8), ("放松 20%", h * 1.2),
                    ("压力：需求 +30%", h, 1.3)]
    specs = [(x[0], x[1], x[2] if len(x) > 2 else 1.0) for x in headways]

    # 各档共用同一批到达序列（配对比较），否则档间差异会被随机流噪声掩盖
    cache = {}

    def series_for(mult):
        if mult not in cache:
            r = max(0.01, rate * mult)
            cache[mult] = [_arrivals(r, WINDOW_MIN, random.Random(SEED + rep)) for rep in range(REPS)]
        return cache[mult]

    out = []
    for name, h, mult in specs:
        h = max(0.2, round(float(h), 2))
        series = series_for(mult)
        mw, p90s, mq, res, served_all, trips = [], [], [], [], [], []
        for arr in series:
            waits, max_q, residual, served, n_trips = _one_run(arr, h, seats, WINDOW_MIN)
            mw.append(sum(waits) / len(waits) if waits else 0.0)
            if waits:
                s = sorted(waits)
                p90s.append(s[min(len(s) - 1, int(round(0.9 * (len(s) - 1))))])
            else:
                p90s.append(0.0)
            mq.append(max_q)
            res.append(residual)
            served_all.append(served)
            trips.append(n_trips)
        out.append({
            "name": name, "headway": h, "mult": mult,
            "arrived": round(rate * mult * WINDOW_MIN),
            "served": round(sum(served_all) / REPS),
            "mean_wait": round(sum(mw) / REPS, 1),
            "p90_wait": round(sum(p90s) / REPS, 1),
            "max_queue": int(round(sum(mq) / REPS)),
            "residual": round(sum(res) / REPS, 1),
            "trips": round(sum(trips) / REPS, 1),
        })
    return {
        "rows": out,
        "rate_per_min": round(rate, 2),
        "seats": seats,
        "window": WINDOW_MIN,
        "reps": REPS,
        "note": "简化排队模型（单站单方向、泊松到达、先到先上），仅用于比较发车间隔的相对效果，不作为真实候车时间预测",
    }
