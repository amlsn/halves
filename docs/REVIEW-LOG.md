# Review log: subagent critique rounds (cap: 3)

> Three independent critics, each working only from the files and the user's brief: **UX/visual**, **thumb-dial ergonomics** and **technical architecture**. Pass bar: every score ≥ 8 and no blockers.
> Related: [DESIGN.md](DESIGN.md) · [TECH-REVIEW.md](TECH-REVIEW.md)

## Round 1 (2026-11-06): all three NOT YET
| Critic | Scores |
|---|---|
| UX/visual | two-person clarity 6 · folders 6 · thumb zone 6 · clutter 6 · fun/elegance 7 · desktop 6 · a11y **3** · system 7 |
| Dial | job-fit 7 · learnability 6 · speed ceiling 6 · error-resistance **4** · feedback 5 |
| Tech | accuracy 7 · fit 8 · completeness 6 · risk 6 |

**Changed in response**

UX
- **Split wording:** "60/40" now reads "You 60 · Sam 40" everywhere.
- **Tree net:** the bare +/− is gone; it now says "Sam owes you ₹X" or "You owe Sam ₹X".
- **Folder view:** shows one hero net, with spend, expense count and "before settle-ups" on a subline. The "Inside" strip only appears when there are subfolders, and the wobble animation is gone.
- **Add sheet:** the amount comes first. The title field is optional and sits under the amount, and the close button moved to the corner.
- **Keypad:** it is always shown, even when the dial is on. The dial adjusts the amount on top of it; the earlier "turn the dial" pane that replaced the keypad has been removed.
- **Folder actions:** Move to… is wired up (a picker that blocks cycles), along with Rename, Pin, Archive (with undo) and a parent picker in New folder.
- **Settle up** takes an exact typed amount as well as the slider.
- **Accessibility:**
  - Tree rows use `treeitem` with `aria-expanded` and arrow-key expand/collapse; expense rows are keyboard-operable `role=button`.
  - Icons are `aria-hidden`.
  - Sheets have an accessible name, take focus, trap Tab and restore focus when closed.
  - The snackbar is `aria-live`. The slider has a label, min/max, `valuetext`, and supports arrows, PageUp/PageDown, Home and End.
  - Inputs use `:focus-visible` rings.
  - Touch targets are at least 40–44px.
  - Text now uses darker `--you-t`/`--sam-t` tokens, and filled people-colour areas use container colours with dark text.
- **Motion:** nothing animates forever any more (the hero blob moves only on hover/press). Under reduced motion, animations are `animation:none`.
- **Bugs fixed:**
  - Enter no longer double-fires on buttons.
  - Long-press in the picker no longer opens the folder menu.
  - Key handling is guarded when the sheet is gone.
  - Hero weight is mapped in rupees.
  - The Insights month is no longer hard-coded.
  - The desktop home no longer shows the balance twice.
  - The desktop dial shifts left of the side sheet.
  - devices.html frames no longer share localStorage (it is namespaced per frame).

Dial
- **Size:** 148px across, with a 40px ring and a 60px centre.
- **Hold vs turn:** holding opens the menu only after 380ms with less than 8px of movement; moving from the centre starts a turn instead.
- **Dead zones:** a 20px dead zone at the centre, and a 6° dead zone before a turn starts, so scrolling past the dial doesn't turn it.
- **Speed:** smoothed over 110ms in °/s. Thresholds: under 120 → ₹1, under 300 → ₹10, under 600 → ₹100, otherwise ₹500. A bigger step needs 3 clicks in a row at that speed, and the step resets after a 250ms pause. Mouse wheel goes through the same pipeline.
- **`pointercancel`** now resets the dial and can never count as a tap.
- **Money commits need a double-tap:** save, record payment and confirm. A single tap on the Save layer only shows a hint.
- **Pie menu:** R=118 over a 150° arc, with a label next to the highlighted option. Releasing in the centre cancels.
- **Paid by:** clockwise = Sam, counter-clockwise = You, instead of toggling.
- **Move layer:** turning fast jumps 3 items at a time. The Sections layer syncs with the current route.
- **Feedback:**
  - A WebAudio 2ms click that can be toggled off.
  - `vibrate` where supported; elsewhere, the iOS 18 `<input switch>` haptic trick.
  - The ticks snap to clicks.
  - The bubble pulses when the step size changes, and the next action is shown in the bubble and the centre's label.
