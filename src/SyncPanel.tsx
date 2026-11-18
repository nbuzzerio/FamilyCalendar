import { useEffect, useRef, useState } from "react";
import { view } from "./sync/database";
import { auth, session } from "./sync/api";
import { beginConnection, busy, createEntry, message, pause, serviceOffline, signIn, signOut, sync } from "./sync/engine";
import { localProblem, wireId, supported, type Value, type Link } from "./sync/model";
import { correctId } from "./sync/calendar-data";
import { attendanceDifferences, mapPerson, mappingNeeded, reconcile, resolveConflict, type AttendanceDecision } from "./sync/replication";
import { exportCalendar, keepCurrentCalendar, preview, restoreBackup } from "./sync/recovery";

function description(kind: string, v: Value | null | undefined) {
  if (!v) return "No saved entry";
  switch (kind) {
    case "event": return [v.title, v.date, v.time || "All day", (v.recurrence as Value)?.frequency, (v.recurrence as Value)?.endDate, v.notes, v.labelId].filter(Boolean).join(" · ");
    case "label": return [v.name, v.kind, v.color].join(" · ");
    case "roll-call": case "legacy-attendance": return String(v.availability);
    case "dinner-plan": return [v.name, v.cook, v.notes, ...(v.ingredients as Value[] ?? []).map(i => [i.name,i.amount].filter(Boolean).join(" "))].filter(Boolean).join(" · ");
    case "grocery-checks": return (v.checked as string[])?.join(", ") || "No groceries checked";
    default: return "Retained in recovery backup";
  }
}
function copy(kind: string, v: Value | null | undefined, people?: Link[]) {
  try {
    const names = people?.map(p => {
      const name = view.settings.people.find(x => x.id === p.personId)?.displayName;
      if (!name) return p.personId;
      return view.settings.people.filter(x => x.displayName === name).length > 1 ? name + " (" + p.personId + ")" : name;
    }) ?? [];
    return [description(kind,v), ...names].join(" · ");
  } catch { return "Unsupported entry retained in the backup"; }
}
export function SyncPanel() {
  const [, redraw] = useState(0);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [working, setWorking] = useState(false);
  const [space, setSpace] = useState(""), [consent, setConsent] = useState(false), [comparison, setReview] = useState<Awaited<ReturnType<typeof preview>>>();
  const review = comparison?.entries ?? [];
  const [createName,setName] = useState(""), [personName,setPersonName] = useState("");
  const [mapping,setMapping] = useState(new Map<string,string>());
  const [decisions,setDecisions] = useState<Record<string,AttendanceDecision>>({});
  const panel = useRef<HTMLDetailsElement>(null), password = useRef<HTMLInputElement>(null);
  const s = view.settings, rows = [...view.rows.values()];
  const pending = rows.reduce((n,r) => n + r.queue.length, 0);
  const conflicts = rows.filter(r => r.conflict);
  const held = rows.filter(r => localProblem(r) && (r.value || r.queue.length || r.hold));
  const missing = mappingNeeded(view);
  const missingLabels = rows.filter(r => r.kind === "event" && r.value?.labelId && !view.rows.get("label:" + r.value.labelId)?.value);
  const archived = s.space && !s.spaces.some(x => x.id === s.space && x.kind === "shared" && !x.archived);
  const status = !navigator.onLine || serviceOffline ? "Offline" : busy ? "Syncing" : auth === "signed-out" ? "Sign in required" :
    s.phase !== "ready" || s.paused || conflicts.length || held.length || s.issues.length || s.legacyHolds?.length || s.error || message || archived ? "Attention needed" :
    pending || !s.caughtUp ? "Changes pending" : "Synced";
  useEffect(() => { const changed = () => redraw(x => x+1); window.addEventListener("calendar-update", changed); return () => window.removeEventListener("calendar-update",changed); }, []);
  useEffect(() => {
    let live = true;
    if (s.stageComplete) void preview().then(v => { if (live) setReview(v); }, e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [s.stageComplete,s.generation]);
  async function act(run: () => Promise<unknown>, success = "") {
    setError(""); setNotice(""); setWorking(true);
    try { await run(); setNotice(success); } catch (e) { setError(e instanceof Error ? e.message : "Unable to complete this action."); }
    finally { setWorking(false); redraw(x => x+1); }
  }
  const spaces = s.spaces.filter(v => v.kind === "shared" && !v.archived && (!s.space || v.id === s.space));
  const selected = s.space || space || (spaces.length === 1 ? spaces[0].id : "");
  const nameFor = (kind: string, id: string) => {
    if (kind === "roll-call") return id.slice(0,10) + " · " + (s.people.find(p => p.id === id.slice(11))?.displayName ?? id.slice(11));
    return id;
  };
  return <div className="sync-panel">
    <div className="sync-summary"><button type="button" disabled={working || busy} onClick={() => {
      if (s.phase !== "ready" || auth === "signed-out" || status === "Attention needed") panel.current!.open = true;
      void act(() => sync(true, auth !== "signed-in"));
    }}>Sync</button><span role="status" aria-live="polite">{status}</span>
      {s.lastConfirmed && <small>Last synced <time dateTime={new Date(s.lastConfirmed).toISOString()}>{new Date(s.lastConfirmed).toLocaleString()}</time></small>}
    </div>
    <details ref={panel} className="sync-settings"><summary>Advanced sync settings</summary>
      <fieldset disabled={working}><legend>Household connection</legend>
        {auth === "signed-in" ? <button onClick={() => void act(signOut)}>Sign out</button> :
          <form onSubmit={e => { e.preventDefault(); const value = password.current!.value; password.current!.value = ""; void act(() => signIn(value)); }}>
            <label>Household password<input type="password" ref={password} autoComplete="current-password" required /></label><button>Sign in</button>
          </form>}
        {s.phase !== "local" && <><p>Shared Space · {s.spaces.find(v => v.id === s.space)?.name ?? s.space}</p>
          <button onClick={() => void act(() => pause(!s.paused))}>{s.paused ? "Resume sync" : "Pause sync"}</button></>}
      </fieldset>
      {!!s.legacyHolds?.length && <fieldset disabled={working}><legend>Changes from an older Calendar tab</legend>
        <p>Uploads are held for {s.legacyHolds.join(", ")}. Close the older tab and export a backup to compare its saved text with this Calendar.</p>
        <button disabled={s.exportedRevision !== s.localRevision} onClick={() => void act(keepCurrentCalendar)}>Keep this Calendar and retain older edits in backup</button>
      </fieldset>}
      <fieldset disabled={working}><legend>Backup and recovery</legend>
        <button onClick={() => void act(exportCalendar, "Backup download requested. Keep the file private.")}>Export backup</button>
        <details><summary>Recover a backup</summary><p>Open an empty Calendar browser profile. Choose a backup to recover local entries and retain the original file for review. Sharing requires a new connection review.</p>
          <label>Calendar backup<input type="file" accept="application/json,.json" onChange={e => {
            const file = e.target.files?.[0]; e.target.value = "";
            if (file && window.confirm("Recover this backup into this empty Calendar?")) void act(async () => restoreBackup(await file.text()), "Recovered on this device. Review before sharing.");
          }} /></label></details>
      </fieldset>
      {auth === "signed-in" && s.phase === "local" && <fieldset disabled={working}><legend>First connection</legend>
        <label>Shared Space<select aria-label="Shared Space" value={selected} onChange={e => setSpace(e.target.value)}><option value="">Choose a shared Space</option>
          {spaces.map(v => <option key={v.id} value={v.id}>{v.name} · {v.id}</option>)}</select></label>
        {!s.space && <details><summary>Create a shared Space</summary><form onSubmit={e => { e.preventDefault(); void act(() => createEntry("spaces",createName), "Shared Space available to select."); }}>
          <label>New Space name<input value={createName} onChange={e => setName(e.target.value)} required maxLength={100} /></label><button>Create shared Space</button></form></details>}
        <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I saved my backup and agree to compare this Calendar with the selected shared Space.</label>
        <button disabled={!consent || !selected || s.exportedRevision !== s.localRevision} onClick={() => void act(() => beginConnection(selected))}>Download for comparison</button>
        {s.exportedRevision !== s.localRevision && <p>Export a current backup before connecting.</p>}
      </fieldset>}
      {!!missing.length && <fieldset disabled={working || !session}><legend>Match Calendar people</legend>
        <p>Choose the directory identity for each label. Historical attendance keeps its original label until you confirm a match. You can share other records while a match is pending.</p>
        {missing.map(id => <div key={id}><label>{String(view.rows.get("label:" + id)?.value?.name ?? "Historical label")} · {id}
          <select value={mapping.get(id) ?? ""} onChange={e => setMapping(new Map(mapping).set(id,e.target.value))}><option value="">Choose directory Person</option>
            {s.people.map(p => <option key={p.id} value={p.id}>{p.displayName}{p.archived ? " (archived)" : ""} · {p.id}</option>)}</select></label>
          {attendanceDifferences(view,id,mapping.get(id) ?? "").map(({source,existing}) => <label key={source.key}>Different responses for {source.id.slice(0,10)}
            <select value={decisions[source.key]?.person === mapping.get(id) ? decisions[source.key]?.keep ?? "" : ""} onChange={e => setDecisions({
              ...decisions, [source.key]: { labelValue: source.value, personValue: existing.value, keep: e.target.value as "label" | "person", person: mapping.get(id)! },
            })}><option value="" disabled>Choose a response</option><option value="label">Historical label · {copy(source.kind,source.value)}</option>
              <option value="person">Directory Person · {copy(existing.kind,existing.value)}</option></select></label>)}
          <button disabled={!mapping.get(id)} onClick={() => void act(() => mapPerson(id,mapping.get(id)!,decisions))}>Confirm match</button></div>)}
        <details><summary>Create a directory Person</summary><form onSubmit={e => { e.preventDefault(); void act(() => createEntry("people",personName), "Person created. Confirm the intended Calendar match."); }}>
          <label>New Person name<input value={personName} onChange={e => setPersonName(e.target.value)} required maxLength={100} /></label><button>Create directory Person</button></form></details>
      </fieldset>}
      {(s.phase === "initial" || s.phase === "recovery") && <fieldset disabled={working}><legend>{s.phase === "recovery" ? "Review restored server" : "Review first connection"}</legend>
        {s.stageComplete && comparison?.generation === s.generation ? <><p>
          {review.filter(r => r.status === "local").length} local only · {review.filter(r => r.status === "shared").length} shared only ·
          {" "}{review.filter(r => r.status === "matching").length} matching · {review.filter(r => r.status === "held").length} held locally ·
          {" "}{review.filter(r => ["compare","unsupported"].includes(r.status)).length} need comparison</p>
          <details><summary>Inspect entries</summary><ul>{review.map(r => <li key={r.key}>{r.key} · {r.status}<br/>This device · {copy(r.local?.kind ?? "", r.local?.value,r.local?.people)}<br/>Shared · {copy(r.remote?.kind ?? "",r.remote?.value,r.remote?.people)}</li>)}</ul></details>
          <p>Share eligible local entries and accept new shared entries. Differences stay available for a separate decision.</p>
          <button onClick={() => void act(() => reconcile(s.generation))}>Approve reconciliation</button></> : <p>Downloading entries for comparison…</p>}
      </fieldset>}
      {!!conflicts.length && <fieldset disabled={working || s.phase !== "ready"}><legend>Conflicting entries</legend>{conflicts.map(r => <article key={r.key}>
        <h3>{r.kind} · {nameFor(r.kind,r.id)}</h3><p>{r.conflict}</p>
        <p>This device · {copy(r.kind,r.value,r.people)}</p><p>Shared · {copy(r.kind,r.server?.value,r.server?.people)}</p>
        {r.kind === "label" && r.server?.people.some(p => p.role === "label-person" && p.personId !== new Map(s.mappings).get(r.id)) &&
          <p>Using the shared Person changes this label's roster identity. Previously saved attendance stays with its original diner.</p>}
        <details><summary>Full comparison</summary><pre>{JSON.stringify({device: {value:r.value,people:r.people},shared:r.server ?? null},null,2)}</pre></details>
        {r.server && !supported(r.server) ? <p>Export a backup to retain both copies for a compatible Calendar version.</p> : <>
          <button onClick={() => void act(() => resolveConflict(r.key,r,"local"))}>{r.server?.deleted && r.value ? "Restore my copy" : "Keep device choice"}</button>
          <button onClick={() => void act(() => resolveConflict(r.key,r,"shared"))}>Use shared choice</button></>}</article>)}</fieldset>}
      {(held.length > 0 || s.issues.length > 0 || missingLabels.length > 0) && <details><summary>Records needing review</summary><ul>
        {s.issues.map((i,n) => <li key={n}>{i}</li>)}{held.map(r => <li key={r.key}>{r.key} · {localProblem(r)}
          {!wireId(r.id) && ["event","label"].includes(r.kind) && r.value && !r.hold && <form onSubmit={e => {
            e.preventDefault(); const id = String(new FormData(e.currentTarget).get("newId") ?? "").trim();
            if (window.confirm("Change this ID and update its Calendar references? The original is retained in recovery.")) void act(() => correctId(r,id));
          }}><label>New ID for {r.id}<input name="newId" required maxLength={160} /></label><button>Confirm ID change</button></form>}</li>)}
        {missingLabels.map(r => <li key={r.key}>{String(r.value?.title)} retains historical label {String(r.value?.labelId)}.</li>)}</ul></details>}
      <details><summary>Connection details</summary><p>{pending} queued changes · {conflicts.length} comparisons</p>
        {s.creation && <p>Pending directory creation · {s.creation.name}</p>}{(message || s.error) && <p>{message || s.error}</p>}</details>
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    </details>
  </div>;
}
