# plan-UI — making the reader *look* the way it reads

[plan-desktop.md](plan-desktop.md) made the app installable.
[plan-desktop-v2.md](plan-desktop-v2.md) made standalone credible.
[plan-reader-v3.md](plan-reader-v3.md) is about **capability** — what the reader
can do. This plan is about **surface** — what it looks like while doing it.

[docs/DESIGN.md](docs/DESIGN.md) settled the language: *a warm near-black room
with one ember in it.* The tokens are in place and the app largely honors them.
What's missing is the next layer down — the places where the language is stated
but not carried through, and the visual ideas the language implies but nobody
has built yet.

Nothing here changes what the app can do. Every item is either a seam to close
or a piece of craft to add.

Effort tags follow [backlog.md](backlog.md): S (≤½ day), M (1–2 days),
L (3–5 days), XL (>1 week).

## Goal

Three things, in order:

1. **The room is consistent.** No cool grey, no stock emoji, no stray drop
   shadow. Every pixel in the app is either a Hearth Noir token or a book.
2. **The book is the subject.** App chrome recedes, appears when asked for,
   leaves without a jump cut, and never frames a sepia page in a black border.
3. **Motion and depth mean something.** Depth is warmth + a border. Motion is
   short, directional, and always reversible.

## Where the surface falls short today

| Area | Today | What "designed" means |
| --- | --- | --- |
| Palette discipline | `rgba(20, 21, 25, …)` — the exact `#141519` DESIGN.md rejects — appears in both reader chrome gradients and three library fills; `#fff`, `#ff6b81`, `rgba(120, 20, 20, .85)` sit outside the palette | Every color is a token or derived from one with `color-mix` |
| Fallback covers | 8 palettes in [cover.ts](src/lib/cover.ts), all cool blue/purple/green — the largest colored surface in the library actively fights the warm black | A warm gradient family that reads as *this* app's shelf |
| Icons | One SVG ribbon, one `🔍` colour emoji, one `☰`, one `‹`, one `Aa` — four idioms in a five-button cluster | One bundled monochrome stroke set at one weight |
| Reading themes | Sepia/light theme the page only; the chrome above and below stays warm-black with a `--bg` gradient over paper | Chrome adopts the reading theme; the whole screen is one surface |
| Chrome motion | Enters with `rChrome`; **hides by unmounting** — a hard cut | Symmetric enter/exit, and idle auto-hide |
| Screen transitions | `screen === "reader"` swaps components with no transition | Opening a book is the app's signature move |
| Dimming | `.dim-overlay` is `#000` over a warm room — it desaturates the ember | Warm scrim, and a real night-shift warm-shift |
| Section labels | `.eyebrow` (11.5px/0.14em/`--section-label`) *and* `.section-label` (12.5px/0.04em/`--muted`) both in use | One label style, the one DESIGN.md names |
| Depth | "Never a drop shadow" — but `.transfer-banner`, `.settings-preview` and `.accent-swatch` carry them | Documented layer ladder, zero shadows |
| Focus | Four `:focus` rules in ~4,400 lines of CSS; no global ring | Every interactive element has a visible accent ring |
| Comic stage | Pages sit on a 135° checkerboard — a placeholder texture that ships | A matte that belongs in the room |

## 1. Close the seams in Hearth Noir

Cheap, mechanical, and the highest ratio of visible improvement to effort.
Everything here is a find-and-replace with a judgment call attached.

- [x] **Purge cool grey — S.** `rgba(20, 21, 25, 0)` in `.chrome-top` /
  `.chrome-bottom` ([app.css:1132](src/styles/app.css:1132),
  [:1264](src/styles/app.css:1264)) is `#141519` at zero alpha. Because sRGB
  gradients interpolate the *color* as well as the alpha, the fade genuinely
  passes through a cool haze on its way out — the one thing DESIGN.md names as
  wrong. Use `color-mix(in srgb, var(--bg) 0%, transparent)` or simply
  `transparent` against a `--bg` stop. Same fix for
  `.cover-overflow` / `.cover-badge` fills in
  [library.css:441](src/styles/library.css:441) and
  [:452](src/styles/library.css:452).
