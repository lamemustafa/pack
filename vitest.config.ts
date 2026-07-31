import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Several GST portal fixtures use real timing windows and mutate browser-like globals.
    // Keep their deterministic, isolated execution under the standard test command.
    fileParallelism: false,
    include: ["tests/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
