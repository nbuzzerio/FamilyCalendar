import { object, uuid, version, type Operation, type Person, type Snapshot, type Space } from "./model";
import type { Page, Result } from "./replication";

type Session = { principalId: string; csrfToken: string; expiresAt: number };
export let session: Session | null = null;
export let auth: "unknown" | "signed-in" | "signed-out" = "unknown";
let limitedUntil = 0;
export class ApiError extends Error {
  constructor(public code: string, public status: number, public retry: number) {
    super(code === "INVALID_CREDENTIALS" ? "Incorrect household password." : status === 401 ? "Sign in with the household password." : "Sync service returned " + code + ".");
  }
}
function invalid(): never { throw Error("Unexpected sync service response. Your saved changes are retained."); }
async function call(path: string, body?: unknown): Promise<unknown> {
  if (limitedUntil > Date.now()) throw new ApiError("RATE_LIMITED", 429, limitedUntil - Date.now());
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch("/api/v1/" + path, {
      method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: controller.signal, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(session && body !== undefined ? { "X-CSRF-Token": session.csrfToken } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const code = data?.error?.code ?? "HTTP_" + response.status;
      if (response.status === 401 || code === "CSRF_REQUIRED") { session = null; auth = response.status === 401 ? "signed-out" : "unknown"; }
      const retry = response.headers.get("Retry-After");
      const delay = retry ? Math.max(0, Number(retry) * 1000 || Date.parse(retry) - Date.now()) : 0;
      if (response.status === 429) limitedUntil = Date.now() + (delay || 60000);
      throw new ApiError(code, response.status, delay);
    }
    return response.status === 204 ? null : await response.json();
  } finally { clearTimeout(timer); }
}
export async function authenticate(password?: string) {
  const data = password === undefined ? await call("auth/session") : await call("auth/household-login", { password });
  if (!object(data) || !uuid(data.principalId) || typeof data.csrfToken !== "string" || !data.csrfToken || !Number.isSafeInteger(data.expiresAt)) invalid();
  session = data as Session; auth = "signed-in"; return session;
}
export async function logout() { await call("auth/logout", {}); session = null; auth = "signed-out"; }
function snapshot(v: unknown): Snapshot {
  if (!object(v) || typeof v.kind !== "string" || typeof v.recordId !== "string" || !version(v.serverVersion) || !Number.isInteger(v.schemaVersion) ||
    typeof v.deleted !== "boolean" || (v.deleted ? v.value !== null : !object(v.value)) ||
    !Array.isArray(v.people) || !v.people.every(p => object(p) && uuid(p.personId) && typeof p.role === "string")) invalid();
  return v as Snapshot;
}
function result(v: unknown): Result {
  if (!object(v) || !uuid(v.operationId)) invalid();
  if (v.status === "accepted" && version(v.serverVersion)) return v as Result;
  if (v.status === "rejected" && typeof v.code === "string") return v as Result;
  if (v.status === "conflict" && v.code === "VERSION_CONFLICT") {
    if (v.current !== null) snapshot(v.current);
    return v as Result;
  }
  return invalid();
}
function page(v: unknown, prior: string | null) {
  if (!object(v) || v.protocolVersion !== 1 || typeof v.cursor !== "string" || !v.cursor || typeof v.hasMore !== "boolean" ||
    (v.hasMore && v.cursor === prior) || !Array.isArray(v.changes)) invalid();
  return { changes: v.changes as unknown[], cursor: v.cursor, hasMore: v.hasMore };
}
export async function exchange(deviceId: string, spaceId: string, cursor: string | null, changes: Operation[]): Promise<Page> {
  const v = await call("apps/family-calendar/exchange", { protocolVersion: 1, appId: "family-calendar", deviceId, spaceId, cursor, limit: 25, changes });
  const p = page(v, cursor);
  if (!object(v) || !Array.isArray(v.results)) invalid();
  const results = v.results.map(result);
  if (results.length !== changes.length || results.some((r,i) => r.operationId !== changes[i].operationId ||
    (r.status === "conflict" && r.current && (r.current.kind !== changes[i].kind || r.current.recordId !== changes[i].recordId)))) invalid();
  return { ...p, changes: p.changes.map(snapshot), results };
}
function entity(kind: "people" | "spaces", v: unknown): Person | Space {
  if (!object(v) || !uuid(v.id) || typeof v.archived !== "boolean") invalid();
  if (kind === "people" ? typeof v.displayName !== "string" : typeof v.name !== "string" || !["personal","shared"].includes(String(v.kind))) invalid();
  return v as Person | Space;
}
export async function directory(kind: "people" | "spaces") {
  const rows: (Person | Space)[] = [];
  let after = "";
  do {
    const v = await call(kind + "?limit=100" + (after ? "&after=" + encodeURIComponent(after) : ""));
    if (!object(v) || !Array.isArray(v.items) || typeof v.hasMore !== "boolean" || (v.hasMore && (!uuid(v.after) || v.after <= after))) invalid();
    rows.push(...v.items.map(x => entity(kind, x)));
    after = v.hasMore ? v.after as string : "";
  } while (after);
  return rows;
}
export async function common(cursor: string | null) {
  const p = page(await call("common/changes", { protocolVersion: 1, cursor, limit: 50 }), cursor);
  const people: Person[] = [], spaces: Space[] = [];
  for (const c of p.changes) {
    if (!object(c)) invalid();
    if (c.entityType === "person") people.push(entity("people", c.value) as Person);
    else if (c.entityType === "space") spaces.push(entity("spaces", c.value) as Space);
    else if (c.entityType !== "membership") invalid();
  }
  return { cursor: p.cursor, hasMore: p.hasMore, people, spaces };
}
export async function create(type: "spaces" | "people", id: string, name: string) {
  try { return entity(type, await call(type, type === "spaces" ? { id, name, kind: "shared" } : { id, displayName: name })); }
  catch (e) {
    if (!(e instanceof ApiError) || e.code !== "ID_EXISTS") throw e;
    const existing = entity(type, await call(type + "/" + id));
    if ("kind" in existing ? existing.kind !== "shared" || existing.name !== name : existing.displayName !== name) throw Error("The saved creation request no longer matches the directory.");
    return existing;
  }
}
