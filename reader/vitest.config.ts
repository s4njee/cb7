import { defineConfig } from "vitest/config";

// Reader unit tests (Phase 6): the existing `*.test.ts` files are *vector
// modules* — they export `run*Vectors()` but contain no `test()`/`describe()`.
// The suite file below imports every runner and executes it inside vitest, so
// the CI runner actually asserts instead of only typechecking. We include just
// the suite so the vector files themselves aren't treated as empty test files.
export default defineConfig({
  test: {
    include: ["src/lib/vectorSuite.test.ts"],
    environment: "node",
  },
});
