import {
  PERMISSION_IDS,
  PERMISSIONS,
  SUPERUSER_AUTHORITY,
  type AccessPrincipal,
} from "../../src/lib/access/permissions"
import type { Role, Staff, PermissionEntry } from "../../src/admin/lib/access"

export const createRole = (overrides: Partial<Role> = {}): Role => ({
  id: "reader",
  key: "reader",
  name: "Reader",
  permissions: ["products.view"],
  is_superuser: false,
  version: 1,
  ...overrides,
})
export const createSuperuserRole = (overrides: Partial<Role> = {}): Role =>
  createRole({
    id: "admin",
    key: "superuser",
    name: "Superuser",
    permissions: [...PERMISSION_IDS],
    is_superuser: true,
    ...overrides,
  })
export const createPrincipal = (
  overrides: Partial<AccessPrincipal> = {}
): AccessPrincipal => ({
  actor_id: "user",
  actor_type: "user",
  active: true,
  is_superuser: true,
  role_ids: ["admin"],
  permissions: [...PERMISSION_IDS],
  ...overrides,
})
export const createStaffAccess = () => ({
  id: "staff",
  actor_id: "user",
  actor_type: "user",
  active: true,
  version: 1,
})
export const createStaff = (overrides: Partial<Staff> = {}): Staff => ({
  id: "staff",
  email: "staff@example.test",
  first_name: null,
  last_name: null,
  access: { active: true, role_ids: ["reader"], version: 3 },
  ...overrides,
})
export const editorPermissions: PermissionEntry[] = [
  { id: "products.view", label: "View products", group: "Catalog" },
  { id: "prices.view", label: "View prices", group: "Catalog" },
  { id: "staff.view", label: "View staff", group: "Access" },
]

export const createProfile = (overrides = {}) => ({
  id: "user",
  email: "staff@example.test",
  first_name: "Test",
  last_name: "Staff",
  avatar_url: null,
  ...overrides,
})
export const createInvitation = (overrides = {}) => ({
  id: "inv_test",
  email: "invited@example.test",
  metadata: { rbac_access_managed: true },
  ...overrides,
})
export const createInvitationAccess = (overrides = {}) => ({
  id: "rbia_test",
  invite_id: "inv_test",
  actor_id: "user",
  email: "invited@example.test",
  status: "pending",
  user_id: null,
  role_ids: ["reader"],
  ...overrides,
})
export const invitationEmail = (label: string) => `invite-${label}@example.test`

export const createUserDeletion = (overrides = {}) => ({
  actor_id: "user",
  user_id: "target",
  access_id: "staff",
  version: 2,
  previous_active: true as boolean | null,
  role_ids: ["reader"],
  ...overrides,
})

export const createAuditEvent = (overrides = {}) => ({
  id: "audit_event",
  actor_id: "user",
  target_id: "reader",
  action: "create_role",
  created_at: "2026-10-30T10:00:00Z",
  actor_label: "staff@example.test",
  target_label: "Reader",
  ...overrides,
})

export async function withAccessMetadata(path: string, value: any) {
  value = await value
  if (value instanceof Error) return value
  if (path === "/admin/access/me")
    return {
      permission_catalog: PERMISSIONS.map(([id, label, group]) => ({
        id,
        label,
        group,
      })),
      superuser_authority: SUPERUSER_AUTHORITY,
      ...value,
    }
  if (path === "/admin/access/permissions")
    return { superuser_authority: SUPERUSER_AUTHORITY, ...value }
  return value
}
