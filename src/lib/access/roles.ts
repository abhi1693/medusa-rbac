import type { PermissionRule } from "./config"

/** The only role installed by the plugin itself; assignment is always explicit. */
export const SUPERUSER_ROLE = Object.freeze({
  key: "superuser",
  name: "Superuser",
  is_superuser: true,
} as const)

export const DEFAULT_ROLES = Object.freeze([SUPERUSER_ROLE])

/** Application-owned roles. Their grants are synchronized from configuration. */
export type RoleDefinition = {
  key: string
  name: string
  permissions?: readonly string[]
  rules?: readonly PermissionRule[]
}

export type ConfiguredRoleDefinition = {
  key: string
  name: string
  permissions: string[]
  rules: PermissionRule[]
}

export type RoleSource = "system" | "configuration" | "admin"

/** Preserve literal types while checking a role definition at its declaration. */
export function defineRole<const T extends RoleDefinition>(definition: T): T {
  return definition
}

export function configuredRoleKey(key: string): string {
  return `configured_${key}`
}

export function roleSource(role: {
  key: string
  is_superuser: boolean
}): RoleSource {
  if (role.is_superuser) return "system"
  return role.key.startsWith("configured_") ? "configuration" : "admin"
}
