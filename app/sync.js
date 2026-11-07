/* Halves local-first store + sync (TECH-DESIGN T5, T5a, T6, B1).
   - The full doc set (last-known server copy = `base`) + the outbox + the server cursor live in IndexedDB
     (localStorage fallback), so the app opens offline instantly.
   - The app keeps plain in-memory arrays. After every render the app calls HalvesSync.schedule(): we diff the
     app's collections against the "shadow" (base + queued ops) and turn the differences into field-level ops.
   - Ops drain over the WebSocket /api/ws (first message = auth), with HTTP POST /api/sync as the fallback.
   - Retries (T5a): after each log, on `online`, on foreground / visibilitychange, else backoff 5s → 30s → 2m → 15m.
   - Server reject → roll the doc back to `current` and tell the app (snackbar).
   The app supplies an adapter: {collect, get, apply, busy, render, onReject, onSignedOut, onPending, onFirstSync}.
   Data is opaque here; the app maps "you"/partner ↔ slots A/B at its edge. */
const HalvesSync = (() => {
  const KINDS = ['folder', 'expense', 'settle', 'target', 'tag', 'pref'];
  const BACKOFF = [5e3, 30e3, 120e3, 900e3];
  const BATCH = 200;
  const DAY = 864e5;

  /* ---------- tiny persistence layer: IndexedDB, localStorage fallback ---------- */
  const DB = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      if (!self.indexedDB) return rej(new Error('no idb'));
      const r = indexedDB.open('halves', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('idb blocked'));
    }));
    const LS = k => 'halves.db.' + k;
    async function get(k) {
      try {
        const db = await open();
        const v = await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
        if (v !== undefined) return v;
      } catch (e) { /* fall through */ }
      try { const s = localStorage.getItem(LS(k)); return s ? JSON.parse(s) : undefined; } catch (e) { return undefined; }
    }
    async function set(k, v) {
      try {
        const db = await open();
        await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
        try { localStorage.removeItem(LS(k)); } catch (e) {}
        return;
      } catch (e) { /* fall through */ }
      try { localStorage.setItem(LS(k), JSON.stringify(v)); } catch (e) {}
    }
    async function del(k) {
      try { const db = await open(); await new Promise(res => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = res; tx.onerror = res; }); } catch (e) {}
      try { localStorage.removeItem(LS(k)); } catch (e) {}
    }
    return {get, set, del};
  })();

  /* ---------- state ---------- */
  const fresh = () => ({v: 1, base: {}, outbox: [], cursor: 0, fails: 0, failSince: 0, lastOk: 0, synced: false});
  let st = fresh();
  let sh = {};                 // shadow: kind → id → data (base + outbox applied)
  let A = null;                // adapter
  let cfg = {token: null, demo: false, api: 'api/', key: 'state'};
  let ws = null, wsUp = false, inflight = new Set(), retryT = 0, saveT = 0, schedQ = false, httpBusy = false;
  let deferred = [], wsMiss = 0, lastMore = false;           // server messages held while a sheet is open (processed in order on flush)
  let persistRefused = false, started = false, stopped = false, dangerKey = '';
  let lastLocalVer = 0;

  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const eq = (a, b) => {
    if (a === b) return true;
    if (a == null && b == null) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a == null || b == null) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  };
  const rid = (n = 16) => { const a = new Uint8Array(n); crypto.getRandomValues(a); let s = ''; for (const x of a) s += (x % 36).toString(36); return s; };
  const map = (o, k) => o[k] || (o[k] = {});

  function recompute(kind, id) {
    const b = st.base[kind] && st.base[kind][id];
    let d = b && !b.deleted ? {...b.data} : null;
    for (const op of st.outbox) if (op.kind === kind && op.id === id) d = op.del ? null : {...(d || {}), ...clone(op.set)};
    if (d) map(sh, kind)[id] = d; else if (sh[kind]) delete sh[kind][id];
    return d;
  }
  function rebuild() {
    sh = {};
    for (const kind in st.base) for (const id in st.base[kind]) { const b = st.base[kind][id]; if (!b.deleted) map(sh, kind)[id] = {...b.data}; }
    for (const op of st.outbox) { if (op.del) { if (sh[op.kind]) delete sh[op.kind][op.id]; } else map(sh, op.kind)[op.id] = {...(sh[op.kind] && sh[op.kind][op.id] || {}), ...clone(op.set)}; }
  }
  function save() { clearTimeout(saveT); saveT = setTimeout(() => DB.set(cfg.key, st), 30); }
  function saveNow() { clearTimeout(saveT); return DB.set(cfg.key, st); }

  /* ---------- diff: app collections vs shadow → ops ---------- */
  function diff() {
    schedQ = false;
    if (!A || !started || stopped) return;
    const cur = A.collect();
    let n = 0;
    for (const kind of KINDS) {
      const c = cur[kind] || {};
      for (const id in c) if (!same(c[id], sh[kind] && sh[kind][id])) n += docOp(kind, id, c[id]);
      for (const id of Object.keys(sh[kind] || {})) if (!(id in c)) n += docOp(kind, id, null);
    }
    if (!n) return;
    save();
    if (cfg.demo) return drainLocal();
    kick();
  }
  function same(a, b) {
    if (!a || !b) return !a && !b;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!eq(a[k], b[k])) return false;
    return true;
  }
  const push = o => { st.outbox.push(o); recompute(o.kind, o.id); };
  /* One doc changed: fold its not-yet-sent ops into a single fresh op (so "delete, then Undo" before sending is a no-op). */
  function docOp(kind, id, a) {
    const before = st.outbox.length;
    st.outbox = st.outbox.filter(o => !(o.kind === kind && o.id === id && !inflight.has(o.opId)));
    const folded = st.outbox.length !== before;
    const s = folded ? recompute(kind, id) : (sh[kind] && sh[kind][id]) || null;
    if (!a) { if (!s) return folded ? 1 : 0; const o = mk(kind, id, {}); o.del = true; push(o); return 1; }
    if (!s) {
      // Undo of an acked delete: a plain op with base = the delete version resurrects it (contract).
      // If the delete is still in flight we can't know that version yet, so the doc gets a new id instead.
      const b = st.base[kind] && st.base[kind][id];
      if (b && !b.deleted && kind !== 'tag' && kind !== 'pref' && A.rekey) { const nid = rid(12); A.rekey(kind, id, nid); id = nid; }
      push(mk(kind, id, clone(a))); return 1;
    }
    const set = {}; let k2 = 0;
    for (const k of new Set([...Object.keys(a), ...Object.keys(s)])) if (!eq(a[k], s[k])) { set[k] = a[k] === undefined ? null : clone(a[k]); k2++; }
    if (!k2) return folded ? 1 : 0;
    push(mk(kind, id, set)); return 1;
  }
  function mk(kind, id, set) {
    const b = st.base[kind] && st.base[kind][id];
    return {opId: rid(), kind, id, base: b ? b.version : 0, set, t: Date.now()};
  }
  function schedule() { if (schedQ) return; schedQ = true; queueMicrotask(diff); }

  /* ---------- incoming ---------- */
  function handle(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'pending') { A && A.onPending && A.onPending(); return; }
    if (m.t === 'ack' || m.t === 'reject' || m.t === 'changes') {
      if (deferred.length || (A && A.busy && A.busy())) { deferred.push(m); return; }
      process(m);
      A && A.render && A.render();
    }
    if (m.t === 'error' && /auth|revok|unauth/i.test(m.reason || m.error || '')) checkRevoked();
  }
  function process(m) {
    if (m.t === 'ack') ack(m);
    else if (m.t === 'reject') reject(m);
    else if (m.t === 'changes') changes(m);
  }
  function ack(m) {
    const i = st.outbox.findIndex(o => o.opId === m.opId);
    inflight.delete(m.opId);
    if (i < 0) return;
    const op = st.outbox.splice(i, 1)[0];
    const b = map(st.base, op.kind)[op.id] || (st.base[op.kind][op.id] = {data: {}, version: 0});
    if (op.del) { b.deleted = true; b.data = {}; } else { b.deleted = false; b.data = {...b.data, ...clone(op.set)}; }
    b.version = Math.max(b.version || 0, +m.version || 0);
    recompute(op.kind, op.id);
    save();
    if (!st.outbox.some(o => !inflight.has(o.opId))) return;
    sendOps();
  }
  function reject(m) {
    const i = st.outbox.findIndex(o => o.opId === m.opId);
    inflight.delete(m.opId);
    if (i < 0) return;
    const op = st.outbox[i];
    // roll the whole doc back: drop every queued op for it, adopt the server's current copy
    st.outbox = st.outbox.filter(o => !(o.kind === op.kind && o.id === op.id));
    const c = m.current;
    if (c && typeof c === 'object') {
      const data = c.data !== undefined ? c.data : c;
      map(st.base, op.kind)[op.id] = {data: clone(data) || {}, version: +c.version || (st.base[op.kind][op.id] || {}).version || 0, deleted: !!c.deleted || data == null};
    } else if (st.base[op.kind]) delete st.base[op.kind][op.id];
    const d = recompute(op.kind, op.id);
    A.apply(op.kind, op.id, d ? clone(d) : null);
    save();
    A.onReject && A.onReject(op, m.reason || 'rejected');
  }
  function changes(m) {
    for (const doc of m.docs || []) {
      if (!doc || !doc.kind || doc.id == null) continue;
      const b = st.base[doc.kind] && st.base[doc.kind][doc.id];
      if (b && (+doc.version || 0) <= (b.version || 0)) continue;   // stale echo
      const oldSh = sh[doc.kind] && sh[doc.kind][doc.id] ? {...sh[doc.kind][doc.id]} : null;
      map(st.base, doc.kind)[doc.id] = {data: clone(doc.data) || {}, version: +doc.version || 0, deleted: !!doc.deleted || doc.data == null};
      const newSh = recompute(doc.kind, doc.id);
      merge3(doc.kind, doc.id, oldSh, newSh);
    }
    if (m.cursor != null) st.cursor = m.cursor;        // live pushes carry cursor:null → apply, don't advance `since`
    lastMore = !!m.more;
    save();
    if (m.cursor != null && !m.more && !st.synced) { st.synced = true; save(); A.onFirstSync && A.onFirstSync(); }
  }
  /* 3-way: a field the app changed locally (and not yet diffed) keeps the app's value; everything else takes the new shadow. */
  function merge3(kind, id, oldSh, newSh) {
    const cur = A.get(kind, id);
    if (!newSh) { if (cur) A.apply(kind, id, null); return; }
    if (!cur) { A.apply(kind, id, clone(newSh)); return; }
    const out = {};
    for (const k of new Set([...Object.keys(cur), ...Object.keys(oldSh || {}), ...Object.keys(newSh)])) {
      out[k] = oldSh && !eq(cur[k], oldSh[k]) ? cur[k] : newSh[k];
    }
    A.apply(kind, id, clone(out));
  }
  /* Called by the app when its sheet closes: apply what arrived meanwhile, in order. Returns true if anything changed. */
  function flush() {
    if (!deferred.length) return false;
    const q = deferred; deferred = [];
    for (const m of q) process(m);
    return true;
  }

  /* ---------- transport ---------- */
  const apiURL = p => new URL(cfg.api + p, location.href).href;
  const wsURL = () => apiURL('ws').replace(/^http/, 'ws');
  function online() { return navigator.onLine !== false; }
  function ok() { st.fails = 0; st.failSince = 0; st.lastOk = Date.now(); save(); clearTimeout(retryT); refreshDanger(); }
  function fail() {
    st.fails++; if (!st.failSince) st.failSince = Date.now(); save();
    later(BACKOFF[Math.min(st.fails - 1, BACKOFF.length - 1)]);
    refreshDanger();
  }
  function later(ms) { clearTimeout(retryT); retryT = setTimeout(() => kick(), ms); }

  /* Kick = try now: (re)connect the socket if needed, push anything unsent, fall back to HTTP if the socket won't open. */
  function kick() {
    if (!started || stopped || cfg.demo || !cfg.token) return;
    clearTimeout(retryT);
    if (ws && ws.readyState > 1) { ws = null; wsUp = false; inflight.clear(); }
    if (ws && wsUp) { sendOps(); return; }
    if (ws) return;                                 // connecting
    connect();
  }
  function connect() {
    let opened = false, done = false;
    const sock = new WebSocket(wsURL());
    ws = sock;
    const to = setTimeout(() => { if (!opened) { try { sock.close(); } catch (e) {} giveUp(); } }, 8000);
    const giveUp = () => { if (done) return; done = true; wsMiss++; clearTimeout(to); if (ws === sock) { ws = null; wsUp = false; } inflight.clear(); httpSync(); };
    sock.onopen = () => {
      opened = true; clearTimeout(to); wsUp = true; wsMiss = 0; inflight.clear();
      sock.send(JSON.stringify({t: 'auth', token: cfg.token}));
      sendOps(true);
      ok();
    };
    sock.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } if (Array.isArray(m)) m.forEach(handle); else handle(m); };
    sock.onerror = () => {};
    sock.onclose = ev => {
      clearTimeout(to);
      if (!opened) return giveUp();
      if (ws === sock) { ws = null; wsUp = false; }
      inflight.clear();
      if (done) return; done = true;
      if (ev.code === 4001) { signedOut(); return; }                  // auth failed / revoked
      if (ev.code === 4003) { stop(); A && A.onPendingDevice && A.onPendingDevice(); return; }   // device not approved yet
      if (stopped) return;
      // live channel dropped: reconnect later (counts as a failure only if work is waiting)
      if (st.outbox.length) fail(); else later(BACKOFF[0]);
    };
  }
  function sendOps(always) {
    if (!ws || !wsUp) return;
    const ops = st.outbox.filter(o => !inflight.has(o.opId)).slice(0, BATCH);
    if (!ops.length && !always) return;
    ops.forEach(o => inflight.add(o.opId));
    try { ws.send(JSON.stringify({t: 'sync', since: st.cursor, ops: ops.map(wire)})); } catch (e) { ops.forEach(o => inflight.delete(o.opId)); }
  }
  const wire = o => { const w = {opId: o.opId, kind: o.kind, id: o.id, base: o.base, set: o.set || {}}; if (o.del) w.del = true; return w; };

  async function api(path, {method = 'GET', body, token = cfg.token} = {}) {
    const h = {};
    if (body !== undefined) h['content-type'] = 'application/json';
    if (token) h.authorization = 'Bearer ' + token;
    const r = await fetch(apiURL(path), {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit'});
    const text = await r.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch (e) { const er = new Error('Not a JSON reply (captive Wi-Fi?)'); er.nonJson = true; er.status = r.status; throw er; } }
    return {status: r.status, ok: r.ok, json};
  }
  async function httpSync() {
    if (httpBusy || stopped || !cfg.token) return;
    httpBusy = true;
    try {
      for (let round = 0; round < 20; round++) {
        const before = st.outbox.length, ops = st.outbox.slice(0, BATCH);
        ops.forEach(o => inflight.add(o.opId));
        let r;
        try { r = await api('sync', {method: 'POST', body: {since: st.cursor, ops: ops.map(wire)}}); }
        finally { ops.forEach(o => inflight.delete(o.opId)); }
        if (r.status === 401 || r.status === 403) { signedOut(); return; }
        if (!r.ok || !r.json) { fail(); return; }
        lastMore = false;
        handleHttp(r.json);
        ok();
        if (lastMore) continue;                                         // another changes page waiting
        if (!st.outbox.length || st.outbox.length >= before) break;   // done, or no progress: retry later
      }
      later(BACKOFF[Math.min(wsMiss, BACKOFF.length - 1)]);   // keep trying the live socket in the background
    } catch (e) { fail(); }
    finally { httpBusy = false; }
  }
  function handleHttp(j) {
    if (Array.isArray(j)) return j.forEach(handle);
    if (Array.isArray(j.messages)) return j.messages.forEach(handle);
    (j.acks || []).forEach(a => handle({t: 'ack', ...a}));
    (j.rejects || []).forEach(a => handle({t: 'reject', ...a}));
    if (j.docs || j.changes || j.cursor != null) {
      const c = j.changes && !Array.isArray(j.changes) ? j.changes : {docs: j.changes || j.docs || [], cursor: j.cursor};
      handle({t: 'changes', docs: c.docs || [], cursor: c.cursor != null ? c.cursor : j.cursor});
    }
  }
  async function checkRevoked() {
    try { const r = await api('me'); if (r.status === 401 || r.status === 403) signedOut(); else later(BACKOFF[0]); } catch (e) { fail(); }
  }
  function signedOut() {
    if (stopped) return;
    stop();
    A && A.onSignedOut && A.onSignedOut();
  }
  function stop() { stopped = true; clearTimeout(retryT); if (ws) { try { ws.close(); } catch (e) {} } ws = null; wsUp = false; }

  /* demo mode: no server; every op is "acked" locally so the doc set still persists */
  function drainLocal() {
    while (st.outbox.length) { const o = st.outbox[0]; ack({opId: o.opId, version: ++lastLocalVer}); }
    st.cursor = lastLocalVer; save();
  }

  /* ---------- "sync in danger" (T5a): the only visible sync state ---------- */
  function danger() {
    if (cfg.demo || !st.outbox.length) return null;
    const oldest = Math.min(...st.outbox.map(o => o.t || Date.now()));
    const stale = Date.now() - oldest > DAY && st.fails >= 5;
    const refused = persistRefused && Date.now() - oldest > (/iPad|iPhone|iPod/.test(navigator.userAgent) ? 30e3 : 864e5); // eviction is a real risk on iOS; elsewhere only flag after a day
    if (!stale && !refused) return null;
    const exp = new Set(st.outbox.filter(o => o.kind === 'expense' && !o.del).map(o => o.id)).size;
    const n = exp || new Set(st.outbox.map(o => o.kind + ':' + o.id)).size;
    return {n, what: exp ? (n === 1 ? 'expense' : 'expenses') : (n === 1 ? 'change' : 'changes'), refused: refused && !stale};
  }
  function refreshDanger() {
    const d = danger(), k = d ? d.n + d.what : '';
    if (k !== dangerKey) { dangerKey = k; A && A.render && A.render(); }
  }

  /* ---------- lifecycle ---------- */
  async function init(opts) {
    cfg = {...cfg, ...opts};
    A = opts.adapter;
    const saved = await DB.get(cfg.key);
    st = saved && saved.v === 1 ? {...fresh(), ...saved} : fresh();
    if (cfg.demo) lastLocalVer = +st.cursor || 0;
    rebuild();
    // hand the app its starting data (shadow = what the server has + what's still queued)
    for (const kind of KINDS) for (const id in (sh[kind] || {})) A.apply(kind, id, clone(sh[kind][id]));
    started = true; stopped = false;
    try {
      if (navigator.storage && navigator.storage.persist) {
        const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        if (!already) persistRefused = !(await navigator.storage.persist());
      }
    } catch (e) {}
    if (!cfg.demo) {
      addEventListener('online', () => kick());
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
      addEventListener('pageshow', () => kick());
      addEventListener('focus', () => kick());
      setInterval(refreshDanger, 60e3);
      kick();
    } else if (!st.synced) { st.synced = true; save(); A.onFirstSync && A.onFirstSync(); }
    return {synced: st.synced};
  }
  async function wipe() { stop(); st = fresh(); sh = {}; deferred = []; await DB.del(cfg.key); }

  return {
    init, schedule, flush, kick, wipe, stop, api, danger, rid,
    tryNow() { if (ws && wsUp && ws.readyState === 1) { inflight.clear(); sendOps(true); } else kick(); },
    get outboxSize() { return st.outbox.length; },
    get synced() { return st.synced; },
    get persistRefused() { return persistRefused; },
    _state: () => st, _shadow: () => sh, _drop: () => { if (ws) ws.close(); }, DB,
    get token() { return cfg.token; }, get demo() { return cfg.demo; }, url: p => apiURL(p),
    get started() { return started && !stopped; }
  };
})();

