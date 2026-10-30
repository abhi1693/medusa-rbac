import {
  defineMiddlewares,
  authenticate,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http"
import { enforceAdminAccess } from "./middlewares/enforce-admin-access"
import { protectManagedInvites } from "./middlewares/protect-managed-invites"
import { authenticateActor } from "./middlewares/authenticate-actor"
import {
  deleteRoleInput,
  roleInput,
  staffInput,
  updateRoleInput,
  pageInput,
  staffPageInput,
  inviteInput,
  acceptInviteInput,
  acceptInviteQuery,
  evaluateInput,
  actorPageInput,
} from "../lib/access/validators"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/access/actors/:actor_type",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(actorPageInput, {
          defaults: [],
          isList: true,
        }),
      ],
    },
    {
      matcher: "/admin/access/evaluate",
      method: "POST",
      middlewares: [validateAndTransformBody(evaluateInput)],
    },
    {
      matcher: "/admin/access/roles/:id",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(pageInput, { defaults: [], isList: false }),
      ],
    },
    {
      matcher: "/access/actors/:actor_type/me",
      method: "GET",
      middlewares: [authenticateActor],
    },
    { matcher: /^\/admin(?:\/.*)?$/i, middlewares: [enforceAdminAccess] },
    {
      matcher: "/admin/access/invites",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(staffPageInput, {
          defaults: [],
          isList: true,
        }),
      ],
    },
    {
      matcher: "/admin/access/invites",
      method: "POST",
      middlewares: [validateAndTransformBody(inviteInput)],
    },
    {
      matcher: "/admin/invites/accept",
      method: "POST",
      middlewares: [protectManagedInvites],
    },
    {
      matcher: "/admin/invites/:id",
      method: "DELETE",
      middlewares: [protectManagedInvites],
    },
    {
      matcher: "/access/invites/accept",
      method: "POST",
      middlewares: [
        authenticate("user", ["session", "bearer"], {
          allowUnregistered: true,
        }),
        validateAndTransformBody(acceptInviteInput),
        validateAndTransformQuery(acceptInviteQuery, {
          defaults: [],
          isList: false,
        }),
      ],
    },
    {
      matcher: "/admin/access/audit",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(pageInput, { defaults: [], isList: true }),
      ],
    },
    {
      matcher: "/admin/access/staff",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(staffPageInput, {
          defaults: [],
          isList: true,
        }),
      ],
    },
    {
      matcher: "/admin/access/roles",
      method: "POST",
      middlewares: [validateAndTransformBody(roleInput)],
    },
    {
      matcher: "/admin/access/roles/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(updateRoleInput)],
    },
    {
      matcher: "/admin/access/roles/:id",
      method: "DELETE",
      middlewares: [validateAndTransformBody(deleteRoleInput)],
    },
    {
      matcher: "/admin/access/staff/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(staffInput)],
    },
  ],
})
