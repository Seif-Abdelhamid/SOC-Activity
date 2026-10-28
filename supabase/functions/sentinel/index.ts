// POST /functions/v1/sentinel   header  x-sentinel-key: <SENTINEL_KEY>
// Runs every minute from pg_cron (see supabase/schedule.sql). Each run:
//   1. posts new escalations to Microsoft Teams (once each)
//   2. posts new sign-ups waiting for approval
//   3. once a weekday morning, posts critical/high checks that are overdue
//   4. forwards new log entries, reviews, handoffs and audit events to Splunk (HEC)
//   5. once a day, applies the data-retention setting
// Every step is optional: it only runs when its secrets are set, and it keeps
// a cursor in integration_state so nothing is sent twice.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { cors, reply } from "../_shared/http.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const SITE = env("SITE_URL") || "https://seif-abdelhamid.github.io/SOC-Activity/";
const TZ = env("SOC_TIMEZONE") || "America/New_York";

async function getState(key: string) { const { data } = await db.from("integration_state").select("value").eq("key", key).maybeSingle(); return data?.value ?? {}; }
async function setState(key: string, value: unknown) { const { error } = await db.from("integration_state").upsert({ key, value, updated_at: new Date().toISOString() }); if (error) throw error; }
const local = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: p.weekday };
};
const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/* ---------- Teams (Workflows webhook or classic incoming webhook) ---------- */
async function teams(title: string, lines: string[], facts: [string, string][] = [], link = SITE, accent: "attention" | "warning" | "accent" = "accent") {
  const url = env("TEAMS_WEBHOOK_URL"); if (!url) return false;
  const card = {
    type: "AdaptiveCard", $schema: "http://adaptivecards.io/schemas/adaptive-card.json", version: "1.4",
    body: [
      { type: "TextBlock", text: title, weight: "Bolder", size: "Medium", color: accent, wrap: true },
      ...lines.map((t) => ({ type: "TextBlock", text: t, wrap: true, spacing: "Small" })),
      ...(facts.length ? [{ type: "FactSet", facts: facts.map(([title, value]) => ({ title, value })) }] : []),
    ],
    actions: [{ type: "Action.OpenUrl", title: "Open SOC Log", url: link }],
  };
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: card }] }) });
  if (!res.ok) throw new Error(`Teams webhook returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

/* ---------- 1. escalations ---------- */
async function escalations() {
  if (!env("TEAMS_WEBHOOK_URL")) return "skipped (no TEAMS_WEBHOOK_URL)";
  const { data, error } = await db.from("check_logs")
    .select("id, ref, details, affected, action_taken, ticket, performed_at, created_at, profiles(full_name), practices(name, tool, priority)")
    .eq("result", "escalated").is("notified_at", null).gte("created_at", new Date(Date.now() - 86400_000).toISOString())
    .order("created_at").limit(20);
  if (error) throw error;
  for (const l of data ?? []) {
    // deno-lint-ignore no-explicit-any
    const r = l as any;
    await teams(`Escalation: ${r.practices?.name ?? "check"}`, [r.details],
      [["Analyst", r.profiles?.full_name ?? "Unknown"], ["Tool", `${r.practices?.tool ?? ""} · ${r.practices?.priority ?? ""} priority`],
       ["Involved", r.affected ?? "—"], ["Action taken", r.action_taken ?? "—"], ["Ticket", r.ticket ?? "—"], ["When", fmt(r.performed_at)], ["Entry", r.ref]],
      `${SITE}#/activity`, "attention");
    const { error: e2 } = await db.from("check_logs").update({ notified_at: new Date().toISOString() }).eq("id", r.id);
    if (e2) throw e2;
  }
  return `${data?.length ?? 0} sent`;
}

/* ---------- 2. sign-ups waiting for approval ---------- */
async function signups() {
  if (!env("TEAMS_WEBHOOK_URL")) return "skipped";
  const st = await getState("signup_alerts");
  let q = db.from("audit_events").select("id, detail, at").eq("action", "signed_up").order("id").limit(20);
  if (st.last_id) q = q.gt("id", st.last_id); else q = q.gte("at", new Date(Date.now() - 3600_000).toISOString());
  const { data, error } = await q; if (error) throw error;
  for (const e of data ?? []) await teams("New account waiting for approval", [`${e.detail?.email ?? "Someone"} signed up for SOC Log.`], [], `${SITE}#/team`);
  if (data?.length) await setState("signup_alerts", { last_id: data[data.length - 1].id });
  return `${data?.length ?? 0} sent`;
}

