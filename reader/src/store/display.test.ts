/** Vector module (see `lib/vectorSuite.test.ts`): device-class resolution, the
 *  per-class fallback, and the class names the shelf container carries. Pure —
 *  the store itself is a thin persist wrapper over these. */
import {
  deviceClassFor,
  displayFor,
  gridClassName,
  isDisplayCustomized,
  DISPLAY_DEFAULTS,
  type DeviceClass,
  type DisplayPrefs,
} from "./display";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export interface DisplayVector {
  name: string;
  run: () => void;
}

export const DISPLAY_VECTORS: DisplayVector[] = [
  {
    name: "a desktop build is a desktop at any window size",
    run: () => {
      // Narrowing a window is not changing device, so the desktop's own view
      // must not be replaced by the phone's the moment it gets small.
      assert(deviceClassFor(500, true) === "desktop", "narrow desktop window changed class");
      assert(deviceClassFor(1600, true) === "desktop", "wide desktop misclassified");
    },
  },
  {
    name: "phones and tablets split at 768",
    run: () => {
      assert(deviceClassFor(390, false) === "phone", "iPhone width misclassified");
      assert(deviceClassFor(767, false) === "phone", "just under the break misclassified");
      assert(deviceClassFor(768, false) === "tablet", "the break itself misclassified");
      assert(deviceClassFor(1024, false) === "tablet", "iPad width misclassified");
    },
  },
  {
    name: "each class keeps its own view, and an untouched class gets defaults",
    run: () => {
      const byDevice: Partial<Record<DeviceClass, DisplayPrefs>> = {
        phone: { layout: "grid", density: "compact", showMeta: false },
      };
      assert(displayFor(byDevice, "phone").density === "compact", "phone lost its density");
      // The whole point of keying by class: a phone preference must not make
      // the tablet's grid sparse.
      assert(
        JSON.stringify(displayFor(byDevice, "tablet")) === JSON.stringify(DISPLAY_DEFAULTS),
        "an untouched class inherited another class's view",
      );
    },
  },
  {
    name: "a partial record still resolves to a complete view",
    run: () => {
      const byDevice = { desktop: { layout: "list" } as DisplayPrefs };
      const resolved = displayFor(byDevice, "desktop");
      assert(resolved.layout === "list", "the stored field was dropped");
      assert(resolved.density === DISPLAY_DEFAULTS.density, "the missing field was not defaulted");
      assert(resolved.showMeta === DISPLAY_DEFAULTS.showMeta, "the missing flag was not defaulted");
    },
  },
  {
    name: "reset is offered only when something is actually customized",
    run: () => {
      assert(!isDisplayCustomized(DISPLAY_DEFAULTS), "defaults reported as customized");
      assert(isDisplayCustomized({ ...DISPLAY_DEFAULTS, layout: "list" }), "layout change missed");
      assert(isDisplayCustomized({ ...DISPLAY_DEFAULTS, density: "compact" }), "density change missed");
      assert(isDisplayCustomized({ ...DISPLAY_DEFAULTS, showMeta: false }), "details toggle missed");
    },
  },
  {
    name: "the container's classes describe the view",
    run: () => {
      assert(gridClassName(DISPLAY_DEFAULTS) === "grid", `default view: ${gridClassName(DISPLAY_DEFAULTS)}`);
      assert(
        gridClassName({ layout: "list", density: "compact", showMeta: false }) ===
          "grid as-list is-compact no-meta",
        "the fully-customized view produced the wrong classes",
      );
      // `showMeta` is the one that inverts: on is the absence of a class.
      assert(
        gridClassName({ ...DISPLAY_DEFAULTS, showMeta: false }) === "grid no-meta",
        "details-off did not produce no-meta",
      );
    },
  },
];

export function runDisplayVectors(): { failures: string[]; report: string } {
  const failures: string[] = [];
  for (const v of DISPLAY_VECTORS) {
    try {
      v.run();
    } catch (err) {
      failures.push(`${v.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const report =
    failures.length === 0
      ? `display: ${DISPLAY_VECTORS.length} ok`
      : `display: ${failures.length} failed\n${failures.join("\n")}`;
  return { failures, report };
}
