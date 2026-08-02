/**
 * Test vectors for {@link hapticForTurn} — the page-turn haptics policy.
 *
 * These matter more than most: a haptic leaves no trace on screen, simulators
 * have no taptic engine, and a wrong rule (buzzing on every scroll tick, or on
 * the first paint of every book) is the kind of bug a reader doesn't report —
 * they just switch the feature off. So the rules are pinned here rather than
 * "verified" by feel.
 *
 * Same shape as `pair.test.ts`: the repo has no test runner configured, so this
 * is an exported vector table plus a runner. It is typechecked by `pnpm build`
 * and is dead code to the bundler, so it never ships. To execute it (verified
 * green):
 *
 *     ./node_modules/.bin/tsc src/lib/haptics.test.ts --outDir /tmp/haptest \
 *       --module commonjs --target es2020 --strict
 *     node -e "const r = require('/tmp/haptest/haptics.test.js').runHapticVectors(); \
 *       console.log(r.report); process.exit(r.failures.length ? 1 : 0)"
 */
import { hapticForTurn, type TurnContext, type TurnState } from "./haptics";
import type { HapticKind } from "./transport";

export interface HapticVector {
  name: string;
  prev: TurnState;
  next: TurnState;
  ctx: TurnContext;
  expected: HapticKind | null;
}

const ON: TurnContext = { enabled: true, paged: true };
const OFF: TurnContext = { enabled: false, paged: true };
const SCROLLING: TurnContext = { enabled: true, paged: false };

export const HAPTIC_VECTORS: HapticVector[] = [
  {
    name: "an ordinary page turn ticks lightly",
    prev: { page: 4, chapter: "ch1" },
    next: { page: 5, chapter: "ch1" },
    ctx: ON,
    expected: "page",
  },
  {
    name: "turning backwards ticks too — direction is not the point",
    prev: { page: 5, chapter: "ch1" },
    next: { page: 4, chapter: "ch1" },
    ctx: ON,
    expected: "page",
  },
  {
    name: "a spread turn (2 pages at once) is still one tick",
    prev: { page: 6, chapter: null },
    next: { page: 8, chapter: null },
    ctx: ON,
    expected: "page",
  },
  {
    name: "crossing into a new chapter supersedes the page tick",
    prev: { page: 9, chapter: "ch1" },
    next: { page: 10, chapter: "ch2" },
    ctx: ON,
    expected: "chapter",
  },
  {
    name: "a TOC jump across chapters ticks as a chapter, not a page",
    prev: { page: 10, chapter: "ch2" },
    next: { page: 40, chapter: "ch5" },
    ctx: ON,
    expected: "chapter",
  },
  {
    name: "opening a book is silent — a first paint is not a turn",
    prev: { page: null, chapter: null },
    next: { page: 1, chapter: "ch1" },
    ctx: ON,
    expected: null,
  },
  {
    name: "a reader still booting is silent",
    prev: { page: null, chapter: null },
    next: { page: null, chapter: null },
    ctx: ON,
    expected: null,
  },
  {
    name: "a re-render that moved nothing is silent",
    prev: { page: 5, chapter: "ch1" },
    next: { page: 5, chapter: "ch1" },
    ctx: ON,
    expected: null,
  },
  {
    name: "the preference is honoured",
    prev: { page: 4, chapter: "ch1" },
    next: { page: 5, chapter: "ch2" },
    ctx: OFF,
    expected: null,
  },
  {
    // The buzz-storm guard: in webtoon/scrolled flow the page number tracks the
    // scroll position, so ticking on it would vibrate continuously under the
    // reader's thumb.
    name: "a scrolling surface never ticks, however far it moves",
    prev: { page: 5, chapter: "ch1" },
    next: { page: 6, chapter: "ch2" },
    ctx: SCROLLING,
    expected: null,
  },
  {
    // An EPUB builds its chapter index after the first paint. `null -> "ch1"`
    // is that data landing, not the reader crossing a boundary — a chapter tick
    // here would put a bump in the middle of a chapter.
    name: "chapters appearing late (index built after first paint) is not a crossing",
    prev: { page: 5, chapter: null },
    next: { page: 6, chapter: "ch1" },
    ctx: ON,
    expected: "page",
  },
  {
    name: "a real crossing still ticks once the index is loaded",
    prev: { page: 6, chapter: "ch1" },
    next: { page: 7, chapter: "ch2" },
    ctx: ON,
    expected: "chapter",
  },
  {
    name: "chapter data going missing does not fire a chapter tick",
    prev: { page: 5, chapter: "ch1" },
    next: { page: 6, chapter: null },
    ctx: ON,
    expected: "page",
  },
];

export function runHapticVectors(): { report: string; failures: string[] } {
  const failures: string[] = [];
  for (const v of HAPTIC_VECTORS) {
    const actual = hapticForTurn(v.prev, v.next, v.ctx);
    if (actual !== v.expected) {
      failures.push(`${v.name}: expected ${String(v.expected)}, got ${String(actual)}`);
    }
  }
  return {
    report: failures.length
      ? `${failures.length}/${HAPTIC_VECTORS.length} haptic vectors FAILED:\n${failures.join("\n")}`
      : `all ${HAPTIC_VECTORS.length} haptic vectors passed`,
    failures,
  };
}
