import type { DataTableSortingState } from "@medusajs/ui"
import type { Role } from "./access"

export const MY_ACCESS_PATH = "/settings/access-management?view=my-access"
export const ROLE_LIST_PATH = "/settings/access-management?view=roles"
export const roleDetailPath = (id: string) =>
  `/settings/access-management/roles/${encodeURIComponent(id)}`
export const roleSource = (role: Role) =>
  role.is_superuser ? "system" : role.source || "admin"
export const roleSourceLabel = (role: Role) =>
  ({ system: "System", configuration: "Configuration", admin: "Admin" })[
    roleSource(role)
  ]
export const roleIsManaged = (role: Role) => roleSource(role) !== "admin"
export function roleCreatedAt(value?: string) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { dateStyle: "medium" })
}
export function roleRows(
  roles: Role[],
  query: string,
  sorting: DataTableSortingState | null
) {
  const rows = roles.filter((role) =>
    `${role.name} ${role.key} ${roleSourceLabel(role)}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  )
  if (sorting)
    rows.sort((left, right) => {
      const order =
        sorting.id === "permissions"
          ? left.permissions.length - right.permissions.length
          : left.name.localeCompare(right.name)
      return sorting.desc ? -order : order
    })
  return rows
}
const activityLabels: Record<string, string> = {
  bootstrap_superuser: "Superuser created",
  create_role: "Role created",
  sync_configured_role: "Role configuration synced",
  revoke_configured_role: "Configured role revoked",
  set_actor: "Account roles updated",
  update_role: "Role updated",
  delete_role: "Role deleted",
  set_staff: "User roles updated",
  record_invite: "User invited",
  accept_invite: "Invitation accepted",
  cancel_invite: "Invitation revoked",
  prepare_user_deletion: "User deletion started",
  delete_user: "User deleted",
  restore_user_access: "User access restored",
}
export function activityLabel(action: string) {
  return activityLabels[action] || "Access updated"
}
