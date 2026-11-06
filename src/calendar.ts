// Node's strip-types runner requires the source extension; Vite resolves it too.
// @ts-expect-error TS5097: retain the explicit extension without changing compiler configuration.
import { dateKey, expandEvents, localDate, type CalendarEvent } from "./events.ts";

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
  const end = localDate(today);
  end.setFullYear(end.getFullYear() + 1);
  const recurring = events.filter(event => event.recurrence && event.recurrence.frequency !== "Never");
  const single = events.filter(event => !event.recurrence || event.recurrence.frequency === "Never");
  return [...single.filter(event => event.date >= today), ...expandEvents(recurring, today, dateKey(end))].sort((a, b) =>
    a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));
}

/** Navigation retains the desired day even when the displayed date is clamped. */
export type NavigationDate = { date: Date; day: number };
export function navigationDate(date: Date): NavigationDate {
  return { date: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12), day: date.getDate() };
}
export function moveDate(current: NavigationDate, amount: number, unit: "week" | "month" | "year"): NavigationDate {
  if (unit === "week") {
    const date = new Date(current.date);
    date.setDate(date.getDate() + amount * 7);
    return navigationDate(date);
  }
  const first = new Date(current.date.getFullYear(), current.date.getMonth() + (unit === "year" ? amount * 12 : amount), 1, 12);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12).getDate();
  first.setDate(Math.min(current.day, last));
  return { date: first, day: current.day };
}

/** Refresh independently of navigation; reschedule from the real clock after sleep. */
export function watchToday(refresh: (date: Date) => void, host: {
  now: () => Date;
  schedule: (callback: () => void, delay: number) => unknown;
  cancel: (timer: unknown) => void;
  listen: (callback: () => void) => () => void;
}): () => void {
  let timer: unknown;
  const update = () => {
    host.cancel(timer);
    const now = host.now();
    refresh(now);
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    timer = host.schedule(update, midnight.getTime() - now.getTime());
  };
  const unlisten = host.listen(update);
  update();
  return () => { host.cancel(timer); unlisten(); };
}
