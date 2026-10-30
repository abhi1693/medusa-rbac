import { it, expect } from "vitest"
import {
  activityLabel,
  roleRows,
  MY_ACCESS_PATH,
  roleDetailPath,
  ROLE_LIST_PATH,
  roleSource,
  roleSourceLabel,
  roleIsManaged,
  roleCreatedAt,
} from "../../src/admin/lib/access-presentation"
import { createRole } from "../fixtures/access"

it("filters role names and sorts names or permission counts in both directions", () => {
  const a = createRole({ id: "a", name: "Alpha", permissions: [] })
  const b = createRole({ id: "b", name: "Beta" })
  expect(roleRows([b, a], "", null)).toEqual([b, a])
  expect(roleRows([b, a], " ALP ", null)).toEqual([a])
  expect(roleRows([b, a], "", { id: "name", desc: false })).toEqual([a, b])
  expect(roleRows([a, b], "", { id: "name", desc: true })).toEqual([b, a])
  expect(roleRows([b, a], "", { id: "permissions", desc: false })).toEqual([
    a,
    b,
  ])
  expect(roleRows([a, b], "", { id: "permissions", desc: true })).toEqual([
    b,
    a,
  ])
  expect(activityLabel("create_role")).toBe("Role created")
  expect(activityLabel("future_action")).toBe("Access updated")
  expect(activityLabel("sync_configured_role")).toBe(
    "Role configuration synced"
  )
  expect(activityLabel("revoke_configured_role")).toBe(
    "Configured role revoked"
  )
  expect(activityLabel("set_actor")).toBe("Account roles updated")
  expect(MY_ACCESS_PATH).toContain("view=my-access")
})

it("labels role sources and exposes stable detail links and readable timestamps", () => {
  const ordinary = createRole()
  const configured = createRole({ source: "configuration" })
  const system = createRole({ is_superuser: true, source: "admin" })
  expect(roleDetailPath("reader / copy")).toBe(
    "/settings/access-management/roles/reader%20%2F%20copy"
  )
  expect(ROLE_LIST_PATH).toContain("view=roles")
  expect(roleSource(ordinary)).toBe("admin")
  expect(roleSource(configured)).toBe("configuration")
  expect(roleSource(system)).toBe("system")
  expect(roleSourceLabel(ordinary)).toBe("Admin")
  expect(roleSourceLabel(configured)).toBe("Configuration")
  expect(roleSourceLabel(system)).toBe("System")
  expect(roleIsManaged(ordinary)).toBe(false)
  expect(roleIsManaged(configured)).toBe(true)
  expect(roleCreatedAt()).toBe("—")
  expect(roleCreatedAt("invalid")).toBe("—")
  expect(roleCreatedAt("2026-10-30T00:00:00Z")).not.toBe("—")
  expect(roleRows([ordinary, configured], "configuration", null)).toEqual([
    configured,
  ])
})
