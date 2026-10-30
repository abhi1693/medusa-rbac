import { createRequire } from "node:module"
import { readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"

const require = createRequire(import.meta.url)
const medusa = require("@medusajs/medusa/package.json")
if (medusa.version !== "2.22.2") {
  throw new Error(
    "Review RBAC route and field policies before accepting another Medusa version"
  )
}
const base = path.join(
  path.dirname(require.resolve("@medusajs/medusa/package.json")),
  "dist/api/admin"
)
const destination = new URL("../src/lib/access/", import.meta.url)
const routes = []
const fields = {}

async function visit(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name)
  )) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) await visit(file)
    else if (entry.name === "route.js") {
      const source = await readFile(file, "utf8")
      const route =
        "/admin/" +
        path
          .relative(base, directory)
          .split(path.sep)
          .join("/")
          .replace(/\[([^\]]+)\]/g, ":$1")
      const methods = [
        ...new Set(
          [
            ...source.matchAll(
              /exports\.(GET|POST|PUT|PATCH|DELETE|HEAD)\s*=/g
            ),
          ].map((match) => match[1])
        ),
      ].sort()
      if (methods.length) routes.push({ path: route, methods })
    }
  }
}
await visit(base)

for (const entry of await readdir(base, { withFileTypes: true })) {
  if (!entry.isDirectory() || /rbac|role|polic/.test(entry.name)) continue
  const file = path.join(base, entry.name, "query-config.js")
  let queryConfig
  try {
    queryConfig = require(file)
  } catch {
    continue
  }
  const values = []
  // Read evaluated exports: native names vary and arrays may contain spreads.
  for (const [name, value] of Object.entries(queryConfig)) {
    if (/Role|Rbac|Policy/.test(name)) continue
    if (
      Array.isArray(value) &&
      value.every((field) => typeof field === "string")
    )
      values.push(...value)
  }
  if (values.length) fields[entry.name] = [...new Set(values)].sort()
}
await writeFile(
  new URL("native-routes.json", destination),
  JSON.stringify(routes, null, 2) + "\n"
)
await writeFile(
  new URL("native-fields.json", destination),
  JSON.stringify(fields, null, 2) + "\n"
)
console.info(
  `Recorded ${routes.length} route signatures. Review policy classifications and field exposure before committing.`
)
