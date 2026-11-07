// Integration tests: real Worker + Pair DO inside workerd (via @cloudflare/vitest-plugin).
// Contract: docs/TECH-DESIGN.md §B1.
import { SELF, reset } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const BASE = "https://halves.amlanandanwesha.com";
const ORIGIN = "https://halves.amlanandanwesha.com";

type Opts = { method?: string; body?: unknown; token?: string; origin?: string | null };
async function api(path: string, o: Opts = {}): Promise<{ status: number; body: any; res: Response }> {
  const headers: Record<string, string> = {};
  if (o.origin !== null) headers.Origin = o.origin ?? ORIGIN;
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await SELF.fetch(BASE + path, {
    method: o.method ?? (o.body !== undefined ? "POST" : "GET"),
    headers,
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, res };
}

async function bootstrap() {
  const r = await api("/api/bootstrap", { body: { secret: "test-secret", name: "Amlan", device: "Pixel" } });
  expect(r.status).toBe(200);
  return r.body as { token: string; slot: string; deviceId: string };
}

async function pairUp() {
  const a = await bootstrap();
  const inv = await api("/api/invite", { method: "POST", token: a.token });
  expect(inv.status).toBe(200);
  const red = await api("/api/redeem", { body: { key: inv.body.key, name: "Anwesha", device: "iPhone" } });
  expect(red.status).toBe(200);
  const ok = await api("/api/approve", { body: { deviceId: red.body.deviceId, allow: true }, token: a.token });
  expect(ok.status).toBe(200);
  return { a: a.token, aId: a.deviceId, b: red.body.pendingToken as string, bId: red.body.deviceId as string };
}

async function sync(token: string, since: number, ops: unknown[]) {
  const r = await api("/api/sync", { body: { since, ops }, token });
  expect(r.status).toBe(200);
  const msgs = r.body.messages as any[];
  return {
    acks: msgs.filter((m) => m.t === "ack"),
    rejects: msgs.filter((m) => m.t === "reject"),
    changes: msgs.find((m) => m.t === "changes"),
  };
}

let n = 0;
const opId = () => `op-${++n}-${Math.random().toString(36).slice(2)}`;

async function openWs(): Promise<{ ws: WebSocket; next: () => Promise<any>; closed: Promise<{ code: number; reason: string }> }> {
  const res = await SELF.fetch(BASE + "/api/ws", { headers: { Upgrade: "websocket", Origin: ORIGIN } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const queue: any[] = [];
  const waiters: Array<(m: any) => void> = [];
  ws.addEventListener("message", (e) => {
    const m = typeof e.data === "string" && e.data.startsWith("{") ? JSON.parse(e.data) : e.data;
    const w = waiters.shift();
    if (w) w(m); else queue.push(m);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.addEventListener("close", (e) => resolve({ code: e.code, reason: e.reason })),
  );
  ws.accept();
  const next = () =>
    queue.length
      ? Promise.resolve(queue.shift())
      : new Promise<any>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("ws timeout")), 3000);
          waiters.push((m) => { clearTimeout(t); resolve(m); });
        });
  return { ws, next, closed };
}

beforeEach(async () => {
  await reset();
});

describe("bootstrap", () => {
  it("creates the pair once, then 409", async () => {
    const bad = await api("/api/bootstrap", { body: { secret: "nope", name: "Amlan", device: "Pixel" } });
    expect(bad.status).toBe(401);
    const a = await bootstrap();
    expect(a.slot).toBe("A");
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const again = await api("/api/bootstrap", { body: { secret: "test-secret", name: "X", device: "Y" } });
    expect(again.status).toBe(409);
    const me = await api("/api/me", { token: a.token });
    expect(me.body).toMatchObject({ status: "active", slot: "A", names: { A: "Amlan" }, deviceId: a.deviceId });
  });

  it("rate-limits bootstrap", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await api("/api/bootstrap", { body: { secret: "x", name: "a", device: "b" } })).status;
    expect(last).toBe(429);
  });
});

