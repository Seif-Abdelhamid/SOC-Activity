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

let toastT;
function toast(msg) {
  document.querySelector(".toast")?.remove(); clearTimeout(toastT);
  const el = h("div", { class: "toast", role: "status", text: msg }); document.body.append(el);
  toastT = setTimeout(() => el.remove(), 3500);
}
function confirmBox({ title, body, ok = "Confirm", danger = false }) {
  return new Promise(resolve => {
    const close = v => { scrim.remove(); box.remove(); resolve(v); };
    const scrim = h("div", { class: "scrim dialog-scrim", onclick: () => close(false) });
    const box = h("div", { class: "dialog", role: "dialog", "aria-modal": "true" },
      h("h2", { text: title }), body ? h("p", { class: "dim", text: body }) : null,
      h("div", { class: "btns" }, h("button", { class: "btn", type: "button", text: "Cancel", onclick: () => close(false) }),
        h("button", { class: `btn ${danger ? "danger" : "primary"}`, type: "button", text: ok, onclick: () => close(true) })));
    document.body.append(scrim, box); box.querySelector(".btn:last-child").focus();
  });
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
  clearInterval(S.clock); S.clock = null;
  document.querySelectorAll(".scrim, .drawer, .dialog").forEach(e => e.remove());
  const bar = isDemo ? demoBar() : null;
  app.replaceChildren(...[bar, ...nodes].filter(Boolean));
}
function demoBar() {
  const kids = [configured ? "Demo mode. Sample data only, nothing you do is saved." : "Not connected to a database yet, so you're looking at sample data. Follow the README to connect Supabase."];
  if (S.me && S.api && S.api.demo) {
    const other = isSup() ? ["maya.patel@shu.edu", "student"] : ["seif.abdelhamid@shu.edu", "supervisor"];
    kids.push(h("button", { type: "button", text: `Switch to the ${other[1]} view`, onclick: async () => { await S.api.signIn(other[0]); history.replaceState(null, "", location.pathname + location.search); route(); } }));
  }
  return h("div", { class: "demo-bar" }, kids);
}

/* =====================================================================
   auth screens
   ===================================================================== */
