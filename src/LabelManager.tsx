import { useRef, useState } from "react";
import { labelTextColor, type CalendarLabel, type LabelInput } from "./labels";

import { labelStore, commit } from "./sync/calendar-data";

export function LabelManager({ labels, onChange }: { labels: CalendarLabel[]; onChange: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<LabelInput["kind"]>("Person");
  const [color, setColor] = useState("#355d39");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  function reset() { setEditing(null); setName(""); setKind("Person"); setColor("#355d39"); }
  const original = useRef<CalendarLabel | undefined>(undefined);
  function mutate(action: () => void, message: string, after: () => void) {
    commit(action, () => { onChange(); setError(""); setNotice(message); after(); }, error => { setError(error.message); setNotice(""); });
  }
  return <section aria-labelledby="labels-heading">
    <h2 id="labels-heading">People and categories</h2>
    <p>Create reusable labels for your events. Deleting a label keeps its events.</p>
    <ul className="label-list">{labels.map(label => <li key={label.id}>
      <span className="label-badge" style={{ backgroundColor: label.color, color: labelTextColor(label.color) }}>{label.kind}: {label.name}</span>{" "}
      <button type="button" aria-label={`Edit label ${label.name}`} onClick={() => {
        original.current = label; setEditing(label.id); setName(label.name); setKind(label.kind); setColor(label.color); setError(""); setNotice(""); nameInput.current?.focus();
      }}>Edit</button>{" "}
      <button type="button" aria-label={`Delete label ${label.name}`} onClick={() => {
        mutate(() => labelStore.delete(label.id, label), "Label deleted. Associated events kept.", () => { if (editing === label.id) reset(); });
      }}>Delete</button>
    </li>)}</ul>
    <h3>{editing ? "Edit label" : "Add label"}</h3>
    <form className="event-form" onSubmit={event => {
      event.preventDefault();
      mutate(() => {
        const input = { name, kind, color };
        if (editing) labelStore.update(editing, input, original.current); else labelStore.create(input);
      }, editing ? "Label updated." : "Label added.", reset);
    }}>
      <label>Label name <input id="label-name" ref={nameInput} required value={name} onChange={event => setName(event.target.value)} /></label>
      <label>Label type <select value={kind} onChange={event => setKind(event.target.value as LabelInput["kind"])}>
        <option>Person</option><option>Category</option>
      </select></label>
      <label>Label color <input type="color" value={color} onChange={event => setColor(event.target.value)} /></label>
      <button type="submit">{editing ? "Save label" : "Add label"}</button>
      {editing && <button type="button" onClick={() => { reset(); setError(""); }}>Cancel label edit</button>}
    </form>
    {error && <p role="alert">{error}</p>}
    <p role="status">{notice}</p>
  </section>;
}
