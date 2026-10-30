import { describe, expect, it, vi } from "vitest"
import {
  createAccessConfig,
  type AccessControlOptions,
} from "../../src/lib/access/config"
import {
  DEFAULT_ROLES,
  SUPERUSER_ROLE,
  defineRole,
  configuredRoleKey,
  roleSource,
} from "../../src/lib/access/roles"
import AccessControlService from "../../src/modules/access-control/service"
import moduleDefinition from "../../src/modules/access-control"
import validateOptions from "../../src/modules/access-control/loaders/validate-options"
import syncConfiguredRoles from "../../src/scripts/sync-configured-roles"
import {
  createRole,
  createStaffAccess,
  createSuperuserRole,
} from "../fixtures/access"

const definition = defineRole({
  key: "catalog-reader",
  name: "Catalog reader",
  permissions: ["products.view"],
})
const configured = createRole({
  id: "configured-reader",
  key: configuredRoleKey(definition.key),
  name: definition.name,
  permissions: [...definition.permissions],
  rules: [],
})
const admin = createSuperuserRole()
const reader = createRole()
const staff = createStaffAccess()

function harness(options: AccessControlOptions, ...responses: unknown[]) {
  const execute = vi.fn()
  for (const response of responses) execute.mockResolvedValueOnce(response)
  const service = Object.assign(Object.create(AccessControlService.prototype), {
    accessConfig_: createAccessConfig(options),
  }) as AccessControlService
  const manager = { execute }
  return {
    service,
    execute,
    context: { manager, transactionManager: manager } as any,
  }
}

describe("role declarations", () => {
  it("ships only the protected Superuser and preserves literal role definitions", () => {
    expect(DEFAULT_ROLES).toEqual([SUPERUSER_ROLE])
    expect(SUPERUSER_ROLE).toEqual({
      key: "superuser",
      name: "Superuser",
      is_superuser: true,
    })
    expect(Object.isFrozen(DEFAULT_ROLES)).toBe(true)
    expect(Object.isFrozen(SUPERUSER_ROLE)).toBe(true)
    expect(defineRole(definition)).toBe(definition)
    expect(createAccessConfig().roles).toEqual([])
    expect(roleSource(admin)).toBe("system")
    expect(roleSource(configured)).toBe("configuration")
    expect(roleSource(reader)).toBe("admin")
  })

  it("validates custom permission rules and normalizes configured roles without assigning actors", () => {
    const config = createAccessConfig({
      permissions: [["store.documents.read", "Read documents", "Storefront"]],
      roles: [
        { ...definition, name: " Catalog reader " },
        {
          key: "customer-documents",
          name: "Customer documents",
          rules: [
            {
              permission: "store.documents.read",
              effect: "allow",
              conditions: { actor_type: "customer" },
            },
          ],
        },
      ],
    })
    expect(config.roles[0]).toEqual({ ...definition, rules: [] })
    expect(config.roles[1].permissions).toEqual([])
    expect(config.roles[1].rules[0].conditions).toEqual({
      actor_type: "customer",
    })
    expect(config).not.toHaveProperty("assignments")
  })

  it.each([null, {}, Array(101).fill(definition)])(
    "rejects invalid configured role collections %j",
    (roles) =>
      expect(() => createAccessConfig({ roles } as any)).toThrow(
        "Configured roles"
      )
  )

  it.each([
    null,
    false,
    [],
    { ...definition, extra: true },
    { ...definition, is_superuser: true },
    { ...definition, key: 1 },
    { ...definition, key: "" },
    { ...definition, key: "Invalid" },
    { ...definition, key: "x".repeat(65) },
    { ...definition, key: "superuser" },
    { ...definition, name: 1 },
    { ...definition, name: " " },
    { ...definition, name: "x".repeat(101) },
    { ...definition, name: " SUPERUSER " },
  ])("rejects invalid or protected role definitions %j", (role) =>
    expect(() => createAccessConfig({ roles: [role] } as any)).toThrow(
      "configured role"
    )
  )

  it("rejects duplicate keys and names, unsupported grants and invalid rules", () => {
    for (const other of [
      { ...definition, name: "Other" },
      { ...definition, key: "other", name: " CATALOG READER " },
    ])
      expect(() => createAccessConfig({ roles: [definition, other] })).toThrow(
        "configured role"
      )
    for (const permissions of [null, ["unknown.read"], ["*"]])
      expect(() =>
        createAccessConfig({ roles: [{ ...definition, permissions }] } as any)
      ).toThrow("supported permission")
    expect(() =>
      createAccessConfig({
        roles: [
          {
            ...definition,
            rules: [{ permission: "unknown.*", effect: "allow" }],
          },
        ],
      })
    ).toThrow("Invalid permission rule")
  })

  it("registers the validation loader and fails invalid options before any DB work", async () => {
    expect(moduleDefinition.loaders).toContain(validateOptions)
    await expect(
      validateOptions({ options: { roles: [{ key: "superuser" }] } } as any)
    ).rejects.toThrow("configured role")
  })
})