function authSide() {
  const clock = h("div", { class: "clock" }), sub = h("div", { class: "clock-sub" });
  const tick = () => {
    const d = new Date();
    clock.textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    sub.textContent = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) + " · " + (d.toLocaleTimeString([], { timeZoneName: "short" }).split(" ").pop());
  };
  tick(); setTimeout(() => { S.clock = setInterval(tick, 1000); });
  return h("aside", { class: "auth-side" },
    h("div", { class: "mark" }, h("b", { text: "SOC" }), S.settings.org_name || "Security Operations"),
    h("div", {}, clock, sub),
    h("div", {},
      h("h2", { text: "Every check your team runs, on the record." }),
      h("ul", { class: "facts" },
        h("li", {}, h("span", { text: "01" }), "Your name and the server's clock are stamped on every entry."),
        h("li", {}, h("span", { text: "02" }), "Saved logs can't be edited or deleted, by anyone."),
        h("li", {}, h("span", { text: "03" }), "Analysts see their own work. Supervisors see the whole team."))));
}
function viewAuth() {
  const mode = S.recovering ? "reset" : S.authMode;
  const domain = S.settings.allowed_email_domain;
  const err = h("p", { class: "err", role: "alert" });
  const go = m => { S.authMode = m; S.authNote = null; viewAuth(); };
  const note = S.authNote ? h("div", { class: `notice ${S.authNote.cls || ""}`, text: S.authNote.text }) : null;
  let title, sub, form, foot;

  const email = h("input", { type: "email", id: "email", autocomplete: "email", required: true, placeholder: domain ? `you@${domain}` : "you@school.edu",
    value: isDemo && mode === "signin" ? "seif.abdelhamid@shu.edu" : "" });
  const pw = (id, ac) => h("input", { type: "password", id, autocomplete: ac, required: true, minlength: "8" });

  if (mode === "signin") {
    title = "Sign in"; sub = "Use the account you created for the SOC log.";
    const p = pw("password", "current-password"); if (isDemo) p.value = "demo-password";
    form = h("form", { onsubmit: async e => { e.preventDefault(); err.textContent = "";
      await busy(e.submitter || form.querySelector("[type=submit]"), "Signing in…", async () => {
        try { await S.api.signIn(email.value.trim(), p.value); await route(); } catch (x) { err.textContent = x.message; } }); } },
      h("div", { class: "field" }, h("label", { for: "email", text: "Email" }), email),
      h("div", { class: "field" }, h("label", { for: "password" }, "Password", h("button", { type: "button", class: "btn quiet sm", style: "margin-left:auto;height:auto;padding:0", text: "Forgot password?", onclick: () => go("forgot") })), p),
      isDemo ? h("p", { class: "help", text: "Demo: sign in as seif.abdelhamid@shu.edu (supervisor) or maya.patel@shu.edu (student). Any password works." }) : null,
      err, h("button", { class: "btn primary wide", type: "submit", text: "Sign in" }));
    foot = h("p", { class: "auth-switch" }, "New to the SOC team? ", h("button", { type: "button", text: "Create an account", onclick: () => go("signup") }));
  } else if (mode === "signup") {
    title = "Create your account"; sub = "Your supervisor approves new accounts before you can log checks.";
    const name = h("input", { type: "text", id: "fullname", autocomplete: "name", required: true, placeholder: "First and last name" });
    const p1 = pw("password", "new-password"), p2 = pw("password2", "new-password");
    form = h("form", { onsubmit: async e => { e.preventDefault(); err.textContent = "";
      const em = email.value.trim().toLowerCase();
      if (name.value.trim().split(/\s+/).length < 2) return err.textContent = "Enter your first and last name.";
      if (domain && !em.endsWith("@" + domain.toLowerCase())) return err.textContent = `Use your @${domain} email address.`;
      if (p1.value.length < 8) return err.textContent = "Use a password with at least 8 characters.";
      if (p1.value !== p2.value) return err.textContent = "The passwords don't match.";
      await busy(form.querySelector("[type=submit]"), "Creating account…", async () => {
        try {
          const r = await S.api.signUp(name.value.trim(), em, p1.value);
          if (r.needsConfirm) { S.authMode = "signin"; S.authNote = { text: `Almost done. We sent a confirmation link to ${em}. Open it, then sign in here.` }; viewAuth(); }
          else await route();
        } catch (x) { err.textContent = x.message; } }); } },
      h("div", { class: "field" }, h("label", { for: "fullname", text: "Full name" }), name),
      h("div", { class: "field" }, h("label", { for: "email" }, "University email"), email, domain ? h("p", { class: "help", text: `Only @${domain} addresses can sign up.` }) : null),
      h("div", { class: "grid-2" }, h("div", { class: "field" }, h("label", { for: "password", text: "Password" }), p1),
        h("div", { class: "field" }, h("label", { for: "password2", text: "Confirm password" }), p2)),
      h("p", { class: "help", text: "At least 8 characters. Don't reuse your SHU password." }),
      err, h("button", { class: "btn primary wide", type: "submit", text: "Create account" }));
    foot = h("p", { class: "auth-switch" }, "Already have an account? ", h("button", { type: "button", text: "Sign in", onclick: () => go("signin") }));
  } else if (mode === "forgot") {
    title = "Reset your password"; sub = "We'll email you a link to choose a new one.";
    form = h("form", { onsubmit: async e => { e.preventDefault(); err.textContent = "";
      await busy(form.querySelector("[type=submit]"), "Sending…", async () => {
        try { await S.api.sendReset(email.value.trim()); S.authMode = "signin"; S.authNote = { text: `If ${email.value.trim()} has an account, a reset link is on its way.` }; viewAuth(); }
        catch (x) { err.textContent = x.message; } }); } },
      h("div", { class: "field" }, h("label", { for: "email", text: "Email" }), email), err,
      h("button", { class: "btn primary wide", type: "submit", text: "Send reset link" }));
    foot = h("p", { class: "auth-switch" }, h("button", { type: "button", text: "Back to sign in", onclick: () => go("signin") }));
  } else {
    title = "Choose a new password"; sub = "You followed a reset link. Set your new password below.";
    const p1 = pw("password", "new-password"), p2 = pw("password2", "new-password");
    form = h("form", { onsubmit: async e => { e.preventDefault(); err.textContent = "";
      if (p1.value.length < 8) return err.textContent = "Use a password with at least 8 characters.";
      if (p1.value !== p2.value) return err.textContent = "The passwords don't match.";
      await busy(form.querySelector("[type=submit]"), "Saving…", async () => {
        try { await S.api.setPassword(p1.value); S.recovering = false; toast("Password updated"); await route(); } catch (x) { err.textContent = x.message; } }); } },
      h("div", { class: "field" }, h("label", { for: "password", text: "New password" }), p1),
      h("div", { class: "field" }, h("label", { for: "password2", text: "Confirm new password" }), p2), err,
      h("button", { class: "btn primary wide", type: "submit", text: "Save password" }));
  }
  mount(h("div", { class: "auth" },
    h("main", { class: "auth-form" }, h("div", {}, h("div", { class: "mark" }, h("b", { text: "SOC" }), "SOC Log"),
      h("div", {}, h("h1", { text: title }), h("p", { class: "dim", style: "margin-top:6px", text: sub })), note, form, foot)),
    authSide()));
  (mode === "signup" ? document.getElementById("fullname") : document.getElementById("email") || document.getElementById("password"))?.focus();
}

