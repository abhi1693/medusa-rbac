import { it, expect, vi } from "vitest"
import { Modules } from "@medusajs/framework/utils"
import { ACCESS_CONTROL } from "../../src/modules/access-control"
import {
  prepareUserDeletion,
  restoreUserAccess,
  finishUserDeletion,
} from "../../src/workflows/delete-staff-user/steps"
import * as workflow from "../../src/workflows/delete-staff-user"
import { DELETE } from "../../src/api/admin/access/staff/[id]/route"
import { createUserDeletion } from "../fixtures/access"

function harness() {
  const users = { retrieveUser: vi.fn() }
  const access = {
    prepareUserDeletion: vi.fn().mockResolvedValue(createUserDeletion()),
    settleUserDeletion: vi.fn(),
  }
  const container: any = {
    resolve: (name: string) => (name === Modules.USER ? users : access),
  }
  return { users, access, container }
}
it("checks native user existence before reserving deletion", async () => {
  const h = harness()
  expect(
    (await prepareUserDeletion({ actor_id: "user", user_id: "target" }, h))
      .output
  ).toEqual(createUserDeletion())
  expect(h.users.retrieveUser).toHaveBeenCalledWith("target", {
    select: ["id"],
  })
  expect(h.access.prepareUserDeletion).toHaveBeenCalledWith("user", "target")
  h.users.retrieveUser.mockRejectedValue(new Error("missing"))
  await expect(
    prepareUserDeletion({ actor_id: "user", user_id: "missing" }, h)
  ).rejects.toThrow("missing")
  expect(h.access.prepareUserDeletion).toHaveBeenCalledTimes(1)
})
it("restores staged access after a native workflow failure and accepts empty compensation", async () => {
  const h = harness()
  await restoreUserAccess(undefined, h)
  expect(h.access.settleUserDeletion).not.toHaveBeenCalled()
  await restoreUserAccess(createUserDeletion(), h)
  expect(h.access.settleUserDeletion).toHaveBeenCalledWith(
    createUserDeletion(),
    "restore"
  )
})
it("finishes access cleanup and returns the standard deleted-user response", async () => {
  const h = harness()
  const result = await finishUserDeletion(
    { deletion: createUserDeletion(), user_id: "target" },
    h
  )
  expect(h.access.settleUserDeletion).toHaveBeenCalledWith(
    createUserDeletion(),
    "deleted"
  )
  expect(result.output).toEqual({
    id: "target",
    object: "user",
    deleted: true,
  })
})
it("the staff delete route delegates its authenticated actor and target to the workflow", async () => {
  const run = vi.fn().mockResolvedValue({
    result: { id: "target", object: "user", deleted: true },
  })
  vi.spyOn(workflow, "deleteStaffUserWorkflow").mockReturnValue({ run } as any)
  const h = harness()
  const res: any = { json: vi.fn() }
  await DELETE(
    {
      scope: h.container,
      params: { id: "target" },
      auth_context: { actor_id: "actor" },
    } as any,
    res
  )
  expect(run).toHaveBeenCalledWith({
    input: { actor_id: "actor", user_id: "target" },
  })
  expect(res.json).toHaveBeenCalledWith({
    id: "target",
    object: "user",
    deleted: true,
  })
  expect(ACCESS_CONTROL).toBe("rbac_access")
})
