import type { MedusaRequest } from "@medusajs/framework/http"
import type { RouteFacts, RouteMethod, RouteRegistration } from "./route-facts"
import { matchRoute } from "./route-facts"
import type { AccessPrincipal } from "./permissions"
import { immutableConfig } from "./immutable-config"

const identifier = /^[a-z][a-z0-9_-]{0,63}$/
const parameter = /^[a-z][a-z0-9_]{0,63}$/
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key)
const safeName = (name: string) =>
  identifier.test(name) &&
  !["constructor", "prototype", "__proto__"].includes(name)
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
const keys = (value: object, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key))
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 500 &&
  value.every(
    (item) => typeof item === "string" && item.length > 0 && item.length <= 200
  )

export type AccessMode = "public" | "authenticated" | "active-principal"
export type ResourceScope = "global" | "personal" | "shared"
export type CapabilityPolicy = {
  permissions: readonly string[]
  superuser?: boolean
  access?: AccessMode
  scopes?: Partial<Record<ResourceScope, readonly string[]>>
}
export type ProfileAction = {
  operation: string
  fieldResource?: string
  payload?: (
    request: MedusaRequest,
    operation: OperationDescriptor
  ) => readonly string[] | null | Promise<readonly string[] | null>
  scope?: { kind: "boolean"; field: string } | { kind: "personal" }
  forceFields?: readonly string[]
  fallbackFields?: { permissions: readonly string[]; fields: readonly string[] }
  self?: {
    parameter: string
    fields: readonly string[]
    responseFields: readonly string[]
  }
  redirect?: { destination: string; parameter: string }
}
export type ResourceProfile = {
  actions?: Partial<Record<RouteMethod, string | ProfileAction>>
  item?: { parameter: string; profile: ResourceProfile }
  children?: Readonly<Record<string, ResourceProfile>>
}
export type OperationDescriptor = {
  facts: RouteFacts
  resource: string
  operation: string
  scope: ResourceScope
  params: Record<string, string>
  fieldResource: string
  actorTypes: readonly string[]
  access: AccessMode
  self: boolean
  policy: { permissions: string[]; superuser?: boolean }
  action: ProfileAction
  fields?: readonly string[]
  fieldRequirements: readonly {
    pattern: RegExp
    permissions: readonly string[]
  }[]
}
export type ResourceDefinition = {
  key: string
  namespace?: string
  root: string
  profile: ResourceProfile
  operations: Readonly<Record<string, CapabilityPolicy>>
  actorTypes: readonly string[]
  fields?: readonly string[]
  fieldRequirements?: readonly {
    pattern: RegExp
    permissions: readonly string[]
  }[]
  resolveScope?: (
    request: MedusaRequest,
    operation: {
      facts: RouteFacts
      resource: string
      operation: string
      params: Record<string, string>
    }
  ) => ResourceScope | null | Promise<ResourceScope | null>
}

export function defineResource<const T extends ResourceDefinition>(
  definition: T
): T {
  return definition
}

export function crudProfile(
  options: {
    parameter?: string
    read?: string
    create?: string
    update?: string
    delete?: string
    children?: Readonly<Record<string, ResourceProfile>>
  } = {}
): ResourceProfile {
  const read = options.read || "read"
  return {
    actions: { GET: read, POST: options.create || "create" },
    item: {
      parameter: options.parameter || "id",
      profile: {
        actions: {
          GET: read,
          POST: options.update || "update",
          DELETE: options.delete || "delete",
        },
        children: options.children,
      },
    },
  }
}

export function commandProfile(
  operation: string,
  method: RouteMethod = "POST"
): ResourceProfile {
  return { actions: { [method]: operation } }
}

export function actorOwnedPreferences(options: {
  parameter: string
  member: string
  list: string
  sharedField: string
}): ResourceProfile {
  return {
    children: { [options.list]: { actions: { GET: "read" } } },
    item: {
      parameter: options.parameter,
      profile: {
        children: {
          [options.member]: {
            actions: {
              GET: "read",
              POST: {
                operation: "save",
                scope: { kind: "boolean", field: options.sharedField },
              },
              DELETE: { operation: "reset", scope: { kind: "personal" } },
            },
          },
        },
      },
    },
  }
}

