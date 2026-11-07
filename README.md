# Halves (working name) — two-person expense splitter

Status: **design review phase**. Nothing is implemented; prototype only, with fake in-memory data.

## Review pack
| What | Open |
|---|---|
| Clickable hi-fi prototype (mobile + desktop responsive, thumb dial) | `prototype-v1/index.html` (frozen) · `prototype-v2/index.html` (V2 work, seeded from V1) |
| Phone + desktop side by side | `devices.html` (V1) · `devices-v2.html` (V2) |
| Lo-fi annotated wireframes | `wireframes/index.html` |
| Product/design spec, decisions, **feature list to triage**, open questions | [docs/DESIGN.md](docs/DESIGN.md) |
| Hosting/backend/auth options + recommendation | [docs/TECH-REVIEW.md](docs/TECH-REVIEW.md) |
| **Technical design breakdown (T0–T14, milestones), draft for review** | [docs/TECH-DESIGN.md](docs/TECH-DESIGN.md) |
| Subagent critique rounds + what changed | [docs/REVIEW-LOG.md](docs/REVIEW-LOG.md) |

Run locally: `python3 -m http.server 8765`, then open http://localhost:8765/devices.html. Fonts and icons load from Google Fonts, so you need to be online.

Prototype tips: system/browser Back goes up a folder (and closes sheets) · long-press (or right-click) a folder for its menu · type a year like `2027` in New folder · ◎ in the top bar toggles the thumb dial (on by default for touch, off for mouse; add `?touch=1` to force touch defaults) · turn the dial ring by dragging around it (mouse wheel on desktop), tap its centre, or hold the centre and slide.

## Next session prompt (V2 build)
> Objective: build **V2** of the Halves prototype in `prototype-v2/index.html` (seeded from frozen V1), then run ≤3 subagent critique rounds focused on V2 only (log in `docs/REVIEW-LOG.md` under a new "V2" heading).
> Read first: `docs/DESIGN.md` §9 (V2 brief and V2-Q1..Q4), `docs/TECH-REVIEW.md` §9 (notification feasibility, budgets data delta), `docs/DESIGN.md` §4 (dial, keep it).
> Work items:
> 1. Retro poster skin as new tokens: cream/maroon light, charcoal/pink dark. Halftone, grain and sunburst as CSS/SVG, slab + script display fonts from Google Fonts. Original ornaments only: no brand marks, no copied artworks.
> 2. Bouncier springs plus a Bounce setting slider (Calm ↔ Boing).
> 3. **Simple mode is the default** (DESIGN §9.2a): no categories, one flat list, overall target (e.g. ₹60k/month) plus optional folder targets. Detailed mode toggle in Settings brings back categories and category/tag limits.
> 4. Tags: multi-select with inline create in the add sheet, shown as chips on rows. Limits come with left/pace rings and an "effect of this expense" line in the add sheet.
> 5. Third swipe page "Trends": today's target at the top, limits with on/off track, drill-down. Page dots in the dock; dial Sections layer includes it.
> 6. Nudge UI: reminder schedule sheet, discreet banner + full-screen interstitial with Snooze 15/30/60 and Log now (simulated in the browser).
> Current state: V1 is done and reviewed (tech and dial FAVORABLE; UX had 3 last fixes applied, which I verified in the browser but no reviewer re-checked). Serve with `python3 -m http.server 8765` and open `/devices-v2.html` (phone frames use `?touch=1`).
> Open: V2-Q1b..Q4 (defaults if unanswered: tags are labels only in Simple mode; month + lifetime periods; auto daily target; ornaments + one original SVG pin-up-style badge). iOS haptics spike (TECH §7).

## Fallback prompt: V2 scenario-review loop (use only if the original session died)
> Project: Halves V2 prototype `prototype-v2/index.html` with skins in `prototype-v2/skins/`. Spec: `docs/DESIGN.md` §9 (esp. §9.2a Simple mode, §9.2b one-sided + Decide later, §9.6 variants, §9.8 hooks).
> Goal: run **two-person usage simulations** and iterate the UX until the reviewers are highly satisfied (≤3 rounds). Log everything in `docs/REVIEW-LOG.md` under "V2 scenario rounds".
> Scenarios, each run on phone (390×844, `?touch=1`), on a small phone, and both with and without the thumb dial, across skins/motion presets:
> 1. **Careful / happy flow:** full details, tags, split %, folder, date.
> 2. **Grab-and-go quick add:** fewest taps, pocket again in a few seconds. Count taps and estimate time with a keystroke-level model; target ≤3–4 s. The dial path must not be slower than the keypad path.
> 3. **Quick add, details later:** log the amount now, mark it "to sort" / unreviewed, and find and finish it later.
> 4. **Partner view:** the second person sees what was added and reviews the pending items.
> Reviewers report tap counts, time estimates, friction points and a verdict. A fixer applies the changes. Stay under the cap of 3 rounds.

## Morning hand-off (2026-11-07)
- V2 done: features + 5 skins (modern · poster · ink · neon · art), motion fluid/stop/hybrid, Bounce slider. Open `devices-v2.html`, or on your phone `http://<laptop-ip>:8765/prototype-v2/index.html` (switch skins under Settings ⚙).
- 3 scenario review rounds done (see `docs/REVIEW-LOG.md` "V2 scenario round 3"). Decisions are in `docs/DESIGN.md` §9 (9.1a cool-not-cute, 9.2a–c, 9.9 priorities, 9.10 exploration skins).
- Next: you review V2 → V3 = the merged, properly informed version (pick skins; answer the open Qs in DESIGN §9.5 and the "untitled is fine" toggle).

## Next session prompt (tech design review, 2026-11-07)
> Objective: TECH-DESIGN v1 has the user decisions (git, Svelte, link pairing, PWA-only). Next: plan the spikes (S1–S3) and milestone M1. Don't scaffold code until the user approves.
> State: the user's V2 skin review is in DESIGN §9.11 (feeds V3, not a blocker). The skin-picker labels bug is fixed.
> Read first: TECH-DESIGN "Decisions for you", TECH-REVIEW §1, §5 and §9.

## Live (first build, deployed 2026-11-07)
- URL: https://halves.amlanandanwesha.com (Worker `halves`, Custom Domain; the wedding site at the apex is untouched).
- Deploy: `npx wrangler deploy`. **Bump `VERSION` in `app/sw.js` on every deploy.** Local: `cp .dev.vars.example .dev.vars && npm run dev`; tests: `npm test`.
- One-time setup link: `.prod-setup-link.local` (gitignored, chmod 600). It stops working once the pair exists. Rotate with `npx wrangler secret put BOOTSTRAP_SECRET`.
- Pairing: Settings → Invite → WhatsApp link → approve on the paired phone (TECH-DESIGN T7/T7a, B1).
- Known gaps: per-IP rate limit and Turnstile not built; the ops log is never trimmed; the server doesn't check expense rules; no nightly backup yet (T11); no Android Background Sync.
