import type { CalendarEvent } from "./events";

/** Complete Monday-first weeks covering the requested month, including adjacent dates. */
export function monthDays(anchor: Date, offset = 0): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth() + offset, 1, 12);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
  const start = weekDays(first)[0];
  const length = Math.ceil((((first.getDay() + 6) % 7) + last.getDate()) / 7) * 7;
  return Array.from({ length }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

/** Monday through Sunday, using calendar arithmetic across DST and year boundaries. */
export function weekDays(anchor: Date, offset = 0): Date[] {
  const monday = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 12);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });
}

/** Includes today's events; independent of the week currently being viewed. */
export function upcomingEvents(events: CalendarEvent[], today: string): CalendarEvent[] {
  return events.filter(event => event.date >= today).sort((a, b) =>
    a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));
}
