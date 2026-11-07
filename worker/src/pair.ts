// Pair Durable Object: the single writer for one pair's data (TECH-DESIGN B1, T6, T7, T7a, T9).
//
// Cost rules (TECH-REVIEW §6): Hibernation API only (ctx.acceptWebSocket), ping/pong via
// setWebSocketAutoResponse, alarms instead of timers, no pending I/O. Schema migrations run in the
// constructor under blockConcurrencyWhile, versioned by meta.schema_version, each inside transactionSync
// (sql.exec rejects BEGIN).
//
// Data model (B1 deviation from T4): entities are JSON docs keyed by (kind, id). Every applied change
// bumps one global counter (meta.version); doc.version is the counter value of its last change, and
// field_versions holds the counter value at which each field last changed, for field-level merge.
// docs.deleted is 0 when live, else the version at which the doc was deleted (sent to clients as a bool).
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";

// ---------- limits (B1 "Limits") ----------
export const KINDS = new Set(["folder", "expense", "settle", "target", "tag", "pref"]);
export const MAX_OPS = 200;
export const MAX_DOC_BYTES = 8 * 1024;
export const PAGE_SIZE = 500;
export const MAX_DEVICES = 6;
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export const WS_AUTH_TIMEOUT_MS = 5000;
export const RATE_LIMIT_PER_MIN = 10;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const LAST_SEEN_THROTTLE_MS = 60_000;

type Slot = "A" | "B";
type DeviceRow = {
  id: string;
  slot: Slot;
  name: string;
  label: string;
  token_hash: string;
  status: "active" | "pending";
  created_at: number;
  last_seen: number;
};
type DocRow = {
  kind: string;
  id: string;
  data: string;
  version: number;
  deleted: number;
  by: string;
  updated_at: number;
  field_versions: string;
};
export type WireDoc = {
  kind: string;
  id: string;
  data: Record<string, unknown>;
  version: number;
  deleted: boolean;
  by: string;
};
export type Op = {
  opId: string;
  kind: string;
  id: string;
  base: number;
  set?: Record<string, unknown>;
  del?: boolean;
};
type Attachment =
  | { auth: false; at: number }
  | { auth: true; deviceId: string; slot: Slot };