export function profileAction(
  profile: ResourceProfile,
  facts: RouteFacts
): ProfileAction | null {
  let node = profile
  for (const segment of facts.segments) {
    if (segment.kind === "literal") {
      const next =
        node.children && own(node.children, segment.value)
          ? node.children[segment.value]
          : undefined
      if (!next) return null
      node = next
    } else {
      if (!node.item || node.item.parameter !== segment.name) return null
      node = node.item.profile
    }
  }
  const action = node.actions?.[facts.method as RouteMethod]
  return typeof action === "string" ? { operation: action } : action || null
}

export function resourceRoutes(
  resource: ResourceDefinition
): RouteRegistration[] {
  const routes: RouteRegistration[] = []
  const visit = (profile: ResourceProfile, path: string) => {
    if (profile.actions)
      routes.push({ path, methods: Object.keys(profile.actions) })
    for (const [member, child] of Object.entries(profile.children || {}))
      visit(child, `${path}/${member}`)
    if (profile.item)
      visit(profile.item.profile, `${path}/:${profile.item.parameter}`)
  }
  visit(resource.profile, `/${resource.namespace || "admin"}/${resource.root}`)
  return routes
}

export function describeResource(
  resource: ResourceDefinition,
  facts: RouteFacts,
  body?: unknown,
  actorId?: string,
  resolvedScope?: ResourceScope
): OperationDescriptor | null {
  const action = profileAction(resource.profile, facts)
  if (!action) return null
  const capability = own(resource.operations, action.operation)
    ? resource.operations[action.operation]
    : undefined
  if (!capability) return null
  let scope: ResourceScope = "global"
  if (action.scope?.kind === "personal") scope = "personal"
  if (action.scope?.kind === "boolean") {
    if (!body || typeof body !== "object" || Array.isArray(body)) return null
    const flag = (body as Record<string, unknown>)[action.scope.field]
    if (flag !== undefined && typeof flag !== "boolean") return null
    scope = flag === true ? "shared" : "personal"
  }
  scope = resolvedScope || scope
  const scoped = capability.scopes?.[scope]
  if (capability.scopes && !scoped) return null
  const self = Boolean(
    action.self &&
    actorId &&
    own(facts.params, action.self.parameter) &&
    actorId === facts.params[action.self.parameter] &&
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body).every((key) => action.self!.fields.includes(key))
  )
  return {
    facts,
    resource: resource.key,
    operation: action.operation,
    scope,
    params: facts.params,
    fieldResource: action.fieldResource || resource.key,
    actorTypes: resource.actorTypes,
    access: self ? "authenticated" : capability.access || "active-principal",
    self,
    policy: self
      ? { permissions: [] }
      : {
          permissions: [...capability.permissions, ...(scoped || [])],
          ...(capability.superuser ? { superuser: true } : {}),
        },
    action: self
      ? { ...action, forceFields: action.self!.responseFields }
      : action,
    fields: resource.fields,
    fieldRequirements: resource.fieldRequirements || [],
  }
}

export function describeResources(
  resources: readonly ResourceDefinition[],
  method: string,
  url: string,
  body?: unknown,
  actorId?: string
): OperationDescriptor | null {
  const facts = matchRoute(resources.flatMap(resourceRoutes), method, url)
  if (!facts) return null
  const resource = resources.find(
    (definition) =>
      definition.root === facts.root &&
      (definition.namespace || "admin") === facts.namespace
  )!
  return describeResource(resource, facts, body, actorId)
}

