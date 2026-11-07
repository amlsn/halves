# Halves — technical review (options + recommendations)

> Goal: run on the **Cloudflare Workers Free plan**, in the same account and zone (`amlansahoo.com`) as the sibling projects, for exactly 2 users. This doc picks how the client ships and how the backend is shaped.
> Sibling patterns reused:
> - `../../portfolio-website/wrangler.jsonc`: an assets-only Worker on zone route `amlansahoo.com/*`.
> - `../../game-portfolio-queued-pocket-tanks-pvpvp-coop-w-phone-as-controller/server/`: Worker + SQLite Durable Object + WebSocket Hibernation, served under a path prefix with `run_worker_first`. Its README has a free-plan budget table; copy that approach.
>
> Related: [DESIGN.md](DESIGN.md) · [REVIEW-LOG.md](REVIEW-LOG.md)

## 0. Free-plan limits that matter
Verified 2026-11-06 for the DO and D1 rows. Re-check before implementing.

| Resource | Free allowance | Our expected use (2 people, ~20 ops/day) |
|---|---|---|
| Workers requests | 100k/day, 10 ms CPU per request | <1k/day |
| DO requests | 100k/day (incoming WS messages billed 20:1) | <1k/day |
| DO duration | 13,000 GB-s/day | ≈0 with Hibernation (see §6 cost rule) |
| DO SQLite **rows written** | **100k/day** (the limit that binds) | ~20 ops × (entity row + ops row + index entries ≈ 5) ≈ 100/day |
| DO SQLite rows read | 5M/day | small. Catch-up is paged (§4). |
| DO storage | 5 GB total | MBs |
| DO PITR | 30-day history on SQLite DOs. **Unclear on Free, and not available in local dev.** | Don't rely on it; do our own export (§6). |
| D1 (if used) | 5M reads / 100k writes per day, 5 GB, Time Travel 7 days | — |
| R2 | 10 GB, 1M Class A/month. **May need a payment method on file to enable.** Confirm first. | backups + receipts (F5) |
| Cron Triggers | only a few per account on Free | 0 needed. Use a DO alarm instead. |

Sources: developers.cloudflare.com/durable-objects/platform/pricing/ · /durable-objects/api/sqlite-storage-api/ · /d1/platform/limits/

## 1. Client delivery options
| Option | What it is | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. PWA at `amlansahoo.com/halves/`** | Static SPA + manifest + service worker; "Add to Home Screen" | One codebase, nothing to submit to a store, deploys like queued-tanks, works offline through the SW, iOS 16.4+ web push for installed PWAs | **No Vibration API on iOS Safari** (so the dial needs a visual/audio tick). iOS evicts storage: call `navigator.storage.persist()` and keep the server as source of truth. | ✅ **v1** |
| B. TWA (Bubblewrap) APK | Android wrapper around the same PWA | Real APK, free sideload | Android only; needs Digital Asset Links | Later |
| C. Capacitor | Native shell around the same build | Native haptics (fixes iOS dial ticks), widgets | iOS needs a $99/yr dev account or re-signing every 7 days | Only if iOS haptics matter |
| D. Native | Swift/Kotlin | — | 2× the work for 2 users | ❌ |

Frontend: **Svelte 5 + Vite** (small runtime, built-in `spring`/`tweened` matches the expressive motion). Alternatives are Preact + Motion, or vanilla TS (the prototype is vanilla, which is fine at prototype scale). Astro, which the portfolio uses, is not a fit for an app-like SPA.
Routing: **hash routing** (`/halves/#/f/<id>`). That avoids the SPA-fallback-under-a-prefix problem (§6), and the SW precaches one shell.

## 2. Backend options (all on Workers Free)
| Option | Pros | Cons |
|---|---|---|
| **B1. Worker + ONE SQLite Durable Object per pair** (`getByName('pair-<id>')`) | Single writer, so no write races between 2 people. **Live push for free** (WS Hibernation, F3). Already proven on this account by queued-tanks. | DIY export/backup, schema migrations, and an ad-hoc SQL debug endpoint |
| B2. Worker + D1 | `wrangler d1 execute`, Time Travel | No push (needs polling, or a DO anyway). Two moving parts. |
| B3. Worker + KV | — | Eventually consistent and a low write quota. ❌ for a ledger. |

**Recommendation: B1.**

