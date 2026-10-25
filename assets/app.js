/*
 * NEERAJ Pocket - a phone front end for your own NEERAJ.
 *
 * It talks to a NEERAJ backend over HTTP and streams the reply back, so the
 * answer appears word by word. Speech in and out uses the browser's own
 * engines, so Telugu works on the phone with nothing installed anywhere else.
 *
 * Nothing is sent anywhere except your own backend.
 */

const BUILD = "2026-10-24.5";

const $ = (id) => document.getElementById(id);

const els = {
  dot: $("dot"), lang: $("lang"), speak: $("speak"), settingsBtn: $("settings-btn"),
  log: $("log"), quick: $("quick"), mic: $("mic"), input: $("input"), send: $("send"),
  sheet: $("sheet"), backend: $("backend"), token: $("token"), remember: $("remember"),
  cloud: $("cloud"),
  test: $("test"), save: $("save"), testStatus: $("test-status"),
};

const STORE = {
  get backend() { return localStorage.getItem("neeraj.backend") || ""; },
  set backend(v) { localStorage.setItem("neeraj.backend", v.replace(/\/+$/, "")); },
  get cloud() { return localStorage.getItem("neeraj.cloud") || ""; },
  set cloud(v) { localStorage.setItem("neeraj.cloud", v.replace(/\/+$/, "")); },
  get token() {
    return localStorage.getItem("neeraj.token")
      || sessionStorage.getItem("neeraj.token") || "";
  },
  set token(v) {
    const target = els.remember.checked ? localStorage : sessionStorage;
    localStorage.removeItem("neeraj.token");
    sessionStorage.removeItem("neeraj.token");
    target.setItem("neeraj.token", v);
  },
};

let state = {
  busy: false,
  speak: localStorage.getItem("neeraj.speak") === "1",
  session: localStorage.getItem("neeraj.session") || "web",
};

/* ---------------------------------------------------------------- setup */

function applySettings() {
  const stamp = document.getElementById("build");
  if (stamp) stamp.textContent = "build " + BUILD;
  els.backend.value = STORE.backend;
  els.cloud.value = STORE.cloud;
  els.token.value = STORE.token;
  els.remember.checked = Boolean(localStorage.getItem("neeraj.token"));
  els.lang.value = localStorage.getItem("neeraj.lang") || "en-IN";
  paintSpeak();
  paintDot();
}

function paintSpeak() {
  els.speak.setAttribute("aria-pressed", String(state.speak));
  els.speak.textContent = state.speak ? "🔊" : "🔈";
}

function paintDot() {
  els.dot.className = "dot " + (STORE.backend ? "online" : "offline");
  els.dot.title = STORE.backend ? "connected to " + STORE.backend : "no backend set";
}

