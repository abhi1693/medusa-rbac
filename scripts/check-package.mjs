import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"

const extractedPackage = process.env.RELEASE_PACKAGE_DIR || process.cwd()
const pkg = JSON.parse(
  await readFile(path.join(extractedPackage, "package.json"), "utf8")
)
const targets = (value) =>
  typeof value === "string"
    ? [value]
    : value
      ? Object.values(value).flatMap(targets)
      : []
const exports = targets(pkg.exports).filter((target) => !target.includes("*"))
for (const target of exports) await access(path.join(extractedPackage, target))
const temporary = await mkdtemp(path.join(tmpdir(), "rbac-consumer-"))
try {
  const consumer = path.join(temporary, "consumer")
  const modulePath = path.join(consumer, "node_modules", ...pkg.name.split("/"))
  await mkdir(path.dirname(modulePath), { recursive: true })
  await symlink(extractedPackage, modulePath, "dir")
  const probe = path.join(consumer, "probe.mjs")
  await writeFile(
    probe,
    `import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { createAccessClient } from ${JSON.stringify(pkg.name + "/client")}
const require = createRequire(import.meta.url)
const cjs = require(${JSON.stringify(pkg.name + "/client")})
for (const factory of [createAccessClient, cjs.createAccessClient]) {
  assert.equal(typeof factory, "function")
  let request
  const client = factory({ client: { fetch: async path => { request = path; return { actor: { id: "account" } } } } })
  assert.deepEqual(await client.me("partner/type"), { actor: { id: "account" } })
  assert.equal(request, "/access/actors/partner%2Ftype/me")
}
`
  )
  execFileSync(process.execPath, [probe], {
    env: { ...process.env, NODE_PATH: "" },
  })
} finally {
  await rm(temporary, { recursive: true, force: true })
}
