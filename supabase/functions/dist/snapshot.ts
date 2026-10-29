// GENERATED single-file build of supabase/functions/snapshot. Rebuild: python3 tools/bundle_functions.py
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
// Read-only connectors to the SOC's tools. Each returns a short human summary
// plus the raw numbers, which get pinned to a log entry as evidence.
// Credentials come from Supabase secrets (Dashboard > Edge Functions > Secrets);
// a connector without its secrets reports "not configured" instead of failing.

type Snapshot = { summary: string; metrics: Record<string, unknown> };
type Source = "crowdstrike_alerts" | "defender_incidents" | "duo_auth_denied" | "abnormal_threats";

const env = (k: string) => Deno.env.get(k) ?? "";
const need = (...keys: string[]) => {
  const missing = keys.filter((k) => !env(k));
  if (missing.length) throw new NotConfigured(`Missing secrets: ${missing.join(", ")}`);
};
class NotConfigured extends Error {}

const ago = (iso?: string | null) => {
  if (!iso) return null;
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
};
async function json(res: Response, what: string) {
  if (!res.ok) throw new Error(`${what} returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}

/* ---------- CrowdStrike Falcon: new alerts (scope: Alerts read) ---------- */
async function crowdstrike(): Promise<Snapshot> {
  need("CROWDSTRIKE_CLIENT_ID", "CROWDSTRIKE_CLIENT_SECRET");
  const base = env("CROWDSTRIKE_BASE_URL") || "https://api.crowdstrike.com";
  const tok = await json(await fetch(`${base}/oauth2/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("CROWDSTRIKE_CLIENT_ID"), client_secret: env("CROWDSTRIKE_CLIENT_SECRET") }),
  }), "CrowdStrike token");
  const h = { authorization: `Bearer ${tok.access_token}`, accept: "application/json" };
  const count = async (filter: string) => {
    const r = await json(await fetch(`${base}/alerts/queries/alerts/v2?limit=1&sort=created_timestamp.asc&filter=${encodeURIComponent(filter)}`, { headers: h }), "CrowdStrike alerts query");
    return { total: r.meta?.pagination?.total ?? (r.resources?.length ?? 0), first: r.resources?.[0] as string | undefined };
  };
  const all = await count("status:'new'");
  const high = await count("status:'new'+severity:>=70");
  let oldest: string | null = null;
  if (all.first) {
    const d = await json(await fetch(`${base}/alerts/entities/alerts/v2`, {
      method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ composite_ids: [all.first] }),
    }), "CrowdStrike alert details");
    oldest = d.resources?.[0]?.created_timestamp ?? null;
  }
  return {
    summary: `${all.total} new alert${all.total === 1 ? "" : "s"} in Falcon, ${high.total} high or critical` + (oldest ? `, oldest waiting ${ago(oldest)}` : ""),
    metrics: { new_alerts: all.total, new_high_or_critical: high.total, oldest_new_created: oldest },
  };
}

/* ---------- Microsoft Defender XDR: active incidents (Graph SecurityIncident.Read.All) ---------- */
async function defender(): Promise<Snapshot> {
  need("MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET");
  const tok = await json(await fetch(`https://login.microsoftonline.com/${env("MS_TENANT_ID")}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("MS_CLIENT_ID"), client_secret: env("MS_CLIENT_SECRET"), scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  }), "Microsoft token");
  let url: string | null = "https://graph.microsoft.com/v1.0/security/incidents?$filter=status%20eq%20'active'&$top=50&$select=id,severity,assignedTo,createdDateTime";
  const items: { severity?: string; assignedTo?: string | null; createdDateTime?: string }[] = [];
  for (let page = 0; url && page < 10; page++) {
    const r = await json(await fetch(url, { headers: { authorization: `Bearer ${tok.access_token}` } }), "Graph incidents");
    items.push(...(r.value ?? [])); url = r["@odata.nextLink"] ?? null;
  }
  const high = items.filter((i) => i.severity === "high").length;
  const unassigned = items.filter((i) => !i.assignedTo).length;
  const oldest = items.map((i) => i.createdDateTime).filter(Boolean).sort()[0] ?? null;
  return {
    summary: `${items.length}${url ? "+" : ""} active incident${items.length === 1 ? "" : "s"} in Defender, ${high} high severity, ${unassigned} unassigned` + (oldest ? `, oldest ${ago(oldest)}` : ""),
    metrics: { active_incidents: items.length, more_than_shown: Boolean(url), high_severity: high, unassigned, oldest_active_created: oldest },
  };
}

/* ---------- Duo Admin API: denied / fraud authentications, last 24 h (Read log) ---------- */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
/** Duo Admin API request signature (v2, HMAC-SHA1). Exported for tests. */
async function duoSign(date: string, method: string, host: string, path: string, params: Record<string, string>, skey: string) {
  const canonParams = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join("&");
  const canon = [date, method.toUpperCase(), host.toLowerCase(), path, canonParams].join("\n");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(skey), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canon)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { sig, canonParams };
}
async function duoGet(path: string, params: Record<string, string>) {
  const host = env("DUO_API_HOST").toLowerCase(), date = new Date().toUTCString().replace("GMT", "-0000");
  const { sig, canonParams } = await duoSign(date, "GET", host, path, params, env("DUO_SKEY"));
  return await json(await fetch(`https://${host}${path}?${canonParams}`, {
    headers: { date, authorization: "Basic " + btoa(`${env("DUO_IKEY")}:${sig}`) },
  }), "Duo authentication log");
}
async function duo(): Promise<Snapshot> {
  need("DUO_API_HOST", "DUO_IKEY", "DUO_SKEY");
  const maxtime = Date.now() - 3 * 60_000, mintime = maxtime - 24 * 3600_000;
  const total = async (results: string) => {
    const r = await duoGet("/admin/v2/logs/authentication", { mintime: String(mintime), maxtime: String(maxtime), limit: "1", results });
    return r.response?.metadata?.total_objects ?? (r.response?.authlogs?.length ?? 0);
  };
  const denied = await total("denied"), fraud = await total("fraud");
  return {
    summary: `${denied} denied authentication${denied === 1 ? "" : "s"} in Duo in the last 24 h, ${fraud} marked as fraud by the user`,
    metrics: { denied_24h: denied, fraud_24h: fraud, window_end: new Date(maxtime).toISOString() },
  };
}