function viewSolo(title, body, extra = []) {
  mount(h("div", { class: "solo" }, h("div", { class: "card" },
    h("div", { class: "mark" }, h("b", { text: "SOC" }), S.settings.org_name || "SOC Log"),
    h("h1", { text: title }), ...body.map(p => typeof p === "string" ? h("p", { class: "dim", text: p }) : p),
    h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, ...extra,
      h("button", { class: "btn", type: "button", text: "Sign out", onclick: async () => { await S.api.signOut(); S.me = null; route(); } })))));
}
const viewPending = () => viewSolo("Waiting for approval", [
  `Thanks, ${S.me.full_name.split(" ")[0]}. Your account (${S.me.email}) was created ${rel(S.me.created_at).toLowerCase()}.`,
  "A supervisor needs to approve it before you can log checks. Let them know you've signed up. This page updates when you check again.",
], [h("button", { class: "btn primary", type: "button", text: "Check again", onclick: () => route() })]);
const viewRemoved = () => viewSolo("Your access has been removed", [
  "You can no longer log checks for this SOC. Your past entries are still kept on record.",
  "If you think this is a mistake, talk to your supervisor.",
]);

/* =====================================================================
   shell + routing
   ===================================================================== */
const ROUTES_ANALYST = [["log", "Log a check"], ["history", "My checks"], ["account", "Account"]];
const ROUTES_SUP = [["overview", "Overview"], ["activity", "Activity"], ["coverage", "Coverage"], ["people", "People"],
  ["checklist", "Checklist"], ["audit", "Audit trail"], ["settings", "Settings"], ["log", "Log a check"], ["history", "My checks"], ["account", "Account"]];
const PAGES = {};

function shell(current, content) {
  const routes = isSup() ? ROUTES_SUP : ROUTES_ANALYST;
  const pending = isSup() ? S.people.filter(p => p.status === "pending").length : 0;
  const openEsc = isSup() && S.team ? S.team.filter(isOpenEsc).length : 0;
  const link = ([id, label]) => h("a", { href: `#/${id}`, "aria-current": id === current ? "page" : null }, label,
    id === "people" && pending ? h("span", { class: "badge", text: pending }) : null,
    id === "activity" && openEsc ? h("span", { class: "badge", text: openEsc }) : null);
  const nav = isSup()
    ? [h("div", { class: "group label", text: "Team" }), ...routes.slice(0, 4).map(link), h("div", { class: "group label", text: "Admin" }), ...routes.slice(4, 7).map(link),
       h("div", { class: "group label", text: "My work" }), ...routes.slice(7).map(link)]
    : routes.map(link);
  const signOut = async () => { await S.api.signOut(); S.me = null; S.team = null; location.hash = ""; route(); };
  mount(h("div", { class: "shell" },
    h("aside", { class: "side" },
      h("div", { class: "side-top" }, h("div", {}, h("div", { class: "mark" }, h("b", { text: "SOC" }), "SOC Log"), h("div", { class: "org", text: S.settings.org_name || "" })),
        h("div", { class: "mobile-user" }, h("span", { class: "avatar", text: initials(S.me.full_name) }), h("button", { class: "btn sm", type: "button", text: "Sign out", onclick: signOut }))),
      h("nav", { class: "nav", "aria-label": "Main" }, nav),
      h("div", { class: "side-user" }, h("span", { class: "avatar", text: initials(S.me.full_name) }),
        h("div", { class: "who" }, h("div", { class: "nm", text: S.me.full_name }), h("div", { class: "rl", text: isSup() ? "Supervisor" : "Analyst" })),
        h("button", { class: "btn quiet sm", type: "button", text: "Sign out", onclick: signOut }))),
    h("main", { class: "main", id: "main" }, content)));
}
function pageHead(title, sub, ...actions) {
  return h("header", { class: "page-head" }, h("div", {}, h("h1", { text: title }), sub ? h("p", { text: sub }) : null),
    actions.length ? h("div", { class: "actions" }, actions) : null);
}

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

