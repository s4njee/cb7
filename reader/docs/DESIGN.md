# Hearth Noir — CB8's visual identity

Ported from the native Flutter client (`~/cb8_flutter/lib/core/theme/app_theme.dart`),
which is where this language was actually settled. That file is the source of
truth; this document is its portable form. The Tauri reader implements it in
`src/styles/tokens.css` (surfaces + accent axis) and `src/lib/fonts.ts`
(Newsreader / Instrument Sans + reading faces).

## The idea

**A warm near-black room with one ember in it.**

Every decision follows from that. The surfaces are not grey — they are warm
blacks with red-brown undertones (`#0d0b0a`, not `#141519`), so the app reads
like paper in low light rather than a dark-mode toggle. The single accent is a
warm red (`#e15b47`) with enough chroma to be the only thing that glows. Book
titles are set in a serif; everything the app says about itself is set in a
sans. That split is the whole typographic system.

**Dark only for app chrome.** Not "dark by default" — the palette has no light
twin, because a warm near-black is a deliberate reading surface, not a
preference. Per-book sepia/light *page* themes remain: they theme the book
canvas (`epubTheme.ts`), not the app.

## Palette

Fixed surfaces. These do not vary by accent.

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0d0b0a` | App background |
| `--surface` | `#161211` | Cards, search field |
| `--surface2` | `#1f1913` | Chips, control fills, thumbnails |
| `--fg` | `#eae4d8` | Primary text |
| `--muted` | `#948a7c` | Secondary text |
| `--line` | `#262019` | Borders, input outlines |
| `--danger` | `#e0574a` | Destructive actions |

Extended tokens — these exist because the redesigned surfaces needed them, and
each one is a place where a generic `--surface` looked wrong:

| Token | Hex | Role |
|---|---|---|
| `--header-rule` | `#211c17` | Hairline under the header, between panes |
| `--reading-text` | `#ddd4c3` | Body text on the book canvas (warmer than `--fg`) |
| `--section-label` | `#847a6c` | Uppercase labels — "CONTINUE READING" |
| `--faint` | `#685f52` | Footers, page numbers, "Sort:" hints |
| `--placeholder` | `#776d5f` | Search hint text |
| `--hero-surface` | `#141110` | Continue-reading hero card |
| `--drawer-bg` | `#0a0808` | Contents drawer (recedes *below* the page) |
| `--popover` | `#151110` | Settings popover |
| `--popover-border` | `#2b241c` | Popover / drawer border |
| `--accent-tint` | `#241412` | Active TOC row — accent text sits on this |
| `--avatar-bg` | `#2e1c17` | Circular avatar |
| `--progress-track` | `#282219` | Progress-bar track |

Note the ladder from `#0a0808` (drawer) through `#0d0b0a` (page) to `#161211`
(card): depth is signalled by *warmth and lightness together*, never by a shadow.

### Accents

Six, user-selectable, swapped at runtime via `data-accent` on `<html>` (same
idea as Flutter's `AccentTheme` / the web UI's theme attribute). Red is the
signature; the rest were retuned to lower chroma and warmer hue so they survive
on `#0d0b0a` — a stock blue vibrates against a warm black.

| Name | Hex |
|---|---|
| **red** (default) | `#e15b47` |
| blue | `#5b93c7` |
| green | `#6fa368` |
| purple | `#9b7bc0` |
| orange | `#ffbf00` |
| teal | `#5ba79c` |

Only the accent changes. Swapping it must never touch a surface token.
Picker lives in the library account menu and the reading settings drawer.

## Typography

Two bundled families, one job each. Bundling matters: the app has to read
correctly offline, which rules out a webfont CDN.

- **Newsreader** (serif) — book titles, reading text, the wordmark.
- **Instrument Sans** (sans) — all UI chrome: nav, labels, buttons.

Shipped via `@fontsource/newsreader` and `@fontsource/instrument-sans`.
CSS exposes them as `--font-serif` / `--font-sans`; app chrome stacks are also
`SERIF_STACK` / `SANS_STACK` in `src/lib/fonts.ts`. Reading faces keep a wider
registry (Newsreader default, plus Literata, Garamond, Inter, Atkinson,
OpenDyslexic, system).

