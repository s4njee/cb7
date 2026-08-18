/**
 * Vitest suite that executes every reader vector module.
 *
 * The `*.test.ts` files are *vector modules*: they export `run*Vectors()`
 * (pure, self-contained assertion functions) rather than containing their own
 * `test()` calls. This suite imports each runner and executes it under vitest,
 * so `pnpm test` actually asserts — previously these files were only
 * typechecked by the TS build.
 */
import { describe, expect, it } from "vitest";

import { runBookContextVectors } from "./bookContext.test";
import { runDownloadStatusVectors } from "./downloadStatus.test";
import { runHapticVectors } from "./haptics.test";
import { runLoadStateVectors } from "./loadState.test";
import { runOutboxVectors } from "./progressOutbox.test";
import { runProgressWriteVectorsAsync } from "./progressWrite.test";
import { runPairVectors } from "./pair.test";
import { runScrubPreviewVectors } from "./scrubPreview.test";
import { runSearchTextVectors } from "./searchText.test";
import { runVirtualWindowVectors } from "./virtualWindow.test";
import { runBookmarkVectors } from "./bookmarks.test";
import { runHighlightVectors } from "./highlights.test";
import { runViewMemoryVectors } from "../components/library/viewMemory.test";
import { runServerIsolationVectors } from "./serverIsolation.test";
import { runTagChipVectors } from "../components/library/tagChips.test";
import { runHomeShelfVectors } from "../components/library/homeShelfData.test";

const runners = [
  ["bookmarks", runBookmarkVectors],
  ["bookContext", runBookContextVectors],
  ["downloadStatus", runDownloadStatusVectors],
  ["haptic", runHapticVectors],
  ["highlights", runHighlightVectors],
  ["loadState", runLoadStateVectors],
  ["outbox", runOutboxVectors],
  ["pair", runPairVectors],
  ["scrubPreview", runScrubPreviewVectors],
  ["searchText", runSearchTextVectors],
  ["serverIsolation", runServerIsolationVectors],
  ["homeShelves", runHomeShelfVectors],
  ["tagChips", runTagChipVectors],
  ["viewMemory", runViewMemoryVectors],
  ["virtualWindow", runVirtualWindowVectors],
] as const;

describe("reader vectors", () => {
  for (const [name, run] of runners) {
    it(`${name} vectors all pass`, () => {
      const { failures } = run();
      expect(failures, failures.join("\n")).toEqual([]);
    });
  }

  it("progressWrite vectors all pass", async () => {
    const { failures } = await runProgressWriteVectorsAsync();
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
