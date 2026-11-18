import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const [port, certPin, commit] = process.argv.slice(2);
const origin = "https://127.0.0.1:" + port;
const base = origin + "/apps/calendar/";
const browser = await chromium.launch({ args: ["--ignore-certificate-errors-spki-list=" + certPin] });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", req => {
    if (new URL(req.url()).origin !== origin || req.url().includes("/exchange")) errors.push(req.url());
  });
  page.on("requestfailed", req => {
    if (!req.url().startsWith(origin + "/api/v1/")) errors.push(req.url());
  });
  page.on("response", res => {
    if (res.status() >= 400 && !res.url().startsWith(origin + "/api/v1/")) errors.push(res.url());
  });
  // Seed sibling data and the household's existing API-path, HttpOnly cookie.
  await page.goto(origin + "/apps/workout/");
  await page.evaluate(async () => {
    localStorage.setItem("workout-smoke", "keep");
    const db = indexedDB.open("workout-companion", 1);
    db.onupgradeneeded = () => db.result.createObjectStore("workout-smoke");
    await new Promise((resolve, reject) => { db.onsuccess = resolve; db.onerror = reject; });
    db.result.close();
    await caches.open("workout-smoke");
  });
  await context.addCookies([{ name: "fixture", value: "household", domain: "127.0.0.1",
    path: "/api/v1/", secure: true, httpOnly: true, sameSite: "Strict" }]);
  await page.goto(base.slice(0, -1));
  assert.equal(page.url(), base);
  const month = page.getByRole("button", { name: "Month", exact: true });
  await month.click();
  await page.getByRole("navigation", { name: "Month navigation" }).waitFor();
  await page.getByText("Advanced sync settings", { exact: true }).click();
  await page.getByRole("button", { name: "Sign out" }).waitFor();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  const marker = await page.evaluate(async () => (await fetch("./release.json")).json());
  assert.equal(marker.commit, commit);
  const cachePaths = await page.evaluate(async base => {
    const sw = navigator.serviceWorker;
    const registration = await sw.getRegistration();
    if (!isSecureContext || registration.scope !== base || sw.controller.scriptURL !== base + "sw.js")
      throw Error("Incorrect worker or scope");
    for (const path of ["/apps/workout/", "/api/v1/"]) {
      if (await sw.getRegistration(path)) throw Error("Worker controls " + path);
      let denied = false;
      try {
        await sw.register(base + "sw.js", { scope: path });
      } catch (error) {
        denied = error.name === "SecurityError";
      }
      if (!denied) throw Error("Browser did not block worker scope " + path);
    }
    const names = await caches.keys();
    if (!names.includes("workout-smoke")) throw Error("Sibling cache lost");
    const owned = names.filter(n => n.startsWith("family-calendar-shell:" + base + ":"));
    if (owned.length !== 1) throw Error("Expected one scoped Calendar cache");
    return (await (await caches.open(owned[0])).keys()).map(r => r.url).sort();
  }, base);
  const shell = Object.keys(marker.files).filter(p => ![".vite/manifest.json", "sw.js"].includes(p));
  assert.deepEqual(cachePaths, shell.map(p => base + p).sort());
  for (const [path, expected] of [["", "no-cache"], ["sw.js", "no-cache"], ["register-offline.js", "no-cache"],
    ["calendar.webmanifest", "no-cache"], ["release.json", "no-cache"],
    [shell.find(p => p.endsWith(".css")), "max-age=31536000"]]) {
    const response = await page.request.get(base + path, { ignoreHTTPSErrors: true });
    assert.equal(response.headers()["cache-control"], expected);
    assert.equal(response.headers()["x-content-type-options"], "nosniff");
  }
  for (const path of [".vite/manifest.json", "assets/absent.js", "missing.js"]) {
    const response = await page.request.get(base + path, { ignoreHTTPSErrors: true });
    assert.equal(response.status(), 404);
  }
  const deviceId = () => page.evaluate(async () => {
    const open = indexedDB.open("family-calendar-sync");
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result); open.onerror = reject;
    });
    const get = db.transaction("settings").objectStore("settings").get("calendar");
    const settings = await new Promise((resolve, reject) => {
      get.onsuccess = () => resolve(get.result); get.onerror = reject;
    });
    db.close();
    return settings.device;
  });
  const device = await deviceId();
  assert.match(device, /^[a-f\d-]{36}$/);
  const logout = page.waitForResponse(r => r.url() === origin + "/api/v1/auth/logout");
  await page.getByRole("button", { name: "Sign out" }).click();
  assert.equal((await logout).status(), 204, "same-origin session cookie and CSRF header");
  await page.reload();
  await page.getByRole("navigation", { name: "Month navigation" }).waitFor();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("navigation", { name: "Month navigation" }).waitFor();
  assert.equal(await deviceId(), device);
  assert.equal(await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    return localStorage.getItem("workout-smoke") === "keep" && dbs.some(d => d.name === "workout-companion");
  }), true);
  const offlineAPI = await page.evaluate(() => fetch("/api/v1/auth/session").then(() => "served", () => "offline"));
  assert.equal(offlineAPI, "offline");
  assert.deepEqual(errors, []);
  console.log("Chromium passed Calendar navigation, HTTPS, cookie/CSRF, storage, cache scope and offline reload.");
} finally {
  await browser.close();
}