/* ---------- 3. morning overdue digest ---------- */
const LIMIT: Record<string, number> = { Weekly: 7, Monthly: 31, Quarterly: 92, Annually: 366 };
function weekdaysSince(iso: string) {
  let n = 0; const d = new Date(local(new Date(iso)).date + "T12:00:00Z"); const end = new Date(local().date + "T12:00:00Z");
  while (d < end) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}
async function digest() {
  if (!env("TEAMS_WEBHOOK_URL")) return "skipped";
  const now = local(); const hour = Number(env("DIGEST_HOUR") || 9);
  if (["Sat", "Sun"].includes(now.weekday) || now.hour < hour) return "not time yet";
  const st = await getState("overdue_digest"); if (st.date === now.date) return "already sent today";
  const { data, error } = await db.rpc("coverage_snapshot"); if (error) throw error;
  // deno-lint-ignore no-explicit-any
  const overdue = (data ?? []).filter((p: any) => {
    if (!["Critical", "High"].includes(p.priority) || p.frequency === "As Needed") return false;
    if (!p.last_done) return true;
    if (p.frequency === "Daily" || p.frequency === "Continuous") return weekdaysSince(p.last_done) > 1;
    return (Date.now() - new Date(p.last_done).getTime()) / 86400_000 > LIMIT[p.frequency];
  });
  if (overdue.length) {
    // deno-lint-ignore no-explicit-any
    await teams(`${overdue.length} critical or high check${overdue.length === 1 ? " is" : "s are"} overdue`, overdue.slice(0, 15).map((p: any) =>
      `**${p.name}** (${p.tool}, ${p.frequency.toLowerCase()}) · ${p.last_done ? `last done ${fmt(p.last_done)}${p.last_by ? ` by ${p.last_by}` : ""}` : "never done"}${p.owner ? ` · owner: ${p.owner}` : " · no owner"}`),
      [], `${SITE}#/checks`, "warning");
  }
  await setState("overdue_digest", { date: now.date, count: overdue.length });
  return `${overdue.length} overdue`;
}

/* ---------- 4. Splunk HEC forwarding ---------- */
async function splunk() {
  const url = env("SPLUNK_HEC_URL"), token = env("SPLUNK_HEC_TOKEN");
  if (!url || !token) return "skipped (no SPLUNK_HEC_URL / SPLUNK_HEC_TOKEN)";
  const streams: [string, string, string, string][] = [   // table, cursor column, sourcetype, time column
    ["check_logs", "id", "shu:soclog:entry", "created_at"], ["log_reviews", "reviewed_at", "shu:soclog:review", "reviewed_at"],
    ["handoffs", "id", "shu:soclog:handoff", "created_at"], ["audit_events", "id", "shu:soclog:audit", "at"],
  ];
  const st = await getState("splunk_cursor"); const out: string[] = [];
  for (const [table, col, sourcetype, tcol] of streams) {
    let q = db.from(table).select("*").order(col).limit(500);
    if (st[table] != null) q = q.gt(col, st[table]);
    const { data, error } = await q; if (error) throw error;
    if (!data?.length) continue;
    const body = data.map((row) => JSON.stringify({ time: new Date(row[tcol]).getTime() / 1000, host: "soc-log", source: "soc-log", sourcetype,
      ...(env("SPLUNK_INDEX") ? { index: env("SPLUNK_INDEX") } : {}), event: { table, ...row } })).join("\n");
    const res = await fetch(url, { method: "POST", headers: { authorization: `Splunk ${token}`, "content-type": "application/json" }, body });
    if (!res.ok) throw new Error(`Splunk HEC returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    st[table] = data[data.length - 1][col]; out.push(`${table}:${data.length}`);
  }
  await setState("splunk_cursor", st);
  return out.join(", ") || "nothing new";
}

/* ---------- 5. retention ---------- */
async function retention() {
  const today = local().date, st = await getState("retention");
  if (st.date === today) return "already ran today";
  const { data, error } = await db.rpc("apply_retention"); if (error) throw error;
  await setState("retention", { date: today, deleted: data });
  return `${data} old entries removed`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const key = env("SENTINEL_KEY");
  if (!key || req.headers.get("x-sentinel-key") !== key) return reply({ error: "Not allowed." }, 401);
  const result: Record<string, string> = {};
  for (const [name, fn] of Object.entries({ escalations, signups, digest, splunk, retention })) {
    try { result[name] = await fn(); } catch (e) { console.error(name, e); result[name] = `error: ${String((e as Error)?.message ?? e).slice(0, 200)}`; }
  }
  await setState("sentinel_heartbeat", { at: new Date().toISOString(), result }).catch(() => {});
  return reply({ ok: true, result });
});
