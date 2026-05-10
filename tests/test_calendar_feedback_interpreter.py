from foresight_x.decision_algorithms.schemas import ExecutionTask, SchedulerOptions
from foresight_x.ui.calendar_feedback_interpreter import interpret_calendar_feedback


def test_morning_window_tightens_hours():
    base = SchedulerOptions(day_start_hour=9, day_end_hour=22, slot_minutes=30, min_gap_minutes=10)
    tasks = [ExecutionTask(id="1", title="A", duration_minutes=60)]
    opt, notes, t2 = interpret_calendar_feedback("Please use mornings only", base, tasks)
    assert opt.day_end_hour <= 13
    assert any("morning" in n.lower() for n in notes)
    assert len(t2) == 1


def test_quoted_removes_task():
    base = SchedulerOptions()
    tasks = [
        ExecutionTask(id="1", title="Review checkpoint", duration_minutes=30),
        ExecutionTask(id="2", title="Deep work", duration_minutes=60),
    ]
    opt, notes, t2 = interpret_calendar_feedback('Remove "review" tasks', base, tasks)
    assert len(t2) == 1
    assert t2[0].title == "Deep work"
    assert any("review" in n.lower() for n in notes)


def test_evening_shift():
    base = SchedulerOptions(day_start_hour=9, day_end_hour=18)
    opt, _, _ = interpret_calendar_feedback("I need evening slots after work", base, [])
    assert opt.day_start_hour >= 14
    assert opt.day_end_hour >= 22


def test_spread_phrase_sets_cap_per_day():
    base = SchedulerOptions()
    opt, notes, _ = interpret_calendar_feedback(
        "dont arrange everything in one day",
        base,
        [],
    )
    assert opt.max_ai_blocks_per_day == 2
    assert any("spread" in n.lower() or "capping" in n.lower() for n in notes)


def test_one_task_per_day_stricter_cap():
    base = SchedulerOptions()
    opt, _, _ = interpret_calendar_feedback("Please one task per day", base, [])
    assert opt.max_ai_blocks_per_day == 1


def test_late_start_phrase_shifts_day_start():
    base = SchedulerOptions(day_start_hour=9, day_end_hour=22)
    opt, notes, _ = interpret_calendar_feedback(
        "too early every day, i cannot wake up",
        base,
        [],
    )
    assert opt.day_start_hour >= 10
    assert any("later" in n.lower() or "wake" in n.lower() for n in notes)


def test_late_start_keeps_prior_spread_cap():
    spread_opt, _, _ = interpret_calendar_feedback("dont put everything on one day", SchedulerOptions(), [])
    assert spread_opt.max_ai_blocks_per_day == 2
    opt2, _, _ = interpret_calendar_feedback(
        "too early every day i cannot wake up",
        spread_opt,
        [],
    )
    assert opt2.max_ai_blocks_per_day == 2
    assert opt2.day_start_hour >= 10


def test_make_it_saturday_sets_allowed_weekday():
    opt, notes, _ = interpret_calendar_feedback(
        "make it saturday",
        SchedulerOptions(),
        [],
    )
    assert 5 in opt.allowed_weekdays
    assert opt.days >= 14
    assert any("sat" in n.lower() for n in notes)


def test_weekend_sets_sat_sun():
    opt, _, _ = interpret_calendar_feedback("only on weekend please", SchedulerOptions(), [])
    assert opt.allowed_weekdays == [5, 6]


def test_explicit_minutes_sets_task_duration():
    base = SchedulerOptions()
    tasks = [ExecutionTask(id="1", title="Deep work", duration_minutes=60)]
    _opt, notes, t2 = interpret_calendar_feedback("extend blocks to 90 minutes", base, tasks)
    assert t2[0].duration_minutes == 90
    assert any("90" in n for n in notes)


def test_longer_without_number_bumps_duration():
    base = SchedulerOptions()
    tasks = [ExecutionTask(id="1", title="A", duration_minutes=60)]
    _opt, _notes, t2 = interpret_calendar_feedback("please make the blocks longer", base, tasks)
    assert t2[0].duration_minutes == 90
