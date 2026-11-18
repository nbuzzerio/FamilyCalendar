import { access, request, type Draft, type View } from "./database";
import { editRow } from "./calendar-data";
import { bytes, enqueue, keyOf, localProblem, operation, rowFor, same, supported, type Operation, type Row, type Snapshot, type Value } from "./model";

export type Result = { operationId: string; status: "accepted"; serverVersion: string } |
  { operationId: string; status: "conflict"; current: Snapshot | null; code: string } |
  { operationId: string; status: "rejected"; code: string };
export type Page = { cursor: string; hasMore: boolean; changes: Snapshot[]; results: Result[] };
export function linksEqual(a: Row["people"], b: Row["people"]) {
  const sorted = (links: Row["people"]) => links.map(p => p.personId + ":" + p.role).sort();
  return same(sorted(a), sorted(b));
}
function equalsRemote(row: Row, snap: Snapshot) {
  return same(row.value, snap.value) && (snap.deleted || linksEqual(row.people, snap.people));
}
export function mappingNeeded(v: View) {
  const ids = new Set<string>();
  for (const r of v.rows.values()) {
    if (r.kind === "label" && r.value?.kind === "Person") ids.add(r.id);
    if (r.kind === "legacy-attendance") ids.add(r.id.slice(11));
  }
  const map = new Map(v.settings.mappings);
  return [...ids].filter(id => !map.has(id));
}
export type AttendanceDecision = { labelValue: Value | null; personValue: Value | null; keep: "label" | "person"; person: string };
export function attendanceDifferences(v: View, label: string, person: string) {
  const differences = [];
  for (const source of v.rows.values()) {
    if (source.kind !== "legacy-attendance" || source.id.slice(11) !== label) continue;
    const existing = v.rows.get(keyOf("roll-call", source.id.slice(0,11) + person));
    if (existing && !same(existing.value, source.value)) differences.push({ source, existing });
  }
  return differences;
}
export function mapPerson(label: string, person: string, decisions: Record<string, AttendanceDecision> = {}) {
  return access("readwrite", d => {
    const backedUp = d.settings.exportedRevision === d.settings.localRevision;
    if (!d.settings.people.some(p => p.id === person)) throw Error("Select a directory Person.");
    const mappings = new Map(d.settings.mappings);
    if (mappings.has(label) && mappings.get(label) !== person) throw Error("This label already has a confirmed identity.");
    const responses = [...d.rows.values()].filter(r => r.kind === "legacy-attendance" && r.id.slice(11) === label);
    const differences = attendanceDifferences(d,label,person);
    for (const {source,existing} of differences) {
      const decision = decisions[source.key];
      if (!decision || decision.person !== person || !same(source.value,decision.labelValue) || !same(existing.value,decision.personValue)) {
        throw Error("Choose which attendance response to keep for " + source.id.slice(0,10) + " before confirming the match.");
      }
    }
    d.archive("Confirmed Calendar identity", { label, person, responses, differences, decisions });
    mappings.set(label, person); d.settings.mappings = [...mappings];
    const row = d.rows.get(keyOf("label", label));
    if (row?.value?.kind === "Person") editRow(d, "label", label, row.value, [...row.people.filter(p => p.role !== "label-person"), { personId: person, role: "label-person" }]);
    for (const r of responses) {
      const id = r.id.slice(0,11) + person;
      const existing = d.rows.get(keyOf("roll-call",id));
      if (!existing && !r.value) d.put(rowFor("roll-call",id,null,[{ personId: person, role: "attendee" }]));
      else if (!existing || decisions[r.key]?.keep === "label") {
        const people = existing?.people.filter(p => p.role !== "attendee") ?? [];
        editRow(d, "roll-call", id, r.value, [...people,{ personId: person, role: "attendee" }]);
      }
      d.remove(r.key);
    }
    // Identity choices do not invalidate a backup of the entire original source.
    if (backedUp) d.settings.exportedRevision = d.settings.localRevision;
  }, true);
}
export function selectBatch(v: View): Operation[] {
  const ops: Operation[] = []; let size = 0;
  for (const row of v.rows.values()) {
    const op = row.queue[0]?.operation;
    if (row.conflict || v.settings.legacyHolds?.includes(row.kind) || localProblem(row) || !op) continue;
    const length = bytes(op) + 1;
    if (ops.length === 32 || size + length > 900_000) break;
    ops.push(op); size += length;
  }
  return ops;
}
function install(d: Draft, row: Row, snap: Snapshot) {
  if (row.value && !same(row.value, snap.value)) d.archive("Before applying shared change", row);
  if (snap.kind === "label") {
    const person = snap.people.find(p => p.role === "label-person")?.personId;
    const mappings = new Map(d.settings.mappings);
    if (person && mappings.has(row.id) && mappings.get(row.id) !== person) {
      row.conflict = "This label has a different directory identity."; return;
    }
    const unmappedHistory = !mappings.has(row.id) && [...d.rows.values()].some(r => r.kind === "legacy-attendance" && r.id.slice(11) === row.id);
    if (person && !unmappedHistory) { mappings.set(row.id, person); d.settings.mappings = [...mappings]; }
  }
  row.value = snap.value; row.people = snap.people; row.revision++;
}
function applySnapshot(d: Draft, snap: Snapshot) {
  const key = keyOf(snap.kind, snap.recordId);
  const row = d.rows.get(key) ?? rowFor(snap.kind, snap.recordId, null);
  if (row.server && BigInt(row.server.serverVersion) > BigInt(snap.serverVersion)) return;
  const previous = row.server;
  row.server = snap;
  if (!supported(snap)) row.conflict = "Unsupported shared record. Original copy retained for recovery.";
  else if (row.deferred && !equalsRemote(row,snap)) row.conflict = "Compare the shared entry with the held local edit.";
  else if (!row.conflict && !row.queue.length) {
    if ((row.value && localProblem(row)) || (row.value && !previous && !equalsRemote(row, snap))) row.conflict = "Compare this local entry with the shared entry.";
    else install(d, row, snap);
  }
  d.put(row);
}
export function applyPage(d: Draft, page: Page, sent: Operation[], commonPending: boolean) {
  if (page.results.length !== sent.length) throw Error("Incomplete acknowledgement. Your changes will retry.");
  page.results.forEach((r, index) => {
    const op = sent[index], row = d.rows.get(keyOf(op.kind, op.recordId));
    if (!row || r.operationId !== op.operationId || !same(row.queue[0]?.operation, op)) throw Error("Acknowledgement mismatch. The original operations are retained.");
    if (r.status === "accepted") {
      const accepted = row.queue.shift()!;
      const snap = { kind: row.kind, recordId: row.id, schemaVersion: 1, value: accepted.value, people: accepted.people, deleted: op.type === "delete", serverVersion: r.serverVersion };
      if (!row.server || BigInt(row.server.serverVersion) <= BigInt(r.serverVersion)) row.server = snap;
      const next = row.queue[0];
      if (next) {
        next.operation = operation(row, next, r.serverVersion);
        if (snap.deleted && next.value) row.conflict = "Confirm restoration of this deleted record.";
      }
    } else {
      row.conflict = r.status === "conflict" ? "Both devices changed this entry." : "Service returned " + r.code + ".";
      if (r.status === "conflict" && (!row.server || !r.current || BigInt(r.current.serverVersion) >= BigInt(row.server.serverVersion))) row.server = r.current ?? undefined;
    }
    d.put(row);
  });
  for (const snap of page.changes) applySnapshot(d, snap);
  const s = d.settings;
  s.cursor = page.cursor; s.partialPage = page.hasMore; s.error = undefined; s.failures = 0; s.retryAt = 0;
  if (!commonPending && !page.hasMore && !sent.length) s.lastPoll = Date.now();
  s.caughtUp = !commonPending && !page.hasMore && !sent.length && !s.issues.length && !s.legacyHolds?.length && ![...d.rows.values()].some(r => r.queue.length || r.conflict || localProblem(r));
  if (s.caughtUp) s.lastConfirmed = Date.now();
}
export function startRecovery(d: Draft) {
  d.archive("Before server recovery", { settings: d.settings, records: [...d.rows.values()] });
  d.settings.phase = "recovery"; d.settings.stageCursor = null; d.settings.stageComplete = false; d.settings.caughtUp = false;
  d.tx.objectStore("staged").clear();
}
export function stagePage(d: Draft, page: Page) {
  const store = d.tx.objectStore("staged");
  for (const snap of page.changes) store.put(snap, keyOf(snap.kind, snap.recordId));
  d.settings.stageCursor = page.cursor; d.settings.stageComplete = !page.hasMore; d.settings.error = undefined;
  d.settings.failures = 0; d.settings.retryAt = 0;
}
export function classify(row: Row | undefined, snap: Snapshot | undefined, recovery: boolean) {
  if (snap && !supported(snap)) return "unsupported";
  if (!row) return "shared";
  if (!snap && localProblem(row) && !row.server && !row.queue.length) return "held";
  if (row.hold || row.conflict || (recovery && row.queue.length)) return "compare";
  if (!snap) return recovery && (row.value || row.server) ? "compare" : "local";
  return equalsRemote(row, snap) ? "matching" : "compare";
}
export function reconcile(expectedGeneration: number) {
  return access("readwrite", async d => {
    const s = d.settings;
    if (s.generation !== expectedGeneration || !s.stageComplete || !["initial","recovery"].includes(s.phase)) throw Error("The comparison changed. Review the updated entries.");
    const staged = d.tx.objectStore("staged");
    const remote = new Map((await request<Snapshot[]>(staged.getAll())).map(r => [keyOf(r.kind, r.recordId), r]));
    d.archive("Before reconciliation", { settings: s, records: [...d.rows.values()], remote: [...remote.values()] });
    for (const key of new Set([...d.rows.keys(), ...remote.keys()])) {
      const snap = remote.get(key);
      const old = d.rows.get(key);
      const row = old ?? rowFor(snap!.kind, snap!.recordId, null);
      const decision = classify(old, snap, s.phase === "recovery");
      row.server = snap;
      if (decision === "unsupported") row.conflict = "Unsupported shared record. Original copy retained for recovery.";
      else if (decision === "compare") row.conflict = "Compare the saved copies before sharing.";
      else if (snap) { install(d, row, snap); delete row.deferred; }
      else if (!localProblem(row) && !row.queue.length) {
        if (row.value) enqueue(row, false, row.deferred);
        delete row.deferred;
      }
      d.put(row);
    }
    s.phase = "ready"; s.cursor = s.stageCursor; s.stageComplete = false; s.partialPage = false; s.caughtUp = false; staged.clear();
  }, true);
}
export function resolveConflict(key: string, expected: Row, choice: "local" | "shared") {
  return access("readwrite", d => {
    const row = d.rows.get(key);
    if (d.settings.phase !== "ready" || !row?.conflict || !same(row, expected)) throw Error("This comparison changed. Review the latest entries.");
    if (row.server && !supported(row.server)) throw Error("Keep the recovery export until this record format is supported.");
    if (row.hold || (choice === "local" && localProblem(row))) throw Error("Resolve the local data issue before sharing.");
    d.archive("Before conflict decision", row);
    row.queue = []; delete row.conflict; delete row.deferred;
    if (choice === "local") enqueue(row, !!row.server?.deleted);
    else if (row.server) {
      // Reassign the label only. Existing attendance remains keyed to the original diner.
      const person = row.server.people.find(p => p.role === "label-person");
      const mappings = new Map(d.settings.mappings), prior = mappings.get(row.id);
      if (row.kind === "label" && person && prior && prior !== person.personId) {
        d.archive("Accepted shared label identity", { labelId: row.id, originalPerson: prior, sharedPerson: person.personId });
        mappings.set(row.id,person.personId); d.settings.mappings = [...mappings];
      }
      install(d, row, row.server);
    } else { row.value = null; row.revision++; }
    d.put(row); d.settings.caughtUp = false; d.settings.localRevision++;
  }, true);
}