The one composite style worth naming is the **section label**: Instrument Sans,
11.5px, weight 500, `letter-spacing: 0.14em`, uppercase, `--section-label`,
`line-height: 1`. Implemented as `.eyebrow`.

## Shape

Four radii, and that is the entire set:

| Token / radius | Applies to |
|---|---|
| `--radius` (`8px`) | Buttons, inputs, controls, popovers |
| `--radius-card` (`12px`) | Hero card, cards, dialogs |
| `--radius-cover` (`5px`) | Covers in the grid |
| `--radius-hero-cover` (`4px`) | The small hero cover |

Only these four are tokenized. Hairline radii (3–4px progress bars and slider
tracks) and full pills (filter chips, circular avatars) sit outside the set on
purpose and keep literal values — forcing them into a token would change how
they read.

Cards are `elevation: 0` with a `--line` border. **Depth comes from a border and
a surface step, never a drop shadow** — a shadow on a warm near-black reads as
smudge. Decorative drop shadows from the original handoff have been removed;
floating panels use `--line` / `--popover-border` only. Motion uses duration
tokens in `tokens.css` and honors `prefers-reduced-motion`.

## Components

Behaviours the Flutter theme fixes centrally, worth preserving:

- **App bar** — background is `--bg` (not `--surface`), zero elevation, and no
  scrolled-under tint. The header dissolves into the page.
- **Nav bar** — `--surface`, with the selected indicator at **18% accent**.
- **Inputs** — filled with `--surface`, `--line` border, border goes **accent on
  focus**, padding `10px 14px`.
- **Outlined button** — accent text *and* accent border; filled button uses the
  accent as its fill with **dark ink** (`--on-accent: #0d0b0a`). Flutter sets
  `onPrimary: Colors.white`, but it only ever fills with the signature red —
  white on the six *retuned* accents lands at 2.7–3.6:1, and orange, teal and
  green fail even the 3:1 floor for UI text. The near-black clears 5.4:1 on all
  six. Any new accent must be checked against the ink, not assumed.
- **Dividers** — `--header-rule` at exactly 1px.
- **Chips** — `--surface2` fill with a `--line` border.

## Reading page themes

Independent of app chrome. Prefs `theme` is `dark` | `sepia` | `light` and only
feeds `epubTheme.ts` (concrete colors injected into the EPUB iframe):

| Page theme | Background | Text |
|---|---|---|
| dark | `#0d0b0a` | `#ddd4c3` (`--reading-text`) |
| sepia | `#e8dcc2` | `#4a3d28` |
| light | `#f4efe4` | `#2b2620` |

## Status

Implemented:

1. **Tokens** — full Hearth Noir palette + extended tokens on `:root` in
   `src/styles/tokens.css`. Opaque `--line`.
2. **Fonts** — Newsreader + Instrument Sans bundled via `@fontsource`, loaded in
   `main.tsx` before first paint; `SERIF_STACK` / `SANS_STACK` in `fonts.ts`.
3. **Accent picker** — six values, one property. `data-accent` is set in
   `main.tsx` from persisted prefs *before render*, so a non-red accent never
   flashes red.
4. **App themes** — chrome is dark-only; sepia/light are page themes only.
5. **Extended surfaces applied** — `--hero-surface` (continue card),
   `--drawer-bg` + `--popover-border` (contents drawer), `--accent-tint`
   (active TOC row), `--progress-track`, `--avatar-bg`, `--popover`.
6. **Radii applied** where an element maps onto one of the four — popovers,
   menu rows, inputs, controls, grid covers, the hero cover.

Not done, deliberately or otherwise:

- **`--faint` and `--reading-text` are declared but unused in CSS.** The
  reading text color is applied — `epubTheme.ts` has to emit literal colors
  into the sandboxed EPUB iframe, so it carries `#ddd4c3` directly. `--faint`
  is genuinely spare capacity for a future de-emphasis level.

## See also

- `~/cb8_flutter/lib/core/theme/app_theme.dart` — the source of truth
- `~/cb8_flutter/assets/icon/` — the CB8 mark (already adopted as the app icon)
- `src/styles/tokens.css` — surfaces, accent axis, type tokens
- `src/lib/fonts.ts` — chrome stacks + reading registry + accent list
- `src/lib/epubTheme.ts` — page-only reading colors