/* ---------- Abnormal: threats detected in the last 24 h ---------- */
async function abnormal(): Promise<Snapshot> {
  need("ABNORMAL_API_TOKEN");
  const base = env("ABNORMAL_BASE_URL") || "https://api.abnormalplatform.com";
  const end = new Date(), start = new Date(end.getTime() - 24 * 3600_000);
  const filter = `receivedTime gte ${start.toISOString().slice(0, 19)}Z lte ${end.toISOString().slice(0, 19)}Z`;
  let page: number | null = 1, n = 0;
  for (let i = 0; page && i < 10; i++) {
    const r = await json(await fetch(`${base}/v1/threats?pageSize=100&pageNumber=${page}&filter=${encodeURIComponent(filter)}`, {
      headers: { authorization: `Bearer ${env("ABNORMAL_API_TOKEN")}` },
    }), "Abnormal threats");
    n += (r.threats ?? []).length; page = r.nextPageNumber ?? null;
  }
  return { summary: `${n}${page ? "+" : ""} threat${n === 1 ? "" : "s"} detected by Abnormal in the last 24 h`, metrics: { threats_24h: n, more_than_counted: Boolean(page) } };
}

const CONNECTORS: Record<Source, { label: string; run: () => Promise<Snapshot> }> = {
  crowdstrike_alerts: { label: "CrowdStrike Falcon", run: crowdstrike },
  defender_incidents: { label: "Microsoft Defender", run: defender },
  duo_auth_denied: { label: "Duo", run: duo },
  abnormal_threats: { label: "Abnormal", run: abnormal },
};

const origin = Deno.env.get("SITE_ORIGIN") || "https://seif-abdelhamid.github.io";
const cors = {
  "access-control-allow-origin": origin,
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-sentinel-key",
  "access-control-allow-methods": "POST, OPTIONS",
  "vary": "origin",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

// POST /functions/v1/snapshot  { "source": "crowdstrike_alerts" }
// Called by the app when an analyst logs a check that has a tool connector.
// Verifies the caller is an active, 2-step-verified team member, pulls the
// numbers from the tool, stores them (service role only) and returns the id
// the log entry will cite. The database rejects snapshots that aren't the
// caller's or are older than 2 hours.

const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);
  const auth = req.headers.get("authorization") ?? "";
  const asUser = createClient(URL_, ANON, { global: { headers: { authorization: auth } } });
  const { data: u } = await asUser.auth.getUser();
  if (!u?.user) return reply({ error: "Sign in first." }, 401);
  const { data: ok } = await asUser.rpc("is_active_member");
  if (!ok) return reply({ error: "Only approved team members with 2-step verification can take snapshots." }, 403);

  let source: Source;
  try { source = (await req.json()).source; } catch { return reply({ error: "Send JSON like {\"source\": \"crowdstrike_alerts\"}." }, 400); }
  const c = CONNECTORS[source];
  if (!c) return reply({ error: "Unknown source." }, 400);
  try {
    const snap = await c.run();
    const admin = createClient(URL_, SERVICE);
    const { data, error } = await admin.from("tool_snapshots")
      .insert({ user_id: u.user.id, source, metrics: { ...snap.metrics, summary: snap.summary } })
      .select("id, taken_at").single();
    if (error) throw error;
    return reply({ id: data.id, taken_at: data.taken_at, source, label: c.label, summary: snap.summary, metrics: snap.metrics });
  } catch (e) {
    if (e instanceof NotConfigured) return reply({ error: `${c.label} isn't connected yet. Ask your supervisor to add its API keys.`, detail: e.message }, 501);
    console.error(source, e);
    return reply({ error: `Couldn't reach ${c.label} right now. Log the check without a snapshot.`, detail: String((e as Error)?.message ?? e).slice(0, 300) }, 502);
  }
});
