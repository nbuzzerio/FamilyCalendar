import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture, chromium, expect, password } from "./local-service.mjs";

const keys = { events:"family-calendar.events.v1", labels:"family-calendar.labels.v1", roll:"family-calendar.roll-call.v1", dinners:"family-calendar.dinners.v1", groceries:"family-calendar.groceries.v1" };
const date = new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const monday = new Date(date + "T12:00:00Z");
monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay()+6)%7);
const week = monday.toISOString().slice(0,10);
const series = { id:"series",title:"Family supper",date:week,notes:"First line\nSecond line",recurrence:{frequency:"Weekly",endDate:"2030-12-31"},labelId:"robin-a",custom:{source:"historical"} };
const labels = ["a","b"].map(k => ({id:"robin-"+k,name:"Robin "+k,kind:"Person",color:"#335533"}));
const meal = { name:"Soup", cook:"Both Robins", ingredients:[{name:"Beans",amount:"1 tin",pantry:"A1"}] };
const legacy = {
  [keys.events]:JSON.stringify([series]), [keys.labels]:JSON.stringify(labels),
  [keys.roll]:JSON.stringify({[week]:{"robin-a":"Unknown"}}),
  [keys.dinners]:JSON.stringify({[week]:meal}), [keys.groceries]:JSON.stringify({[week]:["beans","brown rice"]}),
};
const button = (p,name) => p.getByRole("button",{name,exact:true});
const advanced = p => p.locator(".sync-settings");
const status = p => p.locator(".sync-summary [role=status]");
async function settings(p) { if (!await advanced(p).evaluate(e => e.open)) await advanced(p).locator(":scope > summary").click(); }
async function state(p) {
  return p.evaluate(async () => {
    const request = r => new Promise((ok,fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
    const db = await request(indexedDB.open("family-calendar-sync"));
    try {
      const tx = db.transaction(["records","settings","evidence","staged"]);
      const [s,rows,archives,stage] = await Promise.all([request(tx.objectStore("settings").get("calendar")),request(tx.objectStore("records").getAll()),request(tx.objectStore("evidence").count()),request(tx.objectStore("staged").count())]);
      return {s,rows,archives,stage};
    } finally { db.close(); }
  });
}
async function waitFor(fn, message) { await expect.poll(fn,{message,timeout:12000}).toBe(true); }
const findRow = async (p,key) => (await state(p)).rows.find(r => r.key === key);
async function device(browser, f, {raw,sharedSession=false,mobile=false,interrupt=false,clock=false} = {}) {
  const ctx = await browser.newContext({timezoneId:"America/New_York", viewport: mobile ? {width:390,height:844} : {width:1100,height:850}});
  await ctx.route("**/*", r => new URL(r.request().url()).origin === f.origin ? r.continue() : r.abort());
  if (sharedSession) {
    const result = await ctx.request.post(f.origin+"/api/v1/auth/household-login",{headers:{Origin:f.origin},data:{password}});
    assert.equal(result.status(),200);
  }
  const p = await ctx.newPage();
  if (clock) await p.clock.install();
  p.on("pageerror", e => { console.error("Page error",e.message); });
  if (raw || interrupt) await p.addInitScript(({raw,interrupt}) => {
    if (location.pathname !== "/calendar/" || sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded","yes");
    for (const [k,v] of Object.entries(raw ?? {})) localStorage.setItem(k,v);
    if (interrupt) {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(...args) {
        if (this.name === "records") { this.transaction.abort(); throw Error("Synthetic interrupted migration"); }
        return put.apply(this,args);
      };
    }
  },{raw,interrupt});
  await p.goto(f.url);
  if (!interrupt) await expect(button(p,"Sync")).toBeVisible();
  return {ctx,p};
}
async function login(p) {
  await settings(p); await p.getByLabel("Household password").fill(password); await button(p,"Sign in").click();
  await expect(button(p,"Sign out")).toBeVisible();
}
async function backup(p) {
  const download = p.waitForEvent("download");
  await button(p,"Export backup").click();
  const file = await download;
  return JSON.parse(await readFile(await file.path(),"utf8"));
}
async function connect(p,f,map = false) {
  await settings(p);
  await expect(p.getByLabel("Shared Space",{exact:true})).toBeVisible();
  await expect(p.getByLabel("Shared Space",{exact:true})).not.toContainText("Personal workouts");
  const file = await backup(p);
  if (map) for (const [i,label] of labels.entries()) {
    const group = p.getByRole("group",{name:"Match Calendar people"}).locator("div").filter({hasText:label.id});
    await group.locator("select").selectOption(f.people[i].id); await group.getByRole("button",{name:"Confirm match"}).click();
    await expect(group).toHaveCount(0);
  }
  await p.getByLabel("I saved my backup",{exact:false}).check(); await button(p,"Download for comparison").click();
  await expect(button(p,"Approve reconciliation")).toBeEnabled();
  return file;
}
async function approve(p) { await button(p,"Approve reconciliation").click(); await expect(status(p)).toHaveText("Synced",{timeout:15000}); }
async function pull(p) {
  const next = p.waitForResponse(r => r.url().endsWith("/family-calendar/exchange"));
  await button(p,"Sync").click(); await next; await expect(button(p,"Sync")).toBeEnabled();
}
async function saveEvent(p,title) {
  const form = p.locator("section[aria-labelledby=manage-events-heading]");
  await form.getByLabel("Title",{exact:true}).fill(title); await button(form,"Add event").click();
  await expect(form.getByRole("status")).toHaveText("Event added.");
}
async function editEvent(p,title,next) {
  await button(p,"Edit "+title).first().click(); const form = p.locator("section[aria-labelledby=manage-events-heading]");
  await form.getByLabel("Title",{exact:true}).fill(next);
  p.once("dialog",d => d.accept());
  await button(form,"Save event").click(); await expect(form.getByRole("status")).toHaveText("Event updated.");
}
const answer = (p,index) => p.getByLabel("Dinner availability for "+labels[index].name+" on "+week,{exact:true});
async function suite(t,run) {
  const f = await fixture(); t.after(() => f.close());
  const browser = await chromium.launch(); t.after(() => browser.close());
  await run(f,browser);
}

test("complete migration, household consent and two-way daily use", async t => suite(t,async (f,browser) => {
  const {p,ctx} = await device(browser,f,{raw:legacy});
  await expect(status(p)).toHaveText("Sign in required");
  assert.equal(await advanced(p).evaluate(e => e.open),false);
  const oldDevice = (await state(p)).s.device;
  await p.reload(); await expect(status(p)).toHaveText("Sign in required");
  assert.equal((await state(p)).s.device,oldDevice);
  assert.equal((await state(p)).rows.length,6);
  await login(p);
  assert.equal(f.requests.filter(r => r.path.endsWith("/exchange")).length,0);
  const file = await connect(p,f,true);
  for (const [k,v] of Object.entries(legacy)) assert.equal(file.raw[k],v);
  assert.equal(file.calendar.records.find(r => r.kind === "legacy-attendance").value.availability,"Unknown");
  assert.equal(f.rows().length,0); assert.ok(f.requests.filter(r => r.body).every(r => r.body.changes.length === 0));
  await approve(p);
  assert.equal(f.rows().length,6);
  assert.deepEqual((await findRow(p,"event:series")).value,series);
  assert.deepEqual((await findRow(p,"grocery-checks:"+week)).value.checked,["beans","brown rice"]);
  assert.equal(await answer(p,0).inputValue(),"Unknown"); assert.equal(await answer(p,1).inputValue(),"");
  assert.equal(JSON.stringify(file).includes(password),false);
  const {p:phone,ctx:mobile} = await device(browser,f,{sharedSession:true,mobile:true});
  await connect(phone,f); await approve(phone);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  assert.deepEqual((await findRow(phone,"event:series")).value,series);
  await expect(answer(phone,0)).toHaveValue("Unknown");
  await mobile.setOffline(true);
  await answer(phone,1).selectOption("Available"); await expect(answer(phone,1)).toHaveValue("Available");
  await answer(p,0).selectOption("Unavailable"); await waitFor(() => f.rows().some(r => r.id === week+":"+f.people[0].id && JSON.parse(r.payload)?.availability === "Unavailable"), "desktop attendance uploaded"); await expect(status(p)).toHaveText("Synced",{timeout:12000});
  await phone.evaluate(async () => { await navigator.serviceWorker.ready; });
  await phone.reload(); await expect(status(phone)).toHaveText("Offline");
  await expect(answer(phone,1)).toHaveValue("Available");
  assert.equal((await state(phone)).rows.flatMap(r => r.queue).length,1);
  await mobile.setOffline(false); await expect(status(phone)).toHaveText("Synced",{timeout:12000});
  await pull(p); await expect(answer(p,1)).toHaveValue("Available"); await expect(answer(phone,0)).toHaveValue("Unavailable");
  await answer(phone,0).selectOption(""); await waitFor(() => f.rows().some(r => r.id === week+":"+f.people[0].id && r.deleted === 1), "response clear uploaded"); await expect(status(phone)).toHaveText("Synced",{timeout:12000});
  await pull(p); await expect(answer(p,0)).toHaveValue("");
  assert.equal((await findRow(p,"roll-call:"+week+":"+f.people[0].id)).server.deleted,true);
  await answer(p,0).selectOption("Unknown"); await settings(p); await expect(button(p,"Restore my copy")).toBeVisible();
  await button(p,"Restore my copy").click(); await expect(status(p)).toHaveText("Synced",{timeout:12000});
  assert.equal((await findRow(p,"roll-call:"+week+":"+f.people[0].id)).server.deleted,false);
  await mobile.setOffline(true);
  await editEvent(phone,"Family supper","Phone series");
  await editEvent(p,"Family supper","Desktop series"); await expect(status(p)).toHaveText("Synced",{timeout:12000});
  await mobile.setOffline(false); await settings(phone); await expect(button(phone,"Keep device choice")).toBeVisible({timeout:12000});
  await expect(phone.getByRole("group",{name:"Conflicting entries"})).toContainText("Desktop series");
  await button(phone,"Keep device choice").click(); await expect(status(phone)).toHaveText("Synced",{timeout:12000}); await pull(p);
  const saved = (await findRow(p,"event:series")).value;
  assert.equal(saved.title,"Phone series"); assert.equal(saved.date,week); assert.deepEqual(saved.custom,series.custom); assert.deepEqual(saved.recurrence,series.recurrence);
  f.renamePerson(); await pull(p); assert.ok((await state(p)).s.people.some(x => x.displayName === "Robin renamed"));
  // One commit, lost HTTP acknowledgement, refresh, retry with the same device and operation identity.
  f.faults.loseNextWrite = true;
  await saveEvent(p,"Retry once"); await waitFor(() => f.requests.some(r => r.lost),"server committed and dropped response");
  const lost = f.requests.find(r => r.lost).body;
  await p.reload(); await expect(button(p,"Sync")).toBeVisible(); await pull(p);
  await expect(status(p)).toHaveText("Synced",{timeout:12000});
  const retried = f.requests.filter(r => r.body?.changes.some(op => op.operationId === lost.changes[0].operationId));
  assert.ok(retried.length >= 2); assert.deepEqual(retried[0].body.changes,retried[1].body.changes);
  assert.equal(f.ops().filter(op => op.operation_id === lost.changes[0].operationId).length,1);
  f.expire(); await ctx.setOffline(true); await saveEvent(p,"Expired session edit"); await ctx.setOffline(false);
  await expect(status(p)).toHaveText("Sign in required",{timeout:12000}); assert.ok((await state(p)).rows.some(r => r.queue.length));
  await login(p); await expect(status(p)).toHaveText("Synced",{timeout:12000});
  const second = await ctx.newPage(); await second.goto(f.url); await expect(status(second)).toHaveText("Synced",{timeout:12000});
  f.faults.slow = true;
  await Promise.all([saveEvent(p,"First tab"),saveEvent(second,"Second tab")]);
  await waitFor(() => f.rows().some(r => r.payload?.includes("First tab")) && f.rows().some(r => r.payload?.includes("Second tab")),"both tabs persisted");
  assert.equal(f.rows().filter(r => r.payload?.includes("First tab")).length,1);
  await expect(status(p)).toHaveText("Synced",{timeout:12000});
  const count = f.requests.length; await p.waitForTimeout(2800); assert.equal(f.requests.length,count);
  await Promise.all([pull(p),pull(second)]); assert.equal(f.faults.maxExchanges,1);
}));

test("interrupted migration, malformed sources and blank-profile recovery", async t => suite(t,async (f,browser) => {
  const raw = {...legacy,[keys.events]:JSON.stringify([series,series,{id:"bad",date:4}]),[keys.roll]:'{"bad":',"family-calendar.extra.v8":"future bytes"};
  const {p} = await device(browser,f,{raw,interrupt:true});
  await expect(button(p,"Export original browser data")).toBeVisible();
  assert.equal((await state(p)).rows.length,0);
  await p.reload(); await expect(button(p,"Sync")).toBeVisible(); await settings(p);
  const file = await backup(p); assert.equal(file.raw[keys.roll],raw[keys.roll]); assert.equal(file.raw["family-calendar.extra.v8"],"future bytes");
  assert.ok(file.calendar.records.find(r => r.key === "event:series").hold); assert.ok(file.calendar.settings.issues.length >= 2);
  assert.equal(await p.evaluate(k => localStorage.getItem(k),keys.events),raw[keys.events]);
  const {p:blank} = await device(browser,f); await settings(blank);
  const recover = async () => {
    await blank.getByText("Recover a backup",{exact:true}).click();
    blank.once("dialog", d => d.accept());
    await blank.getByLabel("Calendar backup").setInputFiles({ name:"calendar.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(file)) });
  };
  await recover(); await expect(blank.getByText("Recovered on this device.",{exact:false})).toBeVisible();
  const restored = await state(blank); assert.equal(restored.s.phase,"local"); assert.notEqual(restored.s.device,file.calendar.settings.device);
  assert.deepEqual(restored.rows.map(r => [r.key,r.value]),file.calendar.records.map(r => [r.key,r.value])); assert.equal(f.rows().length,0);
  const recovered = await backup(blank); assert.ok(recovered.calendar.evidence.some(e => typeof e.data === "string" && JSON.parse(e.data).raw[keys.roll] === raw[keys.roll]));
}));
 
const put = (kind,recordId,value,people = [],baseServerVersion = null) => ({
  operationId:crypto.randomUUID(),type:"put",kind,recordId,value,people,schemaVersion:1,baseServerVersion,
});
test("paginated staging, stable cursors and restore of an earlier server with pending edits", async t => suite(t,async (f,browser) => {
  const batch = Array.from({length:57},(_,i) => put("event","past-"+i,{id:"past-"+i,title:"Historical "+i,date:"2020-01-01"}));
  assert.equal(f.exchange(batch.slice(0,28)).acceptedOperationIds.length,28);
  assert.equal(f.exchange(batch.slice(28)).acceptedOperationIds.length,29);
  const backupPath = await f.backup();
  const {ctx,p} = await device(browser,f,{sharedSession:true});
  await connect(p,f);
  assert.equal((await state(p)).stage,57); assert.equal((await state(p)).rows.length,0);
  assert.ok(f.requests.filter(r => r.body && !r.body.changes.length).length >= 3);
  await p.reload(); await settings(p); await approve(p);
  assert.equal((await state(p)).rows.length,57);
  const cursor = (await state(p)).s.cursor;
  const first = f.requests.length; await p.reload();
  await waitFor(() => f.requests.slice(first).some(r => r.body?.cursor === cursor),"reopen uses persisted opaque cursor");
  await saveEvent(p,"After backup");
  await waitFor(() => f.rows().some(r => r.payload?.includes("After backup")),"new event accepted on discarded timeline");
  await ctx.setOffline(true); await saveEvent(p,"Pending at restore");
  const queued = (await state(p)).rows.flatMap(r => r.queue); assert.equal(queued.length,1);
  f.restore(backupPath); const before = f.requests.length;
  await ctx.setOffline(false); await expect(status(p)).toHaveText("Sign in required",{timeout:12000});
  await login(p); await expect(button(p,"Approve reconciliation")).toBeEnabled({timeout:12000});
  const staged = await state(p);
  assert.equal(staged.s.phase,"recovery"); assert.equal(staged.stage,57); assert.deepEqual(staged.rows.flatMap(r => r.queue),queued);
  assert.ok(f.requests.slice(before).filter(r => r.body).every(r => !r.body.changes.length));
  await button(p,"Approve reconciliation").click();
  const cards = p.getByRole("group",{name:"Conflicting entries"}).locator("article");
  await expect(cards).toHaveCount(2); assert.equal(f.rows().length,57);
  await cards.filter({hasText:"After backup"}).getByRole("button",{name:"Keep device choice"}).click();
  await cards.filter({hasText:"Pending at restore"}).getByRole("button",{name:"Keep device choice"}).click();
  await expect(status(p)).toHaveText("Synced",{timeout:12000}); assert.equal(f.rows().length,59);
  assert.ok((await state(p)).archives > 1);
}));

test("initial divergence, explicit attendance conflicts, dinner edits and weekly checkmarks", async t => suite(t,async (f,browser) => {
  f.exchange([put("event","series",{...series,title:"Shared supper"})]);
  const {p,ctx} = await device(browser,f,{raw:legacy,sharedSession:true});
  await connect(p,f,true);
  const preview = (await state(p)); assert.equal(preview.rows.find(r => r.id === "series").value.title,"Family supper");
  await button(p,"Approve reconciliation").click();
  const cards = p.getByRole("group",{name:"Conflicting entries"}).locator("article");
  await expect(cards).toContainText("Shared supper"); await expect(cards).toContainText("Family supper");
  await cards.getByRole("button",{name:"Use shared choice"}).click();
  await expect(status(p)).toHaveText("Synced",{timeout:12000});
  await button(p,"Edit dinner for "+week).click();
  await p.getByLabel("Dinner name",{exact:true}).fill("Bean stew");
  await p.getByLabel("Ingredients (optional)").fill("Beans | 2 tins, Rice | 1 cup"); await button(p,"Save dinner").click();
  await expect(p.getByRole("status").filter({hasText:"Dinner saved"})).toBeVisible();
  await p.getByRole("checkbox",{name:"Rice for dinner week "+week}).check();
  await waitFor(() => f.rows().some(r => r.kind === "grocery-checks" && JSON.parse(r.payload).checked.includes("rice")),"weekly checks pushed");
  const plan = JSON.parse(f.rows().find(r => r.kind === "dinner-plan").payload);
  assert.deepEqual(plan.ingredients[0],{name:"Beans",amount:"2 tins",pantry:"A1"}); assert.equal(plan.cook,meal.cook);
  await ctx.setOffline(true); await answer(p,0).selectOption("Available");
  const attendee = f.people[0].id, id = week+":"+attendee;
  f.exchange([put("roll-call",id,{availability:"Unavailable"},[{role:"attendee",personId:attendee}],"1")]);
  await ctx.setOffline(false); await expect(cards).toContainText("Unavailable",{timeout:12000}); await expect(cards).toContainText("Available");
  await cards.getByRole("button",{name:"Use shared choice"}).click(); await expect(answer(p,0)).toHaveValue("Unavailable");
  await button(p,"Edit dinner for "+week).click(); p.once("dialog",d=>d.accept());
  await button(p,"Remove dinner").click();
  await waitFor(() => f.rows().some(r => r.kind === "dinner-plan" && r.deleted),"cleared dinner tombstone");
  assert.deepEqual(JSON.parse(f.rows().find(r => r.kind === "grocery-checks").payload).checked,["brown rice"]);
  assert.equal(f.rows().find(r => r.kind === "roll-call").deleted,0);
  const localLabel = await findRow(p,"label:robin-a");
  f.exchange([put("label","robin-a",localLabel.value,[{role:"label-person",personId:f.people[1].id}],localLabel.server.serverVersion)]);
  await pull(p);
  await expect(cards).toContainText("Previously saved attendance stays with its original diner");
  await cards.getByRole("button",{name:"Use shared choice"}).click();
  await waitFor(async () => new Map((await state(p)).s.mappings).get("robin-a") === f.people[1].id,"explicitly accepted the shared identity");
  assert.equal((await findRow(p,"roll-call:"+id)).value.availability,"Unavailable");
}));

test("historical identity collisions require a dated choice and keep the source evidence", async t => suite(t,async (f,browser) => {
  const raw = { ...legacy, [keys.labels]:JSON.stringify([labels[0],{...labels[1],kind:"Category"}]),
    [keys.roll]:JSON.stringify({[week]:{"robin-a":"Unknown","robin-b":"Available","former-label":"Unavailable"}}) };
  const {p} = await device(browser,f,{raw,sharedSession:true});
  await settings(p); await backup(p);
  const group = id => p.getByRole("group",{name:"Match Calendar people"}).locator(":scope > div").filter({hasText:id});
  await group("robin-a").locator("select").selectOption(f.people[0].id);
  await group("robin-a").getByRole("button",{name:"Confirm match"}).click(); await expect(group("robin-a")).toHaveCount(0);
  await group("robin-b").locator("select").selectOption(f.people[0].id);
  await group("robin-b").getByRole("button",{name:"Confirm match"}).click();
  await expect(advanced(p).getByRole("alert")).toContainText("Choose which attendance response");
  assert.equal((await findRow(p,"legacy-attendance:"+week+":robin-b")).value.availability,"Available");
  await group("robin-b").getByLabel("Different responses for "+week,{exact:false}).selectOption("label");
  await group("robin-b").getByRole("button",{name:"Confirm match"}).click();
  await expect(group("robin-b")).toHaveCount(0);
  assert.equal((await findRow(p,"roll-call:"+week+":"+f.people[0].id)).value.availability,"Available");
  assert.equal((await findRow(p,"label:robin-b")).people.length,0);
  await p.getByLabel("I saved my backup",{exact:false}).check(); await button(p,"Download for comparison").click();
  await button(p,"Approve reconciliation").click();
  await waitFor(() => f.rows().some(r => r.kind === "event"),"unrelated entries shared");
  assert.equal(f.rows().filter(r => r.kind === "roll-call").length,1);
  assert.equal((await findRow(p,"legacy-attendance:"+week+":former-label")).value.availability,"Unavailable");
  const file = await backup(p); assert.equal(file.raw[keys.roll],raw[keys.roll]);
  assert.equal(file.calendar.evidence.find(e => e.data?.label === "robin-b").data.differences.length,1);
}));

test("lost Space creation, unsupported remote history, incompatible IDs and bounded UTF-8 batches", async t => suite(t,async (f,browser) => {
  const old = {id:"former",title:"Historical format",date:"2020-01-01"};
  f.exchange([put("event",old.id,old)]); f.unsupportedHistory(old.id);
  const notes = String.fromCharCode(233).repeat(25000);
  const events = Array.from({length:35},(_,i) => ({id:"bounded-"+i,title:"History "+i,date:"2020-01-01",notes}));
  events.push({...old,id:"oversize",notes:notes+notes},{...old,id:"legacy id"});
  const {p} = await device(browser,f,{raw:{[keys.events]:JSON.stringify(events)},sharedSession:true});
  await settings(p); await p.getByText("Create a shared Space",{exact:true}).click();
  await p.getByLabel("New Space name").fill("Other household Space"); f.faults.loseSpaceCreation = true;
  await button(p,"Create shared Space").click(); await expect(advanced(p).getByRole("alert")).toBeVisible();
  assert.equal(f.spaces().filter(s => s.name === "Other household Space").length,1);
  f.faults.loseSpaceCreation = false;
  await button(p,"Create shared Space").click();
  await expect(p.getByLabel("Shared Space",{exact:true})).toContainText("Other household Space");
  assert.equal(f.spaces().filter(s => s.name === "Other household Space").length,1);
  await p.getByLabel("Shared Space",{exact:true}).selectOption(f.space.id);
  await connect(p,f); await button(p,"Approve reconciliation").click();
  await waitFor(() => f.rows().length === 36,"all eligible records accepted");
  const attempts = f.requests.filter(r => r.body?.changes.length);
  assert.ok(attempts.length >= 3);
  for (const {body} of attempts) { assert.ok(body.changes.length <= 32); assert.ok(Buffer.byteLength(JSON.stringify(body)) < 1048576); }
  assert.equal(f.rows().some(r => r.id === "oversize" || r.id === "legacy id"),false);
  const retained = await state(p);
  assert.equal(retained.rows.find(r => r.id === "oversize").value.notes.length,50000);
  assert.equal(retained.rows.find(r => r.id === "former").server.schemaVersion,2);
  await expect(status(p)).toHaveText("Attention needed"); await expect(p.getByRole("group",{name:"Conflicting entries"})).toContainText("Unsupported shared record");
}));

test("visible poll, transactional save rollback, and safe recovery of an offline outbox export", async t => suite(t,async (f,browser) => {
  const {ctx,p} = await device(browser,f,{sharedSession:true,clock:true});
  await connect(p,f); await approve(p);
  const requests = f.requests.length;
  f.exchange([put("event","poll",{id:"poll",title:"Visible poll",date:"2020-01-01"})]);
  await p.clock.fastForward(61000);
  await expect(button(p,"Edit Visible poll")).toBeVisible();
  await expect(status(p)).toHaveText("Synced");
  assert.equal(f.requests.slice(requests).filter(r => r.body).length,1);
  await ctx.setOffline(true);
  await p.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      if (this.name === "settings") { IDBObjectStore.prototype.put = put; this.transaction.abort(); throw Error("Synthetic disk failure"); }
      return put.apply(this,args);
    };
  });
  const form = p.locator("section[aria-labelledby=manage-events-heading]");
  await form.getByLabel("Title",{exact:true}).fill("Unsent draft"); await button(form,"Add event").click();
  await expect(form.getByRole("alert")).toContainText("Synthetic disk failure");
  assert.equal((await state(p)).rows.length,1);
  assert.equal((await state(p)).rows.flatMap(r => r.queue).length,0);
  await button(form,"Add event").click(); await expect(form.getByRole("status")).toHaveText("Event added.");
  const file = await backup(p), original = file.calendar.records.find(r => r.value?.title === "Unsent draft");
  assert.equal(original.queue.length,1); assert.equal(f.rows().length,1);
  const {p:blank} = await device(browser,f,{sharedSession:true}); await settings(blank);
  await blank.getByText("Recover a backup",{exact:true}).click();
  blank.once("dialog", d=>d.accept());
  await blank.getByLabel("Calendar backup").setInputFiles({name:"pending.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(file))});
  await expect(blank.getByText("Recovered on this device.",{exact:false})).toBeVisible();
  const recovered = await state(blank);
  assert.equal(recovered.s.space,file.calendar.settings.space); assert.notEqual(recovered.s.device,file.calendar.settings.device);
  const evidence = await backup(blank);
  const prior = JSON.parse(evidence.calendar.evidence.find(e => e.reason.startsWith("Complete imported file")).data);
  assert.deepEqual(prior.calendar.records.find(r => r.key === original.key).queue,original.queue);
  assert.equal(f.ops().filter(op => op.operation_id === original.queue[0].id).length,0);
  await connect(blank,f); await button(blank,"Approve reconciliation").click();
  const cards = blank.getByRole("group",{name:"Conflicting entries"}).locator("article");
  await expect(cards).toHaveCount(2); assert.equal(f.rows().length,1);
  await cards.filter({hasText:"Unsent draft"}).getByRole("button",{name:"Keep device choice"}).click();
  await cards.filter({hasText:"Visible poll"}).getByRole("button",{name:"Use shared choice"}).click();
  await expect(status(blank)).toHaveText("Synced",{timeout:12000}); assert.equal(f.rows().length,2);
  assert.equal(f.ops().some(op => op.operation_id === original.queue[0].id),false);
}));

test("legacy portable backups, reviewed ID correction, directory creation and paused sign-out", async t => suite(t,async (f,browser) => {
  const oldLabel = {id:"old label",kind:"Person",color:"#123456",name:"Past diner"};
  const event = {id:"legacy-event",date:week,title:"Legacy event",labelId:oldLabel.id};
  let p;
  for (const version of [1,2]) {
    p = (await device(browser,f,{sharedSession:true})).p;
    await settings(p); await p.getByText("Recover a backup",{exact:true}).click();
    const file = {format:"family-calendar-backup",version,events:[event],labels:[oldLabel],
      ...(version === 2 ? {dinners:{[week]:meal},groceries:{[week]:["beans"]}} : {})};
    p.once("dialog",d=>d.accept());
    await p.getByLabel("Calendar backup").setInputFiles({name:"legacy.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(file))});
    await expect(p.getByText("Recovered on this device.",{exact:false})).toBeVisible();
    assert.equal((await state(p)).rows.length,version === 1 ? 2 : 4); assert.equal(f.rows().length,0);
  }
  await p.getByText("Records needing review",{exact:true}).click();
  await p.getByLabel("New ID for old label").fill("past-diner"); p.once("dialog",d=>d.accept());
  await button(p,"Confirm ID change").click();
  await waitFor(async () => (await findRow(p,"event:legacy-event")).value.labelId === "past-diner","label references corrected atomically");
  await p.getByText("Create a directory Person",{exact:true}).click(); await p.getByLabel("New Person name").fill("Past directory diner");
  await button(p,"Create directory Person").click(); const matches = p.getByRole("group",{name:"Match Calendar people"});
  await expect(matches.locator("select")).toContainText("Past directory diner");
  const person = (await state(p)).s.people.find(v => v.displayName === "Past directory diner");
  await matches.locator("select").selectOption(person.id); await button(matches,"Confirm match").click();
  await connect(p,f); await approve(p);
  await button(p,"Pause sync").click(); await expect(button(p,"Resume sync")).toBeVisible();
  await button(p,"Sign out").click(); await expect(status(p)).toHaveText("Sign in required");
  await saveEvent(p,"Saved while signed out"); await p.reload(); await expect(status(p)).toHaveText("Sign in required");
  const saved = await state(p); assert.equal(saved.s.space,f.space.id); assert.equal(saved.s.paused,true);
  assert.ok(saved.rows.some(r => r.value?.title === "Saved while signed out" && r.queue.length));
  const opCount = f.ops().length; await login(p); assert.equal(f.ops().length,opCount);
  await button(p,"Resume sync").click(); await expect(status(p)).toHaveText("Synced",{timeout:12000});
  await p.getByLabel("Dinner availability for Past diner on "+week,{exact:true}).selectOption("Unknown");
  await waitFor(() => f.rows().some(r => r.id === week+":"+person.id),"explicit response uploaded");
  await button(p,"Edit label Past diner").click();
  await p.getByLabel("Label type").selectOption("Category"); await button(p,"Save label").click();
  await waitFor(() => f.rows().some(r => r.id === "past-diner" && JSON.parse(r.payload).kind === "Category"),"label conversion saved");
  const converted = await findRow(p,"label:past-diner"); assert.equal(converted.people.length,0);
  assert.ok((await state(p)).s.people.some(v => v.id === person.id && !v.archived));
  assert.equal(JSON.parse(f.rows().find(r => r.id === week+":"+person.id).payload).availability,"Unknown");
  // Simulate an already-open older release. Only its changed source is held.
  await p.evaluate(k => localStorage.setItem(k,JSON.stringify({"2020-01-01":{name:"Older tab",ingredients:[]}})),keys.dinners);
  await p.reload(); await settings(p); await expect(p.getByRole("group",{name:"Changes from an older Calendar tab"})).toContainText("dinner-plan");
  await saveEvent(p,"Unaffected entry");
  await waitFor(() => f.rows().some(r => r.payload?.includes("Unaffected entry")),"unrelated edits still share during review");
  const originalFile = await backup(p);
  assert.ok(originalFile.raw[keys.dinners].includes("Older tab"));
  await button(p,"Keep this Calendar and retain older edits in backup").click();
  await expect(status(p)).toHaveText("Synced",{timeout:12000});
  assert.ok(!f.rows().some(r => r.payload?.includes("Older tab")));
}));
