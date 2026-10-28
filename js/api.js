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
    [/signups not allowed for otp|otp_disabled/i, "No account uses that email yet. Create an account first."],
    [/token has expired or is invalid|otp_expired/i, "That code is wrong or expired. Request a new one."],
    [/invalid totp code|mfa_verification_failed|invalid.*code/i, "That code didn't match. Use the current 6-digit code from Duo Mobile."],
    [/insufficient_aal|aal2 required/i, "Finish 2-step verification first, then try again."],
    [/provider is not enabled|unsupported provider/i, "That sign-in option isn't turned on yet. Use email instead."],
    [/notallowederror|operation either timed out or was not allowed|ceremony was cancelled|aborted/i, "Passkey sign-in was cancelled or timed out."],
    [/passkey.*not found|no passkey|credential not found/i, "That passkey isn't registered here. Sign in another way, then add it under Account."],
  ];
  for (const [re, msg] of map) if (re.test(m)) return msg;
  return m;
}
const unwrap = ({ data, error }) => { if (error) throw new Error(friendly(error)); return data; };

/* =====================================================================
   Supabase backend
   ===================================================================== */
async function supabaseApi() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm");
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
  const here = location.origin + location.pathname;
  // Which sign-in providers are switched on in the Supabase dashboard (public endpoint).
  const providers = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } })
    .then(r => r.ok ? r.json() : {}).then(j => j.external || {}).catch(() => ({}));

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

    // ---- other ways to sign in ----
    providers: { google: Boolean(providers.google), azure: Boolean(providers.azure), passkey: "PublicKeyCredential" in window },
    async sendEmailCode(email) {
      unwrap(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: here } }));
    },
    async verifyEmailCode(email, token) { unwrap(await sb.auth.verifyOtp({ email, token, type: "email" })); },
    async oauth(provider) {
      const scopes = provider === "azure" ? "openid email profile" : undefined;
      unwrap(await sb.auth.signInWithOAuth({ provider, options: { redirectTo: here, scopes } }));
    },
    async passkeySignIn() { unwrap(await sb.auth.signInWithPasskey()); },
    async passkeys() { return unwrap(await sb.auth.passkey.list()) || []; },
    async addPasskey() { return unwrap(await sb.auth.registerPasskey()); },
    async removePasskey(passkeyId) { unwrap(await sb.auth.passkey.delete({ passkeyId })); },

    // ---- 2-step verification (TOTP codes from Duo Mobile) ----
    async aal() { return unwrap(await sb.auth.mfa.getAuthenticatorAssuranceLevel()); },
    async factors() {
      const d = unwrap(await sb.auth.mfa.listFactors());
      return (d.all || d.totp || []).filter(f => f.factor_type === "totp");
    },
    async startTotp() {
      // Clear half-finished setups first so a retry doesn't collide.
      for (const f of await this.factors()) if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
      const d = unwrap(await sb.auth.mfa.enroll({ factorType: "totp", issuer: "SHU SOC Log", friendlyName: `Duo Mobile ${new Date().toISOString().slice(0, 16)}` }));
      return { factorId: d.id, qr: d.totp.qr_code, secret: d.totp.secret };
    },
    async verifyTotp(factorId, code) {
      unwrap(await sb.auth.mfa.challengeAndVerify({ factorId, code }));
      await sb.auth.refreshSession();
    },
    async removeTotp(factorId) { unwrap(await sb.auth.mfa.unenroll({ factorId })); },
    async resetMemberMfa(id) { unwrap(await sb.rpc("reset_member_mfa", { target: id })); },

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

    // ---- v2: shifts, ownership, handoffs, evidence, tool snapshots, reports ----
    async directory() { return unwrap(await sb.rpc("directory")) || []; },
    async shifts() { return unwrap(await sb.from("shifts").select("*, shift_members(user_id)").order("starts")) .map(s => ({ ...s, members: (s.shift_members || []).map(m => m.user_id) })); },
    async saveShift(row, members) {
      const { id, ...fields } = row;
      const saved = id ? unwrap(await sb.from("shifts").update(fields).eq("id", id).select().single()) : unwrap(await sb.from("shifts").insert(fields).select().single());
      const current = unwrap(await sb.from("shift_members").select("user_id").eq("shift_id", saved.id)).map(m => m.user_id);
      const add = members.filter(m => !current.includes(m)), drop = current.filter(m => !members.includes(m));
      if (add.length) unwrap(await sb.from("shift_members").insert(add.map(user_id => ({ shift_id: saved.id, user_id }))));
      if (drop.length) unwrap(await sb.from("shift_members").delete().eq("shift_id", saved.id).in("user_id", drop));
      return saved;
    },
    async deleteShift(id) { unwrap(await sb.from("shifts").delete().eq("id", id)); },
    async handoffs() { return unwrap(await sb.from("handoffs").select("*").order("created_at", { ascending: false }).limit(500)); },
    async addHandoff(row) { return unwrap(await sb.from("handoffs").insert(row).select().single()); },
    async uploadEvidence(file) {
      const s = (await sb.auth.getSession()).data.session; if (!s) throw new Error("Sign in again to attach files.");
      const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
      const path = `${s.user.id}/${crypto.randomUUID()}.${ext}`;
      unwrap(await sb.storage.from("evidence").upload(path, file, { contentType: file.type || undefined, upsert: false }));
      return path;
    },
    async evidenceUrl(path) { return unwrap(await sb.storage.from("evidence").createSignedUrl(path, 600)).signedUrl; },
    async takeSnapshot(source) {
      const { data, error } = await sb.functions.invoke("snapshot", { body: { source } });
      if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch { /* keep */ } throw new Error(msg); }
      return data;
    },
    async snapshots(ids) { return ids.length ? unwrap(await sb.from("tool_snapshots").select("*").in("id", ids)) : []; },
    async escalationResponse(since, until) { return unwrap(await sb.rpc("escalation_response", { since, until })) || []; },
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
  const settings = { org_name: "Seton Hall University SOC", allowed_email_domain: "shu.edu", retention_days: 1095,
    notes_guidance: "Don't paste passwords, MFA codes, student records (FERPA), HR or medical details. Name the account or host instead." };
  let shifts = [
    { id: 1, name: "Weekday morning", days: [1, 2, 3, 4, 5], starts: "08:00:00", ends: "12:00:00", active: true, members: [uid(2), uid(3)] },
    { id: 2, name: "Weekday afternoon", days: [1, 2, 3, 4, 5], starts: "12:00:00", ends: "17:00:00", active: true, members: [uid(4), uid(5)] },
  ];
  const handoffs = [], snaps = {}, files = {};

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
    async init(practiceRows) {
      practices = practiceRows.map(p => ({ ...p, owner_id: null, owner_shift_id: null, snapshot_source: null }));
      const set = (id, k, v) => { const p = practices.find(x => x.id === id); if (p) p[k] = v; };
      ["cs1", "md1", "md2", "duo1", "ab3"].forEach(id => set(id, "owner_shift_id", 1));
      ["md4", "md5", "ab1", "ab2", "duo2", "duo3", "sp2"].forEach(id => set(id, "owner_shift_id", 2));
      set("cs3", "owner_id", uid(3)); set("duo4", "owner_id", uid(5)); set("x2", "owner_id", uid(2));
      set("cs1", "snapshot_source", "crowdstrike_alerts"); set("md1", "snapshot_source", "defender_incidents");
      set("duo2", "snapshot_source", "duo_auth_denied"); set("ab1", "snapshot_source", "abnormal_threats");
      seedData();
      const hAgo = h => new Date(now - h * 36e5).toISOString();
      handoffs.push(
        { id: 3, user_id: uid(3), shift_id: 1, created_at: hAgo(3.2), summary: "Falcon queue clean as of 11:55. Defender had 2 user-reported phish, both purged (INC0041092).", open_items: "FIN-LT022 still isolated, waiting on desktop support to re-image.", watch_for: "More DocuSign lures from docu-sign-secure.co, sender is blocked but variants keep coming." },
        { id: 2, user_id: uid(5), shift_id: 2, created_at: hAgo(21), summary: "Quiet afternoon. Reviewed Duo denials, nothing beyond normal lockouts.", open_items: "", watch_for: "Payroll deadline Friday, expect W-2 themed phishing." },
        { id: 1, user_id: uid(2), shift_id: 1, created_at: hAgo(27), summary: "Worked ATO case for a.reyes. Password reset and sessions revoked, new Duo device removed.", open_items: "Confirm with a.reyes they didn't approve the enrollment.", watch_for: "" });
    },
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
    providers: { google: true, azure: true, passkey: true },
    async sendEmailCode() { return wait(); },
    async verifyEmailCode(email) { return this.signIn(email); },
    async oauth() { throw new Error("Microsoft and Google sign-in only work on the live site, not in the demo."); },
    async passkeySignIn() { throw new Error("Passkeys only work on the live site, not in the demo."); },
    async passkeys() { return []; },
    async addPasskey() { throw new Error("Passkeys only work on the live site, not in the demo."); },
    async removePasskey() { return wait(); },
    async aal() { return { currentLevel: "aal2", nextLevel: "aal2" }; },
    async factors() { return [{ id: "demo", status: "verified", friendly_name: "Duo Mobile", created_at: new Date().toISOString() }]; },
    async startTotp() { throw new Error("2-step setup only works on the live site, not in the demo."); },
    async verifyTotp() { return wait(); },
    async removeTotp() { return wait(); },
    async resetMemberMfa() { need(isSup()); return wait(); },
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
    async directory() { need(me && me.status === "active"); return clone(people.filter(p => p.status === "active").map(({ id, full_name, role }) => ({ id, full_name, role }))); },
    async shifts() { return clone(shifts); },
    async saveShift(row, members) {
      need(isSup());
      let sh = row.id && shifts.find(x => x.id === row.id);
      if (sh) Object.assign(sh, row, { members }); else { sh = { ...row, id: Math.max(0, ...shifts.map(x => x.id)) + 1, active: true, members }; shifts.push(sh); }
      log("shift_" + (row.id ? "update" : "insert"), null, { table: "shifts", row: { name: sh.name } }); return clone(sh);
    },
    async deleteShift(id) { need(isSup()); shifts = shifts.filter(x => x.id !== id); practices.forEach(p => { if (p.owner_shift_id === id) p.owner_shift_id = null; }); log("shift_delete", null, { table: "shifts", row: { id } }); },
    async handoffs() { return clone(handoffs.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))); },
    async addHandoff(row) { need(me && me.status === "active"); const r = { ...row, id: handoffs.length + 10, user_id: me.id, created_at: new Date().toISOString() }; handoffs.push(r); return wait(clone(r)); },
    async uploadEvidence(file) { const path = `${me.id}/${Math.random().toString(16).slice(2)}-${file.name.replace(/[^\w.-]/g, "")}`; files[path] = URL.createObjectURL(file); return wait(path); },
    async evidenceUrl(path) { return files[path] || "img/logo-256.webp"; },
    async takeSnapshot(source) {
      const demo = { crowdstrike_alerts: ["CrowdStrike Falcon", "6 new alerts in Falcon, 1 high or critical, oldest waiting 47 min", { new_alerts: 6, new_high_or_critical: 1 }],
        defender_incidents: ["Microsoft Defender", "4 active incidents in Defender, 1 high severity, 2 unassigned, oldest 5 h", { active_incidents: 4, high_severity: 1, unassigned: 2 }],
        duo_auth_denied: ["Duo", "38 denied authentications in Duo in the last 24 h, 1 marked as fraud by the user", { denied_24h: 38, fraud_24h: 1 }],
        abnormal_threats: ["Abnormal", "11 threats detected by Abnormal in the last 24 h", { threats_24h: 11 }] }[source];
      const id = "snap-" + Math.random().toString(16).slice(2); const taken_at = new Date().toISOString();
      snaps[id] = { id, user_id: me.id, source, taken_at, metrics: { ...demo[2], summary: demo[1] + " (demo numbers)" } };
      return wait({ id, taken_at, source, label: demo[0], summary: demo[1] + " (demo numbers)", metrics: demo[2] });
    },
    async snapshots(ids) { return clone(ids.map(i => snaps[i]).filter(Boolean)); },
    async escalationResponse(since, until) {
      need(isSup());
      return clone(logs.filter(l => l.result === "escalated" && l.created_at >= since && l.created_at < until).map(l => { const r = reviews.find(x => x.log_id === l.id);
        return { log_id: l.id, logged_at: l.created_at, reviewed_at: r ? r.reviewed_at : null, minutes: r ? Math.round((new Date(r.reviewed_at) - new Date(l.created_at)) / 6000) / 10 : null }; }));
    },
  };
}

export async function createApi() {
  if (!isDemo) return supabaseApi();
  const api = demoApi();
  const rows = await fetch("./data/practices.json").then(r => r.json());
  await api.init(rows);
  return api;
}
