import { createApi, isDemo, configured } from "./api.js";

/* =====================================================================
   helpers
   ===================================================================== */
const app = document.getElementById("app");
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") el.value = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const svg = (tag, attrs) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); return e; };
const DAY = 864e5;
const pad = n => String(n).padStart(2, "0");
const dayKey = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const t = iso => new Date(iso).getTime();
const timeOnly = iso => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const when = iso => {
  const k = dayKey(iso), today = dayKey(Date.now()), yest = dayKey(Date.now() - DAY);
  const d = k === today ? "Today" : k === yest ? "Yesterday" : new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
  return `${d}, ${timeOnly(iso)}`;
};
const full = iso => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
const shortDate = iso => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
function rel(iso) {
  if (!iso) return "Never";
  const s = (Date.now() - t(iso)) / 1000;
  if (s < 60) return "Just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return shortDate(iso);
}
const initials = n => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/* macOS-style notification banner */
let toastT;
function toast(msg, title = "SOC Log") {
  document.querySelectorAll(".toast").forEach(e => e.remove()); clearTimeout(toastT);
  const el = h("div", { class: "toast", role: "status" }, h("span", { class: "ti" }, icon("shield")), h("div", {}, h("b", { text: title }), msg));
  document.body.append(el);
  toastT = setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 320); }, 3600);
}
/* macOS-style alert */
function confirmBox({ title, body, ok = "Confirm", danger = false }) {
  return new Promise(resolve => {
    const close = v => { scrim.remove(); box.remove(); document.removeEventListener("keydown", key); resolve(v); };
    const key = e => { if (e.key === "Escape") close(false); };
    const scrim = h("div", { class: "scrim dialog-scrim", onclick: () => close(false) });
    const box = h("div", { class: "dialog", role: "alertdialog", "aria-modal": "true" },
      h("div", { class: "icon" }, icon(danger ? "alert" : "shield")),
      h("h2", { text: title }), body ? h("p", { class: "dim", text: body }) : null,
      h("div", { class: "btns" }, h("button", { class: `btn ${danger ? "danger" : "primary"}`, type: "button", text: ok, onclick: () => close(true) }),
        h("button", { class: "btn", type: "button", text: "Cancel", onclick: () => close(false) })));
    document.body.append(scrim, box); document.addEventListener("keydown", key); box.querySelector(".btn").focus();
  });
}
/* SF Symbols-flavoured line icons */
const ICONS = {
  overview: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  coverage: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5M16 4.5a3.3 3.3 0 0 1 0 6.4M18 14.6c1.9.7 3.2 2.5 3.5 5.4",
  checklist: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
  audit: "M12 7v5l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  log: "M12 8v8M8 12h8M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
  history: "M3 13h5l1.5 3h5L16 13h5M5.5 5h13L21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6z",
  account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c.8-4 4-6 8-6s7.2 2 8 6",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z",
  lock: "M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  fingerprint: "M12 11v3c0 2.5-.6 4.6-1.7 6.3M8.5 7.5A5 5 0 0 1 17 11v1.5M7 11a5 5 0 0 1 .4-2M15 15.5c-.2 1.6-.6 3-1.2 4.3M4.5 9.5A8 8 0 0 1 19.6 8M20 12v1",
  signout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10",
  chevron: "M15 6l-6 6 6 6",
  plus: "M12 5v14M5 12h14",
  updown: "M8 9l4-4 4 4M8 15l4 4 4-4",
  arrow: "M9 6l6 6-6 6",
};
function icon(name) {
  const s = svg("svg", { class: "ico", viewBox: "0 0 24 24", "aria-hidden": "true" });
  s.append(svg("path", { d: ICONS[name] || ICONS.shield })); return s;
}
const logo = (size, cls = "") => h("img", { class: `logo ${cls}`, src: size > 200 ? "img/logo-640.webp" : size > 90 ? "img/logo-256.webp" : "img/logo-96.webp", alt: "Seton Hall University Cybersecurity SOC Team", width: size, height: size, decoding: "async" });
const hue = id => { let x = 0; for (const c of String(id || "")) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
const avatar = (id, name) => h("span", { class: "avatar", style: `--h:${hue(id)}`, text: initials(name) });
function countUp(el) {
  const target = Number(el.dataset.n); if (!isFinite(target)) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = target; return; }
  const start = performance.now(), dur = 700;
  const step = now => { const p = Math.min(1, (now - start) / dur); el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + (el.dataset.suffix || ""); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function download(name, text) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = h("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function busy(btn, label, fn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}

/* =====================================================================
   domain rules
   ===================================================================== */
const RESULTS = {
  clear: { label: "All clear", sub: "Nothing wrong found", cls: "ok" },
  handled: { label: "Found & handled", sub: "You fixed or closed it", cls: "warn" },
  escalated: { label: "Escalated", sub: "Needs a supervisor", cls: "bad" },
  incomplete: { label: "Couldn't finish", sub: "Blocked or ran out of time", cls: "" },
};
const OUTCOMES = { acknowledged: { label: "Acknowledged", cls: "brand" }, follow_up: { label: "Needs follow-up", cls: "warn" }, closed: { label: "Closed", cls: "ok" } };
const FREQ_LIMIT = { Weekly: 7, Monthly: 31, Quarterly: 92, Annually: 366 };
const FREQS = ["Continuous", "Daily", "Weekly", "Monthly", "Quarterly", "Annually", "As Needed"];
const PRIOS = ["Critical", "High", "Medium", "Low"];
const resultTag = r => { const x = RESULTS[r] || { label: r, cls: "" }; return h("span", { class: `tag ${x.cls}` }, h("i"), x.label); };
const outcomeTag = o => { const x = OUTCOMES[o]; return x ? h("span", { class: `tag ${x.cls}` }, h("i"), x.label) : null; };

function weekdaysSince(iso) {
  const a = new Date(iso); a.setHours(0, 0, 0, 0); const b = new Date(); b.setHours(0, 0, 0, 0);
  let n = 0; for (const d = new Date(a); d < b;) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}
function coverageStatus(p, lastIso) {
  if (!p.active) return { label: "Turned off", cls: "line", rank: 6 };
  if (p.frequency === "As Needed") return lastIso ? { label: "As needed", cls: "line", rank: 5 } : { label: "Not used yet", cls: "line", rank: 4 };
  if (!lastIso) return { label: "Never done", cls: "bad", rank: 0 };
  if (p.frequency === "Daily" || p.frequency === "Continuous")
    return weekdaysSince(lastIso) > 1 ? { label: "Overdue", cls: "bad", rank: 1 } : { label: "On track", cls: "ok", rank: 3 };
  return (Date.now() - t(lastIso)) / DAY > FREQ_LIMIT[p.frequency] ? { label: "Overdue", cls: "bad", rank: 1 } : { label: "On track", cls: "ok", rank: 3 };
}
function flagsOf(l) {
  const f = [];
  if ((l.details || "").trim().length < 50) f.push("Brief notes");
  const lag = (t(l.created_at) - t(l.performed_at)) / 36e5;
  if (lag >= 4) f.push(`Logged ${Math.round(lag)}h after`);
  return f;
}

/* =====================================================================
   state
   ===================================================================== */
const S = {
  api: null, settings: {}, me: null, practices: [], P: {},
  mine: [], team: null, teamAt: 0, reviews: {}, people: [], peopleById: {}, audit: [],
  authMode: "signin", authNote: null, recovering: false, clock: null,
  filters: { q: "", user: "", tool: "", result: "", status: "", from: "", to: "" },
  covFilter: { tool: "", status: "" }, peopleTab: "pending",
};
const isSup = () => S.me && S.me.role === "supervisor" && S.me.status === "active";
const nameOf = id => (S.peopleById[id] && S.peopleById[id].full_name) || (S.me && id === S.me.id ? S.me.full_name : "Unknown");
const isOpenEsc = l => l.result === "escalated" && (!S.reviews[l.id] || S.reviews[l.id].outcome === "follow_up");

function mount(...nodes) {
  clearInterval(S.clock); S.clock = null; if (S.feedTimer) { clearInterval(S.feedTimer); S.feedTimer = null; }
  document.querySelectorAll(".scrim, .drawer, .dialog").forEach(e => e.remove());
  const bar = isDemo ? demoBar() : null;
  document.documentElement.classList.toggle("has-demo", isDemo);
  app.replaceChildren(...[bar, ...nodes].filter(Boolean));
  window.scrollTo(0, 0);
}
function demoBar() {
  const kids = [configured ? "Demo mode. Sample data only, nothing you do is saved." : "Not connected to a database yet, so you're looking at sample data."];
  if (S.me && S.api && S.api.demo) {
    const other = isSup() ? ["maya.patel@shu.edu", "student"] : ["seif.abdelhamid@shu.edu", "supervisor"];
    kids.push(h("button", { type: "button", text: `Switch to the ${other[1]} view`, onclick: async () => { await S.api.signIn(other[0]); history.replaceState(null, "", location.pathname + location.search); route(); } }));
  }
  return h("div", { class: "demo-bar" }, kids);
}
function liveClock(fmt) {
  const el = h("span", { class: "num" }); const tick = () => el.textContent = fmt(new Date()); tick();
  setTimeout(() => { clearInterval(S.clock); S.clock = setInterval(tick, 1000); }); return el;
}

/* =====================================================================
   landing page (signed out)
   ===================================================================== */
function scramble(el, text) {
  const glyphs = "ABCDEF0123456789#$%&*<>/\\{}[]";
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = text; return; }
  let frame = 0; const total = 38;
  const run = () => {
    el.textContent = text.split("").map((c, i) => c === " " ? " " : i < (frame / total) * text.length ? c : glyphs[Math.floor(Math.random() * glyphs.length)]).join("");
    if (++frame <= total) requestAnimationFrame(() => setTimeout(run, 28)); else el.textContent = text;
  };
  setTimeout(run, 700);
}
function viewLanding() {
  document.documentElement.classList.add("js");
  const org = S.settings.org_name || "Seton Hall University SOC";
  const go = hash => () => { location.hash = hash; };
  const menubar = h("div", { class: "menubar" },
    h("span", { class: "app-name" }, "SOC Log"), h("span", { class: "item hide-sm", text: "Seton Hall University" }),
    h("span", { class: "item hide-sm", text: "Security Operations" }), h("span", { class: "sp" }),
    h("button", { class: "item", type: "button", text: "Sign in", onclick: go("#/signin") }),
    h("span", { class: "item clock" }, liveClock(d => d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))));

  /* the hero window: a live-looking SOC Log with entries streaming in (illustrative only) */
  const SAMPLE = [["Falcon detections triaged", "CrowdStrike", "clear"], ["User-reported phish purged", "Defender", "handled"], ["Risky sign-ins reviewed", "Entra ID", "clear"],
    ["Push-bombing denial reviewed", "Duo", "handled"], ["Encoded PowerShell on FIN-LT022", "CrowdStrike", "escalated"], ["Threat Log remediation checked", "Abnormal", "clear"],
    ["Skipped searches checked", "Splunk", "clear"], ["Bypass codes audited", "Duo", "handled"], ["ATO case worked", "Abnormal", "clear"], ["Quarantine requests reviewed", "Defender", "clear"]];
  const feed = h("div", { class: "feed", "aria-label": "Example entries" });
  const k = { n: 128, esc: 2, cov: 31 };
  const kv = { n: h("b", { text: k.n }), esc: h("b", { text: k.esc }), cov: h("b", { text: `${k.cov}/36` }) };
  let i = 0;
  const push = () => {
    const [what, tool, res] = SAMPLE[i++ % SAMPLE.length]; const now = new Date();
    const row = h("div", { class: "new" }, h("time", { text: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) }),
      h("span", { class: "w" }, what, h("small", { text: tool })), resultTag(res));
    feed.prepend(row); while (feed.children.length > 6) feed.lastChild.remove();
    kv.n.textContent = ++k.n; if (res === "escalated") kv.esc.textContent = ++k.esc;
  };
  for (let j = 0; j < 5; j++) push(); [...feed.children].forEach(c => c.classList.remove("new"));
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) setTimeout(() => { S.feedTimer = setInterval(push, 2400); }, 1600);
  const win = h("div", { class: "mac hero-win" },
    h("div", { class: "mac-bar" }, h("div", { class: "lights" }, h("i"), h("i"), h("i")), h("span", { class: "t", text: "SOC Log — Overview" })),
    h("div", { class: "mac-body" },
      h("div", { class: "mac-side" }, [["overview", "Overview", 1], ["activity", "Activity"], ["coverage", "Coverage"], ["people", "People"], ["log", "Log a check"]].map(([ic, l, on]) => h("span", { class: on ? "on" : null }, icon(ic), l))),
      h("div", { class: "mac-main" },
        h("div", { class: "row-k" }, h("div", { class: "k" }, kv.n, h("span", { text: "checks this month" })), h("div", { class: "k" }, kv.esc, h("span", { text: "open escalations" })), h("div", { class: "k" }, kv.cov, h("span", { text: "checklist coverage" }))),
        feed)));

  const headline = h("span", { class: "scramble", "aria-hidden": "true" }); scramble(headline, "every check, on the record_");
  const desk = h("section", { class: "desk" }, h("div", { class: "wallpaper" }), menubar,
    h("div", { class: "desk-body" },
      h("div", { class: "hero-copy" },
        h("div", { class: "hero-badge" }, logo(84), h("span", { class: "kicker", text: `${org} · Security Operations Center` })),
        h("h1", {}, "Hazard Zet Forward.", headline),
        h("p", { text: "The shift log for Seton Hall's security analysts. Log every check you run, prove it happened, and give your supervisor the whole picture." }),
        h("div", { class: "hero-cta" }, h("a", { class: "btn lg white", href: "#/signin", text: "Sign in" }), h("a", { class: "btn lg glass", href: "#/signup", text: "Create an account" }))),
      win),
    h("nav", { class: "dock", "aria-label": "Sections" },
      [["log", "What gets logged", "#tools"], ["coverage", "Why it holds up", "#proof"], ["people", "How it works", "#how"], ["clock", "Seton Hall", "#pride"]].map(([ic, tip, href]) =>
        h("a", { href, "data-tip": tip, "aria-label": tip, onclick: e => { e.preventDefault(); document.querySelector(href).scrollIntoView({ behavior: "smooth" }); } }, icon(ic))),
      h("span", { class: "div" }), h("a", { href: "#/signin", "data-tip": "Sign in", "aria-label": "Sign in" }, icon("lock"))));

  const tools = [["CrowdStrike", 8, "Detections, process trees, sensor health, IOCs"], ["Microsoft Defender", 9, "Incidents, phishing submissions, risky sign-ins, KQL hunts"],
    ["Splunk", 3, "Noisy searches, skipped schedules, SOC dashboards"], ["Abnormal", 6, "Threat Log, account takeover, vendor fraud"], ["Duo", 7, "Fraud reports, push bombing, bypass codes, admin log"], ["Cross-tool", 6, "Playbooks, tabletops, threat intel, post-incident reviews"]];
  const total = S.practices.length || 39;
  return mount(h("div", { class: "landing" }, desk,
    h("section", { class: "l-section", id: "tools" },
      h("h2", { text: `${total} checks across the tools the SOC runs every day.` }),
      h("p", { class: "lede", text: "Each check on the team's best-practice list comes with how often it should happen, how critical it is, and the exact click path to do it. Analysts pick it, do it, log it." }),
      h("div", { class: "tools" }, tools.map(([n, c, d]) => h("div", {}, h("span", { class: "n", text: c }), h("b", { text: n }), h("p", { text: d }))))),
    h("section", { class: "l-section", id: "proof" },
      h("h2", { text: "A record that holds up when someone asks." }),
      h("div", { class: "guarantees" },
        h("div", {}, h("span", { class: "gi" }, icon("clock")), h("h3", { text: "Stamped by the server" }), h("p", { text: "Every entry carries the analyst's account and the database's clock. Nobody can backdate a check from their browser." })),
        h("div", {}, h("span", { class: "gi" }, icon("lock")), h("h3", { text: "Permanent once saved" }), h("p", { text: "Saved entries can't be edited or deleted, by anyone. Corrections are new entries that point to the old one." })),
        h("div", {}, h("span", { class: "gi" }, icon("fingerprint")), h("h3", { text: "Least privilege, enforced" }), h("p", { text: "Analysts see only their own work. Supervisors see the team. The database enforces it, not the web page." })))),
    h("section", { class: "l-section", id: "how" },
      h("h2", { text: "From sign-up to supervisor review in four steps." }),
      h("ol", { class: "steps" },
        h("li", {}, h("h3", { text: "Create an account" }), h("p", { text: "Sign up with your @shu.edu email." })),
        h("li", {}, h("h3", { text: "Get approved" }), h("p", { text: "Your supervisor approves you from the People page." })),
        h("li", {}, h("h3", { text: "Log your checks" }), h("p", { text: "Pick the tool and check, say what you found, add the ticket." })),
        h("li", {}, h("h3", { text: "Escalations get reviewed" }), h("p", { text: "Your supervisor sees escalations right away and marks them reviewed." })))),
    h("section", { class: "pride", id: "pride" }, h("div", { class: "wallpaper" }),
      h("div", { class: "inner" },
        h("p", { class: "motto" }, "Hazard", h("span", { text: "Zet Forward." })),
        h("div", { class: "pride-side" }, logo(260, "pride-logo"),
        h("dl", {}, h("dt", { text: "University" }), h("dd", { text: "Seton Hall University" }), h("dt", { text: "Founded" }), h("dd", { text: "1856" }),
          h("dt", { text: "Home" }), h("dd", { text: "South Orange, New Jersey" }), h("dt", { text: "Team" }), h("dd", { text: "IT Security · Security Operations Center" }),
          h("dt", { text: "Status" }), h("dd", {}, liveClock(() => "Watching. " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))))))),
    h("footer", { class: "l-foot" }, h("span", { text: `${org}. Internal tool for authorized staff and student analysts.` }), h("a", { href: "#/signin", text: "Sign in" }))));
}

