import { it, expect, vi, beforeEach } from "vitest"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, useLocation, Routes, Route } from "react-router-dom"
import { toast, TooltipProvider } from "@medusajs/ui"
import AccessManagement from "../../src/admin/routes/settings/access-management/page"
import RoleDetailsPage from "../../src/admin/routes/settings/access-management/roles/[id]/page"
import { sdk } from "../../src/admin/lib/access"
import {
  createPrincipal,
  createRole,
  createSuperuserRole,
  createStaff,
  createAuditEvent,
  editorPermissions,
} from "../fixtures/access"

let responses: Record<string, any>, fetcher: any
beforeEach(() => {
  responses = {
    me: {
      access: createPrincipal(),
      roles: [{ id: "admin", name: "Superuser" }],
    },
    roles: { roles: [createSuperuserRole(), createRole()] },
    permissions: { permissions: editorPermissions },
    staff: {
      staff: [createStaff({ roles: [{ id: "reader", name: "Reader" }] })],
      count: 1,
    },
    audit: { events: [createAuditEvent()], count: 1 },
  }
  fetcher = vi
    .spyOn(sdk.client, "fetch")
    .mockImplementation(async (url: any, options: any) => {
      if (options?.method) return {}
      const role = responses.roles?.roles?.find(
        (item: any) => String(url) === `/admin/access/roles/${item.id}`
      )
      const result = role
        ? { role, actors: [], actor_count: 0, pending_invitation_count: 0 }
        : responses[String(url).split("/").at(-1)!]
      if (result instanceof Error) throw result
      return result
    })
  vi.spyOn(toast, "success").mockImplementation(() => "toast")
  vi.spyOn(toast, "error").mockImplementation(() => "toast")
})
function Location() {
  return <span data-testid="location">{useLocation().search}</span>
}
function mount(path = "/", cached = false) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  if (cached)
    client.setQueryData(["medusa-rbac", "me"], { access: createPrincipal() })
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <Routes>
            <Route
              path="/settings/access-management/roles/:id"
              element={<RoleDetailsPage />}
            />
            <Route path="*" element={<AccessManagement />} />
          </Routes>
          <Location />
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
  return { ...view, client, user: userEvent.setup() }
}
async function roleMenu(
  user: ReturnType<typeof userEvent.setup>,
  name = "Reader"
) {
  await user.click(
    await screen.findByRole("button", { name: `Actions for ${name}` })
  )
}
it("shows the native role table toolbar, search and system role menu", async () => {
  const { user } = mount()
  expect(await screen.findByRole("heading", { name: "Roles" })).toBeVisible()
  expect(screen.getByPlaceholderText("Search roles")).toBeVisible()
  expect(
    screen.queryByRole("columnheader", { name: "Actions" })
  ).not.toBeInTheDocument()
  await roleMenu(user, "Superuser")
  expect(
    screen.getByRole("menuitem", { name: "View permissions" })
  ).toBeVisible()
  expect(
    screen.queryByRole("menuitem", { name: "Delete" })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole("menuitem", { name: "View permissions" }))
  expect(
    await screen.findByRole("heading", { name: "Superuser" })
  ).toBeVisible()
  expect(screen.getByText(/protected system role/)).toBeVisible()
  expect(
    screen.queryByRole("button", { name: "Save role" })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole("link", { name: "Back to roles" }))
})
it("creates and edits roles from the native toolbar and row menus", async () => {
  const { user } = mount()
  await user.click(await screen.findByRole("button", { name: "Create role" }))
  expect(
    await screen.findByRole("heading", { name: "Create role" })
  ).toBeVisible()
  await user.click(screen.getByRole("button", { name: "Cancel" }))
  await roleMenu(user)
  await user.click(screen.getByRole("menuitem", { name: "Edit" }))
  expect(
    await screen.findByRole("heading", { name: "Edit role" })
  ).toBeVisible()
  expect(screen.getByText("products.view")).toBeVisible()
  await user.click(screen.getByRole("button", { name: "Cancel" }))
  await user.click(screen.getByRole("cell", { name: "Reader" }))
  expect(await screen.findByRole("heading", { name: "Reader" })).toBeVisible()
  expect(screen.getByRole("heading", { name: "Permissions" })).toBeVisible()
})
it("confirms deletion, permits cancellation and reports a failure", async () => {
  const { user } = mount()
  await roleMenu(user)
  await user.click(screen.getByRole("menuitem", { name: "Delete" }))
  let prompt = await screen.findByRole("alertdialog")
  await user.click(within(prompt).getByRole("button", { name: "Cancel" }))
  expect(
    fetcher.mock.calls.some(([, options]: any) => options?.method === "DELETE")
  ).toBe(false)
  await roleMenu(user)
  await user.click(screen.getByRole("menuitem", { name: "Delete" }))
  prompt = await screen.findByRole("alertdialog")
  await user.click(within(prompt).getByRole("button", { name: "Delete" }))
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Role deleted")
  )
  fetcher.mockImplementation(async (url: any, options: any) => {
    if (options?.method === "DELETE") throw new Error("Reassign users first")
    return responses[String(url).split("/").at(-1)!]
  })
  await roleMenu(user)
  await user.click(screen.getByRole("menuitem", { name: "Delete" }))
  await user.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Delete",
    })
  )
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Reassign users first")
  )
})
it("searches roles and renders the native filtered empty state", async () => {
  const { user } = mount()
  const input = await screen.findByPlaceholderText("Search roles")
  await screen.findByRole("cell", { name: "Reader" })
  await user.type(input, "reader")
  await waitFor(() =>
    expect(screen.queryByText("Superuser")).not.toBeInTheDocument()
  )
  await user.clear(input)
  await user.type(input, "missing role")
  expect(await screen.findByText("No results")).toBeVisible()
})
it("role viewers can inspect permissions without management actions", async () => {
  responses.me = {
    access: createPrincipal({
      is_superuser: false,
      permissions: ["roles.view"],
    }),
  }
  const { user } = mount()
  await roleMenu(user)
  expect(
    screen.queryByRole("button", { name: "Create role" })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole("menuitem", { name: "Edit" })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole("menuitem", { name: "View permissions" }))
  expect(await screen.findByRole("heading", { name: "Reader" })).toBeVisible()
  expect(screen.getByText("View products")).toBeVisible()
  expect(
    screen.queryByRole("button", { name: "Edit role" })
  ).not.toBeInTheDocument()
})
it("users link to native user details without a duplicate role editor", async () => {
  const { user } = mount()
  await user.click(await screen.findByRole("tab", { name: "Users" }))
  expect(
    await screen.findByRole("link", { name: "staff@example.test" })
  ).toHaveAttribute("href", "/settings/users/staff")
  expect(screen.getByRole("button", { name: "Invite user" })).toBeVisible()
  expect(
    screen.queryByRole("button", { name: "Manage access" })
  ).not.toBeInTheDocument()
  expect(screen.getByRole("cell", { name: "Reader" })).toBeVisible()
  expect(screen.getByRole("cell", { name: "—" })).toBeVisible()
  expect(screen.getByTestId("location")).toHaveTextContent("view=users")
})
it("staff-only viewers get a read-only user overview with readable fallbacks", async () => {
  responses.me = {
    access: createPrincipal({
      is_superuser: false,
      permissions: ["staff.view"],
    }),
  }
  responses.staff.staff = [
    createStaff(),
    createStaff({
      id: "missing",
      email: "missing@example.test",
      access: { active: false, role_ids: [], version: 0 },
      first_name: "Test",
      last_name: "Staff",
    }),
  ]
  mount()
  expect(await screen.findByRole("heading", { name: "Users" })).toBeVisible()
  expect(await screen.findByRole("cell", { name: "Test Staff" })).toBeVisible()
  expect(screen.getByRole("cell", { name: "No roles assigned" })).toBeVisible()
  expect(screen.getByRole("cell", { name: "Roles unavailable" })).toBeVisible()
  expect(
    screen.queryByRole("link", { name: "Manage users" })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole("link", { name: "staff@example.test" })
  ).not.toBeInTheDocument()
})
it("paginates users and searches across the backend rather than just the current page", async () => {
  responses.staff.count = 26
  const { user } = mount("/?view=users")
  await screen.findByRole("cell", { name: "Reader" })
  await user.click(screen.getByRole("button", { name: /next/i }))
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith("/admin/access/staff", {
      query: { offset: 25, limit: 25 },
    })
  )
  await user.click(screen.getByRole("button", { name: /^prev$/i }))
  await user.type(screen.getByPlaceholderText("Search users"), "staff")
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith("/admin/access/staff", {
      query: { offset: 0, limit: 25, q: "staff" },
    })
  )
})
it("shows readable activity and paginates with the native footer", async () => {
  responses.audit.count = 26
  const { user } = mount("/?view=activity")
  expect(
    await screen.findByRole("cell", { name: "Role created" })
  ).toBeVisible()
  expect(screen.getByRole("cell", { name: "staff@example.test" })).toBeVisible()
  expect(screen.queryByText("create_role")).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: /next/i }))
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith("/admin/access/audit", {
      query: { offset: 25, limit: 25 },
    })
  )
  await user.click(screen.getByRole("button", { name: /^prev$/i }))
})
it("links directly to personal access and uses human permission names", async () => {
  const { user } = mount("/?view=my-access")
  expect(
    await screen.findByRole("heading", { name: "My access" })
  ).toBeVisible()
  expect(screen.getByText("Superuser")).toBeVisible()
  expect(screen.getByRole("cell", { name: "View staff" })).toBeVisible()
  expect(screen.queryByText("staff.view")).not.toBeInTheDocument()
  await user.type(
    screen.getByPlaceholderText("Search permissions"),
    "view orders"
  )
  await waitFor(() =>
    expect(screen.getByRole("cell", { name: "View orders" })).toBeVisible()
  )
  await waitFor(() =>
    expect(
      screen.queryByRole("cell", { name: "View staff" })
    ).not.toBeInTheDocument()
  )
})
it.each([undefined, []])(
  "personal access supports role-name loading fallbacks",
  async (roles) => {
    responses.me = {
      access: createPrincipal({ is_superuser: false, permissions: [] }),
      roles,
    }
    mount()
    expect(
      await screen.findByRole("heading", { name: "My access" })
    ).toBeVisible()
    expect(
      await screen.findByText(roles ? "No roles assigned" : "Roles unavailable")
    ).toBeVisible()
  }
)
it("unknown or unauthorized view parameters fall back to an allowed view", async () => {
  responses.me = {
    access: createPrincipal({
      is_superuser: false,
      permissions: ["audit.view"],
    }),
  }
  mount("/?view=roles")
  expect(await screen.findByRole("heading", { name: "Activity" })).toBeVisible()
  expect(screen.queryByPlaceholderText("Search roles")).not.toBeInTheDocument()
})
it.each(["me", "roles", "permissions", "staff", "audit"])(
  "reports %s errors without rendering a fabricated empty table",
  async (name) => {
    responses[name] = new Error(`${name} unavailable`)
    mount(
      name === "staff"
        ? "/?view=users"
        : name === "audit"
          ? "/?view=activity"
          : "/"
    )
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `${name} unavailable`
    )
    expect(screen.queryByText("No roles yet")).not.toBeInTheDocument()
  }
)
it.each([false, true])(
  "does not expose stale superuser UI while access is loading: cached %s",
  (cached) => {
    responses.me = new Promise(() => {})
    mount("/", cached)
    expect(screen.getByText("Loading access…")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Create role" })
    ).not.toBeInTheDocument()
  }
)
it.each([
  createPrincipal({ active: false }),
  createPrincipal({ role_ids: [] }),
])(
  "shows pending access without requesting management data",
  async (access) => {
    responses.me = { access }
    mount()
    expect(
      await screen.findByRole("heading", { name: "Access pending" })
    ).toBeVisible()
    expect(fetcher.mock.calls).toHaveLength(1)
  }
)
it("closes privileged editors after the current superuser loses access", async () => {
  const { user, client } = mount()
  await roleMenu(user)
  await user.click(screen.getByRole("menuitem", { name: "Edit" }))
  expect(
    await screen.findByRole("heading", { name: "Edit role" })
  ).toBeVisible()
  await act(async () => {
    responses.me = {
      access: createPrincipal({ is_superuser: false, permissions: [] }),
    }
    await client.invalidateQueries({ queryKey: ["medusa-rbac", "me"] })
  })
  expect(
    await screen.findByRole("heading", { name: "My access" })
  ).toBeVisible()
  expect(
    screen.queryByRole("heading", { name: "Edit role" })
  ).not.toBeInTheDocument()
})

