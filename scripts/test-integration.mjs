import { spawn } from "node:child_process"
import { mkdtemp, writeFile, symlink, copyFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { createRequire } from "node:module"

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
}
delete env.REDIS_URL
let created = false
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
  await copyFile(
    path.join(root, "tsconfig.json"),
    path.join(host, "tsconfig.json")
  )
  await writeFile(
    path.join(host, "package.json"),
    JSON.stringify({
      name: "rbac-integration-host",
      private: true,
      dependencies: { "@medusajs/medusa": "2.22.1" },
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
  await run(["exec", path.join(root, "tests/integration/actors.ts")])
  await run(["exec", path.join(root, "tests/integration/invitations.ts")])
} finally {
  if (created) await db.raw("drop database ?? with (force)", [name])
  await db.destroy()
  await rm(host, { recursive: true, force: true })
}
