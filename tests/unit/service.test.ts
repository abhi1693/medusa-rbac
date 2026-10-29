import { describe, it, expect, vi } from "vitest"
import AccessControlService from "../../src/modules/access-control/service"
import moduleDefinition from "../../src/modules/access-control"
import { PERMISSION_IDS } from "../../src/lib/access/permissions"

import {
  createSuperuserRole,
  createRole,
  createStaffAccess,
  createInvitationAccess,
  createUserDeletion,
} from "../fixtures/access"
const admin = createSuperuserRole()
const reader = createRole()
const staff = createStaffAccess()
function harness(...responses: unknown[]) {
  const execute = vi.fn()
  for (const response of responses) execute.mockResolvedValueOnce(response)
  // Keep the real Medusa decorators and service factory; replace only the DB port.
  const service = Object.create(
    AccessControlService.prototype
  ) as AccessControlService
  const manager = { execute }
  const context = { manager, transactionManager: manager } as any
  return { service, execute, context }
}
const actor = [[], [staff], [admin]]
const mutation = {
  kind: "create_role",
  name: " Reader ",
  permissions: ["products.view"],
} as const

describe("access service", () => {
  it("registers the native module", () =>
    expect(moduleDefinition).toBeDefined())
  it.each([{ rows: [] }, { rows: [{ ...staff, active: false }] }])(
    "denies missing/inactive staff",
    async ({ rows }) => {
      const h = harness(rows)
      expect(await h.service.principal("user", h.context)).toEqual({
        user_id: "user",
        active: false,
        is_superuser: false,
        role_ids: [],
        permissions: [],
      })
      expect(h.execute).toHaveBeenCalledTimes(1)
    }
  )
  it("combines explicit grants and identifies multiple superuser assignments", async () => {
    const h = harness(
      [staff],
      [
        reader,
        {
          ...reader,
          id: "other",
          permissions: ["products.view", "prices.view"],
        },
        admin,
      ]
    )
    expect(await h.service.principal("user", h.context)).toEqual({
      user_id: "user",
      active: true,
      is_superuser: true,
      role_ids: ["reader", "other", "admin"],
      permissions: expect.arrayContaining([...PERMISSION_IDS]),
    })
    const plain = harness([staff], [reader])
    expect(
      (
        await plain.service.principal("user", {
          manager: plain.context.manager,
        })
      ).is_superuser
    ).toBe(false)
    const empty = harness([staff], [])
    expect(
      (await empty.service.principal("user", empty.context)).permissions
    ).toEqual([])
  })
  it("fails closed on corrupt persisted grants", async () => {
    const h = harness([staff], [{ ...reader, permissions: ["*"] }])
    await expect(h.service.principal("user", h.context)).rejects.toThrow(
      "supported permission"
    )
  })
  it("reads roles without fetching unrelated staff and filters requested users", async () => {
    const h = harness([reader], [reader], [staff])
    expect(await h.service.snapshot(undefined, h.context)).toEqual({
      roles: [reader],
      staff: [],
    })
    expect(await h.service.snapshot(["user"], h.context)).toEqual({
      roles: [reader],
      staff: [staff],
    })
    expect(h.execute.mock.calls[2][1]).toEqual(['["user"]'])
  })
  it("paginates audit with a numeric total", async () => {
    const h = harness([{ id: "event" }], [{ count: "28" }])
    expect(await h.service.auditPage(25, 25, h.context)).toEqual({
      events: [{ id: "event" }],
      count: 28,
      offset: 25,
      limit: 25,
    })
    expect(h.execute.mock.calls[0][1]).toEqual([25, 25])
  })
  it.each([
    { rows: [] },
    { rows: [{ ...staff, active: false }] },
    { rows: [staff] },
  ])("rechecks authorization under the mutation lock", async ({ rows }) => {
    const h = harness([], rows, [reader])
    await expect(
      h.service.mutate("user", mutation as any, h.context)
    ).rejects.toThrow("Only Superusers")
    expect(h.execute.mock.calls[0][0]).toContain("pg_advisory_xact_lock")
    expect(h.execute.mock.calls.some(([sql]) => sql.startsWith("insert"))).toBe(
      false
    )
  })
  it("creates roles with explicit grants and an atomic before/after audit", async () => {
    const h = harness(...actor, [reader], [])
    expect(await h.service.mutate("user", mutation as any, h.context)).toEqual({
      result: reader,
    })
    expect(h.execute.mock.calls[3][1]).toEqual([
      expect.stringMatching(/^uar_/),
      expect.stringMatching(/^custom_/),
      "Reader",
      '["products.view"]',
      "[]",
    ])
    const audit = h.execute.mock.calls[4][1]
    expect(audit.slice(1, 3)).toEqual(["user", "create_role"])
    expect(JSON.parse(audit[4])).toEqual({ before: null, after: reader })
  })
  it("updates a versioned ordinary role", async () => {
    const updated = { ...reader, name: "Updated", version: 2 }
    const h = harness(...actor, [reader], [updated], [])
    expect(
      await h.service.mutate(
        "user",
        {
          kind: "update_role",
          id: "reader",
          version: 1,
          name: " Updated ",
          permissions: [],
        },
        h.context
      )
    ).toEqual({ result: updated })
    expect(h.execute.mock.calls[4][1]).toEqual([
      "Updated",
      "[]",
      "[]",
      "reader",
    ])
    expect(JSON.parse(h.execute.mock.calls[5][1][4])).toEqual({
      before: reader,
      after: updated,
    })
  })
  it.each([
    { role: [], version: 1, message: "Role not found" },
    { role: [admin], version: 1, message: "protected" },
    { role: [reader], version: 2, message: "reload" },
  ])(
    "rejects invalid role mutation: $message",
    async ({ role, version, message }) => {
      const h = harness(...actor, role)
      await expect(
        h.service.mutate(
          "user",
          { kind: "delete_role", id: "reader", version },
          h.context
        )
      ).rejects.toThrow(message)
    }
  )
  it("refuses deletion of an assigned role, including inactive staff assignments", async () => {
    const h = harness(...actor, [reader], [{ count: "1" }])
    await expect(
      h.service.mutate(
        "user",
        { kind: "delete_role", id: "reader", version: 1 },
        h.context
      )
    ).rejects.toThrow("Reassign staff")
  })
  it("soft deletes an unassigned role and records the prior state", async () => {
    const h = harness(...actor, [reader], [{ count: "0" }], [], [])
    expect(
      await h.service.mutate(
        "user",
        { kind: "delete_role", id: "reader", version: 1 },
        h.context
      )
    ).toEqual({ result: null })
    expect(h.execute.mock.calls[5][0]).toContain("deleted_at = now()")
    expect(JSON.parse(h.execute.mock.calls[6][1][4])).toEqual({
      before: reader,
      after: null,
    })
  })
  it("rejects unknown roles before changing staff", async () => {
    const h = harness(...actor, [reader])
    await expect(
      h.service.mutate(
        "user",
        {
          kind: "set_staff",
          user_id: "other",
          role_ids: ["unknown"],
          active: true,
          version: 0,
        },
        h.context
      )
    ).rejects.toThrow("Unknown role")
  })
  it.each([
    [staff, 0],
    [undefined, 1],
  ] as const)("rejects stale staff versions", async (person, version) => {
    const h = harness(...actor, [reader], person ? [person] : [])
    await expect(
      h.service.mutate(
        "user",
        {
          kind: "set_staff",
          user_id: "other",
          role_ids: [],
          active: true,
          version,
        },
        h.context
      )
    ).rejects.toThrow("reload")
  })
  it("creates staff, deduplicates assignments and audits creation", async () => {
    const h = harness(
      ...actor,
      [reader],
      [],
      [],
      [staff],
      [],
      [],
      [{ count: "1" }],
      []
    )
    expect(
      await h.service.mutate(
        "user",
        {
          kind: "set_staff",
          user_id: "other",
          role_ids: ["reader", "reader"],
          active: true,
          version: 0,
        },
        h.context
      )
    ).toEqual({ result: { ...staff, role_ids: ["reader"] } })
    expect(
      h.execute.mock.calls.filter(([sql]) =>
        sql.startsWith("insert into rbac_role_assignment")
      )
    ).toHaveLength(1)
    expect(JSON.parse(h.execute.mock.calls.at(-1)![1][4]).before).toBeNull()
  })
  it("updates staff and records previous assignments", async () => {
    const current = { ...staff, active: false, version: 2 }
    const h = harness(
      ...actor,
      [reader],
      [staff],
      [{ role_id: "reader" }],
      [],
      [current],
      [],
      [{ count: "1" }],
      []
    )
    expect(
      await h.service.mutate(
        "user",
        {
          kind: "set_staff",
          user_id: "user",
          role_ids: [],
          active: false,
          version: 1,
        },
        h.context
      )
    ).toEqual({ result: { ...current, role_ids: [] } })
    expect(JSON.parse(h.execute.mock.calls.at(-1)![1][4])).toEqual({
      before: { ...staff, role_ids: ["reader"] },
      after: { ...current, role_ids: [] },
    })
  })
  it("rejects removal of the last active superuser without writing an audit", async () => {
    const h = harness(
      ...actor,
      [admin],
      [staff],
      [{ role_id: "admin" }],
      [],
      [staff],
      [],
      [{ count: "0" }]
    )
    await expect(
      h.service.mutate(
        "user",
        {
          kind: "set_staff",
          user_id: "user",
          role_ids: [],
          active: false,
          version: 1,
        },
        h.context
      )
    ).rejects.toThrow("At least one")
    expect(
      h.execute.mock.calls.some(([sql]) =>
        sql.startsWith("insert into rbac_access_audit")
      )
    ).toBe(false)
  })
  it("propagates audit failure so the native transaction can roll back", async () => {
    const h = harness(...actor, [reader])
    h.execute.mockRejectedValueOnce(new Error("audit unavailable"))
    await expect(
      h.service.mutate("user", mutation as any, h.context)
    ).rejects.toThrow("audit unavailable")
  })
  it("bootstraps one protected superuser and no operational presets", async () => {
    const h = harness([], [])
    h.execute.mockResolvedValue([])
    expect(await h.service.bootstrap("user", h.context)).toEqual({
      created: true,
    })
    expect(
      h.execute.mock.calls.filter(([sql]) =>
        sql.startsWith("insert into rbac_access_role")
      )
    ).toHaveLength(1)
    expect(h.execute.mock.calls[2][1][1]).toBe(JSON.stringify(PERMISSION_IDS))
    expect(h.execute.mock.calls.at(-1)![1].slice(1, 4)).toEqual([
      "user",
      "bootstrap_superuser",
      "user",
    ])
  })
  it("allows repeated bootstrap only for an existing active superuser", async () => {
    const h = harness([], [admin], [staff], [admin])
    expect(await h.service.bootstrap("user", h.context)).toEqual({
      created: false,
    })
  })
  it.each([
    { person: [] },
    { person: [{ ...staff, active: false }] },
    { person: [staff] },
  ])("refuses repeat bootstrap for unprivileged staff", async ({ person }) => {
    const h = harness([], [admin], person, [reader])
    await expect(h.service.bootstrap("user", h.context)).rejects.toThrow(
      "already been bootstrapped"
    )
  })
})

