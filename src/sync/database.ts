import { legacyKeys, rawStorage, type RawStorage } from "../backup";
import { EVENTS_STORAGE_KEY, isEvent, isLocalDate } from "../events";
import { LABELS_STORAGE_KEY, isLabel } from "../labels";
import { DINNERS_STORAGE_KEY, GROCERIES_STORAGE_KEY, isDinner } from "../dinners";
import { ROLL_CALL_STORAGE_KEY } from "../rollCall";
import { initialSettings, object, rowFor, same, validChecks, validResponse, type Row, type Settings, type Value } from "./model";

export interface View { settings: Settings; rows: Map<string, Row> }
export interface Draft extends View {
  put(row: Row): void;
  remove(key: string): void;
  tx: IDBTransaction;
  archive(reason: string, data: unknown): void;
}
export const stores = ["settings", "records", "staged", "evidence"] as const;
export function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
let connection: Promise<IDBDatabase> | undefined;
function open() {
  if (!connection) connection = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("family-calendar-sync", 1);
    r.onupgradeneeded = () => {
      for (const name of stores) r.result.createObjectStore(name);
    };
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); connection = undefined; }; resolve(db); };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error("Close older Calendar tabs and reload."));
  }).catch(error => { connection = undefined; throw error; });
  return connection;
}
export let view: View;
let channel: BroadcastChannel | undefined;
export const alertView = () => window.dispatchEvent(new Event("calendar-update"));
export async function access<T>(mode: IDBTransactionMode, run: (draft: Draft) => T | Promise<T>, local = false): Promise<T> {
  const db = await open();
  const tx = db.transaction([...stores], mode, { durability: mode === "readwrite" ? "strict" : "default" });
  const end = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? Error("Calendar storage transaction was interrupted.")); });
  void end.catch(() => {});
  try {
    const [settings, records] = await Promise.all([request<Settings | undefined>(tx.objectStore("settings").get("calendar")), request<Row[]>(tx.objectStore("records").getAll())]);
    const rows = new Map(records.map(row => [row.key, row]));
    if (!settings && records.length) throw Error("Missing Calendar binding. Keep this browser profile for recovery.");
    const draft: Draft = {
      tx, settings: settings ?? initialSettings(), rows,
      put(row) { rows.set(row.key, row); tx.objectStore("records").put(row, row.key); },
      remove(key) { rows.delete(key); tx.objectStore("records").delete(key); },
      archive(reason, data) { tx.objectStore("evidence").add({ reason, date: new Date().toISOString(), data }, crypto.randomUUID()); },
    };
    const result = await run(draft);
    if (mode === "readwrite") {
      draft.settings.generation++;
      tx.objectStore("settings").put(draft.settings, "calendar");
    }
    await end;
    if (!view || draft.settings.generation >= view.settings.generation) view = { settings: draft.settings, rows };
    alertView();
    if (mode === "readwrite") {
      channel?.postMessage(local ? "edit" : "refresh");
      if (local) window.dispatchEvent(new Event("calendar-edit"));
    }
    return result;
  } catch (error) { try { tx.abort(); } catch { /* Already aborted. */ } throw error; }
}
export function migrate(d: Draft, raw: RawStorage) {
  const issues = d.settings.issues;
  for (const key of Object.keys(raw)) if (!legacyKeys.includes(key)) issues.push("Unrecognized Calendar storage retained in the backup: " + key);
  function add(kind: string, id: string, value: Value) {
    const row = rowFor(kind, id, value);
    const prior = d.rows.get(row.key);
    if (prior) { prior.hold = "Duplicate historical ID. Review the original backup."; d.put(prior); }
    else d.put(row);
  }
  for (const key of [EVENTS_STORAGE_KEY, LABELS_STORAGE_KEY, DINNERS_STORAGE_KEY, GROCERIES_STORAGE_KEY, ROLL_CALL_STORAGE_KEY]) {
    if (raw[key] == null) continue;
    let data: unknown;
    try { data = JSON.parse(raw[key]); } catch { issues.push(key + " contains unreadable JSON. Original text retained."); continue; }
    if (key === EVENTS_STORAGE_KEY || key === LABELS_STORAGE_KEY) {
      const kind = key === EVENTS_STORAGE_KEY ? "event" : "label";
      if (!Array.isArray(data)) { issues.push(key + " has an unknown format."); continue; }
      const counts = new Map<string, number>();
      for (const v of data) if (object(v) && typeof v.id === "string") counts.set(v.id, (counts.get(v.id) ?? 0) + 1);
      data.forEach((v, i) => {
        if (!(kind === "event" ? isEvent(v) : isLabel(v))) {
          issues.push(key + " entry " + (i + 1) + " needs review.");
          if (object(v) && typeof v.id === "string" && counts.get(v.id) === 1) {
            const held = rowFor(kind, v.id, null);
            held.hold = "An unreadable historical entry has this ID. Its original value is in the backup.";
            d.put(held);
          }
          return;
        }
        add(kind, v.id, v);
        if (counts.get(v.id)! > 1) { const row = d.rows.get(kind + ":" + v.id)!; row.hold = "Duplicate historical ID. Review the original backup."; d.put(row); }
      });
    } else {
      if (!object(data)) { issues.push(key + " has an unknown format."); continue; }
      for (const [date, v] of Object.entries(data)) {
        if (key === ROLL_CALL_STORAGE_KEY && isLocalDate(date) && object(v)) {
          for (const [label, availability] of Object.entries(v)) {
            if (label.trim() && validResponse(availability)) add("legacy-attendance", date + ":" + label, { availability });
            else issues.push("Attendance for " + date + " / " + label + " needs review.");
          }
        } else if (key === DINNERS_STORAGE_KEY && isLocalDate(date) && object(v) && isDinner(v)) add("dinner-plan", date, v);
        else if (key === GROCERIES_STORAGE_KEY && validChecks(date, v)) add("grocery-checks", date, { checked: v });
        else issues.push(key + " entry " + date + " needs review.");
      }
    }
  }
}
export async function initialize() {
  await access("readwrite", async d => {
    const archive = d.tx.objectStore("evidence");
    const original = await request<{ data: RawStorage } | undefined>(archive.get("migration"));
    let raw: RawStorage;
    try { raw = rawStorage(localStorage); }
    catch (error) {
      if (!original) throw error;
      return; // An established Calendar can use its committed IndexedDB state.
    }
    if (!original) {
      if (d.rows.size || d.settings.space) throw Error("The original migration evidence is missing. Preserve this browser profile for recovery.");
      archive.add({ reason: "Before migration", date: new Date().toISOString(), data: raw }, "migration");
      migrate(d, raw);
    } else {
      // An old, still-open pre-upgrade tab may have written after migration.
      const previous = await request<{ data: RawStorage } | undefined>(archive.get("legacy-change"));
      const baseline = previous?.data ?? original.data;
      const sources = { [EVENTS_STORAGE_KEY]:"event", [LABELS_STORAGE_KEY]:"label", [DINNERS_STORAGE_KEY]:"dinner-plan", [GROCERIES_STORAGE_KEY]:"grocery-checks", [ROLL_CALL_STORAGE_KEY]:"roll-call" };
      const changed = Object.entries(sources).filter(([k]) => !same(baseline[k],raw[k])).map(([,kind]) => kind);
      if (changed.length) {
        d.archive("Later legacy storage", raw);
        archive.put({ reason: "Latest legacy change", data: raw }, "legacy-change");
        d.settings.legacyHolds = [...new Set([...(d.settings.legacyHolds ?? []), ...changed])];
        d.settings.localRevision++; d.settings.caughtUp = false;
      }
    }
  });
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("family-calendar-storage");
    channel.onmessage = async event => { await access("readonly", () => {}); if (event.data === "edit") window.dispatchEvent(new Event("calendar-edit")); };
  }
}
