import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    rollupOptions: { input: { main: "index.html", bench: "bench.html" } },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
