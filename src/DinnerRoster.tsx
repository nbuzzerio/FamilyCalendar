import { useEffect, useRef, useState } from "react";
import { dateKey } from "./events";
import { weekDays } from "./calendar";
import { DinnerRollCall } from "./DinnerRollCall";
import type { CalendarLabel } from "./labels";
import { dinnerStore, groceryStore, groceryItems, parseIngredients, formatIngredients, type DinnerPlans, type GroceryChecks } from "./dinners";

export function DinnerRoster({ labels = [] }: { labels?: CalendarLabel[] }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [plans, setPlans] = useState<DinnerPlans>({});
  const [checks, setChecks] = useState<GroceryChecks>({});
  const [groceryError, setGroceryError] = useState("");
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
    try {
      const saved = dinnerStore.list(); setPlans(saved); setError("");
      try { setChecks(groceryStore.reconcile(saved)); setGroceryError(""); }
      catch { setChecks({}); setGroceryError("Grocery checkmarks could not be loaded or updated. Saved dinners are unchanged. Check browser storage and reload to retry."); }
    }
    catch (error) { setError((error as Error).message); }
  }
  useEffect(() => { refresh(); window.addEventListener("storage", refresh); return () => window.removeEventListener("storage", refresh); }, []);
  useEffect(() => {
    if (editing) { nameInput.current?.focus(); nameInput.current?.scrollIntoView({ block: "nearest" }); }
    else trigger.current?.focus();
  }, [editing]);
  const days = weekDays(anchor);
  const week = dateKey(days[0]);
  const groceries = groceryItems(plans, days.map(dateKey));
  function close() { setEditing(null); setNameError(false); setError(""); }
  function move(offset: number) { setAnchor(weekDays(anchor, offset)[0]); setNotice(""); }
  return <section className="dinner-roster" aria-labelledby="dinner-heading">
    <h2 id="dinner-heading">Dinner Roster</h2>
    <p>Plan dinner for each date. Plans stay on this browser.</p>
    <p aria-live="polite">{dateKey(days[0])} – {dateKey(days[6])}</p>
    <nav className="week-navigation" aria-label="Dinner week navigation">
      <button type="button" disabled={!!editing} onClick={() => move(-1)}>Previous dinner week</button>
      <button type="button" disabled={!!editing} onClick={() => { setAnchor(new Date()); setNotice(""); }}>Current dinner week</button>
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
    <DinnerRollCall days={days} labels={labels} />
    <section className="grocery-checklist" aria-labelledby="grocery-heading">
      <h3 id="grocery-heading">Grocery checklist</h3>
      <p>For dinner week {week} through {dateKey(days[6])}. Amounts are listed per day, without combining units.</p>
      {groceryError && <p role="alert">{groceryError}</p>}
      {error ? <p>Grocery checklist unavailable until dinner plans can be read.</p> : groceries.length ? <ul>{groceries.map(item =>
        <li key={item.key}>
          <label><input type="checkbox" checked={(checks[week] ?? []).includes(item.key)} disabled={!!groceryError} onChange={event => {
            try {
              const saved = dinnerStore.list();
              setChecks(groceryStore.setChecked(saved, week, item.key, event.target.checked));
              setGroceryError("");
            } catch { setGroceryError("Grocery checkmark could not be saved. Saved dinners are unchanged. Reload to retry."); }
          }} /> {item.name}<span className="visually-hidden"> for dinner week {week}</span></label>
          <ul>{item.entries.map((entry, index) => <li key={index}><time dateTime={entry.date}>{entry.date}</time>: {entry.amount}</li>)}</ul>
        </li>)}</ul> : <p>No groceries for this week. Add ingredients to a dinner to start your checklist.</p>}
    </section>
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
