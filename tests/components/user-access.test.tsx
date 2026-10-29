import { deleteStaffUser } from "../../src/admin/lib/users"
import { it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, useLocation } from "react-router-dom"
import { toast } from "@medusajs/ui"
import { sdk } from "../../src/admin/lib/access"
import {
  createAccessInvite,
  deleteAccessInvite,
  acceptAccessInvite,
} from "../../src/admin/lib/invites"
import CurrentAccess from "../../src/admin/widgets/current-access"
import UserAccess from "../../src/admin/widgets/user-access"
import { RolesTable } from "../../src/admin/components/roles-table"
import { InviteRoles } from "../../src/admin/components/invite-roles"
import {
  createPrincipal,
  createProfile,
  createStaff,
  createSuperuserRole,
  createRole,
} from "../fixtures/access"

let me: any, profile: any, person: any, roles: any, fetcher: any
beforeEach(() => {
  me = { access: createPrincipal() }
  profile = { user: createProfile() }
  person = { staff: createStaff() }
  roles = { roles: [createSuperuserRole(), createRole()] }
  fetcher = vi
    .spyOn(sdk.client, "fetch")
    .mockImplementation(async (url: any, options: any) => {
      const result = options?.method
        ? {}
        : url === "/admin/users/me"
          ? profile
          : String(url).endsWith("/me")
            ? me
            : String(url).endsWith("/roles")
              ? roles
              : person
      if (result instanceof Error) throw result
      return result
    })
  vi.spyOn(toast, "error").mockImplementation(() => "toast")
  vi.spyOn(toast, "success").mockImplementation(() => "toast")
})
function Location() {
  return <span data-testid="location">{useLocation().pathname}</span>
}
function mount(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return {
    ...render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          {element}
          <Location />
        </QueryClientProvider>
      </MemoryRouter>
    ),
    client,
    user: userEvent.setup(),
  }
}
it("opens an avatar menu with identity, profile and access links", async () => {
  const { user } = mount(<CurrentAccess />)
  await user.click(await screen.findByRole("button", { name: "Account menu" }))
  expect(screen.getByText("Test Staff")).toBeVisible()
  expect(screen.getByText("staff@example.test")).toBeVisible()
  expect(screen.getByRole("menuitem", { name: "My profile" })).toHaveAttribute(
    "href",
    "/settings/profile"
  )
  expect(screen.getByRole("menuitem", { name: "My access" })).toHaveAttribute(
    "href",
    "/settings/access-management?view=my-access"
  )
})
it.each(["email", "fallback", "avatar", "partial"])(
  "uses profile fallback: %s",
  async (kind) => {
    if (kind === "email")
      profile = { user: createProfile({ first_name: null, last_name: null }) }
    if (kind === "fallback") profile = new Error("profile unavailable")
    if (kind === "avatar")
      profile = { user: createProfile({ avatar_url: "/avatar.png" }) }
    if (kind === "partial")
      profile = { user: createProfile({ last_name: null }) }
    const { user } = mount(<CurrentAccess />)
    await user.click(
      await screen.findByRole("button", { name: "Account menu" })
    )
    expect(screen.getByRole("menuitem", { name: "Log out" })).toBeVisible()
  }
)
it("clears cached access and returns to login after native logout", async () => {
  vi.spyOn(sdk.auth, "logout").mockResolvedValue(undefined)
  const { user, client } = mount(<CurrentAccess />)
  client.setQueryData(["private-orders"], ["sensitive"])
  await user.click(await screen.findByRole("button", { name: "Account menu" }))
  await user.click(screen.getByRole("menuitem", { name: "Log out" }))
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent("/login")
  )
  expect(sdk.auth.logout).toHaveBeenCalledOnce()
  expect(client.getQueryData(["private-orders"])).toBeUndefined()
})
it("keeps the session and reports a failed logout", async () => {
  vi.spyOn(sdk.auth, "logout").mockRejectedValue(
    new Error("Logout unavailable")
  )
  const { user } = mount(<CurrentAccess />)
  await user.click(await screen.findByRole("button", { name: "Account menu" }))
  await user.click(screen.getByRole("menuitem", { name: "Log out" }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Logout unavailable")
  )
  expect(screen.getByTestId("location")).toHaveTextContent("/")
})
it("shows existing roles on user details and saves through the shared editor", async () => {
  const { user } = mount(
    <UserAccess data={createProfile({ id: "staff" }) as any} />
  )
  await user.click(await screen.findByRole("button", { name: "Edit roles" }))
  expect(
    screen.getByRole("heading", { name: "Manage staff access" })
  ).toBeVisible()
  await user.click(screen.getByRole("checkbox", { name: "Superuser" }))
  await user.click(screen.getByRole("button", { name: "Save access" }))
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/admin/access/staff/staff",
      expect.objectContaining({
        body: { role_ids: ["reader", "admin"], active: true, version: 3 },
      })
    )
  )
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Manage staff access" })
    ).not.toBeInTheDocument()
  )
})
it.each(["inactive", "reader", "pending"])(
  "hides the management widget from %s users",
  async (kind) => {
    me =
      kind === "pending"
        ? new Promise(() => {})
        : {
            access: createPrincipal({
              active: kind !== "inactive",
              is_superuser: false,
            }),
          }
    const { container } = mount(<UserAccess data={createProfile() as any} />)
    await waitFor(() => expect(fetcher).toHaveBeenCalled())
    expect(screen.queryByText("Roles")).not.toBeInTheDocument()
    expect(container.querySelector("button")).toBeNull()
  }
)
it.each(["loading", "staff-error", "role-error", "unassigned", "unknown-role"])(
  "renders user access state: %s",
  async (kind) => {
    if (kind === "loading") person = new Promise(() => {})
    if (kind === "staff-error") person = new Error("Staff unavailable")
    if (kind === "role-error") roles = new Error("Roles unavailable")
    if (kind === "unassigned")
      person = {
        staff: createStaff({
          access: { active: false, role_ids: [], version: 0 },
        }),
      }
    if (kind === "unknown-role")
      person = {
        staff: createStaff({
          access: { active: true, role_ids: ["missing"], version: 1 },
        }),
      }
    mount(<UserAccess data={createProfile() as any} />)
    await screen.findByText("Roles")
    if (kind.endsWith("error"))
      expect(await screen.findByRole("alert")).toHaveTextContent("unavailable")
    if (kind === "unassigned")
      expect(await screen.findByText("No roles assigned")).toBeVisible()
    if (kind === "unknown-role")
      expect(await screen.findByText("Unavailable role")).toBeVisible()
    if (kind === "loading")
      expect(screen.getByText("Loading roles…")).toBeVisible()
  }
)
it("selects and unselects roles in the native invite form", async () => {
  const onChange = vi.fn()
  const { user, rerender } = mount(
    <InviteRoles value={[]} onChange={onChange} />
  )
  await user.click(await screen.findByRole("checkbox", { name: "Reader" }))
  expect(onChange).toHaveBeenLastCalledWith(["reader"])
  // Keep the same provider while giving the controlled field its selected value.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  rerender(
    <QueryClientProvider client={client}>
      <InviteRoles
        value={["reader"]}
        onChange={onChange}
        error="Select a role"
      />
    </QueryClientProvider>
  )
  await user.click(await screen.findByRole("checkbox", { name: "Reader" }))
  expect(onChange).toHaveBeenLastCalledWith([])
  expect(screen.getByRole("alert")).toHaveTextContent("Select a role")
})
it("shows invite role loading and fetch errors", async () => {
  roles = new Error("Roles unavailable")
  mount(<InviteRoles value={[]} onChange={vi.fn()} />)
  expect(screen.getByText("Loading roles…")).toBeVisible()
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Roles unavailable"
  )
})
it("uses the custom invitation APIs without submitting roles to Enterprise APIs", async () => {
  await createAccessInvite({
    email: "invited@example.test",
    roles: ["reader"],
  })
  await createAccessInvite({ email: "invited@example.test" })
  await deleteAccessInvite("inv_test")
  await acceptAccessInvite("invite-token", {
    first_name: "Test",
    auth_token: "signup-token",
  })
  expect(fetcher).toHaveBeenCalledWith("/admin/access/invites", {
    method: "POST",
    body: { email: "invited@example.test", role_ids: ["reader"] },
  })
  expect(fetcher).toHaveBeenCalledWith("/access/invites/accept", {
    method: "POST",
    query: { token: "invite-token" },
    headers: { Authorization: "Bearer signup-token" },
    body: { first_name: "Test" },
  })
})

it("uses a native table for selected roles and preserves the other selection", async () => {
  const onSelectionChange = vi.fn()
  const { user } = mount(
    <RolesTable
      roles={[createRole(), createSuperuserRole()]}
      selectedRoleIds={["reader", "admin"]}
      onSelectionChange={onSelectionChange}
    />
  )
  expect(screen.getByRole("table")).toBeVisible()
  expect(screen.getByRole("columnheader", { name: "Role" })).toBeVisible()
  await user.click(screen.getByRole("checkbox", { name: "Reader" }))
  expect(onSelectionChange).toHaveBeenCalledWith(["admin"])
})
it("renders an empty role selector as a native table", () => {
  mount(<RolesTable roles={[]} onSelectionChange={vi.fn()} />)
  expect(
    screen.getByRole("cell", { name: "No roles assigned" })
  ).toHaveAttribute("colspan", "3")
})

it("uses guarded user deletion from the native Admin action", async () => {
  await deleteStaffUser("target")
  expect(fetcher).toHaveBeenCalledWith("/admin/access/staff/target", {
    method: "DELETE",
  })
})
