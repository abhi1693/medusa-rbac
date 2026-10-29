import { it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider, toast } from "@medusajs/ui"
import { sdk } from "../../src/admin/lib/access"
import { InvitationsList } from "../../src/admin/components/access-management/invitations-list"
import { UsersList } from "../../src/admin/components/access-management/users-list"
import { createStaff, createPrincipal, createRole } from "../fixtures/access"

let fetcher: any, response: any
beforeEach(() => {
  response = {
    invitations: [
      {
        id: "pending",
        email: "pending@example.test",
        token: "token",
        expires_at: "2099-01-01",
        roles: [{ id: "reader", name: "Reader" }],
      },
      {
        id: "expired",
        email: "expired@example.test",
        token: "old",
        expires_at: "2000-01-01",
        roles: [],
      },
    ],
    count: 26,
  }
  fetcher = vi
    .spyOn(sdk.client, "fetch")
    .mockImplementation(async (_url: any, options: any) => {
      if (_url.endsWith("/roles")) return { roles: [createRole()] }
      if (options?.method) return {}
      if (response instanceof Error) throw response
      return response
    })
  vi.spyOn(toast, "success").mockReturnValue("toast")
  vi.spyOn(toast, "error").mockReturnValue("toast")
})
function mount(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return {
    user: userEvent.setup(),
    client,
    ...render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <TooltipProvider>{element}</TooltipProvider>
        </QueryClientProvider>
      </MemoryRouter>
    ),
  }
}
async function menu(
  user: ReturnType<typeof userEvent.setup>,
  email = "pending@example.test"
) {
  await user.click(
    await screen.findByRole("button", { name: `Actions for ${email}` })
  )
}
it("renders invitations with native status, copying and paged server search", async () => {
  const { user } = mount(<InvitationsList userId="admin" />)
  expect(await screen.findByText("Pending", { exact: true })).toBeVisible()
  expect(screen.getByText("Expired", { exact: true })).toBeVisible()
  expect(screen.getByText("Reader", { exact: true })).toBeVisible()
  await user.click(screen.getByRole("button", { name: /next/i }))
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith("/admin/access/invites", {
      query: { offset: 25, limit: 25 },
    })
  )
  await user.type(screen.getByPlaceholderText("Search invitations"), "pending")
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith("/admin/access/invites", {
      query: { offset: 0, limit: 25, q: "pending" },
    })
  )
  await user.click(screen.getByRole("button", { name: "Invite user" }))
  expect(
    await screen.findByRole("heading", { name: "Invite user" })
  ).toBeVisible()
  await user.click(screen.getByRole("button", { name: "Cancel" }))
  expect(
    screen.queryByRole("heading", { name: "Invite user" })
  ).not.toBeInTheDocument()
})
it("renews and revokes invitations through workflows and handles cancellation and failures", async () => {
  const resend = vi
    .spyOn(sdk.admin.invite, "resend")
    .mockResolvedValue({} as any)
  const { user } = mount(<InvitationsList userId="admin" />)
  await menu(user)
  await user.click(screen.getByRole("menuitem", { name: "Renew invitation" }))
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Invitation renewed")
  )
  resend.mockRejectedValueOnce(new Error("Renew failed"))
  await menu(user)
  await user.click(screen.getByRole("menuitem", { name: "Renew invitation" }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Renew failed"))
  await menu(user)
  await user.click(screen.getByRole("menuitem", { name: "Revoke" }))
  await user.click(screen.getByRole("button", { name: "Cancel" }))
  expect(
    fetcher.mock.calls.some(
      ([, options]: any[]) => options?.method === "DELETE"
    )
  ).toBe(false)
  await menu(user)
  await user.click(screen.getByRole("menuitem", { name: "Revoke" }))
  await user.click(screen.getByRole("button", { name: "Revoke" }))
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Invitation revoked")
  )
  fetcher.mockImplementation(async (_url: any, options: any) => {
    if (options?.method) throw new Error("Revoke failed")
    return response
  })
  await menu(user)
  await user.click(screen.getByRole("menuitem", { name: "Revoke" }))
  await user.click(screen.getByRole("button", { name: "Revoke" }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Revoke failed"))
})
it("shows invitation loading failures without a false empty state", async () => {
  response = new Error("Unavailable")
  mount(<InvitationsList userId="admin" />)
  expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable")
})
it("offers safe user deletion, omits self-deletion and preserves failures", async () => {
  response = {
    staff: [
      createStaff(),
      createStaff({ id: "admin", email: "admin@example.test" }),
    ],
    count: 2,
  }
  const { user } = mount(<UsersList userId="admin" superuser />)
  expect(
    await screen.findByRole("link", { name: "admin@example.test" })
  ).toBeVisible()
  expect(
    screen.queryByRole("button", { name: "Actions for admin@example.test" })
  ).not.toBeInTheDocument()
  await menu(user, "staff@example.test")
  await user.click(screen.getByRole("menuitem", { name: "Delete" }))
  await user.click(screen.getByRole("button", { name: "Cancel" }))
  await menu(user, "staff@example.test")
  await user.click(screen.getByRole("menuitem", { name: "Delete" }))
  await user.click(screen.getByRole("button", { name: "Delete" }))
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("User deleted")
  )
  fetcher.mockImplementation(async (_url: any, options: any) => {
    if (_url.endsWith("/roles")) return { roles: [createRole()] }
    if (options?.method) throw new Error("Last Superuser")
    return response
  })
  await menu(user, "staff@example.test")
  await user.click(screen.getByRole("menuitem", { name: "Delete" }))
  await user.click(screen.getByRole("button", { name: "Delete" }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Last Superuser")
  )
  await user.click(screen.getByRole("button", { name: "Invite user" }))
  expect(
    await screen.findByRole("heading", { name: "Invite user" })
  ).toBeVisible()
  await user.click(screen.getByRole("button", { name: "Cancel" }))
})
