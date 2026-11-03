import { describe, expect, it, vi } from "vitest"
import type { MedusaRequest } from "@medusajs/framework/http"
import { createAccessConfig } from "../../src/lib/access/config"
import { PERMISSION_IDS } from "../../src/lib/access/permissions"
import {
  commandProfile,
  crudProfile,
  defineResource,
  operationAllowed,
  validateResources,
  type ResourceDefinition,
  type ResourceProfile,
} from "../../src/resources"
import { createPrincipal } from "../fixtures/access"
import AccessControlService from "../../src/modules/access-control/service"
import { isBootstrapRead } from "../../src/lib/access/policy"

const definition = (): ResourceDefinition =>
  defineResource({
    key: "documents",
    root: "documents",
    actorTypes: ["user"],
    profile: crudProfile(),
    operations: {
      read: { permissions: ["products.view"] },
      create: { permissions: ["products.create"] },
      update: { permissions: ["products.edit"] },
      delete: { permissions: ["products.delete"] },
    },
  })
const reserved = [{ key: "products", root: "products" }]
const check = (value: unknown) =>
  validateResources(value, PERMISSION_IDS, reserved)
const request = (
  url = "/admin/documents/Document_AbC",
  body: unknown = {},
  method = "POST"
) =>
  ({
    originalUrl: url,
    method,
    body,
    auth_context: { actor_type: "user", actor_id: "User_AbC" },
  }) as unknown as MedusaRequest