/* =====================================================================
   lock screen (sign in / sign up / reset)
   ===================================================================== */
function viewAuth() {
  const mode = S.recovering ? "reset" : S.authMode;
  const domain = S.settings.allowed_email_domain;
  const err = h("p", { class: "err", role: "alert" });
  const go = m => { S.authNote = null; location.hash = `#/${m}`; };
  const note = S.authNote ? h("div", { class: "notice", text: S.authNote.text }) : null;
  const email = h("input", { type: "email", id: "email", autocomplete: "email", required: true, placeholder: domain ? `you@${domain}` : "Email",
    value: isDemo && mode === "signin" ? "seif.abdelhamid@shu.edu" : "" });
  const pw = (id, ac, ph) => h("input", { type: "password", id, autocomplete: ac, required: true, minlength: "8", placeholder: ph });
  const submitBtn = text => h("button", { class: "btn primary wide", type: "submit", text });
  let title, sub, form, links, alt = null;

  if (mode === "signin") {
    title = "Sign in to SOC Log"; sub = S.settings.org_name || "Seton Hall University SOC";
    const p = pw("password", "current-password", "Password"); if (isDemo) p.value = "demo-password";
    form = h("form", { onsubmit: async e => { e.preventDefault(); err.textContent = "";
      await busy(form.querySelector("[type=submit]"), "Signing in…", async () => {
        try { await S.api.signIn(email.value.trim(), p.value); history.replaceState(null, "", location.pathname + location.search); await route(); } catch (x) { err.textContent = x.message; } }); } },
      email, p, isDemo ? h("p", { class: "help", text: "Demo: seif.abdelhamid@shu.edu (supervisor) or maya.patel@shu.edu (student), any password." }) : null, err, submitBtn("Sign in"));
    alt = altSignIn(err, go, "Sign in");
    links = [h("button", { type: "button", text: "Forgot password?", onclick: () => go("forgot") }), h("button", { type: "button", text: "Create an account", onclick: () => go("signup") })];
  } else if (mode === "code") {
    const sent = S.codeEmail;
    title = sent ? "Check your email" : "Sign in with an email link";
    sub = sent ? `We sent a sign-in link to ${sent}. Open it on this device and you'll be signed in.` : "No password needed. We'll email you a one-time sign-in link.";
    if (!sent) {
      form = h("form", { onsubmit: async e => { e.preventDefault(); err.textContent = "";
        const em = email.value.trim().toLowerCase();
        await busy(form.querySelector("[type=submit]"), "Sending…", async () => {
          try { await S.api.sendEmailCode(em); S.codeEmail = em; viewAuth(); } catch (x) { err.textContent = x.message; } }); } },
        email, err, submitBtn("Email me a link"));
    } else {
      const code = h("input", { type: "text", id: "otp", inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9]{6,10}", maxlength: "10", required: true, placeholder: "123456", class: "mono otp" });
      const codeBox = h("details", { class: "help" }, h("summary", { text: "The email has a code instead?" }),
        h("div", { class: "stack", style: "margin-top:10px" }, code, submitBtn("Sign in with code")));
      form = h("form", { onsubmit: async e => { e.preventDefault(); err.textContent = "";
        await busy(form.querySelector("[type=submit]"), "Checking…", async () => {
          try { await S.api.verifyEmailCode(sent, code.value.replace(/\s/g, "")); S.codeEmail = null; history.replaceState(null, "", location.pathname + location.search); await route(); } catch (x) { err.textContent = x.message; } }); } },
        codeBox, err);
    }
    links = [h("button", { type: "button", text: "Back to sign in", onclick: () => { S.codeEmail = null; go("signin"); } }),
      sent ? h("button", { type: "button", text: "Use a different email", onclick: () => { S.codeEmail = null; viewAuth(); } }) : null].filter(Boolean);
  } else if (mode === "signup") {
    title = "Create your account"; sub = "Your supervisor approves new accounts before you can log checks.";
    const name = h("input", { type: "text", id: "fullname", autocomplete: "name", required: true, placeholder: "First and last name" });
    const p1 = pw("password", "new-password", "Password (8+ characters)"), p2 = pw("password2", "new-password", "Confirm password");
    form = h("form", { onsubmit: async e => { e.preventDefault(); err.textContent = "";
      const em = email.value.trim().toLowerCase();
      if (name.value.trim().split(/\s+/).length < 2) return err.textContent = "Enter your first and last name.";
      if (domain && !em.endsWith("@" + domain.toLowerCase())) return err.textContent = `Use your @${domain} email address.`;
      if (p1.value.length < 8) return err.textContent = "Use a password with at least 8 characters.";
      if (p1.value !== p2.value) return err.textContent = "The passwords don't match.";
      await busy(form.querySelector("[type=submit]"), "Creating account…", async () => {
        try {
          const r = await S.api.signUp(name.value.trim(), em, p1.value);
          if (r.needsConfirm) { S.authNote = { text: `Almost done. We sent a confirmation link to ${em}. Open it, then sign in here.` }; location.hash = "#/signin"; }
          else { history.replaceState(null, "", location.pathname + location.search); await route(); }
        } catch (x) { err.textContent = x.message; } }); } },
      name, email, p1, p2, h("p", { class: "help", text: domain ? `Only @${domain} addresses can sign up. Don't reuse your SHU password.` : "Don't reuse your university password." }), err, submitBtn("Create account"));
    alt = altSignIn(err, go, "Sign up", true);
    links = [h("button", { type: "button", text: "I already have an account", onclick: () => go("signin") })];
  } else if (mode === "forgot") {
    title = "Reset your password"; sub = "We'll email you a link to choose a new one.";
    form = h("form", { onsubmit: async e => { e.preventDefault(); err.textContent = "";
      await busy(form.querySelector("[type=submit]"), "Sending…", async () => {
        try { await S.api.sendReset(email.value.trim()); S.authNote = { text: `If ${email.value.trim()} has an account, a reset link is on its way.` }; location.hash = "#/signin"; }
        catch (x) { err.textContent = x.message; } }); } },
      email, err, submitBtn("Send reset link"));
    links = [h("button", { type: "button", text: "Back to sign in", onclick: () => go("signin") })];
  } else {
    title = "Choose a new password"; sub = "You followed a reset link. Set your new password.";
    const p1 = pw("password", "new-password", "New password"), p2 = pw("password2", "new-password", "Confirm new password");
    form = h("form", { onsubmit: async e => { e.preventDefault(); err.textContent = "";
      if (p1.value.length < 8) return err.textContent = "Use a password with at least 8 characters.";
      if (p1.value !== p2.value) return err.textContent = "The passwords don't match.";
      await busy(form.querySelector("[type=submit]"), "Saving…", async () => {
        try { await S.api.setPassword(p1.value); S.recovering = false; toast("Password updated"); history.replaceState(null, "", location.pathname + location.search); await route(); } catch (x) { err.textContent = x.message; } }); } },
      p1, p2, err, submitBtn("Save password"));
    links = [];
  }
  mount(h("div", { class: "lock" }, h("div", { class: "wallpaper" }),
    h("a", { class: "back", href: "#/" }, icon("chevron"), "SOC Log"),
    h("div", { class: "lock-time" }, h("div", { class: "d" }, liveClock(d => d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }))),
      h("div", { class: "t" }, liveClock(d => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "")))),
    h("div", { class: "lock-card" }, h("div", { class: "who" }, logo(112, "lock-logo"), h("h1", { text: title }), h("p", { class: "sub", text: sub })),
      note, form, alt, links.length ? h("div", { class: "links" }, links) : null),
    h("p", { class: "lock-foot", text: "Seton Hall University · Hazard Zet Forward" })));
  (document.getElementById(mode === "signup" ? "fullname" : mode === "reset" ? "password" : "email"))?.focus();
}