- **Placement and settings:**
  - Raised to 22px plus the safe area.
  - Left-hand mirror (dial, menu arc, bubble, dock).
- **Accessibility:**
  - `role=slider` with `aria-valuetext` and a throttled live region.
  - Keyboard: arrows turn, PageUp/PageDown take big steps, Enter taps, Shift+Enter commits, Alt+Tab switches layer.
- **Dates** are built from local fields (no UTC off-by-one).

Tech: see the TECH-REVIEW.md changelog, v1.

## Round 2 (2026-11-06): tech FAVORABLE, UX and dial NOT YET
| Critic | Scores |
|---|---|
| UX/visual | clarity 6 · folders 7 · thumb zone 7 · clutter 7 · fun/elegance **8** · desktop 7 · a11y 6 · system 7. Blocker: the tree's per-folder "owes" contradicted the hero. |
| Dial | job-fit 8 · learnability 8 · speed 8 · error-resistance 7 · feedback 7 |
| Tech | accuracy 8 · fit 9 · completeness 8 · risk 8 → **FAVORABLE** |

**Changed in response**

UX
- **Tree:** rows show spend only, in two lines, so "owes" wording appears only in the hero and the folder view, which carries the "before settle-ups" caveat.
- **Archived (n)** row at the bottom of the tree, with Restore.
- **Collapsed tree groups** are `inert`, so they can't be tabbed into. The tree gets Up/Down/Home/End navigation and updates `aria-expanded` and the toggle labels.
- **Add sheet with the dial on:** Save and a dial hint share one sticky row next to the dial, replacing the 104px gap. Keys are 56px. Screens up to 720px tall get a compact layout (chips in one scrolling row, a 124px dial), so the 375×667 sheet fits with no scrolling (measured).
- **Dial defaults off with a fine pointer (desktop).** The coach popup only shows on touch. Device previews use `?touch=1`.
- **Snackbar** sits above the dial when the dial is on.
- **Undo** added to edit-save and settle.
- **New folder:** the parent picker keeps both the name and the chosen look.
- **guessFolder** picks the current month (by the TODAY constant) inside the current year and skips archived folders.
- **Style cleanup:** dead keyframes removed, `.ptitle` class added, the commit state uses sun rather than Sam's teal, the preset reads "You 60", and DESIGN.md decisions are in order.

Dial
- **Double-tap timing:** a single 320ms window. Double-tap commits only on the Amount and Save layers (and Adjust in slider sheets); a double-tap anywhere else just moves to the next field twice.
- **iOS audio:** `AudioContext` resume is unlocked on pointerup and keydown, which iOS counts as user gestures. A real-device iOS test is still needed.
- **One-layer contexts:** a hold there is a no-op that shows "Only one mode here", not a tap.
- **Layer key** changed from Alt+Tab to `L`.
- **ARIA:** the wrapper is `role=group`, the ring is `role=spinbutton` with `valuenow`/`valuetext`, and the core is a separate labelled button.
- **Wheel input:** 100px per click, with `deltaMode` handled.
- **Pie menu:** a 0.35 rad angular cap, so sliding off the menu cancels.
- **Hold check** now uses the last pointer position.

Tech (v1.1)
- Backup is off the DO (R2, or else D1 plus a download).
- The CTE dedupes and the anchor is checked.
- `ops.fields` supports field-level merge.
- Admin paths verify the Access JWT.
- Payer/share PKs and sum invariants; FX rounding rule.
- Trim-rule wording; a 5 s WebSocket auth timeout; the pair's time zone is stored.

## Round 3 (final, 2026-11-06): dial FAVORABLE, tech FAVORABLE (round 2), UX 7/8 dimensions ≥8
| Critic | Scores |
|---|---|
| UX/visual | clarity 8 · folders 8 · thumb zone **7** · clutter 8 · fun/elegance 8 · desktop 8 · a11y 8 · system 8. "One score short", with 3 small fixes named and expected to make it FAVORABLE without another round. |
| Dial | 8 · 8 · 8 · 8 · 8 → **FAVORABLE** (the feedback score depends on the iOS device spike) |

