import { isEvent, isLocalDate } from "../events";
import { isLabel } from "../labels";
import { isDinner } from "../dinners";
import { availabilityStates, type Availability } from "../rollCall";

export type Value = Record<string, unknown>;
export type Link = { personId: string; role: string };
export type Snapshot = { kind: string; recordId: string; schemaVersion: number; value: Value | null; people: Link[]; deleted: boolean; serverVersion: string };
export type Operation = { operationId: string; type: "put" | "delete"; kind: string; recordId: string; baseServerVersion: string | null; value?: Value; people?: Link[]; schemaVersion?: 1; resurrect?: true };
export type Intent = { id: string; value: Value | null; people: Link[]; operation?: Operation };
export type Row = { key: string; kind: string; id: string; value: Value | null; people: Link[]; revision: number; queue: Intent[]; deferred?: Intent; server?: Snapshot; conflict?: string; hold?: string };
export type Person = { id: string; displayName: string; archived: boolean };
export type Space = { id: string; name: string; kind: "shared" | "personal"; archived: boolean };
export type Settings = {
  device: string; owner?: string; space?: string; phase: "local" | "initial" | "recovery" | "ready"; paused: boolean;
  cursor: string | null; commonCursor: string | null; stageCursor: string | null; stageComplete: boolean; partialPage?: boolean;
  generation: number; localRevision: number; exportedRevision?: number; consent?: string;
  lastConfirmed?: number; lastPoll?: number; caughtUp: boolean; failures: number; retryAt: number; error?: string;
  issues: string[]; legacyHolds?: string[]; mappings: [string, string][]; people: Person[]; spaces: Space[]; directoryOwner?: string;
  creation?: { id: string; name: string; type: "people" | "spaces" }; imported?: boolean;
};
export function initialSettings(): Settings {
  return { device: crypto.randomUUID(), phase: "local", paused: false, cursor: null, commonCursor: null,
    stageCursor: null, stageComplete: false, generation: 0, localRevision: 0, caughtUp: false, failures: 0,
    retryAt: 0, issues: [], mappings: [], people: [], spaces: [] };
}
export const keyOf = (kind: string, id: string) => kind + ":" + id;
export function rowFor(kind: string, id: string, value: Value | null, people: Link[] = []): Row {
  return { key: keyOf(kind, id), kind, id, value, people, queue: [], revision: 0 };
}
export const object = (v: unknown): v is Value => !!v && typeof v === "object" && !Array.isArray(v);
export const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const version = (v: unknown): v is string => typeof v === "string" && /^[1-9]\d{0,14}$/.test(v);
export const wireId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(id);
export const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  return object(a) && object(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && same(a[k], b[k]));
}
export const validChecks = (id: string, checks: unknown) => isLocalDate(id) && new Date(id).getUTCDay() === 1 && Array.isArray(checks) && checks.every(k => typeof k === "string" && !!k && k === k.trim().toLowerCase());
export const validResponse = (v: unknown) => availabilityStates.includes(v as Availability);
export function supported(s: Snapshot): boolean {
  const { kind, recordId: id, value: v, people } = s;
  if (s.schemaVersion !== 1 || !wireId(id) || (v?.id !== undefined && v.id !== id)) return false;
  if (kind === "roll-call") {
    const links = people.filter(p => p.role === "attendee");
    return isLocalDate(id.slice(0, 10)) && id[10] === ":" && uuid(id.slice(11)) && (s.deleted || (validResponse(v?.availability) && links.length === 1 && links[0].personId === id.slice(11)));
  }
  if (kind === "event") return s.deleted || (isEvent(v) && v.id === id);
  if (kind === "label") return s.deleted || (isLabel(v) && v.id === id && people.filter(p => p.role === "label-person").length === (v.kind === "Person" ? 1 : 0));
  if (kind === "dinner-plan") return isLocalDate(id) && (s.deleted || isDinner(v));
  if (kind === "grocery-checks") return validChecks(id, s.deleted ? [] : v?.checked);
  return false;
}
export function localProblem(row: Row): string | undefined {
  if (row.hold) return row.hold;
  if (row.kind === "legacy-attendance" || (row.kind === "label" && row.value?.kind === "Person" && !row.people.some(p => p.role === "label-person"))) return "Choose the directory Person for this Calendar label.";
  if (!wireId(row.id)) return "This historical ID needs review before sharing.";
  if (row.value && bytes(row.value) > 65536) return "This record exceeds the service size limit.";
  const stack: [unknown, number][] = [[row.value, 0]];
  while (stack.length) {
    const [v, depth] = stack.pop()!;
    if (v && typeof v === "object") {
      if (depth >= 28) return "Nested metadata exceeds the service depth limit.";
      for (const child of Object.values(v)) stack.push([child, depth + 1]);
    }
  }
  return undefined;
}
export function operation(row: Row, intent: Intent, base: string | null, resurrect = false): Operation {
  const common = { kind: row.kind, recordId: row.id, baseServerVersion: base, operationId: intent.id };
  return intent.value === null ? { ...common, type: "delete" } :
    { ...common, type: "put", value: intent.value, people: intent.people, schemaVersion: 1, ...(resurrect ? { resurrect: true as const } : {}) };
}
export function enqueue(row: Row, resurrect = false, intent: Intent = { id: crypto.randomUUID(), value: structuredClone(row.value), people: structuredClone(row.people) }) {
  if (!row.queue.length) {
    if (!row.value && (!row.server || row.server.deleted)) return;
    if (row.server?.deleted && row.value && !resurrect) row.conflict = "Confirm restoration of this deleted record.";
    intent.operation = operation(row, intent, row.server?.serverVersion ?? null, resurrect);
  }
  row.queue.push(intent);
}