it("opens a role detail while waiting for the permission catalog", async () => {
  let ready!: (value: unknown) => void
  responses.permissions = new Promise((resolve) => {
    ready = resolve
  })
  const { user } = mount()
  await screen.findByRole("cell", { name: "Reader" })
  expect(screen.getByRole("button", { name: "Create role" })).toBeDisabled()
  await user.click(screen.getByRole("cell", { name: "Reader" }))
  expect(await screen.findByText("Loading role…")).toBeVisible()
  await act(async () => ready({ permissions: editorPermissions }))
  expect(await screen.findByRole("heading", { name: "Reader" })).toBeVisible()
})
it("an open editor becomes read-only if the superuser keeps only role viewing", async () => {
  const { user, client } = mount()
  await roleMenu(user)
  await user.click(screen.getByRole("menuitem", { name: "Edit" }))
  await screen.findByRole("heading", { name: "Edit role" })
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
})
it("old activity records use readable fallbacks rather than internal identifiers", async () => {
  responses.audit = {
    events: [
      createAuditEvent({
        action: "unknown",
        actor_label: undefined,
        target_label: undefined,
      }),
    ],
    count: 1,
  }
  mount("/?view=activity")
  expect(
    await screen.findByRole("cell", { name: "Unknown user" })
  ).toBeVisible()
  expect(screen.getByRole("cell", { name: "Removed item" })).toBeVisible()
  expect(screen.getByRole("cell", { name: "Access updated" })).toBeVisible()
})

