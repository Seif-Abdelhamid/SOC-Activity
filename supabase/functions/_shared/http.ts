const origin = Deno.env.get("SITE_ORIGIN") || "https://seif-abdelhamid.github.io";
export const cors = {
  "access-control-allow-origin": origin,
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-sentinel-key",
  "access-control-allow-methods": "POST, OPTIONS",
  "vary": "origin",
};
export const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
