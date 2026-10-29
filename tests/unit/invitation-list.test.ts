import { it, expect, vi } from "vitest"
import AccessControlService from "../../src/modules/access-control/service"
import { GET } from "../../src/api/admin/access/invites/route"
import {
  GET as preview,
  AUTHENTICATE,
} from "../../src/api/access/invites/preview/route"
import { ACCESS_CONTROL } from "../../src/modules/access-control"
import { MANAGED_INVITE } from "../../src/workflows/access-invitations/steps"

it("loads bounded native invitations and bulk role labels without metadata leakage", async () => {
  const listAndCountInvites = vi
    .fn()
    .mockResolvedValue([
      [{ id: "managed", metadata: { private: true } }, { id: "native" }],
      2,
    ])
  const invitationSummaries = vi.fn().mockResolvedValue([
    {
      invite_id: "managed",
      roles: [{ id: "role", name: "Reader" }],
      role_ids: ["role"],
    },
  ])
  const req = {
    validatedQuery: { offset: 25, limit: 25, q: "reader" },
    scope: {
      resolve: (key: string) =>
        key === ACCESS_CONTROL
          ? { invitationSummaries }
          : { listAndCountInvites },
    },
  } as any
  const res = { json: vi.fn() } as any
  await GET(req, res)
  expect(listAndCountInvites).toHaveBeenCalledWith(
    { q: "reader" },
    expect.objectContaining({ skip: 25, take: 25 })
  )
  expect(invitationSummaries).toHaveBeenCalledWith(["managed", "native"])
  expect(res.json).toHaveBeenCalledWith({
    invitations: [
      {
        id: "managed",
        roles: [{ id: "role", name: "Reader" }],
        role_ids: ["role"],
      },
      { id: "native", roles: [], role_ids: [] },
    ],
    count: 2,
    offset: 25,
    limit: 25,
  })
  delete req.validatedQuery.q
  await GET(req, res)
  expect(listAndCountInvites.mock.calls.at(-1)![0]).toEqual({})
})

it("skips empty summary queries and binds bulk IDs through the module manager", async () => {
  const service = Object.create(
    AccessControlService.prototype
  ) as AccessControlService
  const execute = vi.fn().mockResolvedValue([{ invite_id: "invite" }])
  expect(
    await service.invitationSummaries([], { manager: { execute } } as any)
  ).toEqual([])
  expect(execute).not.toHaveBeenCalled()
  for (const context of [
    { manager: { execute } },
    { manager: { execute }, transactionManager: { execute } },
  ]) {
    expect(
      await service.invitationSummaries(["invite"], context as any)
    ).toEqual([{ invite_id: "invite" }])
    expect(execute).toHaveBeenLastCalledWith(expect.any(String), ['["invite"]'])
  }
})

it("previews only valid invitation details while rechecking the inviter's authority", async () => {
  const invite = {
    id: "invite",
    email: "invited@example.test",
    expires_at: "tomorrow",
    metadata: { [MANAGED_INVITE]: true },
  }
  const plan = {
    email: invite.email,
    status: "pending",
    actor_id: "admin",
    roles: [{ id: "role", name: "Reader" }],
  }
  const access = {
    invitationSummaries: vi.fn().mockResolvedValue([plan]),
    principal: vi.fn().mockResolvedValue({ active: true, is_superuser: true }),
  }
  const users = { validateInviteToken: vi.fn().mockResolvedValue(invite) }
  const req = {
    query: { token: "token" },
    scope: {
      resolve: (key: string) => (key === ACCESS_CONTROL ? access : users),
    },
  } as any
  const res = { json: vi.fn(), setHeader: vi.fn() } as any
  expect(AUTHENTICATE).toBe(false)
  await preview(req, res)
  expect(res.json).toHaveBeenCalledWith({
    invite: { email: invite.email, expires_at: "tomorrow", roles: plan.roles },
  })
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
  for (const bad of [
    [],
    [{ ...plan, status: "accepted" }],
    [{ ...plan, email: "wrong@example.test" }],
  ]) {
    access.invitationSummaries.mockResolvedValueOnce(bad)
    await expect(preview(req, res)).rejects.toThrow("no longer available")
  }
  for (const inviter of [
    { active: false, is_superuser: true },
    { active: true, is_superuser: false },
  ]) {
    access.principal.mockResolvedValueOnce(inviter)
    await expect(preview(req, res)).rejects.toThrow("reissue")
  }
  users.validateInviteToken.mockResolvedValueOnce({ ...invite, metadata: {} })
  await preview(req, res)
  expect(res.json.mock.calls.at(-1)![0].invite.roles).toEqual([])
  users.validateInviteToken.mockResolvedValueOnce({
    ...invite,
    metadata: undefined,
  } as any)
  await preview(req, res)
  users.validateInviteToken.mockRejectedValueOnce(new Error("Expired"))
  await expect(preview(req, res)).rejects.toThrow("Expired")
})
