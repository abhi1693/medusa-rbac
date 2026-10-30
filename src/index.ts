export { ACCESS_CONTROL } from "./modules/access-control"
export { default as AccessControlService } from "./modules/access-control/service"
export * from "./lib/access/permissions"
export * from "./lib/access/config"
export * from "./lib/access/roles"
export {
  requirePermission,
  requireAnyPermission,
} from "./lib/access/middleware"
export { definePermission } from "./lib/access/define-permission"
export { explainPermission } from "./lib/access/explain"
export type { PermissionDecision } from "./lib/access/explain"
export type {
  ActorProvider,
  ActorListQuery,
  ActorListResult,
  ActorOption,
} from "./lib/access/actors"
export type {
  ActorReference,
  ActorAccessRecord,
} from "./modules/access-control/service"