it("distinguishes configuration roles and duplicates them as editable Admin roles", async () => {
  responses.roles.roles = [
    createRole({
      source: "configuration",
      actor_count: 2,
      created_at: "2026-10-30T00:00:00Z",
    }),
  ]
  const { user } = mount()
  expect(
    await screen.findByRole("cell", { name: "Configuration" })
  ).toBeVisible()
  expect(screen.getByRole("cell", { name: "2" })).toBeVisible()
  await roleMenu(user)
  expect(
    screen.queryByRole("menuitem", { name: "Edit" })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole("menuitem", { name: "Delete" })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole("menuitem", { name: "Duplicate" }))
  expect(screen.getByLabelText("Role name")).toHaveValue("Reader copy")
  await user.click(screen.getByRole("button", { name: "Save role" }))
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Role saved"))
  expect(fetcher).toHaveBeenCalledWith("/admin/access/roles", {
    method: "POST",
    body: { name: "Reader copy", permissions: ["products.view"], rules: [] },
  })
})

it("marks removed configuration definitions and prevents copying obsolete grants", async () => {
  responses.roles.roles = [
    createRole({ source: "configuration", configuration_status: "removed" }),
  ]
  const { user } = mount()
  expect(await screen.findByText("Definition missing")).toBeVisible()
  await roleMenu(user)
  expect(
    screen.queryByRole("menuitem", { name: "Duplicate" })
  ).not.toBeInTheDocument()
})