let routing = false;
async function route() {
  if (routing) return; routing = true;
  try {
    if (S.recovering) return viewAuth();
    const session = await S.api.session();
    if (!session) { S.me = null; return viewAuth(); }
    S.me = await S.api.me();
    if (!S.me) return viewSolo("We couldn't load your profile", ["Your login worked but your SOC profile is missing. Ask your supervisor to check the database setup (schema.sql)."]);
    if (S.me.status === "pending") return viewPending();
    if (S.me.status === "removed") return viewRemoved();
    S.api.touch().catch(() => {});
    if (!S.practices.length) { S.practices = await S.api.practices(); S.P = Object.fromEntries(S.practices.map(p => [p.id, p])); }
    const routes = (isSup() ? ROUTES_SUP : ROUTES_ANALYST).map(r => r[0]);
    let id = location.hash.replace(/^#\/?/, "");
    if (!routes.includes(id)) { id = isSup() ? "overview" : "log"; history.replaceState(null, "", `#/${id}`); }
    shell(id, h("div", { class: "loading", text: "Loading…" }));
    try {
      await Promise.all([loadMine(), loadTeam()]);
      shell(id, await PAGES[id]());
    } catch (x) {
      shell(id, h("div", { class: "notice bad", text: x.message || "Something went wrong loading this page." }));
    }
  } finally { routing = false; }
}
window.addEventListener("hashchange", () => route());

/* =====================================================================
   page: log a check
   ===================================================================== */
PAGES.log = async () => {
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
  details.addEventListener("input", () => { const n = details.value.trim().length; counter.textContent = n < 25 ? `${n} / 25` : `${n} characters`; counter.style.color = n && n < 25 ? "var(--bad)" : ""; });
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

  const form = h("form", { class: "panel", novalidate: true, onsubmit: async e => {
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
        document.getElementById("main").replaceChildren(pageHead("Log a check", "Saved."), receipt(saved));
        window.scrollTo(0, 0);
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

  const recent = S.mine.slice(0, 6);
  const todayCount = S.mine.filter(l => dayKey(l.performed_at) === dayKey(Date.now())).length;
  const aside = h("aside", { class: "panel aside-card" },
    h("div", { class: "section-head", style: "margin:0" }, h("h2", { text: "Your recent checks" }), h("a", { href: "#/history", class: "small", text: "See all" })),
    h("p", { class: "dim small", text: todayCount ? `${plural(todayCount, "check")} logged today.` : "Nothing logged today yet." }),
    recent.length ? h("div", { class: "mini-list" }, recent.map(l => h("div", {},
      h("div", { style: "display:flex;justify-content:space-between;gap:8px" }, h("span", { class: "small faint", text: when(l.performed_at) }), resultTag(l.result)),
      h("span", { text: (S.P[l.practice_id] || {}).name || l.practice_id })))) : null);

  return h("div", {}, pageHead("Log a check", "Fill this in as soon as you finish a check."), h("div", { class: "log-layout" }, form, aside));
};

function receipt(l) {
  const p = S.P[l.practice_id] || {};
  return h("div", { class: "panel receipt" },
    h("span", { class: "label", text: "Entry saved" }), h("div", { class: "ref", text: l.ref }),
    h("dl", {}, h("dt", { text: "Check" }), h("dd", { text: p.name }), h("dt", { text: "Result" }), h("dd", {}, resultTag(l.result)),
      h("dt", { text: "Performed" }), h("dd", { text: full(l.performed_at) }), h("dt", { text: "Saved (server)" }), h("dd", { text: full(l.created_at) }),
      l.ticket ? [h("dt", { text: "Ticket" }), h("dd", { class: "mono", text: l.ticket })] : null),
    l.result === "escalated" ? h("div", { class: "notice warn", text: "Escalations show up for your supervisor right away. If it's urgent, also call or message them directly." }) : null,
    h("div", { style: "display:flex;gap:8px" }, h("button", { class: "btn primary", type: "button", text: "Log another check", onclick: () => route() }),
      h("a", { class: "btn", href: "#/history", text: "My checks" })));
}

/* =====================================================================
   page: my checks
   ===================================================================== */
PAGES.history = async () => {
  const rows = S.mine;
  const wk = rows.filter(l => Date.now() - t(l.performed_at) < 7 * DAY).length;
  const body = rows.length ? h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, ["Performed", "Check", "Result", "Ticket", "Entry", "Supervisor"].map(x => h("th", { text: x })))),
    h("tbody", {}, rows.map(l => { const p = S.P[l.practice_id] || {}; const rv = S.reviews[l.id];
      return h("tr", { class: "click", onclick: () => openLog(l) },
        h("td", { class: "nowrap num", text: when(l.performed_at) }), h("td", {}, h("div", { text: p.name || l.practice_id }), h("div", { class: "sub", text: p.tool })),
        h("td", {}, resultTag(l.result)), h("td", { class: "mono nowrap", text: l.ticket || "—" }), h("td", { class: "mono nowrap faint", text: l.ref }),
        h("td", {}, rv ? outcomeTag(rv.outcome) : h("span", { class: "faint", text: "—" }))); }))))
    : h("div", { class: "panel empty" }, h("b", { text: "No checks yet" }), "Your log entries will appear here.", h("div", { style: "margin-top:12px" }, h("a", { class: "btn primary", href: "#/log", text: "Log your first check" })));
  return h("div", {}, pageHead("My checks", `${rows.length} ${rows.length === 1 ? "entry" : "entries"} on record · ${wk} in the last 7 days. Entries can't be changed after saving. If something's wrong, log a correction and mention the original entry number.`), body);
};

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
    if (c.esc) { const dot = svg("circle", { cx: x + bw / 2, cy: y(0) - hh - 7, r: 3.5, fill: "var(--bad)" }); s.append(dot); }
    const wd = c.d.getDay();
    if (i % 2 === (13 % 2) || counts.length <= 7) { const tx = svg("text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle", class: "axis" }); tx.textContent = c.d.toLocaleDateString([], { month: "numeric", day: "numeric" }); tx.style.fill = "var(--ink-3)"; tx.style.font = "11px var(--mono)"; s.append(tx); }
    const hit = svg("rect", { x: L + i * cw, y: T, width: cw, height: H - T - B, fill: "transparent" });
    hit.addEventListener("mouseenter", () => { tip.hidden = false; tip.textContent = `${c.d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}: ${plural(c.n, "check")}${c.esc ? `, ${c.esc} escalated` : ""}${wd === 0 || wd === 6 ? " (weekend)" : ""}`;
      const box = s.getBoundingClientRect(); tip.style.left = `${((x + bw / 2) / W) * box.width + 16}px`; tip.style.top = `${(y(0) - hh) / H * box.height + 4}px`; });
    hit.addEventListener("mouseleave", () => tip.hidden = true);
    s.append(hit);
  });
  wrap.append(s, tip);
  return wrap;
}

