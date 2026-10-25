import worker from "./index.js";

// --- a tiny D1 stand-in that records what would be executed -------------
function makeDB() {
  const log = { prepared: [], batch: [], all: [] };
  const db = {
    prepare(sql) {
      const rec = { sql, binds: [] };
      log.prepared.push(rec);
      return {
        bind(...args) { rec.binds = args; return this; },
        async run() { return { success: true }; },
        async all() {
          log.all.push({ sql, binds: rec.binds });
          return { results: rec.__rows || [] };
        },
      };
    },
    async batch(stmts) { log.batch.push(stmts.length); return stmts.map(() => ({ success: true })); },
  };
  return { db, log };
}

const TOKEN = "secret-token";
let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const call = async (env, path, opts = {}) => {
  const res = await worker.fetch(new Request("https://x" + path, opts), env);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body, headers: res.headers };
};

// 1. auth
{
  const { db } = makeDB();
  const env = { DB: db, NEERAJ_TOKEN: TOKEN };
  const r = await call(env, "/api/history");
  check("no token -> 403", r.status === 403, `got ${r.status}`);
  const r2 = await call(env, `/api/history?k=wrong`);
  check("wrong token -> 403", r2.status === 403);
  const r3 = await call(env, `/api/history?k=${TOKEN}`);
  check("right token -> 200", r3.status === 200);
  const r4 = await call(env, "/api/history", { headers: { "X-Neeraj-Token": TOKEN } });
  check("header token -> 200", r4.status === 200);
}

// 2. CORS + health
{
  const { db } = makeDB();
  const env = { DB: db, NEERAJ_TOKEN: TOKEN };
  const pre = await worker.fetch(new Request("https://x/api/history", { method: "OPTIONS" }), env);
  check("OPTIONS -> 204", pre.status === 204);
  check("CORS header present", pre.headers.get("Access-Control-Allow-Origin") === "*");
  const h = await call(env, "/api/health");
  check("health works without a token", h.status === 200 && h.body.ok === true);
}

// 3. sync is idempotent and batched
{
  const { db, log } = makeDB();
  const env = { DB: db, NEERAJ_TOKEN: TOKEN };
  const payload = {
    messages: [
      { id: "m1", session_id: "web", role: "user", content: "hi", ts: 1000 },
      { id: "m2", session_id: "web", role: "assistant", content: "hello", ts: 2000 },
      { content: "no id - skipped" },
    ],
    reminders: [{ id: "r1", text: "revisit vamsi", due_at: 5000 }],
  };
  const r = await call(env, `/api/sync?k=${TOKEN}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  check("sync writes 3 rows (2 messages + 1 reminder)", r.body.written === 3, JSON.stringify(r.body));
  check("uses INSERT OR IGNORE", log.prepared.every((p) => p.sql.includes("INSERT OR IGNORE")));
  check("single batch call", log.batch.length === 1);
}

// 4. empty sync
{
  const { db } = makeDB();
  const env = { DB: db, NEERAJ_TOKEN: TOKEN };
  const r = await call(env, `/api/sync?k=${TOKEN}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  check("empty sync -> written 0", r.body.written === 0);
}

// 5. notes (offline voice capture)
{
  const { db } = makeDB();
  const env = { DB: db, NEERAJ_TOKEN: TOKEN };
  const r = await call(env, `/api/notes?k=${TOKEN}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "met vamsi, revisit tomorrow", lang: "en-IN" }),
  });
  check("note stored with an id", r.status === 200 && r.body.stored === true && !!r.body.id);
  const bad = await call(env, `/api/notes?k=${TOKEN}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "  " }),
  });
  check("empty note -> 400", bad.status === 400);
}

// 6. 404 + method
{
  const { db } = makeDB();
  const env = { DB: db, NEERAJ_TOKEN: TOKEN };
  const r = await call(env, `/api/nope?k=${TOKEN}`);
  check("unknown GET -> 404", r.status === 404);
  const r2 = await call(env, `/api/nope?k=${TOKEN}`, { method: "POST", body: "{}" });
  check("unknown POST -> 404", r2.status === 404);
}

// 7. cron fires due reminders
{
  const { db, log } = makeDB();
  const env = { DB: db, NEERAJ_TOKEN: TOKEN };
  // make the due query return two reminders
  const origPrepare = db.prepare;
  db.prepare = (sql) => {
    const stmt = origPrepare(sql);
    if (sql.includes("notified_at IS NULL")) {
      stmt.all = async () => ({ results: [{ id: "r1" }, { id: "r2" }] });
    }
    return stmt;
  };
  const pending = [];
  await worker.scheduled({}, env, { waitUntil: (p) => pending.push(p) });
  check("cron marks 2 reminders notified", log.batch.length === 1 && log.batch[0] === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
