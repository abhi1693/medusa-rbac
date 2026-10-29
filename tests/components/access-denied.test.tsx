import { it, expect, vi } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { FetchError } from "@medusajs/js-sdk"
import { AccessDenied } from "../../src/admin/components/access-denied"
import { sdk, accessFingerprint } from "../../src/admin/lib/access"

import { createPrincipal } from "../fixtures/access"
const principal = createPrincipal({
  actor_id: "test_user",
  is_superuser: false,
  role_ids: ["reader"],
  permissions: ["orders.view"],
})
function mount(
  error: unknown,
  options: { query?: () => Promise<unknown>; pending?: boolean } = {}
) {
  vi.spyOn(sdk.client, "fetch").mockImplementation(async () =>
    options.pending ? new Promise(() => {}) : { access: principal }
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  if (options.query)
    void client
      .fetchQuery({ queryKey: ["orders"], queryFn: options.query })
      .catch(() => {})
  const loader = vi.fn(() => null)
  const router = createMemoryRouter([
    { path: "/", loader, element: <AccessDenied error={error} /> },
  ])
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { client, loader, router }
}
it.each([
  null,
  { status: 403 },
  new Error("You do not have permission for this operation"),
])("offers safe navigation without technical error details", async (error) => {
  mount(error)
  expect(
    await screen.findByRole("heading", {
      name: "You don’t have access to this page",
    })
  ).toBeVisible()
  expect(screen.getByText(/Your current roles/)).toBeVisible()
  expect(screen.getByRole("link", { name: "View my access" })).toHaveAttribute(
    "href",
    "/settings/access-management?view=my-access"
  )
  expect(
    screen.getByRole("link", { name: "Go to my profile" })
  ).toHaveAttribute("href", "/settings/profile")
  expect(
    screen.queryByText(/Stack Trace|An error occurred|Development Mode/)
  ).not.toBeInTheDocument()
})
it("explains disabled or unassigned access", async () => {
  mount(new Error("Staff access is inactive or has not been assigned"))
  expect(
    await screen.findByText(/Your account access is disabled/)
  ).toBeVisible()
})
it("waits for current access before attempting recovery", async () => {
  const { loader } = mount(null, { pending: true })
  await screen.findByRole("heading")
  expect(loader).toHaveBeenCalledTimes(1)
})
it("refetches a cached forbidden read and revalidates the route when it succeeds", async () => {
  const denied = new FetchError("Forbidden", "Forbidden", 403)
  const query = vi
    .fn()
    .mockRejectedValueOnce(denied)
    .mockResolvedValue({ orders: [] })
  const { loader } = mount(denied, { query })
  await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
})
it("does not retry unchanged denials repeatedly or refetch unrelated failures", async () => {
  const denied = new FetchError("Forbidden", "Forbidden", 403)
  const query = vi.fn().mockRejectedValue(denied)
  const { client, loader } = mount(denied, { query })
  await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
  const unrelated = vi
    .fn()
    .mockRejectedValue(new FetchError("Failed", "Failed", 500))
  await act(async () => {
    await client
      .fetchQuery({ queryKey: ["customers"], queryFn: unrelated })
      .catch(() => {})
  })
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["medusa-rbac", "me"] })
  })
  expect(query).toHaveBeenCalledTimes(2)
  expect(unrelated).toHaveBeenCalledTimes(1)
  expect(loader).toHaveBeenCalledTimes(1)
})
it("revalidates denied loaders after effective access changes", async () => {
  const { client, loader } = mount(new Error("Forbidden"))
  await screen.findByRole("heading")
  await waitFor(() =>
    expect(client.getQueryState(["medusa-rbac", "me"])?.status).toBe("success")
  )
  await act(async () => {
    client.setQueryData(["medusa-rbac", "me"], {
      access: { ...principal, permissions: ["orders.view", "customers.view"] },
    })
  })
  await waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
})
it("compares effective access independently of role/permission ordering", () => {
  const first = {
    ...principal,
    role_ids: ["b", "a"],
    permissions: ["orders.view", "customers.view"] as any,
  }
  expect(accessFingerprint(first)).toBe(
    accessFingerprint({
      ...first,
      role_ids: ["a", "b"],
      permissions: [...first.permissions].reverse(),
    })
  )
})

it("invalidates native cached reads when effective access changes", async () => {
  const { client } = mount(new Error("Forbidden"))
  await screen.findByRole("heading")
  await waitFor(() =>
    expect(client.getQueryState(["medusa-rbac", "me"])?.status).toBe("success")
  )
  await client.fetchQuery({
    queryKey: ["orders"],
    queryFn: async () => ({ orders: [] }),
  })
  await act(async () => {
    client.setQueryData(["medusa-rbac", "me"], {
      access: { ...principal, active: false, permissions: [] },
    })
  })
  await waitFor(() =>
    expect(client.getQueryState(["orders"])?.isInvalidated).toBe(true)
  )
  expect(client.getQueryState(["medusa-rbac", "me"])?.isInvalidated).toBe(false)
})
