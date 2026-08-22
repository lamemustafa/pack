import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Several GST portal fixtures use real timing windows and mutate browser-like globals.
    // Keep their deterministic, isolated execution under the standard test command.
    fileParallelism: false,
    // ZIP entry headers carry a DOS date built from local-time getters
    // (`src/core/zip.ts`), so identical inputs produce different archive bytes on
    // machines in different zones. A byte-identity assertion pinned on one
    // developer's clock then fails in CI and nowhere else, which reads as a flake
    // rather than as the environment dependence it is. Pinning the zone makes the
    // suite agree with CI instead of with whoever ran it last.
    env: { TZ: "UTC" },
    include: ["tests/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
