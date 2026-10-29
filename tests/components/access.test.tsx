import { it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, within, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { toast } from "@medusajs/ui"
import { sdk, accessApi, errorMessage } from "../../src/admin/lib/access"
import { PERMISSION_IDS } from "../../src/lib/access/permissions"
import { RoleEditor } from "../../src/admin/components/role-editor"
import { StaffEditor } from "../../src/admin/components/staff-editor"

import {
  createRole,
  createSuperuserRole,
  createPrincipal,
  createStaff,
  createProfile,
  editorPermissions,
} from "../fixtures/access"
const reader = createRole({ version: 2 })
const owner = createSuperuserRole({ version: 2 })
const principal = createPrincipal()
const staff = createStaff()
const permissions = editorPermissions
let responses: Record<string, any>
let fetcher: any
beforeEach(() => {
  responses = {
    me: { access: principal },
    roles: { roles: [owner, reader] },
    permissions: { permissions },
    staff: { staff: [staff], count: 1 },
    audit: {
      events: [
        {
          id: "e",
          action: "create_role",
          actor_id: "actor",
          target_id: "target",
          created_at: "2026-10-29T10:00:00Z",
        },
      ],
      count: 1,
    },
  }
  fetcher = vi
    .spyOn(sdk.client, "fetch")
    .mockImplementation(async (url: any, options: any) => {
      if (options?.method) return { result: {} }
      const value =
        url === "/admin/users/me"
          ? { user: createProfile() }
          : responses[String(url).split("/").at(-1)!]
      if (value instanceof Error) throw value
      return value
    })
  vi.spyOn(toast, "success").mockImplementation(() => "toast")
  vi.spyOn(toast, "error").mockImplementation(() => "toast")
})
function mount(component: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{component}</QueryClientProvider>
    </MemoryRouter>
  )
  return { ...view, client, user: userEvent.setup() }
}
it("uses the native SDK for all versioned access requests", async () => {
  await accessApi.profile()
  await accessApi.staffUser("staff")
  await accessApi.me()
  await accessApi.roles()
  await accessApi.permissions()
  await accessApi.staff(25)
  await accessApi.audit(50)
  await accessApi.saveRole({ name: "New", permissions: [] })
  await accessApi.saveRole(reader)
  await accessApi.deleteRole(reader)
  await accessApi.saveStaff(staff, ["reader"])
  expect(fetcher).toHaveBeenCalledWith("/admin/access/staff", {
    query: { offset: 25, limit: 25 },
  })
  expect(fetcher).toHaveBeenCalledWith("/admin/access/audit", {
    query: { offset: 50, limit: 25 },
  })
  expect(fetcher).toHaveBeenCalledWith("/admin/access/roles", {
    method: "POST",
    body: { name: "New", permissions: [] },
  })
  expect(fetcher).toHaveBeenCalledWith("/admin/access/roles/reader", {
    method: "POST",
    body: expect.objectContaining({ version: 2 }),
  })
  expect(fetcher).toHaveBeenCalledWith("/admin/access/roles/reader", {
    method: "DELETE",
    body: { version: 2 },
  })
  expect(fetcher).toHaveBeenCalledWith("/admin/access/staff/staff", {
    method: "POST",
    body: { role_ids: ["reader"], active: true, version: 3 },
  })
  expect(errorMessage(new Error("Conflict"))).toBe("Conflict")
  expect(errorMessage(null)).toContain("Reload")
})
it("creates a role using native form controls and refreshes access", async () => {
  const onClose = vi.fn()
  const { user, client } = mount(
    <RoleEditor open permissions={permissions} onClose={onClose} />
  )
  const invalidate = vi.spyOn(client, "invalidateQueries")
  expect(screen.getByRole("button", { name: "Save role" })).toBeDisabled()
  await user.type(screen.getByLabelText("Role name"), "New role")
  await user.click(screen.getByRole("checkbox", { name: "View products" }))
  await user.click(screen.getByRole("checkbox", { name: "View products" }))
  await user.click(screen.getByRole("checkbox", { name: "View prices" }))
  await user.click(screen.getByRole("button", { name: "Save role" }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(fetcher).toHaveBeenCalledWith("/admin/access/roles", {
    method: "POST",
    body: { name: "New role", permissions: ["prices.view"], rules: [] },
  })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["medusa-rbac"] })
  expect(toast.success).toHaveBeenCalledWith("Role saved")
})
it("edits a role with its version and keeps the editor open on a failure", async () => {
  fetcher.mockRejectedValue(new Error("Access changed"))
  const onClose = vi.fn()
  const { user } = mount(
    <RoleEditor
      open
      role={reader}
      permissions={permissions}
      onClose={onClose}
    />
  )
  expect(screen.getByRole("heading", { name: "Edit role" })).toBeVisible()
  expect(screen.getByRole("checkbox", { name: "View products" })).toBeChecked()
  await user.click(screen.getByRole("button", { name: "Save role" }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Access changed")
  )
  expect(onClose).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button", { name: "Cancel" }))
  expect(onClose).toHaveBeenCalledTimes(1)
})
it("closes role editor with Escape", async () => {
  const onClose = vi.fn()
  const { user } = mount(<RoleEditor open permissions={[]} onClose={onClose} />)
  await user.keyboard("{Escape}")
  expect(onClose).toHaveBeenCalled()
})
it("combines staff roles and sends the current version without an access toggle", async () => {
  const onClose = vi.fn()
  const { user } = mount(
    <StaffEditor staff={staff} roles={[reader, owner]} onClose={onClose} />
  )
  await user.click(screen.getByRole("checkbox", { name: "Reader" }))
  await user.click(screen.getByRole("checkbox", { name: "Superuser" }))
  expect(screen.queryByRole("switch")).not.toBeInTheDocument()
  expect(screen.getByText("Assign one or more roles.")).toBeVisible()
  await user.click(screen.getByRole("button", { name: "Save access" }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(fetcher).toHaveBeenCalledWith("/admin/access/staff/staff", {
    method: "POST",
    body: { role_ids: ["admin"], active: true, version: 3 },
  })
  expect(toast.success).toHaveBeenCalledWith("Staff access updated")
})
it("shows staff save failure and supports Cancel and Escape", async () => {
  fetcher.mockRejectedValue(new Error("Last superuser"))
  const onClose = vi.fn()
  const { user } = mount(
    <StaffEditor staff={staff} roles={[reader]} onClose={onClose} />
  )
  await user.click(screen.getByRole("button", { name: "Save access" }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Last superuser")
  )
  expect(onClose).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button", { name: "Cancel" }))
  await user.keyboard("{Escape}")
  expect(onClose).toHaveBeenCalledTimes(2)
})
it.each([true, false])(
  "staff role selection alone grants or removes access: %s",
  async (assigning) => {
    const initial = assigning
      ? createStaff({ access: { active: false, role_ids: [], version: 0 } })
      : staff
    const { user } = mount(
      <StaffEditor staff={initial} roles={[reader]} onClose={vi.fn()} />
    )
    await user.click(screen.getByRole("checkbox", { name: "Reader" }))
    await user.click(screen.getByRole("button", { name: "Save access" }))
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith("/admin/access/staff/staff", {
        method: "POST",
        body: {
          role_ids: assigning ? ["reader"] : [],
          active: assigning,
          version: initial.access.version,
        },
      })
    )
  }
)

it("searches role permissions and protects a save in progress from dismissal", async () => {
  let resolve!: (value: any) => void
  fetcher.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const close = vi.fn()
  const { user } = mount(
    <RoleEditor open permissions={permissions} onClose={close} />
  )
  await user.type(screen.getByLabelText("Role name"), "New role")
  await user.type(screen.getByLabelText("Search permissions"), "prices")
  expect(
    screen.queryByRole("checkbox", { name: "View products" })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole("tab", { name: "Rules (0)" }))
  expect(screen.getByText(/No permission rules/)).toBeVisible()
  await user.click(screen.getByRole("button", { name: "Save role" }))
  await user.keyboard("{Escape}")
  expect(close).not.toHaveBeenCalled()
  await act(async () => {
    resolve({})
  })
  await waitFor(() => expect(close).toHaveBeenCalled())
})
