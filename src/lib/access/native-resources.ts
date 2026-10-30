import nativeRoutes from "./native-routes.json"
import {
  createRouteMatcher,
  matchRoute,
  type RouteFacts,
  type RouteMethod,
} from "./route-facts"
import {
  actorOwnedPreferences,
  describeResource,
  resourceRoutes,
  type ResourceDefinition,
  type ResourceProfile,
  type ProfileAction,
  type CapabilityPolicy,
} from "./resources"
import { additionalWritePermissions } from "./write-permissions"
import { immutableConfig } from "./immutable-config"
const read = (...permissions: string[]): CapabilityPolicy => ({ permissions })
const commerce: Record<
  string,
  { read: CapabilityPolicy; write: CapabilityPolicy }
> = {
  products: {
    read: read("products.view", "prices.view"),
    write: read("products.edit"),
  },
  "product-variants": {
    read: read("products.view", "prices.view"),
    write: read("products.edit"),
  },
  "product-categories": {
    read: read("categories.view"),
    write: read("categories.manage"),
  },
  collections: {
    read: read("collections.view"),
    write: read("collections.manage"),
  },
  "product-types": {
    read: read("products.view"),
    write: read("product_options.manage"),
  },
  "product-tags": {
    read: read("products.view"),
    write: read("product_options.manage"),
  },
  "product-options": {
    read: read("products.view"),
    write: read("product_options.manage"),
  },
  "product-option-values": {
    read: read("products.view"),
    write: read("product_options.manage"),
  },
  "price-lists": { read: read("prices.view"), write: read("prices.edit") },
  "price-preferences": {
    read: read("prices.view"),
    write: read("prices.edit"),
  },
  "inventory-items": {
    read: read(
      "inventory.view",
      "products.view",
      "prices.view",
      "stock_locations.view"
    ),
    write: read("inventory.adjust"),
  },
  "stock-locations": {
    read: read("stock_locations.view"),
    write: read("stock_locations.manage"),
  },
  reservations: {
    read: read("inventory.view", "products.view", "prices.view"),
    write: read("inventory.adjust"),
  },
  orders: {
    read: read("orders.view"),
    write: read("orders.manage"),
  },
  "order-changes": {
    read: read("orders.view"),
    write: read("orders.manage"),
  },
  "draft-orders": {
    read: read("orders.view"),
    write: read("orders.manage"),
  },
  returns: {
    read: read("orders.view"),
    write: read("orders.manage"),
  },
  exchanges: {
    read: read("orders.view"),
    write: read("orders.manage"),
  },
  claims: {
    read: read("orders.view"),
    write: read("orders.manage"),
  },
  fulfillments: { read: read("orders.view"), write: read("orders.manage") },
  customers: { read: read("customers.view"), write: read("customers.manage") },
  "customer-groups": {
    read: read("customers.view"),
    write: read("customers.manage"),
  },
  payments: { read: read("payments.view"), write: read("payments.capture") },
  "payment-collections": {
    read: read("payments.view"),
    write: read("payments.capture"),
  },
  promotions: {
    read: read("promotions.view"),
    write: read("promotions.manage"),
  },
  campaigns: {
    read: read("promotions.view"),
    write: read("promotions.manage"),
  },
  uploads: { read: read("media.manage"), write: read("media.manage") },
}
const settings = [
  "stores",
  "regions",
  "currencies",
  "countries",
  "sales-channels",
  "shipping-profiles",
  "shipping-options",
  "shipping-option-types",
  "fulfillment-providers",
  "fulfillment-sets",
  "tax-regions",
  "tax-rates",
  "tax-providers",
  "return-reasons",
  "refund-reasons",
  "locales",
  "translations",
]
for (const resource of settings)
  commerce[resource] = {
    read: read("settings.view"),
    write: read("settings.manage"),
  }

// Reviewed structural vocabulary, independent of request URLs. Unrecognized
// members stay unclassified when a future native inventory adds a command.
const members: Record<string, string> = {
  campaigns: "promotions",
  claims: "cancel claim-items inbound items outbound request shipping-method",
  collections: "products",
  "customer-groups": "customers",
  customers: "addresses customer-groups export",
  "draft-orders":
    "confirm convert-to-order edit item items method promotions request shipping-methods",
  exchanges: "cancel inbound items outbound request shipping-method",
  "fulfillment-providers": "options",
  "fulfillment-sets": "service-zones",
  fulfillments: "cancel shipment",
  "inventory-items": "batch export location-levels",
  orders:
    "archive authorize cancel changes complete credit-lines export fulfillments guest line-items mark-as-delivered payment-sessions preview shipments shipping-options transfer",
  "payment-collections": "mark-as-paid payment-sessions",
  payments: "capture payment-providers refund",
  "price-lists": "batch prices products",
  "product-categories": "products",
  "product-options": "values",
  products:
    "batch confirm export images import imports inventory-items options variants",
  promotions:
    "batch buy-rules rule-attribute-options rule-value-options rules target-rules",
  returns:
    "cancel confirm dismiss-items receive receive-items request request-items shipping-method",
  "sales-channels": "products",
  "shipping-options": "batch rules",
  "stock-locations": "fulfillment-providers fulfillment-sets sales-channels",
  "tax-rates": "rules",
  translations: "batch entities settings statistics",
  uploads: "presigned-urls",
  users: "auth-providers me reset-password roles",
  invites: "accept resend",
}
const commands: Record<string, Record<string, string>> = {
  products: { import: "import", imports: "import", export: "export" },
  "product-variants": { import: "import", imports: "import", export: "export" },
  orders: { cancel: "cancel", export: "denied" },
  "draft-orders": { cancel: "cancel" },
  payments: { refund: "refund" },
  customers: { export: "denied" },
  "inventory-items": { export: "denied" },
}
const personalFields = ["id", "email", "first_name", "last_name", "avatar_url"]
const editableProfileFields = ["first_name", "last_name", "avatar_url"]