PAGES.overview = async () => {
  const L = S.team, now = Date.now();
  const today = L.filter(l => dayKey(l.performed_at) === dayKey(now)).length;
  const wk = L.filter(l => now - t(l.performed_at) < 7 * DAY).length, prev = L.filter(l => now - t(l.performed_at) >= 7 * DAY && now - t(l.performed_at) < 14 * DAY).length;
  const open = L.filter(isOpenEsc);
  const last = lastByPractice(); const active = S.practices.filter(p => p.active);
  const statuses = active.map(p => ({ p, s: coverageStatus(p, last[p.id] && last[p.id].performed_at) }));
  const overdue = statuses.filter(x => x.s.rank <= 1);
  const covered = active.filter(p => L.some(l => l.practice_id === p.id && now - t(l.performed_at) < 31 * DAY)).length;
  const pending = S.people.filter(p => p.status === "pending");
  const stat = (v, label, sub, bad) => h("div", { class: "stat" }, h("span", { class: "label", text: label }), h("span", { class: `v${bad ? " bad" : ""}`, text: v }), h("span", { class: "s", text: sub }));
  const delta = wk - prev;

  const attention = [
    ...open.slice(0, 6).map(l => h("div", { class: "row click", onclick: () => openLog(l) }, h("span", { class: "tag bad" }, h("i"), "Escalation"),
      h("div", { class: "grow" }, h("div", { text: (S.P[l.practice_id] || {}).name }), h("div", { class: "faint small", text: `${nameOf(l.user_id)} · ${when(l.performed_at)}` })))),
    ...pending.map(p => h("a", { class: "row", href: "#/people" }, h("span", { class: "tag brand" }, h("i"), "Approval"),
      h("div", { class: "grow" }, h("div", { text: p.full_name }), h("div", { class: "faint small", text: `${p.email} · signed up ${rel(p.created_at).toLowerCase()}` })))),
    ...overdue.filter(x => x.p.priority === "Critical" || x.p.priority === "High").slice(0, 8).map(x => h("a", { class: "row", href: "#/coverage" }, h("span", { class: `tag ${x.s.cls}` }, h("i"), x.s.label),
      h("div", { class: "grow" }, h("div", { text: x.p.name }), h("div", { class: "small" }, h("span", { class: `prio ${x.p.priority}`, text: x.p.priority }), h("span", { class: "faint", text: ` · ${x.p.tool} · ${x.p.frequency}` }))))),
  ];
  const analysts = S.people.filter(p => p.status === "active");
  const team = analysts.map(p => { const ls = L.filter(l => l.user_id === p.id);
    return { p, w: ls.filter(l => now - t(l.performed_at) < 7 * DAY).length, m: ls.filter(l => now - t(l.performed_at) < 30 * DAY).length,
      esc: ls.filter(l => l.result === "escalated" && now - t(l.performed_at) < 30 * DAY).length,
      fl: ls.filter(l => now - t(l.performed_at) < 30 * DAY && flagsOf(l).length).length, last: ls[0] && ls[0].performed_at }; })
    .sort((a, b) => b.m - a.m);

  return h("div", {},
    pageHead("Overview", `${S.settings.org_name || "SOC"} · ${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}`,
      h("button", { class: "btn", type: "button", text: "Refresh", onclick: async e => { await busy(e.target, "Refreshing…", () => loadTeam(true)); route(); } }),
      h("a", { class: "btn primary", href: "#/activity", text: "View all activity" })),
    h("div", { class: "stats" },
      stat(today, "Today", "checks logged"),
      stat(wk, "Last 7 days", delta === 0 ? "same as the week before" : `${delta > 0 ? "+" : ""}${delta} vs the week before`),
      stat(open.length, "Open escalations", open.length ? "need your review" : "nothing waiting", open.length > 0),
      stat(`${covered}/${active.length}`, "Checklist coverage", "checks done in the last 31 days"),
      stat(overdue.length, "Overdue", "or never done", overdue.length > 0)),
    h("div", { class: "cols section" },
      h("div", { style: "display:flex;flex-direction:column;gap:24px;min-width:0" },
        h("section", {}, h("div", { class: "section-head" }, h("h2", { text: "Checks per day" }), h("span", { class: "small faint" }, "Last 14 days · ", h("span", { style: "color:var(--bad)", text: "●" }), " day with an escalation")),
          h("div", { class: "panel" }, barChart(L))),
        h("section", {}, h("div", { class: "section-head" }, h("h2", { text: "Latest entries" }), h("a", { class: "small", href: "#/activity", text: "All activity" })),
          h("div", { class: "panel list" }, L.length ? L.slice(0, 8).map(l => h("div", { class: "row click", onclick: () => openLog(l) },
            h("span", { class: "avatar", text: initials(nameOf(l.user_id)) }),
            h("div", { class: "grow" }, h("div", { text: (S.P[l.practice_id] || {}).name }), h("div", { class: "faint small", text: `${nameOf(l.user_id)} · ${when(l.performed_at)}` })),
            resultTag(l.result))) : h("div", { class: "empty" }, h("b", { text: "No checks logged yet" }), "Entries appear here as soon as your team logs them.")))),
      h("div", { style: "display:flex;flex-direction:column;gap:24px;min-width:0" },
        h("section", {}, h("div", { class: "section-head" }, h("h2", { text: "Needs your attention" }), h("span", { class: "small faint", text: `${attention.length} item${attention.length === 1 ? "" : "s"}` })),
          h("div", { class: "panel list" }, attention.length ? attention : h("div", { class: "empty" }, h("b", { text: "All caught up" }), "No escalations, approvals or overdue critical checks."))),
        h("section", {}, h("div", { class: "section-head" }, h("h2", { text: "Team, last 30 days" }), h("a", { class: "small", href: "#/people", text: "Manage people" })),
          h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", { text: "Analyst" }), h("th", { text: "7d" }), h("th", { text: "30d" }), h("th", { text: "Esc." }), h("th", { text: "Flags" }), h("th", { text: "Last check" }))),
            h("tbody", {}, team.map(x => h("tr", { class: "click", onclick: () => { S.filters = { ...S.filters, user: x.p.id }; location.hash = "#/activity"; } },
              h("td", {}, x.p.full_name, x.p.role === "supervisor" ? h("span", { class: "faint small", text: " · sup." }) : null), h("td", { class: "num", text: x.w }), h("td", { class: "num", text: x.m }),
              h("td", { class: "num", text: x.esc }), h("td", { class: "num", text: x.fl }), h("td", { class: "nowrap faint", text: x.last ? rel(x.last) : "Never" }))))))))));
};

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
PAGES.activity = async () => {
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
          fl.map(x => h("div", { class: "sub", style: "color:var(--warn)", text: x }))));
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
};

