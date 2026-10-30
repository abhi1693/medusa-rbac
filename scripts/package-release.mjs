import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const args = process.argv.slice(2)
assert.ok(
  args.every((arg) => arg === "--check-only"),
  "Unknown packaging argument"
)
const checkOnly = args.includes("--check-only")
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
const lock = JSON.parse(
  await readFile(path.join(root, "package-lock.json"), "utf8")
)
assert.equal(
  lock.version,
  pkg.version,
  "Lockfile version must match package.json"
)
assert.equal(
  lock.packages[""].version,
  pkg.version,
  "Lockfile root version must match package.json"
)
assert.equal(
  lock.packages[""].name,
  pkg.name,
  "Lockfile root name must match package.json"
)
const version = process.env.RELEASE_VERSION || pkg.version
assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
assert.equal(pkg.version, version, "Release version must match package.json")
let revision = null
try {
  revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
} catch (error) {
  if (!checkOnly) throw error
}
if (process.env.GITHUB_SHA)
  assert.equal(
    revision,
    process.env.GITHUB_SHA,
    "Checkout differs from validated commit"
  )
if (!checkOnly) {
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  })
  assert.equal(
    dirty,
    "",
    "Release packaging requires a clean committed checkout"
  )
}

const temporary = await mkdtemp(path.join(tmpdir(), "medusa-rbac-package-"))
const output = checkOnly
  ? temporary
  : path.resolve(process.env.RELEASE_OUTPUT_DIR || path.join(root, ".release"))
assert.ok(!/[\r\n]/.test(output), "Release output path must be a single line")
await mkdir(output, { recursive: true })

try {
  const [packed] = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", output],
      { cwd: root, encoding: "utf8" }
    )
  )
  assert.equal(packed.name, pkg.name)
  assert.equal(packed.version, version)
  assert.match(packed.filename, /^[A-Za-z0-9._-]+\.tgz$/)
  const archive = path.join(output, packed.filename)
  const files = new Set(packed.files.map((file) => file.path))
  for (const name of files) {
    assert.ok(
      !path.isAbsolute(name) && !name.split("/").includes(".."),
      "Unsafe package path"
    )
    assert.ok(
      !/(^|\/)(?:node_modules|tests|\.git)(\/|$)|(^|\/)\.env(?:\.|$)/.test(
        name
      ),
      "Private or test files must not ship"
    )
  }
  for (const required of ["package.json", "README.md", "LICENSE"])
    assert.ok(files.has(required), `Missing package file: ${required}`)
  const readme = await readFile(path.join(root, "README.md"), "utf8")
  const images = new Set(
    [
      ...readme.matchAll(/!\[[^\]]*\]\(<?(docs\/assets\/[^)\s>]+)>?\)/g),
      ...readme.matchAll(/<img\b[^>]*\bsrc=["'](docs\/assets\/[^"']+)["']/gi),
    ].map((match) => decodeURIComponent(match[1].split(/[?#]/)[0]))
  )
  for (const image of images)
    assert.ok(files.has(image), `Missing packed README image: ${image}`)
  const targets = (value) =>
    typeof value === "string" ? [value] : Object.values(value).flatMap(targets)
  const exports = targets(pkg.exports).filter((target) => !target.includes("*"))
  for (const target of exports) {
    assert.ok(
      target.startsWith("./") && !target.split("/").includes(".."),
      "Unsafe package export"
    )
    assert.ok(files.has(target.slice(2)), `Missing packed export: ${target}`)
  }

  const extracted = path.join(temporary, "extracted")
  await mkdir(extracted)
  execFileSync("tar", ["-xzf", archive, "-C", extracted])
  const extractedPackage = path.join(extracted, "package")
  for (const target of exports)
    await access(path.join(extractedPackage, target))
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
  const digest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex")
  const checksums = path.join(output, "SHA256SUMS")
  await writeFile(checksums, `${digest}  ${packed.filename}\n`)
  if (process.env.GITHUB_OUTPUT && !checkOnly)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `tag=v${version}\npackage-path=${archive}\nchecksums-path=${checksums}\n`
    )
  console.info(
    JSON.stringify({
      name: pkg.name,
      version,
      revision,
      exports: exports.length,
      readme_images: images.size,
      package: checkOnly ? "verified temporary archive" : archive,
      sha256: digest,
      storefront_esm_and_cjs: "verified",
    })
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
