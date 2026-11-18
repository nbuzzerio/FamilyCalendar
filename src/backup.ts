// @ts-expect-error Explicit extensions support the existing Node strip-types test runner.
import { EVENTS_STORAGE_KEY } from "./events.ts";
// @ts-expect-error Explicit extensions support the existing Node strip-types test runner.
import { LABELS_STORAGE_KEY } from "./labels.ts";
// @ts-expect-error Explicit extensions support the existing Node strip-types test runner.
import { DINNERS_STORAGE_KEY, GROCERIES_STORAGE_KEY } from "./dinners.ts";
// @ts-expect-error Explicit extensions support the Node strip-types test runner.
import { ROLL_CALL_STORAGE_KEY } from "./rollCall.ts";

export const legacyKeys = [EVENTS_STORAGE_KEY, LABELS_STORAGE_KEY, DINNERS_STORAGE_KEY, GROCERIES_STORAGE_KEY, ROLL_CALL_STORAGE_KEY, "family-calendar-view", "family-calendar-theme"];
export type RawStorage = Record<string, string | null>;
export function rawStorage(storage: Pick<Storage, "getItem"> & Partial<Pick<Storage, "key" | "length">>): RawStorage {
  const keys = new Set(legacyKeys);
  for (let i = 0; i < (storage.length ?? 0); i++) {
    const key = storage.key?.(i);
    if (key && /^family-calendar[.-]/.test(key)) keys.add(key);
  }
  return Object.fromEntries([...keys].map(key => [key, storage.getItem(key)]));
}
export function rawBackup(storage: Pick<Storage, "getItem">) {
  return { format: "family-calendar-backup", version: 3, raw: rawStorage(storage) };
}

/** Read the saved records directly: never normalize, filter, expand series or write. */
export function serializeBackup(storage: Pick<Storage, "getItem">): string {
  return JSON.stringify(rawBackup(storage), null, 2);
}

export function downloadBackup(storage: Pick<Storage, "getItem"> = window.localStorage): void {
  downloadJSON(serializeBackup(storage));
}

export function downloadJSON(json: string): void {
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
