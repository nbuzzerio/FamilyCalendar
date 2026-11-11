// @ts-expect-error Explicit extension supports the Node strip-types test runner.
import { isLocalDate } from "./events.ts";

export const ROLL_CALL_STORAGE_KEY = "family-calendar.roll-call.v1";
export const availabilityStates = ["Unknown", "Available", "Unavailable"] as const;
export type Availability = typeof availabilityStates[number];
export type RollCall = Record<string, Record<string, Availability>>;
export function availabilityFor(saved: RollCall, date: string, person: string): Availability {
  return Object.hasOwn(saved, date) && Object.hasOwn(saved[date], person) ? saved[date][person] : "Unknown";
}
export function createRollCallStore(storage: () => Pick<Storage, "getItem" | "setItem"> = () => window.localStorage) {
  function list(): RollCall {
    try {
      const value = JSON.parse(storage().getItem(ROLL_CALL_STORAGE_KEY) ?? "{}");
      if (!value || typeof value !== "object" || Array.isArray(value) || !Object.entries(value).every(([date, people]) =>
        isLocalDate(date) && people && typeof people === "object" && !Array.isArray(people) &&
        Object.entries(people).every(([id, state]) => id.trim() && availabilityStates.includes(state as Availability)))) throw Error();
      return value;
    } catch { throw Error("Dinner Roll Call could not be read. Saved responses are unchanged. Check browser storage and reload to retry."); }
  }
  return { list, save(date: string, person: string, state: Availability): RollCall {
    if (!isLocalDate(date) || !person.trim() || !availabilityStates.includes(state)) throw Error("Invalid dinner response.");
    const saved = list();
    const next = { ...saved, [date]: { ...(Object.hasOwn(saved, date) ? saved[date] : {}), [person]: state } };
    storage().setItem(ROLL_CALL_STORAGE_KEY, JSON.stringify(next));
    return next;
  } };
}
export const rollCallStore = createRollCallStore();
