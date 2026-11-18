import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("../", import.meta.url));
const load = path => import(new URL("../../personal-sync-service/dist/src/" + path, import.meta.url));
const toolchain = createRequire(new URL("../../workout-companion/package.json", import.meta.url));
export const { chromium, expect } = toolchain("@playwright/test");
export const password = "synthetic-calendar-passphrase-only";
export async function fixture() {
  const [{ openDatabase, migrate }, { bootstrapOwner }, { createApp }, { configFromEnv }, directory, sync, backups] =
    await Promise.all(["db/database.js","auth/auth.js","http/app.js","config.js","domain/directory.js","sync/exchange.js","db/backup.js"].map(load));
  const base = join(root, ".dev","sync-tests");
  await mkdir(base,{recursive:true});
  const dir = await mkdtemp(join(base,"isolated-")), path = join(dir,"calendar.sqlite"), backupDir = join(dir,"backups");
  let db = openDatabase(path);
  migrate(db);
  const owner = await bootstrapOwner(db,"synthetic-owner",password);
  const requests = [];
  let app;
  const faults = { loseNextWrite: false, loseSpaceCreation: false, slow: false, activeExchanges: 0, maxExchanges: 0 };
  const server = createServer(async (req,res) => {
    const url = new URL(req.url,"http://127.0.0.1");
    if (url.pathname.startsWith("/api/v1/")) {
      const exchange = url.pathname.endsWith("/exchange");
      const trace = { path:url.pathname };
      requests.push(trace);
      if (url.pathname === "/api/v1/spaces" && req.method === "POST" && faults.loseSpaceCreation) {
        res.end = function() { trace.lost = true; res.destroy(); return res; };
      }
      if (exchange) {
        faults.activeExchanges++;
        faults.maxExchanges = Math.max(faults.maxExchanges,faults.activeExchanges);
        res.once("close",() => faults.activeExchanges--);
        const end = res.end;
        res.end = function(...args) {
          trace.body = req.body;
          if (faults.loseNextWrite && req.body?.changes?.length && res.statusCode === 200) {
            faults.loseNextWrite = false; trace.lost = true; res.destroy(); return res;
          }
          if (faults.slow) { setTimeout(() => end.apply(this,args),125); return this; }
          return end.apply(this,args);
        };
      }
      return app(req,res);
    }
    if (!url.pathname.startsWith("/calendar/")) { res.writeHead(404).end(); return; }
    const asset = url.pathname.slice(10) || "index.html";
    if (!/^(index\.html|sw\.js|register-offline\.js|calendar\.webmanifest|assets\/[\w.-]+)$/.test(asset)) { res.writeHead(404).end(); return; }
    try {
      const data = await readFile(resolve(root,"dist",asset));
      res.writeHead(200, { "Content-Type": ({".html":"text/html",".css":"text/css",".js":"text/javascript",".webmanifest":"application/manifest+json"})[extname(asset)] }).end(data);
    } catch { res.writeHead(404).end(); }
  });
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  const config = configFromEnv({NODE_ENV:"test", PUBLIC_ORIGIN:origin, DATABASE_PATH:path, BACKUP_DIR:backupDir});
  app = createApp(db,config,() => {});
  const people = ["Robin","Robin"].map(displayName => directory.createPerson(db,owner,{id:crypto.randomUUID(),displayName}));
  const space = directory.createSpace(db,owner,{id:crypto.randomUUID(),name:"Household Calendar",kind:"shared"});
  directory.createSpace(db,owner,{id:crypto.randomUUID(),name:"Personal workouts",kind:"personal"});
  return { origin, url:origin+"/calendar/", space, people, dir, requests, faults,
    rows: () => db.prepare("SELECT * FROM records WHERE app_id='family-calendar'").all(),
    ops: () => db.prepare("SELECT * FROM sync_operations WHERE app_id='family-calendar'").all(),
    spaces: () => db.prepare("SELECT * FROM spaces").all(),
    unsupportedHistory(id) {
      // A readable pre-contract entry whose V2 value this client cannot edit.
      const change = db.prepare("SELECT seq,snapshot FROM change_log WHERE app_id='family-calendar' AND entity_id=? ORDER BY seq DESC LIMIT 1").get(id);
      const raw = JSON.parse(change.snapshot); raw.schemaVersion = 2;
      db.prepare("UPDATE change_log SET snapshot=? WHERE seq=?").run(JSON.stringify(raw),change.seq);
      db.prepare("UPDATE records SET schema_version=2 WHERE app_id='family-calendar' AND id=?").run(id);
    },
    exchange(changes) { return sync.exchange(db,owner,"family-calendar",{protocolVersion:1, appId:"family-calendar",deviceId:crypto.randomUUID(),spaceId:space.id,cursor:null,changes}); },
    renamePerson() { directory.patchPerson(db,owner,people[0].id,{baseServerVersion:"1",displayName:"Robin renamed"}); },
    expire() { db.prepare("DELETE FROM sessions").run(); },
    backup() { return backups.backup(db,backupDir); },
    restore(source) { const destination = join(dir,crypto.randomUUID()+".sqlite"); backups.restoreBackup(source,destination,path); db.close(); db = openDatabase(destination,true); app = createApp(db,config,() => {}); },
    async close() { server.closeAllConnections(); await new Promise(r => server.close(r)); db.close(); },
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const f = await fixture();
  console.log("Synthetic Family Calendar at " + f.url + "\nHousehold password: " + password + "\nSQLite fixture: " + f.dir);
  process.once("SIGINT", () => void f.close());
}