// Microsoft / Google / passkey / email-code buttons under the main form.
function altSignIn(err, go, verb, signup = false) {
  const P = S.api.providers || {};
  const oauth = (provider, label, icon) => h("button", { class: "btn wide provider", type: "button", onclick: async e => { err.textContent = "";
      await busy(e.currentTarget, "Redirecting…", async () => { try { await S.api.oauth(provider); } catch (x) { err.textContent = x.message; } }); } },
    icon, `${verb} with ${label}`);
  const btns = [
    P.azure ? oauth("azure", "SHU Microsoft", logoMs()) : null,
    P.google ? oauth("google", "Google", logoGoogle()) : null,
    !signup && P.passkey ? h("button", { class: "btn wide provider", type: "button", onclick: async e => { err.textContent = "";
        await busy(e.currentTarget, "Waiting for passkey…", async () => { try { await S.api.passkeySignIn(); await route(); } catch (x) { err.textContent = x.message; } }); } },
      icoKey(), "Sign in with a passkey") : null,
    !signup ? h("button", { class: "btn wide provider", type: "button", onclick: () => { S.codeEmail = null; go("code"); } }, icoMail(), "Email me a sign-in link") : null,
  ].filter(Boolean);
  if (!btns.length) return null;
  return h("div", { class: "alt-auth" }, h("div", { class: "or" }, h("span", { text: "or" })), ...btns,
    P.azure && !signup ? h("p", { class: "help", style: "text-align:center", text: "SHU Microsoft sign-in uses your normal SHU login and Duo approval." }) : null);
}
const svgIcon = (paths, vb = "0 0 24 24") => { const e = svg("svg", { viewBox: vb, width: 16, height: 16, "aria-hidden": "true" }); paths.forEach(p => e.appendChild(svg(p[0], p[1]))); return e; };
const logoMs = () => svgIcon([["rect", { x: 1, y: 1, width: 10, height: 10, fill: "#f25022" }], ["rect", { x: 13, y: 1, width: 10, height: 10, fill: "#7fba00" }], ["rect", { x: 1, y: 13, width: 10, height: 10, fill: "#00a4ef" }], ["rect", { x: 13, y: 13, width: 10, height: 10, fill: "#ffb900" }]]);
const logoGoogle = () => svgIcon([
  ["path", { fill: "#4285F4", d: "M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" }],
  ["path", { fill: "#34A853", d: "M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" }],
  ["path", { fill: "#FBBC05", d: "M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6H1.4a12 12 0 0 0 0 10.9l4-3.1z" }],
  ["path", { fill: "#EA4335", d: "M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" }]]);
