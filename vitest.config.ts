import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

// Tests run inside workerd (Miniflare) against the real Worker + Pair DO from wrangler.jsonc.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { BOOTSTRAP_SECRET: "test-secret", ATT_CAP_BYTES: "3000", ATT_DAILY_CAP: "6" } },
    }),
  ],
  test: { include: ["tests/**/*.test.ts"], testTimeout: 20_000 },
});
