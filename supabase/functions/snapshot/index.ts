// POST /functions/v1/snapshot  { "source": "crowdstrike_alerts" }
// Called by the app when an analyst logs a check that has a tool connector.
// Verifies the caller is an active, 2-step-verified team member, pulls the
// numbers from the tool, stores them (service role only) and returns the id
// the log entry will cite. The database rejects snapshots that aren't the
// caller's or are older than 2 hours.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { CONNECTORS, NotConfigured, type Source } from "../_shared/connectors.ts";
import { cors, reply } from "../_shared/http.ts";

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
