import assert from "node:assert/strict"
import type {
  ExecArgs,
  IAuthModuleService,
  IUserModuleService,
} from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createAccessInviteWorkflow,
  acceptAccessInviteWorkflow,
} from "@abhi1693/medusa-rbac/workflows"
import { ACCESS_CONTROL } from "../../src/modules/access-control"
import type AccessControlService from "../../src/modules/access-control/service"

export default async function verifyInvitations({ container }: ExecArgs) {
  assert.equal(process.env.RBAC_MODULE_TEST, "1")
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /^\/rbac_plugin_[a-f0-9]{16}_test$/
  )
  const users = container.resolve<IUserModuleService>(Modules.USER)
  const auth = container.resolve<IAuthModuleService>(Modules.AUTH)
  const access = container.resolve<AccessControlService>(ACCESS_CONTROL)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const [superuser] = await users.listUsers({
    email: "rbac-superuser@example.test",
  })
  const role = (
    await access.mutate(superuser.id, {
      kind: "create_role",
      name: "Invited order reader",
      permissions: ["orders.view"],
    })
  ).result as { id: string }
  const { result: invite } = await createAccessInviteWorkflow(container).run({
    input: {
      actor_id: superuser.id,
      email: "rbac-invited@example.test",
      role_ids: [role.id],
    },
  })
  const registered = await auth.register("emailpass", {
    body: { email: invite.email, password: "synthetic-invitation-password" },
  })
  assert.ok(registered.authIdentity)
  const identityId = registered.authIdentity.id
  await auth.updateAuthIdentities({
    id: identityId,
    app_metadata: { customer_id: "existing-customer-association" },
  })
  await db.raw(
    "create function reject_invitation_audit() returns trigger language plpgsql as $$ begin if NEW.action = 'accept_invite' then raise exception 'Synthetic invitation audit failure'; end if; return NEW; end $$"
  )
  await db.raw(
    "create trigger reject_invitation_audit before insert on rbac_access_audit for each row execute function reject_invitation_audit()"
  )
  const input = {
    token: invite.token,
    auth_identity_id: identityId,
    user: { email: invite.email, first_name: "Invited", last_name: "Reader" },
  }
  try {
    const failed = await acceptAccessInviteWorkflow(container).run({
      input,
      throwOnError: false,
    })
    assert.ok(failed.errors.length > 0)
    assert.match(
      failed.errors
        .map((item) =>
          String(item.error?.message || JSON.stringify(item.error))
        )
        .join("\n"),
      /Synthetic invitation audit failure/
    )
    assert.equal((await users.listUsers({ email: invite.email })).length, 0)
    assert.equal((await users.validateInviteToken(invite.token)).id, invite.id)
    assert.equal((await access.invitation(invite.id))?.status, "pending")
    const restored = await auth.retrieveAuthIdentity(identityId)
    assert.equal(restored.app_metadata?.user_id, null)
    assert.equal(
      restored.app_metadata?.customer_id,
      "existing-customer-association"
    )
    assert.ok(
      (
        await auth.authenticate("emailpass", {
          body: {
            email: invite.email,
            password: "synthetic-invitation-password",
          },
        })
      ).authIdentity
    )
  } finally {
    await db.raw("drop trigger reject_invitation_audit on rbac_access_audit")
    await db.raw("drop function reject_invitation_audit()")
  }
  const { result: accepted } = await acceptAccessInviteWorkflow(container).run({
    input,
  })
  assert.equal(
    (await auth.retrieveAuthIdentity(identityId)).app_metadata?.user_id,
    accepted.id
  )
  assert.equal(
    (await access.principal(accepted.id)).permissions.includes("orders.view"),
    true
  )
  await assert.rejects(users.validateInviteToken(invite.token))
  console.info(
    "PASS: invitation audit failure restores the native user, invite and identity boundary; the same identity/token retries successfully without core patches"
  )
}
