# Halves: technical design (draft for your review)

> Status: **draft v1 (2026-11-07)**. The user's decisions are folded in (see "Decisions"). Nothing is built yet.
>
> This doc turns the options picked in [TECH-REVIEW.md](TECH-REVIEW.md) into buildable parts. Read TECH-REVIEW for the *why we picked X over Y*, and this doc for the *what we build and in what order*.
>
> Product spec: [DESIGN.md](DESIGN.md) (§9.9 priorities: quick logging first, then folder/target setup, then Trends).
>
> To review: comment inline, or list numbers like "T4: unclear". Each part ends with **❓ for you** where a decision is yours.

---

## T0. The big picture in one screen

```
 Your Android phone ─┐                         ┌───────── Cloudflare (free plan) ─────────┐
 Partner's iPhone  ──┼── https://amlansahoo.com/halves/ ──►  Worker (TypeScript)          │
 Any laptop browser ─┘        (one web app, installed       │  • serves the app files      │
                               to home screen = full-       │  • checks who you are        │
                               screen, no browser bars)     │  • forwards to ▼             │
                                                            │  Durable Object "pair"       │
   app keeps its own copy of the data on the phone          │  • one tiny SQLite database  │
   (works offline, syncs when online, live updates)  ◄─WS─► │    holding both people's data│
                                                            │  • pushes changes live       │
                                                            │  • nightly backup ──► R2/D1  │
                                                            └──────────────────────────────┘
```

**Answers to your questions:**

| Question | Answer |
|---|---|
| **Rust for speed?** | **No.** Cloudflare Workers run JavaScript/TypeScript natively, and that is the fast path. Rust only runs there compiled to WebAssembly, which means a bigger bundle, slower cold starts and harder debugging. For 2 people and about 20 writes a day, the server work per request is roughly a millisecond either way. Speed you can *feel* comes from the app answering instantly from its own on-phone copy (T5), not from the server language. **TypeScript everywhere**, so the client and server share one set of types and one money/split maths module (T3). |
| **Android app + iOS app?** | **Not at first. Ship one web app (a PWA).** "Add to Home Screen" gives it its own icon and full screen, with no browser bars, on both Android and iPhone. Desktop is the same URL in a browser, or "Install app" in Chrome/Edge. |
| **iOS App Store / licence / sideloading?** | A real iOS app on your partner's iPhone needs either:<br>(a) the **Apple Developer Program at $99/yr** (TestFlight or ad-hoc install), or<br>(b) a free Apple ID, where Xcode installs onto a phone **plugged into a Mac**, and it **expires every 7 days**.<br>Neither is worth it now. The PWA route needs **no licence, no store, no Mac**. Your partner opens the link in Safari → Share → Add to Home Screen. |
| **What does the PWA lose on iPhone?** | No vibration (the dial clicks with sound plus visuals instead). Notifications only once the app is installed to the Home Screen (iOS 16.4+), with no Snooze button inside the notification. No "breaks through Focus" alerts. Everything else in the prototype works. |
| **Can we go native later?** | Yes, cheaply. **Capacitor** wraps the *same* web build into an APK (free to sideload) and an iOS app (needs the $99). That's only worth doing if stronger reminders or real haptics turn out to matter (T13). |

---

## T1. Repo & tooling
- **One repo, three packages** (pnpm workspaces):
  - `app/`: the web client.
  - `worker/`: the Worker and the Durable Object.
  - `shared/`: types, money maths and the sync protocol. Both sides import it, so they can never disagree.
- TypeScript strict, Vitest for tests, Biome or ESLint+Prettier for lint, and `wrangler` for local dev and deploy. The `prototype-v*/` folders stay as frozen references.
- Local dev: `pnpm dev` runs Vite (app) and `wrangler dev` (Worker + DO + local SQLite) together. Phone testing works over the LAN like now, with no tunnels.
- ✅ It's a git repo now (`main`), with the repo-local identity `Amlan Sahoo <amlan.sahoo.98@gmail.com>`, the same as `personal-website`. Remote: `git@github.com:amlsn/halves.git` (private; the GitHub account was renamed from omlin to amlsn).

