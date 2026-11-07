# Halves — product & design spec (v0, design-review phase)

> Working name **Halves**. Two-person shared-expense app (you + partner), Splitwise stripped down, built around **folders of expenses** (any depth). Status: **V1 prototype frozen (reviewed); V2 (retro skin + budgets/tags/trends/nudges) in progress**. Nothing implemented.
> Related: [TECH-REVIEW.md](TECH-REVIEW.md) (hosting/backend options) · [REVIEW-LOG.md](REVIEW-LOG.md) (critique rounds) · prototype [`../prototype-v1/index.html`](../prototype-v1/index.html) · wireframes [`../wireframes/index.html`](../wireframes/index.html) · side-by-side phone+desktop [`../devices.html`](../devices.html)

> **Positioning shift (2026-11-06, user):** Halves is less a Splitwise clone and more a **collaborative expense log for two**. The core loop is *log fast → check against targets together*. Splitting and settling stay available but become a secondary layer: a small balance line plus Settle, not the hero. Themes below are read through this lens. (Open: V2-Q5, whether splitting is on by default or opt-in.)

## 1. Core themes (the yardstick every review uses)
1. **Two people only.** No groups, no friends list, no sign-up funnel. "You" and one partner. Every screen answers *who owes whom, how much*.
2. **Folders all the way down.** Expenses live in folders; folders nest (`2026 › November`, `Goa trip`, `Home setup › Kitchen`). Totals and balances roll up the tree.
3. **Thumb-first.** Everything you do often sits in the bottom half: dock, FAB/dial, bottom sheets, keypad, chip editors. The top half is for *reading* (balance, titles).
4. **Calm but fun.** Not dense. One hero number per screen, generous spacing, few borders. Fun lives in motion and shape: springy motion, shapes that morph, variable-weight numbers (in the spirit of Material 3 Expressive) — never in clutter.
5. **Fast once familiar.** Novices tap; regulars use the **thumb dial** to move and change values without hunting for targets.
6. **Cloudflare free tier.** Must run within Workers/DO/D1 free limits (see TECH-REVIEW).

## 2. Information architecture
```
Home (Folders)          Activity             Insights
 ├ Balance hero          all expenses +       month spend, who paid,
 ├ Folder tree           settlements,         by category
 └ Latest 3              newest first
Folder view  (crumbs › title › stats › subfolders › category chips › expenses by day)
Sheets: Add/Edit expense · Expense detail · New folder · Settle up · Folder menu · Folder default split
```
Desktop (≥960px): nav rail (FAB at top) · persistent folder tree pane · content. Sheets become a right-side panel.

## 3. Key interaction decisions (prototype shows all of these)
| # | Decision | Why |
|---|---|---|
| D1 | **FAB tap = add expense straight away** (no FAB menu). Settle is in the hero; New folder sits in the tree header and folder tiles. | Adding is 90% of use, so it gets one tap. |
| D2 | **Add sheet: amount + keypad first (always, even when the dial is on), optional title under the amount, details as chips** (category · paid by · split · folder · date). Tapping a chip swaps the keypad for that chip's editor *in place*. | Never more than one editor on screen, and everything stays in thumb reach. Defaults (folder = current/this month, split = folder default, category from title keywords) mean most adds are *amount → title → save*. |
| D3 | **Folder default split, inherited down the tree** (`Home setup` = 60/40, so `Kitchen` gets 60/40 unless it sets its own). | Rent/home splits are rarely 50/50. Set it once, never think about it again. |
| D4 | **Year-folder magic**: typing `2027` offers "add 12 month folders" (toggle). | Matches how you'll actually set things up: a year with its months, or a flat month. |
| D5 | Balances are always in words: "Sam owes you ₹X" / "You owe Sam ₹X" (no bare +/−). Splits always read "You 60 · Sam 40". Folder nets are labelled **before settle-ups**; the hero is the overall net including settlements. | Avoids sign/colour ambiguity. Folder-scoped settling is open question Q3. |
| D6 | **Delete/undo via snackbar**, no confirm dialogs. | Low friction. Undo is safer than "are you sure?". |
| D7 | **Long-press (or ⋮) on a folder → action sheet** (add here, subfolder, default split, rename, move, pin, archive). | Keeps rows clean, with power actions one gesture away. |
| D8 | Expressive vocabulary: shape-morph icons (cookie / clover / flower / squircle polygons), spring easing, variable font weight on numbers (bigger balance = heavier), button groups that widen the selected item, slider with thin handle + gap. Font **Roboto Flex** (wght/wdth/opsz axes), icons **Material Symbols Rounded**. Respects `prefers-reduced-motion`. | Fun comes from motion and shape, not from adding more elements. |
| D9 | Motion budget: nothing loops forever; motion only responds to touch or state changes. Reduced motion = no animation. | Fun when you interact, calm at rest. |
| D10 | Accessibility floor: keyboard-operable tree/rows/sheets, focus trap + restore, live regions, ≥40–44px targets, text-safe person colours (`--you-t`/`--sam-t`). | WCAG AA baseline from day one. |