**Applied after round 3** (the cap was reached, so these were self-verified in the browser instead of re-reviewed):
- **History routing:** each route pushes a history state. System Back / iOS edge-swipe walks up the folder path, and closes an open sheet first. Verified: nov → Back → 2026; sheet open → Back → sheet closed, route unchanged → Back → home.
- **Cascade fix:** the `max-height:720px` block now comes after the base `.saverow` rules. Verified on 375×667: the row is 122px, the dial is 124px, the last key ends above the row, and nothing scrolls.
- **Save buttons in other sheets** (Settle, Default split, New folder, Rename) are wrapped into `.saverow` automatically with a contextual dial hint. The old 104px-gap rule is removed.
- **Dial polish:** on short screens the centre is 52px (a 36px ring) and the press radius scales down. The hint now reads "on Amount, double-tap = save".

**Known, accepted for this phase (tracked):**
- iOS haptics while turning probably won't fire (TECH-REVIEW §7 spike). Audio click is the fallback.
- Double-tap-to-save on the Amount layer makes "next" taps there wait 320ms (DESIGN Q2).
- Treeitems are still all tab stops (no roving tabindex), and the chevron is a nested button.
- No drag-to-move in the desktop tree yet.

## V2 scenario round 1 (2026-11-06): all NOT YET → fixed
Reviewed against DESIGN §9 incl. new user feedback §9.1a. Reports (session scratch): careful, quick, later, partner+aesthetic.

| Scenario / critic | Score | Verdict |
|---|---|---|
| Careful happy flow | 6 | NOT YET (blocker: folder pick reset a custom split) |
| Grab-and-go quick add | 6 | NOT YET (sheet overshoot moved keys under the thumb) |
| Log now, details later | 5 | NOT YET (pending = split only; no queue) |
| Partner view | 4 | NOT YET (no added-by / since-last-looked) |
| Poster aesthetic | 6.5 | NOT YET |
| Ink aesthetic | 5 | NOT YET (too kiddish, §9.1a) |

**Applied** (`prototype-v2/index.html`, `skins/*`, `devices-v2.html`; browser-verified, 0 console errors):
- **Careful:** a slider, preset, or dial split change sets `shareTouched`. Folder picks (tree and dial) go through `folderDefaults()` and never reset a chosen split. The chip row wraps on short screens, so Tags is on-screen at 375×667 (the sheet scrolls 15px). The dial Tags layer no longer traps: a centre tap always advances, and a **ring press** (or Space) toggles the focused tag. The "next field" hint from Split is fixed (it now says Date). Poster selected chips are filled maroon/pink. The nudge hides when the add sheet opens. An off-month date says it's outside the month target. The snack no longer wraps. Latest is sorted by when logged.
- **Grab-and-go:** a new `--spring-sheet` token (emphasised-decelerate, 0.2s, no overshoot at any Bounce; stop = 2 steps, first frame never past rest). The keypad pane only fades. Ink's sheet squash/follow-through is removed (the grab-handle swing stays as decoration). Measured on the keypad "5": 0 px overshoot in every skin/motion/bounce combination, 0–20 px off at 150 ms, within 4 px by ~200 ms. Stepped curves clamp their first frame. Dial: down-shifts on ~instant velocity (no overshoot when slowing), and the step survives a regrip of up to 600 ms. Enter in the title saves. Recent-title quick chips (up to 5, one tap, no keyboard). Commit hold is 380 → 160 ms. The snack reads "₹240 logged · November" with a success haptic. The idle dial centre shows "add" and a ring press counts as a tap.
- **Later:** a separate `review` flag. It is set automatically when saved without a title, or by **Finish later** next to Save (and in the dial hold-menu as "Finish later"). Saving from the edit sheet or "Mark sorted" clears it. `toSort()` = review OR split-undecided (the review half works with split off). "N to sort" is a button on the Home hero, Activity and Trends, and opens the **To-sort queue**: oldest first, inline one-tap actions (Sorted / Own / 50-50), plus "One by one", which steps through detail sheets ("1 of N") with auto-next after each resolve or edit. Amount-only entries store `cat:null` and title `''`, and render as italic "Untitled" / "Uncategorised" rather than as complete. The hero balance says "excl. N with split undecided". Edit fx shows "no change".
- **Partner:** `by`/`at` on every expense, with seed data from both people (one Sam entry was logged without details). A fake clock (TODAY 18:30) drives relative times. Detail shows "Added by Sam · 10h ago" next to Paid by. A row shows "added by X" only when it differs from the payer. On Home, a **"New from Sam · N"** section sits right under the hero, with Mark seen (in memory).
- **Aesthetic (§9.1a):**
  - **Identifier hierarchy, not colour.** Payer is a letter disc in the left column (filled = you, outlined = Sam). Folder is small caps under the amount. Tags are inline muted `#text` (tag stubs dropped from rows). Pending is the single accent: a left bar plus a TO SORT label.
  - **Poster.** Script is used on the brand only; the hero label, day headers and subtitles moved to Oswald/Barlow. Neon is on the hero only, there is no halftone on Today, card borders are 1.5 px, and numbers no longer jitter. Dottie is deadpan: half-lidded eyes, a lipstick line, a raised brow, no blush, one sparkle. Her bob stops after 2 cycles.
  - **Ink.** Grandstander is replaced by Archivo (UI) and Bebas Neue (numbers); Limelight is used for titles only. The light hero is maroon with a cream ring. Penny is deadpan: small half-lidded eyes, no cheeks, still apart from a blink every 6 s, and one hop on cheer. Stop motion is labelled **experimental**: UI frames at 6 fps, lists/sheets/kv never boil, grain at 4 fps, no strobing vignette, no large-area smear, and grain sits under sheets.
  - **Mascot setting.** Rare (the default; shown only on state change and nudges) · Always · Off.
  - **devices-v2.** Adds poster/hybrid, dark presets, and "(exp.)" labels on the stop presets.

