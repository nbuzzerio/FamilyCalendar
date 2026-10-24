import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as events from "./events.ts";
import * as labels from "./labels.ts";
import * as calendar from "./calendar.ts";

const require = createRequire(import.meta.url);

// Exercise the actual component handlers and rendered props without a DOM dependency.
// This harness does not verify browser layout, focus, or native dialog behavior.
function harness(file, dependencies, window = {}) {
  const state = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], next => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
    },
    useRef: () => ({ current: null }),
    useEffect: () => {},
  };
  const output = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", "window", output)(name => {
    if (name === "react") return hooks;
    if (name in dependencies) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected dependency ${name}`);
  }, exports, window);
  const Component = Object.values(exports)[0];
  return { render(props = {}) { cursor = 0; return Component(props); } };
}

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  if (!tree || typeof tree !== "object" || !tree.props) return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children, predicate)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  return tree?.props ? text(tree.props.children) : typeof tree === "string" ? tree : "";
}
const button = (tree, label) => nodes(tree, node => node.type === "button" && (node.props["aria-label"] ?? text(node)) === label)[0];
const section = (tree, heading) => nodes(tree, node => node.props["aria-labelledby"] === heading)[0];
const field = (tree, label) => nodes(nodes(tree, node => node.type === "label" && text(node).startsWith(label))[0], node => ["input", "select", "textarea"].includes(node.type))[0];
const change = (control, value) => control.props.onChange({ target: { value } });
const submit = tree => nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });

function fixture(initial = []) {
  const values = new Map([[events.EVENTS_STORAGE_KEY, JSON.stringify(initial)]]);
  let failWrites = false;
  let writes = 0;
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (failWrites) throw new Error("quota"); writes++; values.set(key, value); },
  };
  const eventStore = events.createEventStore(() => storage);
  const labelStore = labels.createLabelStore(() => storage);
  const prompts = [];
  let confirm = false;
  const dependencies = { "./events": { ...events, eventStore }, "./labels": { ...labels, labelStore }, "./calendar": calendar, "./LabelManager": { LabelManager() {} } };
  const app = () => harness("./App.tsx", dependencies, { confirm(message) { prompts.push(message); return confirm; } });
  return { storage, eventStore, labelStore, prompts, app, dependencies,
    confirm: value => { confirm = value; }, fail: () => { failWrites = true; }, writes: () => writes };
}

for (const view of ["weekly-calendar-heading", "upcoming-events-heading", "manage-events-heading"]) {
  test(`event deletion in ${view} requires confirmation and persists only on acceptance`, () => {
    const date = view === "manage-events-heading" ? "2000-01-01" : events.dateKey(new Date());
    const event = { id: "target", title: "Family picnic", date, notes: "Bring lunch\nMeet outside" };
    const other = { id: "other", title: "Keep me", date };
    const f = fixture([event, other]);
    const app = f.app();
    button(section(app.render(), view), "Edit Family picnic").props.onClick();
    const before = f.storage.getItem(events.EVENTS_STORAGE_KEY);
    button(section(app.render(), view), "Delete Family picnic").props.onClick();
    assert.equal(f.prompts.length, 1);
    assert.match(f.prompts[0], /Family picnic/);
    assert.equal(f.writes(), 0);
    assert.equal(f.storage.getItem(events.EVENTS_STORAGE_KEY), before);
    assert.equal(field(app.render(), "Notes").props.value, event.notes);
    assert.ok(button(app.render(), "Save event"));
    f.confirm(true);
    button(section(app.render(), view), "Delete Family picnic").props.onClick();
    assert.equal(f.writes(), 1);
    assert.deepEqual(events.createEventStore(() => f.storage).list(), [other]);
    assert.equal(button(f.app().render(), "Delete Family picnic"), undefined);
    assert.ok(button(app.render(), "Add event"));
    assert.equal(field(app.render(), "Notes").props.value, "");
    assert.match(text(app.render()), /Event deleted/);
  });
}

test("confirmed deletion reports storage failure without removing the event or edit draft", () => {
  const event = { id: "target", title: "Plan", date: events.dateKey(new Date()), notes: "Keep notes" };
  const f = fixture([event]);
  const app = f.app();
  button(app.render(), "Edit Plan").props.onClick();
  f.confirm(true);
  f.fail();
  button(app.render(), "Delete Plan").props.onClick();
  assert.deepEqual(f.eventStore.list(), [event]);
  assert.ok(button(app.render(), "Save event"));
  assert.equal(field(app.render(), "Notes").props.value, event.notes);
  assert.match(text(nodes(app.render(), node => node.props.role === "alert")[0]), /could not be saved/);
  assert.doesNotMatch(text(app.render()), /Event deleted/);
});

test("label and event forms integrate notes, dropdown selection, color edits, reloads, and legacy data", () => {
  const legacy = { id: "legacy", title: "Old event", date: events.dateKey(new Date()) };
  const f = fixture([legacy]);
  let app;
  const manager = harness("./LabelManager.tsx", { "./labels": f.dependencies["./labels"] });
  const managerTree = () => manager.render({ labels: f.labelStore.list(), onChange() {
    if (app) nodes(app.render(), node => node.type === f.dependencies["./LabelManager"].LabelManager)[0].props.onChange();
  } });
  change(field(managerTree(), "Label name"), "Alex");
  change(field(managerTree(), "Label type"), "Person");
  change(field(managerTree(), "Label color"), "#123456");
  submit(managerTree());
  change(field(managerTree(), "Label name"), "School");
  change(field(managerTree(), "Label type"), "Category");
  change(field(managerTree(), "Label color"), "#ffee00");
  submit(managerTree());
  const person = f.labelStore.list().find(label => label.name === "Alex");
  const category = f.labelStore.list().find(label => label.name === "School");
  app = f.app();
  assert.match(text(field(app.render(), "Person or category")), /Person: AlexCategory: School/);
  change(field(app.render(), "Title"), "New plan");
  change(field(app.render(), "Notes"), "Line one\nLine two");
  change(field(app.render(), "Person or category"), person.id);
  submit(section(app.render(), "manage-events-heading"));
  app = f.app(); // Simulate a page reload from the same local storage.
  const event = f.eventStore.list().find(item => item.title === "New plan");
  assert.equal(event.notes, "Line one\nLine two");
  assert.equal(event.labelId, person.id);
  const disclosure = nodes(app.render(), node => node.type === "details")[0];
  assert.equal(disclosure.props.open, undefined);
  assert.match(text(disclosure), /Line one\nLine two/);
  button(app.render(), "Edit New plan").props.onClick();
  assert.equal(field(app.render(), "Person or category").props.value, person.id);
  assert.equal(field(app.render(), "Notes").props.value, event.notes);
  change(field(app.render(), "Person or category"), category.id);
  change(field(app.render(), "Notes"), "Revised\nNotes");
  submit(section(app.render(), "manage-events-heading"));
  button(managerTree(), "Edit label School").props.onClick();
  change(field(managerTree(), "Label name"), "Classes");
  change(field(managerTree(), "Label color"), "#ffffff");
  submit(managerTree());
  const badges = nodes(app.render(), node => node.props.className === "label-badge");
  assert.ok(badges.length >= 2); // Weekly and upcoming views.
  for (const badge of badges) {
    assert.equal(text(badge), "Category: Classes");
    assert.equal(badge.props.style.backgroundColor, "#ffffff");
    assert.equal(badge.props.style.color, "#000000");
  }
  button(managerTree(), "Delete label Classes").props.onClick();
  assert.ok(button(app.render(), "Edit New plan"));
  assert.equal(nodes(app.render(), node => node.props.className === "label-badge").length, 0);
  button(app.render(), "Edit New plan").props.onClick();
  assert.equal(field(app.render(), "Person or category").props.value, "");
  assert.equal(field(app.render(), "Notes").props.value, "Revised\nNotes");
  submit(section(app.render(), "manage-events-heading"));
  const reloaded = events.createEventStore(() => f.storage).list();
  assert.equal(reloaded.find(item => item.id === event.id).labelId, undefined);
  assert.deepEqual(reloaded.find(item => item.id === legacy.id), legacy);
});