- [x] **Scrim tokens — S.** Six independent `rgba(0, 0, 0, 0.28–0.45)`
  backdrops exist across `app.css`, `flows.css`, `opds.css`, `library.css`.
  Add `--scrim` (modal backdrops) and `--scrim-soft` (cover progress trough,
  badge fills), both warm — `color-mix(in srgb, #000 55%, var(--bg))` rather
  than pure black, so a backdrop over the library still reads as the same room.
- [x] **Off-palette one-offs — S.** `#ff6b81`
  ([library.css:410](src/styles/library.css:410)) is a cool pink where
  `--danger` (`#e0574a`) belongs. `rgba(120, 20, 20, .85)`
  ([library.css:1071](src/styles/library.css:1071)) should be a `--danger`
  mix. `#fff` on badges should be `--fg`. Three lines, three fewer hues.
- [x] **Delete the last shadows — S.** DESIGN.md: *depth comes from a border
  and a surface step, never a drop shadow.* `.transfer-banner` has
  `0 8px 28px rgba(0,0,0,.28)` ([app.css:718](src/styles/app.css:718));
  `.settings-preview` and `.accent-swatch` carry `inset` hairlines that a
  `--line` border would express honestly. Replace with the surface step the
  rule prescribes.
- [x] **One section label — S.** `.section-label` predates `.eyebrow` and is
  still used by the home shelves and the grid heading
  ([HomeShelves.tsx:25](src/components/library/HomeShelves.tsx:25),
  [Library.tsx:1186](src/components/Library.tsx:1186)). Fold it into
  `.eyebrow`, which is the style DESIGN.md documents, and delete the duplicate.
- [x] **Reconcile the accent table — S.** `tokens.css` now ships orange as
  `#d68a30`, but [docs/DESIGN.md](docs/DESIGN.md) still documents `#ffbf00`.
  The code is right — `#ffbf00` is a pure yellow that blows past the other five
  in chroma — so update the doc, and while there, re-check all six against
  `--on-accent` per DESIGN.md's own instruction that a new accent must be
  measured, not assumed.
