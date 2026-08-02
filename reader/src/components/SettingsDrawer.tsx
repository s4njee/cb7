/** Reading settings, grouped by intent: Layout · Appearance · Navigation ·
 *  Accessibility. Format-inapplicable controls are hidden. EPUB gets a live
 *  typography/margin preview and a clear global vs this-book typeface scope.
 *  Reset this book / Reset all reader defaults are separate confirmed actions. */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import * as api from "../lib/api";
import { ACCENTS, FONTS, fontById, type AccentName, type FontId } from "../lib/fonts";
import type { ReaderFormat } from "../lib/format";
import {
  fontIdFor,
  usePrefs,
  type ComicMode,
  type EpubColumns,
  type FlowMode,
  type ThemeName,
} from "../store/prefs";

/** Page canvas only — does not retheme app chrome (Hearth Noir is dark-only). */
const THEME_SWATCHES: { name: ThemeName; label: string; bg: string; fg: string }[] = [
  { name: "dark", label: "Dark", bg: "#0d0b0a", fg: "#ddd4c3" },
  { name: "sepia", label: "Sepia", bg: "#e8dcc2", fg: "#4a3d28" },
  { name: "light", label: "Light", bg: "#f4efe4", fg: "#2b2620" },
];

const MODES: { mode: ComicMode; label: string }[] = [
  { mode: "single", label: "Single" },
  { mode: "spread", label: "Two page" },
  { mode: "scroll", label: "Scroll" },
];

const FLOWS: { flow: FlowMode; label: string }[] = [
  { flow: "paginated", label: "Paged" },
  { flow: "scrolled", label: "Scroll" },
];

const COLUMNS: { n: EpubColumns; label: string }[] = [
  { n: 1, label: "1 page" },
  { n: 2, label: "2 page" },
];

type ConfirmKind = "book" | "all" | null;

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <header className="settings-section-head">
        <h3 className="settings-section-title">{title}</h3>
        {hint && <p className="settings-section-hint">{hint}</p>}
      </header>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

