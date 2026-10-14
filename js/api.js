// Data layer. Two backends with the same interface:
//   - Supabase (real accounts, real database) when js/config.js is filled in
//   - Demo (sample data in memory, nothing saved) when it isn't, or with ?demo in the URL
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const wantsDemo = new URLSearchParams(location.search).has("demo");
export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const isDemo = wantsDemo || !configured;

function friendly(error) {
  if (!error) return null;
  const m = String(error.message || error);
  const map = [
    [/invalid login credentials/i, "That email and password don't match an account."],
    [/email not confirmed/i, "Confirm your email first. Open the link we sent to your inbox, then sign in."],
    [/user already registered/i, "An account with this email already exists. Sign in instead, or reset your password."],
    [/database error saving new user/i, "Sign-up was refused. Use your university email address."],
    [/only @.* email/i, m],
    [/password should be at least/i, "Use a password with at least 8 characters."],
    [/rate limit|too many/i, "Too many attempts. Wait a minute and try again."],
    [/row-level security|permission denied/i, "You don't have permission to do that. Your access may have changed. Refresh the page."],
    [/ticket_when_needed/i, "Add a ticket number for anything you handled or escalated."],
    [/blocker_when_incomplete/i, "Say what stopped you from finishing."],
    [/performed_window/i, "The time must be within the last 7 days and not in the future."],
    [/not on the active checklist/i, "That check was turned off by your supervisor. Pick another."],
    [/cannot change your own access/i, "You can't change your own access. Another supervisor has to do it."],
    [/failed to fetch|network/i, "Can't reach the server. Check your connection and try again."],
  ];
  for (const [re, msg] of map) if (re.test(m)) return msg;
  return m;
}
const unwrap = ({ data, error }) => { if (error) throw new Error(friendly(error)); return data; };

/* =====================================================================
   Supabase backend
   ===================================================================== */
async function supabaseApi() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
  const here = location.origin + location.pathname;

  async function pageAll(build) {
    const out = []; const size = 1000;
    for (let from = 0; ; from += size) {
      const rows = unwrap(await build().range(from, from + size - 1));
      out.push(...rows); if (rows.length < size || out.length >= 20000) break;
    }
    return out;
  }

  return {
    demo: false,
    async session() { return unwrap(await sb.auth.getSession()).session; },
    onAuth(cb) { sb.auth.onAuthStateChange((event, session) => cb(event, session)); },
    async signIn(email, password) { unwrap(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(fullName, email, password) {
      const d = unwrap(await sb.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: here } }));
      return { needsConfirm: !d.session };
    },
    async signOut() { await sb.auth.signOut(); },
    async sendReset(email) { unwrap(await sb.auth.resetPasswordForEmail(email, { redirectTo: here })); },
    async setPassword(password) { unwrap(await sb.auth.updateUser({ password })); },

    async settings() { return unwrap(await sb.from("app_settings").select("*").maybeSingle()) || {}; },
    async saveSettings(patch) { unwrap(await sb.from("app_settings").update(patch).eq("id", true)); },
    async me() {
      const s = await this.session(); if (!s) return null;
      return unwrap(await sb.from("profiles").select("*").eq("id", s.user.id).maybeSingle());
    },
    async touch() { await sb.rpc("touch_last_seen"); },
    async renameMe(id, full_name) { unwrap(await sb.from("profiles").update({ full_name }).eq("id", id)); },

    async practices() { return unwrap(await sb.from("practices").select("*").order("sort_order")); },
    async savePractice(id, patch) { unwrap(await sb.from("practices").update(patch).eq("id", id)); },
    async addPractice(row) { unwrap(await sb.from("practices").insert(row)); },

    async addLog(row) { return unwrap(await sb.from("check_logs").insert(row).select().single()); },
    async myLogs(userId, limit = 200) {
      return unwrap(await sb.from("check_logs").select("*").eq("user_id", userId).order("performed_at", { ascending: false }).limit(limit));
    },
    async logs(sinceIso) {
      return pageAll(() => sb.from("check_logs").select("*").gte("performed_at", sinceIso).order("performed_at", { ascending: false }));
    },
    async reviews() { return pageAll(() => sb.from("log_reviews").select("*")); },
    async saveReview(log_id, outcome, note) {
      unwrap(await sb.from("log_reviews").upsert({ log_id, outcome, note }, { onConflict: "log_id" }));
    },
    async people() { return unwrap(await sb.from("profiles").select("*").order("created_at")); },
    async setAccess(id, patch) { unwrap(await sb.from("profiles").update(patch).eq("id", id)); },
    async audit() { return unwrap(await sb.from("audit_events").select("*").order("at", { ascending: false }).limit(500)); },
  };
}

