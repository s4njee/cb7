/** Typographic cover fallback — a stable, warm gradient derived from the
 * title hash. Each variant has a warm hue anchor, then picks up some of the
 * active accent so changing accent still changes the shelf. */

const ACCENT_OFFSETS = [
  { anchor: "#a85d27", from: 72, to: 42, angle: 154 }, // burnt orange
  { anchor: "#9a405e", from: 68, to: 38, angle: 164 }, // rose pink
  { anchor: "#536f49", from: 72, to: 40, angle: 142 }, // moss green
  { anchor: "#7b385d", from: 70, to: 40, angle: 176 }, // magenta
  { anchor: "#624a7c", from: 72, to: 42, angle: 188 }, // violet
  { anchor: "#47736c", from: 70, to: 38, angle: 132 }, // teal slate
  { anchor: "#7d3434", from: 74, to: 44, angle: 148 }, // oxblood
  { anchor: "#73533a", from: 72, to: 40, angle: 170 }, // ink brown
  { anchor: "#4d647c", from: 72, to: 40, angle: 160 }, // slate blue
] as const;

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export interface CoverTreatment {
  gradient: string;
  ink: string;
}

export function coverTreatment(title: string): CoverTreatment {
  const offset = ACCENT_OFFSETS[hashString(title) % ACCENT_OFFSETS.length];
  const from =
    "color-mix(in srgb, " +
    offset.anchor +
    " " +
    offset.from +
    "%, var(--accent))";
  const to =
    "color-mix(in srgb, " +
    offset.anchor +
    " " +
    offset.to +
    "%, var(--bg))";
  const ink = "color-mix(in srgb, var(--fg) 92%, var(--accent))";
  return {
    gradient: "linear-gradient(" + offset.angle + "deg, " + from + ", " + to + ")",
    ink,
  };
}

const dominantColorCache = new Map<string, string>();

function recordKey(record: { id: number; source?: string; thumbnailUrl?: string }): string {
  return (record.source ?? "server") + ":" + record.id + ":" + (record.thumbnailUrl ?? "");
}

export function dominantColorFor(record: {
  id: number;
  source?: string;
  thumbnailUrl?: string;
  dominantColor?: string;
}): string | undefined {
  return record.dominantColor ?? dominantColorCache.get(recordKey(record));
}

export function rememberDominantColor(
  record: { id: number; source?: string; thumbnailUrl?: string; dominantColor?: string },
  color: string,
): void {
  record.dominantColor = color;
  dominantColorCache.set(recordKey(record), color);
}

/** Sample one decoded cover into a small RGB average. Canvas failures are
 * expected for an opaque cross-origin image and simply leave the fallback
 * treatment in charge. */
export function sampleDominantColor(image: HTMLImageElement): string | null {
  try {
    const size = 16;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || !image.naturalWidth || !image.naturalHeight) return null;
    context.drawImage(image, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let weight = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3] / 255;
      if (alpha < 0.1) continue;
      r += pixels[i] * alpha;
      g += pixels[i + 1] * alpha;
      b += pixels[i + 2] * alpha;
      weight += alpha;
    }
    if (!weight) return null;
    return (
      "rgb(" +
      Math.round(r / weight) +
      " " +
      Math.round(g / weight) +
      " " +
      Math.round(b / weight) +
      ")"
    );
  } catch {
    return null;
  }
}
