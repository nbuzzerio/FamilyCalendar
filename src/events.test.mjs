import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventStore, expandEvents, localDate, dateKey, isLocalDate, isLocalTime, EVENTS_STORAGE_KEY } from "./events.ts";
import { upcomingEvents, weekDays } from "./calendar.ts";
import { createLabelStore, LABELS_STORAGE_KEY, labelTextColor } from "./labels.ts";

function labelFixture(initial = null) {
  let value = initial;
  const storage = {
    getItem(key) { assert.equal(key, LABELS_STORAGE_KEY); return value; },
    setItem(key, next) { assert.equal(key, LABELS_STORAGE_KEY); value = next; },
  };
  return { storage, store: createLabelStore(() => storage) };
}

test("person and category labels persist and support renaming, color editing, and deletion", () => {
  const { store, storage } = labelFixture();
  const person = store.create({ name: " Alex ", kind: "Person", color: "#123456" });
  const category = store.create({ name: "School", kind: "Category", color: "#ffee00" });
  assert.equal(person.name, "Alex");
  const refreshed = createLabelStore(() => storage);
  assert.deepEqual(refreshed.list(), [person, category]);
  const updated = refreshed.update(person.id, { name: "Alexandra", kind: "Person", color: "#ffffff" });
  assert.equal(updated.id, person.id);
  assert.deepEqual(store.list(), [updated, category]);
  store.delete(category.id);
  assert.deepEqual(createLabelStore(() => storage).list(), [updated]);
  assert.throws(() => store.update("missing", { name: "X", kind: "Person", color: "#000000" }), /no longer exists/);
});

test("event label assignment persists, can change or clear, and label deletion keeps events and notes", () => {
  const labels = labelFixture();
  const { store, storage } = fixture();
  const person = labels.store.create({ name: "Alex", kind: "Person", color: "#123456" });
  const category = labels.store.create({ name: "School", kind: "Category", color: "#ffffff" });
  const legacy = store.create({ title: "Unlabeled", date: "2026-10-24" });
  const input = { title: "Meeting", date: "2026-10-24", notes: "Bring forms\nRoom 2", time: "09:00" };
  const event = store.create({ ...input, labelId: person.id });
  const refreshed = createEventStore(() => storage);
  assert.deepEqual(refreshed.list().find(item => item.id === event.id), event);
  refreshed.update(event.id, { ...input, labelId: category.id });
  assert.equal(store.list().find(item => item.id === event.id).labelId, category.id);
  const before = store.list();
  labels.store.delete(category.id);
  assert.deepEqual(createEventStore(() => storage).list(), before);
  assert.equal(labels.store.list().find(label => label.id === category.id), undefined);
  refreshed.update(event.id, input);
  assert.deepEqual(store.list().find(item => item.id === event.id), { ...input, id: event.id });
  assert.deepEqual(store.list().find(item => item.id === legacy.id), legacy);
  for (const labelId of [null, "", 123, {}]) assert.throws(() => store.create({ ...input, labelId }));
});

test("invalid label storage is tolerated and invalid labels and failed writes are rejected", () => {
  for (const raw of ["{", "null", "{}", "42"]) assert.deepEqual(labelFixture(raw).store.list(), []);
  const valid = { id: "a", name: "Alex", kind: "Person", color: "#123abc" };
  const invalid = [null, { ...valid, name: " " }, { ...valid, kind: "Other" }, { ...valid, color: "red" }, { ...valid, color: "#abc" }];
  assert.deepEqual(labelFixture(JSON.stringify([valid, valid, ...invalid])).store.list(), [valid]);
  const { store } = labelFixture();
  for (const input of invalid) assert.throws(() => store.create(input));
  assert.deepEqual(store.list(), []);
  const unavailable = createLabelStore(() => { throw new Error("denied"); });
  assert.deepEqual(unavailable.list(), []);
  assert.throws(() => unavailable.create(valid), /could not be saved/);
  const full = createLabelStore(() => ({ getItem: () => JSON.stringify([valid]), setItem: () => { throw new Error("quota"); } }));
  assert.throws(() => full.update(valid.id, valid), /could not be saved/);
  assert.throws(() => full.delete(valid.id), /could not be saved/);
  assert.deepEqual(full.list(), [valid]);
});

