// Halves front door (TECH-DESIGN B1, T7a, T8).
// - Only /api/* reaches this Worker (wrangler.jsonc run_worker_first); the app shell is served by assets.
// - Origin check on every non-GET request and on the WS upgrade (CSRF / cross-site WS hijacking, TECH-REVIEW §5).
// - Everything else (auth, rate limits, data) happens in the single Pair Durable Object.
export { Pair } from "./pair";

export interface Env {
  PAIR: DurableObjectNamespace<import("./pair").Pair>;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  BOOTSTRAP_SECRET?: string;
}

/** One pair for now. A second pair would be a second name (and a way to pick it). */
const PAIR_NAME = "pair-main";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Frame-Options": "DENY",
  // API responses are JSON only; nothing here should ever render or be framed.
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cache-Control": "no-store",
};

/** Origin is allowed if it is the configured app origin, or the same host as the request (local / LAN dev). */
function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  if (env.APP_ORIGIN && origin === env.APP_ORIGIN) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function withHeaders(res: Response): Response {
  // 101 responses carry the webSocket; leave them untouched.
  if (res.status === 101) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      // Not normally reached (assets are served before the Worker), but keep it correct.
      return env.ASSETS.fetch(request);
    }
    const isWs = request.headers.get("Upgrade")?.toLowerCase() === "websocket";
    const isRead = request.method === "GET" || request.method === "HEAD";
    if ((isWs || !isRead) && !originAllowed(request, env)) {
      return withHeaders(json(403, { error: "bad_origin" }));
    }
    const stub = env.PAIR.getByName(PAIR_NAME);
    const res = await stub.fetch(request);
    return withHeaders(res);
  },
} satisfies ExportedHandler<Env>;