export default function SettingsDrawer({
  format,
  bookId,
  onClose,
}: {
  format: ReaderFormat;
  bookId: number;
  onClose: () => void;
}) {
  const prefs = usePrefs();
  const {
    theme,
    accent,
    brightness,
    fontScale,
    lineHeight,
    comicMode,
    bookFonts,
    flow,
    epubColumns,
    margin,
    columnWidth,
    rtl,
    immersive,
    haptics,
    setTheme,
    setAccent,
    setBrightness,
    setFontScale,
    setLineHeight,
    setComicMode,
    setFontId,
    setBookFont,
    setFlow,
    setEpubColumns,
    setMargin,
    setColumnWidth,
    setRtl,
    setImmersive,
    setHaptics,
    resetBookOverrides,
    resetAllReaderDefaults,
  } = prefs;

  const isPagedMedia = format === "comic" || format === "pdf";
  const isEpub = format === "epub";
  const isComic = format === "comic";

  const [canHaptic, setCanHaptic] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);

  useEffect(() => {
    let alive = true;
    void api.hapticsSupported().then((ok) => {
      if (alive) setCanHaptic(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const activeFont = fontIdFor(prefs, bookId);
  const bookScoped = bookFonts[String(bookId)] != null;
  const fontMeta = fontById(activeFont);
  const themeSwatch = THEME_SWATCHES.find((t) => t.name === theme) ?? THEME_SWATCHES[0];

  const previewStyle = useMemo(() => {
    const pad = Math.round(10 + margin * 80);
    return {
      background: themeSwatch.bg,
      color: themeSwatch.fg,
      fontFamily: fontMeta?.stack ?? "serif",
      fontSize: `${Math.round(15 * fontScale)}px`,
      lineHeight,
      padding: `${pad}px ${pad + 4}px`,
      maxWidth: columnWidth > 0 ? `${columnWidth}ch` : undefined,
    } as CSSProperties;
  }, [themeSwatch, fontMeta, fontScale, lineHeight, margin, columnWidth]);

  /** Route a typeface pick to whichever scope is selected. */
  const pickFont = (id: FontId) => {
    if (bookScoped) setBookFont(bookId, id);
    else setFontId(id);
  };

  const runConfirm = () => {
    if (confirm === "book") resetBookOverrides(bookId);
    if (confirm === "all") resetAllReaderDefaults();
    setConfirm(null);
  };

  const hasBookOverride = bookScoped;

  return (
    <>
      <div className="drawer-head">
        <div className="drawer-title">Reading settings</div>
        <button className="close-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="drawer-body settings-body">
        {/* ── Layout ───────────────────────────────────────────── */}
        {(isPagedMedia || isEpub) && (
          <Section
            title="Layout"
            hint={
              isEpub
                ? "How text is arranged on the page"
                : "How pages sit on screen"
            }
          >
            {isPagedMedia && (
              <div>
                <div className="setting-label">Page layout</div>
                <div className="segmented">
                  {MODES.map((m) => (
                    <button
                      key={m.mode}
                      type="button"
                      className={`seg-btn small${comicMode === m.mode ? " active" : ""}`}
                      onClick={() => setComicMode(m.mode)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isComic && (
              <div>
                <div className="setting-label">Direction</div>
                <div className="segmented">
                  <button
                    type="button"
                    className={`seg-btn small${!rtl ? " active" : ""}`}
                    onClick={() => setRtl(false)}
                  >
                    Left to right
                  </button>
                  <button
                    type="button"
                    className={`seg-btn small${rtl ? " active" : ""}`}
                    onClick={() => setRtl(true)}
                  >
                    Manga (R→L)
                  </button>
                </div>
              </div>
            )}

            {isEpub && (
              <>
                <div>
                  <div className="setting-label">Flow</div>
                  <div className="segmented">
                    {FLOWS.map((f) => (
                      <button
                        key={f.flow}
                        type="button"
                        className={`seg-btn small${flow === f.flow ? " active" : ""}`}
                        onClick={() => setFlow(f.flow)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {flow === "paginated" && (
                  <div>
                    <div className="setting-label">Columns</div>
                    <div className="setting-hint" style={{ marginBottom: 8 }}>
                      Two-page works best in landscape
                    </div>
                    <div className="segmented">
                      {COLUMNS.map((c) => (
                        <button
                          key={c.n}
                          type="button"
                          className={`seg-btn small${epubColumns === c.n ? " active" : ""}`}
                          onClick={() => setEpubColumns(c.n)}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="setting-label">Margins</div>
                  <input
                    type="range"
                    min={0}
                    max={0.18}
                    step={0.01}
                    value={margin}
                    onChange={(e) => setMargin(parseFloat(e.target.value))}
                    aria-label="Margins"
                  />
                </div>

                <div>
                  <div className="setting-label">
                    Line width
                    <span className="setting-value">
                      {columnWidth === 0 ? "Full" : `${columnWidth} ch`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={90}
                    step={5}
                    value={columnWidth}
                    onChange={(e) => setColumnWidth(parseInt(e.target.value, 10))}
                    aria-label="Line width"
                  />
                </div>
              </>
            )}
          </Section>
        )}

        {/* ── Appearance ───────────────────────────────────────── */}
        <Section title="Appearance" hint="How the page looks">
          <div>
            <div className="setting-label">Page theme</div>
            <div className="setting-hint" style={{ marginBottom: 8 }}>
              Book canvas only — app chrome stays dark
            </div>
            <div className="swatch-grid">
              {THEME_SWATCHES.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className={`swatch${theme === t.name ? " active" : ""}`}
                  onClick={() => setTheme(t.name)}
                >
                  <div className="swatch-preview" style={{ background: t.bg, color: t.fg }}>
                    Aa
                  </div>
                  <div className="swatch-name">{t.label}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="setting-label">Accent</div>
            <div className="setting-hint" style={{ marginBottom: 8 }}>
              App-wide — not reset with reader defaults
            </div>
            <div className="accent-grid">
              {ACCENTS.map((a) => (
                <button
                  key={a.name}
                  type="button"
                  className={`accent-swatch${accent === a.name ? " active" : ""}`}
                  style={{ background: a.hex }}
                  aria-label={a.label}
                  title={a.label}
                  onClick={() => setAccent(a.name as AccentName)}
                />
              ))}
            </div>
          </div>

          {isEpub && (
            <>
              <div className="settings-preview" style={previewStyle} aria-hidden="true">
                <div className="settings-preview-label">Preview</div>
                The quick brown fox jumps over the lazy dog. Pack my box with five
                dozen liquor jugs — a short sample of how this typeface, size,
                spacing, and margin will read.
              </div>

              <div>
                <div className="setting-label">Text size</div>
                <div className="slider-row">
                  <span className="slider-cap serif" style={{ fontSize: 13 }}>
                    A
                  </span>
                  <input
                    type="range"
                    min={0.8}
                    max={1.5}
                    step={0.01}
                    value={fontScale}
                    onChange={(e) => setFontScale(parseFloat(e.target.value))}
                    aria-label="Text size"
                  />
                  <span className="slider-cap serif" style={{ fontSize: 22 }}>
                    A
                  </span>
                </div>
              </div>

              <div>
                <div className="setting-label">Line spacing</div>
                <input
                  type="range"
                  min={1.4}
                  max={2.1}
                  step={0.01}
                  value={lineHeight}
                  onChange={(e) => setLineHeight(parseFloat(e.target.value))}
                  aria-label="Line spacing"
                />
              </div>

              <div>
                <div className="setting-label">Typeface</div>
                <div className="setting-hint" style={{ marginBottom: 8 }}>
                  {bookScoped
                    ? "This book only — overrides your default"
                    : "Default for all books"}
                </div>
                <div className="segmented scope-toggle">
                  <button
                    type="button"
                    className={`seg-btn small${!bookScoped ? " active" : ""}`}
                    onClick={() => setBookFont(bookId, null)}
                  >
                    All books
                  </button>
                  <button
                    type="button"
                    className={`seg-btn small${bookScoped ? " active" : ""}`}
                    onClick={() => setBookFont(bookId, activeFont)}
                  >
                    This book
                  </button>
                </div>
                <div className="font-grid">
                  {FONTS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={`font-btn${activeFont === f.id ? " active" : ""}`}
                      style={{ fontFamily: f.stack }}
                      onClick={() => pickFont(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </Section>

        {/* ── Navigation ───────────────────────────────────────── */}
        <Section title="Navigation" hint="Chrome and page-turn feedback">
          <label className="setting-toggle">
            <div>
              <div className="setting-label">Immersive</div>
              <div className="setting-hint">Hide the status bar while reading</div>
            </div>
            <input
              type="checkbox"
              checked={immersive}
              onChange={(e) => setImmersive(e.target.checked)}
            />
          </label>

          {canHaptic && (
            <label className="setting-toggle">
              <div>
                <div className="setting-label">Haptics</div>
                <div className="setting-hint">Tap feedback on page turns</div>
              </div>
              <input
                type="checkbox"
                checked={haptics}
                onChange={(e) => {
                  setHaptics(e.target.checked);
                  if (e.target.checked) api.hapticTick("page");
                }}
              />
            </label>
          )}
        </Section>

        {/* ── Accessibility ────────────────────────────────────── */}
        <Section title="Accessibility" hint="Comfort while reading">
          <div>
            <div className="setting-label">Brightness</div>
            <div className="setting-hint" style={{ marginBottom: 8 }}>
              Dims the page with an overlay (not the system backlight)
            </div>
            <div className="slider-row">
              <span className="dot" style={{ width: 12, height: 12, opacity: 0.4 }} />
              <input
                type="range"
                min={0.25}
                max={1}
                step={0.01}
                value={brightness}
                onChange={(e) => setBrightness(parseFloat(e.target.value))}
                aria-label="Brightness"
              />
              <span className="dot" style={{ width: 16, height: 16 }} />
            </div>
          </div>
        </Section>

        {/* ── Reset ────────────────────────────────────────────── */}
        <Section title="Reset" hint="Separate actions for this book vs everything">
          {confirm ? (
            <div className="settings-confirm">
              <p className="settings-confirm-text">
                {confirm === "book"
                  ? "Clear this book’s typeface override and use your default face again?"
                  : "Restore all reading layout, appearance, navigation, and accessibility defaults? Your app accent is kept."}
              </p>
              <div className="settings-confirm-row">
                <button
                  type="button"
                  className="settings-confirm-btn"
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="settings-confirm-btn danger"
                  onClick={runConfirm}
                >
                  {confirm === "book" ? "Reset this book" : "Reset all defaults"}
                </button>
              </div>
            </div>
          ) : (
            <div className="settings-reset-list">
              <button
                type="button"
                className="settings-reset-btn"
                disabled={!hasBookOverride}
                onClick={() => setConfirm("book")}
              >
                Reset this book
                <span className="settings-reset-sub">
                  {hasBookOverride
                    ? "Clear custom typeface for this title"
                    : "No overrides on this book"}
                </span>
              </button>
              <button
                type="button"
                className="settings-reset-btn"
                onClick={() => setConfirm("all")}
              >
                Reset all reader defaults
                <span className="settings-reset-sub">
                  Layout, appearance, navigation, and accessibility
                </span>
              </button>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