describe("configured role synchronization", () => {
  it("does nothing by default and preserves ordinary roles edited in Admin", async () => {
    const h = harness({}, [], [reader])
    expect(await h.service.syncConfiguredRoles(h.context)).toEqual({
      created: 0,
      updated: 0,
      revoked: 0,
    })
    expect(h.execute).toHaveBeenCalledTimes(2)
    expect(h.execute.mock.calls[0][0]).toContain("pg_advisory_xact_lock")
  })

  it("creates a code-managed role with an atomic audit and no actor assignments", async () => {
    const h = harness({ roles: [definition] }, [], [], [configured], [])
    expect(await h.service.syncConfiguredRoles(h.context)).toEqual({
      created: 1,
      updated: 0,
      revoked: 0,
    })
    expect(h.execute.mock.calls[2][1]).toEqual([
      expect.stringMatching(/^rbar_/),
      configured.key,
      definition.name,
      '["products.view"]',
      "[]",
    ])
    const audit = h.execute.mock.calls[3][1]
    expect(audit.slice(1, 4)).toEqual([
      "system:configuration",
      "sync_configured_role",
      configured.id,
    ])
    expect(JSON.parse(audit[4])).toEqual({ before: null, after: configured })
    expect(
      h.execute.mock.calls.every(([sql]) => !sql.includes("role_assignment"))
    ).toBe(true)
  })

  it.each([configured, { ...configured, rules: undefined }])(
    "keeps the same version and skips audit on repeated synchronization",
    async (role) => {
      const h = harness({ roles: [definition] }, [], [role])
      expect(await h.service.syncConfiguredRoles(h.context)).toEqual({
        created: 0,
        updated: 0,
        revoked: 0,
      })
      expect(h.execute).toHaveBeenCalledTimes(2)
    }
  )

  it("updates changed definitions and versions without replacing the role identity", async () => {
    const after = { ...configured, name: "Product reader", version: 2 }
    const h = harness(
      { roles: [{ ...definition, name: after.name }] },
      [],
      [configured],
      [after],
      []
    )
    expect(await h.service.syncConfiguredRoles(h.context)).toEqual({
      created: 0,
      updated: 1,
      revoked: 0,
    })
    expect(h.execute.mock.calls[2][1]).toEqual([
      after.name,
      '["products.view"]',
      "[]",
      configured.id,
    ])
    expect(h.execute.mock.calls[2][0]).toContain("version = version + 1")
    expect(JSON.parse(h.execute.mock.calls[3][1][4])).toEqual({
      before: configured,
      after,
    })
  })

  it("swaps names between active configured roles without changing identities or assignments", async () => {
    const otherDefinition = {
      key: "orders-reader",
      name: "Orders reader",
      permissions: ["orders.view"],
    }
    const other = createRole({
      id: "configured-orders",
      key: configuredRoleKey(otherDefinition.key),
      name: otherDefinition.name,
      permissions: otherDefinition.permissions,
      rules: [],
    })
    const renamed = { ...configured, name: other.name, version: 2 }
    const renamedOther = { ...other, name: configured.name, version: 2 }
    const h = harness(
      {
        roles: [
          { ...definition, name: other.name },
          { ...otherDefinition, name: configured.name },
        ],
      },
      [],
      [configured, other],
      [renamed],
      [],
      [renamedOther],
      []
    )
    expect(await h.service.syncConfiguredRoles(h.context)).toEqual({
      created: 0,
      updated: 2,
      revoked: 0,
    })
    const writes = h.execute.mock.calls.filter(([sql]) =>
      sql.startsWith("update rbac_access_role")
    )
    expect(
      writes.map(([, parameters]) => [parameters[0], parameters[3]])
    ).toEqual([
      [other.name, configured.id],
      [configured.name, other.id],
    ])
    expect(
      h.execute.mock.calls.every(([sql]) => !sql.includes("role_assignment"))
    ).toBe(true)
  })

  it("normalizes explicitly undefined rule options before comparing persisted JSON", async () => {
    const h = harness(
      {
        roles: [
          {
            ...definition,
            rules: [
              {
                permission: "products.view",
                effect: "allow",
                priority: undefined,
                conditions: undefined,
              },
            ],
          },
        ],
      },
      [],
      [
        {
          ...configured,
          rules: [{ permission: "products.view", effect: "allow" }],
        },
      ]
    )
    expect(await h.service.syncConfiguredRoles(h.context)).toEqual({
      created: 0,
      updated: 0,
      revoked: 0,
    })
    expect(h.execute).toHaveBeenCalledTimes(2)
  })

  it.each([
    configured,
    {
      ...configured,
      permissions: [],
      rules: [{ permission: "products.*", effect: "allow" as const }],
    },
  ])(
    "revokes removed definitions while retaining actor and invitation references",
    async (role) => {
      const after = { ...role, permissions: [], rules: [], version: 2 }
      const h = harness({}, [], [role], [after], [])
      expect(await h.service.syncConfiguredRoles(h.context)).toEqual({
        created: 0,
        updated: 0,
        revoked: 1,
      })
      expect(h.execute.mock.calls[2][1]).toEqual([role.id])
      expect(h.execute.mock.calls[2][0]).toContain("permissions = '[]'::jsonb")
      expect(h.execute.mock.calls[3][1].slice(1, 3)).toEqual([
        "system:configuration",
        "revoke_configured_role",
      ])
      expect(
        h.execute.mock.calls.every(([sql]) => !sql.startsWith("delete"))
      ).toBe(true)
    }
  )

  it.each([[], undefined])(
    "does not repeatedly update already revoked definitions",
    async (rules) => {
      const h = harness({}, [], [{ ...configured, permissions: [], rules }])
      expect((await h.service.syncConfiguredRoles(h.context)).revoked).toBe(0)
      expect(h.execute).toHaveBeenCalledTimes(2)
    }
  )

  it("refuses collisions with an Admin role or protected system identity", async () => {
    const nameCollision = harness(
      { roles: [definition] },
      [],
      [{ ...reader, name: " CATALOG READER " }]
    )
    await expect(
      nameCollision.service.syncConfiguredRoles(nameCollision.context)
    ).rejects.toThrow("conflicts")
    const systemCollision = harness(
      { roles: [definition] },
      [],
      [{ ...configured, is_superuser: true }]
    )
    await expect(
      systemCollision.service.syncConfiguredRoles(systemCollision.context)
    ).rejects.toThrow("protected Superuser")
    expect(nameCollision.execute).toHaveBeenCalledTimes(2)
    expect(systemCollision.execute).toHaveBeenCalledTimes(2)
  })

  it("does not reuse a removed configured role's name or transfer its identity", async () => {
    const removed = {
      ...configured,
      id: "removed",
      key: configuredRoleKey("removed"),
      permissions: [],
      rules: [],
    }
    const h = harness({ roles: [definition] }, [], [removed])
    await expect(h.service.syncConfiguredRoles(h.context)).rejects.toThrow(
      "conflicts"
    )
    expect(h.execute).toHaveBeenCalledTimes(2)
  })

  it("propagates audit failure for native transaction rollback and retry", async () => {
    const h = harness({ roles: [definition] }, [], [], [configured])
    h.execute.mockRejectedValueOnce(new Error("audit unavailable"))
    await expect(h.service.syncConfiguredRoles(h.context)).rejects.toThrow(
      "audit unavailable"
    )
    const retry = harness({ roles: [definition] }, [], [], [configured], [])
    expect(
      (await retry.service.syncConfiguredRoles(retry.context)).created
    ).toBe(1)
  })

  it.each(["update_role", "delete_role"] as const)(
    "rejects %s for a code-managed role",
    async (kind) => {
      const h = harness({}, [], [staff], [admin], [configured])
      await expect(
        h.service.mutate(
          "user",
          {
            kind,
            id: configured.id,
            version: 1,
            name: "Changed",
            permissions: [],
          },
          h.context
        )
      ).rejects.toThrow("managed in application configuration")
    }
  )

  it.each(["create_role", "update_role"] as const)(
    "protects configured role names from %s",
    async (kind) => {
      const h = harness({ roles: [definition] }, [], [staff], [admin], [reader])
      await expect(
        h.service.mutate(
          "user",
          {
            kind,
            id: reader.id,
            version: 1,
            name: " CATALOG READER ",
            permissions: [],
          },
          h.context
        )
      ).rejects.toThrow("reserved by application configuration")
    }
  )

  it("materializes configured roles during bootstrap without assigning them", async () => {
    const h = harness(
      { roles: [definition] },
      [],
      [],
      [configured],
      [],
      [],
      [],
      [],
      []
    )
    expect(await h.service.bootstrap("user", h.context)).toEqual({
      created: true,
    })
    const assignments = h.execute.mock.calls.filter(([sql]) =>
      sql.startsWith("insert into rbac_role_assignment")
    )
    expect(assignments).toHaveLength(1)
    expect(assignments[0][1][2]).not.toBe(configured.id)
    expect(
      h.execute.mock.calls.filter(([sql]) =>
        sql.startsWith("insert into rbac_access_role")
      )
    ).toHaveLength(2)
  })

  it("denies removed configured grants before synchronization while retaining scoped actor identity", async () => {
    const h = harness(
      {},
      [staff],
      [
        {
          ...configured,
          rules: [{ permission: "products.*", effect: "allow" }],
        },
      ]
    )
    const principal = await h.service.actorPrincipal(
      { type: "customer", id: staff.actor_id },
      h.context
    )
    expect(principal.role_ids).toEqual([configured.id])
    expect(principal.permissions).toEqual([])
    expect(principal.rules).toBeUndefined()
    expect(principal.actor_type).toBe("customer")
    expect(h.service.allows(principal, "products.view")).toBe(false)
  })
})