- [x] **Layer ladder as tokens — S.** `z-index` is currently literal and
  slightly wrong: `.dim-overlay` is 60, but `.epub-pop` is 61 — so a dictionary
  popover glows at full brightness over a page the reader deliberately dimmed.
  Introduce `--z-content / --z-chrome / --z-panel / --z-pop / --z-scrim /
  --z-system` and decide, once, whether dimming is above or below popovers.
  (It should be above — it's a lamp, not a modal.)

## 2. Warm the fallback covers

Worth its own section because it is the single most visible color decision in
the app and it currently contradicts the design doc.

[cover.ts](src/lib/cover.ts) generates a title-hashed gradient for every book
with no artwork. All eight palettes are cool: `#2f3d5c`, `#3a3550`, `#26414c`,
`#3a2f5c`… On a shelf of imported EPUBs — the common standalone case — the
majority of the screen is cool blue on warm black. DESIGN.md's own warning
about stock blue on `#0d0b0a` applies directly.

- [x] **Warm palette family — S.** Retune all eight toward the room: oxblood,
  ochre, moss, ink-brown, plum, teal-slate — the same hue discipline the six
  accents got. Keep the ink colors, which are already warm-neutral.
- [x] **Palette from the accent — M.** Better: derive the family at runtime
  from `--accent` via `color-mix`, so a reader on the teal accent gets a teal
  shelf. Eight fixed offsets around the accent hue rather than eight literals.
  This makes the accent picker feel like it changes the app, not one button.
- [x] **Treatment, not just gradient — M.** The fallback is a *typographic*
  cover ([CoverArt.tsx](src/components/CoverArt.tsx)) and should look designed:
  a hairline rule under the kind label, the title set in Newsreader with real
  optical sizing at the card's size, and the author baseline-aligned to the
  card bottom. Today it is three stacked divs with `opacity: 0.6/0.7`.
- [x] **Dominant-color tint for real covers — M.** Sample the cover thumbnail
  once at decode time, store the color on the record, and use it for the card's
  hover border and the reader's ambient matte (§4). One cheap canvas read;
  large payoff in "this app knows what book I'm in."

## 3. One icon system

The reader's top-right cluster is `🔍`, `☰`, an SVG ribbon, and `Aa`. On iOS the
first renders as full-color Apple emoji — saturated blue-grey, at a different
optical weight than everything beside it, immune to `--accent`, and the only
place in the app where a color arrives that the palette did not choose.

- [x] **Bundled stroke set — M.** ~24 glyphs at 1.5px stroke, 24px grid, all
  `currentColor`: search, contents, bookmark (filled + outline), settings,
  chevrons, close, back, plus/minus, sort, filter, grid/list, download, star,
  server, tag, share. Ship as inline SVG components extending
  [icons.tsx](src/components/icons.tsx) — no icon-font dependency, no CDN, and
  they inherit `--accent` on active states for free.
- [x] **Retire text-glyph controls — S.** `‹ Library`, `↩ Return`, `×` in
  drawer heads, `‹`/`›` side arrows. Text glyphs vary by platform font and
  don't optically center in a 40px button. Same set, same weight.
- [x] **Optical alignment pass — S.** `.nav-btn` is a 40px box with the glyph
  centered mathematically; a chevron and a ribbon need different offsets to
  *look* centered. One-time nudge per icon, baked into the components.

## 4. The reading surface

This is where the app either feels like a reader or feels like a web view.

- [ ] **Chrome follows the reading theme — M.** The biggest single seam. When
  `prefs.theme` is `sepia` or `light`, the page becomes `#e8dcc2` / `#f4efe4`
  while `.chrome-top` still paints a `--bg` warm-black gradient over it, and
  the settings drawer stays `--popover`. On a tablet in sepia this reads as a
  bug. Introduce a page-theme-scoped chrome variable set (`--chrome-bg`,
  `--chrome-fg`, `--chrome-rule`) driven by the existing
  `[data-reading-theme]` attribute on `.epub-wrap` — lifted to the reader root
  so the chrome, side arrows, thumb strip, and drawers all inherit it. The
  library stays dark-only, as DESIGN.md intends; only the *reading screen*
  follows the page.
- [ ] **Symmetric chrome motion — S.** [Reader.tsx:582](src/components/Reader.tsx:582)
  gates chrome on `{chrome && …}`, so it enters with `rChrome` and leaves by
  disappearing. Keep it mounted and drive `opacity` + `translateY` from a
  `data-chrome` attribute, so hide is as considered as show. Reduced-motion
  already collapses the durations to 0.01ms.
- [ ] **Idle auto-hide — S.** Chrome fades after ~4s of no interaction while
  reading (not while a panel is open, not while scrubbing). This is what makes
  a tap-to-show control feel intentional rather than sticky.
- [ ] **Persistent page-edge progress — S.** A 2px hairline at the very bottom
  of the screen, always visible, `--accent` on `--progress-track`, independent
  of the chrome. The reader always knows where they are without summoning the
  bar. It also gives the bottom of the screen a deliberate edge, which a
  full-bleed page currently lacks.
- [ ] **Page-turn motion — M.** [plan-reader-v3.md](plan-reader-v3.md) lists
  this as a capability; this is its visual spec. Three options — *slide*
  (page translates, `--duration-med`, `--ease-out`), *fade* (crossfade,
  `--duration-fast`), *none*. No curl. In two-column mode the pair moves as one
  sheet. The transform must be on a wrapper, never the Readium iframe.
- [ ] **Warm dimming — S.** `.dim-overlay` is `background: #000`
  ([app.css:18](src/styles/app.css:18)). Over a warm near-black, black dimming
  pulls the room toward neutral — the ember dulls first. Use a warm scrim
  (`#1a0f08`-ish at the same alpha ramp) so dimming *deepens* the room.
- [ ] **Night warmth — M.** A second slider beside brightness that warm-shifts
  the page (an amber overlay in `multiply`, or a `sepia()`/`hue-rotate` filter
  on the page container only). Night Shift for the book. This is the feature
  the design language is already named after and it does not exist yet.
- [ ] **Chapter typography — M.** Newsreader is bundled and barely exercised.
  Inject into the Readium stylesheet: a raised initial on the first paragraph
  of a chapter, small-caps for the first three or four words, a hairline rule
  under the chapter title, and hanging punctuation. Gate it as a single
  "Typographic flourishes" toggle in the settings drawer — off for readers who
  want plain text, on by default because it is the thing that makes the app
  look like a book instead of a webpage.
- [ ] **Running heads — S.** In paginated mode, a `--faint` running head
  (book title verso, chapter recto) and a folio, set in the reading face, above
  and below the measure. Costs a line of the column and buys the whole
  page-as-artifact impression.

## 5. Comics and fixed-layout pages

The comic stage was built for correctness and never got a design pass.

- [ ] **Retire the checkerboard — S.** `.comic-page` renders a 135°
  `repeating-linear-gradient` between `--surface` and `--surface2`
  ([app.css:1053](src/styles/app.css:1053)) as its loading state — a
  transparency-checkerboard idiom borrowed from image editors. It reads as
  "asset missing," not "loading." Replace with a flat `--surface2` matte plus
  the existing shimmer keyframe, matching how covers already load.
- [ ] **Ambient matte — M.** Behind the page, a very low-opacity radial wash in
  the page's dominant color (§2). Artwork stops floating on a void, and every
  book gets a slightly different room. Cheap, and it is the comic equivalent of
  the chapter drop cap: pure atmosphere.
- [ ] **Spread gutter — S.** Two-page spreads are two boxes with `gap: 10px`.
  Real facing pages meet at a gutter: collapse the gap to zero and draw a
  narrow inner shading gradient on the facing edges. Instantly reads as a bound
  book rather than two files.
- [ ] **Thumb strip as a filmstrip — M.** 26×39px thumbs with a 2px accent
  outline is functional. Give the active thumb a scale step and a soft accent
  glow, center it in the strip on page change, and show chapter/volume breaks
  as a hairline gap. Also add a peek preview on scrub — the `.scrub-bubble` is
  already a good component, and for comics it should carry the page thumbnail.
- [ ] **Fit-mode framing — S.** When a page doesn't fill the stage (fit-height
  on a wide screen), the letterbox is currently just `--bg`. Give it the matte
  treatment and a `--line` hairline on the page edge, so the page reads as a
  physical object on a surface.