**Deliberately not done (tracked):**
- A "View as Sam" toggle (we seed Sam's entries instead).
- A dial "recent amounts" detent and a first-detent ₹10 default.
- A slow-double-tap guard on Amount (quick #5).
- Making the dial-on save row stop covering the split slider (careful #5).
- Hero delta/pulse after saving, and a Trends card pulse.
- Nudge "Finish N" variant.
- Settle "sort first" gate.
- Penny/Dottie full redraw (proportions are only nudged).
- Desktop hero-ray re-centring.
- Ribbon removal on Trends.
- Font preloading.
- Ink `--ink-fr` root-var perf (A6.1).

**Known trade-off:** after a regrip, the first detent keeps the big step for about 140 ms before slowing can downshift. That is the price of "keep the step through a regrip".

## V2 scenario round 2 (2026-11-07): all NOT YET → fixed
| Scenario / critic | Score | Verdict |
|---|---|---|
| Careful | 7.5 | NOT YET |
| Quick | 6.5 | NOT YET (blocker: small-phone keypad hidden) |
| Later | 7 | NOT YET |
| Partner | 7.5 | NOT YET |
| Poster | 8 | — |
| Ink | 7.5 | — |

Priorities (DESIGN §9.9, core first). Everything below was browser-verified in my own tab, with 0 console errors.

**Changes:**
1. **Small-phone keypad (blocker).**
   - New `max-height:720px` budget: a smaller amount display and inputs, one-row chips with an edge fade, the editor min-height set to the keypad's real height, 42px keys, and a 52px Save.
   - With the dial on, chips go to one scrolling row at any height. The chip order is now paid · folder · **tags** · date, so Tags stays visible.
   - The add sheet's dial hint is removed (the bubble and coach explain the dial).
   - The one-time dial coach is hidden while a sheet is open (it was covering keys 2/3/5/6).
   - **Measured:** `elementFromPoint` hits all 12 keys with `scrollTop=0` in all 18 combinations: modern/poster/ink × 360×640 / 375×667 / 390×844 × dial on/off.
2. **Dial regrip.**
   - Removed the 140ms down-shift freeze.
   - Samples now carry their own start time, so the dead-zone sample is no longer inflated, and the first detent after a regrip knows the real speed.
   - The kept step only serves up-shift (a fast regrip resumes it without re-ramping).
   - **Measured** (synthetic pointer events on the real handler): fast 100° → 250ms lift → 70° at 180°/s ends at **exactly ₹240** (it used to end at 420/440), in 0.88s of turning. A single 165° stroke with no regrip is unchanged.
3. **Finish later and slow double-tap.**
   - Save keeps its full-width spot. "Finish later" is a small text action above it.
   - Slow double-tap: a second tap within 650ms of the first (amount > 0) undoes the auto-advance and saves. Verified with a 420ms gap.
4. **Nudges.**
   - `fireNudge(style,sub,still)` re-tests its reason on every deferred retry. Logging while the nudge is deferred cancels it (verified: no banner 10s after a save).
   - The copy counts pending items ("3 items to finish") and offers **Finish N**, which opens the queue.
   - At the day's last reminder, pending items fire the nudge even if something was logged, so a quick add no longer silences the evening nudge. The demo nudge uses a predicate too.
5. **Review flag.**
   - Review only clears when the item has a title: Sorted, a split resolve and an edit-save all keep an untitled item to sort. "Mark sorted" isn't offered on untitled items.
   - One by one tracks `qSeen` and never reopens an item. Skip was added.
   - Finishing opens the edit sheet on the **split pane** ("who shares it?") with the title focused.
   - Recent-title chips now show in edit. They are ranked by frequency × recency, prefix-filter while typing, and keep their height after a pick (no keypad jump).
6. **Partner view.**
   - Sort snacks show the money effect in words, e.g. "Villa (3 nights) → split 50/50 · you owe Sam ₹9,300 more · 2 left", and the hero pulses.
   - Sam's untitled items can't be one-tap sorted: the queue shows "Sam's to finish", and the detail sheet's "Add details for Sam" asks for a second tap.
   - "Own" becomes "Sam's own" / "Your own".
   - Save snacks carry target feedback, e.g. "₹240 logged · November · Nov ₹11,805 left".
   - The hero has a status word plus icon (On track / Close to limit / Over). Trends cards show the status word, and warning starts at 85%.
   - The balance caveat is now "excl. undecided splits" (no competing number).
   - Dial tag order is frozen per draft, so focus no longer jumps.
   - With the dial on, split presets sit above the slider (all 4 visible).
   - New-from-Sam rows show "10h ago", and Latest no longer repeats them.
   - The dial Quick actions get "To sort (N)".
   - Rows drop the "You 70 · Sam 30" label (it's in the detail sheet), so tags fit.
   - The date pane re-highlights after a native date pick.
7. **Skin clutter.**
   - Poster: one ribbon per screen (the first section). Other section heads are plain double-rule heads. The hero ring track is more visible.
   - Ink: day-group lists use a hairline pen rule instead of a heavy inked frame, the TO SORT label is 12px, and the hero ornaments are hidden in Rare-mascot mode.

**Not done (tracked):**
- Recent-amount dial detents.
- A Settings toggle "untitled entries go to To sort" (it conflicts with the round-2 rule; this needs a product decision).
- The hero leading with "left" rather than spent (careful #10).
- The Trends title truncation on ink.
- Folder `fnet` / `tgtCard` "incl. N unsorted" caveats.
- Settle "sort first" gate.
- A "You/Me" label inside the payer disc.
- Ink `--ink-fr` root-var perf.
- I did not touch skins/neon.\* or skins/art.\*.

## V2 scenario round 3 (final, 2026-11-07)
| Scenario | R1 | R2 | R3 |
|---|---|---|---|
| Careful flow | 6 | 7.5 | **8.5 ✅** |
| Grab-and-go | 6 | 6.5 | 7.5 → snack fix applied (reviewer est. ~8.5) |
| Details later | 5 | 7 | **8 ✅** |
| Partner view | 4 | 7.5 | **8.5 ✅** |
| Skins | poster 6.5 / ink 5 | 8 / 7.5 | poster **8.5**, art **8.5**, neon **8**, ink 7.5 → specificity fix applied |

Grab-and-go practised times, all three phone sizes:
- keypad 2.8–2.9 s
- dial 2.8 s in one stroke, 3.1 s with a regrip (+7%)
- amount + recent-title chip 3.5 s

**Post-R3 fixes, self-verified:**
- The Undo snackbar hides when any sheet opens. It was sitting over the keypad, so tapping 9 or ⌫ undid the previous expense.
- `ink.css`: the light list borders now apply.

**Reviewer V3 recommendation:**
- Poster is the primary skin, with art as a second.
- Neon stays as an optional night skin.
- Ink stays only if it's reworked.
- Stop-motion is kept as an experimental option only (hybrid for accents).

**Open, low priority:**
- The Date chip sits half off-screen on short phones when the dial is on.
- The slider track is covered by the dial at first.
- On Android, the keyboard can hide the "who shares" pane.
- Untitled items can't be cleared without adding a title. Needs a call on an "untitled is fine" toggle.
- Dial recent-amount detents.
- Neon: a sparkle overlaps the status pill, and day mode feels generic.

Full details are in the reviewers' scratch reports (session-local).
