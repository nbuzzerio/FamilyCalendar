import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventStore, dateKey, isLocalDate, isLocalTime, EVENTS_STORAGE_KEY } from "./events.ts";
import { upcomingEvents, weekDays } from "./calendar.ts";

function fixture(initial = null) {
  let value = initial;
  const storage = {
    getItem(key) { assert.equal(key, EVENTS_STORAGE_KEY); return value; },
    setItem(key, next) { assert.equal(key, EVENTS_STORAGE_KEY); value = next; },
  };
  return { storage, store: createEventStore(() => storage) };
}

test("CRUD persists across store recreation and lists chronologically", () => {
  const { store, storage } = fixture();
  const later = store.create({ title: " Dinner ", date: "2026-11-02" });
  const earlier = store.create({ title: "Lunch", date: "2026-10-24" });
  const refreshed = createEventStore(() => storage);
  assert.deepEqual(refreshed.list(), [earlier, { ...later, title: "Dinner" }]);
  refreshed.update(later.id, { title: "Breakfast", date: "2026-10-23" });
  assert.equal(store.list()[0].title, "Breakfast");
  store.delete(earlier.id);
  assert.equal(refreshed.list().length, 1);
  assert.throws(() => store.update("missing", { title: "X", date: "2026-10-24" }));
});

test("invalid storage and individual invalid records are tolerated", () => {
  for (const raw of ["{", "null", "{}", "42"]) assert.deepEqual(fixture(raw).store.list(), []);
  const valid = { id: "a", title: "Valid", date: "2024-02-29" };
  const { store } = fixture(JSON.stringify([null, valid, valid, { ...valid, id: "b", date: "2026-02-29" }, { id: "c" }]));
  assert.deepEqual(store.list(), [valid]);
});

test("dates retain local calendar components and reject rollover dates", () => {
  assert.equal(dateKey(new Date(2026, 0, 2, 23, 30)), "2026-01-02");
  for (const value of ["2024-02-29", "2026-03-08", "2026-11-01"]) assert.equal(isLocalDate(value), true);
  for (const value of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-1-1", "2026-10-24T00:00:00Z", "0000-01-01"]) assert.equal(isLocalDate(value), false);
  const { store } = fixture();
  assert.throws(() => store.create({ title: " ", date: "2026-01-01" }));
  assert.throws(() => store.create({ title: "Title", date: "2026-02-30" }));
  assert.deepEqual(store.list(), []);
});

test("unavailable storage reads safely and failed writes report failure", () => {
  const store = createEventStore(() => { throw new Error("denied"); });
  assert.deepEqual(store.list(), []);
  assert.throws(() => store.create({ title: "Event", date: "2026-10-24" }), /could not be saved/);
  const full = createEventStore(() => ({ getItem: () => "[]", setItem: () => { throw new Error("quota"); } }));
  assert.throws(() => full.create({ title: "Event", date: "2026-10-24" }), /could not be saved/);
});

test("same-day events persist in time order with all-day events first", () => {
  const { store, storage } = fixture();
  const date = "2026-10-24";
  store.create({ title: "Afternoon", date, time: "15:30" });
  const morning = store.create({ title: "Morning", date, time: "09:00" });
  store.create({ title: "All day", date });
  store.create({ title: "Midnight", date, time: "00:00" });
  store.create({ title: "Previous day", date: "2026-10-23", time: "23:59" });
  const refreshed = createEventStore(() => storage);
  assert.deepEqual(refreshed.list().map(event => event.title), ["Previous day", "All day", "Midnight", "Morning", "Afternoon"]);
  assert.deepEqual(refreshed.list().filter(event => event.date === date).map(event => event.time), [undefined, "00:00", "09:00", "15:30"]);
  refreshed.update(morning.id, { title: "Evening", date, time: "20:00" });
  assert.equal(store.list().at(-1).title, "Evening");
  refreshed.update(morning.id, { title: "Now all day", date });
  assert.equal(store.list().find(event => event.id === morning.id).time, undefined);
});

test("legacy date-only events survive and malformed times are rejected", () => {
  const legacy = { id: "legacy", title: "Existing event", date: "2026-10-24" };
  const { store } = fixture(JSON.stringify([legacy, { ...legacy, id: "bad", time: "24:00" }]));
  assert.deepEqual(store.list(), [legacy]);
  for (const time of ["00:00", "09:05", "23:59"]) assert.equal(isLocalTime(time), true);
  for (const time of ["24:00", "12:60", "9:00", "", null, "12:00Z"]) {
    assert.equal(isLocalTime(time), false);
    assert.throws(() => store.create({ title: "Invalid", date: legacy.date, time }));
  }
  store.create({ title: "New event", date: legacy.date, time: "12:00" });
  assert.deepEqual(store.list()[0], legacy);
});

test("week navigation crosses months, years, and daylight-saving boundaries", () => {
  const anchor = new Date(2026, 11, 31, 23);
  const original = anchor.getTime();
  assert.deepEqual(weekDays(anchor).map(dateKey), ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
  assert.equal(dateKey(weekDays(anchor, 1)[0]), "2027-01-04");
  assert.equal(dateKey(weekDays(anchor, -1)[0]), "2026-12-21");
  assert.equal(dateKey(weekDays(anchor, 0)[0]), "2026-12-28");
  assert.equal(anchor.getTime(), original);
  const spring = weekDays(new Date(2026, 2, 8), 1);
  assert.equal(dateKey(spring[0]), "2026-03-09");
  assert.equal(dateKey(spring[6]), "2026-03-15");
  assert.equal(dateKey(weekDays(new Date(2026, 10, 1), 1)[0]), "2026-11-02");
});

test("editing across weeks and deletion persist in calendar and upcoming data", () => {
  const { store, storage } = fixture();
  const today = "2026-10-24";
  const moved = store.create({ title: "Move me", date: today, time: "15:00" });
  const past = store.create({ title: "Past", date: "2026-10-23" });
  const morning = store.create({ title: "Morning", date: today, time: "09:00" });
  store.update(moved.id, { title: "Moved", date: "2026-11-04", time: "10:30" });
  const refreshed = createEventStore(() => storage);
  const events = refreshed.list();
  assert.deepEqual(events.filter(event => event.date === today), [morning]);
  const nextWeek = weekDays(new Date(2026, 9, 24), 2).map(dateKey);
  assert.deepEqual(events.filter(event => nextWeek.includes(event.date)).map(event => event.title), ["Moved"]);
  assert.deepEqual(upcomingEvents([...events].reverse(), today).map(event => event.title), ["Morning", "Moved"]);
  assert.equal(events.some(event => event.id === past.id), true);
  refreshed.delete(moved.id);
  const afterReload = createEventStore(() => storage).list();
  assert.equal(afterReload.some(event => event.id === moved.id), false);
  assert.deepEqual(upcomingEvents(afterReload, today), [morning]);
  refreshed.delete(morning.id);
  assert.deepEqual(upcomingEvents(store.list(), today), []);
});