const icoKey = () => svgIcon([["circle", { cx: 8, cy: 15, r: 4, fill: "none", stroke: "currentColor", "stroke-width": 2 }], ["path", { d: "M11 12l9-9M17 6l3 3M15 8l2 2", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round" }]]);
const icoMail = () => svgIcon([["rect", { x: 2, y: 5, width: 20, height: 14, rx: 2, fill: "none", stroke: "currentColor", "stroke-width": 2 }], ["path", { d: "M3 7l9 6 9-6", fill: "none", stroke: "currentColor", "stroke-width": 2 }]]);

/* ---------- 2-step verification (Duo Mobile codes) ---------- */
function codeForm(onCode, label = "Verify") {
  const err = h("p", { class: "err", role: "alert" });
  const code = h("input", { type: "text", id: "totp", inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9]{6}", maxlength: "6", required: true, placeholder: "123456", class: "mono otp" });
  const form = h("form", { class: "stack", onsubmit: async e => { e.preventDefault(); err.textContent = "";
    await busy(form.querySelector("[type=submit]"), "Checking…", async () => { try { await onCode(code.value.replace(/\s/g, "")); } catch (x) { err.textContent = x.message; code.select(); } }); } },
    h("div", { class: "field" }, h("label", { for: "totp", text: "6-digit code from Duo Mobile" }), code), err,
    h("button", { class: "btn primary wide", type: "submit", text: label }));
  return form;
}
async function viewMfaChallenge() {
  const f = (await S.api.factors()).find(x => x.status === "verified");
  if (!f) return viewMfaEnroll();
  viewSolo("Enter your Duo Mobile code", [
    "Open Duo Mobile, tap the SHU SOC Log account, and type the 6-digit code it shows.",
    codeForm(async c => { await S.api.verifyTotp(f.id, c); await route(); }),
    h("p", { class: "help", text: "Lost your phone or deleted the account in Duo Mobile? Ask a supervisor to reset your 2-step verification under People." }),
  ]);
  document.getElementById("totp")?.focus();
}
async function viewMfaEnroll() {
  let d;
  try { d = await S.api.startTotp(); } catch (x) { return viewSolo("Couldn't start 2-step setup", [x.message], [h("button", { class: "btn primary", type: "button", text: "Try again", onclick: () => route() })]); }
  const secret = h("span", { class: "mono secret", text: d.secret.replace(/(.{4})/g, "$1 ").trim() });
  viewSolo("Set up 2-step verification", [
    "The SOC log requires a second step every time you sign in. Use the Duo Mobile app you already have for SHU.",
    h("ol", { class: "mfa-steps" },
      h("li", {}, "In Duo Mobile tap ", h("b", { text: "+ Add" }), " (or ", h("b", { text: "Add account" }), "), then ", h("b", { text: "Use QR code" }), "."),
      h("li", {}, "Scan this code. On the same phone? Choose ", h("b", { text: "Other account / enter key manually" }), " and type the key under it."),
      h("li", {}, "Type the 6-digit code Duo Mobile shows for ", h("b", { text: "SHU SOC Log" }), ".")),
    h("div", { class: "qr" }, h("img", { src: d.qr, alt: "QR code for Duo Mobile", width: 180, height: 180 }), h("div", { class: "help" }, "Setup key: ", secret)),
    codeForm(async c => { await S.api.verifyTotp(d.factorId, c); toast("2-step verification is on"); await route(); }, "Turn on 2-step verification"),
    h("p", { class: "help", text: "Google Authenticator, Microsoft Authenticator and 1Password work too." }),
  ]);
  document.getElementById("totp")?.focus();
}

function viewSolo(title, body, extra = []) {
  mount(h("div", { class: "solo" }, h("div", { class: "wallpaper" }), h("div", { class: "card" },
    h("div", { class: "brandbar", style: "padding:0" }, logo(34, "brand-mark"), "SOC Log"),
    h("h1", { text: title }), ...body.map(p => typeof p === "string" ? h("p", { class: "dim", text: p }) : p),
    h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, ...extra,
      h("button", { class: "btn", type: "button", text: "Sign out", onclick: async () => { await S.api.signOut(); S.me = null; location.hash = "#/"; route(); } })))));
}
const viewPending = () => viewSolo("Waiting for approval", [
  `Thanks, ${S.me.full_name.split(" ")[0]}. Your account (${S.me.email}) was created ${rel(S.me.created_at).toLowerCase()}.`,
  "A supervisor needs to approve it before you can log checks. Let them know you've signed up, then check again.",
], [h("button", { class: "btn primary", type: "button", text: "Check again", onclick: () => route() })]);
const viewRemoved = () => viewSolo("Your access has been removed", [
  "You can no longer log checks for this SOC. Your past entries are still kept on record.",
  "If you think this is a mistake, talk to your supervisor.",
]);

/* =====================================================================
   app window + routing
   Supervisors: Home · Activity · Checklist · Team   Analysts: Home · My log
   "New log entry" is an action (a sheet), not a page. Account, settings and
   sign-out live in the menu under your name.
   ===================================================================== */
const NAV = {
  sup: [["home", "Home", "overview", "#0a84ff"], ["activity", "Activity", "activity", "#ff9f0a"], ["checks", "Checklist", "checklist", "#30b158"], ["team", "Team", "people", "#8e8e93"]],
  an: [["home", "Home", "overview", "#0a84ff"], ["activity", "My log", "history", "#ff9f0a"]],
};
const TITLES = { home: "Home", activity: "Activity", checks: "Checklist", team: "Team", account: "Account", settings: "Team settings" };
const LEGACY = { overview: "home", log: "home", history: "activity", coverage: "checks", checklist: "checks", people: "team", audit: "team" };
const PAGES = {};
const roleKey = () => isSup() ? "sup" : "an";

function userMenu(anchor) {
  document.querySelector(".menu")?.remove();
  const close = () => { menu.remove(); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", esc); };
  const outside = e => { if (!menu.contains(e.target) && !anchor.contains(e.target)) close(); };
  const esc = e => { if (e.key === "Escape") close(); };
  const item = (ic, label, fn, cls) => h("button", { type: "button", role: "menuitem", class: cls || null, onclick: () => { close(); fn(); } }, icon(ic), label);
  const menu = h("div", { class: "menu", role: "menu" },
    h("div", { class: "menu-head" }, h("b", { text: S.me.full_name }), h("span", { text: S.me.email })),
    item("account", "Account & security", () => location.hash = "#/account"),
    isSup() ? item("settings", "Team settings", () => location.hash = "#/settings") : null,
    h("hr"), item("signout", "Sign out", signOut, "danger"));
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, r.left)}px`;
  if (r.top > 260) menu.style.bottom = `${innerHeight - r.top + 6}px`; else menu.style.top = `${r.bottom + 6}px`;
  document.body.append(menu); menu.querySelector("button").focus();
  setTimeout(() => { document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", esc); });
}
async function signOut() {
  if (!(await confirmBox({ title: "Sign out of SOC Log?", ok: "Sign out" }))) return;
  await S.api.signOut(); S.me = null; S.team = null; location.hash = "#/"; route();
}

function shell(current, content) {
  const items = NAV[roleKey()];
  const label = TITLES[current] || "";
  const pending = isSup() ? S.people.filter(p => p.status === "pending").length : 0;
  const openEsc = isSup() && S.team ? S.team.filter(isOpenEsc).length : 0;
  const badge = id => id === "team" && pending ? pending : id === "activity" && openEsc ? openEsc : 0;
  const existing = app.querySelector(".shell");
  document.querySelectorAll(".scrim, .drawer, .dialog, .menu").forEach(e => e.remove());
  if (existing && existing.dataset.role === roleKey()) {
    existing.querySelectorAll(".nav a").forEach(a => { const id = a.dataset.id; a.setAttribute("aria-current", id === current ? "page" : "false");
      a.querySelector(".badge")?.remove(); if (badge(id)) a.append(h("span", { class: "badge", text: badge(id) })); });
    existing.querySelector(".toolbar .tt").textContent = label;
    const c = existing.querySelector(".content"); c.replaceChildren(content); c.classList.remove("page-enter"); void c.offsetWidth; c.classList.add("page-enter");
    document.title = `${label} · SOC Log`; content.querySelectorAll("[data-n]").forEach(countUp);
    return;
  }
  const link = ([id, lbl, ic, color]) => h("a", { href: `#/${id}`, "data-id": id, "aria-current": id === current ? "page" : "false" },
    h("span", { class: "tile", style: `background:${color}` }, icon(ic)), lbl, badge(id) ? h("span", { class: "badge", text: badge(id) }) : null);
  const meBtn = h("button", { class: "me", type: "button", "aria-haspopup": "menu", onclick: e => userMenu(e.currentTarget) },
    avatar(S.me.id, S.me.full_name), h("span", { class: "who" }, h("span", { class: "nm", text: S.me.full_name }), h("span", { class: "rl", text: isSup() ? "Supervisor" : "Analyst" })), icon("updown"));
  const toolbar = h("div", { class: "toolbar" }, h("span", { class: "tt", text: label }));
  mount(h("div", { class: "shell", "data-role": roleKey() },
    h("aside", { class: "side" },
      h("div", { class: "brandbar" }, logo(34, "brand-mark"), h("div", {}, "SOC Log", h("small", { text: S.settings.org_name || "Seton Hall University" }))),
      h("button", { class: "btn primary new-entry", type: "button", onclick: () => openLogSheet() }, icon("plus"), "New log entry"),
      h("nav", { class: "nav", "aria-label": "Main" }, items.map(link)),
      h("div", { class: "side-foot" }, meBtn)),
    h("main", { class: "main" }, toolbar, h("div", { class: "content page-enter", id: "main" }, content))));
  document.title = `${label} · SOC Log`;
  content.querySelectorAll("[data-n]").forEach(countUp);
  const onScroll = () => toolbar.classList.toggle("scrolled", window.scrollY > 40);
  window.removeEventListener("scroll", S.onScroll || (() => {})); S.onScroll = onScroll; window.addEventListener("scroll", onScroll, { passive: true });
}
function pageHead(title, sub, ...actions) {
  actions = actions.flat().filter(Boolean);
  return h("header", { class: "page-head" },
    h("div", { class: "ph-row" }, h("h1", { text: title }), actions.length ? h("div", { class: "actions" }, actions) : null),
    sub ? h("p", { text: sub }) : null);
}
/* macOS segmented control used for in-page views */
function segmented(options, current, onPick) {
  return h("div", { class: "seg seg-view", role: "tablist" }, options.map(([k, label, count]) =>
    h("button", { type: "button", role: "tab", "aria-pressed": String(k === current), "aria-selected": String(k === current), onclick: () => onPick(k) },
      label, count ? h("span", { class: "c", text: count }) : null)));
}
const greeting = () => { const hr = new Date().getHours(); return hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening"; };

async function loadTeam(force = false) {
  if (!isSup()) return;
  if (!force && S.team && Date.now() - S.teamAt < 30000) return;
  const since = new Date(Date.now() - 180 * DAY).toISOString();
  const [logs, reviews, people] = await Promise.all([S.api.logs(since), S.api.reviews(), S.api.people()]);
  S.team = logs; S.teamAt = Date.now();
  S.reviews = Object.fromEntries(reviews.map(r => [r.log_id, r]));
  S.people = people; S.peopleById = Object.fromEntries(people.map(p => [p.id, p]));
}
async function loadMine() {
  S.mine = await S.api.myLogs(S.me.id);
  if (!isSup()) { const rv = await S.api.reviews(); S.reviews = Object.fromEntries(rv.map(r => [r.log_id, r])); }
}

let routing = false, rerun = false;
async function route() {
  if (routing) { rerun = true; return; } routing = true;
  try {
    if (S.recovering) return viewAuth();
    const hash = location.hash.replace(/^#\/?/, "");
    if (/access_token|error_description|type=/.test(hash)) return;   // Supabase is still reading the link
    const session = await S.api.session();
    if (!session) {
      S.me = null;
      if (["signin", "signup", "forgot", "code"].includes(hash)) { S.authMode = hash; return viewAuth(); }
      if (S.authNote) { S.authMode = "signin"; return viewAuth(); }
      if (!S.practices.length && S.api.demo) { S.practices = await S.api.practices(); S.P = Object.fromEntries(S.practices.map(p => [p.id, p])); }
      return viewLanding();
    }
    const lvl = await S.api.aal();
    if (lvl.currentLevel !== "aal2") return lvl.nextLevel === "aal2" ? viewMfaChallenge() : viewMfaEnroll();
    S.me = await S.api.me();
    if (!S.me) return viewSolo("We couldn't load your profile", ["Your login worked but your SOC profile is missing. Ask your supervisor to check the database setup (schema.sql)."]);
    if (S.me.status === "pending") return viewPending();
    if (S.me.status === "removed") return viewRemoved();
    S.api.touch().catch(() => {});
    if (!S.practices.length) { S.practices = await S.api.practices(); S.P = Object.fromEntries(S.practices.map(p => [p.id, p])); }
    let id = hash, openNew = false;
    if (LEGACY[id]) { if (id === "log") openNew = true; if (id === "checklist") S.checksView = "edit"; if (id === "audit") S.teamView = "audit"; id = LEGACY[id]; history.replaceState(null, "", `#/${id}`); }
    const allowed = [...NAV[roleKey()].map(r => r[0]), "account", ...(isSup() ? ["settings"] : [])];
    if (!allowed.includes(id)) { id = "home"; history.replaceState(null, "", "#/home"); }
    if (!app.querySelector(".shell")) shell(id, h("div", { class: "loading" }, h("div", { class: "spinner" })));
    try {
      await Promise.all([loadMine(), loadTeam()]);
      shell(id, await PAGES[id]());
      if (openNew) openLogSheet();
    } catch (x) {
      shell(id, h("div", { class: "notice bad", text: x.message || "Something went wrong loading this page." }));
    }
  } finally { routing = false; if (rerun) { rerun = false; route(); } }
}
window.addEventListener("hashchange", () => route());

/* =====================================================================
   new log entry (sheet)
   ===================================================================== */
function openLogSheet(prefill) {
  document.querySelectorAll(".scrim, .sheet").forEach(e => e.remove());
  const close = () => { scrim.remove(); sheet.remove(); document.removeEventListener("keydown", esc); };
  const esc = e => { if (e.key === "Escape") close(); };
  const scrim = h("div", { class: "scrim", onclick: close });
  const body = h("div", { class: "sheet-body" });
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "New log entry" },
    h("div", { class: "sheet-head" }, h("h2", { text: "New log entry" }), h("span", { class: "faint small", text: `Logging as ${S.me.full_name}` }),
      h("button", { class: "btn sm", type: "button", text: "Cancel", onclick: close })), body);
  const showForm = p => body.replaceChildren(buildLogForm({ practice: p, onSaved: saved => {
    body.replaceChildren(receipt(saved, { again: () => showForm(null), done: () => { close(); route(); } })); body.scrollTop = 0; } }));
  showForm(prefill);
  document.body.append(scrim, sheet); document.addEventListener("keydown", esc);
  (sheet.querySelector(prefill ? ".outcome" : ".seg button") || sheet.querySelector("button")).focus();
}

/* =====================================================================
   page: log a check
   ===================================================================== */
function buildLogForm({ practice = null, onSaved }) {
  const F = { tool: null, practice: "", result: null, when: "now" };
  const tools = [...new Set(S.practices.filter(p => p.active).map(p => p.tool))];
  const err = h("p", { class: "err", role: "alert" });

  const toolSeg = h("div", { class: "seg", role: "group", "aria-label": "Tool" }, tools.map(tl => h("button", { type: "button", "aria-pressed": "false", "data-v": tl, text: tl, onclick: () => setTool(tl) })));
  const sel = h("select", { id: "practice", disabled: true, onchange: () => { F.practice = sel.value; showInfo(); } }, h("option", { value: "", text: "Pick a tool first" }));
  const info = h("div", { class: "check-info", hidden: true });
  const outcomes = h("div", { class: "outcomes", role: "group", "aria-label": "Result" },
    Object.entries(RESULTS).map(([k, r]) => h("button", { type: "button", class: "outcome", "data-k": k, "aria-pressed": "false", onclick: () => setResult(k) }, h("b", {}, h("i"), r.label), h("span", { text: r.sub }))));

  const details = h("textarea", { id: "details", maxlength: "4000", rows: "5", placeholder: "e.g. Worked the Falcon queue from 9:00 to 9:40. 14 new detections: 12 false positives from the Chrome updater (closed), 1 PUP on LAB-WS114 (quarantined), 1 encoded PowerShell on FIN-LT022 (escalated)." });
  const counter = h("span", { class: "help mono", text: "0 / 25" });
  details.addEventListener("input", () => { const n = details.value.trim().length; counter.textContent = n < 25 ? `${n} / 25` : `${n} characters`; counter.style.color = n && n < 25 ? "var(--red)" : ""; });
  const affected = h("input", { type: "text", id: "affected", maxlength: "1000", placeholder: "e.g. FIN-LT022, kmorris@shu.edu" });
  const action = h("textarea", { id: "action", maxlength: "2000", rows: "3", placeholder: "e.g. Isolated the host in Falcon, opened INC0041872, called the supervisor at 9:42." });
  const blocker = h("textarea", { id: "blocker", maxlength: "1000", rows: "3", placeholder: "e.g. Lost access to the Duo admin panel mid-review." });
  const ticket = h("input", { type: "text", id: "ticket", maxlength: "60", placeholder: "INC0041872", autocomplete: "off" });
  const items = h("input", { type: "number", id: "items", min: "0", max: "100000", inputmode: "numeric", placeholder: "e.g. 14" });
  const minutes = h("input", { type: "number", id: "minutes", min: "1", max: "1440", inputmode: "numeric", placeholder: "e.g. 30" });
  const doneAt = h("input", { type: "datetime-local", id: "doneAt", hidden: true });
  const whenSeg = h("div", { class: "seg" }, ["now", "earlier"].map(w => h("button", { type: "button", "data-v": w, "aria-pressed": String(w === "now"), text: w === "now" ? "Just now" : "Earlier", onclick: () => {
    F.when = w; whenSeg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === w)));
    doneAt.hidden = w !== "earlier"; doneAt.max = toLocalInput(Date.now()); doneAt.min = toLocalInput(Date.now() - 7 * DAY + 6e4);
    if (!doneAt.value) doneAt.value = toLocalInput(Date.now() - 30 * 6e4); } })));
  const ticketLabel = h("label", { for: "ticket" }, "Ticket #", h("span", { class: "opt", text: "optional" }));
  const issueBlock = h("div", { class: "grid-2", hidden: true },
    h("div", { class: "field" }, h("label", { for: "affected" }, "Users, hosts or emails involved", h("span", { class: "opt", text: "optional" })), affected),
    h("div", { class: "field" }, h("label", { for: "action" }, "What action did you take?", h("span", { class: "opt", text: "optional" })), action));
  const blockBlock = h("div", { class: "field", hidden: true }, h("label", { for: "blocker" }, "What stopped you?", h("span", { class: "req", text: "required" })), blocker);

  function setTool(tl) {
    F.tool = tl; F.practice = "";
    toolSeg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === tl)));
    sel.disabled = false;
    sel.replaceChildren(h("option", { value: "", text: "Choose the check you did" }),
      ...S.practices.filter(p => p.tool === tl && p.active).map(p => h("option", { value: p.id, text: p.name })));
    showInfo();
  }
  function showInfo() {
    const p = S.P[F.practice]; info.hidden = !p; if (!p) return;
    const mineLast = S.mine.find(l => l.practice_id === p.id);
    const teamLast = S.team && S.team.find(l => l.practice_id === p.id);
    info.replaceChildren(
      h("div", { class: "row" }, h("span", { class: "tag line", text: p.frequency }), h("span", { class: `prio ${p.priority}`, text: `${p.priority} priority` }),
        h("span", { class: "faint small", text: mineLast ? `You last did this ${rel(mineLast.performed_at).toLowerCase()}` : "You haven't logged this one yet" }),
        teamLast && teamLast.user_id !== S.me.id ? h("span", { class: "faint small", text: `· Team: ${rel(teamLast.performed_at).toLowerCase()} by ${nameOf(teamLast.user_id).split(" ")[0]}` }) : null),
      p.details ? h("p", { class: "dim", text: p.details }) : null,
      p.how_to ? h("div", {}, h("div", { class: "label", style: "margin-bottom:4px", text: "Where to find it" }), h("div", { class: "path", text: p.how_to })) : null);
  }
  function setResult(k) {
    F.result = k; outcomes.querySelectorAll(".outcome").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === k)));
    const needT = k === "handled" || k === "escalated";
    ticketLabel.lastChild.replaceWith(h("span", { class: needT ? "req" : "opt", text: needT ? "required" : "optional" }));
    issueBlock.hidden = !needT; blockBlock.hidden = k !== "incomplete";
  }

  const form = h("form", { class: "log-form", novalidate: true, onsubmit: async e => {
    e.preventDefault(); err.textContent = ""; form.querySelectorAll(".invalid").forEach(x => x.classList.remove("invalid"));
    const bad = (el, msg) => { if (el) { el.classList.add("invalid"); el.focus(); } err.textContent = msg; };
    if (!F.tool) return bad(null, "Pick the tool you used.");
    if (!F.practice) return bad(sel, "Pick the check you did.");
    if (!F.result) return bad(null, "Choose how it went.");
    const d = details.value.trim();
    if (d.length < 25) return bad(details, "Describe what you did and found (at least 25 characters).");
    const needT = F.result === "handled" || F.result === "escalated";
    if (needT && !ticket.value.trim()) return bad(ticket, "Add the ticket number for anything you handled or escalated.");
    if (F.result === "incomplete" && !blocker.value.trim()) return bad(blocker, "Say what stopped you from finishing.");
    let performed = Date.now();
    if (F.when === "earlier") {
      performed = new Date(doneAt.value).getTime();
      if (!doneAt.value || isNaN(performed)) return bad(doneAt, "Enter when you did the check.");
      if (performed > Date.now()) return bad(doneAt, "That time is in the future.");
      if (Date.now() - performed > 7 * DAY) return bad(doneAt, "You can only log checks from the last 7 days. Tell your supervisor about older ones.");
    }
    const num = el => el.value === "" ? null : Math.round(Number(el.value));
    if (items.value !== "" && !(num(items) >= 0)) return bad(items, "Items reviewed must be a number.");
    if (minutes.value !== "" && !(num(minutes) >= 1 && num(minutes) <= 1440)) return bad(minutes, "Time spent must be between 1 and 1440 minutes.");
    const row = { practice_id: F.practice, result: F.result, performed_at: new Date(performed).toISOString(), details: d,
      items_reviewed: num(items), duration_min: num(minutes), ticket: ticket.value.trim() || null,
      affected: needT ? affected.value.trim() || null : null, action_taken: needT ? action.value.trim() || null : null,
      blocker: F.result === "incomplete" ? blocker.value.trim() : null, user_agent: navigator.userAgent.slice(0, 300) };
    const btn = form.querySelector("[type=submit]");
    await busy(btn, "Saving…", async () => {
      try {
        const saved = await S.api.addLog(row);
        S.mine.unshift(saved); if (S.team) S.team.unshift(saved);
        onSaved(saved);
      } catch (x) { err.textContent = x.message; }
    });
  } },
    h("div", { class: "form-block" }, h("div", { class: "bh" }, h("span", { class: "n", text: "01" }), h("h2", { text: "What did you check?" })),
      h("div", { class: "field" }, h("span", { class: "flabel", text: "Tool" }), toolSeg),
      h("div", { class: "field" }, h("label", { for: "practice", text: "Check" }), sel), info),
    h("div", { class: "form-block" }, h("div", { class: "bh" }, h("span", { class: "n", text: "02" }), h("h2", { text: "How did it go?" })), outcomes, issueBlock, blockBlock),
    h("div", { class: "form-block" }, h("div", { class: "bh" }, h("span", { class: "n", text: "03" }), h("h2", { text: "What happened?" })),
      h("div", { class: "field" }, h("label", { for: "details" }, "What did you do and find?", h("span", { class: "req", text: "required" })), details,
        h("div", { style: "display:flex;justify-content:space-between;gap:12px" }, h("span", { class: "help", text: "Counts, hostnames, usernames, what you closed and why. Someone reading this later should understand exactly what you did." }), counter)),
      h("div", { class: "grid-3" },
        h("div", { class: "field" }, ticketLabel, ticket),
        h("div", { class: "field" }, h("label", { for: "items" }, "Items reviewed", h("span", { class: "opt", text: "optional" })), items),
        h("div", { class: "field" }, h("label", { for: "minutes" }, "Time spent (min)", h("span", { class: "opt", text: "optional" })), minutes)),
      h("div", { class: "field" }, h("span", { class: "flabel", text: "When did you do it?" }), h("div", { style: "display:flex;gap:10px;flex-wrap:wrap;align-items:center" }, whenSeg, doneAt))),
    h("div", { class: "form-foot" }, h("span", { class: "help", text: `Logging as ${S.me.full_name}. The save time comes from the server.` }),
      h("div", { style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap" }, err, h("button", { class: "btn primary", type: "submit", text: "Save log entry" }))));

  if (practice && S.P[practice]) { setTool(S.P[practice].tool); sel.value = practice; F.practice = practice; showInfo(); }
  return form;
}

function receipt(l, { again, done }) {
  const p = S.P[l.practice_id] || {};
  return h("div", { class: "receipt" },
    h("span", { class: "check" }, icon("check")), h("h2", { text: "Saved to the log" }), h("div", { class: "ref", text: l.ref }),
    h("dl", {}, h("dt", { text: "Check" }), h("dd", { text: p.name }), h("dt", { text: "Result" }), h("dd", {}, resultTag(l.result)),
      h("dt", { text: "Performed" }), h("dd", { text: full(l.performed_at) }), h("dt", { text: "Saved (server)" }), h("dd", { text: full(l.created_at) }),
      l.ticket ? [h("dt", { text: "Ticket" }), h("dd", { class: "mono", text: l.ticket })] : null),
    l.result === "escalated" ? h("div", { class: "notice warn", text: "Escalations show up for your supervisor right away. If it's urgent, also call or message them directly." }) : null,
    h("div", { style: "display:flex;gap:8px" }, h("button", { class: "btn primary", type: "button", text: "Done", onclick: done }),
      h("button", { class: "btn", type: "button", text: "Log another check", onclick: again })));
}

/* =====================================================================
   page: my checks
   ===================================================================== */
async function myLog() {
  const rows = S.mine;
  const wk = rows.filter(l => Date.now() - t(l.performed_at) < 7 * DAY).length;
  const body = rows.length ? h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, ["Performed", "Check", "Result", "Ticket", "Entry", "Supervisor"].map(x => h("th", { text: x })))),
    h("tbody", {}, rows.map(l => { const p = S.P[l.practice_id] || {}; const rv = S.reviews[l.id];
      return h("tr", { class: "click", onclick: () => openLog(l) },
        h("td", { class: "nowrap num", text: when(l.performed_at) }), h("td", {}, h("div", { text: p.name || l.practice_id }), h("div", { class: "sub", text: p.tool })),
        h("td", {}, resultTag(l.result)), h("td", { class: "mono nowrap", text: l.ticket || "—" }), h("td", { class: "mono nowrap faint", text: l.ref }),
        h("td", {}, rv ? outcomeTag(rv.outcome) : h("span", { class: "faint", text: "—" }))); }))))
    : h("div", { class: "panel empty" }, h("b", { text: "No checks yet" }), "Your log entries will appear here.", h("div", { style: "margin-top:12px" }, h("button", { class: "btn primary", type: "button", text: "Log your first check", onclick: () => openLogSheet() })));
  return h("div", {}, pageHead("My log", `${rows.length} ${rows.length === 1 ? "entry" : "entries"} on record · ${wk} in the last 7 days. Entries can't be changed after saving. If something's wrong, log a correction and mention the original entry number.`), body);
}