function addAction(
  profile: ResourceProfile,
  facts: RouteFacts,
  action: ProfileAction
) {
  let node = profile
  for (const segment of facts.segments) {
    if (segment.kind === "literal") {
      const children = (node.children ||= {}) as Record<string, ResourceProfile>
      node = children[segment.value] ||= {}
    } else {
      node.item ||= { parameter: segment.name, profile: {} }
      if (node.item.parameter !== segment.name)
        throw new Error("Conflicting native parameter grammar")
      node = node.item.profile
    }
  }
  node.actions ||= {}
  node.actions[facts.method as RouteMethod] = action
}

function compileNative(
  resource: string,
  policies: { read: CapabilityPolicy; write: CapabilityPolicy }
): ResourceDefinition {
  const profile: ResourceProfile = {}
  const product = ["products", "product-variants"].includes(resource)
  const operations: Record<string, CapabilityPolicy> = {
    read: policies.read,
    write: policies.write,
    create: read("products.create"),
    delete: read("products.delete"),
    import: read(
      "products.import",
      "products.create",
      "products.edit",
      "prices.edit"
    ),
    export: read("products.view", "prices.view", "products.export"),
    refund: read("refunds.issue"),
    cancel: read("orders.cancel"),
    bootstrap: { permissions: [], access: "authenticated" },
    public: { permissions: [], access: "public" },
  }
  for (const route of nativeRoutes.filter(
    (route) => route.path.split("/")[2] === resource
  )) {
    for (const method of route.methods) {
      const facts = matchRoute(
        [route],
        method,
        route.path.replace(/:[^/]+/g, "opaque")
      )!
      const literals = facts.segments
        .filter((segment) => segment.kind === "literal")
        .map((segment) => segment.value)
      if (
        literals.some(
          (literal) => !(members[resource] || "").split(" ").includes(literal)
        )
      )
        continue
      const command = literals
        .map((literal) => commands[resource]?.[literal])
        .find(Boolean)
      if (command === "denied") continue
      let operation = command || (method === "GET" ? "read" : "write")
      if (product && !command) {
        if (method === "DELETE") operation = "delete"
        if (
          resource === "products" &&
          method === "POST" &&
          !facts.segments.length
        )
          operation = "create"
      }
      const variantCollection =
        facts.segments.length === 2 &&
        facts.segments[0].kind === "parameter" &&
        facts.segments[1].kind === "literal" &&
        facts.segments[1].value === "variants"
      const variantItem =
        facts.segments.length === 3 &&
        facts.segments[2].kind === "parameter" &&
        facts.segments[1].kind === "literal" &&
        facts.segments[1].value === "variants"
      const action: ProfileAction = {
        operation,
        fieldResource:
          resource === "products" && (variantCollection || variantItem)
            ? "product-variants"
            : resource,
      }
      if (product && method !== "GET")
        action.payload = (request) =>
          additionalWritePermissions(
            request.body,
            method === "POST" && (operation === "create" || variantCollection)
          )
      if (resource === "stores" && method === "GET" && !facts.segments.length) {
        action.operation = "bootstrap"
        action.fallbackFields = {
          permissions: ["settings.view"],
          fields: ["id", "name"],
        }
      }
      addAction(profile, facts, action)
    }
  }
  return {
    key: resource,
    root: resource,
    actorTypes: ["user"],
    profile,
    operations,
  }
}

