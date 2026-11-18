import { useEffect, useState } from "react";
import { dateKey } from "./events";
import type { CalendarLabel } from "./labels";
import { availabilityFor, availabilityStates, type Availability, type RollCall } from "./rollCall";

import { rollCallStore, commit } from "./sync/calendar-data";

export function DinnerRollCall({ days, labels, onAvailabilityChange }: { days: Date[]; labels: CalendarLabel[]; onAvailabilityChange?: (saved: RollCall | null) => void }) {
  const [saved, setSaved] = useState<RollCall>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const refresh = () => { try { const next = rollCallStore.list(); setSaved(next); setError(""); onAvailabilityChange?.(next); } catch (error) { setError((error as Error).message); onAvailabilityChange?.(null); } };
    refresh(); window.addEventListener("calendar-update", refresh);
    return () => window.removeEventListener("calendar-update", refresh);
  }, []);
  const people = labels.filter(label => label.kind === "Person");
  return <section className="roll-call" aria-labelledby="roll-call-heading">
    <h2 id="roll-call-heading">Dinner Roll Call</h2>
    <p>Who is available for dinner? Everyone starts Available. Choose Unavailable or Unknown when needed. Use the Dinner Roster week controls above for both sections.</p>
    <p>{dateKey(days[0])} – {dateKey(days[6])}.</p>
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-atomic="true">{notice}</p>
    {!people.length ? <p>No Person labels yet. <a href="#label-name">Add a Person label in People and categories</a> to start your family roster.</p> :
      <ol className="dinner-days">{days.map(date => {
        const key = dateKey(date);
        return <li className="day" key={key}>
          <h3><time dateTime={key}>{date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}</time></h3>
          <p>{error ? "Availability unavailable" : `${people.filter(person => availabilityFor(saved, key, person.id) === "Available").length} of ${people.length} available`}</p>
          {people.map(person => <label className="roll-call-person" key={person.id}>{person.name}
            <select aria-label={`Dinner availability for ${person.name} on ${key}`} value={Object.hasOwn(saved[key] ?? {}, person.id) ? availabilityFor(saved, key, person.id) : ""} disabled={!!error} onChange={event => {
              const state = (event.target.value || null) as Availability | null;
              commit(() => rollCallStore.save(key, person.id, state), next => {
                setSaved(next); onAvailabilityChange?.(next); setNotice(`${person.name}: ${state ?? "response cleared"} for ${key}.`);
              }, () => { setNotice(""); setError("Dinner response could not be saved. Saved responses are unchanged. Reload to retry."); });
            }}><option value="">Available (default)</option>{availabilityStates.map(state => <option key={state}>{state}</option>)}</select>
          </label>)}
        </li>;
      })}</ol>}
  </section>;
}
