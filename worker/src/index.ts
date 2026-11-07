// Halves front door (TECH-DESIGN B1, T7a, T8).
// - Only /api/* reaches this Worker (wrangler.jsonc run_worker_first); the app shell is served by assets.
// - Origin check on every non-GET request and on the WS upgrade (CSRF / cross-site WS hijacking, TECH-REVIEW §5).
// - Everything else (auth, rate limits, data) happens in the single Pair Durable Object.
export { Pair } from "./pair";
import { ATT } from "./pair";

export interface Env {
  PAIR: DurableObjectNamespace<import("./pair").Pair>;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  BOOTSTRAP_SECRET?: string;
  /** Private R2 bucket for expense images (T15). */
  ATT: R2Bucket;
  /** Optional overrides of the attachment guards (tests / emergencies). */
  ATT_CAP_BYTES?: string;
  ATT_DAILY_CAP?: string;
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
    if (url.pathname.startsWith("/api/att/")) return attRoute(request, url, env, stub);
    const res = await stub.fetch(request);
    return withHeaders(res);
  },
} satisfies ExportedHandler<Env>;

// ---------- attachments (TECH-DESIGN T15) ----------
// The Worker streams bytes to/from R2 itself, but every request is first authorised by the Pair DO over RPC
// (active device token, free-tier guards, per-device daily cap). The DO's att index also answers "exists?",
// so a retried PUT or a GET for a not-yet-uploaded image costs no R2 operation.

/** Magic bytes must match the declared type (stops a renamed HTML/SVG from being stored as an "image"). */
function sniffOk(type: string, b: Uint8Array): boolean {
  if (type === "image/jpeg") return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (type === "image/png") return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (type === "image/webp")
    return b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP";
  return false;
}

/** Reads at most `max` bytes; null if the body is larger. */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      try { await reader.cancel(); } catch { /* ignore */ }
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

const bearer = (req: Request) => /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") ?? "")?.[1] ?? null;

async function attRoute(
  req: Request,
  url: URL,
  env: Env,
  stub: DurableObjectStub<import("./pair").Pair>,
): Promise<Response> {
  const id = url.pathname.slice("/api/att/".length);
  const kind = url.searchParams.get("kind") ?? "full";
  if (!ATT.ID_RE.test(id) || (kind !== "full" && kind !== "thumb")) return withHeaders(json(400, { error: "bad_id" }));
  const key = `att/${id}/${kind}`;

  if (req.method === "PUT") {
    const type = (req.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ATT.TYPES.has(type)) return withHeaders(json(415, { error: "bad_type" }));
    const max = kind === "full" ? ATT.MAX_FULL : ATT.MAX_THUMB;
    if (Number(req.headers.get("Content-Length") ?? "0") > max) return withHeaders(json(413, { error: "too_large" }));
    const token = bearer(req);
    if (!token) return withHeaders(json(401, { error: "unauthorized" }));
    const body = await readCapped(req, max);
    if (!body) return withHeaders(json(413, { error: "too_large" }));
    if (!body.length || !sniffOk(type, body)) return withHeaders(json(400, { error: "bad_image" }));
    const ok = await stub.attBeginPut(token, key, body.length);
    if (!ok.ok) return withHeaders(json(ok.status, { error: ok.error }));
    if (ok.existed) return withHeaders(json(200, { ok: true, existed: true })); // idempotent retry: ids are write-once
    await env.ATT.put(key, body, {
      httpMetadata: { contentType: type },
      customMetadata: { slot: ok.slot, device: ok.deviceId, size: String(body.length), type, at: String(Date.now()) },
    });
    await stub.attCommitPut(key, body.length, type, ok.slot, ok.deviceId);
    return withHeaders(json(200, { ok: true, bytes: body.length }));
  }

  if (req.method === "GET") {
    const ok = await stub.attBeginGet(bearer(req), key);
    if (!ok.ok) return withHeaders(json(ok.status, { error: ok.error }));
    const obj = await env.ATT.get(key);
    if (!obj) return withHeaders(json(404, { error: "not_found" }));
    const type = obj.httpMetadata?.contentType ?? "";
    const res = new Response(obj.body, {
      headers: {
        "Content-Type": ATT.TYPES.has(type) ? type : "application/octet-stream",
        ETag: obj.httpEtag,
        "Content-Disposition": "inline",
      },
    });
    const out = withHeaders(res);
    // Ids are immutable (write-once), so the browser may keep it forever; private = never in shared caches.
    out.headers.set("Cache-Control", "private, max-age=31536000, immutable");
    return out;
  }
  return withHeaders(json(405, { error: "method_not_allowed" }));
}