it("records an invitation with deduplicated pending role assignments", async () => {
  const h = harness(...actor, [reader], [], [], [])
  const result = await h.service.mutate(
    "user",
    {
      kind: "record_invite",
      invite_id: "inv_test",
      email: "invited@example.test",
      role_ids: ["reader", "reader"],
    },
    h.context
  )
  expect(result.result).toMatchObject({ role_ids: ["reader"] })
  expect(
    h.execute.mock.calls.filter(([sql]) =>
      sql.startsWith("insert into rbac_invitation_role")
    )
  ).toHaveLength(1)
})
it.each([{ role_ids: [] }, { role_ids: ["unknown"] }])(
  "rejects empty or unknown invitation roles: %j",
  async ({ role_ids }) => {
    const h = harness(...actor, [reader])
    await expect(
      h.service.mutate(
        "user",
        {
          kind: "record_invite",
          invite_id: "inv_test",
          email: "invited@example.test",
          role_ids,
        },
        h.context
      )
    ).rejects.toThrow("existing role")
  }
)
it("reads invitation state through a supplied transaction or manager", async () => {
  const plan = createInvitationAccess()
  const h = harness([plan], [])
  expect(await h.service.invitation("inv_test", h.context)).toEqual(plan)
  expect(
    await h.service.invitation("inv_test", { manager: h.context.manager })
  ).toBeUndefined()
})
it.each([
  undefined,
  createInvitationAccess({ status: "accepted" }),
  createInvitationAccess({ status: "cancelled" }),
])("refuses replay or absent invitation plans", async (plan) => {
  const h = harness(...actor, plan ? [plan] : [])
  await expect(
    h.service.mutate(
      "user",
      { kind: "accept_invite", invite_id: "inv_test", user_id: "new" },
      h.context
    )
  ).rejects.toThrow("no longer pending")
})
it("rejects replacing an invitation's authorizing superuser", async () => {
  const h = harness(...actor, [
    createInvitationAccess({ actor_id: "someone-else" }),
  ])
  await expect(
    h.service.mutate(
      "user",
      { kind: "accept_invite", invite_id: "inv_test", user_id: "new" },
      h.context
    )
  ).rejects.toThrow("inviting superuser")
})
it("assigns invitation roles and completes its audit in the same transaction", async () => {
  const h = harness(
    ...actor,
    [createInvitationAccess()],
    ...actor,
    [reader],
    [],
    [],
    [staff],
    [],
    [],
    [{ count: "1" }],
    [],
    [],
    [],
    []
  )
  const result = await h.service.mutate(
    "user",
    { kind: "accept_invite", invite_id: "inv_test", user_id: "new" },
    h.context
  )
  expect(result.result).toMatchObject({ status: "accepted", user_id: "new" })
  expect(
    h.execute.mock.calls
      .filter(([sql]) => sql.startsWith("insert into rbac_access_audit"))
      .map(([, params]) => params[2])
  ).toEqual(["set_staff", "accept_invite"])
})
it("cancels an invitation and releases its role references", async () => {
  const h = harness(...actor, [createInvitationAccess()], [], [], [])
  expect(
    (
      await h.service.mutate(
        "user",
        { kind: "cancel_invite", invite_id: "inv_test" },
        h.context
      )
    ).result
  ).toMatchObject({ status: "cancelled" })
  expect(
    h.execute.mock.calls.some(([sql]) =>
      sql.startsWith("delete from rbac_invitation_role")
    )
  ).toBe(true)
})

