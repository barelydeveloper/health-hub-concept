import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "prisma/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts", "node_modules/**", "legacy/**"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