/* =====================================================================
   page: coverage (supervisor)
   ===================================================================== */
PAGES.coverage = async () => {
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
};

/* =====================================================================
   page: people (supervisor)
   ===================================================================== */
PAGES.people = async () => {
  const now = Date.now();
  const groups = { pending: S.people.filter(p => p.status === "pending"), active: S.people.filter(p => p.status === "active"), removed: S.people.filter(p => p.status === "removed") };
  const act = async (p, patch, msg, conf) => {
    if (conf && !(await confirmBox(conf))) return;
    try { await S.api.setAccess(p.id, patch); toast(msg); await loadTeam(true); route(); } catch (x) { toast(x.message); }
  };
  const actions = p => {
    if (p.id === S.me.id) return h("span", { class: "faint small", text: "You" });
    if (p.status === "pending") return [
      h("button", { class: "btn primary sm", type: "button", text: "Approve", onclick: () => act(p, { status: "active" }, `${p.full_name} can now log checks`) }),
      h("button", { class: "btn sm danger", type: "button", text: "Decline", onclick: () => act(p, { status: "removed" }, `Declined ${p.full_name}`, { title: `Decline ${p.full_name}?`, body: `${p.email} won't be able to use the SOC log. You can restore them later from the Removed tab.`, ok: "Decline", danger: true }) })];
    if (p.status === "active") return [
      p.role === "analyst"
        ? h("button", { class: "btn sm", type: "button", text: "Make supervisor", onclick: () => act(p, { role: "supervisor" }, `${p.full_name} is now a supervisor`, { title: `Make ${p.full_name} a supervisor?`, body: "Supervisors can see everyone's logs, approve and remove people, and edit the checklist.", ok: "Make supervisor" }) })
        : h("button", { class: "btn sm", type: "button", text: "Make analyst", onclick: () => act(p, { role: "analyst" }, `${p.full_name} is now an analyst`, { title: `Change ${p.full_name} to analyst?`, body: "They'll only see their own logs.", ok: "Change role" }) }),
      h("button", { class: "btn sm danger", type: "button", text: "Remove", onclick: () => act(p, { status: "removed" }, `Removed ${p.full_name}`, { title: `Remove ${p.full_name}?`, body: "They'll lose access right away and won't be able to log checks. Their past entries stay on record. You can restore them later.", ok: "Remove access", danger: true }) })];
    return h("button", { class: "btn sm", type: "button", text: "Restore", onclick: () => act(p, { status: "active" }, `${p.full_name} has access again`) });
  };
  const tab = S.peopleTab;
  const rows = groups[tab];
  const head = { pending: ["Name", "Signed up", "Actions"], active: ["Name", "Role", "Checks (30d)", "Last check", "Last seen", "Member since", "Actions"], removed: ["Name", "Removed", "By", "Checks on record", "Actions"] }[tab];
  const cells = p => { const ls = S.team.filter(l => l.user_id === p.id);
    const name = h("td", {}, h("div", { style: "display:flex;gap:10px;align-items:center" }, h("span", { class: "avatar", text: initials(p.full_name) }), h("div", {}, h("div", { text: p.full_name }), h("div", { class: "sub", text: p.email }))));
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
      h("span", {}, "To add someone, send them this link. They create an account and show up under Pending for you to approve: ", h("span", { class: "mono", text: siteUrl })),
      h("button", { class: "btn sm", type: "button", text: "Copy link", onclick: async () => { try { await navigator.clipboard.writeText(siteUrl); toast("Link copied"); } catch { toast("Copy didn't work. Select the link and copy it."); } } })),
    h("div", { class: "tabbar", role: "tablist" }, [["pending", "Pending"], ["active", "Active"], ["removed", "Removed"]].map(([k, label]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(k === tab), onclick: () => { S.peopleTab = k; route(); } }, label, h("span", { class: "c", text: groups[k].length })))),
    rows.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, head.map(x => h("th", { text: x })))), h("tbody", {}, rows.map(p => h("tr", {}, cells(p))))))
      : h("div", { class: "panel empty" }, h("b", { text: { pending: "No one is waiting", active: "No active members", removed: "No one has been removed" }[tab] }),
        tab === "pending" ? "New sign-ups appear here for you to approve." : ""));
};

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
PAGES.checklist = async () => {
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
};

