/*
 * Optional Cloudflare Pages Function: a proxy for the NEERAJ backend.
 *
 * Why this exists
 * ---------------
 * The browser can talk to your backend directly (set the address and token in
 * the app's settings). This function is the tidier option: the token stays on
 * the server and never reaches the phone, and the backend address is hidden.
 *
 * Set two environment variables on the Pages project:
 *   NEERAJ_BACKEND   e.g. https://neeraj.yourname.workers.dev   (your tunnel)
 *   NEERAJ_TOKEN     the token printed by `neeraj web`
 *
 * If NEERAJ_BACKEND is not set, these routes are not registered and the app
 * falls back to talking to the backend directly from the browser.
 */

export async function onRequest(context) {
  const { request, env, params } = context;

  const backend = (env.NEERAJ_BACKEND || "").replace(/\/+$/, "");
  if (!backend) {
    return json({ error: "NEERAJ_BACKEND is not configured on this deployment" }, 501);
  }

  const suffix = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const incoming = new URL(request.url);
  const target = new URL(`${backend}/api/${suffix}`);

  // Server-side token: the phone never sees it.
  if (env.NEERAJ_TOKEN) target.searchParams.set("k", env.NEERAJ_TOKEN);
  for (const [key, value] of incoming.searchParams) {
    if (key !== "k") target.searchParams.set(key, value);
  }

  const headers = new Headers();
  const contentType = request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Accept", request.headers.get("Accept") || "*/*");

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.text(),
    });
  } catch (err) {
    return json({ error: "could not reach NEERAJ: " + err.message }, 502);
  }

  // Pass the body straight through, so /api/chat still streams.
  const out = new Headers(upstream.headers);
  out.set("Cache-Control", "no-store");
  out.delete("content-encoding");
  out.delete("content-length");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