function accountResource(root: "users" | "invites"): ResourceDefinition {
  const profile: ResourceProfile = {}
  const operations: Record<string, CapabilityPolicy> = {
    read: { permissions: ["staff.view"], superuser: true },
    manage: { permissions: [], superuser: true },
    self: { permissions: [], access: "authenticated" },
    public: { permissions: [], access: "public" },
  }
  for (const route of nativeRoutes.filter(
    (route) => route.path.split("/")[2] === root
  )) {
    for (const method of route.methods) {
      const facts = matchRoute(
        [route],
        method,
        route.path.replace(/:[^/]+/g, "opaque")
      )!
      const action: ProfileAction = {
        operation: root === "users" && method === "GET" ? "read" : "manage",
      }
      if (root === "users") {
        const item =
          facts.segments.length === 1 && facts.segments[0].kind === "parameter"
        const reset =
          facts.segments.length === 2 &&
          facts.segments[0].kind === "parameter" &&
          facts.segments[1].kind === "literal" &&
          facts.segments[1].value === "reset-password"
        if (
          method !== "GET" &&
          !(
            (method === "POST" && (item || reset)) ||
            (method === "DELETE" && item)
          )
        )
          continue
        if (method === "POST" && item)
          action.self = {
            parameter: "id",
            fields: editableProfileFields,
            responseFields: personalFields,
          }
        if (method === "DELETE")
          action.redirect = {
            destination: "/admin/access/staff/:id",
            parameter: "id",
          }
        if (
          method === "GET" &&
          facts.segments.length === 1 &&
          facts.segments[0].kind === "literal" &&
          facts.segments[0].value === "me"
        ) {
          action.operation = "self"
          action.forceFields = personalFields
        }
      } else if (
        method === "POST" &&
        facts.segments.length === 1 &&
        facts.segments[0].kind === "literal" &&
        facts.segments[0].value === "accept"
      )
        action.operation = "public"
      addAction(profile, facts, action)
    }
  }
  return { key: root, root, profile, operations, actorTypes: ["user"] }
}

const management: ResourceDefinition = {
  key: "access",
  root: "access",
  actorTypes: ["user"],
  operations: {
    self: { permissions: [], access: "authenticated" },
    roles: read("roles.view"),
    staff: read("staff.view"),
    audit: read("audit.view"),
    manage: { permissions: [], superuser: true },
  },
  profile: {
    children: {
      me: { actions: { GET: "self" } },
      permissions: { actions: { GET: "roles" } },
      audit: { actions: { GET: "audit" } },
      roles: {
        actions: { GET: "roles", POST: "manage" },
        item: {
          parameter: "id",
          profile: {
            actions: { GET: "roles", POST: "manage", DELETE: "manage" },
          },
        },
      },
      staff: {
        actions: { GET: "staff" },
        item: {
          parameter: "id",
          profile: {
            actions: { GET: "staff", POST: "manage", DELETE: "manage" },
          },
        },
      },
      invites: {
        actions: { GET: "manage", POST: "manage" },
        item: { parameter: "id", profile: { actions: { DELETE: "manage" } } },
      },
      evaluate: { actions: { POST: "manage" } },
      actors: {
        item: {
          parameter: "actor_type",
          profile: {
            actions: { GET: "manage" },
            item: {
              parameter: "id",
              profile: { actions: { GET: "manage", POST: "manage" } },
            },
          },
        },
      },
    },
  },
}
const layouts: ResourceDefinition = {
  key: "layouts",
  root: "layouts",
  actorTypes: ["user"],
  profile: actorOwnedPreferences({
    parameter: "zone",
    member: "configuration",
    list: "configurations",
    sharedField: "is_default",
  }),
  operations: {
    read: read(),
    save: {
      permissions: [],
      scopes: { personal: [], shared: ["settings.manage"] },
    },
    reset: { permissions: [], scopes: { personal: [] } },
  },
}
export const nativeResources: readonly ResourceDefinition[] = immutableConfig(
  [
    ...Object.entries(commerce).map(([root, policies]) =>
      compileNative(root, policies)
    ),
    accountResource("users"),
    accountResource("invites"),
    management,
    layouts,
    ...["plugins", "feature-flags"].map((root): ResourceDefinition => ({
      key: root,
      root,
      actorTypes: ["user"],
      profile: { actions: { GET: "read" } },
      operations: {
        read: {
          permissions: [],
          access: root === "feature-flags" ? "public" : "authenticated",
        },
      },
    })),
  ].map((resource) => ({
    ...resource,
    fieldRequirements: [
      { pattern: /inventory/, permissions: ["inventory.view"] },
    ],
  }))
)

const nativeMatcher = createRouteMatcher(nativeRoutes)
const managementDefinition = nativeResources.find(
  (resource) => resource.key === "access"
)!
const managementMatcher = createRouteMatcher(
  resourceRoutes(managementDefinition)
)

export function describeNative(
  method: string,
  url: string,
  body?: unknown,
  actorId?: string
) {
  const facts = nativeMatcher(method, url)
  if (!facts) {
    const custom = managementMatcher(method, url)
    return custom
      ? describeResource(managementDefinition, custom, body, actorId)
      : null
  }
  const resource = nativeResources.find(
    (resource) => resource.root === facts.root
  )
  return resource ? describeResource(resource, facts, body, actorId) : null
}
