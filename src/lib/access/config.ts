import nativeRoutes from "./native-routes.json"
import type { MedusaRequest } from "@medusajs/framework/http"
import { PERMISSIONS, type AccessPrincipal } from "./permissions"
import { policyFor, type Policy } from "./policy"
import { permissionKeyMatches as matchesPermission } from "./permission-key"

export type PermissionDefinition = readonly [
  id: string,
  label: string,
  group: string,
]
export type PermissionContext = Record<string, string | number | boolean | null>
export type PermissionRule = {
  permission: string
  effect: "allow" | "deny"
  priority?: number
  conditions?: Record<
    string,
    string | number | boolean | null | (string | number | boolean | null)[]
  >
}
export type RoutePolicy = Policy & { method: string; path: string }
export type AccessControlOptions = {
  /** Additional permissions; native permission identifiers cannot be replaced. */
  permissions?: PermissionDefinition[]
  /** Explicit policies for custom APIs. Native/management policies take precedence. */
  routes?: RoutePolicy[]
  contextResolvers?: ((
    request: MedusaRequest
  ) => PermissionContext | Promise<PermissionContext>)[]
  /** Resolvers for custom APIs only. The Admin API always requires a native user. */
  actors?: {
    type: string
    validate: (id: string, request: MedusaRequest) => Promise<void>
  }[]
}

export function createAccessConfig(options: AccessControlOptions = {}) {
  const permissions: PermissionDefinition[] = [...PERMISSIONS]
  const ids = new Set(permissions.map(([id]) => id))
  for (const definition of options.permissions || []) {
    const [id, label, group] = definition
    if (
      !/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/.test(id) ||
      !label?.trim() ||
      !group?.trim() ||
      ids.has(id)
    )
      throw new Error(`Invalid or duplicate permission: ${id}`)
    ids.add(id)
    permissions.push([id, label, group])
  }
  const nativeRoots = new Set(
    nativeRoutes.map((route) => route.path.split("/")[2])
  )
  const signatures = new Set<string>()
  const routes = (options.routes || []).map((route) => {
    const method = route.method.toUpperCase()
    const signature = `${method} ${route.path}`
    if (
      !/^(GET|POST|PUT|PATCH|DELETE)$/.test(method) ||
      !/^\/(?:[a-z0-9_-]+|:[a-z][a-z0-9_]*)(?:\/(?:[a-z0-9_-]+|:[a-z][a-z0-9_]*))*$/.test(
        route.path
      ) ||
      signatures.has(signature) ||
      route.permissions.some((id) => !ids.has(id)) ||
      (!route.permissions.length && !route.superuser)
    )
      throw new Error(`Invalid or duplicate route policy: ${signature}`)
    signatures.add(signature)
    return {
      ...route,
      method,
      pattern: new RegExp(
        `^${route.path.replace(/:[a-z][a-z0-9_]*/g, "[^/]+")}$`
      ),
    }
  })
  const actors = options.actors || []
  if (
    new Set(actors.map((actor) => actor.type)).size !== actors.length ||
    actors.some(
      (actor) =>
        !actor.type ||
        ["user", "customer"].includes(actor.type) ||
        typeof actor.validate !== "function"
    )
  )
    throw new Error(
      "Actor resolvers must have unique types other than user and customer"
    )
  return {
    permissions,
    ids: [...ids],
    actors,
    contextResolvers: options.contextResolvers || [],
    policyFor(method: string, path: string): Policy | null {
      const native = policyFor(method, path)
      if (native) return native
      // Never reopen native APIs or the access-management namespace with an extension.
      if (
        /^\/admin\/(?:access|rbac|users|invites|workflows|workflow-executions|api-keys|search|search-indexes)(?:\/|$)/.test(
          path
        )
      )
        return null
      if (path.startsWith("/admin/") && nativeRoots.has(path.split("/")[2]))
        return null
      const verb = method === "HEAD" ? "GET" : method
      return (
        routes.find(
          (route) => route.method === verb && route.pattern.test(path)
        ) || null
      )
    },
  }
}

export function validateRules(
  value: unknown,
  ids: readonly string[]
): PermissionRule[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 200)
    throw new Error("Rules must be an array of at most 200 entries")
  return value.map((rule) => {
    if (
      !rule ||
      typeof rule !== "object" ||
      Array.isArray(rule) ||
      Object.keys(rule).some(
        (key) =>
          !["permission", "effect", "priority", "conditions"].includes(key)
      ) ||
      typeof rule.permission !== "string" ||
      !(
        ids.includes(rule.permission) ||
        ((rule.permission === "*" ||
          /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*\.\*$/.test(rule.permission)) &&
          ids.some((id) => matchesPermission(rule.permission, id)))
      ) ||
      !["allow", "deny"].includes(rule.effect) ||
      (rule.priority !== undefined &&
        (!Number.isSafeInteger(rule.priority) ||
          Math.abs(rule.priority) > 1000000))
    )
      throw new Error("Invalid permission rule")
    const conditions = rule.conditions
    const scalar = (value: unknown) =>
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    if (
      conditions !== undefined &&
      (!conditions ||
        typeof conditions !== "object" ||
        Array.isArray(conditions) ||
        Object.keys(conditions).length > 30 ||
        Object.entries(conditions).some(
          ([key, value]) =>
            !/^[a-z][a-z0-9_]*$/.test(key) ||
            !(Array.isArray(value)
              ? value.length > 0 && value.length <= 100 && value.every(scalar)
              : scalar(value))
        ))
    )
      throw new Error("Invalid rule conditions")
    return {
      ...rule,
      ...(conditions ? { conditions: { ...conditions } } : {}),
    }
  })
}

/** Priority, then exact key/namespace specificity, then condition count, then deny. */
export function evaluatePermission(
  principal: AccessPrincipal,
  permission: string,
  context: PermissionContext = {}
): boolean {
  if (!principal.active) return false
  if (principal.is_superuser) return true
  const candidates = (principal.rules || []).filter(
    (rule) =>
      matchesPermission(rule.permission, permission) &&
      Object.entries(rule.conditions || {}).every(
        ([key, expected]) =>
          Object.hasOwn(context, key) &&
          (Array.isArray(expected)
            ? expected.includes(context[key])
            : expected === context[key])
      )
  )
  if (principal.permissions.includes(permission))
    candidates.push({ permission, effect: "allow" })
  const score = (rule: PermissionRule) => [
    rule.priority || 0,
    rule.permission === permission ? 1000 : rule.permission.split(".").length,
    Object.keys(rule.conditions || {}).length,
  ]
  candidates.sort((a, b) => {
    const left = score(a),
      right = score(b)
    return (
      right[0] - left[0] ||
      right[1] - left[1] ||
      right[2] - left[2] ||
      Number(b.effect === "deny") - Number(a.effect === "deny")
    )
  })
  return candidates[0]?.effect === "allow"
}
