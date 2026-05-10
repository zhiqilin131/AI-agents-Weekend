"""Map free-text calendar / schedule feedback into scheduler option tweaks (+ optional task filters)."""

from __future__ import annotations

import re

from foresight_x.decision_algorithms.schemas import ExecutionTask, SchedulerOptions


def _norm(s: str) -> str:
    return s.strip().lower()


def interpret_calendar_feedback(
    feedback: str,
    base: SchedulerOptions,
    tasks: list[ExecutionTask],
) -> tuple[SchedulerOptions, list[str], list[ExecutionTask]]:
    """
    Returns (adjusted_options, human_notes, filtered_tasks).

    Heuristic only (no network). Extend with LLM later if needed.
    """
    t = _norm(feedback)
    notes: list[str] = []
    opt = base.model_copy(deep=True)
    filtered = list(tasks)

    if not t:
        return opt, ["No feedback text — keeping current planner settings."], filtered

    # Time window
    if any(x in t for x in ("morning only", "mornings only", "早上", "上午", "early day")):
        opt.day_start_hour = max(6, min(opt.day_start_hour, 8))
        opt.day_end_hour = min(opt.day_end_hour, 13)
        notes.append("Tightened to a morning window.")
    if any(x in t for x in ("evening", "night", "晚上", "after work", "after 5", "after 17")):
        opt.day_start_hour = max(opt.day_start_hour, 14)
        opt.day_end_hour = max(opt.day_end_hour, 22)
        notes.append("Shifted toward afternoon / evening availability.")
    # Later wake-up / avoid very early blocks (stack on top of prior coach options)
    late_start_phrases = (
        "too early",
        "starts too early",
        "start too early",
        "starting too early",
        "not a morning person",
        "sleep in",
        "cannot wake",
        "can't wake",
        "cant wake",
        "hard to wake",
        "起不来",
        "别太早",
        "不要太早",
        "醒不来",
        "睡不醒",
    )
    if any(p in t for p in late_start_phrases) or ("wake" in t and "up" in t):
        opt.day_start_hour = min(12, max(10, opt.day_start_hour + 1))
        notes.append("Shifted the earliest scheduling hour later (easier wake-up).")
    if any(x in t for x in ("earlier", "sooner", "早点", "提前")) and "evening" not in t and "too early" not in t:
        opt.day_start_hour = max(6, opt.day_start_hour - 1)
        notes.append("Start-of-day window moved earlier.")
    if any(x in t for x in ("later end", "work late", "熬夜", "until late")):
        opt.day_end_hour = min(23, opt.day_end_hour + 1)
        notes.append("Extended end of working day slightly.")
    if any(x in t for x in ("9 to 5", "9-5", "nine to five", "office hours")):
        opt.day_start_hour, opt.day_end_hour = 9, 17
        notes.append("Pinned to a classic 9–17 window.")
    if any(x in t for x in ("long day", "full day", "all day availability")):
        opt.day_start_hour, opt.day_end_hour = 7, 23
        notes.append("Widened to a long working-day window.")

    # Slot / density
    if any(x in t for x in ("60 min", "hour block", "one hour", "60-minute", "bigger block")):
        opt.slot_minutes = 60
        notes.append("Using 60-minute placement slots.")
    if any(x in t for x in ("30 min", "half hour", "granular", "finer", "smaller block")):
        opt.slot_minutes = 30
        notes.append("Using 30-minute placement slots.")
    if any(x in t for x in ("more buffer", "more gap", "breathing room", "spacing", "空隙")):
        opt.min_gap_minutes = min(45, opt.min_gap_minutes + 10)
        notes.append("Increased minimum gap between blocks.")
    if any(x in t for x in ("tighter", "dense", "pack", "压缩", "紧凑")):
        opt.min_gap_minutes = max(5, opt.min_gap_minutes - 5)
        notes.append("Reduced gaps for denser packing.")

    # Spread across days (avoid cramming every AI block on one calendar day)
    spread_phrases = (
        "one day",
        "single day",
        "same day",
        "all on one",
        "everything in one",
        "all in one day",
        "dont arrange everything",
        "don't arrange everything",
        "not everything in one",
        "not all in one",
        "spread across",
        "across days",
        "multiple days",
        "different days",
        "distribute",
        "split across",
        "space out",
        "分摊",
        "不要一天",
        "不要都在一天",
        "别挤在一天",
        "分到多天",
        "多天",
    )
    if any(p in t for p in spread_phrases):
        opt.max_ai_blocks_per_day = 2
        opt.min_gap_minutes = min(45, opt.min_gap_minutes + 5)
        notes.append("Capping AI blocks per calendar day and slightly increasing gaps so work spreads across the week.")
    if any(x in t for x in ("one block per day", "one task per day", "每天一个", "一天一个")):
        opt.max_ai_blocks_per_day = 1
        notes.append("At most one new AI block per calendar day.")

    # Specific weekdays (Python: Monday=0 … Sunday=6)
    _day_tokens = (
        ("monday", 0),
        ("tuesday", 1),
        ("wednesday", 2),
        ("thursday", 3),
        ("friday", 4),
        ("saturday", 5),
        ("sunday", 6),
    )
    matched_days: list[int] = []
    for name, idx in _day_tokens:
        if name in t:
            matched_days.append(idx)
    _cn_days = (
        ("周一", 0),
        ("周二", 1),
        ("周三", 2),
        ("周四", 3),
        ("周五", 4),
        ("周六", 5),
        ("周天", 6),
        ("周日", 6),
        ("星期天", 6),
        ("星期六", 5),
    )
    fb_raw = feedback.strip()
    for snippet, idx in _cn_days:
        if snippet in fb_raw:
            matched_days.append(idx)
    if any(x in t for x in ("weekend", "week ends", "双休日", "周末")):
        opt.allowed_weekdays = [5, 6]
        notes.append("Scheduling only on weekend days (Sat–Sun).")
    elif any(x in t for x in ("weekday", "weekdays", "工作日", "平日")):
        opt.allowed_weekdays = [0, 1, 2, 3, 4]
        notes.append("Scheduling only on weekdays (Mon–Fri).")
    elif matched_days:
        opt.allowed_weekdays = sorted(set(matched_days))
        names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        opt.allowed_weekdays = [x for x in opt.allowed_weekdays if 0 <= x <= 6]
        label = ", ".join(names[i] for i in opt.allowed_weekdays)
        notes.append(f"Scheduling only on: {label}.")

    # Task / block duration (Slime chat — "extend to 90 minutes", "shorter blocks")
    set_minutes: int | None = None
    m_abs = re.search(r"\b(\d{1,3})\s*(?:minutes|minute|mins|min)\b", t)
    if not m_abs:
        m_cn = re.search(r"(\d{1,3})\s*分钟", feedback)
        if m_cn:
            try:
                cand = int(m_cn.group(1))
                if 15 <= cand <= 480:
                    set_minutes = cand
            except ValueError:
                set_minutes = None
    elif m_abs:
        try:
            cand = int(m_abs.group(1))
            if 15 <= cand <= 480:
                set_minutes = cand
        except ValueError:
            set_minutes = None
    m_hour = re.search(r"\b(\d)\s*(?:hours|hour|hrs|hr|h)\b", t)
    if m_hour and set_minutes is None:
        try:
            h = int(m_hour.group(1))
            cand = h * 60
            if 15 <= cand <= 480:
                set_minutes = cand
        except ValueError:
            pass

    longer = any(
        x in t
        for x in (
            "longer",
            "extend",
            "more time",
            "bigger block",
            "拉长",
            "加长",
            "延长",
            "久一点",
        )
    )
    shorter = any(x in t for x in ("shorter", "压缩", "缩短", "少一点时间", "少一点"))
    block_ctx = any(
        x in t for x in ("block", "task", "slot", "meeting", "session", "event", "duration", "length")
    ) or any(x in feedback for x in ("任务", "块", "会议", "日程", "时长", "事件"))

    if filtered and set_minutes is not None and (longer or shorter or block_ctx):
        filtered = [x.model_copy(update={"duration_minutes": set_minutes}) for x in filtered]
        notes.append(f"Set each planning block length to about {set_minutes} minutes.")
    elif filtered and longer:
        filtered = [
            x.model_copy(update={"duration_minutes": min(480, max(15, int(x.duration_minutes) + 30))})
            for x in filtered
        ]
        notes.append("Increased each task duration by 30 minutes.")
    elif filtered and shorter:
        filtered = [
            x.model_copy(update={"duration_minutes": max(15, int(x.duration_minutes) - 15)}) for x in filtered
        ]
        notes.append("Shortened each task duration by 15 minutes.")

    # Task removal: only explicit quoted substring (reliable vs free text).
    m = re.search(r"['\"]([^'\"]{2,80})['\"]", feedback)
    needle = (m.group(1).strip().lower() if m else None) or None
    if needle:
        before = len(filtered)
        filtered = [x for x in filtered if needle not in x.title.lower()]
        if len(filtered) < before:
            notes.append(f"Excluded tasks matching “{needle}” before re-scheduling.")

    # Clamp
    opt.day_start_hour = max(0, min(22, opt.day_start_hour))
    opt.day_end_hour = max(opt.day_start_hour + 1, min(24, opt.day_end_hour))
    opt.slot_minutes = 30 if opt.slot_minutes not in (15, 20, 30, 45, 60) else opt.slot_minutes
    opt.min_gap_minutes = max(0, min(120, opt.min_gap_minutes))
    opt.max_ai_blocks_per_day = max(0, min(12, int(getattr(opt, "max_ai_blocks_per_day", 0) or 0)))
    aw = [int(x) for x in (getattr(opt, "allowed_weekdays", None) or []) if str(x).strip() != ""]
    opt.allowed_weekdays = sorted({x for x in aw if 0 <= x <= 6})
    if opt.allowed_weekdays:
        opt.days = max(int(opt.days), 14)

    if not notes:
        notes.append("Interpreted feedback — no strong rule matches; re-running schedule with same window.")

    return opt, notes, filtered