function api(path, query = {}) {
  const url = new URL(STORE.backend + path);
  if (STORE.token) url.searchParams.set("k", STORE.token);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

/* --------------------------------------------------------------- render */

function add(text, cls, meta) {
  const el = document.createElement("div");
  el.className = "msg " + cls;
  el.textContent = text;
  if (meta) {
    const m = document.createElement("div");
    m.className = "meta";
    m.textContent = meta;
    el.appendChild(m);
  }
  els.log.appendChild(el);
  els.log.scrollTop = els.log.scrollHeight;
  return el;
}

function say(text) {
  if (!state.speak || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = els.lang.value;
  speechSynthesis.speak(utterance);
}

function setBusy(on) {
  state.busy = on;
  els.send.disabled = on;
}

/* A page served over https:// cannot call an http:// address: browsers block
 * it as mixed content. This is the single most confusing thing about hosting
 * the front end, so it is detected and explained rather than left to a
 * generic "failed to fetch". */
function mixedContentProblem() {
  if (!STORE.backend) return "";
  if (location.protocol !== "https:") return "";
  if (!STORE.backend.startsWith("http://")) return "";
  return "Your NEERAJ address starts with http://, but this page is served "
       + "over https://. Browsers block that combination outright.";
}

function advice() {
  return "Two ways round it:\n"
       + "  1. Open the link `neeraj web` prints straight on your phone — "
       + "it is served by NEERAJ itself, so there is no mismatch.\n"
       + "  2. Put a tunnel in front of NEERAJ (cloudflared tunnel --url "
       + "http://localhost:8765) and use the https:// address it gives you.";
}

function card(title, lines, buttonLabel, onClick) {
  const el = document.createElement("div");
  el.className = "msg sys card";
  const h = document.createElement("strong");
  h.textContent = title;
  el.appendChild(h);
  for (const line of lines) {
    const para = document.createElement("p");
    para.textContent = line;
    el.appendChild(para);
  }
  if (buttonLabel) {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = buttonLabel;
    btn.addEventListener("click", onClick);
    el.appendChild(btn);
  }
  els.log.appendChild(el);
  els.log.scrollTop = els.log.scrollHeight;
  return el;
}

let setupHintShown = false;

function needSetup() {
  // Only the address is strictly required. The token is asked for when the
  // backend needs it; a proxy deployment can hold it server-side instead.
  if (STORE.backend) return false;
  if (!setupHintShown) {
    setupHintShown = true;
    add("Open the settings gear and enter your NEERAJ address. "
        + "Run `neeraj web` on your computer to get it.", "sys");
  }
  openSheet();
  return true;
}

/* ----------------------------------------------------------------- chat */

async function send(forced) {
  if (state.busy) return;
  const text = (forced !== undefined ? forced : els.input.value).trim();
  if (!text) return;
  if (needSetup()) return;

  if (forced === undefined) {
    els.input.value = "";
    autoGrow();
  }
  add(text, "me");
  setBusy(true);

  const bubble = add("", "bot cursor");
  let acc = "";
  if (mixedContentProblem()) {
    bubble.remove();
    card("This address cannot work from here",
         [mixedContentProblem(), ...advice().split("\n")]);
    setBusy(false);
    return;
  }
  try {
    const response = await fetch(api("/api/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, session: state.session,
                             language: els.lang.value }),
    });
    if (!response.ok) throw new Error("server replied " + response.status);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      bubble.textContent = acc;
      els.log.scrollTop = els.log.scrollHeight;
    }
    bubble.classList.remove("cursor");
  } catch (err) {
    bubble.classList.remove("cursor");
    if (!acc) {
      bubble.remove();
      queue(text, "message");
      const note = document.createElement("div");
      note.className = "msg me pending";
      note.textContent = text;
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = "saved on this device — will sync when NEERAJ is back";
      note.appendChild(meta);
      els.log.appendChild(note);
      els.log.scrollTop = els.log.scrollHeight;
    } else {
      add(acc + "\n\n[connection lost]", "sys");
    }
    paintDot();
  }
  if (acc) say(acc);
  setBusy(false);
}

async function loadHistory() {
  if (!STORE.backend) {
    card("Connect me to your NEERAJ", [
      "This page is only the front end — the AI, the model and the memory all "
      + "live in NEERAJ on your own computer.",
      "1. On your computer, run:  neeraj web",
      "2. It prints a link containing an address and a token.",
      "3. Enter it below. (The token too, unless this deployment has a proxy.)",
    ], "Enter the address", openSheet);
    openSheet();
    return;
  }
  try {
    const response = await fetch(api("/api/history", { session: state.session, limit: 40 }));
    const data = await response.json();
    if (!data.messages || !data.messages.length) {
      add("Hello. Everything we say is remembered, so you can ask me later what "
          + "happened on a particular day.", "bot");
      return;
    }
    for (const m of data.messages) {
      add(m.content, m.role === "user" ? "me" : "bot", `${m.day} ${m.time}`);
    }
    paintDot();
  } catch (err) {
    if (mixedContentProblem()) {
      card("This address cannot work from here",
           [mixedContentProblem(), ...advice().split("\n")]);
    } else {
      add("Could not reach NEERAJ: " + err.message
          + "  (is `neeraj web` still running, and is the phone on the same network?)",
          "sys");
    }
    paintDot();
  }
}

/* ------------------------------------------------------- offline outbox */

/*
 * NEERAJ lives on your computer, which is not always on. Anything captured
 * while it is unreachable is queued here and pushed to the cloud later, so a
 * thought you spoke on the train is not lost.
 *
 * The queue holds TEXT, not audio: the phone's own speech recognition has
 * already done the transcription, so nothing large is stored and no recording
 * ever leaves the device.
 */
function outbox() {
  try { return JSON.parse(localStorage.getItem("neeraj.outbox") || "[]"); }
  catch { return []; }
}
function setOutbox(items) {
  localStorage.setItem("neeraj.outbox", JSON.stringify(items.slice(-200)));
  paintQueue();
}
function queue(text, kind = "note") {
  const items = outbox();
  items.push({ id: cryptoId(), text, kind, ts: Date.now(), lang: els.lang.value });
  setOutbox(items);
}
function cryptoId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  return String(Date.now()) + Math.random().toString(16).slice(2, 10);
}
function paintQueue() {
  const n = outbox().length;
  let chip = document.getElementById("queued");
  if (!n) { if (chip) chip.remove(); return; }
  if (!chip) {
    chip = document.createElement("span");
    chip.id = "queued";
    chip.className = "queued";
    els.quick.appendChild(chip);
  }
  chip.textContent = `${n} waiting to sync`;
}

