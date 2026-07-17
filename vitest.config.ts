import { defineConfig } from "vitest/config";

// Unit tests for the pure business logic (scheduling rules, dispatch,
// analytics, formatting). These are mode-agnostic — no React, no Supabase.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
