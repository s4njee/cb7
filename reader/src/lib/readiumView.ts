/**
 * Thin helpers around @readium/navigator EpubNavigator for the Tauri reader.
 */
import {
  EpubNavigator,
  TextAlignment,
  type EpubNavigatorListeners,
  type IEpubPreferences,
} from "@readium/navigator";
import { Locator, type Publication } from "@readium/shared";
import { epubColors } from "./epubTheme";
import type { ThemeName } from "../store/prefs";
import type { FontId } from "./fonts";
import { fontById } from "./fonts";

export type { Publication };
export { EpubNavigator, Locator };

/**
 * Horizontal padding inside each column when dual-page is on. Adjacent columns
 * each contribute this amount, so the visual centre gutter is 2× this value.
 *
 * Do NOT use Readium’s `--RS__colGap` for this: CSS multi-column puts the gap
 * between *every* overflow column, so scrollWidth grows by (spreads−1)×gap and
 * ColumnSnapper (which advances by `innerWidth`) drifts — last page of a
 * chapter shifts left and an empty “extra page” appears. Readium defaults
 * colGap to 0 for that reason. In-column `pageGutter` keeps gap at 0 and only
 * insets the text, which multicol arithmetic tolerates.
 */
const TWO_PAGE_PAGE_GUTTER_PX = 24;

export function themeToPreferences(
  theme: ThemeName,
  opts: {
    fontId: FontId;
    fontScale: number;
    lineHeight: number;
    scroll: boolean;
    columnCount: 1 | 2;
  },
): IEpubPreferences {
  const c = epubColors(theme);
  const font = fontById(opts.fontId);
  const dual = !opts.scroll && opts.columnCount === 2;
  return {
    backgroundColor: c.bg,
    textColor: c.fg,
    linkColor: c.fg,
    visitedColor: c.fg,
    fontFamily: font.stack,
    // Readium fontSize is a unitless scale in [.7, 4] (1 = default), not percent.
    fontSize: Math.min(4, Math.max(0.7, opts.fontScale)),
    lineHeight: opts.lineHeight,
    scroll: opts.scroll,
    columnCount: opts.scroll ? 1 : opts.columnCount,
    // Single-column: outer margins live on `.epub-measure` (padding the host
    // overflows column width). Dual-page: in-column gutter so the two pages
    // aren’t flush without breaking multicol scroll math (see above).
    pageGutter: dual ? TWO_PAGE_PAGE_GUTTER_PX : 0,
    // null = fill the host width. Default max ~80ch shrinks the navigator
    // container and leaves a framed “text box” look.
    maximalLineLength: null,
    minimalLineLength: null,
    textAlign: TextAlignment.start,
    hyphens: false,
  };
}

export interface CreateNavigatorArgs {
  container: HTMLElement;
  publication: Publication;
  positions: Locator[];
  initialLocator?: Locator;
  preferences: IEpubPreferences;
  listeners: Partial<EpubNavigatorListeners>;
}

export async function createAndLoadNavigator(
  args: CreateNavigatorArgs,
): Promise<EpubNavigator> {
  const listeners: EpubNavigatorListeners = {
    frameLoaded: args.listeners.frameLoaded ?? (() => {}),
    positionChanged: args.listeners.positionChanged ?? (() => {}),
    timelineItemChanged: args.listeners.timelineItemChanged ?? (() => {}),
    tap: args.listeners.tap ?? (() => false),
    click: args.listeners.click ?? (() => false),
    zoom: args.listeners.zoom ?? (() => {}),
    miscPointer: args.listeners.miscPointer ?? (() => {}),
    scroll: args.listeners.scroll ?? (() => {}),
    customEvent: args.listeners.customEvent ?? (() => {}),
    handleLocator: args.listeners.handleLocator ?? (() => false),
    textSelected: args.listeners.textSelected ?? (() => {}),
    contentProtection: args.listeners.contentProtection ?? (() => {}),
    contextMenu: args.listeners.contextMenu ?? (() => {}),
    peripheral: args.listeners.peripheral ?? (() => {}),
  };

  const nav = new EpubNavigator(
    args.container,
    args.publication,
    listeners,
    args.positions,
    args.initialLocator,
    {
      preferences: args.preferences,
      defaults: {
        fontSize: 1,
        lineHeight: 1.5,
        scroll: false,
        columnCount: 1,
        pageGutter: 0,
        maximalLineLength: null,
        minimalLineLength: null,
        // Match prefs so the first paint isn't white before submitPreferences.
        backgroundColor: args.preferences.backgroundColor ?? null,
        textColor: args.preferences.textColor ?? null,
      },
    },
  );
  await nav.load();
  return nav;
}

export function locatorToProgressString(locator: Locator): string {
  try {
    return JSON.stringify(locator.serialize());
  } catch {
    return locator.href;
  }
}

export function progressStringToLocator(raw: string | null | undefined): Locator | undefined {
  if (!raw) return undefined;
  try {
    const json = JSON.parse(raw);
    return Locator.deserialize(json) ?? undefined;
  } catch {
    // Legacy CFI / bare href — best-effort href-only locator
    if (raw.startsWith("epubcfi")) return undefined;
    return Locator.deserialize({ href: raw, type: "application/xhtml+xml" }) ?? undefined;
  }
}

export function totalProgressionOf(locator: Locator | undefined): number | undefined {
  const p = locator?.locations?.totalProgression;
  return typeof p === "number" && !Number.isNaN(p) ? p : undefined;
}
