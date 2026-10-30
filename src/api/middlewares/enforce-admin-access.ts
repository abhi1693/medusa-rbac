import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaNextFunction,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { IUserModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { ACCESS_CONTROL } from "../../modules/access-control"
import type AccessControlService from "../../modules/access-control/service"
import {
  additionalWritePermissions,
  isBootstrapRead,
  isSelfProfileUpdate,
  normalizedPath,
  validateFieldSelection,
} from "../../lib/access/policy"

export async function enforceAdminAccess(
  request: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const req = request as AuthenticatedMedusaRequest
  try {
    const path = normalizedPath(req.originalUrl)
    if (!path)
      return res
        .status(403)
        .json({ message: "Ambiguous Admin path is not allowed" })
    // This native route verifies its invitation token and accepts an unregistered identity.
    if (path === "/admin/invites/accept" && req.method === "POST") return next()
    // Medusa exposes these static capability flags before login; preserve that contract.
    if (path === "/admin/feature-flags" && ["GET", "HEAD"].includes(req.method))
      return next()
    const auth = req.auth_context
    if (auth?.actor_type !== "user" || !auth.actor_id)
      return res
        .status(401)
        .json({ message: "An authenticated staff account is required" })
    res.setHeader("Cache-Control", "no-store")
    const users = req.scope.resolve<IUserModuleService>(Modules.USER)
    await users.retrieveUser(auth.actor_id, { select: ["id"] })
    const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
    if (isSelfProfileUpdate(req.method, path, auth.actor_id, req.body)) {
      req.query.fields = "id,email,first_name,last_name,avatar_url"
      return next()
    }
    const principal = await access.principal(auth.actor_id)
    const resource = path.split("/")[2]
    const selfRead = isBootstrapRead(req.method, path)
    if (selfRead && path === "/admin/users/me")
      req.query.fields = "id,email,first_name,last_name,avatar_url"
    if (
      selfRead &&
      path === "/admin/stores" &&
      (!principal.active ||
        !access.allows(
          principal,
          "settings.view",
          await access.permissionContext(req)
        ))
    )
      req.query.fields = "id,name"
    if (!selfRead && !principal.active)
      return res
        .status(403)
        .json({ message: "Staff access is inactive or has not been assigned" })
    const policy = access.policyFor(req.method, path)
    const context = await access.permissionContext(req)
    const allowed = (permission: string) =>
      access.allows(principal, permission, context)
    if (
      !policy ||
      (!selfRead &&
        (!principal.active ||
          (policy.superuser && !principal.is_superuser) ||
          !policy.permissions.every(allowed)))
    )
      return res
        .status(403)
        .json({ message: "You do not have permission for this operation" })
    if (
      ["GET", "HEAD"].includes(req.method) &&
      !validateFieldSelection(resource, req.query.fields)
    ) {
      return res
        .status(403)
        .json({ message: "This field selection is not allowed" })
    }
    if (
      typeof req.query.fields === "string" &&
      req.query.fields.includes("inventory") &&
      !allowed("inventory.view")
    ) {
      return res
        .status(403)
        .json({ message: "Inventory access is required for these fields" })
    }
    if (
      ["products", "product-variants"].includes(resource) &&
      !["GET", "HEAD"].includes(req.method)
    ) {
      if (
        additionalWritePermissions(
          req.body,
          req.method === "POST" &&
            (path === "/admin/products" ||
              /^\/admin\/products\/[^/]+\/variants$/.test(path))
        ).some((p) => !allowed(p))
      ) {
        return res.status(403).json({
          message: "Additional permissions are required for the changed fields",
        })
      }
    }
    if (req.method === "DELETE" && /^\/admin\/users\/[^/]+$/.test(path)) {
      // Keep native Admin actions on the guarded, compensatable public workflow.
      // 307 preserves DELETE; the destination independently checks authorization.
      const rawId = req.originalUrl
        .split("?")[0]
        .replace(/\/+$/, "")
        .split("/")[3]
      return res.redirect(
        307,
        `/admin/access/staff/${encodeURIComponent(decodeURIComponent(rawId))}`
      )
    }
    return next()
  } catch (error) {
    return next(error)
  }
}
