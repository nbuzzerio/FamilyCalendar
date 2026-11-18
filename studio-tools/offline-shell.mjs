import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Only the current build's static entry and its hashed dependencies belong in the offline cache.
async function writeOfflineShell(dir) {
  const manifest = JSON.parse(await readFile(join(dir, ".vite/manifest.json"), "utf8"));
  const page = join(dir, "index.html");
  const html = await readFile(page, "utf8");
  await writeFile(page, html.replace("</head>", '<link rel="manifest" href="./calendar.webmanifest"><script defer src="./register-offline.js"></script></head>'));
  await writeFile(join(dir, "register-offline.js"), 'if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});\n');
  await writeFile(join(dir, "calendar.webmanifest"), JSON.stringify({ name: "Family Calendar", short_name: "Calendar", start_url: "./", scope: "./", display: "standalone", theme_color: "#355d39", background_color: "#f6f8f5" }));
  const files = ["index.html", "register-offline.js", "calendar.webmanifest", ...new Set(Object.values(manifest).flatMap(v => [v.file, ...(v.css ?? []), ...(v.assets ?? [])]))];
  const hash = createHash("sha256");
  for (const file of files) hash.update(await readFile(join(dir,file)));
  await writeFile(join(dir,"sw.js"), `const prefix = "family-calendar-shell:" + self.registration.scope + ":";
const name = prefix + ${JSON.stringify(hash.digest("hex").slice(0,20))};
const files = ${JSON.stringify(files)}.map(file => new URL(file, self.registration.scope).href);
const home = new URL("./", self.registration.scope).href;
self.addEventListener("install", event => event.waitUntil(caches.open(name).then(cache => cache.addAll(files.map(url => new Request(url, { cache: "reload" }))))));
self.addEventListener("activate", event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith(prefix) && key !== name) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url); url.search = ""; url.hash = "";
  const path = url.href === home ? files[0] : url.href;
  if (!files.includes(path)) return;
  event.respondWith(caches.open(name).then(async cache => await cache.match(path) || fetch(req)));
});
`);
}
await writeOfflineShell("dist");
