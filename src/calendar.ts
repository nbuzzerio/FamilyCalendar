import type { CalendarEvent } from "./events";

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