/* =====================================================================
   log detail drawer
   ===================================================================== */
function openLog(l) {
  document.querySelectorAll(".scrim, .drawer").forEach(e => e.remove());
  const p = S.P[l.practice_id] || {}; const person = S.peopleById[l.user_id] || (l.user_id === S.me.id ? S.me : {});
  const lagMin = Math.round((t(l.created_at) - t(l.performed_at)) / 6e4);
  const close = () => { scrim.remove(); drawer.remove(); document.removeEventListener("keydown", esc); };
  const esc = e => { if (e.key === "Escape") close(); };
  const scrim = h("div", { class: "scrim", onclick: close });
  const fl = flagsOf(l);
  const kv = h("dl", { class: "kv" },
    h("dt", { text: "Analyst" }), h("dd", {}, person.full_name || "Unknown", person.email ? h("div", { class: "faint small", text: person.email }) : null),
    h("dt", { text: "Tool" }), h("dd", { text: `${p.tool || "—"} · ${p.category || ""}` }),
    h("dt", { text: "Priority" }), h("dd", {}, h("span", { class: `prio ${p.priority}`, text: p.priority || "—" }), h("span", { class: "faint", text: ` · ${p.frequency || ""}` })),
    h("dt", { text: "Performed" }), h("dd", { class: "num", text: full(l.performed_at) }),
    h("dt", { text: "Saved (server)" }), h("dd", { class: "num" }, full(l.created_at), lagMin > 2 ? h("div", { class: "faint small", text: `${lagMin < 120 ? lagMin + " minutes" : Math.round(lagMin / 60) + " hours"} after the check` }) : null),
    h("dt", { text: "Time spent" }), h("dd", { text: l.duration_min ? `${l.duration_min} min` : "Not given" }),
    h("dt", { text: "Items reviewed" }), h("dd", { class: "num", text: l.items_reviewed ?? "Not given" }),
    l.affected ? [h("dt", { text: "Involved" }), h("dd", { text: l.affected })] : null,
    h("dt", { text: "Ticket" }), h("dd", { class: "mono", text: l.ticket || "None" }),
    h("dt", { text: "Flags" }), h("dd", {}, fl.length ? fl.map(f => h("span", { class: "tag warn", style: "margin-right:6px" }, h("i"), f)) : "None"),
    l.user_agent && isSup() ? [h("dt", { text: "Device" }), h("dd", { class: "faint small", text: l.user_agent })] : null);
  const rv = S.reviews[l.id];
  let review = null;
  if (isSup()) {
    let outcome = rv ? rv.outcome : (l.result === "escalated" ? "follow_up" : "acknowledged");
    const seg = h("div", { class: "seg" }, Object.entries(OUTCOMES).map(([k, o]) => h("button", { type: "button", "data-v": k, "aria-pressed": String(k === outcome), text: o.label,
      onclick: () => { outcome = k; seg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === k))); } })));
    const note = h("textarea", { id: "reviewNote", rows: "3", maxlength: "2000", placeholder: "What you decided or did about this entry", value: rv ? rv.note || "" : "" });
    const save = h("button", { class: "btn primary", type: "button", text: rv ? "Update review" : "Save review", onclick: () => busy(save, "Saving…", async () => {
      try { await S.api.saveReview(l.id, outcome, note.value.trim() || null); S.reviews[l.id] = { log_id: l.id, outcome, note: note.value.trim(), reviewer_id: S.me.id, reviewed_at: new Date().toISOString() };
        toast("Review saved"); close(); route(); } catch (x) { toast(x.message); } }) });
    review = h("section", { style: "display:flex;flex-direction:column;gap:10px" }, h("h3", { text: "Supervisor review" }),
      rv ? h("p", { class: "small dim", text: `${OUTCOMES[rv.outcome].label} by ${nameOf(rv.reviewer_id)}, ${when(rv.reviewed_at)}.` }) : null, seg, note, h("div", {}, save));
  } else if (rv) {
    review = h("section", { style: "display:flex;flex-direction:column;gap:8px" }, h("h3", { text: "Supervisor review" }),
      h("div", {}, outcomeTag(rv.outcome), h("span", { class: "faint small", text: `  ${when(rv.reviewed_at)}` })), rv.note ? h("div", { class: "quote", text: rv.note }) : null);
  }
  const drawer = h("aside", { class: "drawer", role: "dialog", "aria-label": "Log entry" },
    h("div", { class: "drawer-head" }, h("div", { style: "display:flex;flex-direction:column;gap:6px;min-width:0" },
      h("div", { style: "display:flex;gap:8px;align-items:center" }, h("span", { class: "mono faint", text: l.ref }), resultTag(l.result)), h("h2", { text: p.name || l.practice_id })),
      h("button", { class: "btn sm", type: "button", text: "Close", onclick: close })),
    h("div", { class: "drawer-body" }, kv,
      h("section", { style: "display:flex;flex-direction:column;gap:8px" }, h("h3", { text: "What they did and found" }), h("div", { class: "quote", text: l.details })),
      l.action_taken ? h("section", { style: "display:flex;flex-direction:column;gap:8px" }, h("h3", { text: "Action taken" }), h("div", { class: "quote", text: l.action_taken })) : null,
      l.blocker ? h("section", { style: "display:flex;flex-direction:column;gap:8px" }, h("h3", { text: "What stopped them" }), h("div", { class: "quote", text: l.blocker })) : null,
      review));
  document.body.append(scrim, drawer); document.addEventListener("keydown", esc);
  drawer.querySelector(".btn").focus();
}

/* =====================================================================
   page: overview (supervisor)
   ===================================================================== */
function lastByPractice() { const m = {}; for (const l of S.team) if (!m[l.practice_id] || l.performed_at > m[l.practice_id].performed_at) m[l.practice_id] = l; return m; }

function barChart(logs) {
  const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); days.push(d); }
  const counts = days.map(d => { const k = dayKey(d); const ls = logs.filter(l => dayKey(l.performed_at) === k);
    return { d, n: ls.length, esc: ls.filter(l => l.result === "escalated").length, issues: ls.filter(l => l.result === "handled").length }; });
  const max = Math.max(4, ...counts.map(c => c.n)); const step = max <= 8 ? 2 : max <= 20 ? 5 : 10; const top = Math.ceil(max / step) * step;
  const W = 640, H = 200, L = 28, B = 26, T = 8, cw = (W - L) / counts.length, bw = Math.min(28, cw - 6);
  const y = v => T + (H - T - B) * (1 - v / top);
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Checks logged per day, last 14 days" });
  const ax = svg("g", { class: "axis" });
  for (let v = 0; v <= top; v += step) { ax.append(svg("line", { x1: L, x2: W, y1: y(v), y2: y(v) })); const tx = svg("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end" }); tx.textContent = v; ax.append(tx); }
  s.append(ax);
  const wrap = h("div", { class: "chart" }); const tip = h("div", { class: "tip", hidden: true });
  counts.forEach((c, i) => {
    const x = L + i * cw + (cw - bw) / 2, hh = Math.max(c.n ? 2 : 1, (H - T - B) * c.n / top);
    const r = Math.min(4, bw / 2, hh);
    const path = c.n ? `M${x},${y(0)} V${y(0) - hh + r} Q${x},${y(0) - hh} ${x + r},${y(0) - hh} H${x + bw - r} Q${x + bw},${y(0) - hh} ${x + bw},${y(0) - hh + r} V${y(0)} Z`
      : `M${x},${y(0) - 1} H${x + bw} V${y(0)} H${x} Z`;
    s.append(svg("path", { d: path, class: `bar${c.n ? "" : " zero"}` }));
    if (c.esc) { const dot = svg("circle", { cx: x + bw / 2, cy: y(0) - hh - 7, r: 3.5, fill: "var(--red)" }); s.append(dot); }
    const wd = c.d.getDay();
    if (i % 2 === (13 % 2) || counts.length <= 7) { const tx = svg("text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle", class: "axis" }); tx.textContent = c.d.toLocaleDateString([], { month: "numeric", day: "numeric" }); tx.style.fill = "var(--label-3)"; tx.style.font = "11px var(--mono)"; s.append(tx); }
    const hit = svg("rect", { x: L + i * cw, y: T, width: cw, height: H - T - B, fill: "transparent" });
    hit.addEventListener("mouseenter", () => { tip.hidden = false; tip.textContent = `${c.d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}: ${plural(c.n, "check")}${c.esc ? `, ${c.esc} escalated` : ""}${wd === 0 || wd === 6 ? " (weekend)" : ""}`;
      const box = s.getBoundingClientRect(); tip.style.left = `${((x + bw / 2) / W) * box.width + 16}px`; tip.style.top = `${(y(0) - hh) / H * box.height + 4}px`; });
    hit.addEventListener("mouseleave", () => tip.hidden = true);
    s.append(hit);
  });
  wrap.append(s, tip);
  return wrap;
}