## 3. Data model (inside the DO's SQLite)
Users are fixed slots **A** and **B** (`A` = owner). No viewer-relative fields: the UI computes "you/partner".
```sql
meta(key TEXT PK, value)                        -- schema_version, pair config, base currency, tz (IANA, e.g. Asia/Kolkata)
folders(id TEXT PK, parent_id TEXT NULL, name, icon, shape, tone,
        default_share_a_bp INT NULL,           -- A's share, basis points 0..10000; NULL = inherit
        currency TEXT NULL,                    -- NULL = inherit (F10)
        pinned INT, archived INT, sort REAL,
        version INT NOT NULL, created_at, updated_at, deleted_at)
expenses(id TEXT PK, folder_id, title, category_id, spent_on DATE, note,
         currency TEXT, amount_minor INT,      -- minor units per currency exponent (INR 2, JPY 0, KWD 3)
         fx_rate_e9 INT NULL, base_amount_minor INT NULL,   -- F10: converted to pair base currency
         version INT NOT NULL, created_by, created_at, updated_at, deleted_at)
expense_payers(expense_id, user CHECK(user IN ('A','B')), paid_minor INT, PRIMARY KEY(expense_id,user))  -- F6; Σ paid_minor = amount_minor
expense_shares(expense_id, user CHECK(user IN ('A','B')), share_bp INT, PRIMARY KEY(expense_id,user))    -- Σ share_bp = 10000
-- both invariants enforced by the DO in the same transaction as the expense write
settlements(id, from_user, to_user, currency, amount_minor, method, folder_id NULL, spent_on, version, created_by, ..., deleted_at)
categories(id, name, icon, tone, sort, version, deleted_at)
ops(seq INTEGER PK AUTOINCREMENT, client_op_id TEXT UNIQUE, user, op_v INT, kind, entity_id, base_version INT,
    fields JSON,                               -- list of fields this op changed (needed for field-level merge)
    payload JSON, result JSON, at)
```
- **Rounding rule:** `owed_by_B = floor(amount_minor * share_b_bp / 10000)`. A gets the remainder, so the total is always exact. One payer per expense is the v1 fast path (`expense_payers` has one row).
- Balances are **summed per currency**, plus a converted total when `base_amount_minor` exists. FX: `base_amount_minor = round_half_even(amount_minor × fx_rate_e9 × 10^(exp_base − exp_src) / 1e9)`, computed once at write time and stored, never recomputed.
- **Dates/months:** `spent_on` is a local calendar date in the pair's `meta.tz`. "This month", month folders and recurring (F4) all use that tz, never UTC.
- **Subtree query** (cycle-safe and depth-capped):
  ```sql
  WITH RECURSIVE sub(id, d) AS (
    SELECT id, 0 FROM folders WHERE id = ?1 AND deleted_at IS NULL
    UNION
    SELECT f.id, d+1 FROM folders f JOIN sub ON f.parent_id = sub.id
    WHERE f.deleted_at IS NULL AND d < 32)
  SELECT ... WHERE e.folder_id IN (SELECT DISTINCT id FROM sub)   -- (id,d) rows aren't deduped by UNION
  ```
- **Folder move:** the DO walks the ancestors of the target and rejects the move if the folder would end up inside itself.
- Soft delete (`deleted_at`) is what undo and sync tombstones use.

## 4. Sync & offline (F2/F3)
- **Client:** IndexedDB mirror (versioned schema) plus an **outbox** of ops. Each op is `{client_op_id: uuid, op_v, kind, payload, base_version}`.
- **Server:** the DO applies each op inside `ctx.storage.transactionSync()`.
  - **Versioned rows, not client clocks:** every row carries a server `version`. If an op's `base_version` doesn't match, the DO reads the `ops.fields` of every op on that entity since `base_version`. If they don't overlap the incoming op's fields, it field-merges. If they overlap, or those ops have already been trimmed, the op is **rejected** with the current row.
  - The DO bumps `version`, appends to `ops` (storing `result`), and broadcasts `{seq, op, result}`.
  - A retry with a known `client_op_id` gets back the stored `result`, so ops are idempotent.