## 6. The library

- [ ] **Opening a book is the signature transition — L.** Today
  [App.tsx](src/App.tsx) swaps `<Library />` for `<Reader />` with no
  transition. Make the tapped cover the transition: it scales and cross-fades
  into the reading surface (`--duration-slow`, `--ease-out`), chrome fading in
  behind it. Closing reverses into the card's position in the grid. This is one
  animation and it does more for perceived quality than any other item here.
  Requires the reader to mount under the library for a frame, and a
  `prefers-reduced-motion` path that is a plain crossfade.
- [ ] **Staggered shelf entrance — S.** Cover cards fade+rise with a ~20ms
  per-card delay capped at ~8 cards. The `rUp` keyframe already exists; only
  the delay and the cap are missing. Reduced-motion drops the transform.
- [ ] **Continue-reading hero — M.** `--hero-surface` (`#141110`) exists as a
  token for a hero card that the current home shelves don't really build — the
  first shelf is the same 118px cards as every other row. Give the single most
  recent book a wide card: large cover, title in Newsreader, a real progress
  bar with "3h 12m left," and one accent Resume button. It is the first thing
  on the screen and it should look like it.
- [ ] **Cover consistency — M.** Grid covers are a fixed box with
  `object-fit: cover`, so a square comic cover and a tall EPUB cover are both
  cropped to 2:3 from the center — which decapitates portrait-format comic
  covers. Either letterbox onto the card's own gradient (preserving the
  artwork) or crop deliberately with a top-weighted origin so titles survive.
  Coordinate with the layout/density work in flight (`store/display.ts`,
  `library/DisplayControl.tsx`), which changes the box but not the fit.
