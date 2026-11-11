import { useEffect, useRef, useState } from "react";
import { dateKey } from "./events";
import { weekDays } from "./calendar";
import { dinnerStore, type DinnerPlans, type Ingredient } from "./dinners";

export function DinnerRoster() {
  const [anchor, setAnchor] = useState(() => new Date());
  const [plans, setPlans] = useState<DinnerPlans>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [cook, setCook] = useState("");
  const [notes, setNotes] = useState("");
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const nameInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  function refresh() {
    try { setPlans(dinnerStore.list()); setError(""); }
    catch (error) { setError((error as Error).message); }
  }
  useEffect(() => { refresh(); window.addEventListener("storage", refresh); return () => window.removeEventListener("storage", refresh); }, []);
  useEffect(() => { if (editing) nameInput.current?.focus(); }, [editing]);
  const days = weekDays(anchor);
  function close() { setEditing(null); trigger.current?.focus(); }
  function move(offset: number) { setAnchor(weekDays(anchor, offset)[0]); setNotice(""); }
  return <section className="dinner-roster" aria-labelledby="dinner-heading">
    <h2 id="dinner-heading">Dinner Roster</h2>
    <p>Plan dinner for each date. Plans stay on this browser.</p>
    <p aria-live="polite">{dateKey(days[0])} – {dateKey(days[6])}</p>
    <nav className="week-navigation" aria-label="Dinner week navigation">
      <button type="button" onClick={() => move(-1)}>Previous dinner week</button>
      <button type="button" onClick={() => { setAnchor(new Date()); setNotice(""); }}>Today</button>
      <button type="button" onClick={() => move(1)}>Next dinner week</button>
    </nav>
    {error && <p role="alert">{error}</p>}
    <p role="status">{notice}</p>
    <ol className="dinner-days">{days.map(date => {
      const key = dateKey(date), dinner = plans[key];
      return <li key={key} className="day">
        <h3><time dateTime={key} aria-current={key === dateKey(new Date()) ? "date" : undefined}>{date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}</time></h3>
        {dinner ? <><h4>{dinner.name}</h4>{dinner.cook && <p>Cook: {dinner.cook}</p>}{dinner.notes && <p className="dinner-notes">{dinner.notes}</p>}
          {dinner.ingredients.length > 0 && <ul>{dinner.ingredients.map((item, index) => <li key={index}>{item.name}{item.amount ? ` — ${item.amount}` : ""}</li>)}</ul>}</> : <p>{error ? "Dinner plans unavailable" : "No dinner planned"}</p>}
        <button type="button" aria-label={`${dinner ? "Edit" : "Plan"} dinner for ${key}`} onClick={event => {
          trigger.current = event.currentTarget; setEditing(key); setName(dinner?.name ?? ""); setCook(dinner?.cook ?? ""); setNotes(dinner?.notes ?? ""); setIngredients(dinner?.ingredients.map(item => ({ ...item })) ?? []); setNotice("");
        }}>{dinner ? "Edit dinner" : "Plan dinner"}</button>
      </li>;
    })}</ol>
    {editing && <form className="dinner-form" aria-label={`Dinner for ${editing}`} onSubmit={event => {
      event.preventDefault();
      try { dinnerStore.save(editing, { name: name.trim(), ...(cook.trim() ? { cook: cook.trim() } : {}), ...(notes.trim() ? { notes } : {}), ingredients: ingredients.map(item => ({ name: item.name.trim(), ...(item.amount?.trim() ? { amount: item.amount.trim() } : {}) })) }); refresh(); setNotice(`Dinner saved for ${editing}.`); close(); }
      catch { setError("Dinner could not be saved. Check the name, ingredients and browser storage. Saved data has been left unchanged."); }
    }}>
      <h3>Dinner for {editing}</h3>
      <label>Dinner name <input ref={nameInput} required value={name} onChange={event => setName(event.target.value)} /></label>
      <label>Cook / person responsible (optional) <input value={cook} onChange={event => setCook(event.target.value)} /></label>
      <label>Dinner notes (optional) <textarea value={notes} onChange={event => setNotes(event.target.value)} /></label>
      <fieldset><legend>Ingredients (optional)</legend>
        {ingredients.map((item, index) => <div key={index} className="ingredient-row">
          <label>Ingredient {index + 1} name <input required value={item.name} onChange={event => setIngredients(items => items.map((old, i) => i === index ? { ...old, name: event.target.value } : old))} /></label>
          <label>Ingredient {index + 1} amount (optional) <input value={item.amount ?? ""} onChange={event => setIngredients(items => items.map((old, i) => i === index ? { ...old, amount: event.target.value } : old))} /></label>
          <button type="button" onClick={() => setIngredients(items => items.filter((_, i) => i !== index))}>Remove ingredient {index + 1}</button>
        </div>)}
        <button type="button" onClick={() => setIngredients(items => [...items, { name: "" }])}>Add ingredient</button>
      </fieldset>
      <div className="week-navigation"><button type="submit">Save dinner</button><button type="button" onClick={close}>Cancel dinner</button>
        {plans[editing] && <button type="button" onClick={() => {
          if (!window.confirm(`Remove dinner for ${editing}?`)) return;
          try { dinnerStore.save(editing, null); refresh(); setNotice(`Dinner removed for ${editing}.`); close(); }
          catch { setError("Dinner could not be removed. Saved data has been left unchanged."); }
        }}>Remove dinner</button>}</div>
    </form>}
  </section>;
}
