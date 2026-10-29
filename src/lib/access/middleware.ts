import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"
import { ACCESS_CONTROL } from "../../modules/access-control"
import type AccessControlService from "../../modules/access-control/service"

/** Use after native authenticate() for a custom module/API, including configured actor types. */
export function requirePermission(...permissions: string[]) {
  if (!permissions.length)
    throw new Error("At least one permission is required")
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    try {
      const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
      const principal = await access.principalForRequest(req)
      if (!principal)
        return res
          .status(401)
          .json({ message: "An authenticated actor is required" })
      const context = await access.permissionContext(req)
      if (
        !permissions.every((permission) =>
          access.allows(principal, permission, context)
        )
      )
        return res
          .status(403)
          .json({ message: "You do not have permission for this operation" })
      res.setHeader("Cache-Control", "no-store")
      return next()
    } catch (error) {
      return next(error)
    }
  }
}
