import { build } from "esbuild"
import { readFile } from "node:fs/promises"
const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
)
await build({
  entryPoints: {
    "admin-access": "src/public/admin-access.ts",
    client: "src/client.ts",
  },
  outdir: ".medusa/server/public",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: [...Object.keys(pkg.peerDependencies), "react-router-dom"],
  splitting: true,
  outExtension: { ".js": ".mjs" },
})
await import("./check-package.mjs")
