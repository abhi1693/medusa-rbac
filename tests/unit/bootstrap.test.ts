import { it, expect, vi, beforeEach } from "vitest"
import bootstrap from "../../src/scripts/bootstrap-superuser"
import { ACCESS_CONTROL } from "../../src/modules/access-control"
import { Modules } from "@medusajs/framework/utils"

beforeEach(() => {
  vi.stubEnv("RBAC_SUPERUSER_EMAIL", " ADMIN@EXAMPLE.TEST ")
  vi.stubEnv("RBAC_SUPERUSER_PASSWORD", "")
  vi.spyOn(console, "info").mockImplementation(() => {})
})
function harness(initialized = false, matches: unknown[] = [{ id: "user" }]) {
  const access = {
    snapshot: vi
      .fn()
      .mockResolvedValue({ roles: [{ is_superuser: initialized }] }),
    bootstrap: vi.fn().mockResolvedValue({ created: true }),
  }
  const users = {
    listUsers: vi.fn().mockResolvedValue(matches),
    createUsers: vi.fn().mockResolvedValue({ id: "user" }),
  }
  const auth = {
    register: vi.fn().mockResolvedValue({
      authIdentity: { id: "auth", app_metadata: { custom: 1 } },
    }),
    authenticate: vi.fn(),
    updateAuthIdentities: vi.fn(),
  }
  const container = {
    resolve: (key: string) =>
      key === ACCESS_CONTROL ? access : key === Modules.USER ? users : auth,
  }
  return { access, users, auth, run: () => bootstrap({ container } as any) }
}
it("requires an explicitly chosen email", async () => {
  vi.stubEnv("RBAC_SUPERUSER_EMAIL", "")
  await expect(harness().run()).rejects.toThrow("Set RBAC_SUPERUSER_EMAIL")
})
it("can initialize an existing user without changing credentials", async () => {
  const h = harness()
  await h.run()
  expect(h.users.listUsers).toHaveBeenCalledWith({
    email: "admin@example.test",
  })
  expect(h.auth.register).not.toHaveBeenCalled()
  expect(h.access.bootstrap).toHaveBeenCalledWith("user")
  expect(console.info).toHaveBeenCalledWith("Superuser access initialized")
})
it("validates an initial password before creating or authenticating", async () => {
  vi.stubEnv("RBAC_SUPERUSER_PASSWORD", "short")
  const h = harness()
  await expect(h.run()).rejects.toThrow("at least 12")
  expect(h.auth.register).not.toHaveBeenCalled()
})
it("refuses new users after initialization", async () => {
  const h = harness(true, [])
  await expect(h.run()).rejects.toThrow("already exists")
  expect(h.users.createUsers).not.toHaveBeenCalled()
})
it("requires a strong password for a new user", async () => {
  const h = harness(false, [])
  await expect(h.run()).rejects.toThrow("For a new account")
  expect(h.users.createUsers).not.toHaveBeenCalled()
})
it("creates a native user and preserves authentication metadata", async () => {
  vi.stubEnv("RBAC_SUPERUSER_PASSWORD", "a-strong-initial-password")
  const h = harness(false, [])
  await h.run()
  expect(h.users.createUsers).toHaveBeenCalledWith({
    email: "admin@example.test",
  })
  expect(h.auth.updateAuthIdentities).toHaveBeenCalledWith({
    id: "auth",
    app_metadata: { custom: 1, user_id: "user" },
  })
})
it("requires exactly one matching user", async () => {
  const h = harness(false, [{ id: "one" }, { id: "two" }])
  await expect(h.run()).rejects.toThrow("exactly one")
})
it("uses native authentication when registration finds an existing identity", async () => {
  vi.stubEnv("RBAC_SUPERUSER_PASSWORD", "a-strong-initial-password")
  const h = harness()
  h.auth.register.mockResolvedValue({} as any)
  h.auth.authenticate.mockResolvedValue({
    authIdentity: { id: "auth", app_metadata: { user_id: "user" } },
  })
  await h.run()
  expect(h.auth.authenticate).toHaveBeenCalledWith("emailpass", {
    body: {
      email: "admin@example.test",
      password: "a-strong-initial-password",
    },
  })
})
it("refuses an identity when both registration and authentication fail", async () => {
  vi.stubEnv("RBAC_SUPERUSER_PASSWORD", "a-strong-initial-password")
  const h = harness()
  h.auth.register.mockResolvedValue({} as any)
  h.auth.authenticate.mockResolvedValue({})
  await expect(h.run()).rejects.toThrow("Could not initialize")
  expect(h.access.bootstrap).not.toHaveBeenCalled()
})
it("refuses an identity linked to another user", async () => {
  vi.stubEnv("RBAC_SUPERUSER_PASSWORD", "a-strong-initial-password")
  const h = harness()
  h.auth.register.mockResolvedValue({
    authIdentity: { id: "auth", app_metadata: { user_id: "other" } },
  } as any)
  await expect(h.run()).rejects.toThrow("another user")
  expect(h.auth.updateAuthIdentities).not.toHaveBeenCalled()
})
it("supports identities without metadata", async () => {
  vi.stubEnv("RBAC_SUPERUSER_PASSWORD", "a-strong-initial-password")
  const h = harness()
  h.auth.register.mockResolvedValue({ authIdentity: { id: "auth" } } as any)
  await h.run()
  expect(h.auth.updateAuthIdentities).toHaveBeenCalledWith({
    id: "auth",
    app_metadata: { user_id: "user" },
  })
})
it("repeated initialization leaves an existing superuser's password alone", async () => {
  vi.stubEnv("RBAC_SUPERUSER_PASSWORD", "short")
  const h = harness(true)
  h.access.bootstrap.mockResolvedValue({ created: false })
  await h.run()
  expect(h.auth.register).not.toHaveBeenCalled()
  expect(console.info).toHaveBeenCalledWith(
    "Superuser access already initialized"
  )
})
