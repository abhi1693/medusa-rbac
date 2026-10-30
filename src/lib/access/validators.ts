import { z } from "@medusajs/framework/zod"
import { isPermissionContext } from "./permission-context"
import type { PermissionContext } from "./config"

const permission = z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/)
export const roleInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    permissions: z.array(permission).max(1000),
    rules: z.array(z.unknown()).max(200).optional(),
  })
  .strict()
export const updateRoleInput = roleInput.extend({
  version: z.number().int().min(1),
})
export const deleteRoleInput = z
  .object({ version: z.number().int().min(1) })
  .strict()
export const staffInput = z
  .object({
    role_ids: z.array(z.string().min(1).max(100)).max(50),
    active: z.boolean(),
    version: z.number().int().min(0),
  })
  .strict()
export const pageInput = z.object({
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})
export const staffPageInput = pageInput.extend({
  q: z.string().trim().max(100).optional(),
})
export type StaffPageInput = z.infer<typeof staffPageInput>
export type PageInput = z.infer<typeof pageInput>
export const inviteInput = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    role_ids: z.array(z.string().min(1).max(100)).min(1).max(50),
  })
  .strict()
export const acceptInviteInput = z
  .object({
    email: z.string().email().optional(),
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
  })
  .strict()
export const acceptInviteQuery = z.object({ token: z.string().min(1) }).strict()

export const evaluateInput = z
  .object({
    actor_type: z.string().min(1).max(100),
    actor_id: z.string().min(1).max(100),
    permission,
    context: z.custom<PermissionContext>(isPermissionContext).default({}),
  })
  .strict()
