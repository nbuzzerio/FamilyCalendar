import { useEffect, useState } from "react";
import { dateKey } from "./events";
import type { CalendarLabel } from "./labels";
import { availabilityFor, availabilityStates, rollCallStore, type Availability, type RollCall } from "./rollCall";

export function DinnerRollCall({ days, labels, onAvailabilityChange }: { days: Date[]; labels: CalendarLabel[]; onAvailabilityChange?: (saved: RollCall | null) => void }) {
  const [saved, setSaved] = useState<RollCall>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const refresh = () => { try { const next = rollCallStore.list(); setSaved(next); setError(""); onAvailabilityChange?.(next); } catch (error) { setError((error as Error).message); onAvailabilityChange?.(null); } };
    refresh(); window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  const people = labels.filter(label => label.kind === "Person");
  return <section className="roll-call" aria-labelledby="roll-call-heading">
    <h2 id="roll-call-heading">Dinner Roll Call</h2>
    <p>Who is available for dinner? Everyone starts Available. Choose Unavailable or Unknown when needed. Use the Dinner Roster week controls above for both sections.</p>
    <p>{dateKey(days[0])} – {dateKey(days[6])}. Responses stay in this browser and are not included in Export backup.</p>
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-atomic="true">{notice}</p>
    {!people.length ? <p>No Person labels yet. <a href="#label-name">Add a Person label in People and categories</a> to start your family roster.</p> :
      <ol className="dinner-days">{days.map(date => {
        const key = dateKey(date);
        return <li className="day" key={key}>
          <h3><time dateTime={key}>{date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}</time></h3>
          <p>{error ? "Availability unavailable" : `${people.filter(person => availabilityFor(saved, key, person.id) === "Available").length} of ${people.length} available`}</p>
          {people.map(person => <label className="roll-call-person" key={person.id}>{person.name}
            <select aria-label={`Dinner availability for ${person.name} on ${key}`} value={availabilityFor(saved, key, person.id)} disabled={!!error} onChange={event => {
              const state = event.target.value as Availability;
              try { const next = rollCallStore.save(key, person.id, state); setSaved(next); onAvailabilityChange?.(next); setNotice(`${person.name}: ${state} for ${key}.`); }
              catch { onAvailabilityChange?.(null); setNotice(""); setError("Dinner response could not be saved. Saved responses are unchanged. Reload to retry."); }
            }}>{availabilityStates.map(state => <option key={state}>{state}</option>)}</select>
          </label>)}
        </li>;
      })}</ol>}
  </section>;
}
