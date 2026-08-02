/**
 * Test vectors for {@link parsePairPayload} — the client half of the QR pairing
 * contract. **These mirror webui's `pairPayload.test.ts`**: both are written
 * from docs/CONTRACT.md § "QR pairing payload" and must not drift.
 *
 * The repo has no test runner configured (no vitest/jest — see package.json), so
 * this file is a plain exported vector table plus a runner that returns its
 * failures. It is typechecked by `pnpm build` (tsc covers `src/`) and is dead
 * code to the bundler, so it never ships. To execute it (verified green):
 *
 *     ./node_modules/.bin/tsc src/lib/pair.test.ts --outDir /tmp/pairtest \
 *       --module commonjs --target es2020 --strict
 *     node -e "const r = require('/tmp/pairtest/pair.test.js').runPairVectors(); \
 *       console.log(r.report); process.exit(r.failures.length ? 1 : 0)"
 *
 * Wire a `test` script to `runPairVectors()` the day a runner lands.
 */
import { parsePairPayload, type PairPayload } from "./pair";

export interface PairVector {
  name: string;
  input: string;
  expected: PairPayload;
}

export const PAIR_VECTORS: PairVector[] = [
  /* ------------------------------------------------------------- accepted */
  {
    name: "valid plain (unencoded url param)",
    input: "cb8pair://v1?url=http://shelf.local",
    expected: { ok: true, url: "http://shelf.local" },
  },
  {
    name: "valid with port",
    input: "cb8pair://v1?url=http://192.168.1.20:8008",
    expected: { ok: true, url: "http://192.168.1.20:8008" },
  },
  {
    name: "valid with token",
    input: "cb8pair://v1?url=http://192.168.1.20:8008&token=aGVsbG8td29ybGQ",
    expected: { ok: true, url: "http://192.168.1.20:8008", token: "aGVsbG8td29ybGQ" },
  },
  {
    name: "urlencoded url",
    input: "cb8pair://v1?url=http%3A%2F%2F192.168.1.20%3A8008",
    expected: { ok: true, url: "http://192.168.1.20:8008" },
  },
  {
    name: "https origin",
    input: "cb8pair://v1?url=https%3A%2F%2Fbooks.example.com",
    expected: { ok: true, url: "https://books.example.com" },
  },
  {
    name: "trailing slash is normalized away",
    input: "cb8pair://v1?url=http%3A%2F%2F192.168.1.20%3A8008%2F",
    expected: { ok: true, url: "http://192.168.1.20:8008" },
  },
  {
    name: "unknown params are ignored (forward compatibility)",
    input: "cb8pair://v1?url=http://shelf.local&flavour=vanilla&token=t0k",
    expected: { ok: true, url: "http://shelf.local", token: "t0k" },
  },
  {
    name: "default port is dropped by origin normalization",
    input: "cb8pair://v1?url=https%3A%2F%2Fbooks.example.com%3A443",
    expected: { ok: true, url: "https://books.example.com" },
  },

  /* ------------------------------------------------------------- not-shelf */
  {
    name: "wrong scheme",
    input: "https://example.com/pair?url=http://shelf.local",
    expected: { ok: false, reason: "not-shelf" },
  },
  {
    name: "garbage",
    input: "hello world",
    expected: { ok: false, reason: "not-shelf" },
  },
  {
    name: "empty string",
    input: "",
    expected: { ok: false, reason: "not-shelf" },
  },

  /* ----------------------------------------------------------- bad-version */
  {
    name: "v2 payload from a newer CB8",
    input: "cb8pair://v2?url=http://shelf.local",
    expected: { ok: false, reason: "bad-version" },
  },
  {
    name: "nonsense version segment",
    input: "cb8pair://banana?url=http://shelf.local",
    expected: { ok: false, reason: "bad-version" },
  },

  /* --------------------------------------------------------------- bad-url */
  {
    name: "url with a path",
    input: "cb8pair://v1?url=http%3A%2F%2Fshelf.local%2Fapi",
    expected: { ok: false, reason: "bad-url" },
  },
  {
    name: "url with credentials",
    input: "cb8pair://v1?url=http%3A%2F%2Fuser%3Apass%40shelf.local",
    expected: { ok: false, reason: "bad-url" },
  },
  {
    name: "missing url param",
    input: "cb8pair://v1?token=t0k",
    expected: { ok: false, reason: "bad-url" },
  },
  {
    name: "url with a query string",
    input: "cb8pair://v1?url=http%3A%2F%2Fshelf.local%3Fx%3D1",
    expected: { ok: false, reason: "bad-url" },
  },
  {
    name: "non-http scheme in url",
    input: "cb8pair://v1?url=ftp%3A%2F%2Fshelf.local",
    expected: { ok: false, reason: "bad-url" },
  },
  {
    name: "url that is not a url at all",
    input: "cb8pair://v1?url=192.168.1.20",
    expected: { ok: false, reason: "bad-url" },
  },
];

export interface VectorResult {
  passed: number;
  failures: string[];
  report: string;
}

/** Run every vector; returns the failures rather than throwing. */
export function runPairVectors(): VectorResult {
  const failures: string[] = [];
  for (const v of PAIR_VECTORS) {
    const actual = parsePairPayload(v.input);
    const a = JSON.stringify(actual);
    const e = JSON.stringify(v.expected);
    if (a !== e) failures.push(`${v.name}\n    input:    ${v.input}\n    expected: ${e}\n    actual:   ${a}`);
  }
  const passed = PAIR_VECTORS.length - failures.length;
  const report = failures.length
    ? `${failures.length}/${PAIR_VECTORS.length} pair vectors FAILED:\n  - ${failures.join("\n  - ")}`
    : `all ${passed} pair vectors passed`;
  return { passed, failures, report };
}
