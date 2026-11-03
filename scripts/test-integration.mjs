import { spawn } from "node:child_process"
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import { verifyLayouts } from "../tests/integration/layouts-http.mjs"

const require = createRequire(import.meta.url)
const { ModulesSdkUtils } = require("@medusajs/framework/utils")
const root = process.cwd()
const configured = process.env.RBAC_TEST_DATABASE_URL
if (!configured)
  throw new Error(
    "Set RBAC_TEST_DATABASE_URL to a local PostgreSQL test service"
  )
const connection = new URL(configured)
if (
  !["postgres:", "postgresql:"].includes(connection.protocol) ||
  !["127.0.0.1", "localhost"].includes(connection.hostname)
)
  throw new Error("Integration tests require a local PostgreSQL service")
connection.pathname = "/postgres"
const db = ModulesSdkUtils.createPgConnection({
  clientUrl: connection.href,
  pool: { min: 0, max: 2 },
})
const name = `rbac_plugin_${randomBytes(8).toString("hex")}_test`
const target = new URL(connection)
target.pathname = `/${name}`
const host = await mkdtemp(path.join(tmpdir(), "medusa-rbac-host-"))
const env = {
  ...process.env,
  NODE_ENV: "test",
  RBAC_MODULE_TEST: "1",
  DATABASE_URL: target.href,
  JWT_SECRET: randomBytes(32).toString("hex"),
  COOKIE_SECRET: randomBytes(32).toString("hex"),
  RBAC_LAYOUT_FIXTURE_PATH: path.join(host, "layout-fixture.json"),
}
delete env.REDIS_URL
let created = false
let server
let serverError
const stopServer = async () => {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null)
    return
  const exited = new Promise((resolve) => server.once("exit", resolve))
  server.kill("SIGTERM")
  const timeout = setTimeout(() => server.kill("SIGKILL"), 10000)
  await exited
  clearTimeout(timeout)
}
const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(root, "node_modules/@medusajs/cli/cli.js"), ...args],
      { cwd: host, env, stdio: "inherit" }
    )
    child.once("error", reject)
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Medusa CLI exited ${code}`))
    )
  })
try {
  await symlink(
    path.join(root, "node_modules"),
    path.join(host, "node_modules"),
    "dir"
  )
  const tsconfig = JSON.parse(
    await readFile(path.join(root, "tsconfig.json"), "utf8")
  )
  tsconfig.include.push(".medusa/types/**/*.d.ts")
  await writeFile(path.join(host, "tsconfig.json"), JSON.stringify(tsconfig))
  await mkdir(path.join(host, "src"))
  await writeFile(
    path.join(host, "src/query-types.ts"),
    `
import type { RemoteQueryEntryPoints as Query } from "@medusajs/framework/types"

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false
type Check<Value extends true> = Value
type Role = Query["rbac_access_role"]
type Actor = Query["rbac_actor_access"]
type Invitation = Query["rbac_invitation_access"]

export type GeneratedQueryChecks = [
  Check<Equal<Query["user"]["email"], string>>,
  Check<Equal<Query["customer"]["has_account"], boolean>>,
  Check<Equal<Query["product"]["id"], string>>,
  Check<Equal<Role["key"], string>>,
  Check<Equal<Role["is_superuser"], boolean>>,
  Check<Equal<Role["version"], number>>,
  Check<Equal<Role["permissions"], Record<string, unknown>>>,
  Check<Equal<Role["created_at"], Date | string>>,
  Check<Equal<Role["deleted_at"], Date | string | null>>,
  Check<Equal<Query["rbac_access_roles"], Role>>,
  Check<Equal<Actor["actor_id"], string>>,
  Check<Equal<Actor["active"], boolean>>,
  Check<Equal<Query["rbac_role_assignment"]["role"], Role>>,
  Check<Equal<Query["rbac_role_assignment"]["access"], Actor>>,
  Check<Equal<Query["rbac_access_audit"]["detail"], Record<string, unknown>>>,
  Check<Equal<Invitation["status"], "pending" | "accepted" | "cancelled">>,
  Check<Equal<Invitation["user_id"], string | null>>,
  Check<Equal<Query["rbac_invitation_role"]["role"], Role>>,
  Check<Equal<Query["rbac_invitation_role"]["invitation"], Invitation>>,
]
`
  )
  await writeFile(
    path.join(host, "package.json"),
    JSON.stringify({
      name: "rbac-integration-host",
      private: true,
      dependencies: { "@medusajs/medusa": "2.22.2" },
    })
  )
  await writeFile(
    path.join(host, "medusa-config.ts"),
    `
    import { defineConfig } from "@medusajs/framework/utils"
    module.exports = defineConfig({
      featureFlags: { rbac: false, rbac_filter_fields: false },
      admin: { disable: true },
      projectConfig: { databaseUrl: process.env.DATABASE_URL, http: { jwtSecret: process.env.JWT_SECRET, cookieSecret: process.env.COOKIE_SECRET } },
      plugins: [{ resolve: ${JSON.stringify(root)}, options: {
        permissions: [["store.documents.read", "Read account documents", "Storefront"]],
      } }],
    })
  `
  )
  await db.raw("create database ??", [name])
  created = true
  await run(["db:migrate"])
  await run(["build"])
  await run(["exec", path.join(root, "tests/integration/actors.ts")])
  await run(["exec", path.join(root, "tests/integration/invitations.ts")])
  await run(["exec", path.join(root, "tests/integration/layouts.ts")])
  const port = await new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port
      probe.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
  server = spawn(
    process.execPath,
    [
      path.join(root, "node_modules/@medusajs/cli/cli.js"),
      "start",
      "--port",
      String(port),
    ],
    { cwd: host, env, stdio: "inherit" }
  )
  server.once("error", (error) => {
    serverError = error
  })
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 45000
  while (true) {
    if (serverError) throw serverError
    if (server.exitCode !== null)
      throw new Error(`Medusa HTTP server exited ${server.exitCode}`)
    try {
      if ((await fetch(`${base}/health`)).ok) break
    } catch {}
    if (Date.now() >= deadline)
      throw new Error("Medusa HTTP server did not become ready")
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  await verifyLayouts(
    base,
    JSON.parse(await readFile(env.RBAC_LAYOUT_FIXTURE_PATH, "utf8"))
  )
} finally {
  await stopServer()
  if (created) await db.raw("drop database ?? with (force)", [name])
  await db.destroy()
  await rm(host, { recursive: true, force: true })
}
