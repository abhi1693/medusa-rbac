import { it, expect, vi, beforeEach } from "vitest"
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  MemoryRouter,
  createMemoryRouter,
  RouterProvider,
} from "react-router-dom"
import { TooltipProvider, toast } from "@medusajs/ui"
import { sdk, accessApi, accessFingerprint } from "../../src/admin/lib/access"
import {
  InvitationEditor,
  invitationLink,
} from "../../src/admin/components/invitation-editor"
import InvitationWidget, {
  InvitationAcceptance,
  acceptInvitationAccount,
} from "../../src/admin/widgets/invitation-acceptance"
import CurrentAccess from "../../src/admin/widgets/current-access"
import { createPrincipal, createRole } from "../fixtures/access"

let fetcher: any
beforeEach(() => {
  fetcher = vi
    .spyOn(sdk.client, "fetch")
    .mockImplementation(async (url: any, options: any) => {
      if (url === "/access/invites/preview")
        return {
          invite: {
            email: "join@example.test",
            roles: [{ id: "reader", name: "Reader" }],
          },
        }
      if (url === "/admin/access/roles") return { roles: [createRole()] }
      if (options?.method) return { invite: { token: "a+b?c" } }
      return { access: createPrincipal() }
    })
  vi.spyOn(toast, "error").mockReturnValue("toast")
  vi.spyOn(toast, "success").mockReturnValue("toast")
})
function mount(element: React.ReactNode, path = "/app/login") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const router = createMemoryRouter([{ path: "*", element }], {
    initialEntries: [path],
  })
  return {
    client,
    router,
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    ),
  }
}
it("uses native registration, safely retries an existing unregistered identity, and forwards the bearer token", async () => {
  const input = {
    token: "invite",
    email: "join@example.test",
    first_name: "Test",
    last_name: "Staff",
    password: "test-password",
  }
  const register = vi.spyOn(sdk.auth, "register").mockResolvedValue("new-token")
  const login = vi.spyOn(sdk.auth, "login").mockResolvedValue("retry-token")
  await acceptInvitationAccount(input)
  expect(fetcher).toHaveBeenLastCalledWith("/access/invites/accept", {
    method: "POST",
    query: { token: "invite" },
    body: { email: input.email, first_name: "Test", last_name: "Staff" },
    headers: { Authorization: "Bearer new-token" },
  })
  register.mockRejectedValueOnce(
    Object.assign(new Error("Identity with email already exists"), {
      status: 401,
    })
  )
  await acceptInvitationAccount(input)
  expect(login).toHaveBeenCalledWith("user", "emailpass", {
    email: input.email,
    password: input.password,
  })
  register.mockRejectedValueOnce(new Error("Unavailable"))
  await expect(acceptInvitationAccount(input)).rejects.toThrow("Unavailable")
  register.mockRejectedValueOnce(
    Object.assign(new Error("Bad credentials"), { status: 401 })
  )
  await expect(acceptInvitationAccount(input)).rejects.toThrow(
    "Bad credentials"
  )
  register.mockResolvedValueOnce({ location: "/verify" } as any)
  await expect(acceptInvitationAccount(input)).rejects.toThrow("verification")
})
it("creates a role-bound invitation and shows a basename-aware private link", async () => {
  const close = vi.fn()
  const { user } = mount(<InvitationEditor onClose={close} />)
  expect(
    screen.getByRole("button", { name: "Create invitation" })
  ).toBeDisabled()
  await user.type(screen.getByLabelText("Email"), "join@example.test")
  await user.click(await screen.findByRole("checkbox", { name: "Reader" }))
  await user.click(screen.getByRole("button", { name: "Create invitation" }))
  expect(await screen.findByLabelText("Invitation link")).toHaveValue(
    "http://localhost:3000/login?rbac_invite=a%2Bb%3Fc"
  )
  expect(fetcher).toHaveBeenCalledWith("/admin/access/invites", {
    method: "POST",
    body: { email: "join@example.test", role_ids: ["reader"] },
  })
  await user.click(screen.getByRole("button", { name: "Done" }))
  expect(close).toHaveBeenCalled()
  expect(invitationLink("/custom-admin/login", "token")).toContain(
    "/custom-admin/login?rbac_invite=token"
  )
})
it("keeps failed invitations editable and supports keyboard dismissal", async () => {
  const close = vi.fn()
  const { user } = mount(<InvitationEditor onClose={close} />)
  await user.type(screen.getByLabelText("Email"), "join@example.test")
  await user.click(await screen.findByRole("checkbox", { name: "Reader" }))
  fetcher.mockRejectedValueOnce(new Error("Conflict"))
  await user.click(screen.getByRole("button", { name: "Create invitation" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Conflict")
  await user.keyboard("{Escape}")
  expect(close).toHaveBeenCalled()
})
it("previews assigned roles, validates matching passwords and accepts an invitation", async () => {
  vi.spyOn(sdk.auth, "register").mockResolvedValue("token")
  const close = vi.fn()
  const { user } = mount(
    <InvitationAcceptance token="invite" onClose={close} />
  )
  expect(screen.getByText("Loading invitation…")).toBeVisible()
  expect(await screen.findByLabelText("Email")).toHaveValue("join@example.test")
  await user.type(screen.getByLabelText("First name"), "Join")
  await user.type(screen.getByLabelText("Last name"), "Team")
  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    "password"
  )
  await user.type(screen.getByLabelText("Confirm password"), "mismatch")
  await user.click(screen.getByRole("button", { name: "Create account" }))
  expect(screen.getByText("Passwords must match.")).toBeVisible()
  await user.clear(screen.getByLabelText("Confirm password"))
  await user.type(screen.getByLabelText("Confirm password"), "password")
  await user.click(screen.getByRole("button", { name: "Create account" }))
  expect(await screen.findByText("Your account is ready")).toBeVisible()
  await user.click(screen.getByRole("button", { name: "Continue to sign in" }))
  expect(close).toHaveBeenCalled()
})
it("shows expired preview errors and role-free invitations, and preserves a failed form", async () => {
  fetcher.mockRejectedValueOnce(new Error("Expired invitation"))
  const first = mount(
    <InvitationAcceptance token="expired" onClose={vi.fn()} />
  )
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Expired invitation"
  )
  await first.user.keyboard("{Escape}")
  first.unmount()
  fetcher.mockResolvedValueOnce({
    invite: { email: "join@example.test", roles: [] },
  })
  vi.spyOn(sdk.auth, "register").mockRejectedValue(
    new Error("Account unavailable")
  )
  const { user } = mount(
    <InvitationAcceptance token="role-free" onClose={vi.fn()} />
  )
  await screen.findByLabelText("Email")
  expect(screen.getByText(/assign your roles after registration/)).toBeVisible()
  await user.type(screen.getByLabelText("First name"), "Join")
  await user.type(screen.getByLabelText("Last name"), "Team")
  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    "password"
  )
  await user.type(screen.getByLabelText("Confirm password"), "password")
  await user.click(screen.getByRole("button", { name: "Create account" }))
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Account unavailable"
  )
})
it("opens invitations only from the supported login widget query", async () => {
  const view = mount(<InvitationWidget />, "/login")
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  await act(() => view.router.navigate("/login?rbac_invite=token"))
  expect(await screen.findByRole("dialog")).toBeVisible()
  await view.user.click(screen.getByRole("button", { name: "Cancel" }))
  await waitFor(() =>
    expect(view.router.state.location.pathname).toBe("/login")
  )
  expect(view.router.state.location.search).toBe("")
})
it("revalidates native routes when access changes and retains a direct My access link", async () => {
  const view = mount(<CurrentAccess />)
  expect(
    await screen.findByRole("link", { name: "My access" })
  ).toHaveAttribute("href", "/settings/access-management?view=my-access")
  const invalidated = vi.spyOn(view.client, "invalidateQueries")
  view.client.setQueryData(["native-orders"], [])
  await act(async () => {
    view.client.setQueryData(["medusa-rbac", "me"], {
      access: createPrincipal({ permissions: [] }),
    })
  })
  await waitFor(() => expect(invalidated).toHaveBeenCalled())
  expect(accessFingerprint(createPrincipal())).toContain('"user"')
  expect(accessFingerprint(createPrincipal({ rules: [] }))).toContain("[]")
})
it("keeps the topbar empty while identity access is loading", () => {
  fetcher.mockImplementation(() => new Promise(() => {}))
  const view = mount(<CurrentAccess />)
  expect(view.container).toBeEmptyDOMElement()
})
it("supports paged invitations and guarded user APIs through the configured SDK", async () => {
  await accessApi.invitations(0)
  await accessApi.invitations(25, "join")
  await accessApi.deleteInvitation("invite")
  await accessApi.deleteUser("user")
  vi.spyOn(sdk.admin.invite, "resend").mockResolvedValue({} as any)
  await accessApi.resendInvitation("invite")
  expect(fetcher).toHaveBeenCalledWith("/admin/access/invites", {
    query: { offset: 25, limit: 25, q: "join" },
  })
  expect(fetcher).toHaveBeenCalledWith("/admin/access/staff/user", {
    method: "DELETE",
  })
})

