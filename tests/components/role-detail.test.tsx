import { it, expect, vi, beforeEach } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@medusajs/ui"
import { RoleDetail } from "../../src/admin/components/access-management/role-detail"
import { PermissionSummary } from "../../src/admin/components/access-management/permission-summary"
import { handle } from "../../src/admin/routes/settings/access-management/roles/[id]/page"
import { sdk } from "../../src/admin/lib/access"
import {
  createPrincipal,
  createRole,
  createSuperuserRole,
  editorPermissions,
} from "../fixtures/access"

let responses: Record<string, any>
let fetcher: any
beforeEach(() => {
  responses = {
    me: { access: createPrincipal() },
    reader: {
      role: createRole({ created_at: "2026-10-30T00:00:00Z" }),
      actors: [
        {
          actor_type: "user",
          actor_id: "user_other",
          label: "Staff member",
          active: true,
        },
        {
          actor_type: "customer",
          actor_id: "cus_a",
          label: "Customer",
          active: false,
        },
        { actor_type: "vendor", actor_id: "vendor_a", active: true },
      ],
      actor_count: 4,
      pending_invitation_count: 2,
    },
    permissions: { permissions: editorPermissions },
  }
  fetcher = vi
    .spyOn(sdk.client, "fetch")
    .mockImplementation(async (url: any, options: any) => {
      if (options?.method) return {}
      const value = responses[String(url).split("/").at(-1)!]
      if (value instanceof Error) throw value
      return value
    })
})
function mount(cached = false) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  if (cached)
    client.setQueryData(["medusa-rbac", "me"], { access: createPrincipal() })
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <RoleDetail roleId="reader" />
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
  return { ...view, client, user: userEvent.setup() }
}

it("shows a deep-linked role with readable grants, assignment context and native account links", async () => {
  const { user } = mount()
  expect(await screen.findByRole("heading", { name: "Reader" })).toBeVisible()
  expect(screen.getByText("View products")).toBeVisible()
  expect(screen.getByRole("link", { name: "Staff member" })).toHaveAttribute(
    "href",
    "/settings/users/user_other"
  )
  expect(screen.getByText("Customer")).toBeVisible()
  expect(screen.getByText("customer · Inactive")).toBeVisible()
  expect(screen.getByText("vendor_a")).toBeVisible()
  expect(screen.getByText("Showing 1–3 of 4 accounts.")).toBeVisible()
  expect(screen.getByRole("link", { name: "Manage users" })).toHaveAttribute(
    "href",
    "/settings/access-management?view=users"
  )
  expect(screen.getByRole("link", { name: "Back to roles" })).toHaveAttribute(
    "href",
    "/settings/access-management?view=roles"
  )
  expect(fetcher).toHaveBeenCalledWith("/admin/access/roles/reader", {
    query: { offset: 0, limit: 25 },
  })
  expect(handle.breadcrumb()).toBe("Role details")
  await user.click(screen.getByRole("button", { name: "Edit role" }))
  expect(screen.getByRole("heading", { name: "Edit role" })).toBeVisible()
  await user.click(screen.getByRole("button", { name: "Cancel" }))
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})

it("duplicates a configured role without sending its identity or mutating its definition", async () => {
  responses.reader.role = createRole({
    source: "configuration",
    rules: [
      {
        permission: "products.*",
        effect: "allow",
        conditions: { region: "north" },
      },
    ],
  })
  const { user } = mount()
  expect(await screen.findByText("Configuration")).toBeVisible()
  expect(screen.getByText(/defined in application configuration/)).toBeVisible()
  expect(
    screen.queryByRole("button", { name: "Edit role" })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "Duplicate role" }))
  expect(screen.getByLabelText("Role name")).toHaveValue("Reader copy")
  await user.click(screen.getByRole("button", { name: "Save role" }))
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  )
  expect(fetcher).toHaveBeenCalledWith("/admin/access/roles", {
    method: "POST",
    body: {
      name: "Reader copy",
      permissions: ["products.view"],
      rules: [
        {
          permission: "products.*",
          effect: "allow",
          priority: 0,
          conditions: { region: "north" },
        },
      ],
    },
  })
})

it("protects the system role and explains future permissions", async () => {
  responses.reader.role = createSuperuserRole({ permissions: [] })
  responses.reader.actors = []
  responses.reader.actor_count = 0
  mount()
  expect(
    await screen.findByRole("heading", { name: "Superuser" })
  ).toBeVisible()
  expect(screen.getByText("All permissions")).toBeVisible()
  expect(screen.getByText(/including permissions added later/)).toBeVisible()
  expect(screen.getByText(/protected system role/)).toBeVisible()
  expect(
    screen.queryByRole("button", { name: "Duplicate role" })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "Edit role" })
  ).not.toBeInTheDocument()
  expect(screen.getByText("Not assigned yet")).toBeVisible()
})

it("supports a role viewer without privileged editing or native user links", async () => {
  responses.me = {
    access: createPrincipal({
      is_superuser: false,
      permissions: ["roles.view"],
    }),
  }
  responses.reader.role = createRole({ permissions: [], rules: [] })
  responses.reader.actors = [
    { actor_type: "user", actor_id: "unlabelled", active: true },
  ]
  responses.reader.actor_count = 1
  mount()
  expect(await screen.findByRole("heading", { name: "Reader" })).toBeVisible()
  expect(screen.getByText("No permissions assigned")).toBeVisible()
  expect(screen.getByText("unlabelled")).toBeVisible()
  expect(
    screen.queryByRole("link", { name: "unlabelled" })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole("link", { name: "Manage users" })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "Duplicate role" })
  ).not.toBeInTheDocument()
})

