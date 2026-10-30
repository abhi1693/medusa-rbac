import type { PermissionContext, PermissionRule } from "./config"
import type { AccessPrincipal } from "./permissions"
import { permissionKeyMatches } from "./permission-key"

export type PermissionDecision = {
  allowed: boolean
  reason: "inactive" | "superuser" | "no_match" | "allow" | "deny"
  matches: (PermissionRule & { source: "permission" | "rule" })[]
}

/** The shared decision engine used by enforcement and permission diagnostics. */
export function explainPermission(
  principal: AccessPrincipal,
  permission: string,
  context: PermissionContext = {}
): PermissionDecision {
  if (!principal.active)
    return { allowed: false, reason: "inactive", matches: [] }
  if (principal.is_superuser)
    return { allowed: true, reason: "superuser", matches: [] }
  const matches: PermissionDecision["matches"] = (principal.rules || [])
    .filter(
      (rule) =>
        permissionKeyMatches(rule.permission, permission) &&
        Object.entries(rule.conditions || {}).every(
          ([key, expected]) =>
            Object.hasOwn(context, key) &&
            (Array.isArray(expected)
              ? expected.includes(context[key])
              : expected === context[key])
        )
    )
    .map((rule) => ({ ...rule, source: "rule" }))
  if (principal.permissions.includes(permission))
    matches.push({ permission, effect: "allow", source: "permission" })
  const score = (rule: PermissionRule) => [
    rule.priority || 0,
    rule.permission === permission ? 1000 : rule.permission.split(".").length,
    Object.keys(rule.conditions || {}).length,
  ]
  matches.sort((a, b) => {
    const left = score(a)
    const right = score(b)
    return (
      right[0] - left[0] ||
      right[1] - left[1] ||
      right[2] - left[2] ||
      Number(b.effect === "deny") - Number(a.effect === "deny")
    )
  })
  return {
    allowed: matches[0]?.effect === "allow",
    reason: matches[0]?.effect || "no_match",
    matches,
  }
}
