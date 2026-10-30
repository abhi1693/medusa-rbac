import { describe, expect, it } from "vitest"
import {
  actorOwnedPreferences,
  commandProfile,
  crudProfile,
  defineResource,
  describeResource,
  describeResources,
  profileAction,
  resourceRoutes,
  type ResourceDefinition,
} from "../../src/resources"
import { matchRoute } from "../../src/lib/access/route-facts"

const documents = defineResource({
  key: "documents",
  namespace: "store",
  root: "documents",
  actorTypes: ["customer"],
  fields: ["id", "title"],
  profile: {
    ...crudProfile({ children: { approve: commandProfile("approve") } }),
    children: {
      batch: commandProfile("batch"),
      export: commandProfile("export", "GET"),
    },
  },
  operations: {
    read: { permissions: ["documents.read"] },
    create: { permissions: ["documents.create"] },
    update: { permissions: ["documents.update"] },
    delete: { permissions: ["documents.delete"] },
    approve: { permissions: ["documents.approve"] },
    batch: { permissions: ["documents.batch"] },
    export: { permissions: ["documents.export"] },
  },
})

const preferences = defineResource({
  key: "workspace-preferences",
  root: "workspace-preferences",
  actorTypes: ["user"],
  profile: actorOwnedPreferences({
    parameter: "surface",
    member: "definition",
    list: "definitions",
    sharedField: "team_shared",
  }),
  operations: {
    read: { permissions: [] },
    save: {
      permissions: [],
      scopes: { personal: [], shared: ["settings.manage"] },
    },
    reset: { permissions: [] },
  },
})

describe("resource profiles", () => {
  it("registers a new resource and actor namespace without changing the evaluator", () => {
    const cases = [
      ["GET", "/store/documents", "read"],
      ["POST", "/store/documents", "create"],
      ["GET", "/store/documents/Document_A", "read"],
      ["POST", "/store/documents/Document_A", "update"],
      ["DELETE", "/store/documents/Document_A", "delete"],
      ["POST", "/store/documents/Document_A/approve", "approve"],
      ["POST", "/store/documents/batch", "batch"],
      ["GET", "/store/documents/export", "export"],
    ] as const
    for (const [method, url, operation] of cases) {
      const result = describeResources([documents], method, url)!
      expect(result, `${method} ${url}`).toMatchObject({
        resource: "documents",
        operation,
        actorTypes: ["customer"],
        fields: ["id", "title"],
        access: "active-principal",
        policy: { permissions: [`documents.${operation}`] },
      })
    }
    expect(
      describeResources([documents], "POST", "/store/documents/Exporter")
        ?.operation
    ).toBe("update")
    expect(
      describeResources([documents], "GET", "/store/documents/batch")?.operation
    ).toBe("read")
  })

  it("uses explicit operations for custom CRUD vocabulary and parameter names", () => {
    const resource = defineResource({
      key: "approvals",
      root: "approvals",
      actorTypes: ["user"],
      profile: crudProfile({
        parameter: "request_id",
        read: "inspect",
        create: "submit",
        update: "revise",
        delete: "withdraw",
      }),
      operations: {
        inspect: {
          permissions: ["approvals.inspect"],
          access: "authenticated",
        },
        submit: { permissions: ["approvals.submit"] },
        revise: { permissions: ["approvals.revise"] },
        withdraw: { permissions: ["approvals.withdraw"], superuser: true },
      },
    })
    const result = describeResources(
      [resource],
      "DELETE",
      "/admin/approvals/Request_AbC"
    )!
    expect(result.params).toEqual({ request_id: "Request_AbC" })
    expect(result.policy).toEqual({
      permissions: ["approvals.withdraw"],
      superuser: true,
    })
    expect(
      describeResources([resource], "GET", "/admin/approvals")?.access
    ).toBe("authenticated")
    expect(
      describeResources([resource], "POST", "/admin/approvals")?.operation
    ).toBe("submit")
    expect(
      describeResources([resource], "POST", "/admin/approvals/Request_AbC")
        ?.operation
    ).toBe("revise")
  })

  it("keeps unknown commands and methods denied inside an otherwise registered resource", () => {
    for (const [method, url] of [
      ["GET", "/admin/documents"],
      ["PATCH", "/store/documents/Document_A"],
      ["POST", "/store/documents/Document_A/unregistered"],
      ["GET", "/store/documents/Document_A/approve"],
      ["POST", "/store/documents/export/extra"],
    ])
      expect(
        describeResources([documents], method, url),
        `${method} ${url}`
      ).toBeNull()
  })

  it("does not classify an opaque parameter as a literal command", () => {
    const facts = matchRoute(
      [{ path: "/store/documents/:id", methods: ["POST"] }],
      "POST",
      "/store/documents/batch"
    )!
    expect(profileAction(documents.profile, facts)).toEqual({
      operation: "update",
    })
    expect(describeResource(documents, facts)?.policy.permissions).toEqual([
      "documents.update",
    ])
    const wrongParameter = {
      ...facts,
      segments: [
        { kind: "parameter", name: "wrong_id", value: "batch" } as const,
      ],
    }
    expect(profileAction(documents.profile, wrongParameter)).toBeNull()
    const unregisteredLiteral = {
      ...facts,
      segments: [{ kind: "literal", value: "unregistered" } as const],
    }
    expect(profileAction(documents.profile, unregisteredLiteral)).toBeNull()
    expect(describeResource(documents, unregisteredLiteral)).toBeNull()
    expect(describeResource({ ...documents, operations: {} }, facts)).toBeNull()
  })

  it("generates transport registrations from the same structural profile", () => {
    const routes = resourceRoutes(documents)
    expect(routes).toEqual(
      expect.arrayContaining([
        { path: "/store/documents", methods: ["GET", "POST"] },
        { path: "/store/documents/:id", methods: ["GET", "POST", "DELETE"] },
        { path: "/store/documents/:id/approve", methods: ["POST"] },
        { path: "/store/documents/batch", methods: ["POST"] },
        { path: "/store/documents/export", methods: ["GET"] },
      ])
    )
    expect(resourceRoutes({ ...documents, profile: {} })).toEqual([])
  })
})