it("renders allow and deny rules as readable cards with typed conditions", () => {
  render(
    <PermissionSummary
      role={createRole({
        permissions: [],
        rules: [
          {
            permission: "products.view",
            effect: "allow",
            priority: 3,
            conditions: {
              region: ["north", "south"],
              flag: true,
              empty: null,
              total: 42,
            },
          },
          { permission: "orders.*", effect: "deny" },
        ],
      })}
      permissions={editorPermissions}
    />
  )
  expect(screen.getByText("Allow")).toBeVisible()
  expect(screen.getByText("Deny")).toBeVisible()
  expect(screen.getByText('"north" or "south"')).toBeVisible()
  expect(screen.getByText("Priority 3")).toBeVisible()
  expect(screen.getByText("Priority 0")).toBeVisible()
  expect(screen.getByText("Applies in every context")).toBeVisible()
})

it.each([false, true])(
  "waits for fresh access before exposing a cached role: %s",
  (cached) => {
    responses.me = new Promise(() => {})
    mount(cached)
    expect(screen.getByText("Loading access…")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Edit role" })
    ).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
  }
)

it("shows role loading while the detail request is pending", async () => {
  responses.reader = new Promise(() => {})
  mount()
  expect(await screen.findByText("Loading role…")).toBeVisible()
})

it.each(["me", "reader", "permissions"])(
  "shows %s errors without exposing editing actions",
  async (key) => {
    responses[key] = new Error(`${key} unavailable`)
    mount()
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `${key} unavailable`
    )
    expect(
      screen.queryByRole("button", { name: "Edit role" })
    ).not.toBeInTheDocument()
  }
)

it.each([
  createPrincipal({ active: false }),
  createPrincipal({ role_ids: [] }),
  createPrincipal({ is_superuser: false, permissions: [] }),
])("denies unavailable access before requesting the role", async (access) => {
  responses.me = { access }
  mount()
  expect(
    await screen.findByRole("heading", { name: "Role unavailable" })
  ).toBeVisible()
  expect(screen.getByRole("link", { name: "View my access" })).toHaveAttribute(
    "href",
    "/settings/access-management?view=my-access"
  )
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it("makes an open editor read-only after live management access is revoked", async () => {
  const { user, client } = mount()
  await user.click(await screen.findByRole("button", { name: "Edit role" }))
  await act(async () => {
    responses.me = {
      access: createPrincipal({
        is_superuser: false,
        permissions: ["roles.view"],
      }),
    }
    await client.invalidateQueries({ queryKey: ["medusa-rbac", "me"] })
  })
  expect(
    await screen.findByRole("heading", { name: "Role permissions" })
  ).toBeVisible()
  expect(screen.getByLabelText("Role name")).toBeDisabled()
  expect(
    screen.queryByRole("button", { name: "Save role" })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "Close" }))
})

it("paginates assigned accounts without dropping the role detail", async () => {
  responses.reader.actor_count = 26
  const { user } = mount()
  const next = await screen.findByRole("button", { name: "Next accounts" })
  expect(
    screen.getByRole("button", { name: "Previous accounts" })
  ).toBeDisabled()
  await user.click(next)
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith("/admin/access/roles/reader", {
      query: { offset: 25, limit: 25 },
    })
  )
  expect(screen.getByRole("heading", { name: "Reader" })).toBeVisible()
  expect(next).toBeDisabled()
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Previous accounts" })
    ).toBeEnabled()
  )
  await user.click(screen.getByRole("button", { name: "Previous accounts" }))
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Previous accounts" })
    ).toBeDisabled()
  )
})

it("explains a removed configuration definition without offering an obsolete grant copy", async () => {
  responses.reader.role = createRole({
    source: "configuration",
    configuration_status: "removed",
    permissions: [],
  })
  mount()
  expect(await screen.findByText(/definition is missing/)).toBeVisible()
  expect(screen.getByText(/definition must be restored/)).toBeVisible()
  expect(
    screen.queryByRole("button", { name: "Duplicate role" })
  ).not.toBeInTheDocument()
})

it("preserves the edited record version when background data refreshes", async () => {
  const { user, client } = mount()
  await user.click(await screen.findByRole("button", { name: "Edit role" }))
  await act(async () => {
    responses.reader.role = createRole({
      version: 2,
      permissions: ["prices.view"],
    })
    await client.invalidateQueries({
      queryKey: ["medusa-rbac", "user", "role"],
    })
  })
  await user.click(screen.getByRole("button", { name: "Save role" }))
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith("/admin/access/roles/reader", {
      method: "POST",
      body: {
        name: "Reader",
        permissions: ["products.view"],
        rules: [],
        version: 1,
      },
    })
  )
})

it("links native accounts by identity when their label is unavailable", async () => {
  responses.reader.actors = [
    { actor_type: "user", actor_id: "user_without_label", active: true },
  ]
  mount()
  expect(
    await screen.findByRole("link", { name: "user_without_label" })
  ).toHaveAttribute("href", "/settings/users/user_without_label")
})
