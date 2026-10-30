import { describe, expect, it } from "vitest"
import {
  canonicalPath,
  matchRoute,
  type RouteRegistration,
} from "../../src/lib/access/route-facts"

// Registration order deliberately puts parameters before literals.
const routes: RouteRegistration[] = [
  { path: "/admin/assets/:id", methods: ["GET", "POST", "DELETE"] },
  { path: "/admin/assets/:id/variants/:variant_id", methods: ["GET", "POST"] },
  { path: "/admin/assets/import", methods: ["POST"] },
  { path: "/admin/assets/export", methods: ["POST"] },
  { path: "/admin/assets/:id/approve", methods: ["POST"] },
  { path: "/admin/assets/batch/:batch_id", methods: ["POST"] },
]

describe("route facts", () => {
  it("separates canonical static segments from decoded opaque parameters", () => {
    const facts = matchRoute(
      routes,
      "GET",
      "/ADMIN/ASSETS/Asset%5FAbC/VARIANTS/Var%3FZ/?fields=id"
    )!
    expect(facts).toEqual({
      template: "/admin/assets/:id/variants/:variant_id",
      method: "GET",
      namespace: "admin",
      root: "assets",
      segments: [
        { kind: "parameter", name: "id", value: "Asset_AbC" },
        { kind: "literal", value: "variants" },
        { kind: "parameter", name: "variant_id", value: "Var?Z" },
      ],
      params: { id: "Asset_AbC", variant_id: "Var?Z" },
    })
    expect(canonicalPath("/ADMIN/ASSETS/Asset%5FAbC/?fields=id")).toBe(
      "/ADMIN/ASSETS/Asset%5FAbC"
    )
  })

  it("selects static registrations before parameters for the requested method", () => {
    for (const registrations of [routes, [...routes].reverse()]) {
      expect(
        matchRoute(registrations, "POST", "/admin/assets/import")?.template
      ).toBe("/admin/assets/import")
      expect(
        matchRoute(registrations, "GET", "/admin/assets/import")?.params
      ).toEqual({ id: "import" })
      expect(
        matchRoute(registrations, "POST", "/admin/assets/batch/Batch_A")
          ?.template
      ).toBe("/admin/assets/batch/:batch_id")
    }
  })

  it("keeps command words inside opaque IDs from changing the matched operation", () => {
    for (const id of ["exporter", "importer", "cancelled", "Asset_Export_Z1"])
      expect(matchRoute(routes, "POST", `/admin/assets/${id}`)?.params).toEqual(
        {
          id,
        }
      )
    expect(matchRoute(routes, "HEAD", "/admin/assets/Asset_A")?.method).toBe(
      "GET"
    )
    expect(
      matchRoute(routes, "POST", "/admin/assets/Asset_A/APPROVE")?.template
    ).toBe("/admin/assets/:id/approve")
  })

  it("denies unknown methods and unregistered nested commands", () => {
    for (const method of ["PATCH", "PUT", "TRACE", "OPTIONS"])
      expect(matchRoute(routes, method, "/admin/assets/Asset_A")).toBeNull()
    for (const url of [
      "/admin/assets",
      "/admin/assets/Asset_A/unregistered",
      "/admin/assets/Asset_A/approve/extra",
      "/store/assets/Asset_A",
    ])
      expect(matchRoute(routes, "POST", url)).toBeNull()
  })

  it("rejects ambiguous encodings before dispatching", () => {
    for (const url of [
      "prefix/admin/assets/Asset_A",
      "admin/assets/Asset_A",
      "/admin//assets/Asset_A",
      "/admin\\assets/Asset_A",
      "/admin/assets/%2fusers",
      "/admin/assets/%5cusers",
      "/admin/assets/%2e%2e",
      "/admin/assets/%252fusers",
      "/admin/assets/%zz",
      "/admin/assets/%E0%A4%A",
    ]) {
      expect(canonicalPath(url), url).toBeNull()
      expect(matchRoute(routes, "GET", url), url).toBeNull()
    }
    expect(canonicalPath("/")).toBe("")
    expect(matchRoute(routes, "GET", "/")).toBeNull()
  })

  it("describes a registered top-level infrastructure route", () => {
    expect(
      matchRoute([{ path: "/health", methods: ["GET"] }], "GET", "/HeAlTh")
    ).toMatchObject({
      template: "/health",
      namespace: "",
      root: "health",
      segments: [],
      params: {},
    })
  })
})
