import { afterEach, expect, it, vi } from "vitest"

afterEach(() => {
  vi.doUnmock("../../src/lib/access/native-routes.json")
  vi.resetModules()
})

it("keeps newly discovered native commands denied until their resource vocabulary is reviewed", async () => {
  vi.resetModules()
  vi.doMock("../../src/lib/access/native-routes.json", () => ({
    default: [
      { path: "/admin/countries", methods: ["GET"] },
      { path: "/admin/countries/:id/unreviewed", methods: ["POST"] },
      { path: "/admin/products", methods: ["GET"] },
      { path: "/admin/products/:id/unreviewed", methods: ["POST"] },
    ],
  }))
  const { describeNative } =
    await import("../../src/lib/access/native-resources.js")
  expect(describeNative("GET", "/admin/countries")?.policy.permissions).toEqual(
    ["settings.view"]
  )
  expect(describeNative("GET", "/admin/products")?.policy.permissions).toEqual([
    "products.view",
    "prices.view",
  ])
  expect(
    describeNative("POST", "/admin/countries/Country_A/unreviewed", {})
  ).toBeNull()
  expect(
    describeNative("POST", "/admin/products/Product_A/unreviewed", {})
  ).toBeNull()
})

it("fails closed when an upstream inventory changes the parameter grammar of an existing resource", async () => {
  vi.resetModules()
  vi.doMock("../../src/lib/access/native-routes.json", () => ({
    default: [
      { path: "/admin/products/:id", methods: ["GET"] },
      { path: "/admin/products/:product_id", methods: ["POST"] },
    ],
  }))
  await expect(
    import("../../src/lib/access/native-resources.js")
  ).rejects.toThrow("Conflicting native parameter grammar")
})
