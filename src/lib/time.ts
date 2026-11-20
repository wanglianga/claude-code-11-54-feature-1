/** Heating-day time algebra. All day boundaries are local, using a fixed UTC offset. */

export const LOCAL_OFFSET_MIN = 480; // Asia/Shanghai, no DST
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function localDateParts(ts: number, offsetMin = LOCAL_OFFSET_MIN) {
  const d = new Date(ts + offsetMin * 60_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

/** Key of the heating day containing ts, e.g. 2026-01-05 (06:00 → 06:00 next day). */
export function heatingDayKey(
  ts: number,
  startHour = 6,
  offsetMin = LOCAL_OFFSET_MIN,
): string {
  const shifted = ts + offsetMin * 60_000 - startHour * HOUR;
  return new Date(shifted).toISOString().slice(0, 10);
}

export function dayStartTs(
  dayKey: string,
  startHour = 6,
  offsetMin = LOCAL_OFFSET_MIN,
): number {
  return Date.parse(`${dayKey}T00:00:00Z`) + (startHour * 60 - offsetMin) * 60_000;
}

export function dayEndTs(
  dayKey: string,
  startHour = 6,
  offsetMin = LOCAL_OFFSET_MIN,
): number {
  return dayStartTs(dayKey, startHour, offsetMin) + DAY;
}

export function shiftDayKey(dayKey: string, deltaDays: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + deltaDays * DAY)
    .toISOString()
    .slice(0, 10);
}

export function enumerateDayKeys(startDay: string, endDay: string): string[] {
  const out: string[] = [];
  let key = startDay;
  const end = Date.parse(`${endDay}T00:00:00Z`);
  let guard = 0;
  while (Date.parse(`${key}T00:00:00Z`) <= end && guard < 400) {
    out.push(key);
    key = shiftDayKey(key, 1);
    guard += 1;
  }
  return out;
}

/** Night window inside a heating day (22:00 → 06:00 by default). */
export function nightWindow(
  dayKey: string,
  startHour: number,
  nightStartHour: number,
  nightEndHour: number,
  offsetMin = LOCAL_OFFSET_MIN,
): { startTs: number; endTs: number } {
  const start = dayStartTs(dayKey, startHour, offsetMin);
  const startOffsetH = ((nightStartHour - startHour + 24) % 24) || 0;
  let endOffsetH = (nightEndHour - startHour + 24) % 24;
  if (endOffsetH === 0) endOffsetH = 24;
  if (endOffsetH <= startOffsetH) endOffsetH += 24;
  return { startTs: start + startOffsetH * HOUR, endTs: start + endOffsetH * HOUR };
}

export function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function overlapMinutes(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / 60_000;
}

/** Parse a loose timestamp, treating timezone-less values as local (+08:00). */
export function parseTimestamp(raw: unknown, offsetMin = LOCAL_OFFSET_MIN): number | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/\//g, '-').replace('T', ' ');
  // Naive local timestamps.
  if (/^\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
    s = s.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})/, (_, y, m, d) => `${y}-${pad2(+m)}-${pad2(+d)}`);
    s = s.replace(/ (\d{1,2}):(\d{2})/, (_, h, mi) => ` ${pad2(+h)}:${mi}`);
    const off = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    s = `${s.replace(' ', 'T')}${off}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  }
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return null;
  if (ts < Date.parse('2000-01-01T00:00:00Z') || ts > Date.parse('2100-01-01T00:00:00Z')) {
    return null;
  }
  return ts;
}

export function fmtLocal(ts: number, offsetMin = LOCAL_OFFSET_MIN): string {
  const p = localDateParts(ts, offsetMin);
  return `${p.month}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

export function fmtLocalFull(ts: number, offsetMin = LOCAL_OFFSET_MIN): string {
  const p = localDateParts(ts, offsetMin);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

export function fmtDayLabel(dayKey: string): string {
  const [, m, d] = dayKey.split('-');
  const weekday = new Date(`${dayKey}T00:00:00Z`).getUTCDay();
  const names = ['日', '一', '二', '三', '四', '五', '六'];
  return `${+m}/${+d} 周${names[weekday]}`;
}

export function minutesBetween(a: number, b: number): number {
  return (b - a) / 60_000;
}

export function hourLabel(ts: number, offsetMin = LOCAL_OFFSET_MIN): string {
  const p = localDateParts(ts, offsetMin);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}