test("label text meets WCAG AA contrast for selected colors", () => {
  for (let value = 0; value <= 0xffffff; value += 7919) {
    const color = `#${value.toString(16).padStart(6, "0")}`;
    const channels = [16, 8, 0].map(shift => {
      const channel = ((value >> shift) & 255) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    const text = labelTextColor(color);
    const contrast = text === "#000000" ? (luminance + 0.05) / 0.05 : 1.05 / (luminance + 0.05);
    assert.ok(contrast >= 4.5, `${color} with ${text}`);
  }
});

function fixture(initial = null) {
  let value = initial;
  const storage = {
    getItem(key) { assert.equal(key, EVENTS_STORAGE_KEY); return value; },
    setItem(key, next) { assert.equal(key, EVENTS_STORAGE_KEY); value = next; },
  };
  return { storage, store: createEventStore(() => storage) };
}

test("multiline notes are created, persisted, edited, and cleared across reloads", () => {
  const { store, storage } = fixture();
  const notes = "Bring snacks\n  Meet by the north gate.\n<script>plain text</script>";
  const event = store.create({ title: "Picnic", date: "2026-10-24", notes });
  assert.equal(event.notes, notes);
  assert.equal(JSON.parse(storage.getItem(EVENTS_STORAGE_KEY))[0].notes, notes);
  const refreshed = createEventStore(() => storage);
  assert.deepEqual(refreshed.list(), [event]);
  const updated = refreshed.update(event.id, { title: event.title, date: event.date, notes: "New plan\nBring a blanket" });
  assert.equal(updated.notes, "New plan\nBring a blanket");
  assert.deepEqual(createEventStore(() => storage).list(), [updated]);
  refreshed.update(event.id, { title: event.title, date: event.date, notes: " \n " });
  assert.equal(Object.hasOwn(store.list()[0], "notes"), false);
  refreshed.update(event.id, { title: event.title, date: event.date, notes });
  refreshed.update(event.id, { title: event.title, date: event.date });
  assert.equal(Object.hasOwn(store.list()[0], "notes"), false);
});

test("loading notes preserves legacy events and rejects malformed notes", () => {
  const legacy = { id: "legacy", title: "Existing", date: "2026-10-24" };
  const withNotes = { ...legacy, id: "notes", title: "With notes", notes: "First line\nSecond line" };
  const invalid = [null, 42, {}, ["text"]];
  const { store } = fixture(JSON.stringify([legacy, withNotes, ...invalid.map((notes, index) => ({ ...legacy, id: `bad-${index}`, notes }))]));
  assert.deepEqual(store.list(), [legacy, withNotes]);
  store.create({ title: "Another", date: legacy.date });
  assert.deepEqual(store.list().find(event => event.id === legacy.id), legacy);
  for (const notes of invalid) {
    assert.throws(() => store.create({ title: "Invalid", date: legacy.date, notes }));
    assert.throws(() => store.update(legacy.id, { title: legacy.title, date: legacy.date, notes }));
  }
  assert.deepEqual(store.list().find(event => event.id === withNotes.id), withNotes);
});

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


const series = (date, frequency, endDate) => ({ id: "series", title: "Plan", date, time: "02:30", notes: "Keep\nnotes", labelId: "person", recurrence: { frequency, ...(endDate ? { endDate } : {}) } });
const occurrenceDates = (event, start, end) => expandEvents([event], start, end).map(item => item.date);

test("daily and weekly recurrence crosses month/year boundaries and includes its end date", () => {
  assert.deepEqual(occurrenceDates(series("2026-12-30", "Daily", "2027-01-02"), "2026-12-29", "2027-01-04"), ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  assert.deepEqual(occurrenceDates(series("2026-12-25", "Weekly", "2027-01-08"), "2026-12-01", "2027-02-01"), ["2026-12-25", "2027-01-01", "2027-01-08"]);
  for (const frequency of ["Never", "Daily", "Weekly", "Monthly", "Yearly"]) {
    assert.deepEqual(occurrenceDates(series("2024-02-29", frequency, frequency === "Never" ? undefined : "2024-02-29"), "2024-02-28", "2024-03-01"), ["2024-02-29"]);
  }
});

test("monthly and yearly recurrence remains anchored through 28/29/30/31-day months", () => {
  for (const [year, feb] of [[2023, 28], [2024, 29]]) {
    assert.deepEqual(occurrenceDates(series(`${year}-01-31`, "Monthly"), `${year}-01-01`, `${year}-05-31`), [`${year}-01-31`, `${year}-02-${feb}`, `${year}-03-31`, `${year}-04-30`, `${year}-05-31`]);
  }
  assert.deepEqual(occurrenceDates(series("2024-02-29", "Yearly"), "2025-01-01", "2028-12-31"), ["2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
  assert.deepEqual(occurrenceDates(series("2024-01-30", "Monthly"), "2024-02-01", "2024-04-30"), ["2024-02-29", "2024-03-30", "2024-04-30"]);
});

test("recurrence storage round trips preserve legacy fields and reject invalid edits without writes", () => {
  const legacy = { id: "old", title: "Old", date: "2020-01-01", time: "09:45", notes: "Original\nnotes", labelId: "color-label" };
  const { store, storage } = fixture(JSON.stringify([legacy]));
  for (const frequency of ["Never", "Daily", "Weekly", "Monthly", "Yearly"]) {
    const input = series("2024-02-29", frequency);
    const saved = store.create(input);
    assert.deepEqual(createEventStore(() => storage).list().find(event => event.id === saved.id), saved);
  }
  assert.deepEqual(store.list().find(event => event.id === legacy.id), legacy);
  const before = storage.getItem(EVENTS_STORAGE_KEY);
  for (const recurrence of [null, [], {}, { frequency: "Hourly" }, { frequency: "Daily", endDate: "2024-02-30" }, { frequency: "Daily", endDate: "2020-01-01" }, { frequency: "Never", endDate: "2025-01-01" }, { frequency: "Weekly", interval: 2 }]) {
    assert.throws(() => store.create({ title: "Invalid", date: "2024-02-29", recurrence }));
    assert.throws(() => store.update(legacy.id, { ...legacy, date: "2024-02-29", recurrence }));
    assert.equal(storage.getItem(EVENTS_STORAGE_KEY), before);
  }
  assert.equal(JSON.parse(before).length, 6); // Series records, never materialized occurrences.
  const saved = store.list().find(event => event.recurrence?.frequency === "Monthly");
  store.update(saved.id, { ...saved, recurrence: { frequency: "Weekly", endDate: "2024-03-07" } });
  assert.deepEqual(store.list().find(event => event.id === saved.id).recurrence, { frequency: "Weekly", endDate: "2024-03-07" });
});

test("open series expansion is bounded, deterministic and can seek far beyond its origin", () => {
  const event = series("0001-01-01", "Daily");
  const result = expandEvents([event], "2099-12-30", "2100-01-02");
  assert.deepEqual(result.map(item => item.date), ["2099-12-30", "2099-12-31", "2100-01-01", "2100-01-02"]);
  assert.deepEqual(expandEvents([event], "2099-12-30", "2100-01-02"), result);
  assert.throws(() => expandEvents([event], "2000-01-01", "2020-01-01"), /3660/);
  assert.throws(() => expandEvents([event], "2026-02-30", "2026-03-01"));
  assert.throws(() => expandEvents([event], "2026-03-02", "2026-03-01"));
  assert.equal(event.date, "0001-01-01");
});

test("local recurrence dates and wall times survive DST in multiple time zones", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["America/New_York", "Europe/Berlin", "Pacific/Auckland"]) {
      process.env.TZ = zone;
      for (const [start, end] of [["2026-03-06", "2026-03-10"], ["2026-10-30", "2026-11-03"], ["2026-03-27", "2026-03-31"], ["2026-04-03", "2026-04-07"]]) {
        const event = series(start, "Daily");
        const occurrences = expandEvents([event], start, end);
        assert.equal(occurrences.length, 5, zone);
        assert.equal(occurrences.at(-1).date, end);
        assert.ok(occurrences.every(item => item.time === "02:30" && item.notes === event.notes && item.labelId === event.labelId && dateKey(localDate(item.date)) === item.date));
        const weekly = expandEvents([series(start, "Weekly")], start, dateKey(new Date(localDate(start).setDate(localDate(start).getDate() + 14))));
        assert.equal(weekly.length, 3);
        assert.ok(weekly.every(item => localDate(item.date).getDay() === localDate(start).getDay() && item.time === "02:30"));
      }
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
