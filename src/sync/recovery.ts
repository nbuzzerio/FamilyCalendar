import { downloadJSON, legacyKeys, rawStorage, type RawStorage } from "../backup";
import { access, migrate, request, type Draft } from "./database";
import { keyOf, object, rowFor, supported, uuid, validResponse, type Link, type Row, type Snapshot } from "./model";
import { isLabel, LABELS_STORAGE_KEY } from "../labels";
import { isEvent, isLocalDate, EVENTS_STORAGE_KEY } from "../events";
import { DINNERS_STORAGE_KEY, GROCERIES_STORAGE_KEY } from "../dinners";
import { classify } from "./replication";

async function evidence(d: Draft) {
  const store = d.tx.objectStore("evidence");
  const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
  return keys.map((key, i) => ({ key, ...values[i] }));
}
export async function exportCalendar() {
  const { revision, json } = await access("readonly", async d => ({
    revision: d.settings.localRevision,
    json: JSON.stringify({ format: "family-calendar-backup", version: 3, raw: rawStorage(localStorage),
      calendar: { settings: d.settings, records: [...d.rows.values()], staged: await request(d.tx.objectStore("staged").getAll()), evidence: await evidence(d) } }, null, 2),
  }));
  decodeBackup(json);
  downloadJSON(json);
  await access("readwrite", d => { d.settings.exportedRevision = revision; });
}
function decodeBackup(text: string) {
  const file: unknown = JSON.parse(text);
  if (!object(file) || file.format !== "family-calendar-backup") throw Error("Select a Family Calendar backup.");
  if (file.version === 1 || file.version === 2) {
    if (!Array.isArray(file.events) || !Array.isArray(file.labels)) throw Error("Incomplete legacy backup.");
    const raw = Object.fromEntries(legacyKeys.map(k => [k, null])) as RawStorage;
    raw[EVENTS_STORAGE_KEY] = JSON.stringify(file.events); raw[LABELS_STORAGE_KEY] = JSON.stringify(file.labels);
    if (file.version === 2) {
      if (!Object.hasOwn(file,"dinners") || !Object.hasOwn(file,"groceries")) throw Error("Incomplete dinner or grocery backup.");
      raw[DINNERS_STORAGE_KEY] = JSON.stringify(file.dinners); raw[GROCERIES_STORAGE_KEY] = JSON.stringify(file.groceries);
    }
    return { raw, calendar: undefined };
  }
  if (file.version !== 3 || !object(file.raw) || !legacyKeys.every(k => Object.hasOwn(file.raw as object, k)) || !Object.values(file.raw).every(v => v === null || typeof v === "string")) throw Error("Incomplete raw Calendar backup.");
  const c = file.calendar;
  if (c !== undefined && (!object(c) || !Array.isArray(c.records) || !object(c.settings) || !Array.isArray(c.staged) || !Array.isArray(c.evidence))) throw Error("Incomplete Calendar recovery data.");
  return { raw: file.raw as RawStorage, calendar: c as { records: Row[]; staged: Snapshot[]; settings: Record<string,unknown>; evidence: unknown[] } | undefined };
}
export function keepCurrentCalendar() {
  return access("readwrite", d => {
    if (d.settings.exportedRevision !== d.settings.localRevision) throw Error("Export the current backup to preserve both sources first.");
    d.archive("Owner retained older-tab changes in backup", d.settings.legacyHolds);
    d.settings.legacyHolds = [];
  }, true);
}
export async function restoreBackup(text: string) {
  const file = decodeBackup(text);
  await access("readwrite", d => {
    const s = d.settings;
    if (s.phase !== "local" || s.imported || s.owner || d.rows.size || s.issues.length || s.localRevision) throw Error("Recover into an empty Calendar browser profile to preserve the current Calendar.");
    d.archive("Complete imported file for recovery (including original operations)", text);
    const c = file.calendar;
    if (!c) migrate(d, file.raw);
    else {
      if (c.settings.owner !== undefined && (!uuid(c.settings.owner) || !uuid(c.settings.space))) throw Error("Invalid household binding in backup.");
      s.owner = c.settings.owner as string | undefined; s.space = c.settings.space as string | undefined;
      s.directoryOwner = uuid(c.settings.directoryOwner) ? c.settings.directoryOwner : s.owner;
      if (Array.isArray(c.settings.mappings) && c.settings.mappings.every(m => Array.isArray(m) && typeof m[0] === "string" && uuid(m[1]))) s.mappings = c.settings.mappings as [string,string][];
      if (Array.isArray(c.settings.issues)) s.issues = c.settings.issues.filter((i): i is string => typeof i === "string");
      if (Array.isArray(c.settings.legacyHolds)) s.legacyHolds = c.settings.legacyHolds.filter((k): k is string => typeof k === "string");
      for (const raw of c.records) {
        if (!object(raw) || typeof raw.id !== "string" || typeof raw.kind !== "string" || !Array.isArray(raw.people) ||
            !raw.people.every(p => object(p) && uuid(p.personId) && typeof p.role === "string") || (raw.value !== null && !object(raw.value))) {
          s.issues.push("An imported record needs inspection in the recovery file."); continue;
        }
        const row = rowFor(raw.kind, raw.id, raw.value, raw.people as Link[]);
        const snap = { kind: row.kind, recordId: row.id, value: row.value, people: row.people, schemaVersion: 1, deleted: !row.value, serverVersion: "1" };
        const localValid = row.kind === "legacy-attendance" ? isLocalDate(row.id.slice(0,10)) && (!row.value || validResponse(row.value.availability)) :
          row.kind === "label" ? (!row.value || isLabel(row.value) && row.value.id === row.id) : row.kind === "event" ? (!row.value || isEvent(row.value) && row.value.id === row.id) : supported(snap);
        if (!localValid || d.rows.has(row.key)) { s.issues.push("Review imported " + row.key + " in the recovery file."); continue; }
        if (typeof raw.hold === "string") row.hold = raw.hold;
        if (raw.conflict || raw.queue?.length || raw.deferred || raw.server || row.value === null) row.conflict = "Review the recovered entry and the current shared copy.";
        d.put(row);
      }
    }
    s.imported = true; s.localRevision++; s.caughtUp = false; delete s.exportedRevision;
  });
}
export function preview() {
  return access("readonly", async d => {
    const staged = await request<Snapshot[]>(d.tx.objectStore("staged").getAll());
    const remote = new Map(staged.map(r => [keyOf(r.kind,r.recordId),r]));
    const entries = [...new Set([...d.rows.keys(),...remote.keys()])].map(key => ({ key, local: d.rows.get(key), remote: remote.get(key),
      status: classify(d.rows.get(key), remote.get(key), d.settings.phase === "recovery") }));
    return { generation: d.settings.generation, entries };
  });
}
