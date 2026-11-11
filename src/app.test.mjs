import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as events from "./events.ts";
import * as labels from "./labels.ts";
import * as calendar from "./calendar.ts";
import * as theme from "./theme.ts";
import * as dinners from "./dinners.ts";
import { serializeBackup } from "./backup.ts";

const require = createRequire(import.meta.url);

// Exercise the actual component handlers and rendered props without a DOM dependency.
// This harness does not verify browser layout, focus, or native dialog behavior.
function harness(file, dependencies, window = {}) {
  const state = [];
  let cursor = 0;
  let effects = [];
  const mounted = new Set();
  const cleanups = [];
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], next => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    // Run effects after the simulated commit; opt into mount subscriptions
    // when the test supplies event targets and timers.
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (dependencies === undefined) effects.push(effect);
      else if (window.runMountEffects && !mounted.has(index)) {
        mounted.add(index);
        effects.push(() => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); });
      }
    },
  };
  const output = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", "window", output)(name => {
    if (name === "react") return hooks;
    if (name === "./DinnerRoster") return { DinnerRoster() {} };
    if (name in dependencies) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected dependency ${name}`);
  }, exports, window);
  const Component = Object.values(exports)[0];
  return { unmount() { cleanups.forEach(cleanup => cleanup()); }, render(props = {}, commit = () => {}) {
    cursor = 0; effects = [];
    const tree = Component(props);
    commit(tree);
    effects.forEach(effect => effect());
    return tree;
  } };
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

test("export action is explicit, accessible and reports download or failure without storage writes", () => {
  const f = fixture([{ id: "saved", title: "Saved", date: "2024-01-01", recurrence: { frequency: "Daily" } }]);
  let calls = 0;
  f.dependencies["./backup"].downloadBackup = () => { calls++; };
  const app = f.app();
  const before = f.storage.getItem(events.EVENTS_STORAGE_KEY);
  const action = button(app.render(), "Export backup");
  assert.equal(calls, 0);
  assert.equal(action.props.type, "button");
  action.props.onClick();
  assert.equal(calls, 1);
  assert.ok(nodes(app.render(), node => node.props.role === "status" && text(node).includes("download requested")).length);
  f.dependencies["./backup"].downloadBackup = () => { throw new Error("denied"); };
  button(app.render(), "Export backup").props.onClick();
  assert.ok(nodes(app.render(), node => node.props.role === "alert" && text(node).includes("Saved data was not changed")).length);
  assert.equal(f.writes(), 0);
  assert.equal(f.storage.getItem(events.EVENTS_STORAGE_KEY), before);
});

test("monthly dates cover aligned Monday-first weeks, leap years, and year boundaries", () => {
  for (const [year, month, first, last, count] of [
    [2024, 1, "2024-01-29", "2024-03-03", 35],
    [2025, 1, "2025-01-27", "2025-03-02", 35],
    [2021, 1, "2021-02-01", "2021-02-28", 28],
    [2026, 2, "2026-02-23", "2026-04-05", 42],
    [2026, 11, "2026-11-30", "2027-01-03", 35],
  ]) {
    const grid = calendar.monthDays(new Date(year, month, 1));
    assert.equal(events.dateKey(grid[0]), first);
    assert.equal(events.dateKey(grid.at(-1)), last);
    assert.equal(grid.length, count);
    assert.equal(grid[0].getDay(), 1);
    assert.equal(grid.at(-1).getDay(), 0);
    for (let i = 1; i < grid.length; i++) {
      const next = new Date(grid[i - 1]);
      next.setDate(next.getDate() + 1);
      assert.equal(events.dateKey(grid[i]), events.dateKey(next));
    }
  }
  assert.ok(calendar.monthDays(new Date(2024, 1, 15)).some(date => events.dateKey(date) === "2024-02-29"));
  assert.ok(!calendar.monthDays(new Date(2025, 1, 15)).some(date => events.dateKey(date) === "2025-02-29"));
  assert.equal(events.dateKey(calendar.monthDays(new Date(2026, 0, 31), -1)[0]), "2025-12-01");
  assert.equal(events.dateKey(calendar.monthDays(new Date(2026, 11, 31), 1)[0]), "2026-12-28");
});

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
  const dependencies = { "./backup": { downloadBackup() {} }, "./events": { ...events, eventStore }, "./labels": { ...labels, labelStore }, "./calendar": calendar, "./LabelManager": { LabelManager() {} }, "./AppearanceSelector": { AppearanceSelector() {} } };
  const app = () => harness("./App.tsx", dependencies, { confirm(message) { prompts.push(message); return confirm; } });
  return { storage, eventStore, labelStore, prompts, app, dependencies,
    confirm: value => { confirm = value; }, fail: () => { failWrites = true; }, writes: () => writes };
}

test("month switching, navigation, event placement, editing and deletion share stored data", () => {
  const today = new Date();
  const date = events.dateKey(today);
  const adjacent = events.dateKey(calendar.monthDays(today)[0]);
  const f = fixture([
    { id: "plan", title: "Family plan", date, time: "14:30", notes: "Bring lunch\nAnd drinks", labelId: "person" },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `other-${index}`, title: `Other ${index}`, date })),
    { id: "adjacent", title: "Boundary plan", date: adjacent },
  ]);
  f.storage.setItem(labels.LABELS_STORAGE_KEY, JSON.stringify([{ id: "person", name: "Alex", kind: "Person", color: "#123456" }]));
  const app = f.app();
  button(app.render(), "Previous week").props.onClick();
  assert.match(text(nodes(app.render(), node => node.props.role === "status")[0]), /Week of/);
  button(app.render(), "Today: This week").props.onClick();
  button(app.render(), "Month").props.onClick();
  const monthly = () => section(app.render(), "monthly-calendar-heading");
  assert.equal(section(app.render(), "weekly-calendar-heading"), undefined);
  assert.equal(button(app.render(), "Month").props["aria-pressed"], true);
  const cells = nodes(monthly(), node => node.type === "li" && node.props.className?.startsWith("month-day"));
  assert.equal(cells.length % 7, 0);
  const todayCell = cells.find(cell => nodes(cell, node => node.type === "time" && node.props.dateTime === date).length);
  assert.equal(nodes(todayCell, node => node.props.className === "month-event").length, 13 + (adjacent === date ? 1 : 0));
  assert.match(text(todayCell), /14:30Family planPerson: Alex/);
  const badge = nodes(todayCell, node => node.props.className === "label-badge")[0];
  assert.equal(badge.props.style.backgroundColor, "#123456");
  assert.ok(button(monthly(), "Edit Boundary plan"));
  const heading = () => text(nodes(monthly(), node => node.type === "h2")[0]);
  const initialHeading = heading();
  for (let i = 0; i < 14; i++) button(monthly(), "Next month").props.onClick();
  const expected = new Date(today.getFullYear(), today.getMonth() + 14, 1);
  assert.equal(heading(), expected.toLocaleDateString("en-US", { month: "long", year: "numeric" }));
  button(monthly(), "Previous month").props.onClick();
  assert.notEqual(heading(), initialHeading);
  button(monthly(), "Today").props.onClick();
  assert.equal(heading(), initialHeading);
  button(monthly(), "Edit Family plan").props.onClick();
  assert.equal(field(app.render(), "Notes").props.value, "Bring lunch\nAnd drinks");
  assert.equal(field(app.render(), "Person or category").props.value, "person");
  assert.equal(field(app.render(), "Time").props.value, "14:30");
  change(field(app.render(), "Title"), "Updated plan");
  submit(section(app.render(), "manage-events-heading"));
  assert.ok(button(monthly(), "Edit Updated plan"));
  const saved = f.eventStore.list().find(event => event.id === "plan");
  assert.equal(saved.notes, "Bring lunch\nAnd drinks");
  assert.equal(saved.labelId, "person");
  button(app.render(), "Week").props.onClick();
  assert.ok(nodes(section(app.render(), "weekly-calendar-heading"), node => node.props["aria-current"] === "date").length);
  button(app.render(), "Month").props.onClick();
  f.confirm(true);
  button(monthly(), "Delete Updated plan").props.onClick();
  assert.equal(button(monthly(), "Edit Updated plan"), undefined);
  assert.equal(f.eventStore.list().some(event => event.id === "plan"), false);
  assert.equal(f.eventStore.list().length, 13);
});

test("three-month view shares the chosen month and navigates by three across years", () => {
  const app = fixture().app();
  button(app.render(), "Month").props.onClick();
  const today = new Date();
  // Start in December to exercise a range that crosses the year boundary.
  for (let i = today.getMonth(); i < 11; i++) button(app.render(), "Next month").props.onClick();
  button(app.render(), "3 Months").props.onClick();
  const three = () => section(app.render(), "three-month-calendar-heading");
  const monthHeadings = () => nodes(three(), node => node.type === "section" && node.props.className === "compact-month")
    .map(panel => text(nodes(panel, node => node.type === "h3")[0]));
  const title = (year, month) => new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  assert.equal(button(app.render(), "3 Months").props["aria-pressed"], true);
  assert.deepEqual(monthHeadings(), [title(today.getFullYear(), 11), title(today.getFullYear(), 12), title(today.getFullYear(), 13)]);
  button(three(), "Next 3 months").props.onClick();
  assert.deepEqual(monthHeadings(), [14, 15, 16].map(month => title(today.getFullYear(), month)));
  button(three(), "Previous 3 months").props.onClick();
  button(three(), "Previous 3 months").props.onClick();
  assert.deepEqual(monthHeadings(), [8, 9, 10].map(month => title(today.getFullYear(), month)));
  button(app.render(), "Month").props.onClick();
  assert.equal(text(nodes(section(app.render(), "monthly-calendar-heading"), node => node.type === "h2")[0]), title(today.getFullYear(), 8));
  button(app.render(), "3 Months").props.onClick();
  button(three(), "Today").props.onClick();
  assert.deepEqual(monthHeadings(), [0, 1, 2].map(offset => title(today.getFullYear(), today.getMonth() + offset)));
  assert.match(text(section(three(), "selected-day-heading")), new RegExp(events.dateKey(today)));
  button(app.render(), "Week").props.onClick();
  assert.ok(section(app.render(), "weekly-calendar-heading"));
});

test("three-month leap-day boundaries place each event once and retain only visible selections", () => {
  const f = fixture([
    { id: "before", title: "Outside range", date: "2024-01-31" },
    { id: "leap", title: "Leap day", date: "2024-02-29" },
    { id: "march", title: "March starts", date: "2024-03-01", time: "08:00" },
    { id: "last", title: "Last day", date: "2024-04-30" },
    { id: "after", title: "After range", date: "2024-05-01" },
  ]);
  const app = f.app();
  button(app.render(), "Month").props.onClick();
  const today = new Date();
  const offset = (2024 - today.getFullYear()) * 12 + 1 - today.getMonth();
  for (let i = 0; i < Math.abs(offset); i++) {
    button(app.render(), offset < 0 ? "Previous month" : "Next month").props.onClick();
  }
  button(app.render(), "3 Months").props.onClick();
  const three = () => section(app.render(), "three-month-calendar-heading");
  const controls = () => nodes(three(), node => node.props.className === "compact-date");
  const control = date => controls().find(node => nodes(node, child => child.type === "time" && child.props.dateTime === date).length);
  const detail = () => section(three(), "selected-day-heading");
  assert.equal(controls().length, 29 + 31 + 30);
  const dates = controls().map(node => nodes(node, child => child.type === "time")[0].props.dateTime);
  assert.equal(new Set(dates).size, dates.length);
  assert.equal(control("2024-01-31"), undefined);
  assert.equal(control("2024-05-01"), undefined);
  for (const [date, title] of [["2024-02-29", "Leap day"], ["2024-03-01", "March starts"], ["2024-04-30", "Last day"]]) {
    assert.match(control(date).props["aria-label"], /: 1 event$/);
    control(date).props.onClick();
    assert.ok(button(detail(), `Edit ${title}`));
    assert.equal(nodes(detail(), node => node.type === "li").length, 1);
  }
  button(app.render(), "3 Months").props.onClick();
  assert.equal(control("2024-04-30").props["aria-pressed"], true);
  button(app.render(), "Week").props.onClick();
  button(app.render(), "3 Months").props.onClick();
  assert.equal(control("2024-04-30").props["aria-pressed"], true);
  button(three(), "Next 3 months").props.onClick();
  assert.match(text(detail()), /2024-07-30/);
  button(three(), "Previous 3 months").props.onClick();
  assert.match(text(detail()), /2024-04-30/);
  button(app.render(), "Month").props.onClick();
  assert.match(text(section(app.render(), "monthly-calendar-heading")), /April 2024/);

});

test("compact dates keep overlapping events discoverable with colors, notes and shared CRUD", () => {
  const today = new Date();
  const dates = [0, 1, 2].map(offset => events.dateKey(new Date(today.getFullYear(), today.getMonth() + offset, 15)));
  const f = fixture([
    ...Array.from({ length: 15 }, (_, index) => ({ id: `overlap-${index}`, title: `Plan ${index}`, date: dates[0], time: "09:30", notes: "Keep\nthese notes", labelId: "person" })),
    { id: "next", title: "Next month plan", date: dates[1] },
    { id: "last", title: "Third month plan", date: dates[2] },
  ]);
  f.storage.setItem(labels.LABELS_STORAGE_KEY, JSON.stringify([{ id: "person", name: "Alex", kind: "Person", color: "#123456" }]));
  const app = f.app();
  button(app.render(), "3 Months").props.onClick();
  const three = () => section(app.render(), "three-month-calendar-heading");
  const dateButton = date => nodes(three(), node => node.type === "button" && node.props.className === "compact-date" && nodes(node, child => child.type === "time" && child.props.dateTime === date).length)[0];
  const detail = () => section(three(), "selected-day-heading");
  for (const [index, date] of dates.entries()) {
    const control = dateButton(date);
    assert.match(control.props["aria-label"], new RegExp(`${index === 0 ? 15 : 1} events?`));
    control.props.onClick();
    assert.equal(dateButton(date).props["aria-pressed"], true);
    assert.equal(nodes(detail(), node => node.type === "li").length, index === 0 ? 15 : 1);
    if (index === 0) {
      const dots = nodes(control, node => node.props.className === "event-dot");
      assert.equal(dots.length, 3);
      assert.ok(dots.every(dot => dot.props.style.backgroundColor === "#123456"));
      for (let i = 0; i < 15; i++) assert.ok(button(detail(), `Edit Plan ${i}`));
    }
  }
  dateButton(dates[0]).props.onClick();
  button(detail(), "Edit Plan 14").props.onClick();
  assert.equal(field(app.render(), "Notes").props.value, "Keep\nthese notes");
  assert.equal(field(app.render(), "Person or category").props.value, "person");
  assert.equal(field(app.render(), "Time").props.value, "09:30");
  change(field(app.render(), "Title"), "Revised plan");
  submit(section(app.render(), "manage-events-heading"));
  assert.ok(button(detail(), "Edit Revised plan"));
  const saved = events.createEventStore(() => f.storage).list().find(event => event.id === "overlap-14");
  assert.equal(saved.notes, "Keep\nthese notes");
  assert.equal(saved.labelId, "person");
  assert.equal(saved.time, "09:30");
  button(detail(), "Delete Revised plan").props.onClick();
  assert.ok(button(detail(), "Edit Revised plan"));
  f.confirm(true);
  button(detail(), "Delete Revised plan").props.onClick();
  assert.equal(button(detail(), "Edit Revised plan"), undefined);
  assert.match(dateButton(dates[0]).props["aria-label"], /14 events/);
  assert.equal(f.eventStore.list().length, 16);
});

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

test("appearance selector applies and persists all choices and restores them on reload", () => {
  const values = new Map();
  const root = { dataset: {} };
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = { localStorage: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  } };
  globalThis.document = { documentElement: root };
  try {
    const create = () => harness("./AppearanceSelector.tsx", { "./theme": theme });
    let app = create();
    assert.equal(field(app.render(), "Appearance").props.value, "system");
    assert.deepEqual(nodes(app.render(), node => node.type === "option").map(text), ["Light", "Dark", "System"]);
    for (const choice of ["dark", "light", "system"]) {
      change(field(app.render(), "Appearance"), choice);
      assert.equal(root.dataset.theme, choice);
      assert.equal(values.get(theme.THEME_STORAGE_KEY), choice);
      app = create();
      assert.equal(field(app.render(), "Appearance").props.value, choice);
      theme.applyTheme(theme.readTheme());
      assert.equal(root.dataset.theme, choice);
    }
    values.set(theme.THEME_STORAGE_KEY, "invalid");
    assert.equal(theme.readTheme(), "system");
    globalThis.window.localStorage.getItem = () => { throw new Error("blocked"); };
    assert.equal(theme.readTheme(), "system");
    globalThis.window.localStorage.setItem = () => { throw new Error("quota"); };
    change(field(app.render(), "Appearance"), "dark");
    assert.equal(root.dataset.theme, "dark");
    assert.equal(field(app.render(), "Appearance").props.value, "dark");
    assert.match(text(nodes(app.render(), node => node.props.role === "alert")[0]), /could not be saved/);
    globalThis.window.localStorage.setItem = () => {};
    change(field(app.render(), "Appearance"), "light");
    assert.equal(nodes(app.render(), node => node.props.role === "alert").length, 0);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test("theme palettes provide readable text, controls and selected navigation", () => {
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  const palettes = [...css.matchAll(/(?:^:root(?:\[data-theme="dark"\])?) \{([^}]+)\}/gm)]
    .map(match => Object.fromEntries([...match[1].matchAll(/--([\w-]+): (#[\da-f]+);/g)].map(value => [value[1], value[2]])));
  assert.equal(palettes.length, 2);
  const luminance = hex => {
    if (hex.length === 4) hex = "#" + [...hex.slice(1)].map(c => c + c).join("");
    return [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) => {
      const value = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return sum + weight * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    }, 0);
  };
  for (const palette of palettes) {
    for (const background of ["page", "surface", "accent-soft", "hover", "outside"]) {
      for (const foreground of ["text", "muted"]) {
        const values = [luminance(palette[background]), luminance(palette[foreground])].sort((a, b) => a - b);
        assert.ok((values[1] + 0.05) / (values[0] + 0.05) >= 4.5, `${foreground} on ${background}`);
      }
    }
    const values = [luminance(palette.accent), luminance(palette["on-accent"])].sort((a, b) => a - b);
    assert.ok((values[1] + 0.05) / (values[0] + 0.05) >= 4.5);
  }
  // System uses the live browser media query; explicit choices are excluded.
  assert.match(css, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\):not\(\[data-theme="dark"\]\)/);
});


test("recurrence form persists one series, edits the original anchor and deletes all occurrences", () => {
  const f = fixture();
  let app = f.app();
  change(field(app.render(), "Title"), "Monthly plan");
  change(field(app.render(), "Date"), "2024-01-31");
  change(field(app.render(), "Time"), "09:30");
  change(field(app.render(), "Notes"), "Keep\nnotes");
  change(field(app.render(), "Repeat"), "Monthly");
  change(field(app.render(), "Repeat until"), "2028-03-31");
  submit(section(app.render(), "manage-events-heading"));
  const saved = f.eventStore.list()[0];
  assert.equal(f.eventStore.list().length, 1);
  assert.deepEqual(saved.recurrence, { frequency: "Monthly", endDate: "2028-03-31" });
  app = f.app();
  button(app.render(), "Month").props.onClick();
  const today = new Date();
  const offset = (2024 - today.getFullYear()) * 12 + 1 - today.getMonth();
  for (let i = 0; i < Math.abs(offset); i++) button(app.render(), offset < 0 ? "Previous month" : "Next month").props.onClick();
  const month = section(app.render(), "monthly-calendar-heading");
  const leapDay = nodes(month, node => node.type === "li" && node.props.className?.startsWith("month-day") && nodes(node, child => child.type === "time" && child.props.dateTime === "2024-02-29").length)[0];
  button(leapDay, "Edit Monthly plan").props.onClick();
  assert.equal(field(app.render(), "Date").props.value, "2024-01-31");
  assert.equal(field(app.render(), "Repeat").props.value, "Monthly");
  assert.equal(field(app.render(), "Repeat until").props.value, "2028-03-31");
  assert.equal(field(app.render(), "Time").props.value, "09:30");
  change(field(app.render(), "Title"), "Revised series");
  f.confirm(true);
  submit(section(app.render(), "manage-events-heading"));
  assert.equal(f.eventStore.list()[0].id, saved.id);
  assert.equal(f.eventStore.list()[0].date, "2024-01-31");
  f.confirm(true);
  button(section(app.render(), "monthly-calendar-heading"), "Delete Revised series").props.onClick();
  assert.match(f.prompts.at(-1), /all occurrences/);
  assert.deepEqual(f.eventStore.list(), []);
});

test("invalid recurrence end date leaves saved data and form draft intact", () => {
  const f = fixture();
  const app = f.app();
  change(field(app.render(), "Title"), "Invalid plan");
  change(field(app.render(), "Date"), "2026-12-31");
  change(field(app.render(), "Repeat"), "Weekly");
  change(field(app.render(), "Repeat until"), "2026-12-30");
  submit(section(app.render(), "manage-events-heading"));
  assert.equal(f.writes(), 0);
  assert.equal(field(app.render(), "Title").props.value, "Invalid plan");
  assert.match(text(nodes(app.render(), node => node.props.role === "alert")[0]), /end date/);
  const end = field(app.render(), "Repeat until");
  assert.equal(end.props.value, "2026-12-30");
  assert.equal(end.props["aria-invalid"], true);
  assert.ok(end.props["aria-describedby"].includes("recurrence-end-error"));
  change(field(app.render(), "Repeat"), "Never");
  assert.equal(field(app.render(), "Repeat until"), undefined);
  submit(section(app.render(), "manage-events-heading"));
  assert.equal(f.eventStore.list()[0].recurrence, undefined);
});

for (const frequency of ["Never", "Daily", "Weekly", "Monthly", "Yearly"]) {
  for (const endDate of ["", "2028-12-31"]) {
    if (frequency === "Never" && endDate) continue;
    test(`create and reload ${frequency} with ${endDate || "no end date"} preserves details`, () => {
      const f = fixture();
      const label = f.labelStore.create({ name: "Family", kind: "Category", color: "#123456" });
      let app = f.app();
      assert.equal(field(app.render(), "Repeat").props.value, "Never");
      change(field(app.render(), "Title"), "Family plan");
      change(field(app.render(), "Date"), "2026-01-31");
      change(field(app.render(), "Time"), "18:45");
      change(field(app.render(), "Notes"), "First line\nSecond line");
      change(field(app.render(), "Person or category"), label.id);
      change(field(app.render(), "Repeat"), frequency);
      if (frequency !== "Never") change(field(app.render(), "Repeat until"), endDate);
      submit(section(app.render(), "manage-events-heading"));
      assert.equal(f.eventStore.list().length, 1);
      const saved = f.eventStore.list()[0];
      assert.deepEqual(saved.recurrence, frequency === "Never" ? undefined : { frequency, ...(endDate ? { endDate } : {}) });
      app = f.app();
      button(app.render(), "Edit Family plan").props.onClick();
      for (const [name, expected] of [["Title", "Family plan"], ["Date", "2026-01-31"], ["Time", "18:45"], ["Notes", "First line\nSecond line"], ["Person or category", label.id], ["Repeat", frequency]]) {
        assert.equal(field(app.render(), name).props.value, expected);
      }
      if (frequency !== "Never") assert.equal(field(app.render(), "Repeat until").props.value, endDate);
      assert.equal(f.labelStore.list()[0].color, "#123456");
    });
  }
}

test("series edit and delete confirmations cancel without writes and accepted edits replace all occurrences", () => {
  const date = events.dateKey(new Date());
  const original = { id: "series", title: "Original series", date, time: "08:15", notes: "Keep\nnotes", recurrence: { frequency: "Daily" } };
  const f = fixture([original, { id: "legacy", title: "Legacy", date }]);
  const app = f.app();
  let focused = 0;
  const trigger = { isConnected: true, focus() { focused++; } };
  button(app.render(), "Edit Original series").props.onClick({ currentTarget: trigger });
  change(field(app.render(), "Title"), "Changed series");
  change(field(app.render(), "Repeat"), "Weekly");
  const before = f.storage.getItem(events.EVENTS_STORAGE_KEY);
  submit(section(app.render(), "manage-events-heading"));
  assert.match(f.prompts.at(-1), /entire series "Original series".*All occurrences/);
  assert.equal(f.writes(), 0);
  assert.equal(f.storage.getItem(events.EVENTS_STORAGE_KEY), before);
  assert.equal(field(app.render(), "Title").props.value, "Changed series");
  button(app.render(), "Delete Original series").props.onClick();
  assert.match(f.prompts.at(-1), /all occurrences/);
  assert.equal(f.writes(), 0);
  f.confirm(true);
  submit(section(app.render(), "manage-events-heading"));
  app.render();
  assert.equal(focused, 1);
  assert.equal(f.eventStore.list().length, 2);
  const saved = f.eventStore.list().find(event => event.id === "series");
  assert.equal(saved.title, "Changed series");
  assert.equal(saved.notes, original.notes);
  assert.equal(saved.time, original.time);
  const reloaded = events.createEventStore(() => f.storage).list();
  assert.deepEqual(reloaded.find(event => event.id === saved.id), saved);
  assert.deepEqual(reloaded.find(event => event.id === "legacy"), { id: "legacy", title: "Legacy", date });
  const end = events.localDate(date); end.setDate(end.getDate() + 14);
  const occurrences = events.expandEvents([saved], date, events.dateKey(end));
  assert.equal(occurrences.length, 3);
  assert.equal(new Set(occurrences.map(event => `${event.id}:${event.date}`)).size, 3);
  button(app.render(), "Edit Changed series").props.onClick({ currentTarget: trigger });
  change(field(app.render(), "Repeat"), "Never");
  f.confirm(false);
  submit(section(app.render(), "manage-events-heading"));
  assert.equal(f.eventStore.list().find(event => event.id === "series").recurrence.frequency, "Weekly");
  button(app.render(), "Cancel").props.onClick();
  app.render();
  assert.equal(focused, 2);
  f.confirm(true);
  button(app.render(), "Delete Changed series").props.onClick();
  assert.deepEqual(f.eventStore.list(), [{ id: "legacy", title: "Legacy", date }]);
});

test("focus restoration checks removed occurrences after commit and clears stale edit triggers", () => {
  const date = events.dateKey(new Date());
  const f = fixture([{ id: "series", title: "Focus series", date, recurrence: { frequency: "Daily" } }]);
  const app = f.app();
  let titleFocus = 0;
  const attachTitle = tree => { field(tree, "Title").props.ref.current = { focus() { titleFocus++; } }; };
  app.render({}, attachTitle);
  const trigger = { isConnected: true, focus() { assert.fail("Removed occurrence must not receive focus"); } };
  button(app.render(), "Edit Focus series").props.onClick({ currentTarget: trigger });
  assert.equal(titleFocus, 1);
  change(field(app.render(), "Date"), "2035-01-01");
  f.confirm(true);
  submit(section(app.render(), "manage-events-heading"));
  assert.equal(titleFocus, 1);
  app.render({}, tree => { trigger.isConnected = false; attachTitle(tree); });
  assert.equal(titleFocus, 2);
  // A later create must focus its own form, even if the old trigger is connected.
  trigger.isConnected = true;
  change(field(app.render(), "Title"), "New event");
  submit(section(app.render(), "manage-events-heading"));
  app.render({}, attachTitle);
  assert.equal(titleFocus, 3);
});

for (const view of ["week", "month", "three-months", "upcoming"]) {
  test(`recurring ${view} entry preserves identity, inclusive end and whole-series actions`, () => {
    const date = events.dateKey(new Date());
    const original = { id: "series", title: "Repeating plan", date: "2000-01-01", time: "09:15", notes: "Series notes", recurrence: { frequency: "Daily", endDate: date } };
    const single = { id: "single", title: "Single plan", date };
    const f = fixture([original, single]);
    const app = f.app();
    if (view === "month") button(app.render(), "Month").props.onClick();
    if (view === "three-months") button(app.render(), "3 Months").props.onClick();
    const heading = { week: "weekly-calendar-heading", month: "monthly-calendar-heading", "three-months": "selected-day-heading", upcoming: "upcoming-events-heading" }[view];
    const displayed = () => section(app.render(), heading);
    const badges = nodes(displayed(), node => node.props.className === "recurrence-indicator");
    assert.ok(badges.length > 0);
    assert.ok(badges.every(badge => text(badge) === "Repeats daily"));
    assert.ok(button(displayed(), "Edit Single plan"));
    if (view === "upcoming" || view === "three-months") assert.equal(badges.length, 1);
    button(displayed(), "Edit Repeating plan").props.onClick();
    assert.equal(field(app.render(), "Date").props.value, original.date);
    assert.equal(field(app.render(), "Notes").props.value, original.notes);
    change(field(app.render(), "Title"), "Revised plan");
    f.confirm(true);
    submit(section(app.render(), "manage-events-heading"));
    assert.ok(button(displayed(), "Edit Revised plan"));
    assert.equal(button(displayed(), "Edit Repeating plan"), undefined);
    button(displayed(), "Delete Revised plan").props.onClick();
    assert.match(f.prompts.at(-1), /all occurrences/);
    assert.equal(button(displayed(), "Edit Revised plan"), undefined);
    assert.deepEqual(f.eventStore.list(), [single]);
  });
}

test("month and three-month navigation render clamped leap and month-end occurrences with selected-day counts", () => {
  const f = fixture([
    { id: "monthly", title: "Month end", date: "2024-01-31", recurrence: { frequency: "Monthly", endDate: "2025-03-31" } },
    { id: "yearly", title: "Leap anniversary", date: "2024-02-29", recurrence: { frequency: "Yearly", endDate: "2025-02-28" } },
  ]);
  const app = f.app();
  button(app.render(), "Month").props.onClick();
  const today = new Date();
  const offset = (2024 - today.getFullYear()) * 12 + 11 - today.getMonth();
  for (let i = 0; i < Math.abs(offset); i++) button(app.render(), offset < 0 ? "Previous month" : "Next month").props.onClick();
  for (const date of ["2024-12-31", "2025-01-31", "2025-02-28", "2025-03-31"]) {
    const month = section(app.render(), "monthly-calendar-heading");
    const cell = nodes(month, node => node.props.className?.startsWith("month-day") && nodes(node, child => child.type === "time" && child.props.dateTime === date).length)[0];
    assert.ok(button(cell, "Edit Month end"), date);
    if (date === "2025-02-28") assert.ok(button(cell, "Edit Leap anniversary"));
    button(app.render(), "Next month").props.onClick();
  }
  // April's grid retains March 31 as an adjacent date, but no April occurrence.
  assert.deepEqual(nodes(section(app.render(), "monthly-calendar-heading"), node => node.props.className === "month-event").map(node => nodes(node, child => child.type === "time")[0].props.dateTime), ["2025-03-31"]);
  button(app.render(), "Previous month").props.onClick();
  button(app.render(), "Previous month").props.onClick();
  button(app.render(), "3 Months").props.onClick();
  const day = nodes(app.render(), node => node.props.className === "compact-date" && node.props["aria-label"].startsWith("Friday, February 28, 2025"))[0];
  assert.match(day.props["aria-label"], /2 events/);
  day.props.onClick();
  const selected = section(app.render(), "selected-day-heading");
  assert.ok(button(selected, "Edit Month end"));
  assert.ok(button(selected, "Edit Leap anniversary"));
  button(app.render(), "Next 3 months").props.onClick();
  assert.equal(button(section(app.render(), "selected-day-heading"), "Edit Month end"), undefined);
});

test("upcoming recurrence expansion is bounded, inclusive, unique and ordered while distant singles remain", () => {
  const input = [
    { id: "daily", title: "Daily", date: "1900-01-01", time: "12:00", recurrence: { frequency: "Daily" } },
    { id: "end", title: "End", date: "2024-02-28", recurrence: { frequency: "Daily", endDate: "2024-02-29" } },
    { id: "single", title: "Distant", date: "2040-01-01" },
  ];
  const result = calendar.upcomingEvents(input, "2024-02-29");
  assert.equal(result.filter(event => event.id === "daily").length, 367);
  assert.equal(result.filter(event => event.id === "end").length, 1);
  assert.equal(result[0].id, "end");
  assert.equal(result.at(-1).id, "single");
  assert.equal(result.filter(event => event.id === "daily").at(-1).date, "2025-03-01");
  assert.equal(new Set(result.map(event => `${event.id}:${event.date}`)).size, result.length);
  assert.equal(input[0].date, "1900-01-01");
});


test("anchored local navigation reverses boundaries, clamping and repeated years across DST", () => {
  const oldTZ = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const key = state => events.dateKey(state.date);
    for (const year of [2023, 2024]) {
      let state = calendar.navigationDate(new Date(year, 0, 31));
      state = calendar.moveDate(state, 1, "month");
      assert.equal(key(state), `${year}-02-${year === 2024 ? 29 : 28}`);
      state = calendar.moveDate(state, 1, "month");
      assert.equal(key(state), `${year}-03-31`);
      state = calendar.moveDate(state, -2, "month");
      assert.equal(key(state), `${year}-01-31`);
      state = calendar.moveDate(state, -1, "month");
      assert.equal(key(state), `${year - 1}-12-31`);
      assert.equal(key(calendar.moveDate(state, 1, "month")), `${year}-01-31`);
    }
    let leap = calendar.navigationDate(new Date(2024, 1, 29));
    for (let year = 2025; year <= 2028; year++) {
      leap = calendar.moveDate(leap, 1, "year");
      assert.equal(key(leap), `${year}-02-${year === 2028 ? 29 : 28}`);
    }
    for (let i = 0; i < 4; i++) leap = calendar.moveDate(leap, -1, "year");
    assert.equal(key(leap), "2024-02-29");
    for (const [month, day, expectedHours] of [[2, 3, 167], [9, 27, 169]]) {
      const start = calendar.navigationDate(new Date(2024, month, day));
      const next = calendar.moveDate(start, 1, "week");
      assert.equal((next.date - start.date) / 3600000, expectedHours);
      assert.equal(key(calendar.moveDate(next, -1, "week")), key(start));
    }
    let state = calendar.navigationDate(new Date(2024, 0, 31));
    for (let i = 0; i < 48; i++) state = calendar.moveDate(state, 1, "month");
    for (let i = 0; i < 48; i++) state = calendar.moveDate(state, -1, "month");
    assert.equal(key(state), "2024-01-31");
  } finally { if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ; }
});

test("app fake clock refreshes midnight and resume without moving browsing, Today resets and unmount cleans up", t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2024, 0, 31, 23, 59, 59).getTime() });
  const previousDocument = globalThis.document;
  const listeners = new Map();
  const timers = new Map();
  let id = 0;
  const target = prefix => ({
    addEventListener(name, callback) { listeners.set(prefix + name, callback); },
    removeEventListener(name, callback) { assert.equal(listeners.get(prefix + name), callback); listeners.delete(prefix + name); },
  });
  globalThis.document = { ...target("document:"), visibilityState: "visible" };
  const host = { ...target("window:"), runMountEffects: true,
    setTimeout(callback, delay) { timers.set(++id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  try {
    const f = fixture();
    const app = harness("./App.tsx", f.dependencies, host);
    app.render();
    assert.equal([...timers.values()][0].delay, 1000);
    button(app.render(), "Month").props.onClick();
    button(app.render(), "Next month").props.onClick();
    const heading = () => text(nodes(app.render(), node => node.props.id === "monthly-calendar-heading")[0]);
    assert.equal(heading(), "February 2024");
    t.mock.timers.setTime(new Date(2024, 1, 1).getTime());
    [...timers.values()][0].callback();
    assert.equal(heading(), "February 2024");
    assert.deepEqual(nodes(app.render(), node => node.props["aria-current"] === "date").map(node => node.props.dateTime), ["2024-02-01"]);
    t.mock.timers.setTime(new Date(2024, 2, 5, 10).getTime());
    listeners.get("document:visibilitychange")();
    assert.equal(heading(), "February 2024");
    button(app.render(), "3 Months").props.onClick();
    assert.equal(nodes(app.render(), node => node.props["aria-current"] === "date")[0].props.dateTime, "2024-03-05");
    t.mock.timers.setTime(new Date(2024, 2, 6, 10).getTime());
    listeners.get("window:focus")();
    assert.equal(nodes(app.render(), node => node.props["aria-current"] === "date")[0].props.dateTime, "2024-03-06");
    t.mock.timers.setTime(new Date(2024, 3, 7, 10).getTime());
    button(app.render(), "Today").props.onClick();
    assert.match(text(section(app.render(), "selected-day-heading")), /2024-04-07/);
    button(app.render(), "Week").props.onClick();
    assert.equal(nodes(app.render(), node => node.props["aria-current"] === "date")[0].props.dateTime, "2024-04-07");
    assert.equal(f.writes(), 0);
    app.unmount();
    assert.equal(timers.size, 0);
    assert.equal(listeners.size, 0);
  } finally { globalThis.document = previousDocument; t.mock.timers.reset(); }
});


test("rendered month and week navigation share the retained month-end anchor", t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2023, 0, 31, 12).getTime() });
  try {
    const app = fixture().app();
    button(app.render(), "Month").props.onClick();
    button(app.render(), "Next month").props.onClick();
    button(app.render(), "3 Months").props.onClick();
    assert.match(text(section(app.render(), "selected-day-heading")), /2023-02-28/);
    assert.equal(nodes(app.render(), node => node.props.className === "compact-date" && node.props["aria-pressed"])[0].props["aria-label"].startsWith("Tuesday, February 28, 2023"), true);
    button(app.render(), "Month").props.onClick();
    button(app.render(), "Next month").props.onClick();
    button(app.render(), "3 Months").props.onClick();
    assert.match(text(section(app.render(), "selected-day-heading")), /2023-03-31/);
    button(app.render(), "Week").props.onClick();
    assert.match(text(section(app.render(), "weekly-calendar-heading")), /Mar 27, 2023/);
    button(app.render(), "Next week").props.onClick();
    button(app.render(), "3 Months").props.onClick();
    assert.match(text(section(app.render(), "selected-day-heading")), /2023-04-07/);
    button(app.render(), "Today").props.onClick();
    assert.match(text(section(app.render(), "selected-day-heading")), /2023-01-31/);
  } finally { t.mock.timers.reset(); }
});

test("midnight scheduling follows local DST days rather than 24-hour intervals", () => {
  const oldTZ = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    for (const [month, day, hours] of [[2, 10, 23], [10, 3, 25]]) {
      let delay;
      let refreshes = 0;
      const stop = calendar.watchToday(() => refreshes++, {
        now: () => new Date(2024, month, day),
        schedule: (_, value) => { delay = value; return 1; },
        cancel() {}, listen: () => () => {},
      });
      assert.equal(delay, hours * 3600000);
      assert.equal(refreshes, 1);
      stop();
    }
  } finally { if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ; }
});


test("cross-view roving date selection and focus cross year boundaries; editors retain native keys", t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2024, 11, 31, 12).getTime() });
  try {
    const app = fixture().app();
    const dates = tree => nodes(tree, node => node.props["data-calendar-date"]);
    let focused;
    const render = () => app.render({}, tree => dates(tree).forEach(node => node.props.ref({ focus() { focused = node.props["data-calendar-date"]; } })));
    for (const view of ["Week", "Month", "3 Months"]) {
      button(render(), view).props.onClick();
      let controls = dates(render());
      assert.equal(controls.filter(node => node.props.tabIndex === 0).length, 1);
      let selected = controls.find(node => node.props["aria-pressed"]);
      const source = {};
      let prevented = false;
      selected.props.onKeyDown({ key: "ArrowRight", target: source, currentTarget: source, preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
      controls = dates(render());
      assert.equal(focused, "2025-01-01");
      assert.equal(controls.find(node => node.props.tabIndex === 0).props["data-calendar-date"], focused);
      for (const key of [" ", "Enter", "n", "Tab"]) controls[0].props.onKeyDown({ key, target: source, currentTarget: source, preventDefault() { assert.fail(key); } });
      controls[0].props.onKeyDown({ key: "ArrowDown", target: {}, currentTarget: source, preventDefault() { assert.fail("nested editor"); } });
      button(render(), view === "Week" ? "Today: This week" : "Today").props.onClick();
      const tree = render();
      assert.equal(dates(tree).find(node => node.props.tabIndex === 0).props["data-calendar-date"], "2024-12-31");
      assert.equal(nodes(tree, node => node.props["aria-current"] === "date")[0].props.dateTime, "2024-12-31");
      assert.match(text(nodes(tree, node => node.props.role === "status")[0]), /Selected date Dec 31, 2024/);
      for (const label of ["Title", "Date", "Time", "Repeat", "Notes"]) assert.equal(field(tree, label).props.onKeyDown, undefined);
      const nav = nodes(tree, node => node.type === "nav" && node.props.className === "week-navigation")[0];
      assert.equal(nodes(nav, node => node.type === "button").length, 3);
      assert.ok(nodes(nav, node => node.type === "button").every(node => node.props.type === "button" && node.props.tabIndex === undefined && node.props.onKeyDown === undefined));
    }
  } finally { t.mock.timers.reset(); }
});


test("Astra repair: backward and reverse boundaries retain compact range, heading and one roving stop across views", t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2025, 0, 1, 12).getTime() });
  try {
    for (const view of ["Week", "Month"]) {
      for (const [keys, expected, range] of [
        [["ArrowLeft"], "2024-12-31", ["December 2024", "February 2025"]],
        [["ArrowLeft", "ArrowRight"], "2025-01-01", ["December 2024", "February 2025"]],
        [["ArrowUp"], "2024-12-25", ["December 2024", "February 2025"]],
        [["ArrowUp", "ArrowDown"], "2025-01-01", ["December 2024", "February 2025"]],
        [Array(13).fill("ArrowDown"), "2025-04-02", ["April 2025", "June 2025"]],
        [[...Array(13).fill("ArrowDown"), "ArrowUp"], "2025-03-26", ["March 2025", "May 2025"]],
      ]) {
        const app = fixture().app();
        const dates = tree => nodes(tree, node => node.props["data-calendar-date"]);
        let focused;
        const render = () => app.render({}, tree => dates(tree).forEach(node => node.props.ref({ focus() { focused = node.props["data-calendar-date"]; } })));
        button(render(), view).props.onClick();
        for (const key of keys) {
          const selected = dates(render()).find(node => node.props.tabIndex === 0);
          const target = {};
          selected.props.onKeyDown({ key, target, currentTarget: target, preventDefault() {} });
          render();
        }
        assert.equal(focused, expected); // Harness focus request, not native browser focus.
        for (const nextView of ["3 Months", "Month", "Week", "3 Months"]) {
          button(render(), nextView).props.onClick();
          const tree = render();
          const stops = dates(tree).filter(node => node.props.tabIndex === 0);
          assert.equal(stops.length, 1);
          assert.equal(stops[0].props["data-calendar-date"], expected);
          assert.equal(stops[0].props["aria-pressed"], true);
          assert.equal(button(tree, nextView).props["aria-pressed"], true);
          assert.equal(nodes(tree, node => ["grid", "gridcell", "row"].includes(node.props.role)).length, 0);
          if (nextView === "3 Months") {
            const heading = text(nodes(tree, node => node.props.id === "three-month-calendar-heading")[0]);
            assert.ok(heading.startsWith(range[0]) && heading.endsWith(range[1]), heading);
            assert.match(text(section(tree, "selected-day-heading")), new RegExp(expected));
          }
        }
      }
    }
  } finally { t.mock.timers.reset(); }
});

test("Today aligns displayed period, heading, selection and current date in every view", t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2025, 0, 1, 12).getTime() });
  try {
    for (const view of ["Week", "Month", "3 Months"]) {
      const app = fixture().app();
      button(app.render(), view).props.onClick();
      button(app.render(), view === "Week" ? "Next week" : view === "Month" ? "Next month" : "Next 3 months").props.onClick();
      button(app.render(), view === "Week" ? "Today: This week" : "Today").props.onClick();
      const tree = app.render();
      const stops = nodes(tree, node => node.props["data-calendar-date"] && node.props.tabIndex === 0);
      assert.equal(stops.length, 1);
      assert.equal(stops[0].props["data-calendar-date"], "2025-01-01");
      assert.equal(stops[0].props["aria-pressed"], true);
      assert.equal(nodes(stops[0], node => node.props["aria-current"] === "date")[0].props.dateTime, "2025-01-01");
      const status = text(nodes(tree, node => node.props.role === "status")[0]);
      assert.equal(status, `${view === "Week" ? "Week of Dec 30, 2024" : view === "Month" ? "January 2025" : "January 2025 through March 2025"}. Selected date Jan 1, 2025.`);
      const heading = text(nodes(tree, node => node.type === "h2")[0]);
      if (view === "Week") {
        assert.equal(heading, "This week");
        const week = text(section(tree, "weekly-calendar-heading"));
        assert.ok(week.includes("Dec 30, 2024") && week.includes("Jan 5, 2025"));
      } else if (view === "Month") assert.equal(heading, "January 2025");
      else {
        assert.ok(heading.startsWith("January 2025") && heading.endsWith("March 2025"));
        assert.match(text(section(tree, "selected-day-heading")), /2025-01-01/);
      }
    }
  } finally { t.mock.timers.reset(); }
});

test("later compact selection keeps range, heading and selected control consistent after period moves", t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2024, 1, 29, 12).getTime() });
  try {
    const app = fixture().app();
    button(app.render(), "3 Months").props.onClick();
    const selected = key => nodes(app.render(), node => node.props["data-calendar-date"] === key)[0];
    selected("2024-04-30").props.onClick();
    for (const [action, key, range] of [["Next 3 months", "2024-07-30", "May 2024"], ["Previous 3 months", "2024-04-30", "February 2024"]]) {
      button(app.render(), action).props.onClick();
      assert.equal(selected(key).props["aria-pressed"], true);
      assert.equal(selected(key).props.tabIndex, 0);
      assert.match(text(section(app.render(), "selected-day-heading")), new RegExp(key));
      assert.ok(text(nodes(app.render(), node => node.props.id === "three-month-calendar-heading")[0]).startsWith(range));
    }
    for (const view of ["Week", "Month", "3 Months"]) {
      button(app.render(), view).props.onClick();
      assert.equal(selected("2024-04-30").props["aria-pressed"], true);
      button(app.render(), view === "Week" ? "Today: This week" : "Today").props.onClick();
      assert.equal(selected("2024-02-29").props["aria-pressed"], true);
      const status = () => text(nodes(app.render(), node => node.props.role === "status")[0]);
      assert.match(status(), /Selected date Feb 29, 2024/);
      const before = status();
      change(field(app.render(), "Title"), "Unrelated draft");
      assert.equal(status(), before);
      // Return to the later date before switching views.
      if (view === "Week") { for (let i = 0; i < 9; i++) button(app.render(), "Next week").props.onClick(); }
      else if (view === "Month") { button(app.render(), "Next month").props.onClick(); button(app.render(), "Next month").props.onClick(); }
      const later = nodes(app.render(), node => node.props["data-calendar-date"] === "2024-04-30")[0];
      if (later) later.props.onClick();
    }
  } finally { t.mock.timers.reset(); }
});

test("dinner storage preserves weeks, reloads, unrelated data and malformed bytes", () => {
 const values = new Map([[events.EVENTS_STORAGE_KEY, "original"]]);
 const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
 const store = dinners.createDinnerStore(() => storage);
 assert.deepEqual(store.list(), {});
 const meal = { name: "Soup", cook: "Sam", notes: "Warm", ingredients: [{ name: "Carrots", amount: "2" }, { name: "Water" }] };
 store.save("2026-12-28", meal); store.save("2027-01-04", { name: "Pasta", ingredients: [] });
 assert.deepEqual(dinners.createDinnerStore(() => storage).list()["2026-12-28"], meal);
 store.save("2026-12-28", null); assert.equal(store.list()["2027-01-04"].name, "Pasta");
 for (const raw of ["{bad", "[]", "null", '{"2026-02-30":{"name":"X","ingredients":[]}}', '{"2026-01-01":{"name":"X","ingredients":[{}]}}']) {
  values.set(dinners.DINNERS_STORAGE_KEY, raw); assert.throws(() => store.list()); assert.throws(() => store.save("2026-01-01", meal)); assert.equal(values.get(dinners.DINNERS_STORAGE_KEY), raw);
 }
 assert.equal(values.get(events.EVENTS_STORAGE_KEY), "original");
 assert.throws(() => dinners.createDinnerStore(() => ({ getItem() { throw Error("denied"); }, setItem() {} })).list());
 assert.throws(() => dinners.createDinnerStore(() => ({ getItem() { return null; }, setItem() { throw Error("quota"); } })).save("2026-01-01", meal));
});

test("dinner weeks cross year, leap day and DST with local Monday-Sunday dates", () => {
 for (const [date, first, last] of [["2027-01-03", "2026-12-28", "2027-01-03"], ["2024-02-29", "2024-02-26", "2024-03-03"], ["2026-03-08", "2026-03-02", "2026-03-08"], ["2026-11-01", "2026-10-26", "2026-11-01"]]) {
  const days = calendar.weekDays(events.localDate(date)); assert.equal(days.length, 7); assert.equal(events.dateKey(days[0]), first); assert.equal(events.dateKey(days[6]), last);
  assert.equal(events.dateKey(calendar.weekDays(calendar.weekDays(days[0], 1)[0], -1)[0]), first);
 }
});

test("dinner form integration persists ingredients, navigates, reloads and removes", () => {
 const values = new Map();
 const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
 const store = dinners.createDinnerStore(() => storage);
 const mount = () => harness("./DinnerRoster.tsx", { "./events": events, "./calendar": calendar, "./dinners": { dinnerStore: store } }, { runMountEffects: true, addEventListener() {}, removeEventListener() {}, confirm: () => true });
 const app = mount(); app.render(); let tree = app.render();
 assert.equal(nodes(tree, n => n.type === "time").length, 7);
 assert.equal((text(tree).match(/No dinner planned/g) ?? []).length, 7);
 const date = events.dateKey(calendar.weekDays(new Date())[0]);
 button(tree, `Plan dinner for ${date}`).props.onClick({ currentTarget: { focus() {} } }); tree = app.render();
 change(field(tree, "Dinner name"), "Rice"); change(field(tree, "Cook /"), "Alex"); button(tree, "Add ingredient").props.onClick(); tree = app.render();
 const ingredientInputs = nodes(tree, n => n.type === "fieldset").flatMap(n => nodes(n, child => child.type === "input"));
 change(ingredientInputs[0], "Rice"); change(ingredientInputs[1], "1 cup"); submit(app.render());
 assert.equal(store.list()[date].ingredients[0].amount, "1 cup");
 button(app.render(), "Next dinner week").props.onClick(); assert.equal((text(app.render()).match(/No dinner planned/g) ?? []).length, 7);
 button(app.render(), "Previous dinner week").props.onClick(); assert.ok(button(app.render(), `Edit dinner for ${date}`));
 const reload = mount(); reload.render(); assert.ok(text(reload.render()).includes("Cook: Alex"));
 button(app.render(), "Next dinner week").props.onClick(); button(app.render(), "Today").props.onClick(); assert.ok(button(app.render(), `Edit dinner for ${date}`));
 button(app.render(), `Edit dinner for ${date}`).props.onClick({ currentTarget: { focus() {} } }); button(app.render(), "Remove dinner").props.onClick(); assert.deepEqual(store.list(), {});
 app.unmount(); reload.unmount();
});

test("dinner backup includes exact dated plans and refuses corruption without writes", () => {
 const plans = { "2026-11-10": { name: "? soup", notes: "Line one\nLine two", ingredients: [{ name: "?", amount: "2 cups" }] } };
 const storage = { getItem: key => key === dinners.DINNERS_STORAGE_KEY ? JSON.stringify(plans) : null };
 assert.deepEqual(JSON.parse(serializeBackup(storage)).dinners, plans);
 assert.throws(() => serializeBackup({ getItem: key => key === dinners.DINNERS_STORAGE_KEY ? "broken" : null }));
});

test("dinner accessibility structure labels native fields and reports storage failure", () => {
 const app = harness("./DinnerRoster.tsx", { "./events": events, "./calendar": calendar, "./dinners": { dinnerStore: { list() { throw Error("Storage unavailable"); }, save() { throw Error("quota"); } } } }, { runMountEffects: true, addEventListener() {}, removeEventListener() {} });
 app.render(); let tree = app.render();
 assert.equal(nodes(tree, n => n.props.role === "alert").length, 1);
 assert.equal(nodes(tree, n => n.type === "nav" && n.props["aria-label"] === "Dinner week navigation").length, 1);
 const action = nodes(tree, n => n.type === "button" && n.props["aria-label"]?.startsWith("Plan dinner"))[0];
 action.props.onClick({ currentTarget: { focus() {} } }); tree = app.render();
 assert.ok(field(tree, "Dinner name").props.required);
 assert.ok(field(tree, "Cook /")); assert.ok(field(tree, "Dinner notes"));
 assert.ok(nodes(tree, n => n.type === "form" && n.props["aria-label"].startsWith("Dinner for ")).length);
 change(field(tree, "Dinner name"), "Soup"); submit(app.render());
 tree = app.render(); assert.ok(text(tree).includes("Dinner could not be saved")); assert.equal(field(tree, "Dinner name").props.value, "Soup");
 button(tree, "Cancel dinner").props.onClick(); assert.equal(nodes(app.render(), n => n.type === "form").length, 0);
 app.unmount();
});
