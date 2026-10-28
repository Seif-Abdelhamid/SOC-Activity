// Offline tests for the tool connectors: fake each vendor API and check the
// requests we send and the summaries we produce.  Run: deno test tests/
import { CONNECTORS, NotConfigured, duoSign } from "../supabase/functions/_shared/connectors.ts";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(m); };
type Route = (url: URL, init: RequestInit) => unknown;
function fakeFetch(routes: [RegExp, Route][]) {
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input)); seen.push(`${init.method ?? "GET"} ${url.host}${url.pathname}`);
    const r = routes.find(([re]) => re.test(url.href));
    if (!r) return new Response("no route " + url.href, { status: 404 });
    return new Response(JSON.stringify(r[1](url, init)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return seen;
}
const setEnv = (o: Record<string, string>) => Object.entries(o).forEach(([k, v]) => Deno.env.set(k, v));

Deno.test("connectors report 'not configured' without secrets", async () => {
  for (const c of Object.values(CONNECTORS)) {
    let err: unknown; try { await c.run(); } catch (e) { err = e; }
    assert(err instanceof NotConfigured, `${c.label} should say not configured`);
  }
});

Deno.test("CrowdStrike: counts new and high alerts, finds the oldest", async () => {
  setEnv({ CROWDSTRIKE_CLIENT_ID: "id", CROWDSTRIKE_CLIENT_SECRET: "secret" });
  fakeFetch([
    [/oauth2\/token/, () => ({ access_token: "tok" })],
    [/queries\/alerts\/v2.*severity/, () => ({ meta: { pagination: { total: 2 } }, resources: ["a1"] })],
    [/queries\/alerts\/v2/, (u) => { assert(u.searchParams.get("filter") === "status:'new'", "filter"); return { meta: { pagination: { total: 14 } }, resources: ["a0"] }; }],
    [/entities\/alerts\/v2/, () => ({ resources: [{ created_timestamp: new Date(Date.now() - 3 * 3600_000).toISOString() }] })],
  ]);
  const s = await CONNECTORS.crowdstrike_alerts.run();
  assert(s.metrics.new_alerts === 14 && s.metrics.new_high_or_critical === 2, JSON.stringify(s));
  assert(s.summary.startsWith("14 new alerts in Falcon, 2 high or critical, oldest waiting 3 h"), s.summary);
});

Deno.test("Defender: pages active incidents", async () => {
  setEnv({ MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s" });
  let page = 0;
  fakeFetch([
    [/login\.microsoftonline\.com\/t\/oauth2\/v2\.0\/token/, () => ({ access_token: "tok" })],
    [/graph\.microsoft\.com\/v1\.0\/security\/incidents/, () => page++ === 0
      ? { value: [{ severity: "high", assignedTo: null, createdDateTime: "2026-10-01T00:00:00Z" }, { severity: "low", assignedTo: "x" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/security/incidents?page=2" }
      : { value: [{ severity: "high", assignedTo: "y", createdDateTime: "2026-10-02T00:00:00Z" }] }],
  ]);
  const s = await CONNECTORS.defender_incidents.run();
  assert(s.metrics.active_incidents === 3 && s.metrics.high_severity === 2 && s.metrics.unassigned === 1, JSON.stringify(s));
});

Deno.test("Duo: signs requests and reads totals", async () => {
  setEnv({ DUO_API_HOST: "api-x.duosecurity.com", DUO_IKEY: "DIXXXX", DUO_SKEY: "skey" });
  fakeFetch([[/api-x\.duosecurity\.com\/admin\/v2\/logs\/authentication/, (u, init) => {
    const h = new Headers(init.headers); assert(h.get("authorization")?.startsWith("Basic "), "basic auth"); assert(h.get("date"), "date header");
    const [ikey, sig] = atob(h.get("authorization")!.slice(6)).split(":"); assert(ikey === "DIXXXX" && /^[0-9a-f]{40}$/.test(sig), "hmac-sha1 hex signature");
    return { stat: "OK", response: { authlogs: [], metadata: { total_objects: u.searchParams.get("results") === "denied" ? 7 : 1 } } };
  }]]);
  const s = await CONNECTORS.duo_auth_denied.run();
  assert(s.metrics.denied_24h === 7 && s.metrics.fraud_24h === 1, JSON.stringify(s));
});

Deno.test("Abnormal: counts threats across pages", async () => {
  setEnv({ ABNORMAL_API_TOKEN: "tok" });
  fakeFetch([[/api\.abnormalplatform\.com\/v1\/threats/, (u) => u.searchParams.get("pageNumber") === "1"
    ? { threats: [{}, {}, {}], nextPageNumber: 2 } : { threats: [{}] }]]);
  const s = await CONNECTORS.abnormal_threats.run();
  assert(s.metrics.threats_24h === 4, JSON.stringify(s));
});

Deno.test("Duo: signature matches Duo's documented example", async () => {
  const { sig } = await duoSign("Tue, 21 Aug 2012 17:29:18 -0000", "POST", "api-xxxxxxxx.duosecurity.com", "/accounts/v1/account/list",
    { realname: "First Last", username: "root" }, "Zh5eGmUq9zpfQnyUIu5OL9iWoMMv5ZNmk3zLJ4Ep");
  assert(sig === "2d97d6166319781b5a3a07af39d366f491234edc", "got " + sig);
});
