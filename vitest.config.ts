import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["pi-upstream/**", "node_modules/**", "dist/**"],
    // Integration tests that need a real API key opt in via RUN_INTEGRATION=1
    environment: "node",
  },
});