- **Rejected ops** (move cycle, edit on a deleted row, version conflict): roll back the optimistic row and show "Sam changed this. Here's their version." with a button to re-apply yours.
- **Catch-up:** `GET /api/ops?since=<seq>`, paged (≤500 rows per page to fit the 10 ms CPU limit). `ops` is **trimmed** to keep *whichever retains more*: the last 90 days or the last 5k entries. A retry older than the trim point can't be deduped by `client_op_id`, so it falls back to PK/version conflict, and creates use client UUIDs so a replay collides rather than duplicating. If `since` is older than the trim point, the server returns a **paged snapshot** instead.
- **Old clients:** `op_v` is versioned. The DO keeps upgraders for `op_v` N-1. Anything older gets `426` "update app", which triggers a SW update.
- Transport is the same as queued-tanks: WebSocket first, then a polling fallback with backoff.

## 5. Auth for exactly two people
| Option | Pros | Cons |
|---|---|---|
| A1. Cloudflare Access (Zero Trust free tier) on `/halves*` | No auth code to write | **Bad fit for an installed PWA.** The iOS standalone login redirect bounces out to Safari. Once the session expires, SW and outbox `fetch` calls get a 302 to `*.cloudflareaccess.com`, which looks like an opaque/CORS failure, so **sync breaks silently**. The manifest would also need `crossorigin="use-credentials"`. |
| **A2. Pairing QR + device token** | Smooth inside the PWA; no third party involved | We own the security (hardening below) |
| A3. Passkeys | Best UX | Most code. Possible later upgrade path from A2. |

