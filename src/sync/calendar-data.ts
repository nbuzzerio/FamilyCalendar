import { isEvent, type CalendarEvent, type EventInput } from "../events";
import { isLabel, type CalendarLabel, type LabelInput } from "../labels";
import { groceryItems, isDinner, type Dinner, type DinnerPlans, type GroceryChecks } from "../dinners";
import { weekDays } from "../calendar";
import { dateKey, localDate } from "../events";
import { type Availability, type RollCall } from "../rollCall";
import { access, view, type Draft } from "./database";
import { enqueue, keyOf, localProblem, rowFor, same, wireId, type Link, type Row, type Value } from "./model";

let editing: Draft | undefined;
function active() { return editing ?? view; }
/** Run domain commands synchronously inside the same IndexedDB transaction as their outbox writes. */
export function commit<T>(edit: () => T, saved: (result: T) => void, failed: (error: Error) => void) {
  void access("readwrite", draft => {
    editing = draft;
    try { return edit(); } finally { editing = undefined; }
  }, true).then(saved, failed);
}
export function editRow(d: Draft, kind: string, id: string, value: Value | null, people?: Link[]) {
  const row = d.rows.get(keyOf(kind, id)) ?? rowFor(kind, id, null);
  if (same(row.value, value) && (!people || same(people, row.people))) return;
  if (row.value && value === null) d.archive("Before local removal", row);
  row.value = value; row.revision++;
  if (people) row.people = people;
  d.settings.localRevision++; d.settings.caughtUp = false;
  if (row.deferred) d.archive("Earlier held local edit", row.deferred);
  if (d.settings.phase !== "ready" || localProblem(row)) {
    row.deferred = { id: crypto.randomUUID(), value: structuredClone(value), people: structuredClone(row.people) };
  } else { delete row.deferred; enqueue(row); }
  d.put(row);
}
function write(kind: string, id: string, value: Value | null, people?: Link[]) {
  if (!editing) throw Error("Calendar save requires a storage transaction.");
  editRow(editing, kind, id, value, people);
}
/** Replace an incompatible, never-shared identifier only after an explicit review. */
export function correctId(expected: Row, id: string) {
  return access("readwrite", d => {
    const row = d.rows.get(expected.key);
    if (!row?.value || !same(row,expected) || !["event","label"].includes(row.kind) || wireId(row.id) || row.server || row.queue.length || row.hold || row.conflict) throw Error("This entry needs a fresh review.");
    if (!wireId(id) || d.rows.has(keyOf(row.kind,id))) throw Error("Enter an unused ID beginning with a letter or digit. Use up to 160 letters, digits, periods, underscores, colons or hyphens.");
    d.archive("Before correcting historical ID", row);
    if (row.kind === "label") {
      const mappings = new Map(d.settings.mappings);
      if (mappings.has(id)) throw Error("That ID already belongs to a historical Person label.");
      const person = mappings.get(row.id);
      if (person) { mappings.delete(row.id); mappings.set(id,person); d.settings.mappings = [...mappings]; }
      for (const item of [...d.rows.values()]) {
        if (item.kind === "event" && item.value?.labelId === id) throw Error("That ID already has historical event references.");
        if (item.kind === "event" && item.value?.labelId === row.id) editRow(d,"event",item.id,{ ...item.value,labelId:id });
        if (item.kind === "legacy-attendance" && item.id.slice(11) === id) throw Error("That ID has existing attendance history.");
        if (item.kind === "legacy-attendance" && item.id.slice(11) === row.id) {
          const next = item.id.slice(0,11) + id;
          d.remove(item.key); d.put({ ...item, key:keyOf(item.kind,next), id:next });
        }
      }
    }
    d.remove(row.key); editRow(d,row.kind,id,{ ...row.value,id },row.people);
  }, true);
}
function fromKind<T>(kind: string): [string, T][] {
  return [...active().rows.values()].filter(r => r.kind === kind && r.value).map(r => [r.id, r.value as T]);
}
function assertOriginal(kind: string, id: string, original: unknown) {
  if (original !== undefined && !same(active().rows.get(keyOf(kind, id))?.value ?? null, original)) throw Error("This entry changed while you were editing. Your draft is open. Reopen the entry to review the latest version.");
}
function preserveExtras(prior: Value | null | undefined, known: string[], input: object): Value {
  return { ...Object.fromEntries(Object.entries(prior ?? {}).filter(([k]) => !known.includes(k))), ...input };
}
function saveEvent(id: string, input: EventInput, original?: CalendarEvent) {
  assertOriginal("event", id, original);
  const value = preserveExtras(active().rows.get(keyOf("event", id))?.value,
    ["title","date","notes","recurrence","time","labelId"], { ...input, title: input.title.trim(), id });
  if (!value.notes) delete value.notes;
  if (!isEvent(value)) throw Error("Enter a valid title, date, time and repeat rule.");
  write("event", id, value);
}
export const eventStore = {
  list: () => fromKind<CalendarEvent>("event").map(([,v]) => v).sort((a,b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title)),
  create: (input: EventInput) => saveEvent(crypto.randomUUID(), input),
  update: saveEvent,
  delete(id: string, original?: CalendarEvent) { assertOriginal("event", id, original); write("event", id, null); },
};
function saveLabel(id: string, input: LabelInput, original?: CalendarLabel) {
  assertOriginal("label", id, original);
  const row = active().rows.get(keyOf("label", id));
  const value = { ...row?.value, ...input, id, name: input.name.trim() };
  if (!isLabel(value)) throw Error("Enter a name, label type and valid color.");
  const links = row?.people.filter(p => p.role !== "label-person") ?? [];
  const personId = new Map(active().settings.mappings).get(id);
  if (input.kind === "Person" && personId) links.push({ personId, role: "label-person" });
  write("label", id, value, links);
}
export const labelStore = {
  list: () => fromKind<CalendarLabel>("label").map(([,v]) => v).sort((a,b) => a.name.localeCompare(b.name)),
  create: (input: LabelInput) => saveLabel(crypto.randomUUID(), input),
  update: saveLabel,
  delete(id: string, original?: CalendarLabel) { assertOriginal("label", id, original); write("label", id, null); },
};
export const dinnerStore = {
  list: (): DinnerPlans => Object.fromEntries(fromKind<Dinner>("dinner-plan")),
  save(date: string, dinner: Dinner | null, original?: Dinner | null) {
    assertOriginal("dinner-plan", date, original);
    if (dinner && !isDinner(dinner)) throw Error("Enter a dinner name and valid ingredients.");
    const prior = active().rows.get(keyOf("dinner-plan", date))?.value;
    if (dinner && isDinner(prior) && !same(dinner.ingredients,prior.ingredients)) {
      const unmatched = [...prior.ingredients];
      dinner = { ...dinner, ingredients: dinner.ingredients.map(item => {
        const matches = unmatched.filter(old => old.name === item.name);
        const old = matches.find(old => old.amount === item.amount) ?? (matches.length === 1 ? matches[0] : undefined);
        if (old) unmatched.splice(unmatched.indexOf(old),1);
        return preserveExtras(old as unknown as Value, ["name","amount"], item) as unknown as typeof item;
      }) };
      if (unmatched.some(item => Object.keys(item).some(k => k !== "name" && k !== "amount"))) {
        editing!.archive("Original ingredient metadata before dinner edit", { date, dinner:prior });
      }
    }
    write("dinner-plan", date, dinner && preserveExtras(prior, ["name","cook","notes","ingredients"], dinner));
    if (isDinner(prior) && !active().settings.partialPage && ["ready","local"].includes(active().settings.phase)) {
      const dates = weekDays(localDate(date)).map(dateKey), week = dates[0];
      const row = active().rows.get(keyOf("grocery-checks",week));
      if (row?.value && Array.isArray(row.value.checked)) {
        const available = new Set(groceryItems(dinnerStore.list(),dates).map(item => item.key));
        const removed = new Set(prior.ingredients.map(i => i.name.trim().toLowerCase()).filter(key => !available.has(key)));
        const checked = row.value.checked.filter(key => !removed.has(key));
        if (checked.length !== row.value.checked.length) write("grocery-checks",week,{ ...row.value, checked });
      }
    }
  },
};
function checks(): GroceryChecks {
  return Object.fromEntries(fromKind<{checked:string[]}>("grocery-checks").map(([week, value]) => [week, value.checked]));
}
export const groceryStore = {
  // Project only rows derived from the displayed dinners. Loading a partial week never changes stored checks.
  reconcile: (_plans: DinnerPlans) => checks(),
  setChecked(_plans: DinnerPlans, week: string, key: string, checked: boolean) {
    const row = active().rows.get(keyOf("grocery-checks", week));
    const keys = new Set(checks()[week] ?? []);
    if (checked) keys.add(key); else keys.delete(key);
    write("grocery-checks", week, { ...row?.value, checked: [...keys] });
    return checks();
  },
};
function rollCall(): RollCall {
  const saved: RollCall = Object.create(null);
  for (const row of active().rows.values()) {
    if (!row.value || !["legacy-attendance","roll-call"].includes(row.kind)) continue;
    const date = row.id.slice(0,10), person = row.id.slice(11);
    const labels = row.kind === "legacy-attendance" ? [person] : active().settings.mappings.filter(([,p]) => p === person).map(([id]) => id);
    for (const label of labels) (saved[date] ??= Object.create(null))[label] = row.value.availability as Availability;
  }
  return saved;
}
export const rollCallStore = {
  list: rollCall,
  save(date: string, label: string, state: Availability | null) {
    const person = new Map(active().settings.mappings).get(label);
    const id = date + ":" + (person ?? label), kind = person ? "roll-call" : "legacy-attendance";
    const row = active().rows.get(keyOf(kind, id));
    write(kind, id, state && { ...row?.value, availability: state }, person ? [...(row?.people.filter(p => p.role !== "attendee") ?? []), { personId: person, role: "attendee" }] : []);
    return rollCall();
  },
};
