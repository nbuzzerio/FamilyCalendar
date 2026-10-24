export interface CalendarEvent {
  id: string;
  title: string;
  /** Local calendar date, never a UTC timestamp. */
  date: string;
  /** Local 24-hour HH:mm; omitted for all-day events and older saved events. */
  time?: string;
}

export type EventInput = Omit<CalendarEvent, "id">;
export const EVENTS_STORAGE_KEY = "family-calendar.events.v1";

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(2000, month - 1, day, 12);
  date.setFullYear(year);
  return year > 0 && dateKey(date) === value;
}

export function isLocalTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isEvent(value: unknown): value is CalendarEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return typeof event.id === "string" && event.id.trim().length > 0 &&
    typeof event.title === "string" && event.title.trim().length > 0 && isLocalDate(event.date) &&
    (event.time === undefined || isLocalTime(event.time));
}

function validate(input: EventInput): EventInput {
  if (!isEvent({ ...input, id: "validation" })) throw new Error("Enter a title, a valid local date, and a valid time if provided.");
  return { title: input.title.trim(), date: input.date, ...(input.time === undefined ? {} : { time: input.time }) };
}

/** Reads storage afresh for every operation; failed writes are reported to callers. */
export function createEventStore(storage: () => Pick<Storage, "getItem" | "setItem"> = () => window.localStorage) {
  function list(): CalendarEvent[] {
    try {
      const parsed: unknown = JSON.parse(storage().getItem(EVENTS_STORAGE_KEY) ?? "[]");
      if (!Array.isArray(parsed)) return [];
      const ids = new Set<string>();
      return parsed.filter(isEvent).filter(event => {
        if (ids.has(event.id)) return false;
        ids.add(event.id);
        return true;
      }).map(({ id, title, date, time }) => ({ id, title, date, ...(time === undefined ? {} : { time }) }))
        .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));
    } catch {
      return [];
    }
  }
  function save(events: CalendarEvent[]) {
    try {
      storage().setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
    } catch {
      throw new Error("Events could not be saved. Browser storage may be unavailable or full.");
    }
  }
  return {
    list,
    create(input: EventInput): CalendarEvent {
      const fields = validate(input);
      const event = { ...fields, id: globalThis.crypto.randomUUID() };
      save([...list(), event]);
      return event;
    },
    update(id: string, input: EventInput): CalendarEvent {
      const fields = validate(input);
      const events = list();
      if (!events.some(event => event.id === id)) throw new Error("Event no longer exists.");
      const updated = { ...fields, id };
      save(events.map(event => event.id === id ? updated : event));
      return updated;
    },
    delete(id: string): void {
      save(list().filter(event => event.id !== id));
    },
  };
}

export const eventStore = createEventStore();