it("prevents dismissing an invitation creation while its request is pending", async () => {
  const close = vi.fn()
  const view = mount(<InvitationEditor onClose={close} />)
  await view.user.type(screen.getByLabelText("Email"), "join@example.test")
  await view.user.click(await screen.findByRole("checkbox", { name: "Reader" }))
  let resolve!: (value: any) => void
  fetcher.mockImplementation((_url: string, options: any) => {
    if (!options?.method) return Promise.resolve({ roles: [createRole()] })
    return new Promise((done) => {
      resolve = done
    })
  })
  await view.user.click(
    screen.getByRole("button", { name: "Create invitation" })
  )
  await view.user.keyboard("{Escape}")
  expect(close).not.toHaveBeenCalled()
  await act(async () => {
    resolve({ invite: { token: "token" } })
  })
  expect(
    await screen.findByLabelText("Invitation link", { exact: true })
  ).toBeVisible()
})
it("preserves the acceptance dialog during registration", async () => {
  const close = vi.fn()
  let resolve!: (value: any) => void
  vi.spyOn(sdk.auth, "register").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const { user } = mount(<InvitationAcceptance token="token" onClose={close} />)
  await screen.findByLabelText("Email")
  await user.type(screen.getByLabelText("First name"), "Test")
  await user.type(screen.getByLabelText("Last name"), "User")
  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    "password"
  )
  await user.type(screen.getByLabelText("Confirm password"), "password")
  await user.click(screen.getByRole("button", { name: "Create account" }))
  await user.keyboard("{Escape}")
  expect(close).not.toHaveBeenCalled()
  await act(async () => {
    resolve("token")
  })
  expect(await screen.findByText("Your account is ready")).toBeVisible()
})
it("does not send an actor back to a previous page when navigation races an access refresh", async () => {
  const view = mount(<CurrentAccess />)
  await screen.findByRole("link", { name: "My access" })
  let resolve!: () => void
  const pending = new Promise<void>((done) => {
    resolve = done
  })
  const refetch = vi
    .spyOn(view.client, "refetchQueries")
    .mockImplementation((filters) =>
      filters?.type === "all" ? pending : Promise.resolve()
    )
  await act(async () => {
    view.client.setQueryData(["medusa-rbac", "me"], {
      access: createPrincipal({ permissions: [] }),
    })
  })
  await waitFor(() =>
    expect(refetch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "all" }),
      { cancelRefetch: false }
    )
  )
  await act(() => view.router.navigate("/different"))
  await act(async () => {
    resolve()
  })
  expect(view.router.state.location.pathname).toBe("/different")
})
