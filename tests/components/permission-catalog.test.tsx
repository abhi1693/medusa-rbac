import { beforeEach, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@medusajs/ui"
import { PermissionCatalog } from "../../src/admin/components/access-management/permission-catalog"
import { sdk } from "../../src/admin/lib/access"

const permissions = [
  { id: "orders.view", label: "View orders", group: "Orders" },
  { id: "products.edit", label: "Edit products", group: "Catalog" },
]
let fetcher: any
let catalog: any
let evaluation: any
beforeEach(() => {
  catalog = { permissions, actor_types: ["user", "customer", "vendor"] }
  evaluation = { decision: { allowed: true, reason: "superuser", matches: [] } }
  fetcher = vi
    .spyOn(sdk.client, "fetch")
    .mockImplementation(async (_url, options: any) => {
      const response = options?.method ? evaluation : catalog
      if (response instanceof Error) throw response
      return response
    })
})
function mount(superuser = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <PermissionCatalog userId="user_1" superuser={superuser} />
      </TooltipProvider>
    </QueryClientProvider>
  )
  return { ...view, user: userEvent.setup() }
}
async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "Check orders.view" })
  )
  expect(
    await screen.findByRole("heading", { name: "Check permission" })
  ).toBeVisible()
}
it("browses registered permission identifiers and searches across groups", async () => {
  const { user } = mount(false)
  expect(await screen.findByText("orders.view")).toBeVisible()
  expect(
    screen.queryByRole("button", { name: "Check orders.view" })
  ).not.toBeInTheDocument()
  await user.type(screen.getByPlaceholderText("Search permissions"), "Catalog")
  await waitFor(() =>
    expect(screen.queryByText("orders.view")).not.toBeInTheDocument()
  )
  expect(screen.getByText("products.edit")).toBeVisible()
  await user.clear(screen.getByPlaceholderText("Search permissions"))
  await user.type(screen.getByPlaceholderText("Search permissions"), "missing")
  expect(await screen.findByText("No results")).toBeVisible()
})
it("paginates and returns to the first page when searching", async () => {
  catalog = {
    permissions: Array.from({ length: 26 }, (_, i) => ({
      id: `items.permission${i}`,
      label: `Permission ${i}`,
      group: "Items",
    })),
  }
  const { user } = mount(false)
  await screen.findByText("items.permission0")
  await user.click(screen.getByRole("button", { name: /Next/ }))
  expect(await screen.findByText("items.permission25")).toBeVisible()
  await user.type(
    screen.getByPlaceholderText("Search permissions"),
    "permission0"
  )
  expect(await screen.findByText("items.permission0")).toBeVisible()
})
it.each([new Error("Catalog unavailable"), { permissions: [] }])(
  "handles unavailable or empty registries",
  async (response) => {
    catalog = response
    mount()
    if (response instanceof Error)
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Catalog unavailable"
      )
    else
      expect(await screen.findByText("No permissions registered")).toBeVisible()
  }
)
it.each(["inactive", "superuser", "no_match", "allow", "deny"])(
  "shows the actual %s decision and closes the diagnostic drawer",
  async (reason) => {
    evaluation = {
      decision: {
        allowed: ["allow", "superuser"].includes(reason),
        reason,
        matches:
          reason === "allow"
            ? [
                {
                  permission: "orders.view",
                  effect: "allow",
                  priority: 10,
                  source: "rule",
                },
                { permission: "orders.*", effect: "allow", source: "rule" },
              ]
            : [],
      },
    }
    const { user } = mount()
    await open(user)
    await user.click(screen.getByRole("button", { name: "Check access" }))
    expect(
      await screen.findByText(
        evaluation.decision.allowed ? "Allowed" : "Denied"
      )
    ).toBeVisible()
    if (reason === "allow") {
      expect(screen.getByText("Winning rule")).toBeVisible()
      expect(screen.getByText("Other matching rule")).toBeVisible()
      expect(screen.getByText(/Priority 10/)).toBeVisible()
      expect(screen.getByText(/Priority 0/)).toBeVisible()
    }
    expect(fetcher).toHaveBeenCalledWith(
      "/admin/access/evaluate",
      expect.objectContaining({
        body: {
          actor_type: "user",
          actor_id: "user_1",
          permission: "orders.view",
          context: {},
        },
      })
    )
    await user.click(screen.getByRole("button", { name: "Close" }))
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Check permission" })
      ).not.toBeInTheDocument()
    )
  }
)
it("supports customer/custom actors and clears a decision when its inputs change", async () => {
  const { user } = mount()
  await open(user)
  await user.click(screen.getByRole("button", { name: "Check access" }))
  await screen.findByText("Allowed")
  await user.click(screen.getByRole("combobox", { name: "Account type" }))
  await user.click(screen.getByRole("option", { name: "Customer" }))
  expect(screen.queryByText("Allowed")).not.toBeInTheDocument()
  await user.clear(screen.getByLabelText("Actor ID"))
  await user.type(screen.getByLabelText("Actor ID"), "customer_1")
  await user.clear(screen.getByLabelText("Context"))
  await user.paste('{"region_id":"north"}')
  await user.click(screen.getByRole("button", { name: "Check access" }))
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/admin/access/evaluate",
      expect.objectContaining({
        body: {
          actor_type: "customer",
          actor_id: "customer_1",
          permission: "orders.view",
          context: { region_id: "north" },
        },
      })
    )
  )
  await user.click(screen.getByRole("combobox", { name: "Account type" }))
  await user.click(screen.getByRole("option", { name: "vendor" }))
})
it("validates context before a request, reports request failures and supplies native actor types by default", async () => {
  catalog = { permissions }
  const { user } = mount()
  await open(user)
  await user.clear(screen.getByLabelText("Context"))
  await user.type(screen.getByLabelText("Context"), "null")
  await user.click(screen.getByRole("button", { name: "Check access" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("JSON object")
  expect(fetcher).not.toHaveBeenCalledWith(
    "/admin/access/evaluate",
    expect.anything()
  )
  await user.clear(screen.getByLabelText("Context"))
  await user.paste("{}")
  evaluation = new Error("Actor not found")
  await user.click(screen.getByRole("button", { name: "Check access" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Actor not found")
  await user.keyboard("{Escape}")
})