## T2. Client app shell
- **Svelte 5 + Vite.** The user's criterion is *the lightest and fastest at runtime*; the UI is mostly AI-built.
  - Svelte compiles to plain DOM updates, with no virtual DOM and a runtime of roughly 10 KB. React + ReactDOM is roughly 45 KB gzipped and does more work per update.
  - Solid is comparably fast but has a smaller ecosystem. Preact is light but still uses a virtual DOM.
  - Svelte's built-in `spring`/`tweened` suit the bouncy motion.
  - The prototype's vanilla JS ports over piece by piece.
- **Hash routing** (`/halves/#/f/<folderId>`). This avoids server-routing problems under the `/halves/` sub-path.
- **PWA bits:**
  - `manifest.webmanifest`: name, icons, `display: standalone`, theme colour per skin.
  - A **service worker** that caches the app shell so the app opens offline. It **never caches API calls.**
- Screens map to the prototype: Home (folders + list), Add sheet, Trends page, Settings, To-sort queue, plus Pairing and Devices (new, T7).
- ✅ Decided: Svelte 5 (2026-11-07).

## T3. Shared domain logic (`shared/`): the maths, pure and heavily tested
- **Money:**
  - Integers in minor units (₹12.50 → `1250`), never floats.
  - Currency per expense, with an FX rate stored when it differs from the pair's base currency (later feature).
- **Splits:**
  - One-sided by default (DESIGN §9.2b). Opt-in split in basis points (60/40 → `6000/4000`), or *Decide later* (pending).
  - Rounding rule: the leftover paisa goes to the payer.
- **Balances:** who owes whom, derived from payers and shares. This is the secondary layer (DESIGN positioning).
- **Targets & limits:**
  - Overall target (Simple mode) and folder targets.
  - Category and tag limits (Detailed mode).
  - Periods are month, week or lifetime, computed in the pair's time zone.
  - Daily target = (target − spent) ÷ days left.
- **Trends:** daily totals, on-track status ("on track / tight / over" as words, not just colour) and drill-down sums.
- Everything here is plain functions with no I/O. It runs identically in the browser (for instant UI) and in the DO (for validation).

## T4. Data model (server: SQLite inside the Durable Object)
This is already reviewed in TECH-REVIEW §3 and §9. In short:
- `meta`: schema version, base currency, time zone, mode (simple/detailed).
- `folders`: a tree via `parent_id` (2026 › Nov).
- `expenses`: amount, title, date, folder, `created_by` (A/B), `needs_review` flag, `split_state` (one-sided / split / later).
- `payers` and `shares` per expense.
- `tags` and `expense_tags`.
- `limits`: overall, folder, category or tag, plus a period.
- `reminders`.
- `devices`: hashed tokens.
- `ops`: a recent change log, used for sync.
- Every row has a `version` (server counter) and soft delete (`deleted_at`), which makes Undo and sync simple.
- The two people are fixed slots **A** and **B**. The UI turns them into "You" and the partner's name.

## T5. Local-first store on the device (why the app feels instant)
- The app keeps a full copy of the pair's data in **IndexedDB** on the phone. That's tiny: years of expenses are a few MB.
- **Every tap writes locally first** and the UI updates at once (grab-and-go stays at ~3 s even on bad network). The change also goes into an **outbox** queue.
- The outbox drains to the server whenever it's online (T6). If the server rejects a change (rare, e.g. a folder was deleted), the app rolls that change back and shows a snackbar.
- Ask the browser for persistent storage (`navigator.storage.persist()`) so iOS doesn't evict it. The server is still the source of truth, so a wiped phone just re-downloads.