/* =====================================================================
   page: audit trail (supervisor)
   ===================================================================== */
PAGES.audit = async () => {
  S.audit = await S.api.audit();
  const who = id => id ? nameOf(id) : "System";
  const say = e => { const tgt = e.target_id ? nameOf(e.target_id) : (e.detail && e.detail.email) || ""; const d = e.detail || {};
    return ({ signed_up: `${tgt} signed up (${d.email || ""})`, bootstrap_supervisor: `${tgt} created the first account and became supervisor`,
      approved: `approved ${tgt}`, declined: `declined ${tgt}`, removed: `removed ${tgt}`, restored: `restored access for ${tgt}`, set_pending: `set ${tgt} back to pending`,
      role_changed: `changed ${tgt}'s role from ${d.from_role} to ${d.to_role}`, log_reviewed: `reviewed log entry #${d.log_id} as "${(OUTCOMES[d.outcome] || {}).label || d.outcome}"`,
      review_updated: `updated the review on log entry #${d.log_id} to "${(OUTCOMES[d.outcome] || {}).label || d.outcome}"`,
      checklist_insert: `added "${d.name || d.practice}" to the checklist`, checklist_update: `edited checklist item "${(S.P[d.practice] || {}).name || d.practice}"` })[e.action] || e.action; };
  return h("div", {},
    pageHead("Audit trail", "Who changed access, roles, reviews and the checklist, and when. This record can't be edited from the app."),
    S.audit.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["When", "Who", "What happened"].map(x => h("th", { text: x })))),
      h("tbody", {}, S.audit.map(e => h("tr", {}, h("td", { class: "nowrap num", title: full(e.at), text: when(e.at) }), h("td", { class: "nowrap", text: e.action === "signed_up" ? "—" : who(e.actor_id) }), h("td", { text: say(e) }))))))
      : h("div", { class: "panel empty" }, h("b", { text: "Nothing yet" }), "Access changes will be recorded here."));
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
  return h("div", {}, pageHead("Settings", "Applies to everyone using this SOC log."),
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
  return h("div", {}, pageHead("Account", `${S.me.email} · ${isSup() ? "Supervisor" : "Analyst"} · member since ${shortDate(S.me.created_at)}`),
    h("div", { style: "display:flex;flex-direction:column;gap:20px;max-width:560px" },
      h("div", { class: "panel pad", style: "display:flex;flex-direction:column;gap:14px" }, h("h2", { text: "Your name" }),
        h("div", { class: "field" }, h("label", { for: "myName", text: "Full name" }), name), h("div", {}, saveName)),
      h("div", { class: "panel pad", style: "display:flex;flex-direction:column;gap:14px" }, h("h2", { text: "Password" }),
        h("div", { class: "grid-2" }, h("div", { class: "field" }, h("label", { for: "np1", text: "New password" }), p1), h("div", { class: "field" }, h("label", { for: "np2", text: "Confirm" }), p2)),
        h("div", {}, savePw))));
};

/* =====================================================================
   boot
   ===================================================================== */
(async () => {
  try {
    S.api = await createApi();
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
