import { access, readFile } from "node:fs/promises"

const root = new URL("../", import.meta.url)
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"))
const paths = (value) =>
  typeof value === "string" ? [value] : Object.values(value).flatMap(paths)
await Promise.all(
  paths(pkg.exports)
    .filter((path) => !path.includes("*"))
    .map((path) => access(new URL(path, root)))
)
const { createAccessClient } = await import(
  new URL(pkg.exports["./client"].import, root)
)
if (typeof createAccessClient !== "function")
  throw new Error("The storefront client export is unavailable")
