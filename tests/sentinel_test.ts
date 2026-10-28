// End-to-end test of the sentinel function against a fake Supabase REST API,
// a fake Teams webhook and a fake Splunk HEC.  Run: deno test -A tests/
const assert = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const posts: { teams: any[]; splunk: string[]; patched: string[]; state: Record<string, any> } = { teams: [], splunk: [], patched: [], state: {} };

// fake Supabase (PostgREST subset) + Teams + Splunk on one port
const now = new Date();
const rows: Record<string, any[]> = {
  check_logs: [{ id: 7, ref: "CHK-AAAA1111", result: "escalated", details: "Encoded PowerShell on FIN-LT022.", affected: "FIN-LT022", action_taken: "Isolated", ticket: "INC1",
    performed_at: now.toISOString(), created_at: now.toISOString(), profiles: { full_name: "Maya Patel" }, practices: { name: "Triage all new Falcon detections", tool: "CrowdStrike", priority: "Critical" } }],
  audit_events: [{ id: 3, action: "signed_up", detail: { email: "new.analyst@shu.edu" }, at: now.toISOString() }],
  log_reviews: [], handoffs: [{ id: 1, summary: "Quiet shift.", created_at: now.toISOString() }],
};
const server = Deno.serve({ port: 8787, onListen() {} }, async (req) => {
  const u = new URL(req.url); const body = req.method === "GET" ? null : await req.text();
  if (u.pathname === "/teams") { posts.teams.push(JSON.parse(body!)); return new Response("1"); }
  if (u.pathname === "/hec") { assert(req.headers.get("authorization") === "Splunk hec-token", "HEC auth"); posts.splunk.push(body!); return Response.json({ text: "Success", code: 0 }); }
  const table = u.pathname.replace("/rest/v1/", "");
  if (table === "integration_state") {
    if (req.method === "GET") { const k = u.searchParams.get("key")!.replace("eq.", ""); const v = posts.state[k]; return Response.json(v ? { value: v } : null, { status: v ? 200 : 406 }); }
    const r = JSON.parse(body!); posts.state[r.key] = r.value; return new Response(null, { status: 201 });
  }
  if (table === "rpc/coverage_snapshot") return Response.json([
    { id: "cs1", name: "Triage all new Falcon detections", tool: "CrowdStrike", priority: "Critical", frequency: "Daily", last_done: new Date(Date.now() - 6 * 86400_000).toISOString(), last_by: "Omar", owner: "Weekday morning" },
    { id: "md2", name: "Triage user-reported phishing", tool: "Defender", priority: "High", frequency: "Daily", last_done: now.toISOString(), last_by: "Maya", owner: null },
    { id: "x1", name: "Maintain playbooks", tool: "Cross-Tool", priority: "Critical", frequency: "Annually", last_done: null, last_by: null, owner: null }]);
  if (table === "rpc/apply_retention") return Response.json(0);
  if (req.method === "PATCH") { posts.patched.push(`${table}?${u.searchParams}`); return new Response(null, { status: 204 }); }
  // GET with simple gt cursor support
  let data = rows[table] ?? [];
  for (const [k, v] of u.searchParams) if (v.startsWith("gt.")) data = data.filter((r) => String(r[k]) > v.slice(3) && Number(r[k]) > Number(v.slice(3)) || (isNaN(Number(v.slice(3))) && r[k] > v.slice(3)));
  return Response.json(data);
});

Deno.env.set("SUPABASE_URL", "http://localhost:8787"); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.set("SENTINEL_KEY", "k3y"); Deno.env.set("TEAMS_WEBHOOK_URL", "http://localhost:8787/teams");
Deno.env.set("SPLUNK_HEC_URL", "http://localhost:8787/hec"); Deno.env.set("SPLUNK_HEC_TOKEN", "hec-token"); Deno.env.set("DIGEST_HOUR", "0");

Deno.test({ name: "sentinel sends alerts, forwards to Splunk, keeps cursors", sanitizeOps: false, sanitizeResources: false, async fn() {
  await import("../supabase/functions/sentinel/index.ts");   // starts its own server on :8000
  const call = () => fetch("http://localhost:8000", { method: "POST", headers: { "x-sentinel-key": "k3y" } }).then((r) => r.json());
  const bad = await fetch("http://localhost:8000", { method: "POST", headers: { "x-sentinel-key": "wrong" } });
  assert(bad.status === 401, "wrong key rejected"); await bad.body?.cancel();

  const r1 = await call();
  console.log(r1.result);
  const titles = posts.teams.map((m) => m.attachments[0].content.body[0].text);
  assert(titles.some((t: string) => t.startsWith("Escalation: Triage all new Falcon")), "escalation card: " + titles);
  assert(titles.includes("New account waiting for approval"), "signup card");
  const isWeekend = ["Sat", "Sun"].includes(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date()));
  if (!isWeekend) assert(titles.some((t: string) => /2 critical or high checks are overdue/.test(t)), "overdue digest: " + titles);
  assert(posts.patched.some((p) => p.includes("id=eq.7")), "escalation marked as notified");
  assert(posts.splunk.length === 3 && posts.splunk[0].includes('"sourcetype":"shu:soclog:entry"'), "splunk events: " + posts.splunk.length);
  assert(posts.state.splunk_cursor.check_logs === 7, "splunk cursor saved");

  const before = posts.teams.length;
  rows.check_logs = []; const r2 = await call();
  assert(posts.teams.length === before, "second run sends nothing new: " + JSON.stringify(r2.result));
  assert(/already sent today|not time yet/.test(r2.result.digest), "digest once a day");
  server.shutdown();
} });
