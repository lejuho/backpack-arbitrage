import { bpMarketHolidays } from './backpack/public.js';

/** Current US-equities session at Backpack, computed in America/New_York. */
export function etParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o = Object.fromEntries(f.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[o.weekday];
  const hh = Number(o.hour) % 24, mm = Number(o.minute);
  return { weekday: wd, minutes: hh * 60 + mm, date: `${o.year}-${o.month}-${o.day}`, hhmm: `${o.hour}:${o.minute}` };
}

let holidayCache = { at: 0, list: [] };
export async function holidays() {
  if (Date.now() - holidayCache.at > 6 * 3600e3) {
    try { holidayCache = { at: Date.now(), list: await bpMarketHolidays() }; } catch { /* keep stale */ }
  }
  return holidayCache.list;
}

/**
 * Returns {session, weekendBook} where session ∈ US_EQUITIES_{OVERNIGHT,PRE_MARKET,REGULAR,POST_MARKET} | WEEKEND | HOLIDAY.
 * weekendBook=true means listed stocks trade on Backpack's native spot order book; false means RFQ.
 */
export async function currentSession(d = new Date()) {
  const { weekday, minutes, date, hhmm } = etParts(d);
  const hol = (await holidays()).find((h) => h.date === date && (!h.startTime || (hhmm + ':00') >= h.startTime) && (!h.endTime || (hhmm + ':00') <= h.endTime));
  if (hol) return { session: 'HOLIDAY', weekendBook: true, detail: hol.name, et: `${date} ${hhmm}` };
  const m = minutes;
  const weekdayMF = weekday >= 1 && weekday <= 5;
  if (weekday === 6) return { session: 'WEEKEND', weekendBook: true, et: `${date} ${hhmm}` };
  if (weekday === 0 && m < 20 * 60) return { session: 'WEEKEND', weekendBook: true, et: `${date} ${hhmm}` };
  if (weekday === 5 && m >= 20 * 60) return { session: 'WEEKEND', weekendBook: true, et: `${date} ${hhmm}` };
  if (weekday === 0 && m >= 20 * 60) return { session: 'US_EQUITIES_OVERNIGHT', weekendBook: false, et: `${date} ${hhmm}` };
  if (weekdayMF) {
    if (m < 4 * 60) return { session: 'US_EQUITIES_OVERNIGHT', weekendBook: false, et: `${date} ${hhmm}` };
    if (m < 9 * 60 + 30) return { session: 'US_EQUITIES_PRE_MARKET', weekendBook: false, et: `${date} ${hhmm}` };
    if (m < 16 * 60) return { session: 'US_EQUITIES_REGULAR', weekendBook: false, et: `${date} ${hhmm}` };
    if (m < 20 * 60) return { session: 'US_EQUITIES_POST_MARKET', weekendBook: false, et: `${date} ${hhmm}` };
    return { session: 'US_EQUITIES_OVERNIGHT', weekendBook: false, et: `${date} ${hhmm}` };
  }
  return { session: 'WEEKEND', weekendBook: true, et: `${date} ${hhmm}` };
}
