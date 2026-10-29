import type {
  ExecArgs,
  IAuthModuleService,
  IUserModuleService,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { ACCESS_CONTROL } from "../modules/access-control"
import type AccessControlService from "../modules/access-control/service"

export default async function bootstrapSuperuser({ container }: ExecArgs) {
  const email = process.env.RBAC_SUPERUSER_EMAIL?.trim().toLowerCase()
  if (!email)
    throw new Error(
      "Set RBAC_SUPERUSER_EMAIL to the intended superuser's email"
    )
  const users = container.resolve<IUserModuleService>(Modules.USER)
  const access = container.resolve<AccessControlService>(ACCESS_CONTROL)
  const snapshot = await access.snapshot()
  const initialized = snapshot.roles.some((role) => role.is_superuser)
  let matches = await users.listUsers({ email })
  const password = process.env.RBAC_SUPERUSER_PASSWORD
  if (password && !initialized && password.length < 12)
    throw new Error(
      "The initial superuser password must contain at least 12 characters"
    )
  if (!matches.length) {
    if (initialized)
      throw new Error(
        "A Superuser already exists. Assign access through Admin."
      )
    if (!password || password.length < 12)
      throw new Error(
        "For a new account, provide RBAC_SUPERUSER_PASSWORD with at least 12 characters through a secret environment variable."
      )
    matches = [await users.createUsers({ email })]
  }
  if (matches.length !== 1)
    throw new Error(
      "Create exactly one matching Medusa user before bootstrapping access"
    )
  if (password && !initialized) {
    const auth = container.resolve<IAuthModuleService>(Modules.AUTH)
    let result = await auth.register("emailpass", {
      body: { email, password },
    })
    if (!result.authIdentity)
      result = await auth.authenticate("emailpass", {
        body: { email, password },
      })
    if (!result.authIdentity)
      throw new Error("Could not initialize the user's authentication identity")
    const metadata = result.authIdentity.app_metadata || {}
    if (metadata.user_id && metadata.user_id !== matches[0].id)
      throw new Error("The identity belongs to another user")
    await auth.updateAuthIdentities({
      id: result.authIdentity.id,
      app_metadata: { ...metadata, user_id: matches[0].id },
    })
  }
  const result = await access.bootstrap(matches[0].id)
  console.info(
    result.created
      ? "Superuser access initialized"
      : "Superuser access already initialized"
  )
}
