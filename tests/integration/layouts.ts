import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import type {
  ExecArgs,
  IAuthModuleService,
  IUserModuleService,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { ACCESS_CONTROL } from "../../src/modules/access-control"
import type AccessControlService from "../../src/modules/access-control/service"

export default async function prepareLayouts({ container }: ExecArgs) {
  assert.equal(process.env.RBAC_MODULE_TEST, "1")
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /^\/rbac_plugin_[a-f0-9]{16}_test$/
  )
  assert.ok(process.env.RBAC_LAYOUT_FIXTURE_PATH)
  const users = container.resolve<IUserModuleService>(Modules.USER)
  const auth = container.resolve<IAuthModuleService>(Modules.AUTH)
  const access = container.resolve<AccessControlService>(ACCESS_CONTROL)
  const [superuser] = await users.listUsers({
    email: "rbac-superuser@example.test",
  })
  assert.ok(superuser)
  const password = "synthetic-layouts-password"
  const ordinary = (
    await access.mutate(superuser.id, {
      kind: "create_role",
      name: "Layout personal users",
      permissions: ["products.view"],
    })
  ).result as { id: string }
  const manager = (
    await access.mutate(superuser.id, {
      kind: "create_role",
      name: "Layout shared managers",
      permissions: ["settings.manage"],
    })
  ).result as { id: string }
  const fixture: Record<
    string,
    { id: string; email: string; password: string }
  > = {}
  for (const name of ["first", "second", "manager", "inactive", "superuser"]) {
    const user =
      name === "superuser"
        ? superuser
        : await users.createUsers({ email: `rbac-layout-${name}@example.test` })
    const registered = await auth.register("emailpass", {
      body: { email: user.email, password },
    })
    assert.ok(registered.authIdentity)
    await auth.updateAuthIdentities({
      id: registered.authIdentity.id,
      app_metadata: { user_id: user.id },
    })
    if (name !== "superuser")
      await access.mutate(superuser.id, {
        kind: "set_staff",
        user_id: user.id,
        role_ids: [name === "manager" ? manager.id : ordinary.id],
        active: name !== "inactive",
        version: 0,
      })
    fixture[name] = { id: user.id, email: user.email, password }
  }
  await writeFile(
    process.env.RBAC_LAYOUT_FIXTURE_PATH,
    JSON.stringify(fixture),
    { mode: 0o600 }
  )
}