## 4. Thumb dial (iPod wheel × iPhone Camera Control)
Optional control in the bottom-right corner; there's a left-hand mirror under Quick actions. Toggle it with ◎ in the top bar or rail (on by default in the prototype). When it's on, it replaces the FAB. The keypad always stays visible, so the dial is an accelerator, never a gate.

| Gesture | Effect |
|---|---|
| **Turn the ring** (40px band; turning only starts after 6°) | *Move* layer: a focus ring steps through items on screen (a fast turn jumps 3). *Adjust* layers: change the value. Each click plays a toggleable WebAudio tick plus vibrate (or the iOS 18 switch-haptic trick), and the tick marks snap per click. |
| **Tap the centre** (60px) | Move: open the focused item (nothing focused → add expense). In the add sheet: go to the next field (Amount → Split → Paid → Category → Date → Folder → Save). A tap never commits. |
| **Double-tap the centre** | **Commit**: save the expense, record the payment, or confirm the sheet. This is the only way the dial moves money. |
| **Hold the centre ≥380ms without moving, then slide** | A pie menu of layers fans out along a 150° thumb arc (R 118px), with the highlighted item labelled. Release on one to pick it, or in the centre to cancel. Like a Camera Control light press. |
| **Wheel / keyboard** | Wheel = turn. Arrows turn, PgUp/PgDn take a big step, Enter = tap, Shift+Enter = commit, Alt+Tab = next layer. |

Layers by context:
- **Main screens:** Move · Sections (turning switches Folders/Activity/Insights, synced to the current route) · Quick actions (Add, Settle, New folder, Back, Theme, Click sound, Left/right hand).
- **Add/Edit sheet:** Amount · Split · Paid by (clockwise = partner, counter-clockwise = you) · Category · Date · Folder · Save. The matching chip editor opens so you can see what's changing.
- **Sheets with a slider** (Settle, Default split): Adjust · Move.

Amount speed uses smoothed velocity (110ms window): <120°/s = ₹1, <300 = ₹10, <600 = ₹100, otherwise ₹500. It only steps up after 3 clicks in a row at that speed, and a 250ms pause resets it to ₹1, so a stray flick can't wipe out fine digits. Bigger steps land on round numbers.
Placement: 22px plus the safe area up from the bottom. Save sits to the left of the dial. On desktop the dial moves left of the side sheet.

## 5. Visual system
- Palette: warm neutral surfaces. **You = coral/tangerine** (`--you`), **partner = teal** (`--sam`): these two colours carry meaning everywhere (slider halves, dots, +/−). Six tonal containers (coral, teal, lilac, sun, sage, sky) for folders and categories. Full light/dark token sets.
- Shape: one shape per folder (user-picked). Category icons sit in squircles that morph to cookies on hover/press.
- Type scale: display numbers at opsz 144 with weight 300→900 mapped to magnitude. Titles get wdth 110–120 for a slightly quirky, wide look.
- Density: one stat row per folder (spent · net). Lists group by day, rows join into one card (rounded ends only), no dividers.

## 6. Candidate features for design review (pick → we design → implement later)
Mark each **Yes / Later / No**. ★ = I'd recommend for v1.
| # | Feature | Notes |
|---|---|---|
| F1 ★ | Search (title, amount, folder) | Top bar icon is already in place. |
| F2 ★ | Offline add + sync | Add on a flight and it syncs later. Shapes the architecture (TECH-REVIEW §4). |
| F3 ★ | Live updates when partner adds | "Sam added Dinner ₹1,200" toast plus the row animating in. Durable Object WebSocket. |
| F4 | Recurring expenses (rent on the 1st) | Lands in that month's folder automatically, and could create the month folder too. |
| F5 | Receipt photo | R2 storage, compressed on the client. |
| F6 | Both-paid / itemised split | e.g. a bill paid half each with different shares. The paid-by editor has a placeholder. |
| F7 | Folder-scoped settle ("settle Goa trip") | Q3. |
| F8 | Budgets per folder (with a wavy M3 progress ring) | Fun visual. |
| F9 | Comments / emoji reactions on expenses | Light social layer for two. |
| F10 | Multi-currency per folder (trip abroad) | Folder currency plus a rate on the day. |
| F11 | Export CSV / monthly summary card (shareable image) | |
| F12 | Pin / archive folders, smart "This month" shortcut | Archive is in the folder menu already. |
| F13 | Web push reminders ("you're ₹5k apart") | iOS needs Home Screen install (16.4+). |
| F14 | Dial extras: double-tap = undo, a dial "scrub" through the activity timeline | |
| F15 | Category management (custom categories with your own shape/colour) | |

