# Deploying NEERAJ Pocket

Three things to do: push the repo, deploy to Cloudflare Pages, and (if you
want access away from home) put a tunnel in front of your backend.

---

## 1. Push this repository to GitHub

The repo is already at
<https://github.com/builderstore99-eng/store>. From the folder containing this
project:

```bat
git init
git add .
git commit -m "NEERAJ Pocket: mobile web app for a local NEERAJ"
git branch -M main
git remote add origin https://github.com/builderstore99-eng/store.git
git push -u origin main
```

If the remote already has commits you want to keep, pull first:

```bat
git pull --rebase origin main
git push -u origin main
```

If GitHub asks for a password, it wants a **personal access token**, not your
account password: *Settings → Developer settings → Personal access tokens →
Fine-grained tokens*, with **Contents: Read and write** on this repository.
Never paste that token into a chat or a file in this repo.

## 2. Deploy to Cloudflare Pages

### Option A — with wrangler (quickest)

```bat
npx wrangler login
npx wrangler pages deploy .
```

It prints a `*.pages.dev` URL when it finishes. Every later `pages deploy .`
publishes an update.

### Option B — connect the GitHub repo (deploys on every push)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**.
2. Pick `builderstore99-eng/store`.
3. Build settings: **Framework preset: None**, **Build command: (leave empty)**,
   **Build output directory: `/`**.
4. **Save and Deploy.**

From then on, pushing to `main` redeploys automatically.

### Option C — GitHub Actions

`.github/workflows/deploy.yml` is included. Add two repository secrets
(*Settings → Secrets and variables → Actions*):

| Secret | Where to get it |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → *Edit Cloudflare Workers* template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard, right-hand column of the Workers & Pages overview |

## 3. Point the app at your NEERAJ

Open the deployed site, press ⚙, and enter the backend address and token that
`neeraj web` printed.

### Making it reachable from anywhere (the tunnel)

A page on `https://…pages.dev` **cannot** call `http://192.168.x.x:8765` —
browsers block mixed content. Use a Cloudflare Tunnel:

```bat
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:8765
```

It prints a URL like `https://random-words.trycloudflare.com`. That is your
backend address — put it in the app's settings, or in the Pages environment
variables below.

> A `trycloudflare.com` URL is temporary: it changes each time you restart the
> tunnel. For a permanent one, create a named tunnel in the Cloudflare
> dashboard and point a subdomain at it.

### Important: drag-and-drop does not support Pages Functions

If you deploy by **dragging a zip** into the dashboard, Cloudflare will not run
the `functions/` directory — the upload rejects it. That build has no proxy, so
the app talks to your backend **directly** and needs the token entered in ⚙.

Pages Functions (and therefore the proxy) work when you deploy with
**wrangler** or a **Git connection**:

```bat
npx wrangler pages deploy .
```

So:

| How you deploy | Proxy available? | Token needed in the browser? |
| --- | --- | --- |
| Drag-and-drop zip | no | yes, entered in ⚙ |
| `wrangler pages deploy .` | yes | no, if env vars are set |
| Git-connected project | yes | no, if env vars are set |

### Hiding the token from the browser (optional)

On the Pages project, **Settings → Environment variables**:

| Variable | Value |
| --- | --- |
| `NEERAJ_BACKEND` | your tunnel URL |
| `NEERAJ_TOKEN` | the token from `neeraj web` |

Make `NEERAJ_TOKEN` a **secret** (encrypted). With both set,
`functions/api/[[path]].js` proxies every `/api/*` call server-side, so the
phone holds no credential at all. Redeploy after changing them.

---

## Testing locally before you deploy

```bat
npx wrangler pages dev .
```

That serves the site *and* the proxy function, so you can check the whole path
before it is public.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Failed: the token was rejected` | the `k=` value is wrong or NEERAJ restarted (a fresh token is generated each run) |
| `Failed: Failed to fetch` | the phone is on a different network, or the backend address is `http://` while the page is `https://` — use a tunnel |
| The dot stays red | the backend is not running: start `neeraj web` again |
| No reply at all | NEERAJ has no model loaded; check `neeraj models` on the computer |
| Mic button greyed out | the browser has no speech recognition — Chrome on Android, or Safari on iOS 14.5+ |
| Voice speaks English, not Telugu | the phone has no Telugu voice installed (Android: Settings → System → Languages → Text-to-speech) |
| `403` on every call | the token is missing; re-enter it in ⚙ |

## What not to do

**Do not port-forward your router** to expose NEERAJ to the internet. Use a
tunnel, which gives you HTTPS and a token-protected endpoint, and can be shut
off instantly.
