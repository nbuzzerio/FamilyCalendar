import { useEffect, useRef, useState } from "react";
import { dateKey } from "./events";
import { weekDays } from "./calendar";
import { dinnerStore, parseIngredients, formatIngredients, type DinnerPlans } from "./dinners";

export function DinnerRoster() {
  const [anchor, setAnchor] = useState(() => new Date());
  const [plans, setPlans] = useState<DinnerPlans>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [cook, setCook] = useState("");
  const [notes, setNotes] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [nameError, setNameError] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  function refresh() {
    try { setPlans(dinnerStore.list()); setError(""); }
    catch (error) { setError((error as Error).message); }
  }
  useEffect(() => { refresh(); window.addEventListener("storage", refresh); return () => window.removeEventListener("storage", refresh); }, []);
  useEffect(() => {
    if (editing) { nameInput.current?.focus(); nameInput.current?.scrollIntoView({ block: "nearest" }); }
    else trigger.current?.focus();
  }, [editing]);
  const days = weekDays(anchor);
  function close() { setEditing(null); setNameError(false); setError(""); }
  function move(offset: number) { setAnchor(weekDays(anchor, offset)[0]); setNotice(""); }
  return <section className="dinner-roster" aria-labelledby="dinner-heading">
    <h2 id="dinner-heading">Dinner Roster</h2>
    <p>Plan dinner for each date. Plans stay on this browser.</p>
    <p aria-live="polite">{dateKey(days[0])} – {dateKey(days[6])}</p>
    <nav className="week-navigation" aria-label="Dinner week navigation">
      <button type="button" disabled={!!editing} onClick={() => move(-1)}>Previous dinner week</button>
      <button type="button" disabled={!!editing} onClick={() => { setAnchor(new Date()); setNotice(""); }}>Today</button>
      <button type="button" disabled={!!editing} onClick={() => move(1)}>Next dinner week</button>
    </nav>
    {error && <p role="alert">{error}</p>}
    <p role="status">{notice}</p>
    <ol className="dinner-days">{days.map(date => {
      const key = dateKey(date), dinner = plans[key];
      return <li key={key} className="day">
        <h3><time dateTime={key} aria-current={key === dateKey(new Date()) ? "date" : undefined}>{date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}</time></h3>
        {dinner ? <><h4>{dinner.name}</h4>{dinner.cook && <p>Cook: {dinner.cook}</p>}{dinner.notes && <p className="dinner-notes">{dinner.notes}</p>}
          {dinner.ingredients.length > 0 && <ul>{dinner.ingredients.map((item, index) => <li key={index}>{item.name}{item.amount ? ` — ${item.amount}` : ""}</li>)}</ul>}</> : <p>{error ? "Dinner plans unavailable" : "No dinner planned"}</p>}
        <button type="button" disabled={!!editing} aria-label={`${dinner ? "Edit" : "Plan"} dinner for ${key}`} onClick={event => {
          trigger.current = event.currentTarget; setEditing(key); setName(dinner?.name ?? ""); setCook(dinner?.cook ?? ""); setNotes(dinner?.notes ?? ""); setIngredients(formatIngredients(dinner?.ingredients ?? [])); setNotice(""); setNameError(false); setError("");
        }}>{dinner ? "Edit dinner" : "Plan dinner"}</button>
      </li>;
    })}</ol>
    {editing && <form className="dinner-form" aria-label={`Dinner for ${editing}`} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); close(); } }} onSubmit={event => {
      event.preventDefault();
      if (!name.trim()) { setNameError(true); setError("Enter a dinner name."); nameInput.current?.focus(); return; }
      setNameError(false);
      try { dinnerStore.save(editing, { name: name.trim(), ...(cook.trim() ? { cook: cook.trim() } : {}), ...(notes.trim() ? { notes } : {}), ingredients: ingredients === formatIngredients(plans[editing]?.ingredients ?? []) ? plans[editing]?.ingredients ?? [] : parseIngredients(ingredients) }); refresh(); setNotice(`Dinner saved for ${editing}: ${name.trim()}.`); close(); }
      catch { setError("Dinner could not be saved. Check the name, ingredients and browser storage. Saved data has been left unchanged."); }
    }}>
      <h3>Dinner for {editing}</h3>
      <p>Save or cancel this dinner before choosing another date or week. Escape cancels.</p>
      <label>Dinner name <input ref={nameInput} required aria-invalid={nameError || undefined} aria-describedby={nameError ? "dinner-name-error" : undefined} value={name} onChange={event => setName(event.target.value)} /></label>
      {nameError && <p id="dinner-name-error">Enter a nonblank dinner name.</p>}
      <label>Cook / person responsible (optional) <input value={cook} onChange={event => setCook(event.target.value)} /></label>
      <label>Dinner notes (optional) <textarea value={notes} onChange={event => setNotes(event.target.value)} /></label>
      <label>Ingredients (optional) <textarea rows={5} aria-describedby="dinner-ingredients-help" value={ingredients} onChange={event => setIngredients(event.target.value)} /></label>
      <p id="dinner-ingredients-help">Separate ingredients with commas or new lines. For a quantity, use Rice | 1 cup. Blank entries are ignored.</p>
      <div className="week-navigation"><button type="submit">Save dinner</button><button type="button" onClick={close}>Cancel dinner</button>
        {plans[editing] && <button type="button" onClick={() => {
          if (!window.confirm(`Remove dinner for ${editing}?`)) return;
          try { dinnerStore.save(editing, null); refresh(); setNotice(`Dinner removed for ${editing}.`); close(); }
          catch { setError("Dinner could not be removed. Saved data has been left unchanged."); }
        }}>Remove dinner</button>}</div>
    </form>}
  </section>;
}