async function supHome() {
  const L = S.team, now = Date.now();
  const today = L.filter(l => dayKey(l.performed_at) === dayKey(now)).length;
  const wk = L.filter(l => now - t(l.performed_at) < 7 * DAY).length, prev = L.filter(l => now - t(l.performed_at) >= 7 * DAY && now - t(l.performed_at) < 14 * DAY).length;
  const open = L.filter(isOpenEsc);
  const last = lastByPractice(); const active = S.practices.filter(p => p.active);
  const statuses = active.map(p => ({ p, s: coverageStatus(p, last[p.id] && last[p.id].performed_at) }));
  const overdue = statuses.filter(x => x.s.rank <= 1);
  const covered = active.filter(p => L.some(l => l.practice_id === p.id && now - t(l.performed_at) < 31 * DAY)).length;
  const pending = S.people.filter(p => p.status === "pending");
  const stat = (v, label, sub, bad) => h("div", { class: "stat" }, h("span", { class: "label", text: label }), h("span", { class: `v${bad ? " bad" : ""}`, text: typeof v === "number" ? "0" : v, "data-n": typeof v === "number" ? v : null }), h("span", { class: "s", text: sub }));
  const delta = wk - prev;

  const attention = [
    ...open.slice(0, 6).map(l => h("div", { class: "row click", onclick: () => openLog(l) }, h("span", { class: "tag bad" }, h("i"), "Escalation"),
      h("div", { class: "grow" }, h("div", { text: (S.P[l.practice_id] || {}).name }), h("div", { class: "faint small", text: `${nameOf(l.user_id)} · ${when(l.performed_at)}` })))),
    ...pending.map(p => h("a", { class: "row", href: "#/team" }, h("span", { class: "tag brand" }, h("i"), "Approval"),
      h("div", { class: "grow" }, h("div", { text: p.full_name }), h("div", { class: "faint small", text: `${p.email} · signed up ${rel(p.created_at).toLowerCase()}` })))),
    ...overdue.filter(x => x.p.priority === "Critical" || x.p.priority === "High").slice(0, 8).map(x => h("a", { class: "row", href: "#/checks" }, h("span", { class: `tag ${x.s.cls}` }, h("i"), x.s.label),
      h("div", { class: "grow" }, h("div", { text: x.p.name }), h("div", { class: "small" }, h("span", { class: `prio ${x.p.priority}`, text: x.p.priority }), h("span", { class: "faint", text: ` · ${x.p.tool} · ${x.p.frequency}` }))))),
  ];
  const analysts = S.people.filter(p => p.status === "active");
  const team = analysts.map(p => { const ls = L.filter(l => l.user_id === p.id);
    return { p, w: ls.filter(l => now - t(l.performed_at) < 7 * DAY).length, m: ls.filter(l => now - t(l.performed_at) < 30 * DAY).length,
      esc: ls.filter(l => l.result === "escalated" && now - t(l.performed_at) < 30 * DAY).length,
      fl: ls.filter(l => now - t(l.performed_at) < 30 * DAY && flagsOf(l).length).length, last: ls[0] && ls[0].performed_at }; })
    .sort((a, b) => b.m - a.m);

  return h("div", {},
    pageHead(`${greeting()}, ${S.me.full_name.split(" ")[0]}`, `${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}. Here's where the SOC stands.`,
      h("button", { class: "btn", type: "button", text: "Refresh", onclick: async e => { await busy(e.target, "Refreshing…", () => loadTeam(true)); route(); } }),
      h("a", { class: "btn", href: "#/activity", text: "All activity" })),
    h("div", { class: "stats" },
      stat(today, "Today", "checks logged"),
      stat(wk, "Last 7 days", delta === 0 ? "same as the week before" : `${delta > 0 ? "+" : ""}${delta} vs the week before`),
      stat(open.length, "Open escalations", open.length ? "need your review" : "nothing waiting", open.length > 0),
      stat(`${covered}/${active.length}`, "Checklist coverage", "checks done in the last 31 days"),
      stat(overdue.length, "Overdue", "or never done", overdue.length > 0)),
    h("div", { class: "cols section" },
      h("div", { style: "display:flex;flex-direction:column;gap:24px;min-width:0" },
        h("section", {}, h("div", { class: "section-head" }, h("h2", { text: "Checks per day" }), h("span", { class: "small faint" }, "Last 14 days · ", h("span", { style: "color:var(--red)", text: "●" }), " day with an escalation")),
          h("div", { class: "panel" }, barChart(L))),
        h("section", {}, h("div", { class: "section-head" }, h("h2", { text: "Latest entries" }), h("a", { class: "small", href: "#/activity", text: "All activity" })),
          h("div", { class: "panel list" }, L.length ? L.slice(0, 8).map(l => h("div", { class: "row click", onclick: () => openLog(l) },
            avatar(l.user_id, nameOf(l.user_id)),
            h("div", { class: "grow" }, h("div", { text: (S.P[l.practice_id] || {}).name }), h("div", { class: "faint small", text: `${nameOf(l.user_id)} · ${when(l.performed_at)}` })),
            resultTag(l.result))) : h("div", { class: "empty" }, h("b", { text: "No checks logged yet" }), "Entries appear here as soon as your team logs them.")))),
      h("div", { style: "display:flex;flex-direction:column;gap:24px;min-width:0" },
        h("section", {}, h("div", { class: "section-head" }, h("h2", { text: "Needs your attention" }), h("span", { class: "small faint", text: `${attention.length} item${attention.length === 1 ? "" : "s"}` })),
          h("div", { class: "panel list" }, attention.length ? attention : h("div", { class: "empty" }, h("b", { text: "All caught up" }), "No escalations, approvals or overdue critical checks."))),
        h("section", {}, h("div", { class: "section-head" }, h("h2", { text: "Team, last 30 days" }), h("a", { class: "small", href: "#/team", text: "Manage people" })),
          h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", { text: "Analyst" }), h("th", { text: "7d" }), h("th", { text: "30d" }), h("th", { text: "Esc." }), h("th", { text: "Flags" }), h("th", { text: "Last check" }))),
            h("tbody", {}, team.map(x => h("tr", { class: "click", onclick: () => { S.filters = { ...S.filters, user: x.p.id }; location.hash = "#/activity"; } },
              h("td", {}, x.p.full_name, x.p.role === "supervisor" ? h("span", { class: "faint small", text: " · sup." }) : null), h("td", { class: "num", text: x.w }), h("td", { class: "num", text: x.m }),
              h("td", { class: "num", text: x.esc }), h("td", { class: "num", text: x.fl }), h("td", { class: "nowrap faint", text: x.last ? rel(x.last) : "Never" }))))))))));
}

/* =====================================================================
   page: activity (supervisor)
   ===================================================================== */
function filterLogs() {
  const f = S.filters, q = f.q.trim().toLowerCase();
  return S.team.filter(l => { const p = S.P[l.practice_id] || {};
    if (f.user && l.user_id !== f.user) return false; if (f.tool && p.tool !== f.tool) return false; if (f.result && l.result !== f.result) return false;
    if (f.status === "open" && !isOpenEsc(l)) return false; if (f.status === "flagged" && !flagsOf(l).length) return false;
    if (f.status === "reviewed" && !S.reviews[l.id]) return false;
    const d = dayKey(l.performed_at); if (f.from && d < f.from) return false; if (f.to && d > f.to) return false;
    if (q && !`${p.name} ${p.tool} ${l.details} ${l.affected || ""} ${l.action_taken || ""} ${l.ticket || ""} ${l.ref} ${nameOf(l.user_id)}`.toLowerCase().includes(q)) return false;
    return true; });
}
function exportCsv(rows) {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Entry", "Performed at", "Saved at (server)", "Analyst", "Email", "Tool", "Category", "Check", "Priority", "Frequency", "Result", "Items reviewed", "Minutes",
    "What they did / found", "Involved", "Action taken", "Blocker", "Ticket", "Flags", "Review", "Reviewed by", "Reviewed at", "Review note"];
  const lines = rows.map(l => { const p = S.P[l.practice_id] || {}, u = S.peopleById[l.user_id] || {}, r = S.reviews[l.id];
    return [l.ref, l.performed_at, l.created_at, u.full_name, u.email, p.tool, p.category, p.name, p.priority, p.frequency, RESULTS[l.result].label, l.items_reviewed, l.duration_min,
      l.details, l.affected, l.action_taken, l.blocker, l.ticket, flagsOf(l).join("; "), r ? OUTCOMES[r.outcome].label : "", r ? nameOf(r.reviewer_id) : "", r ? r.reviewed_at : "", r ? r.note : ""].map(q).join(","); });
  download(`soc-log-${dayKey(Date.now())}.csv`, [head.map(q).join(","), ...lines].join("\r\n"));
}
async function teamActivity() {
  const f = S.filters;
  const tbody = h("tbody"); const count = h("p", { class: "small faint", style: "margin-top:10px" });
  const draw = () => {
    const rows = filterLogs();
    count.textContent = `Showing ${Math.min(rows.length, 500)} of ${rows.length} matching entries. ${S.team.length} entries from the last 180 days are loaded.`;
    tbody.replaceChildren(...(rows.length ? rows.slice(0, 500).map(l => { const p = S.P[l.practice_id] || {}; const fl = flagsOf(l); const rv = S.reviews[l.id];
      return h("tr", { class: "click", onclick: () => openLog(l) },
        h("td", { class: "nowrap num", text: when(l.performed_at) }), h("td", { class: "nowrap", text: nameOf(l.user_id) }),
        h("td", {}, h("div", { text: p.name }), h("div", { class: "sub", text: p.tool })), h("td", {}, resultTag(l.result)),
        h("td", { class: "clip" }, h("div", { text: l.details })), h("td", { class: "mono nowrap", text: l.ticket || "—" }),
        h("td", {}, rv ? outcomeTag(rv.outcome) : isOpenEsc(l) ? h("span", { class: "tag bad" }, h("i"), "Not reviewed") : null,
          fl.map(x => h("div", { class: "sub", style: "color:var(--orange)", text: x }))));
    }) : [h("tr", {}, h("td", { colspan: "7" }, h("div", { class: "empty" }, h("b", { text: S.team.length ? "No entries match these filters" : "No checks logged yet" }),
      S.team.length ? "Clear a filter to see more." : "Entries show up here as soon as your team logs them.")))]));
  };
  const bind = (el, key) => { el.value = f[key]; el.addEventListener("input", () => { f[key] = el.value; draw(); }); return el; };
  const tools = [...new Set(S.practices.map(p => p.tool))];
  const people = S.people.filter(p => p.status !== "pending");
  const filters = h("div", { class: "filters" },
    bind(h("input", { type: "search", placeholder: "Search notes, hosts, tickets, entry #", "aria-label": "Search" }), "q"),
    bind(h("select", { "aria-label": "Analyst" }, h("option", { value: "", text: "All analysts" }), people.map(p => h("option", { value: p.id, text: p.full_name + (p.status === "removed" ? " (removed)" : "") }))), "user"),
    bind(h("select", { "aria-label": "Tool" }, h("option", { value: "", text: "All tools" }), tools.map(x => h("option", { value: x, text: x }))), "tool"),
    bind(h("select", { "aria-label": "Result" }, h("option", { value: "", text: "All results" }), Object.entries(RESULTS).map(([k, r]) => h("option", { value: k, text: r.label }))), "result"),
    bind(h("select", { "aria-label": "Status" }, h("option", { value: "", text: "Any status" }), h("option", { value: "open", text: "Open escalations" }), h("option", { value: "flagged", text: "Flagged" }), h("option", { value: "reviewed", text: "Reviewed" })), "status"),
    bind(h("input", { type: "date", "aria-label": "From date" }), "from"), bind(h("input", { type: "date", "aria-label": "To date" }), "to"));
  draw();
  return h("div", {},
    pageHead("Activity", "Every check your team has logged. Click an entry for the full record and to review it.",
      h("button", { class: "btn", type: "button", text: "Clear filters", onclick: () => { S.filters = { q: "", user: "", tool: "", result: "", status: "", from: "", to: "" }; route(); } }),
      h("button", { class: "btn primary", type: "button", text: "Export CSV", onclick: () => { exportCsv(filterLogs()); toast("CSV downloaded"); } })),
    filters, h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Performed", "Analyst", "Check", "Result", "Details", "Ticket", "Review / flags"].map(x => h("th", { text: x })))), tbody)), count);
}

/* =====================================================================
   page: coverage (supervisor)
   ===================================================================== */
async function coverageView() {
  const last = lastByPractice(), now = Date.now(), f = S.covFilter;
  const all = S.practices.map(p => ({ p, l: last[p.id], s: coverageStatus(p, last[p.id] && last[p.id].performed_at),
    n: S.team.filter(l => l.practice_id === p.id && now - t(l.performed_at) < 30 * DAY).length }));
  const tally = {}; all.forEach(x => tally[x.s.label] = (tally[x.s.label] || 0) + 1);
  const tbody = h("tbody");
  const draw = () => {
    const rows = all.filter(x => (!f.tool || x.p.tool === f.tool) && (!f.status || x.s.label === f.status)).sort((a, b) => a.s.rank - b.s.rank || PRIOS.indexOf(a.p.priority) - PRIOS.indexOf(b.p.priority));
    tbody.replaceChildren(...rows.map(({ p, l, s, n }) => h("tr", { style: p.active ? null : "opacity:.55" },
      h("td", {}, h("div", { text: p.name }), h("div", { class: "sub", text: p.category })), h("td", { class: "nowrap", text: p.tool }), h("td", { class: "nowrap", text: p.frequency }),
      h("td", {}, h("span", { class: `prio ${p.priority}`, text: p.priority })),
      h("td", { class: "nowrap" }, l ? [h("div", { text: rel(l.performed_at) }), h("div", { class: "sub", text: nameOf(l.user_id) })] : h("span", { class: "faint", text: "Never" })),
      h("td", { class: "num", text: n }), h("td", {}, h("span", { class: `tag ${s.cls}` }, h("i"), s.label)))));
  };
  const toolSel = h("select", { "aria-label": "Tool" }, h("option", { value: "", text: "All tools" }), [...new Set(S.practices.map(p => p.tool))].map(x => h("option", { value: x, text: x })));
  const stSel = h("select", { "aria-label": "Status" }, h("option", { value: "", text: "Any status" }), Object.keys(tally).map(k => h("option", { value: k, text: `${k} (${tally[k]})` })));
  toolSel.value = f.tool; stSel.value = f.status;
  toolSel.addEventListener("input", () => { f.tool = toolSel.value; draw(); }); stSel.addEventListener("input", () => { f.status = stSel.value; draw(); });
  draw();
  return h("div", {},
    pageHead("Coverage", "Is every check on the list getting done as often as it should?"),
    h("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px" }, ["Never done", "Overdue", "On track", "Not used yet", "As needed", "Turned off"].filter(k => tally[k]).map(k => {
      const cls = { "Never done": "bad", Overdue: "bad", "On track": "ok" }[k] || "line"; return h("span", { class: `tag ${cls}` }, h("i"), `${tally[k]} ${k.toLowerCase()}`); })),
    h("div", { class: "filters" }, toolSel, stSel),
    h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Check", "Tool", "Frequency", "Priority", "Last done", "30d", "Status"].map(x => h("th", { text: x })))), tbody)),
    h("p", { class: "small faint", style: "margin-top:10px", text: "Daily and continuous checks are overdue after a missed weekday. Weekly after 7 days, monthly after 31, quarterly after 92, annually after 366. Change frequencies on the Checklist page." }));
}