## 7. Open questions for you
- **Q1** Partner's name/initial and currency (prototype assumes "Sam", ₹ INR).
- **Q2** Dial on by default (on in the prototype for review), or offered after a week of use? Is double-tap-to-commit right, or hold-to-confirm? (Trade-off: double-tap on the Amount layer makes "next" taps there wait 320ms, and a quick tap-tap saves, softened by Undo.)
- **Q3** Should settling be per-folder, global, or both?
- **Q4** Can a folder hold expenses *and* subfolders (prototype: yes, like `Home setup`) or only one or the other?
- **Q5** Are categories global or per-folder?
- **Q6** Any edits allowed on the partner's expenses, or only your own (with "suggest change")?

## 9. V2 brief: retro poster skin + budgets/tags + Trends page + nudges (input 2026-11-06)
> V1 is frozen at `../prototype-v1/` with its review rounds done. V2 builds in `../prototype-v2/` and gets reviewed **on its own**; V3 will merge V1 and V2 feedback into the informed version.

### 9.1 Aesthetic: mid-century painted poster
- **Mood:** 1940s–50s soda-fountain signage, pin-up posters, painted lithographs. Think enamel tin signs, halftone dots, cheap-ink misregistration, paper grain, sunburst rays, ribbon banners, scalloped badges, script-plus-slab type.
- **Light mode:** cream paper (`#F3E6CC`-ish) + maroon ink (`#7A1E2C`), with mustard and teal as supporting colours. **Dark mode:** charcoal grey + pink (a neon-sign-at-night feel).
- **Original work only.** Inspired by the era's popular and artsy pieces, but no real brand logos or wordmarks (no Coca-Cola marks or the Spencerian "Coke" script), and no copies of specific artworks. Pin-up figures would be original stylised SVG illustrations, or assets you supply.
- **Keep all V1 interactions** (dial, sheets, keypad, chips) and re-skin them: the dial becomes a bottle-cap/rotary-phone wheel, buttons become enamel badges, and chips become ticket stubs.
- **Bouncier** (V1 feedback): stronger springs everywhere, plus overshoot on navigation. Add a **Bounce** setting (Calm ↔ Boing slider) so it can be turned down if it gets tiring. Reduced-motion still means none.

### 9.1a User feedback on the first V2 skins (2026-11-06)
- **Too kiddish / cutesy.** The users are adults about to turn 30. Aim for **funky and cool**: a jazz-club poster, a lounge matchbook, a vintage record sleeve, the swagger of an old cartoon title card. Not a nursery. Mascots should be wry or deadpan, not cute: less rounded-baby proportion, more attitude, sparing use.
- **Legibility in stages.** At a *glance* (0.5 s) you should get the state (on track / over, owed). A *scan* (2 s) should find the item or folder you want. A *read* should give the details. Today it hangs together, but the **identifiers (folder, who-paid, tag, pending) aren't distinct enough**.
- **Don't fix that by colour-coding everything.** Use hierarchy instead: type weight and size, shape and silhouette, position, a single accent, and icon plus label. Keep the number of things competing for attention low.