- [ ] **Empty and first-run states — S.** `.empty-state` is 14px muted text in
  the middle of a void. Each empty state (no books, no results, no favorites,
  offline) deserves a mark, one sentence, and one accent action.
- [ ] **Token the cover progress bar — S.** `.cover-progress` uses
  `rgba(0,0,0,.28)` as a trough where `--progress-track` exists, and
  `CoverArt.tsx` hardcodes `transition: opacity .25s ease` where
  `--duration-med` exists. Small, but it's the pattern that lets the tokens
  actually mean something.

## 7. Motion, focus, and the accessible surface

- [ ] **Motion spec — S.** Write the table DESIGN.md is missing: what animates,
  which duration token, which easing, and what reduced-motion does instead.
  Currently `0.18s ease`, `.25s ease`, and `.15s ease` are all still hardcoded
  in places that have tokens available
  ([epub.css:14](src/styles/epub.css:14), [CoverArt.tsx](src/components/CoverArt.tsx),
  [app.css:1540](src/styles/app.css:1540)). Then enforce it.
- [ ] **Global focus ring — S.** Four `:focus` rules exist in ~4,400 lines of
  CSS. A desktop user tabbing through the library gets no feedback at all.
  One rule: `:focus-visible { outline: 2px solid var(--accent);
  outline-offset: 2px; border-radius: inherit; }` plus opt-outs where an
  element already indicates focus. This is a keyboard-accessibility fix that
  also happens to be visible design.
- [ ] **Contrast floor — S.** Measured against `--bg` (`#0d0b0a`):
  `--fg` 15.5:1, `--muted` 5.8:1, `--section-label` 4.7:1,
  `--placeholder` 3.9:1, `--faint` 3.1:1. The last two fail AA (4.5:1) for
  body-size text. That is acceptable for a decorative folio and wrong for
  placeholder text a user has to read. Lighten `--placeholder` to ~4.5:1, and
  document `--faint` as large-text/decorative-only so future use is deliberate.
- [ ] **High-contrast variant — M.** `prefers-contrast: more` raises `--line`,
  `--muted` and `--section-label` and drops `--faint` entirely. One media block
  over the token set; no component changes.
- [ ] **Dynamic type for chrome — M.** Chrome font sizes are literal px
  throughout (14.5, 13, 11.5…). Move to a `--type-scale` multiplier on `:root`
  driven by an accessibility setting, so the whole chrome scales together
  rather than the book text scaling alone. Paired with v3's dynamic-type item.

## 8. Identity

- [ ] **A wordmark, not a string — S.** "CB8" currently appears as `.eyebrow`
  text on the connect screen and the crash screen. The mark exists
  (`~/cb8_flutter/assets/icon/`) and is already the app icon; render it as SVG
  in-app, sized to the eyebrow, so first launch and last resort both carry it.
- [ ] **Branded loading — S.** Boot is `<div className="reader-message">
  Loading…</div>`. It's the first frame of the app. The mark, an ember pulse on
  `--accent`, and no text.
- [ ] **Screenshot / marketing pass — M.** Once §1–§4 land, refresh the
  captures in the README against the corrected palette. The current set
  predates several of these seams and would document them.

## Sequencing

**Phase A — discipline (≈2 days).** All of §1, the palette half of §2, §7's
focus ring and contrast floor. Nothing structural; the app immediately looks
like one designed thing rather than a design plus its exceptions.