/* =====================================================================
   page: people (supervisor)
   ===================================================================== */
async function peopleView() {
  const now = Date.now();
  const groups = { pending: S.people.filter(p => p.status === "pending"), active: S.people.filter(p => p.status === "active"), removed: S.people.filter(p => p.status === "removed") };
  const act = async (p, patch, msg, conf) => {
    if (conf && !(await confirmBox(conf))) return;
    try { await S.api.setAccess(p.id, patch); toast(msg); await loadTeam(true); route(); } catch (x) { toast(x.message); }
  };
  const reset2fa = p => h("button", { class: "btn sm", type: "button", text: "Reset 2-step", onclick: async () => {
    if (!(await confirmBox({ title: `Reset 2-step verification for ${p.full_name}?`, body: "Use this when someone lost their phone. Their old Duo Mobile code stops working, and they'll scan a new QR code next time they sign in. Confirm it's really them first.", ok: "Reset", danger: true }))) return;
    try { await S.api.resetMemberMfa(p.id); toast(`${p.full_name} will set up 2-step verification again`); } catch (x) { toast(x.message); } } });
  const actions = p => {
    if (p.id === S.me.id) return h("span", { class: "faint small", text: "You" });
    if (p.status === "pending") return [
      h("button", { class: "btn primary sm", type: "button", text: "Approve", onclick: () => act(p, { status: "active" }, `${p.full_name} can now log checks`) }),
      h("button", { class: "btn sm danger", type: "button", text: "Decline", onclick: () => act(p, { status: "removed" }, `Declined ${p.full_name}`, { title: `Decline ${p.full_name}?`, body: `${p.email} won't be able to use the SOC log. You can restore them later from the Removed tab.`, ok: "Decline", danger: true }) })];
    if (p.status === "active") return [
      p.role === "analyst"
        ? h("button", { class: "btn sm", type: "button", text: "Make supervisor", onclick: () => act(p, { role: "supervisor" }, `${p.full_name} is now a supervisor`, { title: `Make ${p.full_name} a supervisor?`, body: "Supervisors can see everyone's logs, approve and remove people, and edit the checklist.", ok: "Make supervisor" }) })
        : h("button", { class: "btn sm", type: "button", text: "Make analyst", onclick: () => act(p, { role: "analyst" }, `${p.full_name} is now an analyst`, { title: `Change ${p.full_name} to analyst?`, body: "They'll only see their own logs.", ok: "Change role" }) }),
      reset2fa(p),
      h("button", { class: "btn sm danger", type: "button", text: "Remove", onclick: () => act(p, { status: "removed" }, `Removed ${p.full_name}`, { title: `Remove ${p.full_name}?`, body: "They'll lose access right away and won't be able to log checks. Their past entries stay on record. You can restore them later.", ok: "Remove access", danger: true }) })];
    return h("button", { class: "btn sm", type: "button", text: "Restore", onclick: () => act(p, { status: "active" }, `${p.full_name} has access again`) });
  };
  const tab = S.peopleTab;
  const rows = groups[tab];
  const head = { pending: ["Name", "Signed up", "Actions"], active: ["Name", "Role", "Checks (30d)", "Last check", "Last seen", "Member since", "Actions"], removed: ["Name", "Removed", "By", "Checks on record", "Actions"] }[tab];
  const cells = p => { const ls = S.team.filter(l => l.user_id === p.id);
    const name = h("td", {}, h("div", { style: "display:flex;gap:10px;align-items:center" }, avatar(p.id, p.full_name), h("div", {}, h("div", { text: p.full_name }), h("div", { class: "sub", text: p.email }))));
    const acts = h("td", {}, h("div", { style: "display:flex;gap:6px;flex-wrap:wrap" }, actions(p)));
    if (tab === "pending") return [name, h("td", { class: "nowrap", text: rel(p.created_at) }), acts];
    if (tab === "active") return [name, h("td", {}, h("span", { class: `tag ${p.role === "supervisor" ? "brand" : "line"}`, text: p.role === "supervisor" ? "Supervisor" : "Analyst" })),
      h("td", { class: "num", text: ls.filter(l => now - t(l.performed_at) < 30 * DAY).length }), h("td", { class: "nowrap", text: ls[0] ? rel(ls[0].performed_at) : "Never" }),
      h("td", { class: "nowrap faint", text: rel(p.last_seen_at) }), h("td", { class: "nowrap faint", text: shortDate(p.created_at) }), acts];
    return [name, h("td", { class: "nowrap", text: p.status_changed_at ? shortDate(p.status_changed_at) : "—" }), h("td", { text: p.status_changed_by ? nameOf(p.status_changed_by) : "—" }), h("td", { class: "num", text: ls.length }), acts];
  };
  const siteUrl = location.origin + location.pathname;
  return h("div", {},
    pageHead("People", "Give people access, change roles and remove access. Every change is recorded in the audit trail."),
    h("div", { class: "notice", style: "display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:20px" },
      h("span", {}, "To add someone, send them this link. They create an account and show up under Waiting for approval: ", h("span", { class: "mono", text: siteUrl })),
      h("button", { class: "btn sm", type: "button", text: "Copy link", onclick: async () => { try { await navigator.clipboard.writeText(siteUrl); toast("Link copied"); } catch { toast("Copy didn't work. Select the link and copy it."); } } })),
    h("div", { class: "tabbar", role: "tablist" }, [["pending", "Pending"], ["active", "Active"], ["removed", "Removed"]].map(([k, label]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(k === tab), onclick: () => { S.peopleTab = k; route(); } }, label, h("span", { class: "c", text: groups[k].length })))),
    rows.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, head.map(x => h("th", { text: x })))), h("tbody", {}, rows.map(p => h("tr", {}, cells(p))))))
      : h("div", { class: "panel empty" }, h("b", { text: { pending: "No one is waiting", active: "No active members", removed: "No one has been removed" }[tab] }),
        tab === "pending" ? "New sign-ups appear here for you to approve." : ""));
}

/* =====================================================================
   page: checklist (supervisor)
   ===================================================================== */
function editPractice(p) {
  const isNew = !p; p = p || { tool: "", category: "", name: "", details: "", frequency: "Weekly", priority: "Medium", how_to: "", active: true };
  const close = () => { scrim.remove(); drawer.remove(); };
  const scrim = h("div", { class: "scrim", onclick: close });
  const tools = [...new Set(S.practices.map(x => x.tool))];
  const f = {
    tool: h("input", { type: "text", id: "pTool", list: "toolList", value: p.tool }), category: h("input", { type: "text", id: "pCat", value: p.category }),
    name: h("input", { type: "text", id: "pName", value: p.name, maxlength: "200" }), details: h("textarea", { id: "pDetails", rows: "4", value: p.details || "" }),
    how_to: h("textarea", { id: "pHow", rows: "3", value: p.how_to || "" }),
    frequency: h("select", { id: "pFreq" }, FREQS.map(x => h("option", { value: x, text: x }))), priority: h("select", { id: "pPrio" }, PRIOS.map(x => h("option", { value: x, text: x }))),
  };
  f.frequency.value = p.frequency; f.priority.value = p.priority;
  const err = h("p", { class: "err" });
  const save = h("button", { class: "btn primary", type: "button", text: isNew ? "Add check" : "Save changes", onclick: () => busy(save, "Saving…", async () => {
    const row = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()]));
    if (!row.tool || !row.name || !row.category) return err.textContent = "Tool, category and name are required.";
    try {
      if (isNew) { row.id = (row.tool.toLowerCase().replace(/[^a-z]/g, "").slice(0, 3) || "chk") + "-" + Date.now().toString(36); row.active = true; row.sort_order = S.practices.length + 1; await S.api.addPractice(row); }
      else await S.api.savePractice(p.id, row);
      S.practices = []; toast(isNew ? "Check added" : "Check updated"); close(); route();
    } catch (x) { err.textContent = x.message; } }) });
  const fld = (lbl, el, id) => h("div", { class: "field" }, h("label", { for: id, text: lbl }), el);
  const drawer = h("aside", { class: "drawer", role: "dialog" },
    h("div", { class: "drawer-head" }, h("h2", { text: isNew ? "Add a check" : "Edit check" }), h("button", { class: "btn sm", type: "button", text: "Close", onclick: close })),
    h("div", { class: "drawer-body" }, h("datalist", { id: "toolList" }, tools.map(x => h("option", { value: x }))),
      h("div", { class: "grid-2" }, fld("Tool", f.tool, "pTool"), fld("Category", f.category, "pCat")), fld("Check name", f.name, "pName"),
      h("div", { class: "grid-2" }, fld("Frequency", f.frequency, "pFreq"), fld("Priority", f.priority, "pPrio")),
      fld("What to do", f.details, "pDetails"), fld("Where to find it (click path)", f.how_to, "pHow"), err, h("div", {}, save)));
  document.body.append(scrim, drawer);
}
async function checklistView() {
  const toggle = p => { const lab = h("label", { class: "switch", title: p.active ? "On" : "Off" });
    const inp = h("input", { type: "checkbox", "aria-label": `${p.name} active` }); inp.checked = p.active;
    inp.addEventListener("change", async () => { try { await S.api.savePractice(p.id, { active: inp.checked }); p.active = inp.checked; toast(inp.checked ? "Check turned on" : "Check turned off. Analysts won't see it."); }
      catch (x) { inp.checked = !inp.checked; toast(x.message); } });
    lab.append(inp, h("span")); return lab; };
  const quickSel = (p, key, opts) => { const s = h("select", { "aria-label": key, style: "height:30px;font-size:13px;width:auto" }, opts.map(x => h("option", { value: x, text: x }))); s.value = p[key];
    s.addEventListener("change", async () => { try { await S.api.savePractice(p.id, { [key]: s.value }); p[key] = s.value; toast("Saved"); } catch (x) { s.value = p[key]; toast(x.message); } }); return s; };
  return h("div", {},
    pageHead("Checklist", "The checks analysts can log. Turn off checks you don't do (for example, tools you don't have a license for).",
      h("button", { class: "btn primary", type: "button", text: "Add a check", onclick: () => editPractice(null) })),
    h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["On", "Check", "Tool", "Frequency", "Priority", ""].map(x => h("th", { text: x })))),
      h("tbody", {}, S.practices.map(p => h("tr", {}, h("td", {}, toggle(p)), h("td", {}, h("div", { text: p.name }), h("div", { class: "sub", text: p.category })),
        h("td", { class: "nowrap", text: p.tool }), h("td", {}, quickSel(p, "frequency", FREQS)), h("td", {}, quickSel(p, "priority", PRIOS)),
        h("td", {}, h("button", { class: "btn sm quiet", type: "button", text: "Edit", onclick: () => editPractice(p) }))))))));
}

/* =====================================================================
   page: audit trail (supervisor)
   ===================================================================== */
async function auditView() {
  S.audit = await S.api.audit();
  const who = id => id ? nameOf(id) : "System";
  const say = e => { const tgt = e.target_id ? nameOf(e.target_id) : (e.detail && e.detail.email) || ""; const d = e.detail || {};
    return ({ signed_up: `${tgt} signed up (${d.email || ""})`, bootstrap_supervisor: `${tgt} created the first account and became supervisor`, mfa_reset: `reset ${tgt}'s 2-step verification`,
      approved: `approved ${tgt}`, declined: `declined ${tgt}`, removed: `removed ${tgt}`, restored: `restored access for ${tgt}`, set_pending: `set ${tgt} back to pending`,
      role_changed: `changed ${tgt}'s role from ${d.from_role} to ${d.to_role}`, log_reviewed: `reviewed log entry #${d.log_id} as "${(OUTCOMES[d.outcome] || {}).label || d.outcome}"`,
      review_updated: `updated the review on log entry #${d.log_id} to "${(OUTCOMES[d.outcome] || {}).label || d.outcome}"`,
      checklist_insert: `added "${d.name || d.practice}" to the checklist`, checklist_update: `edited checklist item "${(S.P[d.practice] || {}).name || d.practice}"` })[e.action] || e.action; };
  return h("div", {},
    pageHead("Audit trail", "Who changed access, roles, reviews and the checklist, and when. This record can't be edited from the app."),
    S.audit.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["When", "Who", "What happened"].map(x => h("th", { text: x })))),
      h("tbody", {}, S.audit.map(e => h("tr", {}, h("td", { class: "nowrap num", title: full(e.at), text: when(e.at) }), h("td", { class: "nowrap", text: e.action === "signed_up" ? "—" : who(e.actor_id) }), h("td", { text: say(e) }))))))
      : h("div", { class: "panel empty" }, h("b", { text: "Nothing yet" }), "Access changes will be recorded here."));
}


/* =====================================================================
   pages (navigation targets)
   ===================================================================== */
const strip = (node, extraSel) => { const head = node.querySelector(".page-head"); const actions = head ? [...(head.querySelector(".actions")?.children || [])] : []; head?.remove(); if (extraSel) node.querySelectorAll(extraSel).forEach(e => e.remove()); return { node, actions }; };

PAGES.home = async () => isSup() ? supHome() : analystHome();