**Recommendation: A2 for the app, with A1 only on `/halves/admin/*`** (bootstrap, pairing-code minting, export download).
A2 hardening:
- Pairing codes are single-use, have a 10-minute TTL, and are stored **hashed**.
- Device tokens are 256-bit random, stored hashed, and revocable from Settings → Devices.
- The token is sent in the `Authorization` header for HTTP. On WebSocket it goes in the **first message** (never in the query string, which ends up in logs). Sockets not authenticated **within 5 s are closed**, using a DO alarm, not `setTimeout`.
- `/halves/admin/*`: Access at the edge **and** the Worker verifies `Cf-Access-Jwt-Assertion` (RS256 against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, `aud` = app AUD tag). That's defence in depth, since the Worker runs first on that path.
- **Check the `Origin` header** on the WS upgrade and on every write. This blocks cross-site WebSocket hijacking (CSWSH) and CSRF.
- Rate-limit `/pair/*` and `/redeem` with the Workers Rate Limiting binding (confirm it's on Free; fallback is a counter in the DO).

## 6. Deployment, ops & cost rules
```jsonc
// wrangler.jsonc (sketch, mirrors queued-tanks)
{ "name": "halves", "main": "src/worker.ts", "compatibility_date": "2026-10-01",
  "assets": { "directory": "./public", "binding": "ASSETS", "run_worker_first": ["/halves/api/*", "/halves/admin/*"] },
  "vars": { "BASE": "/halves" },
  "routes": [{ "pattern": "amlansahoo.com/halves*", "zone_name": "amlansahoo.com" }],
  "durable_objects": { "bindings": [{ "name": "PAIR", "class_name": "Pair" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Pair"] }],
  "workers_dev": false, "preview_urls": false, "observability": { "enabled": true } }
```
- The SPA sits at `public/halves/`. The Worker redirects `/halves` → `/halves/`. The more specific route `/halves*` beats the portfolio's `/*`. After each deploy, check that `/`, `/queued-tanks/` and `/halves/` all return 200.
- **Service worker:** scope `/halves/`, precache the shell, and **never cache `/halves/api/*`**. Also request `navigator.storage.persist()`.
- **DO schema migrations:** wrangler `migrations` only register classes. Tables are migrated by code:
  - In the constructor, call `ctx.blockConcurrencyWhile()`, read `meta.schema_version`, and run the ordered migration steps inside `transactionSync`. (`sql.exec` rejects `BEGIN`.)
  - Each step must be idempotent and forward-only.
- **DO duration cost rule:**
  - Use only the Hibernation API (`ctx.acceptWebSocket`), with `setWebSocketAutoResponse` for ping/pong.
  - No `setTimeout`/`setInterval` in the DO. Use `ctx.storage.setAlarm()`.
  - Don't leave I/O pending; it can keep a DO billed for up to about 15 minutes.
- **Backups must live off the DO** (a table inside the same DO shares its failure domain). Primary: a nightly **DO alarm** exports a chunked JSON snapshot to **R2**. If R2 can't be enabled on Free, use a **D1** database as a separate store, plus a manual/scheduled `/halves/admin/export` download to a laptop or phone. The same exporter produces CSV (F11). Run a restore drill once before go-live.
- **Observability:** Workers logs on. The DO logs rejected ops and migration runs.
- **Web push (F13)** needs VAPID and aes128gcm payload encryption written by hand in Workers. That's real work, so it's scoped separately.

## 7. Risks / spikes before implementation
1. Dial on iOS: no Vibration API. WebAudio click is the turn feedback (unlocked on the first tap). The `<input switch>` haptic trick probably only fires from real gestures (tap/commit), not `pointermove`, so assume **no haptics while turning** until a device test proves otherwise. Also check pointer-capture smoothness in Safari, and that the pie-menu item at 150° clears the home indicator on 667px phones.
2. Clip-path polygon morph performance on low-end Android (96 vertices). Fallback: 48 vertices, or no morph on `(update: slow)` / low `deviceMemory`.
3. View Transitions: same-document transitions are in Safari 18.0+ and Chrome (prototype falls back gracefully). Cross-document transitions are Safari 18.2+ and unused here.
4. Verify that R2 and the Rate Limiting binding can be enabled on Free for this account.

## 9. V2 delta: notifications & budgets
**Nudges: what each platform can actually do** (re-verify when implementing)
| Capability | PWA (iOS 16.4+ home screen) | PWA (Android Chrome) | Capacitor/native Android | Capacitor/native iOS |
|---|---|---|---|---|
| Scheduled reminder push | ✅ via Web Push from a DO alarm (needs VAPID + encryption, see §6) | ✅ | ✅ local notifications, no server needed | ✅ local notifications |
| Action buttons (Snooze / Log now) | ❌ Safari ignores `actions`, so snooze happens in the app | ✅ | ✅ | ✅ |
| Breaks through Focus/DND | ❌ | ❌ | ✅ a high-importance channel, if the user allows it | ✅ **Time Sensitive** interruption level (the user can silence it per Focus) |
| Full-screen takeover | ❌ | ❌ | ⚠️ full-screen intent is restricted to alarm/call apps on Android 14+ | ❌ (Critical Alerts need an Apple entitlement that's not realistic here) |
| Discreet content | ✅ (we control the text) | ✅ | ✅ plus lock-screen visibility = private | ✅ plus hidden previews |

**Implication:** the "can't ignore, can silence, discreet" nudge is best served by **option C (Capacitor)**:
- Android: a high-importance channel.
- iOS: Time Sensitive notifications.
- Both: local scheduling plus Snooze actions.

The PWA gets standard pushes, with snooze inside the app. V2 prototypes the nudge UI in the browser (in-app banner and full-screen "interstitial"), and the platform choice gets revisited in V3.

**Budgets/tags data delta (sketch):**
- New tables: `tags(id, name, tone, ...)` and `expense_tags(expense_id, tag_id, PK)`.
- `limits(id, target_kind CHECK IN ('overall','folder','category','tag'), target_id, period CHECK IN ('month','week','lifetime'), amount_minor, currency, starts_on, version, deleted_at)`.
- "Left" is computed per period in the pair's `meta.tz`.
- The daily target = (target − spent) ÷ days left in the period (V2-Q3).
- `meta.mode` ∈ simple|detailed. Simple mode ignores `category_id` in the UI and only uses `overall`/`folder` limits.
- Reminder schedule: `reminders(user, time_local, days_mask, snooze_until)`, held in a DO, which fires them via an alarm (PWA push) or mirrors them to the device (native local notifications).

## 8. Changelog
- 2026-11-06 v0: options + recommendations.
- 2026-11-06 v1.1 (review round 2, FAVORABLE 8/9/8/8):
  - Backup moved off the DO (R2, or else D1 plus a download).
  - CTE dedupe + anchor check.
  - `ops.fields` for field merge (reject once trimmed).
  - Worker verifies the Access JWT on admin paths.
  - Payer/share PKs + sum invariants, FX rounding rule.
  - Trim rule wording, WS auth timeout of 5 s, pair time zone.
- 2026-11-06 v1 (review round 1):
  - Added a verified limits table.
  - Sync now uses server row versions instead of client-clock LWW, plus rejected-op rollback, ops trimming and paged snapshots, and op versioning.
  - Data model uses A/B user slots, payers/shares tables, basis points everywhere, a rounding rule, per-currency balances, and a cycle-safe CTE.
  - Added a DO migration plan.
  - Auth flipped to pairing QR (Access only on admin), with Origin checks and rate limits.
  - Added the SW/API cache rule, hash routing, the DO cost rule, and alarm-based backups.
