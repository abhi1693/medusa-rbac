import type { AccessPrincipal } from "./permissions"

export function permissionKeyMatches(pattern: string, permission: string) {
  return (
    pattern === permission ||
    pattern === "*" ||
    (pattern.endsWith(".*") && permission.startsWith(pattern.slice(0, -1)))
  )
}

/** Navigation hint only. Request authorization must evaluate trusted server context. */
export function hasPermissionCandidate(
  principal: AccessPrincipal,
  permission: string
): boolean {
  return (
    principal.active &&
    (principal.is_superuser ||
      principal.permissions.includes(permission) ||
      Boolean(
        principal.rules?.some(
          (rule) =>
            rule.effect === "allow" &&
            permissionKeyMatches(rule.permission, permission)
        )
      ))
  )
}
