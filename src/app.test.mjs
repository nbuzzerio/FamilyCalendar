import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as events from "./events.ts";
import * as labels from "./labels.ts";
import * as calendar from "./calendar.ts";
import * as theme from "./theme.ts";

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
  const dependencies = { "./events": { ...events, eventStore }, "./labels": { ...labels, labelStore }, "./calendar": calendar, "./LabelManager": { LabelManager() {} }, "./AppearanceSelector": { AppearanceSelector() {} } };
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
  const weekText = text(section(app.render(), "weekly-calendar-heading"));
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
  assert.equal(text(section(app.render(), "weekly-calendar-heading")), weekText);
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
  assert.match(text(detail()), /2024-05-01/);
  assert.ok(button(detail(), "Edit After range"));
  button(three(), "Previous 3 months").props.onClick();
  assert.match(text(detail()), /2024-02-01No events scheduled/);
  button(app.render(), "Month").props.onClick();
  button(app.render(), "Previous month").props.onClick();
  button(app.render(), "3 Months").props.onClick();
  // February 1 is still visible in January–March.
  assert.equal(control("2024-02-01").props["aria-pressed"], true);
  button(app.render(), "Month").props.onClick();
  for (let i = 0; i < 3; i++) button(app.render(), "Next month").props.onClick();
  button(app.render(), "3 Months").props.onClick();
  assert.equal(control("2024-04-01").props["aria-pressed"], true);
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

test("compact dates support bounded keyboard movement without changing selection", () => {
  const app = fixture().app();
  button(app.render(), "3 Months").props.onClick();
  const panel = nodes(app.render(), node => node.props.className === "compact-month")[0];
  const list = nodes(panel, node => node.props.className === "compact-days")[0];
  assert.ok(list.props["aria-label"]);
  assert.equal(list.props["aria-describedby"], "compact-help");
  const dates = nodes(panel, node => node.props.className === "compact-date");
  let focused;
  const controls = dates.map((_, index) => ({ focus() { focused = index; }, closest() { return { querySelectorAll: () => controls }; } }));
  const selected = dates.map(date => date.props["aria-pressed"]);
  for (const [index, key, expected] of [[10, "ArrowLeft", 9], [10, "ArrowRight", 11], [10, "ArrowUp", 3], [10, "ArrowDown", 17], [10, "Home", 0], [10, "End", dates.length - 1], [0, "ArrowUp", 0], [dates.length - 1, "ArrowRight", dates.length - 1]]) {
    let prevented = false;
    dates[index].props.onKeyDown({ key, currentTarget: controls[index], preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(focused, expected);
  }
  dates[0].props.onKeyDown({ key: "Tab", preventDefault() { assert.fail("Tab must keep native behavior"); } });
  const after = nodes(app.render(), node => node.props.className === "compact-month")[0];
  assert.deepEqual(nodes(after, node => node.props.className === "compact-date").map(date => date.props["aria-pressed"]), selected);
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
  change(field(app.render(), "Repeat"), "Never");
  assert.equal(field(app.render(), "Repeat until"), undefined);
  submit(section(app.render(), "manage-events-heading"));
  assert.equal(f.eventStore.list()[0].recurrence, undefined);
});