async function flushOutbox() {
  const items = outbox();
  if (!items.length) return;
  const target = STORE.cloud || STORE.backend;
  if (!target) return;
  const remaining = [];
  for (const item of items) {
    try {
      const url = new URL(target + "/api/notes");
      if (STORE.token) url.searchParams.set("k", STORE.token);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, text: item.text,
                               lang: item.lang, captured_at: item.ts }),
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
    } catch {
      remaining.push(item);          // keep it; try again next time
    }
  }
  setOutbox(remaining);
  if (items.length !== remaining.length) {
    add(`${items.length - remaining.length} note(s) synced to the cloud.`, "sys");
  }
}

window.addEventListener("online", flushOutbox);
setInterval(flushOutbox, 60000);

/* ------------------------------------------------------------- composer */

function autoGrow() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 132) + "px";
}

els.send.addEventListener("click", () => send());
els.input.addEventListener("input", autoGrow);
els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
});

els.quick.addEventListener("click", (event) => {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  if (chip.dataset.act === "clear") { els.log.innerHTML = ""; return; }
  if (chip.dataset.q) send(chip.dataset.q);
});

/* ------------------------------------------------------------- language */

els.lang.addEventListener("change", () => {
  localStorage.setItem("neeraj.lang", els.lang.value);
  if (window.speechSynthesis) speechSynthesis.cancel();
});

els.speak.addEventListener("click", () => {
  state.speak = !state.speak;
  localStorage.setItem("neeraj.speak", state.speak ? "1" : "0");
  paintSpeak();
  if (!state.speak && window.speechSynthesis) speechSynthesis.cancel();
});

/* --------------------------------------------------------------- voice */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recogniser = null;

if (!Recognition) {
  els.mic.disabled = true;
  els.mic.title = "Speech recognition is not available in this browser";
}

els.mic.addEventListener("click", () => {
  if (recogniser) { recogniser.stop(); return; }
  recogniser = new Recognition();
  recogniser.lang = els.lang.value;
  recogniser.interimResults = true;
  recogniser.continuous = false;

  let finalText = "";
  recogniser.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += piece; else interim += piece;
    }
    els.input.value = finalText || interim;
    autoGrow();
  };
  recogniser.onend = () => {
    els.mic.classList.remove("rec");
    const said = (finalText || els.input.value).trim();
    recogniser = null;
    if (said) send(said);
  };
  recogniser.onerror = (event) => {
    els.mic.classList.remove("rec");
    recogniser = null;
    if (event.error !== "aborted") add("Microphone: " + event.error, "sys");
  };

  els.mic.classList.add("rec");
  recogniser.start();
});

/* ------------------------------------------------------------ settings */

function openSheet() { els.sheet.hidden = false; }
function closeSheet() { els.sheet.hidden = true; els.testStatus.textContent = ""; }

els.settingsBtn.addEventListener("click", openSheet);
els.sheet.addEventListener("click", (event) => {
  if (event.target === els.sheet) closeSheet();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.sheet.hidden) closeSheet();
});

els.test.addEventListener("click", async () => {
  const base = els.backend.value.trim().replace(/\/+$/, "");
  const token = els.token.value.trim();
  if (!base) {
    els.testStatus.textContent = "Enter an address.";
    els.testStatus.className = "status bad";
    return;
  }
  els.testStatus.textContent = "Checking…";
  els.testStatus.className = "status";
  try {
    const url = new URL(base + "/api/history");
    if (token) url.searchParams.set("k", token);
    url.searchParams.set("limit", "1");
    const response = await fetch(url, { cache: "no-store" });
    if (response.status === 403) throw new Error("the token was rejected");
    if (!response.ok) throw new Error("server replied " + response.status);
    await response.json();
    els.testStatus.textContent = "Connected. Press Save.";
    els.testStatus.className = "status ok";
  } catch (err) {
    const mixed = (base.startsWith("http://") && location.protocol === "https:");
    els.testStatus.textContent = mixed
      ? "Blocked: an https:// page cannot call an http:// address. Use the link "
        + "`neeraj web` prints, or a tunnel URL."
      : "Failed: " + err.message
        + " — check the address, the token, and that the phone is on the same network.";
    els.testStatus.className = "status bad";
  }
});

els.save.addEventListener("click", () => {
  STORE.backend = els.backend.value.trim();
  STORE.token = els.token.value.trim();
  STORE.cloud = els.cloud.value.trim();
  paintDot();
  closeSheet();
  flushOutbox();
  if (!STORE.backend) return;
  if (mixedContentProblem()) {
    card("That address cannot work from here",
         [mixedContentProblem(), ...advice().split("\n")]);
    return;
  }
  loadHistory();
});

/* ------------------------------------------------------------------ PWA */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

/* ----------------------------------------------------------------- boot */

applySettings();
paintQueue();
flushOutbox();
loadHistory();
