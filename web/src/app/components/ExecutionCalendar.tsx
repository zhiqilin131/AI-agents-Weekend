import { addDays, format, isSameDay, parseISO } from 'date-fns';
import type { CalendarEvent } from '../../utils/scheduler';

const SLOT_MINUTES = 30;
const SLOT_HEIGHT_PX = 24;
const VIEW_DAY_START_HOUR = 0;
const VIEW_DAY_END_HOUR = 24;
const SLOT_COUNT = (VIEW_DAY_END_HOUR - VIEW_DAY_START_HOUR) * (60 / SLOT_MINUTES);

export function ExecutionCalendar({
  weekStart,
  events,
  onSelectEvent,
}: {
  weekStart: Date;
  events: CalendarEvent[];
  onSelectEvent?: (id: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const totalMin = (VIEW_DAY_END_HOUR - VIEW_DAY_START_HOUR) * 60;
  const windowStart = VIEW_DAY_START_HOUR * 60;
  return (
    <div className="min-w-[980px]">
      <div className="grid mb-2" style={{ gridTemplateColumns: '80px repeat(7, minmax(0,1fr))' }}>
        <div />
        {days.map((d) => (
          <div key={d.toISOString()} className="text-xs font-semibold text-gray-700 px-2 py-1">
            {format(d, 'EEE MM/dd')}
          </div>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: '80px 1fr' }}>
        <div className="relative" style={{ height: `${SLOT_COUNT * SLOT_HEIGHT_PX}px` }}>
          {Array.from({ length: SLOT_COUNT + 1 }, (_, idx) => {
            const hour = Math.floor((idx * SLOT_MINUTES) / 60);
            const minute = (idx * SLOT_MINUTES) % 60;
            return (
              <div key={idx} className="absolute left-0 right-0 text-[11px] text-gray-500" style={{ top: `${idx * SLOT_HEIGHT_PX - 8}px` }}>
                {`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`}
              </div>
            );
          })}
        </div>
        <div className="grid border border-gray-100 rounded-xl overflow-hidden" style={{ gridTemplateColumns: 'repeat(7, minmax(0,1fr))' }}>
          {days.map((day, dayIdx) => (
            <div
              key={day.toISOString()}
              className="relative border-l border-gray-100 first:border-l-0"
              style={{
                height: `${SLOT_COUNT * SLOT_HEIGHT_PX}px`,
                backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${SLOT_HEIGHT_PX - 1}px, #f1f5f9 ${SLOT_HEIGHT_PX - 1}px, #f1f5f9 ${SLOT_HEIGHT_PX}px)`,
              }}
            >
              {events
                .filter((ev) => isSameDay(parseISO(ev.start), day))
                .map((ev) => {
                  const s = parseISO(ev.start);
                  const e = parseISO(ev.end);
                  const startMin = s.getHours() * 60 + s.getMinutes();
                  const endMin = Math.max(startMin + SLOT_MINUTES, e.getHours() * 60 + e.getMinutes());
                  const top = ((Math.max(startMin, windowStart) - windowStart) / totalMin) * 100;
                  const height = ((Math.max(SLOT_MINUTES, endMin - startMin)) / totalMin) * 100;
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onSelectEvent?.(ev.id)}
                      className={`absolute left-1 right-1 text-left rounded-md px-2 py-1 text-[11px] overflow-hidden border ${
                        ev.source === 'uploaded' ? 'bg-gray-200/95 border-gray-300 text-gray-800' : 'bg-indigo-500/90 border-indigo-600 text-white'
                      }`}
                      style={{ top: `${Math.max(0, top)}%`, height: `${Math.max(4, height)}%` }}
                    >
                      <div className="font-semibold truncate">{ev.title}</div>
                      <div className="opacity-90">{format(s, 'HH:mm')} - {format(e, 'HH:mm')}</div>
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