/* =====================================================================
   Demo backend: realistic sample data, nothing leaves the browser
   ===================================================================== */
function demoApi() {
  const DAY = 864e5, now = Date.now();
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const uid = n => `demo-${n}`;
  const people = [
    { id: uid(1), email: "seif.abdelhamid@shu.edu", full_name: "Seif Abdelhamid", role: "supervisor", status: "active", created_at: new Date(now - 60 * DAY).toISOString() },
    { id: uid(2), email: "maya.patel@shu.edu", full_name: "Maya Patel", role: "analyst", status: "active", created_at: new Date(now - 55 * DAY).toISOString() },
    { id: uid(3), email: "omar.haddad@shu.edu", full_name: "Omar Haddad", role: "analyst", status: "active", created_at: new Date(now - 50 * DAY).toISOString() },
    { id: uid(4), email: "jenna.ruiz@shu.edu", full_name: "Jenna Ruiz", role: "analyst", status: "active", created_at: new Date(now - 41 * DAY).toISOString() },
    { id: uid(5), email: "daniel.okafor@shu.edu", full_name: "Daniel Okafor", role: "analyst", status: "active", created_at: new Date(now - 33 * DAY).toISOString() },
    { id: uid(6), email: "priya.nair@shu.edu", full_name: "Priya Nair", role: "analyst", status: "pending", created_at: new Date(now - 0.2 * DAY).toISOString() },
    { id: uid(7), email: "tom.becker@shu.edu", full_name: "Tom Becker", role: "analyst", status: "removed", created_at: new Date(now - 58 * DAY).toISOString(), status_changed_at: new Date(now - 12 * DAY).toISOString(), status_changed_by: uid(1) },
  ];
  people.forEach((p, i) => p.last_seen_at = p.status === "active" ? new Date(now - (i * 3.3 + 0.05) * 36e5).toISOString() : null);
  let practices = [];
  const logs = [], reviews = [], audit = [];
  let me = null, nextId = 1, listeners = [];
  const settings = { org_name: "Seton Hall University SOC", allowed_email_domain: "shu.edu" };

  const notes = {
    clear: [
      ["Went through the whole queue, nothing new since the morning shift. All existing items already assigned.", "", ""],
      ["Reviewed every item in the view. All matched known-good activity (patching, IT admin scripts).", "", ""],
      ["No high or critical items. Two lows were duplicates of yesterday's, already closed.", "", ""],
    ],
    handled: [
      ["Found 3 false positives from the Chrome updater and closed them with a note. One real hit on a lab machine: quarantined the file and confirmed clean scan.", "LAB-WS114", "Quarantined file, closed 3 FPs"],
      ["User reported a DocuSign lure. Found 14 copies in other mailboxes and purged all of them.", "14 mailboxes, sender no-reply@docu-sign-secure.co", "Purged 14 messages, blocked sender domain"],
      ["Stale bypass code for a former TA account. Removed the code and disabled the account in Duo.", "jdoe (former TA)", "Deleted bypass code"],
    ],
    escalated: [
      ["Encoded PowerShell launched from Outlook on a Finance laptop. Parent chain looks like a macro. Did not contain myself, escalated right away.", "FIN-LT022, user: kmorris", "Escalated to supervisor by phone"],
      ["Impossible travel: sign-in from Lagos 40 minutes after a Newark sign-in, then a new inbox forwarding rule. Looks like a real account takeover.", "student account a.reyes", "Escalated, asked for password reset + session revoke"],
    ],
    incomplete: [["Started the review but the console timed out twice and I lost access mid-way.", "", ""]],
  };

  function seedData() {
    const active = people.filter(p => p.status === "active" || p.status === "removed");
    const doable = practices.filter(p => p.active);
    const weighted = doable.flatMap(p => Array(({ Continuous: 6, Daily: 5, Weekly: 2, Monthly: 1, Quarterly: 1, Annually: 1, "As Needed": 1 })[p.frequency] || 1).fill(p));
    for (let d = 34; d >= 0; d--) {
      const date = new Date(now - d * DAY); const wd = date.getDay(); if (wd === 0 || wd === 6) continue;
      const count = 3 + Math.floor(rnd() * 6);
      for (let k = 0; k < count; k++) {
        const who = pick(active.filter(p => p.status === "active" || d > 12));
        if (who.id === uid(1) && rnd() < .7) continue;
        const p = pick(weighted);
        const r = rnd(); const result = r < .68 ? "clear" : r < .87 ? "handled" : r < .95 ? "escalated" : "incomplete";
        const [details, affected, action] = pick(notes[result]);
        const t = new Date(date); t.setHours(8 + Math.floor(rnd() * 9), Math.floor(rnd() * 60), 0, 0);
        if (t.getTime() > now) continue;
        const lateBy = rnd() < .06 ? 30 * 36e5 : (2 + rnd() * 20) * 6e4;
        logs.push({ id: nextId++, ref: "CHK-" + Math.floor(rnd() * 0xffffffff).toString(16).toUpperCase().padStart(8, "0"),
          user_id: who.id, practice_id: p.id, result, performed_at: t.toISOString(),
          created_at: new Date(Math.min(now, t.getTime() + lateBy)).toISOString(),
          duration_min: 5 + Math.floor(rnd() * 40), items_reviewed: result === "incomplete" ? null : Math.floor(rnd() * 30),
          details: rnd() < .04 ? "Checked it, all fine." + " ".repeat(5) : details, affected: affected || null, action_taken: action || null,
          ticket: (result === "handled" || result === "escalated") ? "INC00" + (41000 + nextId) : (rnd() < .1 ? "INC00" + (41000 + nextId) : null),
          blocker: result === "incomplete" ? "Falcon console session expired; need my role re-added." : null, user_agent: "Demo" });
      }
    }
    logs.sort((a, b) => b.performed_at.localeCompare(a.performed_at));
    logs.filter(l => l.result === "escalated").slice(2).forEach(l => reviews.push({ log_id: l.id, reviewer_id: uid(1), outcome: "closed", note: "Confirmed and remediated. Ticket closed.", reviewed_at: new Date(new Date(l.performed_at).getTime() + 2 * 36e5).toISOString() }));
    const ev = (actor, action, target, detail, daysAgo) => audit.push({ id: audit.length + 1, actor_id: actor, action, target_id: target, detail, at: new Date(now - daysAgo * DAY).toISOString() });
    ev(uid(1), "bootstrap_supervisor", uid(1), { email: people[0].email }, 60);
    for (const p of people.slice(1)) ev(p.id, "signed_up", p.id, { email: p.email }, (now - new Date(p.created_at)) / DAY);
    for (const p of people.slice(1, 5)) ev(uid(1), "approved", p.id, { email: p.email }, (now - new Date(p.created_at)) / DAY - .1);
    ev(uid(1), "approved", uid(7), { email: people[6].email }, 57.9);
    ev(uid(1), "removed", uid(7), { email: people[6].email }, 12);
    audit.sort((a, b) => b.at.localeCompare(a.at));
  }

  const clone = x => JSON.parse(JSON.stringify(x));
  const isSup = () => me && me.role === "supervisor" && me.status === "active";
  const need = ok => { if (!ok) throw new Error("You don't have permission to do that."); };
  const wait = (v) => new Promise(r => setTimeout(() => r(v), 120));
  const log = (action, target, detail) => audit.unshift({ id: audit.length + 1, actor_id: me && me.id, action, target_id: target, detail, at: new Date().toISOString() });

  return {
    demo: true,
    async init(practiceRows) { practices = practiceRows.map(p => ({ ...p })); seedData(); },
    async session() { return me ? { user: { id: me.id, email: me.email } } : null; },
    onAuth(cb) { listeners.push(cb); },
    async signIn(email) {
      const p = people.find(x => x.email === String(email).trim().toLowerCase());
      if (!p) throw new Error("In the demo, sign in as seif.abdelhamid@shu.edu (supervisor) or maya.patel@shu.edu (student). Any password works.");
      me = p; listeners.forEach(f => f("SIGNED_IN")); return wait();
    },
    async signUp(fullName, email) {
      email = String(email).trim().toLowerCase();
      if (!email.endsWith("@" + settings.allowed_email_domain)) throw new Error(`Only @${settings.allowed_email_domain} email addresses can sign up.`);
      if (people.some(p => p.email === email)) throw new Error("An account with this email already exists. Sign in instead, or reset your password.");
      const p = { id: uid(people.length + 1), email, full_name: fullName, role: "analyst", status: "pending", created_at: new Date().toISOString() };
      people.push(p); me = p; log("signed_up", p.id, { email }); listeners.forEach(f => f("SIGNED_IN")); return { needsConfirm: false };
    },
    async signOut() { me = null; listeners.forEach(f => f("SIGNED_OUT")); },
    async sendReset() { return wait(); },
    async setPassword() { return wait(); },
    async settings() { return clone(settings); },
    async saveSettings(patch) { need(isSup()); Object.assign(settings, patch); },
    async me() { return me ? clone(me) : null; },
    async touch() { if (me) me.last_seen_at = new Date().toISOString(); },
    async renameMe(id, name) { me.full_name = name; },
    async practices() { return clone(practices); },
    async savePractice(id, patch) { need(isSup()); Object.assign(practices.find(p => p.id === id), patch); log("checklist_update", null, { practice: id }); },
    async addPractice(row) { need(isSup()); practices.push({ ...row }); log("checklist_insert", null, { practice: row.id, name: row.name }); },
    async addLog(row) {
      need(me && me.status === "active");
      const r = { ...row, id: nextId++, ref: "CHK-" + Math.random().toString(16).slice(2, 10).toUpperCase(), user_id: me.id, created_at: new Date().toISOString() };
      logs.unshift(r); logs.sort((a, b) => b.performed_at.localeCompare(a.performed_at)); return wait(clone(r));
    },
    async myLogs(id) { return wait(clone(logs.filter(l => l.user_id === id))); },
    async logs(since) { need(isSup()); return wait(clone(logs.filter(l => l.performed_at >= since))); },
    async reviews() { return clone(isSup() ? reviews : reviews.filter(r => logs.find(l => l.id === r.log_id && l.user_id === me.id))); },
    async saveReview(log_id, outcome, note) {
      need(isSup()); const ex = reviews.find(r => r.log_id === log_id);
      const r = { log_id, outcome, note, reviewer_id: me.id, reviewed_at: new Date().toISOString() };
      if (ex) Object.assign(ex, r); else reviews.push(r); log(ex ? "review_updated" : "log_reviewed", null, { log_id, outcome });
    },
    async people() { return clone(isSup() ? people : people.filter(p => p.id === me.id)); },
    async setAccess(id, patch) {
      need(isSup()); if (id === me.id) throw new Error("You can't change your own access. Another supervisor has to do it.");
      const p = people.find(x => x.id === id); const old = { ...p };
      Object.assign(p, patch, { status_changed_at: new Date().toISOString(), status_changed_by: me.id });
      const action = patch.status && patch.status !== old.status
        ? (patch.status === "active" ? (old.status === "removed" ? "restored" : "approved") : patch.status === "removed" ? (old.status === "pending" ? "declined" : "removed") : "set_pending")
        : "role_changed";
      log(action, id, { email: p.email, from_role: old.role, to_role: p.role });
    },
    async audit() { need(isSup()); return clone(audit); },
  };
}

export async function createApi() {
  if (!isDemo) return supabaseApi();
  const api = demoApi();
  const rows = await fetch("./data/practices.json").then(r => r.json());
  await api.init(rows);
  return api;
}
