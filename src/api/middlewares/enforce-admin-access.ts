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
import { canonicalPath } from "../../lib/access/route-facts"
import { describeNative } from "../../lib/access/native-resources"
import { operationAllowed } from "../../lib/access/resources"
import { validateFieldSelection } from "../../lib/access/policy"

export async function enforceAdminAccess(
  request: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const req = request as AuthenticatedMedusaRequest
  try {
    if (!canonicalPath(req.originalUrl))
      return res
        .status(403)
        .json({ message: "Ambiguous Admin path is not allowed" })
    if (
      describeNative(req.method, req.originalUrl, req.body)?.access === "public"
    )
      return next()
    const auth = req.auth_context
    if (auth?.actor_type !== "user" || !auth.actor_id)
      return res
        .status(401)
        .json({ message: "An authenticated staff account is required" })
    res.setHeader("Cache-Control", "no-store")
    await req.scope
      .resolve<IUserModuleService>(Modules.USER)
      .retrieveUser(auth.actor_id, { select: ["id"] })
    const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
    const descriptor = await access.resolveRequest(req)
    const principal = await access.principal(auth.actor_id)
    const context = await access.permissionContext(req)
    const allowed = (permission: string) =>
      access.allows(principal, permission, context)
    if (!descriptor || !operationAllowed(principal, descriptor, allowed))
      return res
        .status(403)
        .json({ message: "You do not have permission for this operation" })
    if (descriptor.action.forceFields)
      req.query.fields = descriptor.action.forceFields.join(",")
    const fallback = descriptor.action.fallbackFields
    if (fallback && (!principal.active || !fallback.permissions.every(allowed)))
      req.query.fields = fallback.fields.join(",")
    if (
      ["GET", "HEAD"].includes(req.method) &&
      !validateFieldSelection(
        descriptor.fieldResource,
        req.query.fields,
        descriptor.fields
      )
    )
      return res
        .status(403)
        .json({ message: "This field selection is not allowed" })
    if (
      typeof req.query.fields === "string" &&
      descriptor.fieldRequirements.some(
        (requirement) =>
          requirement.pattern.test(req.query.fields as string) &&
          !requirement.permissions.every(allowed)
      )
    )
      return res.status(403).json({
        message: "Additional permissions are required for these fields",
      })
    if (descriptor.action.redirect) {
      const { destination, parameter } = descriptor.action.redirect
      return res.redirect(
        307,
        destination.replace(
          `:${parameter}`,
          encodeURIComponent(descriptor.params[parameter])
        )
      )
    }
    return next()
  } catch (error) {
    return next(error)
  }
}
