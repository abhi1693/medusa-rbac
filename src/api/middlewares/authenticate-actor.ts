import {
  authenticate,
  type MedusaRequest,
  type MedusaResponse,
  type MedusaNextFunction,
} from "@medusajs/framework/http"
import { ACCESS_CONTROL } from "../../modules/access-control"
import type AccessControlService from "../../modules/access-control/service"

export async function authenticateActor(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  try {
    const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
    const type = req.params.actor_type
    if (
      ![
        "user",
        "customer",
        ...access.configuration.actors.map((actor) => actor.type),
      ].includes(type)
    )
      return res
        .status(401)
        .json({ message: "An authenticated actor is required" })
    return await authenticate(type, ["bearer", "session"])(req, res, next)
  } catch (error) {
    return next(error)
  }
}
