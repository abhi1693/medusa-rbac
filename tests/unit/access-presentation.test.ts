import { it, expect } from "vitest"
import {
  activityLabel,
  roleRows,
  MY_ACCESS_PATH,
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
  expect(MY_ACCESS_PATH).toContain("view=my-access")
})