### 9.2 Budgets, limits & tags
- **Tags:** an expense can carry several tags. In the add sheet you pick from recent/popular tags or create a custom one inline. Categories stay single-choice (open question: merge categories into tags?).
- **Limits (optional) on folders, categories and tags:** amount per period (month/week/custom, or the folder's lifetime for trips). Show *left / spent / pace* as a progress ring or bar, with "₹X left · ₹Y/day for N days".
- When you log an expense, show its effect immediately ("Groceries: ₹1,240 left → ₹400 left").

### 9.2a Decision: Simple mode is the default (input 2026-11-06, answers V2-Q1)
- **Default = Simple mode, with no categories.**
  - Set a main target, e.g. **₹60k / month overall**, optionally also per folder.
  - Log expenses quickly, then check whether you're on track against that target.
  - Expenses show in **one flat list**: no category icons, colours, filters or grouping.
- **Tags in Simple mode** are optional chips on each row, with quick-pick and inline create. They're labels only, with no limits (assumption, to confirm).
- **Detailed mode** is an opt-in toggle in Settings. It turns on categories (the V1 icons, filters and grid) and lets you set limits on categories and tags.
- **Impact:**
  - The add sheet in Simple mode has no category chip. Chips become: paid · split · folder · date · tags.
  - The Trends page leads with the overall/folder target. Category and tag breakdowns appear only in Detailed mode.
  - The data model is unchanged (category stays nullable). `limits.target_kind` in Simple mode is just `overall` / `folder`.

### 9.2b Decision: one-sided by default; split is opt-in per expense (input 2026-11-06)
- **New expenses default to "one-sided".** The payer's own spend counts toward the shared log and targets, but creates no debt. Most logs are quick "I spent X" entries.
- **The split chip leaves the quick chip row.** Splitting stays a short thumb-reach away (a "Split…" control under the chips / in "More"). The editor offers: *One-sided* (default) · *Split %* (V1 slider + presets) · **Decide later**.
- **Decide later** marks the split as undecided. The item is "to sort" (see §9.2c, which adds a separate *needs review* flag) and is kept out of the balance. Settling waits until they're sorted, or treats them as one-sided.
- **Folder default split (D3)** still applies when a folder sets one. For example, Rent folder = You 50 · Sam 50 means expenses there start split, not one-sided.
- Supersedes the V1 default of 50/50 on every expense.

### 9.2c Decision: "needs review" flag, To-sort queue, added-by (V2 scenario round 1, see [REVIEW-LOG](REVIEW-LOG.md#v2-scenario-round-1-2026-11-06-all-not-yet--fixed))
- **Two separate pending reasons.** `review` = "details not done". It is set automatically when an expense is saved with no title, or explicitly by **Finish later** next to Save (and in the dial hold-menu). It clears when you save from the edit sheet or tap **Mark sorted**. `sp:'later'` (§9.2b) still means "split undecided" and keeps the item out of the balance. **"To sort" = either reason.** The review half does not depend on the split layer.
- **Amount-only entries never look complete.** Category stays `null` (shown as "Uncategorised" in Detailed mode) and the title stays empty (shown as italic "Untitled").
- **"N to sort" is a button** on the Home hero, Activity and Trends. It opens the **To-sort queue**: oldest first, inline one-tap actions (Sorted · Own · 50/50), and "One by one". One by one walks through detail sheets ("2 of 5"). Each detail has one-tap resolves plus "Add details", and the next item opens after each resolve or save.
- **Added-by.** Every expense records `by` (who logged it) and `at` (when), separate from `paid`. The detail sheet shows "Added by Sam · 2h ago" next to Paid by. Rows show "added by X" only when it differs from the payer. Home shows **"New from <partner> · N"** right under the hero (entries by the partner since you last looked) with Mark seen.
- **Identifier hierarchy (answers §9.1a).** Payer = letter disc in the left column (filled = you, outlined = partner). Folder = small caps under the amount. Tags = inline muted `#text`. Pending = the single accent (left bar + TO SORT). Colour still means only you/partner money direction and target status.
- **Motion rule.** Anything carrying tap targets (sheets, keypad) uses `--spring-sheet`: fast and with no overshoot at any Bounce. Bounce applies to decoration and navigation. Stop motion is **experimental**; hybrid is the recommended stop-motion feel. Mascots are deadpan, and shown **rarely** by default (Settings → Mascot: Rare / Always / Off).

### 9.3 Third page: Trends / Targets ("third home-screen page")
- **Not in the main dock.** You reach it by swiping past Activity, with page dots in the dock (like the third page of app icons). The dial's Sections layer reaches it too.
- **Top:** today's target. "Daily allowance ₹X · spent ₹Y today · on track / over", and it updates right after you log something.
- **Then a list of limits,** each showing whether it's on or off track (ring + trend sparkline). Tap one to drill down into sub-folders, tags and expenses, with on-track status at every level.

### 9.4 Logging nudges (reminders)
- You set reminders through the day ("13:30, 20:00"). If nothing has been logged since the last one, a nudge says something like "Take 2 min to log today?" with **Snooze** (15 / 30 / 60 min) and **Log now**.
- **Discreet by design:** neutral wording, no amounts, a generic icon. A glance from someone in a meeting should reveal nothing.
- **Wanted:** a high-priority, full-screen style that can't be ignored but can be silenced. Feasibility is in [TECH-REVIEW §9](TECH-REVIEW.md#9-v2-delta-notifications--budgets). Short version: a PWA can't do full-screen or priority-bypass notifications; a native shell can get close.

### 9.5 V2 open questions
- ~~**V2-Q1**~~ Resolved → §9.2a: Simple mode (no categories, overall/folder targets) is the default; Detailed mode is opt-in.
- **V2-Q1b** In Simple mode, are tags labels only (assumed), or can a tag also carry a limit?
- **V2-Q2** Limit periods: is a calendar month enough for v1, or do trips need per-folder lifetime limits from day one?
- **V2-Q3** Daily target: derived automatically (monthly limits ÷ days left) or set manually?
- **V2-Q5** Split/settle layer: on by default (as a small line) or an opt-in toggle like Detailed mode?
- **V2-Q4** Pin-up imagery: original SVG illustrations I draw, your own assets, or ornaments only (badges, rays, banners, no figures)?

### 9.6 V2 build plan: variants (input 2026-11-06)
New reference: **1930s rubber-hose cartoon animation.** The feel is hand-inked, wobbly "boiling" outlines, pie-cut eyes, white gloves, squash & stretch, film grain/vignette, title-card typography. It blends with §9.1's painted-poster style.
**Originality guard:** the genre only. No Cuphead or Studio MDHR characters, assets, title cards or look-alike screens; no Disney/Fleischer characters; no brand marks. Any mascot is original (e.g. a little coin/piggy-bank character, "Penny").

One V2 prototype (`prototype-v2/index.html`) with switchers in Settings, so every combination can be compared:
| Axis | Options |
|---|---|
| **Skin** (`data-skin`) | `modern` (V1 look) · `poster` (painted poster: cream/maroon ↔ charcoal/pink, halftone, grain, sunbursts, ribbons) · `ink` (rubber-hose: inked SVG outlines, sepia-cream ↔ charcoal-pink, film grain, mascot) |
| **Motion** (`data-motion`) | `fluid` (continuous springs, extra bouncy) · `stop` (frame-by-frame at 12fps with `steps()`, line boil on outlines, held poses, smear frames) · `hybrid` (fluid UI, stop-motion only for the mascot, celebrations and empty states) |
| **Bounce** (`--bounce` 0–2) | Calm ↔ Boing slider. Scales spring overshoot. Reduced-motion forces calm + no boil. |
| **Mode** | Simple (default, §9.2a) · Detailed |

Hand-drawn assets are drawn in code: inline SVG plus an `feTurbulence`/`feDisplacementMap` ink filter. Stop-motion boil = cycling the turbulence seed on a stepped timer. Painted frames = 3–4 alternate drawings per ornament, swapped on steps.
`devices-v2.html` preset links show the main combos side by side.

### 9.7 Optional raster pass (needs your OK: it downloads files)
If you want painted raster frames later, prompts for an image generator would look like: *"original 1930s rubber-hose cartoon style, hand-inked, a cheerful coin-shaped mascot with pie-cut eyes and white gloves holding a receipt, cream paper background, limited palette maroon + cream, film grain, no text, no existing characters"* (variants: celebrating, sleepy for nudges, worried for over-budget). Not done yet: it needs you present to approve downloads.

### 9.8 Skin/motion hooks (V2 phase 1 contract for skin agents)
Built in `../prototype-v2/index.html`; skins live in `../prototype-v2/skins/` (`poster.css`, `ink.css`, `ink.js`, loaded on every skin, so scope with the selector).
- **`html[data-skin]`** = `modern` | `poster` | `ink`. `:root` holds the modern tokens as shared defaults. A skin overrides them in `html[data-skin="x"]{…}` (light), and in `html[data-skin="x"][data-theme="dark"]` plus `@media (prefers-color-scheme:dark){html[data-skin="x"]:not([data-theme="light"])}` (dark). Tokens include colours, `--good/--warn/--bad(-c)`, `--font-ui/--font-display/--font-num`, `--r-xl/--r-l/--r-m`, and the `--sh-*` shape polygons.
- **`html[data-motion]`** = `fluid` | `stop` (everything frame-by-frame) | `hybrid` (stepped only inside **`.sm`**: the mascot, celebrations/confetti, empty states, nudges). Use `var(--spring)`, `var(--spring-soft)` and `var(--ease)`; never redefine them. JS generates them as `linear()` spring curves from **`--bounce`** (0–2, default 1 ≈ 25% overshoot, 0 = plain ease). The stop variants are the same spring held at ~12fps.
- **Line boil:** add the class **`.boil`** or call **`Motion.boil(el)`** (it returns an unboil fn). Every 83ms (only in stop, or in hybrid inside `.sm`; never under reduced motion) the runtime sets `--boil` (0/1/2) and `--boil-j` (0/1/−1), and cycles the `seed` of the `feTurbulence` in **`#ink-wobble`** and **`#grain`**. Both are no-op placeholders in an inline `<svg><defs>`; override the displacement scale or replace them. `Motion.onFrame(f)` and `Motion.stepped(el)` are there for JS-driven frames.
- **Decoration slots** (hidden in modern): **`.ornament[data-slot]`** (`hero`, `folder`, `empty`, `today`, `nudge`) and **`.mascot.sm[data-mood]`** (`idle`, `happy`, `worried`, `sleepy`, `cheer`; it flips to `cheer` for 1.6s after a save). These sit in the hero, the Trends "Today" card and both nudges.
- **Other attributes:** `data-mode` (`simple`|`detailed`) and `data-split` (`on`|`off`; `.split-only` hides when off).
- **Events:** `halves:render`, `halves:prefs` and `halves:nudge` fire on `document`, so ink.js can re-inject SVG after a re-render.
- **URL params win over stored settings:** `?skin=&motion=&bounce=&mode=&theme=&split=` (used by the presets in `../devices-v2.html`).

#### Ink skin (`skins/ink.css`, `skins/ink.js`; rubber-hose genre, §9.6 originality guard)
- **Fonts** (Google Fonts, injected by ink.js): *Limelight* for page titles/brand only, *Archivo* for the UI and *Bebas Neue* for numbers. (V2r1: Grandstander was dropped as too kiddish, §9.1a.)
- **Palette:** light is sepia paper `#EFE2C6`, ink `#1E1612` and maroon `#7A1E2C`. Dark is charcoal `#1D1A18`, cream ink `#F1E4C8` and pink `#F4A3B8`. Key text pairs are ≥5.7:1. Film grain + vignette are fixed overlays; the vignette flickers at 12fps only in stop.
- **Outlines:** ink.js pre-draws **3 rough frames** (uneven width, thicker bottom/right, a different radius per corner, pen overshoot on two corners) as SVG data-URI `border-image`s (`--ink-l0..2` / `--ink-d0..2`). Cards use 18px frames, controls 12px. The FAB and dial get inline SVG rings, and the dial pointer is a white glove.
- **Boil:** it swaps the frame (`--ink-fr`, `--ink-frs` for `.sm`, `data-ink-ui`/`data-ink-sm`) and cycles the seeds of its own `#inkw-ui`/`#inkw-sm` (feTurbulence + feDisplacementMap on the SVG art). In **stop**, everything boils at 12fps via `Motion.onFrame`. In **hybrid**, `.sm` boils at 12fps and the UI slowly. In **fluid**, the boil is slow and subtle (~1.4fps, only after 1.5s with no input). There is no boil under reduced motion or in a hidden tab. Displacement is stronger in stop. No filter runs on large areas: the cards' boil is a cached image swap.
- **Motion:** fluid uses squash & stretch on press (scaled by `--bounce`), the sheet lands with a squash, and its body follows through. Stop adds a 4-frame held-pose spring (`--ink-hold`, generated from `--bounce`) and 1–2 smear frames (directional blur) on sheet open/close and page changes.
- **Mascot "Penny"** (original): a coin-bodied piggy bank with a coin slot, ears, snout, pie-cut eyes, rubber-hose limbs and white gloves. It is drawn once and posed via CSS on `data-mood`: **idle** (breathe, sway, blink), **happy** (hop + wave), **worried** (hands to head, tremble, sweat), **sleepy** (eyes shut, Zs) and **cheer** (jump with squash/stretch, arms up, stars, smear lines). Fluid uses smooth easing, while stop and hybrid `.sm` use `steps()` (held frames).
- **Ornaments:** hero/today twinkles, a folder pen swash, an empty-state spotlight burst and a nudge moon. All art is removed when you switch to another skin.

#### Poster skin (`skins/poster.css` + `skins/poster.js`, V2 phase 2)
Realises §9.1. Everything is scoped to `html[data-skin="poster"]`; poster.js does nothing until that attribute is set (it watches it with a MutationObserver) and removes all it added when you switch away.
- **Fonts** (Google Fonts `<link>` injected by poster.js): **Alfa Slab One** for titles (`--font-display`), **Oswald** (condensed, variable wght) for numbers, tabs, ribbons, badges, the hero label and day headers (`--font-num`), **Yellowtail** for the brand only (`--font-script`; V2r1 cut it from everywhere else), and **Barlow** for body text and page subtitles (`--font-ui`).
- **Palette.** Light: `--bg #F3E6CC` cream, `--surface #FAF1DE`, `--text #3A1118`, `--primary #7A1E2C` maroon, `--primary-c #EDC35C` mustard, teal `--sam #1E6E68`. Dark (neon sign): `--bg #1C1A1B` charcoal, `--primary #FF6FAE` pink, `--primary-c #6B1D44`, teal `--sam #4FD6C6`. Extra `--pr-*` tokens cover misregistration colours, rays, halftone dots, the hero/today card, the bottle-cap metal, glow and grain. All text pairs were checked at AA or better (≥5.2:1).
- **Treatments:**
  - Paper grain (an SVG noise data-URI) on the body, sheet, main and tree panes.
  - Halftone corners on the hero and Today cards.
  - Offset-print misregistration (text-shadow) on big numbers and titles. These get `Motion.boil()`, so the offset jitters with `--boil-j` in stop motion.
  - `h2.sec` labels wrapped in forked **ribbon banners** (`span.pr-rib`).
  - Buttons are **enamel badges** with a gloss and a pinstripe rim. The FAB is a scalloped badge (`--pr-scallop`).
  - Chips and tags are **ticket stubs** (notched mask, dashed edge).
  - The dial is a **bottle cap / rotary dial**: a 24-crimp `--pr-cap` clip, a metal gradient and 12 finger holes.
- **Ornaments** (SVG `<symbol>`s in `#pr-defs`, 4 painted frames each):
  - Sunburst rays in the `hero`, `today` and `folder` slots.
  - Rays plus a scalloped seal in the `empty` and `nudge` slots.
  - Mascot **"Dottie"**: an original pin-up-style badge (victory rolls, polka-dot bandana). She has all 5 moods (`idle` · `happy` · `worried` with a sweat drop · `sleepy` with Zzz · `cheer` with a wink and stars), and switching mood is pure CSS on `[data-mood]`.
- **Motion:**
  - Fluid: frame 0 shows; the rays spin slowly (`150s / --bounce`); the mascot bobs, frets, dozes or jumps (`--spring`), with amplitude × `--bounce`.
  - Stop (or `.sm` in hybrid): frames swap with `step-end` every 83ms (≈12fps), mascot poses are stepped, and `#pr-rough` gets its seed cycled via `Motion.onFrame`.
  - Dark only: a rare neon flicker on the hero rays and the brand.
  - Reduced motion: the base reset leaves frame 0 static.

### 9.9 Priorities: core first (user, 2026-11-07)
Build bottom-up and serve the core before generality:
1. **Quick logging**: grab-and-go, plus log now / details later.
2. **Setting up folders and targets.**
3. **Trends**: checking in detail when there's time.

Everything else waits. Reviews weight these three in this order.

### 9.10 Exploration skins (secondary to the main focus)
- **`neon`: 80s Las Vegas neon.**
  - Sleek black with hot pink plus complementary electric colours. Glow spills onto neighbouring elements.
  - Progress bars are lit tubes. Unused or idle signs flicker faintly, like a back-alley sign.
  - Dragging a slider *charges* a tube or bulb, with an energy fill and a buzz and flash when full.
- **`art`: classical + psychedelic.**
  - Motifs borrowed from public-domain masters, drawn originally: a Hokusai-style great wave rolling gently in the background, and Van Gogh-style swirling brush-stroke textures. Psychedelic colour accents.
  - Sliders and progress fill like a cresting wave, or like paint spreading.
- **Controls match the skin (all skins, eventually).** Weight, inertia, snap feedback and motion follow the skin's material, like good game-feel. The current skins get this later; for now it's neon and art.
- Image generation (e.g. via ChatGPT) stays parked until the user can approve downloads (§9.7).

#### Neon skin (`skins/neon.css` + `skins/neon.js`, exploration)
Scoped to `html[data-skin="neon"]`; neon.js is inert unless that attribute is set and removes everything it added on switch-away (§9.8 contract).
- **Fonts** (injected): *Tilt Neon* (tube lettering) for titles and numbers, *Manrope* for UI/body and small row amounts, *Monoton* for the brand only.
- **Night (dark):** near-black wall `#0A090E`, hot pink `#FF3EA5` primary, with cyan, violet, amber and mint tubes. Day (light) is a daytime sign: pale concrete `#E4E2DE`, tubes unlit (glass colour, no glow) until hover, press, drag or focus. Text pairs are AA.
- **One glow switch:** `--nn-k` (1 = night, 0 = day, 1.7 = ignited). Every glow is `calc(var(--nn-k)*Npx)` in the element's own rule, so lighting something is just `--nn-k:1`. Glow sits on display type only (titles, hero/today/amount numbers); body text stays crisp.
- **Signs:** the hero is a tube-rimmed panel, and its ring casts a radial light spill onto the panel. Today is mint (red when over). Rings and sparklines use `drop-shadow` tubes. `.bar2` fills are tubes with a white-hot core (track overflow unclipped), and the target card gets a static spill. Pending stays the ONE accent: a lit pink edge tube (§9.1a). No mascot; there is a small original 4-point sparkle in the ornament slots.
- **Game-feel:** sliders charge (`--nn-v`; glow layer opacity and tube brightness follow the value). Single-tube sliders (bounce, settle) use an unlit glass remainder. You get a flash-snap and zap at detents (min/mid/max, or quarters for settle), a bigger flash at full, and a quiet WebAudio mains hum while dragging (off when the dial sound is off). The dial is a knurled black knob with a violet rim, a fixed amber pointer and 24 ticks that light cyan as they pass it, with a full-ring flash; they fade after the turn. The core is a round cap, pink, cyan when adjusting, amber when committing. Buttons ignite (brightness strike) via a pointerdown class: visual only, taps are never delayed.
- **Flicker:** rare (every 7–16s, only after 2.5s idle, night only, visible signs only). It animates opacity. There is none under reduced motion and none in a hidden tab, where the hum also stops.

#### Art skin (`skins/art.css` + `skins/art.js`, exploration)
Scoped to `html[data-skin="art"]`. art.js does nothing unless that attribute is set, and it removes its art, its CSS vars, the font link, its observers and its loops when you switch away (§9.8 contract). All artwork is generated procedurally as original SVG. Nothing is copied or traced.
- **Fonts** (injected): *Fraunces* for titles, the hero/Today numbers and the brand (italic), with the SOFT/WONK axes giving the 70s-poster flow. *DM Sans* for UI, body text and list numbers.
- **Palette.** Light is aged paper `#F1E9D8` with Prussian-blue ink `#1F4673`; you are cobalt and Sam is burnt sienna. Dark is a starry night: navy `#0D1322` with chrome-yellow `#F2C14E` as the primary. Text pairs are ≥5.0:1. The hero and Today cards are deep Prussian (madder red when over) with cream text at ≥10:1.
- **Psychedelic accents, used sparingly:** a flowing swash under page titles, a slowly rotating conic rim on the FAB, the active page dot and the dial's commit state. Nothing else uses them.
- **Great wave:** a curling lip with claw foam fingers and spray, in the hero and Today ornament slots. The layers roll at different rates. The wave is tonal (blue on blue) and masked away from the left. In the hero it sits bottom-right above a solid footer strip, so the crest stays clear of the big number. Hero text gets a halo text-shadow as a scrim.
- **Impasto swirls:** a seamless flow-field brush-stroke tile. It sits behind cards (masked to the top-right corner, about 15%), in the fills and on the page (≤5%, or ≤9% at night). The mascot is a swirling star: its spin speed and colour follow the mood, it becomes a crescent moon when sleepy, and it bursts on cheer. Folder, empty and nudge slots get a spiral halo.
- **Game-feel** (paint only, never the hit target):
  - The slider fill is a wave. Its crest grows with drag speed and curls back when the wave retreats, the fill trails by about 0.2s, and it splashes (drops plus a ripple) at 0/25/50/75/100 and on release.
  - Target and category fills spread in like paint, with a ragged brush edge.
  - The dial ring is a two-layer swirl. It follows the dial on a spring with a flick impulse (lag and overshoot), and the inner layer turns 1.55× faster.
- **Perf:** the rAF loops run only while something is settling. Stop motion writes at about 12fps (CSS `steps()`), and hybrid steps only `.sm`. A hidden tab pauses the animations. Under reduced motion there are no loops or splashes.
- **Known:** the thin wave lines (`#4B78AE`) are only 3.9:1 against cream. They are kept out from under text.

### 9.11 User review of V2 skins (2026-11-07). Feeds V3, **not a blocker** for the tech design
- **Overall:** happy with most designs. Everything can be **more stylish and design-led** while staying perfectly legible. Legibility is never traded away.
- **Poster:** the light mode is the strongest of the set, and dark mode is good but less legible. It can **commit harder to the pin-up / 1950s soda-bottle era**, at least in a few hero elements: bottle-shoulder curves, embossed script banners, bottle-cap badges and enamel-sign bevels. All of these stay original, with no brand marks (§9.6 guard).
- **Neon:** looks good, but **no light visibly bounces**. V3 needs real light: tubes cast coloured spill onto the surfaces and cards near them, reflections show on a glossy floor or panel, and lit elements tint whatever sits next to them.
- **Art:** reads as "a small theme on top" because the waves and swirls don't change the UI elements themselves. In V3 the art has to *be* the components: paint-stroke buttons, wave-shaped sheets and dividers, brush-texture fills, and type set like a museum label. Dark mode is less legible than light.
- **Dark-mode legibility:** a pattern across the skins, seen in other apps too. V3 fixes it the same way for every skin:
  - In dark mode, raise text weight or optical grade a notch (Roboto Flex `GRAD`), and use off-white text instead of pure white.
  - Keep grain, textures and glow out from behind body text. Glow goes on display type only.
  - Raise surface-to-surface contrast so cards separate without relying on borders.
  - Make the AA check apply to text drawn over the effects, not just against the base colour.
- **Fixed now:** the Settings skin picker showed "Undefined" for Neon and Art (labels were missing). It now shows the labels plus hint text.

### 9.12 Decision: Home shows pinned folders only (user, 2026-11-07)
- The folder tree is no longer on Home. It has its own **Folders** screen, reached from "All folders" on Home, the desktop side pane, or the breadcrumb.
- Home shows **Pinned**: a row of folder tiles with the parent name and spend. With nothing pinned, it shows **This month** (the current month folder) plus a "Pin folders" tile.
- Any folder can be pinned, subfolders included: a pin button in the folder header, or long-press → "Pin to Home".
- Pins are **shared** by both people (the `pinned` field on the synced folder). Per-person pins are an option later.
- The first nav tab is renamed Folders → **Home**. Back from a root folder goes to Home if it's pinned, otherwise to Folders.

## 8. Changelog
- 2026-11-06 v0: themes, IA, decisions D1–D8, thumb dial §4, feature list F1–F15. Prototype + wireframes created.
- 2026-11-06 v1: review round 1 → D2/D5 revised, D9–D10 added, dial §4 rewritten (see [REVIEW-LOG.md](REVIEW-LOG.md)).
- 2026-11-06 V2 phase 1 (`prototype-v2/`):
  - **Settings sheet** (gear): skin, theme, motion, a Bounce slider, Simple/Detailed, "Split & settle" (on by default; off hides paid/split chips, owe lines and Settle), dial, monthly target, and reminders.
  - **Motion:** spring curves are generated from `--bounce`, plus stop/hybrid stepping and boil.
  - **Simple mode by default:** a flat list with tag chips and a multi-select tag editor.
  - **Targets:** overall ₹60k/month and Goa ₹40k lifetime, with category/tag limits in Detailed. The live effect line in the add sheet goes red when it would go over.
  - **Hero leads with target progress**, per the positioning shift; the balance is a secondary line.
  - **Trends as page 3:** reached by swipe, page dots or the dial. It has a Today allowance card, target rings + sparklines, and a drill-down (folder → subfolder → tag → expenses, child status follows the parent unless it has its own target). Insights folded in.
  - **Simulated nudges:** a banner or full-screen, with Snooze in seconds for the demo, plus a demo nudge after 20s.
  - **Skin hooks:** see §9.8.
  - Seed tweak: "Big Basket weekly" moved to Nov 5, so Today starts on track.
- 2026-11-06 V2 scenario round 1 fixes → §9.2c (needs-review flag, To-sort queue, added-by/new-since, identifier hierarchy, no-overshoot sheets, rare deadpan mascots, stop = experimental). Details: [REVIEW-LOG](REVIEW-LOG.md#v2-scenario-round-1-2026-11-06-all-not-yet--fixed).
