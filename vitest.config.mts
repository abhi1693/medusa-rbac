import { defineConfig } from "vitest/config"
import { transform } from "@swc/core"

export default defineConfig({
  plugins: [
    {
      name: "medusa-typescript",
      enforce: "pre",
      async transform(code, id) {
        if (id.includes("node_modules") || !/\.[cm]?tsx?$/.test(id)) return
        const result = await transform(code, {
          filename: id,
          sourceMaps: true,
          jsc: {
            target: "es2022",
            parser: {
              syntax: "typescript",
              tsx: id.endsWith("tsx"),
              decorators: true,
            },
            transform: {
              legacyDecorator: true,
              decoratorMetadata: true,
              react: { runtime: "automatic" },
            },
          },
          module: { type: "es6" },
        })
        return { code: result.code, map: result.map }
      },
    },
  ],
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "tests/components/**/*.test.tsx",
      "tests/policy.test.ts",
    ],
    setupFiles: ["./tests/setup.ts"],
    environment: "jsdom",
    maxWorkers: 2,
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/modules/**/migrations/**"],
      reporter: ["text", "html", "json", "json-summary", "lcov"],
      thresholds: {
        perFile: true,
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
})