**Phase B — the reading surface (≈4 days).** §4's chrome theming, symmetric
motion, idle hide, edge progress, warm dimming. Plus §5's checkerboard and
gutter. This is where the reader stops feeling like a web view.

**Phase C — craft (≈5 days).** §3's icon set, §6's open transition and hero
card, §4's chapter typography, §5's ambient matte.

**Phase D — identity and polish (≈2 days).** §8, the motion spec, high
contrast, screenshots.

Phases A and B are independently shippable and worth doing regardless of
whether C and D follow.

## See also

- [docs/DESIGN.md](docs/DESIGN.md) — the language this plan is enforcing
- [plan-reader-v3.md](plan-reader-v3.md) — capability plan; §1 there overlaps
  with §4 here (page-turn animation, reduced motion, dynamic type)
- [src/styles/tokens.css](src/styles/tokens.css) — where most of §1 lands
- [src/lib/cover.ts](src/lib/cover.ts) — §2
- [src/components/icons.tsx](src/components/icons.tsx) — §3

## #1 Implementation report

Completed all eight items under **1. Close the seams in Hearth Noir**.

### Completed

- Added warm --scrim and --scrim-soft tokens and replaced the targeted
  pure-black overlay/backdrop and cover-progress fills.
- Removed the rejected #141519 gradient stops from the reader chrome and
  overflow controls.
- Replaced the off-palette pink, dark-red rgba fill, white control text, and
  white shimmer/border values with Hearth Noir tokens or color-mix() values.
- Removed the targeted drop shadows from import progress, transfer banners,
  settings preview, accent swatches, highlight swatches, and local search;
  existing borders now provide the intended depth.
- Folded library shelf/grid headings into the documented .eyebrow style and
  removed the duplicate .section-label rule.
- Reconciled the orange accent documentation to #d68a30. Contrast against
  --on-accent: #0d0b0a was checked for all six accents: red 5.41:1, blue
  6.03:1, green 6.65:1, purple 5.60:1, orange 7.05:1, and teal 6.97:1.
- Added the shared layer ladder tokens:
  --z-content, --z-chrome, --z-panel, --z-pop, --z-scrim, and --z-system.
  Dimming is intentionally above popovers so it dims the whole reading scene
  consistently.

### Verification

- pnpm typecheck — passed
- pnpm test — passed, 17 tests
- pnpm build — passed
- git diff --check — passed

## #3 Implementation report

Completed all three items under **3. One icon system**.

### Completed

- Replaced the single bookmark-only icon module with a bundled currentColor
  SVG stroke set covering navigation, search, contents, bookmark, settings,
  type, close, sort, filter, layout, download, star, server, tag, share,
  favorite, check, and overflow controls.
- Replaced the reader's emoji/text controls and the affected drawer, popover,
  sheet, library, OPDS, and finished-flow glyph controls with the shared SVG
  components.
- Added per-icon optical nudges for the reader navigation cluster and side
  arrows, with shared flex centering for close and action buttons.

### Verification

- pnpm typecheck — passed
- pnpm test — passed, 17 tests
- pnpm build — passed
- git diff --check — passed

## #2 Implementation report

Completed all four items under **2. Warm the fallback covers**.

### Completed

- Replaced the cool fixed palettes with distinct muted hue anchors: burnt
  orange, rose pink, moss green, magenta, violet, teal-slate, oxblood,
  ink-brown, and slate blue. Each title hash selects an anchor and angle, with
  the anchor blended toward the active accent through color-mix().
- Refined fallback covers with a hairline under the kind label, Newsreader
  optical sizing, responsive card-sized title sizing, and an author line
  anchored to the bottom of the cover.
- Added a one-time 16x16 canvas sample on decoded real cover thumbnails.
  The sampled RGB value is stored on the record and in a session cache.
- Applied the sampled color to real-cover hover borders and the reader's
  ambient radial matte, while keeping the Hearth Noir fallback when sampling
  is unavailable.

### Verification

- pnpm typecheck — passed
- pnpm test — passed, 17 tests
- pnpm build — passed
- git diff --check — passed
