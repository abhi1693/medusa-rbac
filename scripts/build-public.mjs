import { build } from "esbuild"
import { readFile, writeFile } from "node:fs/promises"
const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
)
await build({
  entryPoints: [
    "src/public/admin-access.ts",
    "src/public/access-denied.ts",
    "src/public/invite-roles.ts",
    "src/public/invites.ts",
    "src/public/users.ts",
  ],
  outdir: ".medusa/server/public",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: [...Object.keys(pkg.peerDependencies), "react-router-dom"],
  splitting: true,
  outExtension: { ".js": ".mjs" },
})
// The Medusa compiler copies JSON inventories but does not preserve source type declarations.
