import nativeRoutes from "./native-routes.json"
import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
} from "@medusajs/framework/http"
import {
  PERMISSIONS,
  validatePermissions,
  type AccessPrincipal,
} from "./permissions"
import { type Policy } from "./policy"
import { describeNative, nativeResources } from "./native-resources"
import { canonicalPath, createRouteMatcher } from "./route-facts"
import {
  describeResource,
  profileAction,
  resourceRoutes,
  validateResources,
  type OperationDescriptor,
  type ResourceDefinition,
} from "./resources"
import { permissionKeyMatches as matchesPermission } from "./permission-key"
import {
  SUPERUSER_ROLE,
  type RoleDefinition,
  type ConfiguredRoleDefinition,
} from "./roles"
import { explainPermission } from "./explain"
import { immutableConfig } from "./immutable-config"
import type { ActorProvider } from "./actors"

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
  /** Optional application roles managed in code, without automatic assignments. */
  roles?: readonly RoleDefinition[]
  /** Explicit policies for custom APIs. Native/management policies take precedence. */
  routes?: RoutePolicy[]
  /** Structural capability registrations for application/plugin-owned APIs. */
  resources?: readonly ResourceDefinition[]
  contextResolvers?: ((
    request: MedusaRequest
  ) => PermissionContext | Promise<PermissionContext>)[]
  /** Resolvers for custom APIs only. The Admin API always requires a native user. */
  actors?: ActorProvider[]
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
  const roleKeys = new Set<string>()
  const roleNames = new Set<string>([SUPERUSER_ROLE.name.toLowerCase()])
  if (
    options.roles !== undefined &&
    (!Array.isArray(options.roles) || options.roles.length > 100)
  )
    throw new Error("Configured roles must be an array of at most 100 entries")
  const roles: ConfiguredRoleDefinition[] = (options.roles || []).map(
    (definition) => {
      if (
        !definition ||
        typeof definition !== "object" ||
        Array.isArray(definition) ||
        Object.keys(definition).some(
          (key) => !["key", "name", "permissions", "rules"].includes(key)
        ) ||
        typeof definition.key !== "string" ||
        !/^[a-z][a-z0-9_-]{0,63}$/.test(definition.key) ||
        definition.key === SUPERUSER_ROLE.key ||
        roleKeys.has(definition.key) ||
        typeof definition.name !== "string" ||
        !definition.name.trim() ||
        definition.name.trim().length > 100 ||
        roleNames.has(definition.name.trim().toLowerCase())
      )
        throw new Error("Invalid, reserved or duplicate configured role")
      roleKeys.add(definition.key)
      roleNames.add(definition.name.trim().toLowerCase())
      return {
        key: definition.key,
        name: definition.name.trim(),
        permissions: validatePermissions(
          definition.permissions === undefined ? [] : definition.permissions,
          [...ids]
        ),
        rules: validateRules(definition.rules, [...ids]),
      }
    }
  )
  const nativeRoots = new Set(
    nativeRoutes.map((route) => route.path.split("/")[2])
  )
  const signatures = new Set<string>()
  const routes = immutableConfig(
    (options.routes || []).map((route) => {
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
      }
    })
  )
  const resources = validateResources(
    options.resources || [],
    [...ids],
    [
      ...nativeResources,
      ...[...nativeRoots].map((root) => ({ key: root, root })),
      ...routes.map((route) => {
        const parts = route.path.split("/")
        return { key: parts[2], root: parts[2], namespace: parts[1] }
      }),
    ]
  )
  const resourceMatcher = createRouteMatcher(resources.flatMap(resourceRoutes))
  const configuredMatcher = createRouteMatcher(
    routes.map((route) => ({ path: route.path, methods: [route.method] }))
  )
  const resourceOwners = new Set(
    resources.map(
      (resource) => `${resource.namespace || "admin"}/${resource.root}`
    )
  )
  const reserved = (url: string) => {
    const path = canonicalPath(url)
    if (!path) return true
    const parts = path.toLowerCase().split("/")
    return (
      parts[1] === "admin" &&
      (nativeRoots.has(parts[2]) ||
        nativeResources.some((resource) => resource.root === parts[2]) ||
        [
          "rbac",
          "workflows",
          "workflow-executions",
          "api-keys",
          "search",
          "search-indexes",
        ].includes(parts[2]))
    )
  }
  const custom = (
    method: string,
    url: string,
    body?: unknown,
    actorId?: string
  ): OperationDescriptor | null => {
    if (reserved(url)) return null
    const facts = resourceMatcher(method, url)
    if (facts) {
      const resource = resources.find(
        (resource) =>
          resource.root === facts.root &&
          (resource.namespace || "admin") === facts.namespace
      )!
      return describeResource(resource, facts, body, actorId)
    }
    const parts = canonicalPath(url)!.toLowerCase().split("/")
    if (resourceOwners.has(`${parts[1]}/${parts[2]}`)) return null
    const route = configuredMatcher(method, url)
    if (!route) return null
    const policy = routes.find(
      (policy) =>
        policy.path === route.template && policy.method === route.method
    )!
    return {
      facts: route,
      resource: route.root,
      operation: "configured",
      scope: "global",
      params: route.params,
      fieldResource: route.root,
      actorTypes: ["user"],
      access: "active-principal",
      self: false,
      policy: {
        permissions: [...policy.permissions],
        ...(policy.superuser ? { superuser: true } : {}),
      },
      action: { operation: "configured" },
      fieldRequirements: [],
    }
  }
  const actors = options.actors || []
  if (
    new Set(actors.map((actor) => actor.type)).size !== actors.length ||
    actors.some(
      (actor) =>
        !actor.type ||
        ["user", "customer"].includes(actor.type) ||
        typeof actor.validate !== "function" ||
        (actor.list !== undefined && typeof actor.list !== "function")
    )
  )
    throw new Error(
      "Actor resolvers must have unique types other than user and customer"
    )
  return {
    permissions,
    roles,
    ids: [...ids],
    actors,
    resources,
    contextResolvers: options.contextResolvers || [],
    /** Structural inspection only. Enforce resolveRequest(request) with operationAllowed. */
    policyFor(method: string, path: string): Policy | null {
      return (
        (describeNative(method, path, {}) || custom(method, path, {}))
          ?.policy || null
      )
    },
    async resolveRequest(
      request: MedusaRequest
    ): Promise<OperationDescriptor | null> {
      const actorId = (request as Partial<AuthenticatedMedusaRequest>)
        .auth_context?.actor_id
      let descriptor = describeNative(
        request.method,
        request.originalUrl,
        request.body,
        actorId
      )
      if (!descriptor && !reserved(request.originalUrl)) {
        const facts = resourceMatcher(request.method, request.originalUrl)
        const resource =
          facts &&
          resources.find(
            (resource) =>
              resource.root === facts.root &&
              (resource.namespace || "admin") === facts.namespace
          )
        if (facts && resource?.resolveScope) {
          const action = profileAction(resource.profile, facts)!
          const scope = await resource.resolveScope(
            request,
            immutableConfig({
              facts,
              resource: resource.key,
              operation: action.operation,
              params: facts.params,
            })
          )
          if (
            scope === null ||
            !["global", "personal", "shared"].includes(scope)
          )
            return null
          descriptor = describeResource(
            resource,
            facts,
            request.body,
            actorId,
            scope
          )
        } else
          descriptor = custom(
            request.method,
            request.originalUrl,
            request.body,
            actorId
          )
      }
      if (!descriptor) return null
      if (descriptor.action.payload) {
        const permissions = await descriptor.action.payload(
          request,
          immutableConfig(descriptor)
        )
        if (
          !Array.isArray(permissions) ||
          permissions.some((permission) => !ids.has(permission))
        )
          return null
        descriptor.policy.permissions = [
          ...new Set([...descriptor.policy.permissions, ...permissions]),
        ]
      }
      return descriptor
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
      permission: rule.permission,
      effect: rule.effect,
      ...(rule.priority !== undefined ? { priority: rule.priority } : {}),
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
  return explainPermission(principal, permission, context).allowed
}
