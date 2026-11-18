import * as api from "./api";
import { access, alertView, view } from "./database";
import { applyPage, selectBatch, stagePage, startRecovery } from "./replication";
import type { Person, Space } from "./model";

const poll = 60_000;
let timer: ReturnType<typeof setTimeout>;
let running: Promise<void> | undefined;
let active = false, wakeAgain = false;
export let busy = false, serviceOffline = false, message = "";
let household: BroadcastChannel | undefined;
async function lock<T>(run: () => Promise<T>, wait = true) {
  if (!navigator.locks) throw Error("This browser needs Web Locks to share changes safely. Calendar edits stay on this device.");
  const name = "family-calendar-sync-v1";
  if (!wait) return navigator.locks.request(name, { ifAvailable: true }, held => held ? run() : undefined);
  const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 20000);
  try { return await navigator.locks.request(name, { signal: controller.signal }, () => { clearTimeout(deadline); return run(); }); }
  finally { clearTimeout(deadline); }
}
function owner() {
  const id = api.session?.principalId;
  if (!id || (view.settings.owner ?? view.settings.directoryOwner ?? id) !== id) throw Error("Sign in as the household that owns this Calendar.");
  return id;
}
async function loadDirectory() {
  const id = owner();
  const [people, spaces] = await Promise.all([api.directory("people"), api.directory("spaces")]);
  await access("readwrite", d => {
    d.settings.directoryOwner = id; d.settings.people = people as Person[]; d.settings.spaces = spaces as Space[];
    d.settings.failures = 0; d.settings.retryAt = 0; delete d.settings.error;
  });
}
export async function createEntry(type: "spaces" | "people", name: string) {
  const display = name.trim();
  if (!display || display.length > 100) throw Error("Enter a name of 1 to 100 characters.");
  return lock(async () => {
    owner();
    const intent = await access("readwrite", d => {
      const prior = d.settings.creation;
      if (prior && (prior.name !== display || prior.type !== type)) throw Error("Retry the pending creation for " + prior.name + " first.");
      if (!prior && type === "spaces" && d.settings.spaces.some(v => v.kind === "shared" && !v.archived && v.name === display)) throw Error("A shared Space already has this name. Choose it in Shared Space.");
      return d.settings.creation = prior ?? { type, id: crypto.randomUUID(), name: display };
    });
    await api.create(type, intent.id, intent.name);
    await loadDirectory();
    await access("readwrite", d => { delete d.settings.creation; });
    return intent.id;
  });
}
export async function signIn(password: string) {
  await lock(async () => { await api.authenticate(password); owner(); await loadDirectory(); message = ""; serviceOffline = false; });
  household?.postMessage("changed"); alertView(); schedule();
}
export async function signOut() {
  await lock(async () => { await api.logout(); }); household?.postMessage("changed"); alertView();
}
export async function pause(paused: boolean) {
  await lock(() => access("readwrite", d => { d.settings.paused = paused; d.settings.caughtUp = false; }));
  if (!paused) schedule();
}
export async function beginConnection(spaceId: string) {
  await lock(async () => {
    const id = owner();
    await access("readwrite", d => {
      const s = d.settings;
      if (s.phase !== "local" || (s.owner && s.owner !== id) || (s.space && s.space !== spaceId)) throw Error("Calendar is bound to another connection.");
      if (s.exportedRevision !== s.localRevision) throw Error("Download a current backup before connecting.");
      if (s.directoryOwner !== id || !s.spaces.some(v => v.id === spaceId && v.kind === "shared" && !v.archived)) throw Error("Choose an active shared Space.");
      Object.assign(s, { owner: id, space: spaceId, consent: new Date().toISOString(), phase: "initial", paused: false, stageComplete: false, stageCursor: null });
    });
  });
  await sync(true);
}
function merged<T extends {id:string}>(a:T[], b:T[]) { return [...new Map([...a,...b].map(v => [v.id,v])).values()]; }
async function pass(force: boolean, restore: boolean, idle: boolean) {
  if (!navigator.onLine || (!force && document.hidden)) return;
  if (!navigator.locks && (restore || force)) {
    try { await api.authenticate(); } finally { alertView(); }
  }
  await lock(async () => {
    await access("readonly", () => {});
    let s = view.settings;
    if (!force && s.retryAt > Date.now() && !restore) return;
    if (idle && ((s.phase === "local" && api.auth !== "unknown") || s.paused || api.auth === "signed-out" || (!s.error && Date.now() - (s.lastPoll ?? 0) < poll && !selectBatch(view).length))) return;
    busy = true; alertView();
    try {
      if (restore || !api.session) await api.authenticate();
      owner(); serviceOffline = false; message = "";
      if (s.phase === "local") { await loadDirectory(); return; }
      if (s.paused || (s.stageComplete && s.phase !== "ready")) return;
      let moreCommon = true;
      for (let n = 0; n < 6; n++) {
        try {
          const p = await api.common(view.settings.commonCursor);
          await access("readwrite", d => {
            d.settings.people = merged(d.settings.people, p.people); d.settings.spaces = merged(d.settings.spaces, p.spaces); d.settings.commonCursor = p.cursor;
          });
          moreCommon = p.hasMore; if (!moreCommon) break;
        } catch (e) {
          if (!(e instanceof api.ApiError) || e.code !== "CURSOR_RESET_REQUIRED") throw e;
          await loadDirectory(); await access("readwrite", d => { d.settings.commonCursor = null; startRecovery(d); });
        }
      }
      for (let n = 0; n < 12; n++) {
        s = view.settings;
        const staging = s.phase !== "ready";
        if (staging && s.stageComplete) break;
        if (!s.spaces.some(v => v.id === s.space && v.kind === "shared" && !v.archived)) throw Error("The selected shared Space is unavailable. Your pending changes are retained.");
        const changes = staging ? [] : selectBatch(view);
        try {
          const p = await api.exchange(s.device, s.space!, staging ? s.stageCursor : s.cursor, changes);
          await access("readwrite", d => staging ? stagePage(d, p) : applyPage(d, p, changes, moreCommon));
          if (!p.hasMore && (staging || !changes.length)) { if (moreCommon) wakeAgain = true; break; }
          if (n === 11) wakeAgain = true;
        } catch (e) {
          if (!(e instanceof api.ApiError) || e.code !== "CURSOR_RESET_REQUIRED") throw e;
          await access("readwrite", startRecovery);
        }
      }
    } catch (e) {
      message = e instanceof Error ? e.message : "Could not reach the sync service.";
      serviceOffline = e instanceof TypeError || (e instanceof DOMException && e.name === "AbortError") || (e instanceof api.ApiError && e.status >= 500);
      await access("readwrite", d => {
        const s = d.settings;
        s.failures = Math.min(10, s.failures + 1); s.error = message; s.caughtUp = false;
        s.retryAt = Date.now() + Math.max(Math.min(300000, 1000 * 2 ** s.failures), e instanceof api.ApiError ? e.retry : 0);
      });
    } finally { busy = false; alertView(); }
  }, force || restore);
}
export async function sync(force = false, restore = false, idle = false): Promise<void> {
  if (running) { await running; if (force || restore) return sync(force, restore); return; }
  clearTimeout(timer);
  running = pass(force, restore, idle).catch(e => { message = e.message; alertView(); });
  try { await running; } finally { running = undefined; if (active) schedule(!wakeAgain); wakeAgain = false; }
}
function schedule(idle = false) {
  if (!active) return;
  if (running) { if (!idle) wakeAgain = true; return; }
  clearTimeout(timer);
  const retry = view.settings.retryAt - Date.now();
  const delay = idle && retry > 0 && api.auth !== "signed-out" ? Math.max(900,retry) : idle ? poll : 900;
  timer = setTimeout(() => void sync(false, false, idle), delay);
}
export function start() {
  if (active) return;
  active = true;
  if (typeof BroadcastChannel !== "undefined") {
    household = new BroadcastChannel("household-session"); household.onmessage = () => void sync(false, true);
  }
  const foreground = () => { if (!document.hidden) void sync(false, true); };
  window.addEventListener("calendar-edit", () => schedule());
  window.addEventListener("online", foreground); window.addEventListener("offline", alertView);
  window.addEventListener("focus", foreground); document.addEventListener("visibilitychange", foreground);
  void sync(false, true);
}