describe("role detail metadata", () => {
  it("describes system/configuration/Admin sources and scoped assignment counts", async () => {
    const removed = { ...configured, id: "removed", key: "configured_removed" }
    const h = harness({ roles: [definition] }, [
      { ...admin, actor_count: "2", pending_invitation_count: "1" },
      configured,
      removed,
      reader,
    ])
    const { roles } = await h.service.snapshot([], h.context)
    expect(roles[0]).toMatchObject({
      source: "system",
      actor_count: 2,
      pending_invitation_count: 1,
    })
    expect(roles[0].permissions).toEqual(h.service.configuration.ids)
    expect(roles[1]).toMatchObject({
      source: "configuration",
      configuration_status: "active",
      actor_count: 0,
    })
    expect(roles[2]).toMatchObject({
      source: "configuration",
      configuration_status: "removed",
    })
    expect(roles[2].permissions).toEqual([])
    expect(roles[2].rules).toEqual([])
    expect(roles[3]).toMatchObject({ source: "admin" })
    expect(h.execute.mock.calls[0][0]).toContain("s.deleted_at is null")
    expect(h.execute.mock.calls[0][0]).toContain("i.status = 'pending'")
  })

  it("returns a bounded actor page without conflating user/customer IDs", async () => {
    const actors = [
      { actor_type: "user", actor_id: "same-id", active: true },
      { actor_type: "customer", actor_id: "same-id", active: false },
    ]
    const h = harness(
      {},
      [{ ...reader, actor_count: 12, pending_invitation_count: 3 }],
      actors
    )
    const result = await h.service.roleDetail(
      reader.id,
      { offset: 5, limit: 10 },
      h.context
    )
    expect(result).toMatchObject({
      actors,
      actor_count: 12,
      pending_invitation_count: 3,
      offset: 5,
      limit: 10,
    })
    expect(h.execute.mock.calls[0][1]).toEqual([reader.id])
    expect(h.execute.mock.calls[1][1]).toEqual([reader.id, 10, 5])
  })

  it("supports default pagination and a non-transactional manager", async () => {
    const h = harness({}, [reader], [])
    expect(
      await h.service.roleDetail(reader.id, undefined, {
        manager: h.context.manager,
      })
    ).toMatchObject({ offset: 0, limit: 20, actor_count: 0 })
    const snapshot = harness({}, [reader])
    expect(
      (
        await snapshot.service.snapshot([], {
          manager: snapshot.context.manager,
        })
      ).roles[0].source
    ).toBe("admin")
  })

  it("rejects missing roles", async () => {
    const h = harness({}, [])
    await expect(
      h.service.roleDetail("missing", {}, h.context)
    ).rejects.toThrow("Role not found")
  })

  it.each([
    { offset: -1 },
    { offset: 0.5 },
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
  ])("rejects unsafe pagination %j", async (page) => {
    const h = harness({})
    await expect(
      h.service.roleDetail(reader.id, page, h.context)
    ).rejects.toThrow("pagination")
    expect(h.execute).not.toHaveBeenCalled()
  })
})

it("exposes native CLI synchronization and propagates failures", async () => {
  const access = {
    syncConfiguredRoles: vi
      .fn()
      .mockResolvedValue({ created: 1, updated: 2, revoked: 3 }),
  }
  const info = vi.spyOn(console, "info").mockImplementation(() => {})
  const container = { resolve: vi.fn().mockReturnValue(access) }
  await syncConfiguredRoles({ container } as any)
  expect(info).toHaveBeenCalledWith(
    "Configured roles synchronized: 1 created, 2 updated, 3 revoked"
  )
  access.syncConfiguredRoles.mockRejectedValue(
    new Error("configuration failed")
  )
  await expect(syncConfiguredRoles({ container } as any)).rejects.toThrow(
    "configuration failed"
  )
})
