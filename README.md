<div align="center">

# NEERAJ Pocket

**A phone front end for your own NEERAJ — your local AI, in your pocket.**

Static site · no build step · no framework · no tracking

</div>

---

## What this is

A small, mobile-first web app that talks to a **NEERAJ** backend running on
your own computer. Ask it things, speak to it, have it speak back — and
because NEERAJ stores every conversation permanently, you can ask it later
*"what happened on the day we visited the site?"* and get a real answer.

**Nothing is sent to a third party.** There is no analytics, no CDN, no
account. The page is static; the thinking happens on your machine.

## What you need

1. **NEERAJ running on a computer**, with its web server started:

   ```bat
   neeraj web
   ```

   It prints two links, one of them for your phone, each carrying an access
   token. That token is what this app asks for.

2. **This app**, either opened from the link NEERAJ printed (it serves the same
   page) or deployed to Cloudflare Pages from this repository.

## Quick start

```bat
git clone https://github.com/builderstore99-eng/store.git
cd store
npx serve .        # or: python -m http.server 8080
```

Open it, press the ⚙ gear, and enter:

| Field | What to put there |
| --- | --- |
| **Backend URL** | the address NEERAJ printed, e.g. `http://192.168.1.4:8765` |
| **Access token** | the `k=` value from the printed link |

Press **Test**, then **Save**. That is the whole setup.

## Features

| | |
| --- | --- |
| **Streaming replies** | the answer appears word by word, not after a long silence |
| **Speak to it** | the 🎙 button uses your phone's own speech recognition |
| **It speaks back** | the 🔈 toggle reads replies aloud with your phone's voices |
| **Telugu and English** | switch in the header — both the mic and the voice follow it |
| **Remembers everything** | every message is stored on your machine, with a date |
| **Ask by day** | *Today*, *Yesterday*, *Recent* chips, or ask in words |
| **Installable** | add it to your home screen; it runs full-screen like an app |
| **Works offline** | the shell loads offline; only the conversation needs your computer |

## Cloud sync: history, offline notes, and reminders

`worker/` holds a Cloudflare Worker + D1 database that lets three things
survive your computer being switched off:

| | What it does |
| --- | --- |
| **History** | every turn is mirrored up, so you can read your conversations with the PC off |
| **Offline notes** | anything you say while NEERAJ is unreachable is queued on the phone and pushed here, then collected by NEERAJ later |
| **Reminders** | stored here and fired by a **Cron Trigger** — they work with the PC shut down |

```bat
npx wrangler d1 create neeraj-cloud
npx wrangler d1 execute neeraj-cloud --remote --file=worker/schema.sql
npx wrangler secret put NEERAJ_TOKEN -c worker/wrangler.toml
npx wrangler deploy -c worker/wrangler.toml
```

Put the database id into `worker/wrangler.toml` first. Then, on the NEERAJ
side:

```bat
neeraj sync --enable --url https://neeraj-cloud.you.workers.dev --token <token>
```

This is **off by default** — enabling it copies your conversation text to
Cloudflare. The local database stays the source of truth; nothing is ever
pulled down over your history.

## Deploying to Cloudflare Pages

```bat
npx wrangler pages deploy .
```

Then, optionally, set two environment variables on the Pages project
(**Settings → Environment variables**) to hide the token from the browser:

| Variable | Value |
| --- | --- |
| `NEERAJ_BACKEND` | your NEERAJ address — see the note on tunnels below |
| `NEERAJ_TOKEN` | the token NEERAJ printed |

With those set, `functions/api/[[path]].js` proxies `/api/*` server-side and
the phone never holds a credential. Without them, the app talks to your
backend directly using the settings you entered.

**Drag-and-drop uploads do not support Pages Functions**, so a zip deployed
that way has no proxy and needs the token entered in the app's settings. Use
`wrangler pages deploy .` or a Git-connected project if you want the
server-side proxy.

Full instructions, including the tunnel step and a GitHub Actions deploy
workflow, are in **[docs/DEPLOY.md](docs/DEPLOY.md)**.

## An honest note about reachability

A page served over **HTTPS cannot call an `http://` address on your home
network** — browsers block that as mixed content. So:

* **On the same Wi-Fi**, just open the link `neeraj web` prints. Simplest, and
  nothing is exposed to the internet.
* **From anywhere**, put a Cloudflare Tunnel in front of your backend:

  ```bat
  cloudflared tunnel --url http://localhost:8765
  ```

  That gives you an `https://…` address to use as `NEERAJ_BACKEND`. The token
  still protects it.

Do **not** port-forward your home router to expose NEERAJ directly.

## Security

* Every API call needs the token; anything else gets `403`.
* The token is kept in `sessionStorage` by default — it disappears when the tab
  closes. Tick *Remember on this device* to keep it.
* `_headers` sets a strict Content-Security-Policy and disables framing.
* The service worker caches the **app shell only** — never your conversation.

## Layout

```
index.html                  the app
assets/app.js               chat, streaming, voice, settings
assets/styles.css           light and dark theme
sw.js                       offline shell
manifest.webmanifest        installable app metadata
functions/api/[[path]].js   optional server-side proxy
_headers                    security headers (Cloudflare Pages)
wrangler.toml               Pages configuration
docs/DEPLOY.md              push and deploy, step by step
```

## Licence

MIT — see [LICENSE](LICENSE).