describe("security", () => {
  it("rejects foreign / missing Origin on writes and WS; allows same-host (LAN dev)", async () => {
    expect((await api("/api/bootstrap", { body: {}, origin: "https://evil.example" })).status).toBe(403);
    expect((await api("/api/bootstrap", { body: {}, origin: null })).status).toBe(403);
    const ws = await SELF.fetch(BASE + "/api/ws", { headers: { Upgrade: "websocket", Origin: "https://evil.example" } });
    expect(ws.status).toBe(403);
    // Same host as the request URL (e.g. http://192.168.1.5:8787 in dev) is allowed.
    const lan = await SELF.fetch("http://192.168.1.5:8787/api/bootstrap", {
      method: "POST",
      headers: { Origin: "http://192.168.1.5:8787", "Content-Type": "application/json" },
      body: JSON.stringify({ secret: "test-secret", name: "Amlan", device: "Laptop" }),
    });
    expect(lan.status).toBe(200);
  });

  it("sets security headers and 401s without a token", async () => {
    const r = await api("/api/me");
    expect(r.status).toBe(401);
    expect(r.res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(r.res.headers.get("X-Robots-Tag")).toContain("noindex");
  });
});

describe("pairing", () => {
  it("invite → redeem → pending → approve", async () => {
    const a = await bootstrap();
    const inv = await api("/api/invite", { method: "POST", token: a.token });
    expect(inv.body.key).toBeTruthy();
    const red = await api("/api/redeem", { body: { key: inv.body.key, name: "Anwesha", device: "iPhone" } });
    expect(red.status).toBe(200);
    expect(red.body.slot).toBe("B");
    const pt = red.body.pendingToken;

    // single use
    expect((await api("/api/redeem", { body: { key: inv.body.key, name: "Eve", device: "x" } })).status).toBe(403);

    // pending token: only /api/me
    expect((await api("/api/me", { token: pt })).body).toMatchObject({ status: "pending", slot: "B" });
    expect((await api("/api/sync", { body: { since: 0, ops: [] }, token: pt })).status).toBe(403);
    expect((await api("/api/invite", { method: "POST", token: pt })).status).toBe(403);
    expect((await api("/api/pending", { token: pt })).status).toBe(403);

    // pending token gets nothing over WS
    const w = await openWs();
    w.ws.send(JSON.stringify({ t: "auth", token: pt }));
    expect((await w.closed).code).toBe(4003);

    const pend = await api("/api/pending", { token: a.token });
    expect(pend.body.devices).toHaveLength(1);
    expect(pend.body.devices[0]).toMatchObject({ id: red.body.deviceId, name: "Anwesha", device: "iPhone", status: "pending" });

    const ok = await api("/api/approve", { body: { deviceId: red.body.deviceId, allow: true }, token: a.token });
    expect(ok.status).toBe(200);
    const me = await api("/api/me", { token: pt });
    expect(me.body).toMatchObject({ status: "active", slot: "B", names: { A: "Amlan", B: "Anwesha" } });
    expect((await api("/api/sync", { body: { since: 0, ops: [] }, token: pt })).status).toBe(200);
  });

  it("deny deletes the pending device; known name maps to its slot", async () => {
    const { a } = await pairUp();
    const inv = await api("/api/invite", { method: "POST", token: a });
    const red = await api("/api/redeem", { body: { key: inv.body.key, name: " amlan ", device: "Laptop" } });
    expect(red.body.slot).toBe("A");
    await api("/api/approve", { body: { deviceId: red.body.deviceId, allow: false }, token: a });
    expect((await api("/api/me", { token: red.body.pendingToken })).status).toBe(401);
    // a third person can't join a full pair
    const inv2 = await api("/api/invite", { method: "POST", token: a });
    expect((await api("/api/redeem", { body: { key: inv2.body.key, name: "Mallory", device: "x" } })).status).toBe(409);
  });

  it("notifies active sockets of a pending device", async () => {
    const a = await bootstrap();
    const w = await openWs();
    w.ws.send(JSON.stringify({ t: "auth", token: a.token }));
    expect((await w.next()).t).toBe("ready");
    const inv = await api("/api/invite", { method: "POST", token: a.token });
    await api("/api/redeem", { body: { key: inv.body.key, name: "Anwesha", device: "iPhone" } });
    expect(await w.next()).toEqual({ t: "pending" });
    w.ws.close();
  });

  it("revoke kills the token and its socket", async () => {
    const { a, b, bId } = await pairUp();
    const w = await openWs();
    w.ws.send(JSON.stringify({ t: "auth", token: b }));
    expect((await w.next()).t).toBe("ready");
    const devs = await api("/api/devices", { token: a });
    expect(devs.body.devices).toHaveLength(2);
    expect((await api("/api/revoke", { body: { deviceId: bId }, token: a })).status).toBe(200);
    expect((await w.closed).code).toBe(4001);
    expect((await api("/api/me", { token: b })).status).toBe(401);
    expect((await api("/api/devices", { token: a })).body.devices).toHaveLength(1);
  });
});

describe("sync", () => {
  it("applies ops, is idempotent by opId", async () => {
    const { a, b } = await pairUp();
    const op = { opId: opId(), kind: "expense", id: "e1", base: 0, set: { amount: 240, title: "Chai" } };
    const r1 = await sync(a, 0, [op]);
    expect(r1.acks).toHaveLength(1);
    const v = r1.acks[0].version;
    expect(r1.changes.docs).toEqual([{ kind: "expense", id: "e1", data: { amount: 240, title: "Chai" }, version: v, deleted: false, by: "A" }]);
    const r2 = await sync(a, v, [op]); // retry
    expect(r2.acks[0]).toEqual({ t: "ack", opId: op.opId, version: v });
    expect(r2.changes.docs).toHaveLength(0);
    const rb = await sync(b, 0, []);
    expect(rb.changes.docs).toHaveLength(1);
    expect(rb.changes.cursor).toBe(v);
  });

  it("validates kind, size and op count", async () => {
    const { a } = await pairUp();
    const r = await sync(a, 0, [
      { opId: opId(), kind: "user", id: "x", base: 0, set: { a: 1 } },
      { opId: opId(), kind: "tag", id: "t", base: 0, set: { blob: "x".repeat(9000) } },
    ]);
    expect(r.rejects.map((x) => x.reason)).toEqual(["bad_kind", "too_large"]);
    const many = Array.from({ length: 201 }, (_, i) => ({ opId: opId(), kind: "tag", id: `t${i}`, base: 0, set: {} }));
    expect((await api("/api/sync", { body: { since: 0, ops: many }, token: a })).status).toBe(413);
  });

  it("field-level merge: different fields both win, same field → server wins", async () => {
    const { a, b } = await pairUp();
    const c = await sync(a, 0, [{ opId: opId(), kind: "expense", id: "e1", base: 0, set: { amount: 100, title: "Lunch", note: "" } }]);
    const v1 = c.acks[0].version;
    // Both edit offline from v1.
    const ra = await sync(a, v1, [{ opId: opId(), kind: "expense", id: "e1", base: v1, set: { amount: 120 } }]);
    expect(ra.acks).toHaveLength(1);
    const rb = await sync(b, v1, [{ opId: opId(), kind: "expense", id: "e1", base: v1, set: { amount: 999, title: "Dinner" } }]);
    expect(rb.acks).toHaveLength(1);
    const doc = rb.changes.docs.find((d: any) => d.id === "e1");
    expect(doc.data).toEqual({ amount: 120, title: "Dinner", note: "" });
    expect(doc.by).toBe("B");
  });

  it("fully conflicting op is acked without a new version and the doc is returned", async () => {
    const { a, b } = await pairUp();
    const c = await sync(a, 0, [{ opId: opId(), kind: "expense", id: "e1", base: 0, set: { amount: 100 } }]);
    const v1 = c.acks[0].version;
    const ra = await sync(a, v1, [{ opId: opId(), kind: "expense", id: "e1", base: v1, set: { amount: 120 } }]);
    const v2 = ra.acks[0].version;
    // b already synced past v2 for other reasons but still sends a stale base.
    const rb = await sync(b, v2, [{ opId: opId(), kind: "expense", id: "e1", base: v1, set: { amount: 5 } }]);
    expect(rb.acks[0].version).toBe(v2);
    expect(rb.changes.docs).toEqual([expect.objectContaining({ id: "e1", data: { amount: 120 }, version: v2 })]);
  });

  it("soft delete, reject edits of a doc deleted meanwhile, undo-delete", async () => {
    const { a, b } = await pairUp();
    const c = await sync(a, 0, [{ opId: opId(), kind: "expense", id: "e1", base: 0, set: { amount: 100 } }]);
    const v1 = c.acks[0].version;
    const d = await sync(a, v1, [{ opId: opId(), kind: "expense", id: "e1", base: v1, del: true }]);
    const v2 = d.acks[0].version;
    expect(d.changes.docs[0]).toMatchObject({ id: "e1", deleted: true, data: { amount: 100 }, version: v2 });
    const rb = await sync(b, v1, [{ opId: opId(), kind: "expense", id: "e1", base: v1, set: { amount: 7 } }]);
    expect(rb.rejects[0]).toMatchObject({ reason: "deleted", current: { id: "e1", deleted: true } });
    const undo = await sync(a, v2, [{ opId: opId(), kind: "expense", id: "e1", base: v2, set: {} }]);
    expect(undo.changes.docs[0]).toMatchObject({ id: "e1", deleted: false, data: { amount: 100 } });
  });

  it("pages changes ≤500 per message with a cursor", async () => {
    const { a, b } = await pairUp();
    for (let k = 0; k < 6; k++) {
      const ops = Array.from({ length: 200 }, (_, i) => ({ opId: opId(), kind: "tag", id: `t${k}-${i}`, base: 0, set: { n: i } }));
      await sync(a, 0, ops); // since 0 with 1200 docs → its own reply is paged too
    }
    const p1 = await sync(b, 0, []);
    expect(p1.changes.docs).toHaveLength(500);
    expect(p1.changes.more).toBe(true);
    const p2 = await sync(b, p1.changes.cursor, []);
    expect(p2.changes.docs).toHaveLength(500);
    const p3 = await sync(b, p2.changes.cursor, []);
    expect(p3.changes.docs).toHaveLength(200);
    expect(p3.changes.more).toBe(false);
    const ids = new Set([...p1.changes.docs, ...p2.changes.docs, ...p3.changes.docs].map((d: any) => d.id));
    expect(ids.size).toBe(1200);
  });
});

describe("websocket", () => {
  it("auth, sync with ack + changes, broadcast to the other device", async () => {
    const { a, b } = await pairUp();
    const wa = await openWs();
    const wb = await openWs();
    wa.ws.send(JSON.stringify({ t: "auth", token: a }));
    wb.ws.send(JSON.stringify({ t: "auth", token: b }));
    expect((await wa.next()).t).toBe("ready");
    expect((await wb.next()).t).toBe("ready");
    const op = { opId: opId(), kind: "expense", id: "e9", base: 0, set: { amount: 240 } };
    wa.ws.send(JSON.stringify({ t: "sync", since: 0, ops: [op] }));
    const ack = await wa.next();
    expect(ack).toMatchObject({ t: "ack", opId: op.opId });
    const ch = await wa.next();
    expect(ch).toMatchObject({ t: "changes", more: false, cursor: ack.version });
    const live = await wb.next();
    expect(live).toMatchObject({ t: "changes", cursor: null, docs: [{ id: "e9", by: "A", data: { amount: 240 } }] });
    wa.ws.close();
    wb.ws.close();
  });

  it("closes sockets that don't authenticate within 5 s", async () => {
    await bootstrap();
    const w = await openWs();
    const t0 = Date.now();
    const c = await w.closed;
    expect(c.code).toBe(4001);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4000);
  });

  it("answers ping with pong (auto-response)", async () => {
    const w = await openWs();
    w.ws.send("ping");
    expect(await w.next()).toBe("pong");
    w.ws.close();
  });
});