/* analyst home: what's due for me, grouped the way a shift works */
function analystHome() {
  const now = Date.now(), first = S.me.full_name.split(" ")[0];
  const lastMine = {}; for (const l of S.mine) if (!lastMine[l.practice_id]) lastMine[l.practice_id] = l;
  const today = S.mine.filter(l => dayKey(l.performed_at) === dayKey(now));
  const status = p => { const l = lastMine[p.id]; if (l && dayKey(l.performed_at) === dayKey(now)) return { t: "Done today", c: "ok", r: 3 };
    const s = coverageStatus(p, l && l.performed_at); return s.label === "On track" ? { t: "Done", c: "ok", r: 2 } : s.label === "Never done" ? { t: "Not done yet", c: "line", r: 1 } : s.label === "Overdue" ? { t: "Due", c: "warn", r: 0 } : { t: "Any time", c: "line", r: 4 }; };
  const groups = [["Every shift", ["Continuous", "Daily"]], ["This week", ["Weekly"]], ["This month or later", ["Monthly", "Quarterly", "Annually"]], ["When something happens", ["As Needed"]]];
  const row = p => { const st = status(p), l = lastMine[p.id];
    return h("button", { type: "button", class: "row click due-row", onclick: () => openLogSheet(p.id) },
      h("span", { class: "tile sm", style: `background:${toolColor(p.tool)}` }, toolGlyph(p.tool)),
      h("div", { class: "grow" }, h("div", { text: p.name }), h("div", { class: "faint small" }, h("span", { text: p.tool }), h("span", { class: `prio ${p.priority}`, text: ` · ${p.priority}` }),
        h("span", { text: l ? ` · you did this ${/ago|now/i.test(rel(l.performed_at)) ? rel(l.performed_at).toLowerCase() : "on " + rel(l.performed_at)}` : "" }))),
      h("span", { class: `tag ${st.c}`, text: st.t }), icon("arrow")); };
  const sections = groups.map(([title, freqs]) => {
    const ps = S.practices.filter(p => p.active && freqs.includes(p.frequency)).sort((a, b) => status(a).r - status(b).r || PRIOS.indexOf(a.priority) - PRIOS.indexOf(b.priority));
    if (!ps.length) return null;
    const due = ps.filter(p => status(p).r <= 1).length;
    return h("section", { class: "section" }, h("div", { class: "section-head" }, h("h2", { text: title }), h("span", { class: "faint small", text: due ? `${due} to do` : "All done" })),
      h("div", { class: "panel list" }, ps.map(row)));
  });
  const recent = S.mine.slice(0, 5);
  return h("div", {},
    pageHead(`${greeting()}, ${first}`, today.length ? `You've logged ${plural(today.length, "check")} today. Pick a check below to log it.` : "Nothing logged yet today. Pick a check below to log it.",
      h("button", { class: "btn primary", type: "button", onclick: () => openLogSheet() }, icon("plus"), "New log entry")),
    h("div", { class: "home-grid" },
      h("div", {}, ...sections),
      h("aside", { class: "section" }, h("div", { class: "section-head" }, h("h2", { text: "Your latest entries" }), h("a", { class: "small", href: "#/activity", text: "My log" })),
        h("div", { class: "panel list" }, recent.length ? recent.map(l => h("div", { class: "row click", onclick: () => openLog(l) },
          h("div", { class: "grow" }, h("div", { text: (S.P[l.practice_id] || {}).name }), h("div", { class: "faint small", text: when(l.performed_at) })),
          S.reviews[l.id] ? outcomeTag(S.reviews[l.id].outcome) : resultTag(l.result))) : h("div", { class: "empty" }, h("b", { text: "No entries yet" }), "Your log entries show up here.")))));
}
const TOOL_COLORS = { CrowdStrike: "#e0333b", "Microsoft Defender": "#0a84ff", Splunk: "#65a637", Abnormal: "#5e5ce6", Duo: "#30b158", "Cross-Tool": "#8e8e93" };
const toolColor = t => TOOL_COLORS[t] || "#8e8e93";
const toolGlyph = t => h("b", { text: (t === "Cross-Tool" ? "X" : t === "Microsoft Defender" ? "MD" : t.slice(0, 2)).toUpperCase().slice(0, 2) });

/* activity: team log for supervisors, my log for analysts */
PAGES.activity = async () => {
  if (!isSup()) return myLog();
  const v = S.actView || "all";
  S.filters.status = v === "review" ? "open" : v === "flagged" ? "flagged" : "";
  S.filters.user = v === "mine" ? S.me.id : (S.filters.user === S.me.id ? "" : S.filters.user);
  const { node, actions } = strip(await teamActivity(), 'select[aria-label="Status"]');
  const counts = { review: S.team.filter(isOpenEsc).length, flagged: S.team.filter(l => flagsOf(l).length).length };
  return h("div", {}, pageHead("Activity", "Every check your team has logged. Click an entry to see the full record and review it.", actions),
    h("div", { class: "view-bar" }, segmented([["all", "All entries"], ["review", "Needs review", counts.review], ["flagged", "Flagged", counts.flagged], ["mine", "Mine"]], v, k => { S.actView = k; route(); })),
    node);
};

/* checklist: coverage and editing in one place */
PAGES.checks = async () => {
  const v = S.checksView || "coverage";
  const { node, actions } = strip(v === "edit" ? await checklistView() : await coverageView());
  return h("div", {}, pageHead("Checklist", v === "edit" ? "Turn checks on or off, change how often they're due, or add new ones." : "Is every check getting done as often as it should?", actions),
    h("div", { class: "view-bar" }, segmented([["coverage", "Coverage"], ["edit", "Edit checklist"]], v, k => { S.checksView = k; route(); })), node);
};

/* team: members, approvals, removed people, audit trail */
PAGES.team = async () => {
  const v = S.teamView || (S.people.some(p => p.status === "pending") ? "pending" : "active");
  const n = st => S.people.filter(p => p.status === st).length;
  let built;
  if (v === "audit") built = strip(await auditView());
  else { S.peopleTab = v; built = strip(await peopleView(), ".tabbar"); }
  return h("div", {}, pageHead("Team", v === "audit" ? "Every access change, role change, review and checklist edit, with who did it and when." : "Approve new sign-ups, change roles and remove access. Every change is recorded.", built.actions),
    h("div", { class: "view-bar" }, segmented([["active", "Members", n("active")], ["pending", "Waiting for approval", n("pending")], ["removed", "Removed", n("removed")], ["audit", "Audit trail"]], v, k => { S.teamView = k; route(); })),
    built.node);
};

/* =====================================================================
   page: settings (supervisor) + account (everyone)
   ===================================================================== */
PAGES.settings = async () => {
  const org = h("input", { type: "text", id: "org", value: S.settings.org_name || "" });
  const dom = h("input", { type: "text", id: "domain", value: S.settings.allowed_email_domain || "", placeholder: "shu.edu" });
  const save = h("button", { class: "btn primary", type: "button", text: "Save settings", onclick: () => busy(save, "Saving…", async () => {
    try { const patch = { org_name: org.value.trim() || "SOC", allowed_email_domain: dom.value.trim().replace(/^@/, "").toLowerCase() || null };
      await S.api.saveSettings(patch); Object.assign(S.settings, patch); toast("Settings saved"); } catch (x) { toast(x.message); } }) });
  return h("div", {}, pageHead("Team settings", "Applies to everyone using this SOC log."),
    h("div", { class: "panel pad", style: "max-width:560px;display:flex;flex-direction:column;gap:16px" },
      h("div", { class: "field" }, h("label", { for: "org", text: "Team name" }), org, h("p", { class: "help", text: "Shown on the sign-in page and at the top of the app." })),
      h("div", { class: "field" }, h("label", { for: "domain", text: "Allowed email domain for sign-up" }), dom,
        h("p", { class: "help", text: "Only emails ending in this domain can create an account. Leave it empty to allow any email (not recommended)." })),
      h("div", {}, save)));
};
PAGES.account = async () => {
  const name = h("input", { type: "text", id: "myName", value: S.me.full_name });
  const p1 = h("input", { type: "password", id: "np1", autocomplete: "new-password" }), p2 = h("input", { type: "password", id: "np2", autocomplete: "new-password" });
  const saveName = h("button", { class: "btn", type: "button", text: "Save name", onclick: () => busy(saveName, "Saving…", async () => {
    const v = name.value.trim(); if (v.split(/\s+/).length < 2) return toast("Enter your first and last name.");
    try { await S.api.renameMe(S.me.id, v); S.me.full_name = v; toast("Name saved"); route(); } catch (x) { toast(x.message); } }) });
  const savePw = h("button", { class: "btn", type: "button", text: "Change password", onclick: () => busy(savePw, "Saving…", async () => {
    if (p1.value.length < 8) return toast("Use at least 8 characters."); if (p1.value !== p2.value) return toast("The passwords don't match.");
    try { await S.api.setPassword(p1.value); p1.value = p2.value = ""; toast("Password changed"); } catch (x) { toast(x.message); } }) });
  const [factors, keys] = await Promise.all([S.api.factors().catch(() => []), S.api.passkeys().catch(() => null)]);
  const totp = factors.filter(f => f.status === "verified");
  const newPhone = h("button", { class: "btn", type: "button", text: "Move to a new phone", onclick: async () => {
    if (!(await confirmBox({ title: "Move 2-step verification to a new phone?", body: "Your current Duo Mobile entry stops working right away. You'll scan a new QR code next.", ok: "Continue" }))) return;
    try { for (const f of totp) await S.api.removeTotp(f.id); await route(); } catch (x) { toast(x.message); } } });
  const mfaPanel = h("div", { class: "panel pad", style: "display:flex;flex-direction:column;gap:14px" }, h("h2", { text: "2-step verification" }),
    h("p", { class: "dim" }, h("span", { class: "tag ok", text: "On" }), " ",
      totp.length ? `Duo Mobile code, set up ${shortDate(totp[0].created_at)}. You'll enter a code each time you sign in.` : "Set up."),
    h("div", {}, newPhone));
  const addKey = h("button", { class: "btn", type: "button", text: "Add a passkey", onclick: () => busy(addKey, "Waiting for your device…", async () => {
    try { await S.api.addPasskey(); toast("Passkey added"); route(); } catch (x) { toast(x.message); } }) });
  const keyPanel = keys === null ? null : h("div", { class: "panel pad", style: "display:flex;flex-direction:column;gap:14px" }, h("h2", { text: "Passkeys" }),
    h("p", { class: "dim", text: "Sign in with Face ID, Touch ID, Windows Hello or a security key instead of a password." }),
    keys.length ? h("ul", { class: "keylist" }, keys.map(k => h("li", {}, h("div", {}, h("div", { text: k.friendly_name || "Passkey" }),
        h("div", { class: "sub", text: `Added ${shortDate(k.created_at)}${k.last_used_at ? ` · last used ${rel(k.last_used_at).toLowerCase()}` : ""}` })),
      h("button", { class: "btn sm danger", type: "button", text: "Remove", onclick: async () => {
        if (!(await confirmBox({ title: "Remove this passkey?", body: "You won't be able to sign in with it anymore.", ok: "Remove", danger: true }))) return;
        try { await S.api.removePasskey(k.id); toast("Passkey removed"); route(); } catch (x) { toast(x.message); } } }))))
      : h("p", { class: "faint small", text: "No passkeys yet." }),
    h("div", {}, addKey));
  return h("div", {}, pageHead("Account", `${S.me.email} · ${isSup() ? "Supervisor" : "Analyst"} · member since ${shortDate(S.me.created_at)}`),
    h("div", { style: "display:flex;flex-direction:column;gap:20px;max-width:560px" },
      h("div", { class: "panel pad", style: "display:flex;flex-direction:column;gap:14px" }, h("h2", { text: "Your name" }),
        h("div", { class: "field" }, h("label", { for: "myName", text: "Full name" }), name), h("div", {}, saveName)),
      h("div", { class: "panel pad", style: "display:flex;flex-direction:column;gap:14px" }, h("h2", { text: "Password" }),
        h("div", { class: "grid-2" }, h("div", { class: "field" }, h("label", { for: "np1", text: "New password" }), p1), h("div", { class: "field" }, h("label", { for: "np2", text: "Confirm" }), p2)),
        h("div", {}, savePw)), mfaPanel, keyPanel));
};

/* =====================================================================
   boot
   ===================================================================== */
(async () => {
  try {
    const back = new URLSearchParams(location.hash.replace(/^#/, "") + "&" + location.search.replace(/^\?/, ""));
    const oauthErr = back.get("error_description");
    S.api = await createApi();
    if (oauthErr) {
      S.authNote = { cls: "bad", text: /database error saving new user/i.test(oauthErr) ? "Sign-up was refused. Use your university email account." : oauthErr.replace(/\+/g, " ") };
      history.replaceState(null, "", location.pathname);
    }
    S.settings = await S.api.settings().catch(() => ({}));
    S.api.onAuth(event => {
      if (event === "PASSWORD_RECOVERY") { S.recovering = true; viewAuth(); }
      else if (event === "SIGNED_OUT") { S.me = null; S.team = null; }
    });
    await route();
  } catch (x) {
    app.replaceChildren(h("div", { class: "solo" }, h("div", { class: "card" }, h("h1", { text: "The SOC log couldn't start" }),
      h("p", { class: "dim", text: x.message || String(x) }), h("p", { class: "dim small", text: "Check js/config.js and that schema.sql was run in Supabase." }))));
  }
})();