it("prevents self-deletion before touching the account", async () => {
  const h = harness(...actor)
  await expect(
    h.service.prepareUserDeletion("user", "user", h.context)
  ).rejects.toThrow("cannot delete your own account")
  expect(h.execute).toHaveBeenCalledTimes(3)
})
it("prepares assigned staff deletion under the superuser lock", async () => {
  const target = { ...staff, user_id: "target" }
  const h = harness(
    ...actor,
    [target],
    [{ role_id: "reader" }],
    [],
    [{ count: "1" }],
    []
  )
  expect(
    await h.service.prepareUserDeletion("user", "target", h.context)
  ).toEqual(createUserDeletion())
  expect(h.execute.mock.calls[5][0]).toContain("deleted_at = now()")
  expect(h.execute.mock.calls.at(-1)![1][2]).toBe("prepare_user_deletion")
})
it("prepares unassigned users without inventing role grants", async () => {
  const h = harness(...actor, [], [], [{ count: "1" }], [])
  expect(
    await h.service.prepareUserDeletion("user", "target", h.context)
  ).toMatchObject({ previous_active: null, role_ids: [], version: 1 })
  expect(h.execute.mock.calls[4][0]).toContain("insert into rbac_staff_access")
})
it("blocks duplicate deletion and role changes while deletion is pending", async () => {
  const archived = { ...staff, deleted_at: "2026-10-30T00:00:00Z" }
  const h = harness(...actor, [archived])
  await expect(
    h.service.prepareUserDeletion("user", "target", h.context)
  ).rejects.toThrow("reload")
  const roleChange = harness(...actor, [reader], [archived])
  await expect(
    roleChange.service.mutate(
      "user",
      {
        kind: "set_staff",
        user_id: "target",
        role_ids: ["reader"],
        version: 1,
        active: true,
      },
      roleChange.context
    )
  ).rejects.toThrow("reload")
})
it.each(["missing", "live", "version", "user"])(
  "rejects a mismatching deletion receipt and ignores stale compensation: %s",
  async (mismatch) => {
    const target = {
      ...staff,
      user_id: "target",
      version: 2,
      deleted_at: "2026-10-30T00:00:00Z",
    }
    const row =
      mismatch === "missing"
        ? []
        : [
            {
              ...target,
              ...(mismatch === "live"
                ? { deleted_at: null }
                : mismatch === "version"
                  ? { version: 3 }
                  : { user_id: "other" }),
            },
          ]
    const restore = harness([], row)
    await restore.service.settleUserDeletion(
      createUserDeletion(),
      "restore",
      restore.context
    )
    expect(restore.execute).toHaveBeenCalledTimes(2)
    const h = harness([], row)
    await expect(
      h.service.settleUserDeletion(createUserDeletion(), "deleted", h.context)
    ).rejects.toThrow("reload")
  }
)
it("finalizes deletion by releasing role assignments and auditing the account removal", async () => {
  const target = {
    ...staff,
    user_id: "target",
    version: 2,
    deleted_at: "2026-10-30T00:00:00Z",
  }
  const h = harness([], [target], [], [], [])
  await h.service.settleUserDeletion(createUserDeletion(), "deleted", h.context)
  expect(h.execute.mock.calls[2][0]).toContain(
    "delete from rbac_role_assignment"
  )
  expect(h.execute.mock.calls.at(-1)![1][2]).toBe("delete_user")
})
it.each([true, false, null])(
  "compensates a failed native deletion, preserving prior access: %s",
  async (previous_active) => {
    const target = {
      ...staff,
      user_id: "target",
      version: 2,
      deleted_at: "2026-10-30T00:00:00Z",
    }
    const h = harness([], [target], [], [])
    await h.service.settleUserDeletion(
      createUserDeletion({ previous_active }),
      "restore",
      h.context
    )
    expect(h.execute.mock.calls[2][0]).toContain(
      previous_active === null
        ? "delete from rbac_staff_access"
        : "deleted_at = null"
    )
    expect(h.execute.mock.calls.at(-1)![1][2]).toBe("restore_user_access")
  }
)

it.each(["create_role", "update_role"] as const)(
  "reserves the Superuser system name on %s",
  async (kind) => {
    const h = harness(...actor, [reader])
    await expect(
      h.service.mutate(
        "user",
        {
          kind,
          id: reader.id,
          version: reader.version,
          name: " SUPERUSER ",
          permissions: [],
        } as any,
        h.context
      )
    ).rejects.toThrow("reserved")
  }
)
