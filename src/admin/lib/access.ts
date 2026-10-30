import Medusa from "@medusajs/js-sdk"
import { useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { AccessPrincipal, Permission } from "../../lib/access/permissions"
import type { PermissionContext } from "../../lib/access/config"
import type { PermissionDecision } from "../../lib/access/explain"

declare const __BACKEND_URL__: string | undefined
declare const __AUTH_TYPE__: "session" | "jwt" | undefined
declare const __JWT_TOKEN_STORAGE_KEY__: string | undefined

export const sdk = new Medusa({
  baseUrl:
    typeof __BACKEND_URL__ === "string"
      ? __BACKEND_URL__
      : window.location.origin,
  auth: {
    type: typeof __AUTH_TYPE__ === "string" ? __AUTH_TYPE__ : "session",
    jwtTokenStorageKey:
      typeof __JWT_TOKEN_STORAGE_KEY__ === "string"
        ? __JWT_TOKEN_STORAGE_KEY__
        : undefined,
  },
})
export type Role = {
  id: string
  key: string
  name: string
  permissions: Permission[]
  rules?: import("../../lib/access/config").PermissionRule[]
  is_superuser: boolean
  version: number
  source?: "system" | "configuration" | "admin"
  configuration_status?: "active" | "removed"
  actor_count?: number
  pending_invitation_count?: number
  created_at?: string
}
export type Staff = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  roles?: Pick<Role, "id" | "name">[]
  access: { active: boolean; role_ids: string[]; version: number }
}
export type AuditEvent = {
  id: string
  actor_id: string
  action: string
  target_id: string
  created_at: string
  actor_label?: string
  target_label?: string
}
export type PermissionEntry = { id: Permission; label: string; group: string }
export type Invitation = {
  id: string
  email: string
  token: string
  expires_at: string
  created_at: string
  roles: Pick<Role, "id" | "name">[]
  role_ids: string[]
}
const root = "/admin/access"
export const accessApi = {
  profile: () =>
    sdk.client.fetch<{
      user: {
        id: string
        email: string
        first_name: string | null
        last_name: string | null
        avatar_url: string | null
      }
    }>("/admin/users/me"),
  staffUser: (id: string) =>
    sdk.client.fetch<{ staff: Staff }>(`${root}/staff/${id}`),
  me: () =>
    sdk.client.fetch<{
      access: AccessPrincipal
      permission_catalog?: PermissionEntry[]
      roles?: Pick<Role, "id" | "name">[]
    }>(`${root}/me`),
  roles: () => sdk.client.fetch<{ roles: Role[] }>(`${root}/roles`),
  role: (id: string, offset = 0) =>
    sdk.client.fetch<{
      role: Role
      actors: {
        actor_type: string
        actor_id: string
        active: boolean
        label?: string
      }[]
      actor_count: number
      pending_invitation_count: number
    }>(`${root}/roles/${id}`, { query: { offset, limit: 25 } }),
  evaluate: (body: {
    actor_type: string
    actor_id: string
    permission: string
    context: PermissionContext
  }) =>
    sdk.client.fetch<{ decision: PermissionDecision }>(`${root}/evaluate`, {
      method: "POST",
      body,
    }),
  invitations: (offset: number, q = "") =>
    sdk.client.fetch<{ invitations: Invitation[]; count: number }>(
      `${root}/invites`,
      {
        query: { offset, limit: 25, ...(q ? { q } : {}) },
      }
    ),
  createInvitation: (body: { email: string; role_ids: string[] }) =>
    sdk.client.fetch<{ invite: Invitation }>(`${root}/invites`, {
      method: "POST",
      body,
    }),
  deleteInvitation: (id: string) =>
    sdk.client.fetch(`${root}/invites/${id}`, { method: "DELETE" }),
  resendInvitation: (id: string) => sdk.admin.invite.resend(id),
  deleteUser: (id: string) =>
    sdk.client.fetch(`${root}/staff/${id}`, { method: "DELETE" }),
  permissions: () =>
    sdk.client.fetch<{
      permissions: PermissionEntry[]
      actor_types?: string[]
    }>(`${root}/permissions`),
  staff: (offset: number, q = "") =>
    sdk.client.fetch<{ staff: Staff[]; count: number }>(`${root}/staff`, {
      query: { offset, limit: 25, ...(q ? { q } : {}) },
    }),
  audit: (offset: number) =>
    sdk.client.fetch<{
      events: AuditEvent[]
      count: number
    }>(`${root}/audit`, { query: { offset, limit: 25 } }),
  saveRole: (
    role: Pick<Role, "name" | "permissions"> &
      Partial<Pick<Role, "id" | "version" | "rules">>
  ) => {
    const { id, ...body } = role
    return sdk.client.fetch(`${root}/roles${id ? `/${id}` : ""}`, {
      method: "POST",
      body,
    })
  },
  deleteRole: (role: Role) =>
    sdk.client.fetch(`${root}/roles/${role.id}`, {
      method: "DELETE",
      body: { version: role.version },
    }),
  saveStaff: (staff: Staff, role_ids: string[]) =>
    sdk.client.fetch(`${root}/staff/${staff.id}`, {
      method: "POST",
      body: {
        role_ids,
        active: role_ids.length > 0,
        version: staff.access.version,
      },
    }),
}

export function useAccess() {
  const client = useQueryClient()
  const previous = useRef<string>()
  const result = useQuery({
    queryKey: ["medusa-rbac", "me"],
    queryFn: accessApi.me,
    retry: false,
    staleTime: 0,
    refetchInterval: 5000,
    refetchOnWindowFocus: "always",
  })
  const fingerprint =
    result.data?.access && accessFingerprint(result.data.access)
  useEffect(() => {
    if (!result.isFetchedAfterMount || !fingerprint) return
    if (previous.current && previous.current !== fingerprint) {
      void client.invalidateQueries(
        { predicate: (query) => query.queryKey[0] !== "medusa-rbac" },
        { cancelRefetch: false }
      )
    }
    previous.current = fingerprint
  }, [client, fingerprint, result.isFetchedAfterMount])
  return result
}

export function accessFingerprint(access: AccessPrincipal) {
  return JSON.stringify([
    access.actor_id,
    access.actor_type,
    access.active,
    access.is_superuser,
    [...access.role_ids].sort(),
    [...access.permissions].sort(),
    access.rules || [],
  ])
}

export function useRefreshAccess() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: ["medusa-rbac"] })
}

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request failed. Reload and try again."
}