### T5a. Bad or no internet: sync stays invisible (user input 2026-11-07)
- **Default: nothing to watch.** There's no sync icon, spinner or "synced" badge. Logging always succeeds instantly on the phone (T5).
- **When it retries** (this replaces a fixed 20–30 min timer, which is too slow when the network comes back and pointless when it hasn't):
  - immediately after each log
  - when the phone reports it's back online (`online` event)
  - when the app is reopened or comes to the foreground
  - otherwise with backoff while the app is open: 5 s → 30 s → 2 min → then every 15 min
- **Platform limit:**
  - A web app **can't retry while it's closed on iPhone**. iOS gives PWAs no background sync, so the retry happens on the next open.
  - Android Chrome can retry once after connectivity returns (Background Sync API), as a bonus.
  - Either way nothing is lost: the data waits safely in the outbox.
- **Slow internet is fine.** An expense is under 1 KB, so even 2G gets it through. What actually breaks sync is *no* connection, captive Wi-Fi (hotel or airport login pages), or the server rejecting a change.
- **"Sync in danger": the only time the user sees anything.** It's one quiet line on Home, in the existing nudge/banner style, with no new element type. Example: "3 expenses are only on this phone · Try now".
  - When it shows: the oldest unsent change is over **24 h** old *and* there have been ≥ 5 failed attempts. Captive Wi-Fi counts: a reply that isn't JSON from our API is treated as a failure.
  - Also shown at once when **storage persistence was refused**, since iOS may then clear the phone copy.
- **A server rejection is different from being offline.** That rolls the change back and shows a snackbar straight away (T5). It doesn't wait 24 h.
- **The server can't warn you about a phone it hasn't heard from.** A push notification would need the phone to have reached the server, so the warning is in-app only.
  - Optional later: if *your* phone hasn't checked in for 3 days, the partner's app shows "Amlan's phone hasn't synced in 3 days".

## T6. Sync protocol (phone ⇄ server)
- **One WebSocket per open app.** It's used for live "Sam added ₹240" updates and outbox sends. HTTP is the fallback when the socket can't connect.
- **Messages:**
  - Client → server: `op` = {`id`, `entity`, `fields changed`, `base version`}.
  - Server → client: `ack` + new version, or `reject` + reason.
  - The server broadcasts each applied op to the other device.
- **Conflicts** (both edit the same expense offline): field-level merge, where different fields both win. For the same field, the server's order wins and the loser gets a quiet "Sam also edited this" note. With 2 people this is rare.
- **Catch-up after being offline:** the client sends "my last version = N" and the server sends ops after N, paged. If it has been offline too long (ops trimmed), the server sends a paged full snapshot.
- **Idempotent ops:** a client-generated op `id` means a retry never double-adds an expense.
- Cost rule: the DO uses WebSocket **Hibernation**, so it costs ~nothing while idle (TECH-REVIEW §6).

## T7. Pairing & sign-in (exactly two people, no passwords)
1. **First run (you):**
   - Open `/halves/`, which offers *Create pair* behind a one-time admin step.
   - The admin step runs through `/halves/admin/`, protected by Cloudflare Access on your email. That's only for you, only once.
   - The app gets a **device token** stored on the phone.
2. **Invite partner, by link** (decided, no QR). Settings → *Invite* opens the share sheet with a link like `https://amlansahoo.com/halves/join#k=<invite key>`. Send it over WhatsApp.
   - The key goes in the `#` part, which browsers never send to servers or logs.
   - It's single-use, expires in 24 h, is stored hashed and can be revoked.
   - **iPhone gotcha:** an app added to the Home Screen does *not* share storage with Safari. A link redeemed in Safari would sign in Safari, not the installed app. So on iOS:
     1. The join page doesn't redeem. It shows "Add to Home Screen" steps and copies the key to the clipboard.
     2. The installed app's first screen has a *Paste invite* button, which redeems the key and stores the device token.
   - Android/desktop Chrome share storage, so the link redeems directly. Spike S2 checks this.
3. **New phone / laptop:** send yourself an invite link from an existing device. **Settings → Devices** lists devices and can revoke them.

Security details (hashed tokens, Origin checks, WS auth timeout, rate limits) are already reviewed in TECH-REVIEW §5. Passkeys are a possible later upgrade.


### T7a. Keeping everyone else out (user input 2026-11-07)
**A hidden URL is not security.** Links leak through WhatsApp previews, browser history and screenshots, so access rests on layers. Each layer is free:
1. **The app files are public; the data is not.** Anyone can load the empty shell (HTML/JS, no data in it). Every data call needs a valid **device token**, which is 256-bit, stored hashed and revocable. Without one, the API returns 401 and nothing else.
2. **A new device needs two things: something you have, plus approval** (this is the 2FA):
   - It needs the invite link (single-use, 24 h).
   - **An already-paired phone must also tap *Approve "Anwesha's iPhone"?*.**
   - A leaked or forwarded link on its own gets nothing.
   - Each pair has a hard cap of **2 people** and ≤ 6 devices.
3. **Face ID / fingerprint app lock (optional, per device):**
   - A passkey (WebAuthn) unlocks the app on open, or after N minutes away.
   - This protects a phone that's already unlocked and in someone else's hand.
   - Planned as a later setting, not a launch blocker.
4. **Bootstrap (the very first device):** a one-time `/admin` step behind **Cloudflare Access email one-time code**, allowed for exactly your two emails. After that, Access is never in the app's path (TECH-REVIEW §5 explains why).
5. **Edge hygiene:**
   - Rate-limit pairing endpoints, and use Turnstile (already used by the wedding site) on the join page.
   - `noindex` and no links from the wedding site, so search engines never list it.
   - Strict Origin checks (TECH-REVIEW §5).
6. **Admin / aggregate view:** both of you are equal owners, so no separate admin login is needed to see totals. An "everything" aggregate view (all folders and trends combined) is a later feature, not an access level.

**Where it lives:** **`halves.amlanandanwesha.com`** (recommended) rather than `amlanandanwesha.com/halves`.
- The wedding Worker owns the whole apex hostname as a Custom Domain, and a second Worker on a path of that hostname is fragile.
- A subdomain also gets its **own browser storage and cookies**, fully isolated from the public wedding site.
- The Worker is attached as its own Custom Domain, with `workers_dev`/`preview_urls` off.

## T8. Worker (the front door)
- Serves the app's static files under `/halves/` (as the portfolio already does) and leaves `/` and `/queued-tanks/` alone.
- `/halves/api/*` checks the device token and Origin, then forwards to the pair's Durable Object.
- `/halves/admin/*` requires a Cloudflare Access login and runs a JWT check in the Worker. It handles create pair, export and restore.
- Rate-limits the pairing endpoints.

## T9. Pair Durable Object (the brain)
- One instance per pair, holding all data in its own SQLite. A single writer means the two phones can never race.
- **On startup:** run schema migrations (versioned, forward-only; TECH-REVIEW §6).
- **On op:**
  1. Validate it with the `shared/` rules (amount > 0, split sums to 100%, folder exists, no cycles).
  2. Apply it in one transaction and bump the version.
  3. Append to `ops`.
  4. Ack the sender and broadcast to the other socket.
- **Alarms** (no timers): nightly backup (T11), reminder pushes (T10), ops-log trimming, and the 5 s unauthenticated-socket kick.

## T10. Reminders / nudges
- **v1 (PWA):**
  - The **in-app** banner and full-screen interstitial, exactly as in the prototype. They show when you open the app and things are "to sort", or you haven't logged today.
  - **Web Push** from a DO alarm at your chosen times. It works on iPhone once installed to the Home Screen. Snooze lives inside the app.
- **Later (only if needed):** Capacitor native builds give local notifications with Snooze buttons. Android gets a high-importance channel and iOS gets "Time Sensitive". See the platform table in TECH-REVIEW §9.
- Web Push needs VAPID keys and payload encryption written by hand, so it's a separate milestone (M4).

## T11. Backup, export, restore
- A nightly DO alarm writes a JSON snapshot to **R2** (or to D1 if R2 can't be enabled on the free plan; that's spike S3).
- Settings → **Export CSV / JSON** download, available to both people.
- `/halves/admin/restore` loads a snapshot. Rehearse it once before go-live.

## T12. Deploy & ops
- `wrangler deploy` from the laptop. CI can come later if wanted.
- Route `amlansahoo.com/halves*` sits on the same zone as the portfolio. After each deploy, a smoke check confirms `/`, `/queued-tanks/` and `/halves/` all return 200.
- Workers logs are on. The DO logs rejected ops and migrations.
- Free-plan budget: we use about 1% of every limit (TECH-REVIEW §0). Write volume is the only one worth watching, and we're at ~100 of the 100k rows/day.

## T13. Native wrappers (deferred, decide after living with the PWA)
| Path | Cost | Gets you |
|---|---|---|
| PWA only (default) | free | everything in the prototype; basic notifications |
| + Android APK via Capacitor or TWA | free, sideload | Snooze buttons in notifications, priority channel, real vibration on the dial |
| + iOS via Capacitor | **$99/yr Apple Developer** (TestFlight to the partner) | Time Sensitive reminders, real haptics on the dial |

## T14. Testing
- **`shared/`:** unit and property tests for money, splits, rounding, targets and periods (month edges, time zones). This is where bugs would cost real money.
- **Sync:** a simulated two-clients-plus-one-DO test, covering offline edits, conflicts, retries and the trimmed-log snapshot path. It runs on Miniflare/`wrangler dev`.
- **UI:** Playwright on phone viewports, replaying the V2 scenarios (careful, grab-and-go ≤3–4 s, details later, partner view).
- **Device checks:** your Android plus the partner's iPhone, installed as a PWA. Spike S1 checks dial feel and sound on iOS.

---

## Build order (milestones). Each one is usable on its own
| # | Milestone | Parts | You can… |
|---|---|---|---|
| **S** | Spikes (small, throwaway) | S1 iOS PWA dial feel + sound on the partner's iPhone · S2 install-to-home-screen + offline + invite-link paste flow on iOS · S3 R2 / rate limiting enabled on the free plan | confirm the PWA path before investing |
| **M1** | **Quick logging, one phone, offline** | T1, T2, T3 (money), T5 | log expenses fast with the dial/keypad; data stays on the phone |
| **M2** | **Two people, synced** | T4, T6, T7, T8, T9, T12 | both phones see each other's entries live; partner view, added-by, To-sort |
| **M3** | Folders + targets | T3 (targets), UI for folders/limits | set ₹60k/month and folder targets, with "effect of this expense" |
| **M4** | Trends + reminders | T3 (trends), T10 | the Trends page, nudges, push |
| **M5** | Safety + polish | T11, T14 device pass, V3 skins | backups, export, final look |
| later | Split & settle, native wrappers | T3 (balances), T13 | settle-up layer; APK/iOS if wanted |

V3 visual work (DESIGN §9.11) runs alongside M1–M3 as skin CSS. It doesn't block any milestone.

## T15. Attachments: screenshots, receipts (built (local); R2 bucket enabled, not deployed yet, 2026-11-07)
Status: built and tested locally (`npm test` 21/21; `wrangler dev` with simulated R2, two devices). The bucket `halves-attachments` now exists (private, r2.dev off); **not deployed yet**. Storage option A (R2) was chosen.

**Data:** an expense gets `att: [{id, w, h, bytes, type}]` (max 5). It is a plain synced field, merged like any other (B1), and it is not a person field. `id` is client-random, `i` + 15 base-36 characters (the server accepts `[A-Za-z0-9_-]{8,40}`). It is **write-once**: the bytes behind an id never change, so every cache may keep them forever.

**Client compression** (`app/attach.js`, an ES module lazy-loaded on the first Attach tap and precached by `sw.js`):
- Decoding uses `createImageBitmap(file, {imageOrientation:'from-image'})`, falling back to `<img>`. Re-encoding from pixels strips EXIF/GPS.
- **Screenshot vs photo:** it's a screenshot if the input is PNG, or the dimensions match a common device screen (either orientation), or the image has few colours: fewer than 300 distinct 4-bit colours on a 64 px downsample, or the top 8 colours covering more than 60%.
- **Screenshots:** capped at 2400 px on the long edge. The ladder is lossless WebP → q 0.9 → 0.8 → 0.72 → 0.64.
- **Photos:** capped at 2000 px. The ladder is q 0.8 → 0.72 → 0.64 → 0.56.
- Anything still over 1 MB is shrunk to 85% and tried again, up to 6 rounds. Downscaling halves in steps so text stays sharp. Transparency is flattened onto white.
- **Thumbnail:** 320 px long edge, WebP ≤ 80 KB.
- **Encoder:**
  - The canvas, if `toBlob('image/webp')` really returns WebP (Chrome treats q = 1 as lossless).
  - Otherwise (Safari) the vendored **@jsquash/webp 1.5.0** WASM (`app/vendor/jsquash-webp/`, Apache-2.0 + libwebp BSD; SIMD build when supported). It runs in a module worker (`app/attach-enc.js`) so typing never freezes. In Safari mode lossless means near-lossless 60. The ~300 KB of WASM is cached on first use.
  - Otherwise JPEG q 0.88.
- Measured on desktop Chrome with a 1290×2796 PNG and a 4032×3024 9 MB JPEG:
  - canvas path: 717 KB lossless / 311 KB in 0.5 s total
  - forced-WASM path: 218 KB near-lossless / 381 KB
- **UI:**
  - The Add sheet and the expense detail get an **Attach** chip/tile. It's an `<input type=file accept="image/*" multiple>` with no `capture`, so phones offer both camera and library.
  - The strip shows "Compressing…", then the thumbnail plus a "8.9 MB → 311 KB" note. Amount → save is untouched: an image still compressing when you save lands on the saved expense when it's done. Closing the sheet without saving discards its new images.
  - Rows show a 36 px thumbnail (+ a count) only when images are present.
  - Tapping a thumbnail opens a full-screen viewer: thumbnail first, then the full image. Pinch, wheel or double-tap zooms; drag pans; prev/next; it pushes a history entry, so **Back closes it**.
  - Removing an image is soft: it is dropped from `att`, with Undo.

**Upload outbox + cache** (`HalvesAtt` in `app/sync.js`, loaded at boot):
- A separate IndexedDB `halves-att`:
  - `out`: blobs waiting to upload
  - `img`: every image this phone has, kept for good. Repeat views and offline views never touch R2.
- The expense op syncs at once with the `att` metadata. The partner sees a blank tile until the bytes arrive (a 404 is retried after 30 s).
- Uploads go thumbnail first, with the T5a triggers (after attach, `online`, foreground/focus/pageshow, backoff 5 s → 30 s → 2 m → 15 m).
- **Network errors, 5xx and captive Wi-Fi retry silently.** They surface only through the T5a danger rule ("N images are only on this phone").
- **A definite refusal stops retrying that image** and opens the app's own sheet, titled **"Image upload failed"**, with a plain reason and actions:
  - Reasons: `storage_full` "Image storage is full (1.5 GB limit)", `too_large`, `bad_type`/`bad_image`, `daily_cap` "200 images for today", `auth`.
  - Actions: **Retry** (where retryable), **Remove image**, **OK**.
  - The sheet never covers another sheet (it's queued until sheets close). The expense always stays saved. The detail sheet marks a parked image "Not uploaded" with Retry.
  - Compression failures (too large after every step, unreadable file) show inline in the strip, since that image never got attached.
- Signing out wipes `halves-att` too.
- `sw.js` still never intercepts `/api/*`.

**Server** (Worker `attRoute` in `worker/src/index.ts` + Pair DO RPC in `worker/src/pair.ts`):
- `PUT /api/att/<id>?kind=full|thumb`
  - Device token required; pending → 403. Origin is checked like every write.
  - Content-Type must be `image/webp|jpeg|png` (else 415), and the magic bytes must match it (else 400).
  - Size ≤ 1.2 MiB full / 80 KiB thumb (else 413).
  - The Worker reads the bytes (capped), then calls `Pair.attBeginPut` (auth, idempotency, guards, daily cap), writes R2 key `att/<id>/<kind>` with customMetadata `{slot, device, size, type, at}`, then `Pair.attCommitPut` indexes it.
  - A retry of a stored id → `200 {existed:true}`, with no R2 write.
- `GET /api/att/<id>?kind=…`
  - Active device only. `Pair.attBeginGet` answers "missing" (404) from its index without an R2 read.
  - Streams with `Cache-Control: private, max-age=31536000, immutable`, `nosniff`, `Content-Disposition: inline` and CSP `default-src 'none'`.
- `GET /api/usage` → `{bytes, capBytes, monthPuts, monthGets, maxMonthPuts, maxMonthGets}`. Settings shows "Images: X of 1.5 GB used", plus a warning line at ≥ 75% (≈ 1.1 GB).
- DO schema v2: table `att(key, bytes, type, slot, device, at)`. `meta.att_bytes` = running total, `meta.att_month` = `{m, puts, gets}` (UTC calendar month), `meta.att_day:<deviceId>` = daily count.

**R2 free-tier guards** (the free tier is 10 GB-month storage, 1M Class A / 10M Class B per month; constants in `ATT` in `pair.ts`):
| Guard | Limit | Response |
|---|---|---|
| Stored bytes | **1.5 GB** (user choice; env `ATT_CAP_BYTES` overrides, the tests use 3000) | upload refused `507 {error:"storage_full"}` once stored + new > cap |
| PUTs this month | 500k | `507 storage_full` |
| GETs reaching R2 this month | 5M | `429 read_quota`; the client keeps showing cached copies |
| Uploads per device per UTC day | 200 (env `ATT_DAILY_CAP`; the tests use 6) | `429 daily_cap` |
- In the Add sheet a known-full store turns the chip into "Image storage full". The expense still saves.
- `Pair.attForget(key)` subtracts bytes for the future cleanup (below).

**Later:**
- **Cleanup alarm:** a DO alarm that deletes R2 objects whose id is no longer referenced by any live expense for 30 days (deleted expenses keep their images so Undo works), then calls `attForget`. Until then there is no DELETE route; the storage cap bounds the leak.
- Optional *Document* look for photos (greyscale + contrast).
- The local `img` cache is unbounded (≈ 250 KB per full image); add LRU pruning if phones complain.
- **Before deploy:** nothing else is needed. The bucket exists, and the binding `ATT` is in `wrangler.jsonc`.

## B1. First build: contract (2026-11-07)
Scope picked by the user: **logging + sync + security**, all five skins, at **`halves.amlanandanwesha.com`**. Targets/Trends UI ships as-is from V2 (data synced), with polish later.

**Deviations from the T-parts, for speed (revisit later):**
- **Client stays vanilla JS** (the V2 prototype, reviewed 3 rounds) instead of a Svelte port. Plain JS is even lighter than Svelte, and Svelte (T2) can come later if the UI grows.
- **Server stores entities as JSON docs** (`docs(kind,id,data,version,...)`) instead of the full relational schema (T4). It's the same sync semantics, just less schema to migrate while the model is still moving.
- **Bootstrap uses a one-time secret** (`wrangler secret put BOOTSTRAP_SECRET`) instead of Cloudflare Access. That's one less dashboard step. Once the pair exists, the secret is dead.

**Layout:**
- `app/`: static files: `index.html` (from prototype-v2), `skins/`, `sync.js`, `manifest.webmanifest`, `sw.js` and icons.
- `worker/src/index.ts`: the front door.
- `worker/src/pair.ts`: the `Pair` Durable Object.
- `wrangler.jsonc`, `package.json` and `tests/` at the repo root.

**Entity kinds** (`data` is the prototype's object with ids as random strings):
- `folder`, `expense`, `settle`, `target`, `tag`, `pref` (shared pair settings: mode, overall target).
- People are stored as slots `"A"` and `"B"`, never "you". The client maps the viewer's slot to "You". Names come from `pair.names`.

**HTTP** (JSON, `Authorization: Bearer <deviceToken>`, Origin must equal the app origin):
| Route | Auth | Does |
|---|---|---|
| `POST /api/bootstrap` `{secret, name, device}` | secret | creates the pair (slot A) and the first device → `{token, slot}`. 409 once the pair exists. |
| `POST /api/invite` | device | → `{key}`: 24 h, single-use, stored hashed. Link is `/join#k=<key>`. |
| `POST /api/redeem` `{key, name, device}` | key | creates a **pending** device for slot B (or a known slot if the name matches) → `{pendingToken, slot}`. Rate-limited. |
| `GET /api/pending` | device | lists devices awaiting approval |
| `POST /api/approve` `{deviceId, allow}` | device (active) | activates the device, or deletes it |
| `GET /api/me` | device or pending token | `{status: active/pending, slot, names, deviceId}` |
| `GET /api/devices`, `POST /api/revoke {deviceId}` | device | Settings → Devices |
| `POST /api/sync` `{since, ops[]}` | device | HTTP fallback, same semantics as the WS |
| `PUT/GET /api/att/<id>?kind=full\|thumb` | device (active) | image bytes in R2 (T15) |
| `GET /api/usage` | device (active) | image storage + monthly R2 op counters (T15) |

**WebSocket** `/api/ws`:
- The first message is `{t:"auth", token}`. With no auth within 5 s the socket is closed.
- Client → server: `{t:"sync", since, ops:[{opId, kind, id, base, set:{...fields}, del?:true}]}`.
- Server → client:
  - `{t:"ack", opId, version}`
  - `{t:"reject", opId, reason, current}` (current = the server doc, used for rollback)
  - `{t:"changes", docs:[{kind, id, data, version, deleted, by}], cursor}`
  - `{t:"pending"}`: a device is waiting for approval
- **Merge:** field-level. When `base` < the server version, fields not changed since `base` still apply. Conflicting fields: the server's version wins, and the client is told through `changes`. Ops are idempotent by `opId`.
- **Limits:** ≤ 2 slots, ≤ 6 devices, ≤ 200 ops per message, docs ≤ 8 KB.

**Client sync** (`app/sync.js`): after every `render()`, it diffs the in-memory collections against the last-known server copy and turns the differences into ops. The ops are persisted to an outbox (IndexedDB, with localStorage fallback) and drained over the WS or HTTP. Retries follow T5a. The "sync in danger" line follows T5a.

## Decisions
| # | Decision | Status |
|---|---|---|
| 1 | Git repo | ✅ local repo, personal identity; GitHub remote is up to the user (T1) |
| 2 | UI framework | ✅ Svelte 5, for runtime speed and size (T2) |
| 3 | Pairing | ✅ invite link over WhatsApp, no QR (T7) |
| 4 | Platform | ✅ web app (PWA) only for now; native revisited later (T13) |
| 5 | Who sees data | ✅ only the two of you, as equal owners; an aggregate view comes later (T7a) |
| 6 | Domain | ❓ `halves.amlanandanwesha.com` recommended (T7a) |
| 7 | Access | ✅ device token + approval by an existing device for new devices; a Face ID lock comes later (T7a) |

## Changelog
- 2026-11-07 v1.4: T15 attachments built locally: R2 binding, PUT/GET /api/att, /api/usage, free-tier guards (1.5 GB cap), client compression + outbox + viewer, upload-failed sheet.
- 2026-11-07 v1.3: B1 first-build contract (vanilla client, JSON docs, bootstrap secret).
- 2026-11-07 v1.2: T7a security layers + domain moved to amlanandanwesha.com (subdomain).
- 2026-11-07 v1.1: T5a: invisible sync with retry triggers and the "sync in danger" rule.
- 2026-11-07 v1: user decisions folded in (git, Svelte, link pairing plus the iOS storage gotcha, PWA-only).
- 2026-11-07 v0: first breakdown, from TECH-REVIEW v1.1 and the V2 prototype.