/* ---------- Image attachments: blob outbox + local image cache (TECH-DESIGN T15) ----------
   Loaded at boot (rows need thumbnails, queued uploads must retry); the heavy compression lives in attach.js.
   - IndexedDB 'halves-att', separate from the doc store: 'out' = blobs waiting to upload (key "<id>/<kind>"),
     'img' = every image this phone has (own uploads + fetched ones). Ids are write-once, so cached copies are
     kept for good: a repeat view never costs an R2 read, and viewing works offline.
   - Uploads: PUT /api/att/<id>?kind=thumb|full (thumb first, so the partner's rows fill in sooner).
     Retries follow T5a (after each attach, online, foreground, backoff 5s → 30s → 2m → 15m). Network / 5xx stay
     silent (only the "sync in danger" rule surfaces them). A definite refusal (storage_full, too_large, bad_type,
     daily_cap, auth) parks the item as failed and calls onFail(id, reason) once, so the app can ask the user.
   - Downloads: fetch with the Authorization header → blob → object URL. 404 (partner's phone hasn't uploaded yet)
     and read_quota are remembered for 30 s and never cached. */
const HalvesAtt = (() => {
  const BACKOFF = [5e3, 30e3, 120e3, 900e3];
  const PERMANENT = {400: 'bad_image', 413: 'too_large', 415: 'bad_type', 507: 'storage_full'};
  let dbp = null, busy = false, retryT = 0, fails = 0, failSince = 0, inited = false;
  const urls = new Map(), miss = new Map(), loading = new Map();
  let onFail = null, onChange = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    if (!self.indexedDB) return rej(new Error('no idb'));
    const r = indexedDB.open('halves-att', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('out'); r.result.createObjectStore('img'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), os = t.objectStore(store);
      let out; const q = fn(os);
      if (q) q.onsuccess = () => { out = q.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  };
  const k = (id, kind) => id + '/' + kind;
  const getRec = (store, key) => tx(store, 'readonly', os => os.get(key)).catch(() => undefined);
  const putRec = (store, key, v) => tx(store, 'readwrite', os => os.put(v, key));
  const delRec = (store, key) => tx(store, 'readwrite', os => os.delete(key)).catch(() => {});
  const allOut = () => tx('out', 'readonly', os => os.getAll()).catch(() => []);

  /** Queue a compressed image: {full:{blob,type}, thumb:{blob,type}}. The blobs are viewable at once. */
  async function queue(id, img) {
    const t = Date.now();
    for (const kind of ['thumb', 'full']) {
      const p = img[kind]; if (!p) continue;
      await putRec('out', k(id, kind), {id, kind, type: p.type || p.blob.type, blob: p.blob, t, tries: 0, failed: null});
      if (!urls.has(k(id, kind))) urls.set(k(id, kind), URL.createObjectURL(p.blob));
    }
    kick();
  }
  async function drain() {
    if (busy || !HalvesSync.started || HalvesSync.demo || !HalvesSync.token) {
      if (HalvesSync.demo) for (const r of await allOut()) { await putRec('img', k(r.id, r.kind), {blob: r.blob, at: Date.now()}); await delRec('out', k(r.id, r.kind)); }
      return;
    }
    busy = true; clearTimeout(retryT);
    try {
      const list = (await allOut()).filter(r => !r.failed).sort((a, b) => (a.kind === 'thumb' ? 0 : 1) - (b.kind === 'thumb' ? 0 : 1) || a.t - b.t);
      for (const r of list) {
        let res;
        try {
          res = await fetch(HalvesSync.url('att/' + encodeURIComponent(r.id) + '?kind=' + r.kind), {
            method: 'PUT', body: r.blob, cache: 'no-store', credentials: 'omit',
            headers: {'content-type': r.type, authorization: 'Bearer ' + HalvesSync.token}});
        } catch (e) { return transient(); }
        let j = null; try { j = await res.json(); } catch (e) { return transient(); }   // captive Wi-Fi: not our JSON
        if (res.ok) {
          await putRec('img', k(r.id, r.kind), {blob: r.blob, at: Date.now()});
          await delRec('out', k(r.id, r.kind));
          continue;
        }
        const code = (j && j.error) || '';
        const reason = PERMANENT[res.status] || (res.status === 429 && code === 'daily_cap' ? 'daily_cap' : res.status === 401 || (res.status === 403 && code !== 'bad_origin') ? 'auth' : null);
        if (!reason) return transient();
        await park(r, reason);
      }
      fails = 0; failSince = 0;
    } finally { busy = false; }
  }
  /** A definite refusal: stop retrying this image (both sizes) and tell the app once. */
  async function park(r, reason) {
    for (const kind of ['thumb', 'full']) {
      const x = await getRec('out', k(r.id, kind));
      if (x && !x.failed) { x.failed = reason; await putRec('out', k(r.id, kind), x); }
    }
    onFail && onFail(r.id, reason);
    onChange && onChange();
  }
  function transient() {
    fails++; if (!failSince) failSince = Date.now();
    clearTimeout(retryT); retryT = setTimeout(kick, BACKOFF[Math.min(fails - 1, BACKOFF.length - 1)]);
  }
  function kick() { drain().catch(() => transient()); }
  /** User pressed Retry: un-park the image and try now. */
  async function retry(id) {
    for (const kind of ['thumb', 'full']) { const x = await getRec('out', k(id, kind)); if (x) { x.failed = null; x.tries = 0; await putRec('out', k(id, kind), x); } }
    fails = 0; kick();
  }
  /** User removed the image before it uploaded: nothing left to send. (Uploaded objects stay: soft delete.) */
  async function discard(id) { for (const kind of ['thumb', 'full']) await delRec('out', k(id, kind)); onChange && onChange(); }
  /** {id: reason} for parked uploads, and the ids still waiting. */
  async function status() {
    const out = await allOut(), failed = {}, waiting = new Set();
    for (const r of out) { if (r.failed) failed[r.id] = r.failed; else waiting.add(r.id); }
    return {failed, waiting: [...waiting], oldest: out.length ? Math.min(...out.map(r => r.t)) : 0, fails};
  }
  /** T5a danger rule for images: oldest unsent > 24 h and ≥ 5 failed attempts. */
  async function danger() {
    if (HalvesSync.demo) return 0;
    const s = await status();
    return s.waiting.length && Date.now() - s.oldest > 864e5 && fails >= 5 ? s.waiting.length : 0;
  }

  /** Object URL for an image, or null if not available (yet). Cache → outbox → network (then cached for good). */
  function url(id, kind) {
    const key = k(id, kind);
    if (urls.has(key)) return Promise.resolve(urls.get(key));
    if (loading.has(key)) return loading.get(key);
    const m = miss.get(key); if (m && Date.now() - m < 30e3) return Promise.resolve(null);
    const p = (async () => {
      const hit = (await getRec('img', key)) || (await getRec('out', key));
      let blob = hit && hit.blob;
      if (!blob && HalvesSync.token && !HalvesSync.demo && navigator.onLine !== false) {
        try {
          const r = await fetch(HalvesSync.url('att/' + encodeURIComponent(id) + '?kind=' + kind), {headers: {authorization: 'Bearer ' + HalvesSync.token}, credentials: 'omit'});
          if (r.ok && /^image\//.test(r.headers.get('content-type') || '')) { blob = await r.blob(); putRec('img', key, {blob, at: Date.now()}).catch(() => {}); }
        } catch (e) {}
      }
      if (!blob) { miss.set(key, Date.now()); return null; }
      const u = URL.createObjectURL(blob); urls.set(key, u); return u;
    })().finally(() => loading.delete(key));
    loading.set(key, p);
    return p;
  }
  /** Full-size URLs are big: let the viewer release them. */
  function release(id, kind) { const key = k(id, kind), u = urls.get(key); if (u) { URL.revokeObjectURL(u); urls.delete(key); } }

  function init(o = {}) {
    onFail = o.onFail || onFail; onChange = o.onChange || onChange;
    if (inited) return kick(); inited = true;
    addEventListener('online', kick);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
    addEventListener('pageshow', kick); addEventListener('focus', kick);
    kick();
  }
  async function wipe() {
    for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); miss.clear();
    try { const db = await open(); db.close(); } catch (e) {}
    dbp = null;
    await new Promise(res => { try { const r = indexedDB.deleteDatabase('halves-att'); r.onsuccess = r.onerror = r.onblocked = res; } catch (e) { res(); } });
  }
  return {init, queue, kick, retry, discard, status, danger, url, release, wipe};
})();