// ---------- small helpers ----------
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}
function randomId(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(12)));
}
async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}
async function sha256Hex(s: string): Promise<string> {
  return [...(await sha256(s))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Constant-time string compare: hash both (equal lengths), then timingSafeEqual. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
const err = (status: number, error: string) => json(status, { error });

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length >= 1 && t.length <= max ? t : null;
}
const norm = (s: string) => s.trim().toLowerCase();

// ---------- migrations (forward-only, idempotent; TECH-REVIEW §6) ----------
const MIGRATIONS: string[][] = [
  // v1
  [
    `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS devices (
       id TEXT PRIMARY KEY, slot TEXT NOT NULL, name TEXT NOT NULL, label TEXT NOT NULL,
       token_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
       created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS invites (
       key_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used_at INTEGER, created_by TEXT)`,
    `CREATE TABLE IF NOT EXISTS docs (
       kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL,
       deleted INTEGER NOT NULL DEFAULT 0, by TEXT NOT NULL, updated_at INTEGER NOT NULL,
       field_versions TEXT NOT NULL, PRIMARY KEY (kind, id))`,
    `CREATE INDEX IF NOT EXISTS docs_by_version ON docs(version)`,
    `CREATE TABLE IF NOT EXISTS ops (
       op_id TEXT PRIMARY KEY, version INTEGER NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL)`,
  ],
];

export class Pair extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // Answered by the runtime without waking the DO (no duration billed).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    const cur = Number(this.getMeta("schema_version") ?? "0");
    for (let v = cur; v < MIGRATIONS.length; v++) {
      this.ctx.storage.transactionSync(() => {
        for (const stmt of MIGRATIONS[v]) this.sql.exec(stmt);
        this.setMeta("schema_version", String(v + 1));
      });
      console.log(`[pair] migrated schema to v${v + 1}`);
    }
  }

  // ---------- meta ----------
  private getMeta(k: string): string | null {
    const rows = this.sql.exec<{ v: string }>(`SELECT v FROM meta WHERE k = ?`, k).toArray();
    return rows.length ? rows[0].v : null;
  }
  private setMeta(k: string, v: string) {
    this.sql.exec(`INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, k, v);
  }
  private names(): Partial<Record<Slot, string>> {
    return JSON.parse(this.getMeta("names") ?? "{}");
  }
  private version(): number {
    return Number(this.getMeta("version") ?? "0");
  }

  /** Fixed-window counter per endpoint per minute, stored in meta (fallback for the Rate Limiting binding). */
  private rateLimited(bucket: string): boolean {
    const minute = Math.floor(Date.now() / 60_000);
    const raw = this.getMeta(`rl:${bucket}`);
    let st = raw ? (JSON.parse(raw) as { m: number; n: number }) : { m: minute, n: 0 };
    if (st.m !== minute) st = { m: minute, n: 0 };
    st.n++;
    this.setMeta(`rl:${bucket}`, JSON.stringify(st));
    return st.n > RATE_LIMIT_PER_MIN;
  }

  // ---------- auth ----------
  private async deviceFromToken(token: string | null | undefined): Promise<DeviceRow | null> {
    if (!token || typeof token !== "string" || token.length > 200) return null;
    const hash = await sha256Hex(token);
    const rows = this.sql.exec<DeviceRow>(`SELECT * FROM devices WHERE token_hash = ?`, hash).toArray();
    if (!rows.length) return null;
    const d = rows[0];
    const now = Date.now();
    if (now - d.last_seen > LAST_SEEN_THROTTLE_MS) {
      this.sql.exec(`UPDATE devices SET last_seen = ? WHERE id = ?`, now, d.id);
      d.last_seen = now;
    }
    return d;
  }
  private async deviceFromRequest(req: Request): Promise<DeviceRow | null> {
    const h = req.headers.get("Authorization") ?? "";
    const m = /^Bearer\s+(\S+)$/i.exec(h);
    return this.deviceFromToken(m?.[1]);
  }

  // ---------- HTTP ----------
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "");
    try {
      if (path === "/ws") return await this.upgrade(req);
      const method = req.method;
      if (method === "POST" && path === "/bootstrap") return await this.bootstrap(req);
      if (method === "POST" && path === "/redeem") return await this.redeem(req);

      const dev = await this.deviceFromRequest(req);
      if (!dev) return err(401, "unauthorized");
      if (method === "GET" && path === "/me") return this.me(dev);
      if (dev.status !== "active") return err(403, "pending");

      if (method === "POST" && path === "/invite") return await this.invite(dev);
      if (method === "GET" && path === "/pending") return this.listDevices(dev, "pending");
      if (method === "POST" && path === "/approve") return await this.approve(req);
      if (method === "GET" && path === "/devices") return this.listDevices(dev);
      if (method === "POST" && path === "/revoke") return await this.revoke(req, dev);
      if (method === "POST" && path === "/sync") return await this.httpSync(req, dev);
      return err(404, "not_found");
    } catch (e) {
      if (e instanceof BadRequest) return err(e.status, e.message);
      console.error("[pair] error", e);
      return err(500, "internal");
    }
  }

  private async body(req: Request): Promise<Record<string, unknown>> {
    const len = Number(req.headers.get("Content-Length") ?? "0");
    if (len > MAX_BODY_BYTES) throw new BadRequest(413, "too_large");
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) throw new BadRequest(413, "too_large");
    try {
      const v = JSON.parse(text || "{}");
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch {
      /* fallthrough */
    }
    throw new BadRequest(400, "bad_json");
  }

  private async bootstrap(req: Request): Promise<Response> {
    if (this.rateLimited("bootstrap")) return err(429, "rate_limited");
    const b = await this.body(req);
    const deviceCount = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM devices`).one().n;
    if (this.getMeta("paired") === "1" || deviceCount > 0) return err(409, "pair_exists");
    const secret = this.env.BOOTSTRAP_SECRET;
    if (!secret) return err(503, "bootstrap_disabled");
    if (typeof b.secret !== "string" || !(await safeEqual(b.secret, secret))) return err(401, "bad_secret");
    const name = cleanText(b.name, 40);
    const label = cleanText(b.device, 60);
    if (!name || !label) return err(400, "bad_input");
    const token = randomToken();
    const id = randomId();
    const now = Date.now();
    const hash = await sha256Hex(token);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO devices (id, slot, name, label, token_hash, status, created_at, last_seen) VALUES (?, 'A', ?, ?, ?, 'active', ?, ?)`,
        id, name, label, hash, now, now,
      );
      this.setMeta("names", JSON.stringify({ A: name }));
      this.setMeta("paired", "1");
      if (this.getMeta("version") === null) this.setMeta("version", "0");
    });
    return json(200, { token, slot: "A", deviceId: id });
  }

  private async invite(dev: DeviceRow): Promise<Response> {
    const key = randomToken();
    const expiresAt = Date.now() + INVITE_TTL_MS;
    // Drop expired / used invites while we're here (tiny table).
    this.sql.exec(`DELETE FROM invites WHERE expires_at < ? OR used_at IS NOT NULL`, Date.now() - INVITE_TTL_MS);
    this.sql.exec(`INSERT INTO invites (key_hash, expires_at, used_at, created_by) VALUES (?, ?, NULL, ?)`,
      await sha256Hex(key), expiresAt, dev.id);
    return json(200, { key, expiresAt });
  }

  private async redeem(req: Request): Promise<Response> {
    if (this.rateLimited("redeem")) return err(429, "rate_limited");
    const b = await this.body(req);
    const name = cleanText(b.name, 40);
    const label = cleanText(b.device, 60);
    if (typeof b.key !== "string" || b.key.length > 200 || !name || !label) return err(400, "bad_input");
    const keyHash = await sha256Hex(b.key);
    const inv = this.sql
      .exec<{ expires_at: number; used_at: number | null }>(`SELECT expires_at, used_at FROM invites WHERE key_hash = ?`, keyHash)
      .toArray()[0];
    const now = Date.now();
    if (!inv || inv.used_at !== null || inv.expires_at < now) return err(403, "bad_invite");
    const count = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM devices`).one().n;
    if (count >= MAX_DEVICES) return err(409, "too_many_devices");
    const names = this.names();
    let slot: Slot;
    if (names.A && norm(names.A) === norm(name)) slot = "A";
    else if (names.B && norm(names.B) === norm(name)) slot = "B";
    else if (!names.B) slot = "B";
    else return err(409, "pair_full");
    const token = randomToken();
    const id = randomId();
    const hash = await sha256Hex(token);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`UPDATE invites SET used_at = ? WHERE key_hash = ?`, now, keyHash);
      this.sql.exec(
        `INSERT INTO devices (id, slot, name, label, token_hash, status, created_at, last_seen) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        id, slot, name, label, hash, now, now,
      );
    });
    this.broadcast({ t: "pending" });
    return json(200, { pendingToken: token, slot, deviceId: id });
  }

  private me(dev: DeviceRow): Response {
    return json(200, { status: dev.status, slot: dev.slot, names: this.names(), deviceId: dev.id });
  }

  private listDevices(me: DeviceRow, status?: "pending"): Response {
    const rows = status
      ? this.sql.exec<DeviceRow>(`SELECT * FROM devices WHERE status = ? ORDER BY created_at`, status).toArray()
      : this.sql.exec<DeviceRow>(`SELECT * FROM devices ORDER BY created_at`).toArray();
    const devices = rows.map((d) => ({
      id: d.id, slot: d.slot, name: d.name, device: d.label, status: d.status,
      createdAt: d.created_at, lastSeen: d.last_seen, current: d.id === me.id,
    }));
    return json(200, { devices });
  }

  private async approve(req: Request): Promise<Response> {
    const b = await this.body(req);
    if (typeof b.deviceId !== "string" || typeof b.allow !== "boolean") return err(400, "bad_input");
    const d = this.sql.exec<DeviceRow>(`SELECT * FROM devices WHERE id = ?`, b.deviceId).toArray()[0];
    if (!d || d.status !== "pending") return err(404, "no_such_pending_device");
    if (b.allow) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(`UPDATE devices SET status = 'active' WHERE id = ?`, d.id);
        const names = this.names();
        if (!names[d.slot]) {
          names[d.slot] = d.name;
          this.setMeta("names", JSON.stringify(names));
        }
      });
    } else {
      this.sql.exec(`DELETE FROM devices WHERE id = ?`, d.id);
    }
    // "pending list changed": other active devices refetch /api/pending (and names).
    this.broadcast({ t: "pending" });
    return json(200, { ok: true, deviceId: d.id, status: b.allow ? "active" : "denied" });
  }

  private async revoke(req: Request, me: DeviceRow): Promise<Response> {
    const b = await this.body(req);
    if (typeof b.deviceId !== "string") return err(400, "bad_input");
    const d = this.sql.exec<DeviceRow>(`SELECT * FROM devices WHERE id = ?`, b.deviceId).toArray()[0];
    if (!d) return err(404, "no_such_device");
    if (d.status === "active") {
      const active = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM devices WHERE status = 'active'`).one().n;
      if (active <= 1) return err(409, "last_device");
    }
    this.sql.exec(`DELETE FROM devices WHERE id = ?`, d.id);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.auth && a.deviceId === d.id) {
        try { ws.close(4001, "revoked"); } catch { /* already closed */ }
      }
    }
    if (d.status === "pending") this.broadcast({ t: "pending" });
    return json(200, { ok: true, self: d.id === me.id });
  }

  private async httpSync(req: Request, dev: DeviceRow): Promise<Response> {
    const b = await this.body(req);
    const r = this.sync(b, dev.slot);
    if ("error" in r) return err(r.status, r.error);
    if (r.applied.length) this.broadcastChanges(r.applied, null);
    // Same messages as the WS, in order: ack/reject per op, then ONE page of changes (follow `more`).
    const page = this.changesPage(r.since, r.extra);
    return json(200, { messages: [...r.results, page] });
  }

  // ---------- sync core ----------
  /** Validates and applies a sync message in one transaction. Pure w.r.t. sockets. */
  private sync(
    msg: Record<string, unknown>,
    slot: Slot,
  ): { error: string; status: number } | {
    results: Array<Record<string, unknown>>;
    applied: WireDoc[];
    since: number;
    extra: WireDoc[];
  } {
    const since = msg.since === undefined || msg.since === null ? 0 : msg.since;
    if (typeof since !== "number" || !Number.isInteger(since) || since < 0) return { error: "bad_since", status: 400 };
    const ops = msg.ops === undefined ? [] : msg.ops;
    if (!Array.isArray(ops)) return { error: "bad_ops", status: 400 };
    if (ops.length > MAX_OPS) return { error: "too_many_ops", status: 413 };

    const results: Array<Record<string, unknown>> = [];
    const applied = new Map<string, WireDoc>();
    const extra = new Map<string, WireDoc>(); // conflicted docs the client must see regardless of `since`
    this.ctx.storage.transactionSync(() => {
      let version = this.version();
      const startVersion = version;
      for (const raw of ops) {
        const r = this.applyOp(raw, slot, () => ++version);
        results.push(r.msg);
        if (r.doc && r.changed) applied.set(`${r.doc.kind}\u0000${r.doc.id}`, r.doc);
        if (r.doc && r.conflict) extra.set(`${r.doc.kind}\u0000${r.doc.id}`, r.doc);
      }
      if (version !== startVersion) this.setMeta("version", String(version));
    });
    return { results, applied: [...applied.values()], since, extra: [...extra.values()] };
  }

  private applyOp(
    raw: unknown,
    slot: Slot,
    nextVersion: () => number,
  ): { msg: Record<string, unknown>; doc?: WireDoc; changed?: boolean; conflict?: boolean } {
    const o = raw as Partial<Op> | null;
    const opId = o && typeof o.opId === "string" && o.opId.length >= 1 && o.opId.length <= 64 ? o.opId : null;
    const reject = (reason: string, current: WireDoc | null = null) => ({
      msg: { t: "reject", opId: opId ?? (o as { opId?: unknown } | null)?.opId ?? null, reason, current },
    });
    if (!o || typeof o !== "object" || !opId) return reject("bad_op");
    if (typeof o.kind !== "string" || !KINDS.has(o.kind)) return reject("bad_kind");
    if (typeof o.id !== "string" || o.id.length < 1 || o.id.length > 64) return reject("bad_id");
    const base = o.base === undefined || o.base === null ? 0 : o.base;
    if (typeof base !== "number" || !Number.isInteger(base) || base < 0) return reject("bad_base");
    const del = o.del === true;
    const set = o.set ?? {};
    if (typeof set !== "object" || Array.isArray(set) || set === null) return reject("bad_set");

    // Idempotency: a retried op is re-acked with the version it got the first time.
    const seen = this.sql.exec<{ version: number }>(`SELECT version FROM ops WHERE op_id = ?`, opId).toArray()[0];
    if (seen) return { msg: { t: "ack", opId, version: seen.version } };

    const row = this.sql.exec<DocRow>(`SELECT * FROM docs WHERE kind = ? AND id = ?`, o.kind, o.id).toArray()[0];
    const now = Date.now();
    const fields = Object.keys(set);

    if (!row) {
      const data: Record<string, unknown> = { ...set };
      const dataJson = JSON.stringify(data);
      if (enc.encode(dataJson).length > MAX_DOC_BYTES) return reject("too_large");
      const v = nextVersion();
      const fv: Record<string, number> = {};
      for (const f of fields) fv[f] = v;
      this.sql.exec(
        `INSERT INTO docs (kind, id, data, version, deleted, by, updated_at, field_versions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        o.kind, o.id, dataJson, v, del ? v : 0, slot, now, JSON.stringify(fv),
      );
      this.recordOp(opId, v, o.kind, o.id, now);
      return { msg: { t: "ack", opId, version: v }, doc: { kind: o.kind, id: o.id, data, version: v, deleted: del, by: slot }, changed: true };
    }

    const current = toWire(row);
    const fv = JSON.parse(row.field_versions) as Record<string, number>;
    const data = JSON.parse(row.data) as Record<string, unknown>;

    if (del) {
      if (row.deleted) {
        // Already deleted: nothing to change; ack with the doc's version.
        this.recordOp(opId, row.version, o.kind, o.id, now);
        return { msg: { t: "ack", opId, version: row.version } };
      }
      const v = nextVersion();
      this.sql.exec(`UPDATE docs SET deleted = ?, version = ?, by = ?, updated_at = ? WHERE kind = ? AND id = ?`,
        v, v, slot, now, o.kind, o.id);
      this.recordOp(opId, v, o.kind, o.id, now);
      return { msg: { t: "ack", opId, version: v }, doc: { ...current, version: v, deleted: true, by: slot }, changed: true };
    }

    // Edit (or undo-delete) of an existing doc.
    let undelete = false;
    if (row.deleted) {
      // The client only knew the live doc → the partner deleted it meanwhile → reject (client rolls back).
      if (row.deleted > base) return reject("deleted", current);
      undelete = true; // client saw the delete (base >= delete version) and is restoring it: Undo.
    }
    let conflict = false;
    let any = false;
    for (const f of fields) {
      const sv = fv[f] ?? 0;
      if (sv <= base) {
        data[f] = set[f];
        any = true;
      } else conflict = true; // the partner changed this field after `base`: server wins
    }
    if (!any && !undelete) {
      // Nothing applied (all conflicting, or empty set). Ack with the doc's version; client learns via changes.
      this.recordOp(opId, row.version, o.kind, o.id, now);
      return { msg: { t: "ack", opId, version: row.version }, doc: current, conflict };
    }
    const dataJson = JSON.stringify(data);
    if (enc.encode(dataJson).length > MAX_DOC_BYTES) return reject("too_large", current);
    const v = nextVersion();
    for (const f of fields) if ((fv[f] ?? 0) <= base) fv[f] = v;
    this.sql.exec(
      `UPDATE docs SET data = ?, version = ?, deleted = 0, by = ?, updated_at = ?, field_versions = ? WHERE kind = ? AND id = ?`,
      dataJson, v, slot, now, JSON.stringify(fv), o.kind, o.id,
    );
    this.recordOp(opId, v, o.kind, o.id, now);
    return {
      msg: { t: "ack", opId, version: v },
      doc: { kind: o.kind, id: o.id, data, version: v, deleted: false, by: slot },
      changed: true,
      conflict,
    };
  }

  private recordOp(opId: string, version: number, kind: string, id: string, at: number) {
    this.sql.exec(`INSERT INTO ops (op_id, version, kind, id, at) VALUES (?, ?, ?, ?, ?)`, opId, version, kind, id, at);
  }

  /**
   * One page of docs with version > since (≤ PAGE_SIZE), plus `extra` docs (conflicts) on the first page.
   * cursor = the version the client may store as its new `since`; more = fetch again with since = cursor.
   */
  private changesPage(since: number, extra: WireDoc[] = []): { t: "changes"; docs: WireDoc[]; cursor: number; more: boolean } {
    const rows = this.sql
      .exec<DocRow>(`SELECT * FROM docs WHERE version > ? ORDER BY version LIMIT ?`, since, PAGE_SIZE + 1)
      .toArray();
    const more = rows.length > PAGE_SIZE;
    const page = rows.slice(0, PAGE_SIZE).map(toWire);
    const cursor = more ? page[page.length - 1].version : Math.max(since, this.version());
    const seen = new Set(page.map((d) => `${d.kind}\u0000${d.id}`));
    for (const d of extra) if (!seen.has(`${d.kind}\u0000${d.id}`)) page.push(d);
    return { t: "changes", docs: page, cursor, more };
  }

  // ---------- WebSocket (Hibernation API) ----------
  private async upgrade(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return err(426, "expected_websocket");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ auth: false, at: Date.now() } satisfies Attachment);
    // 5 s auth deadline enforced by an alarm (no timers in the DO).
    await this.ensureAlarm(Date.now() + WS_AUTH_TIMEOUT_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** setAlarm costs a write, so only move the alarm earlier (or set it when none is pending). */
  private async ensureAlarm(at: number) {
    const cur = await this.ctx.storage.getAlarm();
    if (cur === null || cur > at) await this.ctx.storage.setAlarm(at);
  }

  async alarm() {
    const now = Date.now();
    let next: number | null = null;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && !a.auth) {
        const deadline = a.at + WS_AUTH_TIMEOUT_MS;
        if (deadline <= now) {
          try { ws.close(4001, "auth_timeout"); } catch { /* gone */ }
        } else next = next === null ? deadline : Math.min(next, deadline);
      }
    }
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return this.wsFail(ws, 1003, "text_only");
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(message);
      if (!msg || typeof msg !== "object") throw new Error();
    } catch {
      return this.wsFail(ws, 1007, "bad_json");
    }
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a?.auth) {
      if (msg.t !== "auth") return this.wsFail(ws, 4001, "auth_first");
      const dev = await this.deviceFromToken(msg.token as string);
      if (!dev) return this.wsFail(ws, 4001, "unauthorized");
      if (dev.status !== "active") return this.wsFail(ws, 4003, "pending");
      ws.serializeAttachment({ auth: true, deviceId: dev.id, slot: dev.slot } satisfies Attachment);
      ws.send(JSON.stringify({ t: "ready", slot: dev.slot, deviceId: dev.id, version: this.version() }));
      return;
    }
    // Re-check the device on each message: a revoked device must stop syncing (cheap PK lookup).
    const exists = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM devices WHERE id = ? AND status = 'active'`, a.deviceId).one().n;
    if (!exists) return this.wsFail(ws, 4001, "revoked");

    if (msg.t === "sync") {
      let r: ReturnType<Pair["sync"]>;
      try {
        r = this.sync(msg, a.slot);
      } catch (e) {
        console.error("[pair] sync failed (rolled back)", e);
        ws.send(JSON.stringify({ t: "error", reason: "internal" }));
        return;
      }
      if ("error" in r) {
        ws.send(JSON.stringify({ t: "error", reason: r.error }));
        return;
      }
      for (const m of r.results) ws.send(JSON.stringify(m));
      // Over WS, all pages are sent in a row (each ≤ PAGE_SIZE docs); the last has more=false.
      let since = r.since;
      let extra = r.extra;
      for (;;) {
        const page = this.changesPage(since, extra);
        ws.send(JSON.stringify(page));
        if (!page.more) break;
        since = page.cursor;
        extra = [];
      }
      if (r.applied.length) this.broadcastChanges(r.applied, ws);
      return;
    }
    ws.send(JSON.stringify({ t: "error", reason: "unknown_type" }));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  async webSocketError(ws: WebSocket) {
    try { ws.close(1011, "error"); } catch { /* already closed */ }
  }

  private wsFail(ws: WebSocket, code: number, reason: string) {
    try { ws.close(code, reason); } catch { /* gone */ }
  }

  /** Send to every authenticated socket (optionally except one). */
  private broadcast(msg: unknown, except?: WebSocket) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a?.auth) continue;
      try { ws.send(s); } catch { /* closing */ }
    }
  }

  /**
   * Live updates to the other devices. cursor is null: a live push must NOT advance the receiver's
   * `since` (it may have missed earlier changes); the next sync reply carries the real cursor.
   */
  private broadcastChanges(docs: WireDoc[], except: WebSocket | null) {
    for (let i = 0; i < docs.length; i += PAGE_SIZE) {
      this.broadcast({ t: "changes", docs: docs.slice(i, i + PAGE_SIZE), cursor: null, more: false }, except ?? undefined);
    }
  }
}

class BadRequest extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function toWire(r: DocRow): WireDoc {
  return { kind: r.kind, id: r.id, data: JSON.parse(r.data), version: r.version, deleted: r.deleted !== 0, by: r.by };
}