describe("resource registration validation", () => {
  it("accepts complete host-owned registrations without mutating them", () => {
    const resource: ResourceDefinition = {
      ...definition(),
      namespace: "store",
      fields: ["id", "title"],
      resolveScope: async () => "personal" as const,
      fieldRequirements: [
        { pattern: /inventory/i, permissions: ["inventory.view"] },
      ],
      profile: {
        item: {
          parameter: "id",
          profile: {
            actions: {
              POST: {
                operation: "update",
                fieldResource: "document-summaries",
                payload: async () => [],
                scope: { kind: "personal" },
                forceFields: ["id"],
                fallbackFields: {
                  permissions: ["products.view"],
                  fields: ["id"],
                },
                self: {
                  parameter: "id",
                  fields: ["title"],
                  responseFields: ["id", "title"],
                },
                redirect: {
                  destination: "/store/documents/:id",
                  parameter: "id",
                },
              },
            },
          },
        },
      },
      operations: {
        update: {
          permissions: ["products.edit"],
          access: "authenticated",
          superuser: false,
          scopes: { personal: [] },
        },
      },
    }
    const registrations = [resource]
    expect(check(registrations)).toEqual(registrations)
    expect(resource.profile.item!.parameter).toBe("id")
    const shared = commandProfile("read", "GET")
    expect(
      check([
        {
          ...definition(),
          profile: { children: { one: shared, two: shared } },
        },
      ])
    ).toHaveLength(1)
  })

  it("rejects malformed declarations and bounded collection violations", () => {
    for (const value of [
      undefined,
      null,
      {},
      "documents",
      [null],
      [false],
      ["documents"],
      Array.from({ length: 101 }, (_, i) => ({
        ...definition(),
        key: `documents${i}`,
        root: `documents${i}`,
      })),
    ])
      expect(() => check(value)).toThrow()
    const invalid: Array<[string, unknown]> = [
      ["key", undefined],
      ["key", ""],
      ["key", "Documents"],
      ["key", "constructor"],
      ["root", undefined],
      ["root", "../products"],
      ["root", "__proto__"],
      ["namespace", 1],
      ["namespace", "Admin"],
      ["namespace", "a".repeat(65)],
      ["actorTypes", undefined],
      ["actorTypes", []],
      ["actorTypes", [1]],
      ["actorTypes", [""]],
      ["actorTypes", Array(501).fill("user")],
      ["actorTypes", ["a".repeat(201)]],
      ["fields", null],
      ["fields", [1]],
      ["fields", [""]],
      ["operations", undefined],
      ["operations", {}],
      ["resolveScope", "personal"],
      ["unknown_option", true],
    ]
    for (const [property, value] of invalid)
      expect(
        () => check([{ ...definition(), [property]: value }]),
        property
      ).toThrow()
  })

  it("rejects resource collisions and leaves later independent configurations usable", () => {
    for (const resource of [
      { ...definition(), key: "products" },
      { ...definition(), root: "products" },
    ])
      expect(() => check([resource])).toThrow()
    expect(() => check([definition(), definition()])).toThrow()
    expect(() =>
      check([definition(), { ...definition(), key: "other" }])
    ).toThrow()
    expect(
      check([{ ...definition(), namespace: "store", root: "products" }])
    ).toHaveLength(1)
    expect(check([definition()])).toHaveLength(1)
    expect(() =>
      createAccessConfig({ resources: [{ ...definition(), root: "products" }] })
    ).toThrow()
  })

  it("validates operation grants, access modes and scope grants against the catalog", () => {
    const invalid = [
      null,
      [],
      "read",
      { permissions: null },
      { permissions: ["unregistered.view"] },
      { permissions: [], extra: true },
      { permissions: [], superuser: "true" },
      { permissions: [], access: "anyone" },
      { permissions: ["products.view"], access: "public" },
      { permissions: [], access: "public", superuser: true },
      { permissions: [], access: "public", scopes: { personal: [] } },
      { permissions: [], scopes: null },
      { permissions: [], scopes: {} },
      { permissions: [], scopes: { team: [] } },
      { permissions: [], scopes: { shared: ["unregistered.manage"] } },
    ]
    for (const capability of invalid)
      expect(() =>
        check([{ ...definition(), operations: { read: capability } }])
      ).toThrow()
    expect(() =>
      check([{ ...definition(), operations: { Read: { permissions: [] } } }])
    ).toThrow()
    for (const access of [
      "public",
      "authenticated",
      "active-principal",
    ] as const)
      expect(
        check([
          {
            ...definition(),
            operations: {
              ...definition().operations,
              read: { permissions: [], access },
            },
          },
        ])
      ).toHaveLength(1)
  })

  it("rejects unsafe profile structures, cycles and duplicate parameter bindings", () => {
    const cycle: ResourceProfile = { children: {} }
    cycle.children = { recursive: cycle }
    let deep: ResourceProfile = commandProfile("read", "GET")
    for (let i = 0; i < 14; i++) deep = { children: { next: deep } }
    const many: ResourceProfile = {
      children: Object.fromEntries(
        Array.from({ length: 501 }, (_, i) => [
          `command${i}`,
          commandProfile("read", "GET"),
        ])
      ),
    }
    for (const profile of [
      null,
      {},
      { extra: true },
      cycle,
      deep,
      many,
      { actions: undefined },
      { actions: null },
      { actions: {} },
      { actions: { TRACE: "read" } },
      { actions: { GET: "unknown" } },
      { actions: { GET: null } },
      { children: null },
      { children: {} },
      { children: { Constructor: commandProfile("read", "GET") } },
      { item: null },
      { item: { parameter: "", profile: commandProfile("read") } },
      { item: { parameter: "constructor", profile: commandProfile("read") } },
      {
        item: { parameter: "id", extra: true, profile: commandProfile("read") },
      },
      {
        item: {
          parameter: "id",
          profile: {
            item: { parameter: "id", profile: commandProfile("read") },
          },
        },
      },
    ])
      expect(() => check([{ ...definition(), profile }])).toThrow()
  })

  it("validates each action's selectors, callbacks, projections and redirect binding", () => {
    const invalid = [
      { operation: 1 },
      { operation: "read", extra: true },
      { operation: "read", fieldResource: "../users" },
      { operation: "read", fieldResource: 1 },
      { operation: "read", payload: [] },
      { operation: "read", forceFields: [1] },
      { operation: "read", scope: null },
      { operation: "read", scope: { kind: "team" } },
      { operation: "read", scope: { kind: "personal", extra: true } },
      { operation: "read", scope: { kind: "boolean" } },
      { operation: "read", scope: { kind: "boolean", field: "../scope" } },
      { operation: "read", fallbackFields: null },
      { operation: "read", fallbackFields: { permissions: [], fields: [1] } },
      {
        operation: "read",
        fallbackFields: { permissions: ["unknown.view"], fields: [] },
      },
      {
        operation: "read",
        fallbackFields: { permissions: [], fields: [], extra: true },
      },
      { operation: "read", self: null },
      {
        operation: "read",
        self: { parameter: "unbound", fields: [], responseFields: [] },
      },
      {
        operation: "read",
        self: { parameter: "id", fields: [1], responseFields: [] },
      },
      {
        operation: "read",
        self: { parameter: "id", fields: [], responseFields: [1] },
      },
      { operation: "read", redirect: null },
      {
        operation: "read",
        redirect: { destination: "https://example.test", parameter: "id" },
      },
      {
        operation: "read",
        redirect: { destination: "/admin/documents/:id", parameter: "unbound" },
      },
      {
        operation: "read",
        redirect: {
          destination: "/admin/documents/:id?admin=true",
          parameter: "id",
        },
      },
    ]
    for (const action of invalid)
      expect(() =>
        check([
          {
            ...definition(),
            profile: {
              item: { parameter: "id", profile: { actions: { GET: action } } },
            },
          },
        ])
      ).toThrow()
    for (const fieldRequirements of [
      null,
      Array(101).fill({ pattern: /x/, permissions: [] }),
      [null],
      [{ pattern: "inventory", permissions: [] }],
      [{ pattern: /inventory/g, permissions: [] }],
      [{ pattern: /inventory/y, permissions: [] }],
      [{ pattern: /inventory/, permissions: ["unknown.view"] }],
      [{ pattern: /inventory/, permissions: [], extra: true }],
    ])
      expect(() => check([{ ...definition(), fieldRequirements }])).toThrow()
  })
})

