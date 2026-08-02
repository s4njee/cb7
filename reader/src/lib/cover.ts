/** Typographic cover fallback — a stable gradient + light ink color derived
 *  from the title hash, matching the prototype's cover treatment. Used as the
 *  loading/error state behind real cover images. */

interface Palette {
  from: string;
  to: string;
  ink: string;
}

const PALETTES: Palette[] = [
  { from: "#2f3d5c", to: "#1f2740", ink: "#e8ecf6" },
  { from: "#5a2f57", to: "#2a1330", ink: "#f4dcef" },
  { from: "#2f4a3f", to: "#16261f", ink: "#dff0e6" },
  { from: "#5c4a26", to: "#2a2012", ink: "#f6ecd2" },
  { from: "#3a3550", to: "#201d30", ink: "#e7e2f2" },
  { from: "#26414c", to: "#122229", ink: "#dbeef4" },
  { from: "#4c3030", to: "#281818", ink: "#f2dede" },
  { from: "#3a2f5c", to: "#1c1730", ink: "#e5ddf6" },
];

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
  const p = PALETTES[hashString(title) % PALETTES.length];
  return { gradient: `linear-gradient(160deg, ${p.from}, ${p.to})`, ink: p.ink };
}