export function operationAllowed(
  principal: AccessPrincipal | null,
  operation: OperationDescriptor,
  allows: (permission: string) => boolean
): boolean {
  if (operation.access === "public")
    return (
      operation.policy.permissions.length === 0 && !operation.policy.superuser
    )
  return Boolean(
    principal &&
    operation.actorTypes.includes(principal.actor_type) &&
    (operation.access === "authenticated" || principal.active) &&
    (!operation.policy.superuser || principal.is_superuser) &&
    operation.policy.permissions.every(allows)
  )
}

/** Validate host-owned registrations. Native resources cannot be replaced. */
export function validateResources(
  value: unknown,
  permissions: readonly string[],
  reserved: readonly Pick<ResourceDefinition, "key" | "root" | "namespace">[]
): ResourceDefinition[] {
  const invalid = (): never => {
    throw new Error("Invalid, conflicting or reserved resource registration")
  }
  if (!Array.isArray(value) || value.length > 100) return invalid()
  const resourceKeys = new Set(reserved.map((resource) => resource.key))
  const roots = new Set(
    reserved.map(
      (resource) => `${resource.namespace || "admin"}/${resource.root}`
    )
  )
  const registered = new Set(permissions)
  const permissionList = (list: unknown) =>
    strings(list) && list.every((permission) => registered.has(permission))
  for (const definition of value) {
    if (
      !record(definition) ||
      !keys(definition, [
        "key",
        "namespace",
        "root",
        "profile",
        "operations",
        "actorTypes",
        "fields",
        "fieldRequirements",
        "resolveScope",
      ]) ||
      typeof definition.key !== "string" ||
      !safeName(definition.key) ||
      typeof definition.root !== "string" ||
      !safeName(definition.root) ||
      (definition.namespace !== undefined &&
        (typeof definition.namespace !== "string" ||
          !safeName(definition.namespace))) ||
      !strings(definition.actorTypes) ||
      !definition.actorTypes.length ||
      !record(definition.operations) ||
      !Object.keys(definition.operations).length ||
      (definition.fields !== undefined && !strings(definition.fields)) ||
      (definition.resolveScope !== undefined &&
        typeof definition.resolveScope !== "function")
    )
      return invalid()
    const root = `${definition.namespace || "admin"}/${definition.root}`
    if (resourceKeys.has(definition.key) || roots.has(root)) return invalid()
    resourceKeys.add(definition.key)
    roots.add(root)
    for (const [operation, capability] of Object.entries(
      definition.operations
    )) {
      if (
        !safeName(operation) ||
        !record(capability) ||
        !keys(capability, ["permissions", "superuser", "access", "scopes"]) ||
        !permissionList(capability.permissions) ||
        (capability.superuser !== undefined &&
          typeof capability.superuser !== "boolean") ||
        (capability.access !== undefined &&
          !["public", "authenticated", "active-principal"].includes(
            capability.access as string
          ))
      )
        return invalid()
      if (
        capability.access === "public" &&
        ((capability.permissions as string[]).length > 0 ||
          capability.superuser === true ||
          capability.scopes !== undefined)
      )
        return invalid()
      if (
        capability.scopes !== undefined &&
        (!record(capability.scopes) ||
          !Object.keys(capability.scopes).length ||
          Object.entries(capability.scopes).some(
            ([scope, grants]) =>
              !["global", "personal", "shared"].includes(scope) ||
              !permissionList(grants)
          ))
      )
        return invalid()
    }
    if (
      definition.fieldRequirements !== undefined &&
      (!Array.isArray(definition.fieldRequirements) ||
        definition.fieldRequirements.length > 100 ||
        definition.fieldRequirements.some(
          (requirement) =>
            !record(requirement) ||
            !keys(requirement, ["pattern", "permissions"]) ||
            !(requirement.pattern instanceof RegExp) ||
            requirement.pattern.global ||
            requirement.pattern.sticky ||
            !permissionList(requirement.permissions)
        ))
    )
      return invalid()
    const seen = new Set<object>()
    const validateProfile = (
      profile: unknown,
      depth: number,
      bound: readonly string[]
    ): void => {
      if (
        depth > 12 ||
        !record(profile) ||
        seen.has(profile) ||
        !keys(profile, ["actions", "item", "children"]) ||
        !Object.keys(profile).length
      )
        return invalid()
      seen.add(profile)
      if (profile.actions !== undefined) {
        if (!record(profile.actions) || !Object.keys(profile.actions).length)
          return invalid()
        for (const [method, rawAction] of Object.entries(profile.actions)) {
          if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method))
            return invalid()
          const action =
            typeof rawAction === "string" ? { operation: rawAction } : rawAction
          if (
            !record(action) ||
            !keys(action, [
              "operation",
              "fieldResource",
              "payload",
              "scope",
              "forceFields",
              "fallbackFields",
              "self",
              "redirect",
            ]) ||
            typeof action.operation !== "string" ||
            !own(definition.operations as object, action.operation) ||
            (action.fieldResource !== undefined &&
              (typeof action.fieldResource !== "string" ||
                !safeName(action.fieldResource))) ||
            (action.payload !== undefined &&
              typeof action.payload !== "function") ||
            (action.forceFields !== undefined && !strings(action.forceFields))
          )
            return invalid()
          if (
            action.scope !== undefined &&
            (!record(action.scope) ||
              !keys(action.scope, ["kind", "field"]) ||
              !["personal", "boolean"].includes(action.scope.kind as string) ||
              (action.scope.kind === "boolean" &&
                (typeof action.scope.field !== "string" ||
                  !parameter.test(action.scope.field))))
          )
            return invalid()
          if (
            action.fallbackFields !== undefined &&
            (!record(action.fallbackFields) ||
              !keys(action.fallbackFields, ["permissions", "fields"]) ||
              !permissionList(action.fallbackFields.permissions) ||
              !strings(action.fallbackFields.fields))
          )
            return invalid()
          if (
            action.self !== undefined &&
            (!record(action.self) ||
              !keys(action.self, ["parameter", "fields", "responseFields"]) ||
              typeof action.self.parameter !== "string" ||
              !parameter.test(action.self.parameter) ||
              !bound.includes(action.self.parameter) ||
              !strings(action.self.fields) ||
              !strings(action.self.responseFields))
          )
            return invalid()
          if (
            action.redirect !== undefined &&
            (!record(action.redirect) ||
              !keys(action.redirect, ["destination", "parameter"]) ||
              typeof action.redirect.destination !== "string" ||
              !/^\/(?:[a-z0-9_-]+|:[a-z][a-z0-9_]*)(?:\/(?:[a-z0-9_-]+|:[a-z][a-z0-9_]*))*$/.test(
                action.redirect.destination
              ) ||
              typeof action.redirect.parameter !== "string" ||
              !parameter.test(action.redirect.parameter) ||
              !bound.includes(action.redirect.parameter))
          )
            return invalid()
        }
      }
      if (profile.children !== undefined) {
        if (!record(profile.children) || !Object.keys(profile.children).length)
          return invalid()
        for (const [member, child] of Object.entries(profile.children)) {
          if (!safeName(member)) return invalid()
          validateProfile(child, depth + 1, bound)
        }
      }
      if (profile.item !== undefined) {
        if (
          !record(profile.item) ||
          !keys(profile.item, ["parameter", "profile"]) ||
          typeof profile.item.parameter !== "string" ||
          !parameter.test(profile.item.parameter) ||
          !safeName(profile.item.parameter)
        )
          return invalid()
        validateProfile(profile.item.profile, depth + 1, [
          ...bound,
          profile.item.parameter,
        ])
      }
      seen.delete(profile)
    }
    validateProfile(definition.profile, 0, [])
    const routes = resourceRoutes(definition as ResourceDefinition)
    if (
      !routes.length ||
      routes.length > 500 ||
      routes.some((route) => {
        const params = route.path
          .split("/")
          .filter((segment) => segment.startsWith(":"))
        return new Set(params).size !== params.length
      })
    )
      return invalid()
  }
  return immutableConfig(value) as ResourceDefinition[]
}
