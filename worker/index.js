/*
 * NEERAJ Cloud - the D1-backed store behind NEERAJ Pocket.
 *
 * What it is for
 * --------------
 * 1. HISTORY  - every turn is mirrored here, so you can read your conversations
 *               with your PC switched off.
 * 2. NOTES    - when NEERAJ is unreachable, the phone still takes voice input,
 *               queues the transcript here, and NEERAJ pulls it later.
 * 3. REMINDERS- stored here and fired by a Cron Trigger, so a reminder works
 *               even when your computer is shut down.
 *
 * Everything is idempotent: the client generates the id, and inserts are
 * "INSERT OR IGNORE", so re-sending an offline queue never duplicates.
 *
 * Auth: a single token (env.NEERAJ_TOKEN), in ?k= or the X-Neeraj-Token header.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Neeraj-Token",
  "Access-Control-Max-Age": "600",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8",
               "Cache-Control": "no-store", ...CORS },
  });

function authorised(request, env, url) {
  const supplied = url.searchParams.get("k")
    || request.headers.get("X-Neeraj-Token")
    || "";
  return Boolean(env.NEERAJ_TOKEN) && supplied === env.NEERAJ_TOKEN;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- routes */

async function history(env, url) {
  const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
  const session = url.searchParams.get("session");
  const statement = session
    ? env.DB.prepare(
        "SELECT * FROM messages WHERE session_id = ? ORDER BY ts DESC LIMIT ?"
      ).bind(session, limit)
    : env.DB.prepare("SELECT * FROM messages ORDER BY ts DESC LIMIT ?").bind(limit);
  const { results } = await statement.all();
  return json({ messages: (results || []).reverse() });
}

async function listReminders(env, url) {
  const status = url.searchParams.get("status") || "pending";
  const { results } = await env.DB.prepare(
    "SELECT * FROM reminders WHERE status = ? ORDER BY due_at ASC LIMIT 200"
  ).bind(status).all();
  return json({ reminders: results || [] });
}

async function dueReminders(env) {
  const now = Date.now();
  const { results } = await env.DB.prepare(
    "SELECT * FROM reminders WHERE status = 'pending' AND due_at <= ? ORDER BY due_at ASC"
  ).bind(now).all();
  return json({ now, reminders: results || [] });
}

async function sync(env, payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const reminders = Array.isArray(payload?.reminders) ? payload.reminders : [];
  const statements = [];

  for (const message of messages.slice(0, 200)) {
    if (!message?.id || !message?.content) continue;
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO messages (id, session_id, role, content, ts)" +
        " VALUES (?,?,?,?,?)"
      ).bind(String(message.id), String(message.session_id || "web"),
             String(message.role || "user"), String(message.content),
             Number(message.ts) || Date.now())
    );
  }

  for (const reminder of reminders.slice(0, 200)) {
    if (!reminder?.id || !reminder?.text) continue;
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO reminders (id, text, due_at, created_at, status, source)" +
        " VALUES (?,?,?,?,?,?)"
      ).bind(String(reminder.id), String(reminder.text),
             Number(reminder.due_at) || Date.now(),
             Number(reminder.created_at) || Date.now(),
             String(reminder.status || "pending"), String(reminder.source || "neeraj"))
    );
  }

  if (!statements.length) return json({ written: 0 });
  await env.DB.batch(statements);
  return json({ written: statements.length });
}

async function addNote(env, payload) {
  const text = (payload?.text || "").trim();
  if (!text) return json({ error: "empty note" }, 400);
  const id = String(payload.id || crypto.randomUUID());
  await env.DB.prepare(
    "INSERT OR IGNORE INTO notes (id, text, lang, captured_at) VALUES (?,?,?,?)"
  ).bind(id, text, String(payload.lang || ""),
         Number(payload.captured_at) || Date.now()).run();
  return json({ id, stored: true });
}

async function listNotes(env, url) {
  const since = Number(url.searchParams.get("since") || 0);
  const { results } = await env.DB.prepare(
    "SELECT * FROM notes WHERE synced = 0 AND captured_at >= ?" +
    " ORDER BY captured_at ASC LIMIT 200"
  ).bind(since).all();
  return json({ notes: results || [] });
}

async function ackNotes(env, payload) {
  const ids = Array.isArray(payload?.ids) ? payload.ids.map(String) : [];
  if (!ids.length) return json({ acked: 0 });
  const statements = ids.slice(0, 500).map((id) =>
    env.DB.prepare("UPDATE notes SET synced = 1 WHERE id = ?").bind(id));
  await env.DB.batch(statements);
  return json({ acked: statements.length });
}

async function completeReminder(env, payload) {
  const id = String(payload?.id || "");
  if (!id) return json({ error: "missing id" }, 400);
  await env.DB.prepare("UPDATE reminders SET status = ? WHERE id = ?")
    .bind(String(payload.status || "done"), id).run();
  return json({ ok: true, id });
}

/* ---------------------------------------------------------------- worker */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // A tiny public health check, so you can confirm the Worker is alive.
    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "neeraj-cloud" });
    }

    if (!authorised(request, env, url)) {
      return json({ error: "unauthorised - set NEERAJ_TOKEN and pass ?k=" }, 403);
    }

    try {
      if (request.method === "GET") {
        switch (url.pathname) {
          case "/api/history": return await history(env, url);
          case "/api/reminders": return await listReminders(env, url);
          case "/api/due": return await dueReminders(env);
          case "/api/notes": return await listNotes(env, url);
          default: return json({ error: "not found" }, 404);
        }
      }

      if (request.method === "POST") {
        const payload = await readJson(request);
        switch (url.pathname) {
          case "/api/sync": return await sync(env, payload);
          case "/api/notes": return await addNote(env, payload);
          case "/api/notes/ack": return await ackNotes(env, payload);
          case "/api/reminders/complete": return await completeReminder(env, payload);
          default: return json({ error: "not found" }, 404);
        }
      }

      return json({ error: "method not allowed" }, 405);
    } catch (err) {
      return json({ error: String(err && err.message ? err.message : err) }, 500);
    }
  },

  /*
   * Runs on a schedule, on Cloudflare - not on your computer. This is what
   * makes a reminder fire while your PC is shut down.
   *
   * It marks due reminders as notified. Delivery is whatever you have
   * configured: the Pocket app shows them on open, and if a webhook is set,
   * it is POSTed there too.
   */
  async scheduled(event, env, ctx) {
    const now = Date.now();
    const { results } = await env.DB.prepare(
      "SELECT * FROM reminders WHERE status = 'pending' AND due_at <= ?" +
      " AND notified_at IS NULL LIMIT 100"
    ).bind(now).all();

    const due = results || [];
    if (!due.length) return;

    const statements = due.map((reminder) =>
      env.DB.prepare("UPDATE reminders SET notified_at = ? WHERE id = ?")
        .bind(now, reminder.id));

    if (env.REMINDER_WEBHOOK) {
      ctx.waitUntil(
        fetch(env.REMINDER_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reminders: due }),
        }).catch(() => {})
      );
    }

    await env.DB.batch(statements);
  },
};