describe("registered request resolution", () => {
  it("rejects malformed URLs before trying a configured resource or route", async () => {
    const configuration = createAccessConfig({ resources: [definition()] })
    for (const url of [
      "/admin//documents",
      "prefix/admin/documents",
      "/admin/documents/%zz",
    ]) {
      expect(configuration.policyFor("GET", url)).toBeNull()
      expect(
        await configuration.resolveRequest(request(url, {}, "GET"))
      ).toBeNull()
    }
    expect(isBootstrapRead("GET", "/admin/unregistered")).toBe(false)
  })

  it("exposes complete registered request resolution through the module service", async () => {
    const service = Object.create(
      AccessControlService.prototype
    ) as AccessControlService
    const descriptor = await service.resolveRequest(
      request("/admin/products/Product_AbC")
    )
    expect(descriptor).toMatchObject({
      resource: "products",
      params: { id: "Product_AbC" },
      policy: { permissions: ["products.edit"] },
    })
  })

  it("isolates registered authority from later changes to caller-owned definitions", async () => {
    const grants = ["products.edit"]
    const actors = ["user"]
    const pattern = /inventory/
    const resource: ResourceDefinition = {
      ...definition(),
      actorTypes: actors,
      operations: {
        ...definition().operations,
        update: { permissions: grants },
      },
      fields: ["id", "inventory_quantity"],
      fieldRequirements: [{ pattern, permissions: ["inventory.view"] }],
    }
    const configuration = createAccessConfig({ resources: [resource] })
    grants.length = 0
    actors[0] = "customer"
    resource.root = "replacement"
    resource.profile.item!.profile.actions!.POST = "delete"
    pattern.compile("unrelated")
    const operation = (await configuration.resolveRequest(request()))!
    expect(operation.operation).toBe("update")
    expect(operation.policy.permissions).toEqual(["products.edit"])
    expect(operation.actorTypes).toEqual(["user"])
    expect(operation.fieldRequirements[0].pattern.source).toBe("inventory")
    expect(
      await configuration.resolveRequest(
        request("/admin/replacement/Document_AbC")
      )
    ).toBeNull()
    expect(Object.isFrozen(configuration.resources[0])).toBe(true)
    expect(() =>
      (configuration.resources[0].actorTypes as string[]).push("customer")
    ).toThrow()
  })

  it("gives scope and payload callbacks immutable operation context", async () => {
    const configuration = createAccessConfig({
      resources: [
        {
          ...definition(),
          resolveScope: async (_req, context) => {
            expect(() => {
              context.params.id = "Other"
            }).toThrow()
            expect(() => {
              context.facts.params.id = "Other"
            }).toThrow()
            return "global" as const
          },
          profile: {
            item: {
              parameter: "id",
              profile: {
                actions: {
                  POST: {
                    operation: "update",
                    payload: async (_req, operation) => {
                      expect(() => {
                        operation.policy.permissions.length = 0
                      }).toThrow()
                      expect(() => {
                        operation.params.id = "Other"
                      }).toThrow()
                      return []
                    },
                  },
                },
              },
            },
          },
        },
      ],
    })
    const operation = await configuration.resolveRequest(request())
    expect(operation?.params).toEqual({ id: "Document_AbC" })
    expect(operation?.policy.permissions).toEqual(["products.edit"])
  })

  it("copies explicit route capabilities instead of retaining mutable grant arrays", async () => {
    const route = {
      method: "GET" as const,
      path: "/admin/documents",
      permissions: ["products.view"],
    }
    const configuration = createAccessConfig({ routes: [route] })
    route.permissions.length = 0
    route.path = "/admin/replacement"
    expect(configuration.policyFor("GET", "/admin/documents")).toEqual({
      permissions: ["products.view"],
    })
    expect(configuration.policyFor("GET", "/admin/replacement")).toBeNull()
  })

  it("keeps registered resource boundaries authoritative over parameterized route policies", async () => {
    const configuration = createAccessConfig({
      resources: [
        {
          ...definition(),
          profile: commandProfile("read", "GET"),
          operations: { read: { permissions: ["products.view"] } },
        },
      ],
      routes: [
        {
          method: "GET",
          path: "/admin/:area/:id",
          permissions: ["products.view"],
        },
      ],
    })
    for (const url of [
      "/admin/documents/unreviewed",
      "/ADMIN/DOCUMENTS/Unreviewed",
    ]) {
      expect(configuration.policyFor("GET", url)).toBeNull()
      expect(
        await configuration.resolveRequest(request(url, {}, "GET"))
      ).toBeNull()
    }
    expect(configuration.policyFor("GET", "/admin/documents")).toEqual({
      permissions: ["products.view"],
    })
    expect(
      await configuration.resolveRequest(
        request("/admin/other/Some_ID", {}, "GET")
      )
    ).toMatchObject({
      operation: "configured",
      params: { area: "other", id: "Some_ID" },
      policy: { permissions: ["products.view"] },
    })
  })

  it("resolves trusted asynchronous scope and conditional capabilities on the registered resource", async () => {
    const resolveScope = vi.fn(async () => "personal" as const)
    const payload = vi.fn(async () => ["prices.edit", "products.edit"])
    const resource: ResourceDefinition = {
      ...definition(),
      resolveScope,
      profile: {
        item: {
          parameter: "id",
          profile: { actions: { POST: { operation: "update", payload } } },
        },
      },
      operations: {
        update: {
          permissions: ["products.edit"],
          scopes: { personal: ["products.view"] },
        },
      },
    }
    const configuration = createAccessConfig({ resources: [resource] })
    const req = request()
    const operation = await configuration.resolveRequest(req)
    expect(operation).toMatchObject({
      resource: "documents",
      scope: "personal",
      params: { id: "Document_AbC" },
      policy: {
        permissions: ["products.edit", "products.view", "prices.edit"],
      },
    })
    expect(resolveScope).toHaveBeenCalledWith(
      req,
      expect.objectContaining({
        resource: "documents",
        operation: "update",
        params: { id: "Document_AbC" },
      })
    )
    expect(payload).toHaveBeenCalledWith(
      req,
      expect.objectContaining({ resource: "documents" })
    )
    expect(
      configuration.policyFor("POST", "/admin/documents/Document_AbC")
    ).toBeNull()
    expect(
      await configuration.resolveRequest(
        request("/admin/documents/Document_AbC/unknown")
      )
    ).toBeNull()
  })

  it("fails closed when scope or payload resolvers cannot produce registered requirements", async () => {
    for (const resolveScope of [async () => null, async () => "unreviewed"]) {
      const configuration = createAccessConfig({
        resources: [{ ...definition(), resolveScope } as ResourceDefinition],
      })
      expect(await configuration.resolveRequest(request())).toBeNull()
    }
    for (const value of [null, "products.edit", ["unknown.view"]]) {
      const configuration = createAccessConfig({
        resources: [
          {
            ...definition(),
            profile: {
              item: {
                parameter: "id",
                profile: {
                  actions: {
                    POST: { operation: "update", payload: async () => value },
                  },
                },
              },
            },
          } as ResourceDefinition,
        ],
      })
      expect(await configuration.resolveRequest(request())).toBeNull()
    }
    const error = new Error("Trusted scope resolver failed")
    const configuration = createAccessConfig({
      resources: [
        {
          ...definition(),
          resolveScope: async () => {
            throw error
          },
        },
      ],
    })
    await expect(configuration.resolveRequest(request())).rejects.toBe(error)
  })

  it("keeps actors, principal activation, Superuser and capability checks independent", async () => {
    const operation = (await createAccessConfig({
      resources: [definition()],
    }).resolveRequest(request()))!
    const allows = vi.fn().mockReturnValue(true)
    const principal = createPrincipal({
      is_superuser: false,
      actor_type: "user",
    })
    expect(operationAllowed(principal, operation, allows)).toBe(true)
    expect(allows.mock.calls.map(([permission]) => permission)).toEqual([
      "products.edit",
    ])
    expect(operationAllowed(null, operation, allows)).toBe(false)
    expect(
      operationAllowed(
        { ...principal, actor_type: "customer" },
        operation,
        allows
      )
    ).toBe(false)
    expect(
      operationAllowed({ ...principal, active: false }, operation, allows)
    ).toBe(false)
    expect(
      operationAllowed(
        principal,
        { ...operation, policy: { permissions: [], superuser: true } },
        allows
      )
    ).toBe(false)
    expect(
      operationAllowed(
        { ...principal, is_superuser: true },
        { ...operation, policy: { permissions: [], superuser: true } },
        allows
      )
    ).toBe(true)
    expect(operationAllowed(principal, operation, () => false)).toBe(false)
    expect(
      operationAllowed(
        { ...principal, active: false },
        { ...operation, access: "authenticated" },
        allows
      )
    ).toBe(true)
    const publicOperation = {
      ...operation,
      access: "public" as const,
      policy: { permissions: [] },
    }
    expect(operationAllowed(null, publicOperation, allows)).toBe(true)
    expect(
      operationAllowed(
        null,
        { ...publicOperation, policy: { permissions: ["products.view"] } },
        allows
      )
    ).toBe(false)
    expect(
      operationAllowed(
        principal,
        { ...publicOperation, policy: { permissions: [], superuser: true } },
        allows
      )
    ).toBe(false)
  })
})
