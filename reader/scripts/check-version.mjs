/**
 * Verify the three version sources agree before a release build:
 *   - package.json            (the source of truth the Tauri CLI reads)
 *   - src-tauri/tauri.conf.json
 *   - src-tauri/Cargo.toml    (the Rust crate)
 *
 * The release workflow runs this from a `reader-vX.Y.Z` tag; it also runs in
 * reader CI so a version bump can't drift silently. Exits non-zero on mismatch
 * so the release job fails before any artifact is built.
 *
 * Run: `node scripts/check-version.mjs`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const cargo = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const expected = process.env.RELEASE_TAG?.replace(/^reader-v/, "") ?? pkg.version;

const actual = {
  "package.json": pkg.version,
  "tauri.conf.json": conf.version,
  "Cargo.toml": cargoVersion,
};

let ok = true;
for (const [file, v] of Object.entries(actual)) {
  if (v !== expected) {
    console.error(`version mismatch: ${file} is ${v}, expected ${expected}`);
    ok = false;
  } else {
    console.log(`ok: ${file} = ${v}`);
  }
}

if (!ok) {
  console.error(`\nversions out of sync; refusing to release ${expected}`);
  process.exit(1);
}
console.log(`\nall versions agree on ${expected}`);