describe("actor-owned preference profiles", () => {
  it("supports a second module's own personal/shared discriminator", () => {
    const path = "/admin/workspace-preferences/Product.Detail_A/definition"
    for (const body of [
      {},
      { team_shared: false },
      { team_shared: undefined },
    ]) {
      const personal = describeResources([preferences], "POST", path, body)!
      expect(personal.scope).toBe("personal")
      expect(personal.policy.permissions).toEqual([])
      expect(personal.params).toEqual({ surface: "Product.Detail_A" })
    }
    const shared = describeResources([preferences], "POST", path, {
      team_shared: true,
    })!
    expect(shared.scope).toBe("shared")
    expect(shared.policy.permissions).toEqual(["settings.manage"])
    expect(describeResources([preferences], "DELETE", path)?.scope).toBe(
      "personal"
    )
    expect(
      describeResources(
        [preferences],
        "GET",
        "/admin/workspace-preferences/definitions"
      )?.operation
    ).toBe("read")
  })

  it("rejects malformed scope values without coercing them into personal access", () => {
    const path = "/admin/workspace-preferences/Product.Detail_A/definition"
    for (const body of [undefined, null, [], "opaque", 1, false])
      expect(describeResources([preferences], "POST", path, body)).toBeNull()
    for (const team_shared of ["false", "true", 0, 1, null, [], {}])
      expect(
        describeResources([preferences], "POST", path, { team_shared })
      ).toBeNull()
    const forbidden = {
      ...preferences,
      operations: {
        ...preferences.operations,
        save: { permissions: [], scopes: { personal: [] } },
      },
    }
    expect(
      describeResources([forbidden], "POST", path, { team_shared: true })
    ).toBeNull()
  })

  it("requires an explicit grant for a resolved scope and preserves the registered field resource", () => {
    const resource: ResourceDefinition = {
      ...documents,
      profile: {
        actions: {
          GET: { operation: "read", fieldResource: "document-summaries" },
        },
      },
      operations: {
        read: { permissions: [], scopes: { shared: ["documents.shared"] } },
      },
    }
    const facts = matchRoute(
      resourceRoutes(resource),
      "GET",
      "/store/documents"
    )!
    expect(describeResource(resource, facts)).toBeNull()
    expect(
      describeResource(resource, facts, undefined, undefined, "shared")
    ).toMatchObject({
      scope: "shared",
      fieldResource: "document-summaries",
      policy: { permissions: ["documents.shared"] },
    })
  })

  it("binds self-service fields to the actual case-sensitive actor ID", () => {
    const resource = defineResource({
      key: "profiles",
      root: "profiles",
      actorTypes: ["user"],
      profile: {
        item: {
          parameter: "id",
          profile: {
            actions: {
              POST: {
                operation: "update",
                self: {
                  parameter: "id",
                  fields: ["first_name"],
                  responseFields: ["id", "first_name"],
                },
              },
            },
          },
        },
      },
      operations: {
        update: { permissions: ["staff.manage"], superuser: true },
      },
    })
    const own = describeResources(
      [resource],
      "POST",
      "/admin/profiles/User_AbC",
      { first_name: "Name" },
      "User_AbC"
    )!
    expect(own.access).toBe("authenticated")
    expect(own.policy).toEqual({ permissions: [] })
    expect(own.action.forceFields).toEqual(["id", "first_name"])
    expect(own.self).toBe(true)
    for (const [actor, body] of [
      ["user_abc", { first_name: "Name" }],
      ["User_Other", { first_name: "Name" }],
      ["User_AbC", { first_name: "Name", role_ids: [] }],
      ["User_AbC", { metadata: { is_superuser: true } }],
      ["User_AbC", null],
      ["User_AbC", []],
      [undefined, { first_name: "Name" }],
    ] as const) {
      const result = describeResources(
        [resource],
        "POST",
        "/admin/profiles/User_AbC",
        body,
        actor
      )!
      expect(result.access).toBe("active-principal")
      expect(result.self).toBe(false)
      expect(result.policy).toEqual({
        permissions: ["staff.manage"],
        superuser: true,
      })
    }
    const unbound: ResourceDefinition = {
      ...resource,
      profile: {
        item: {
          parameter: "id",
          profile: {
            actions: {
              POST: {
                operation: "update",
                self: {
                  parameter: "unbound",
                  fields: ["first_name"],
                  responseFields: ["id"],
                },
              },
            },
          },
        },
      },
    }
    const unresolved = describeResources(
      [unbound],
      "POST",
      "/admin/profiles/User_AbC",
      { first_name: "Name" }
    )!
    expect(unresolved.self).toBe(false)
    expect(unresolved.policy.superuser).toBe(true)
  })
})
