import { it, expect, vi } from "vitest"
const construct = vi.hoisted(() => vi.fn(function () {}))
vi.mock("@medusajs/js-sdk", () => ({ default: construct }))
it("honors native Admin backend, authentication and token storage configuration", async () => {
  vi.stubGlobal("__BACKEND_URL__", "https://api.example.test")
  vi.stubGlobal("__AUTH_TYPE__", "jwt")
  vi.stubGlobal("__JWT_TOKEN_STORAGE_KEY__", "example-admin-token")
  await import("../../src/admin/lib/access.js")
  expect(construct).toHaveBeenCalledWith({
    baseUrl: "https://api.example.test",
    auth: { type: "jwt", jwtTokenStorageKey: "example-admin-token" },
  })
  vi.unstubAllGlobals()
})
