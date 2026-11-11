// @ts-expect-error Explicit extensions support the existing Node strip-types test runner.
import { EVENTS_STORAGE_KEY, isEvent } from "./events.ts";
// @ts-expect-error Explicit extensions support the existing Node strip-types test runner.
import { LABELS_STORAGE_KEY, isLabel } from "./labels.ts";
// @ts-expect-error Explicit extensions support the existing Node strip-types test runner.
import { DINNERS_STORAGE_KEY, GROCERIES_STORAGE_KEY, parseDinnerPlans, parseGroceryChecks } from "./dinners.ts";

/** Read the saved records directly: never normalize, filter, expand series or write. */
export function serializeBackup(storage: Pick<Storage, "getItem">): string {
  const dinners = storage.getItem(DINNERS_STORAGE_KEY);
  const groceries = storage.getItem(GROCERIES_STORAGE_KEY);
  const extended = dinners !== null || groceries !== null;
  function read(key: string, valid: (value: unknown) => boolean): unknown[] {
    const raw = storage.getItem(key);
    const value: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(value) || !value.every(valid)) {
      throw new Error("Backup could not be exported: saved calendar data is invalid.");
    }
    return value;
  }
  return JSON.stringify({
    format: "family-calendar-backup",
    version: extended ? 2 : 1,
    events: read(EVENTS_STORAGE_KEY, isEvent),
    labels: read(LABELS_STORAGE_KEY, isLabel),
    ...(extended ? { dinners: parseDinnerPlans(dinners), groceries: parseGroceryChecks(groceries) } : {}),
  }, null, 2);
}

export function downloadBackup(storage: Pick<Storage, "getItem"> = window.localStorage): void {
  const json = serializeBackup(storage);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = `family-calendar-backup-v${JSON.parse(json).version}.json`;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Give the browser time to consume the download before releasing its URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
