import { useState } from "react"
import { beforeEach, expect, it, vi } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ActorPicker } from "../../src/admin/components/access-management/actor-picker"
import { sdk, accessApi } from "../../src/admin/lib/access"

type Actor = { id: string; label: string; description?: string }
let fetcher: any
let accounts: Record<string, Actor[] | Error>
beforeEach(() => {
  accounts = {
    user: [
      {
        id: "self",
        label: "Current user",
        description: "current@example.test",
      },
      { id: "other", label: "Other staff", description: "other@example.test" },
    ],
    customer: [
      { id: "cus_1", label: "Buyer", description: "buyer@example.test" },
    ],
    vendor: [{ id: "vendor_1", label: "Supplier" }],
  }
  fetcher = vi
    .spyOn(sdk.client, "fetch")
    .mockImplementation(async (url: any, options: any) => {
      const type = String(url).split("/").at(-1)!
      const query = options.query
      const rows = accounts[type]
      if (rows instanceof Error) throw rows
      const filtered = rows.filter(
        (actor) =>
          (!query.id || actor.id === query.id) &&
          (!query.q ||
            `${actor.label} ${actor.description || ""}`
              .toLowerCase()
              .includes(String(query.q).toLowerCase()))
      )
      return {
        actors: filtered.slice(
          query.offset || 0,
          (query.offset || 0) + query.limit
        ),
        count: filtered.length,
        offset: query.offset || 0,
        limit: query.limit,
      }
    })
})
function mount({
  initialId = "self",
  actorType = "user",
}: { initialId?: string; actorType?: string } = {}) {
  const changed = vi.fn()
  function Field() {
    const [value, setValue] = useState("")
    const [type, setType] = useState(actorType)
    const [initial, setInitial] = useState(initialId)
    const [searching, setSearching] = useState(false)
    return (
      <>
        <ActorPicker
          key={type}
          actorType={type}
          userId="viewer"
          initialId={initial}
          value={value}
          onChange={(id) => {
            setValue(id)
            setSearching(false)
            changed(id)
          }}
          onSearchingChange={setSearching}
        />
        <span data-testid="searching">{String(searching)}</span>
        <output data-testid="selected">{value}</output>
        <button
          onClick={() => {
            setType("customer")
            setInitial("")
            setValue("")
          }}
        >
          Choose customers
        </button>
      </>
    )
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return {
    ...render(
      <QueryClientProvider client={client}>
        <Field />
      </QueryClientProvider>
    ),
    changed,
    user: userEvent.setup(),
  }
}

it("hydrates the current account and searches names/emails before keyboard selection", async () => {
  const { user } = mount()
  await waitFor(() =>
    expect(screen.getByTestId("selected")).toHaveTextContent("self")
  )
  expect(
    screen.getAllByText("Current user · current@example.test")[0]
  ).toBeVisible()
  const input = screen.getByRole("combobox", { name: "Account" })
  await user.click(input)
  await user.paste("other@example.test")
  expect(screen.getByTestId("searching")).toHaveTextContent("true")
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith("/admin/access/actors/user", {
      query: { q: "other@example.test", limit: 25, offset: 0 },
    })
  )
  const option = await screen.findByRole("option", {
    name: "Other staff · other@example.test",
  })
  await user.click(input)
  await user.keyboard("{ArrowDown}")
  await waitFor(() =>
    expect(input).toHaveAttribute("aria-activedescendant", option.id)
  )
  await user.keyboard("{Enter}")
  await waitFor(() =>
    expect(screen.getByTestId("selected")).toHaveTextContent("other")
  )
  expect(fetcher).toHaveBeenCalledWith("/admin/access/actors/user", {
    query: { q: "other@example.test", limit: 25, offset: 0 },
  })
  expect(
    screen.queryByRole("textbox", { name: "Actor ID" })
  ).not.toBeInTheDocument()
})

it("does not append an opaque identity to an email-only account", async () => {
  accounts.user = [
    { id: "self", label: "current@example.test", description: "self" },
  ]
  mount()
  await waitFor(() =>
    expect(screen.getByTestId("selected")).toHaveTextContent("self")
  )
  expect(screen.getAllByText("current@example.test")[0]).toBeVisible()
  expect(
    screen.queryByText("current@example.test · self")
  ).not.toBeInTheDocument()
})

it("shows loading and waits for an actual account before selecting the default", async () => {
  let ready!: (value: unknown) => void
  const pending = new Promise((resolve) => {
    ready = resolve
  })
  fetcher.mockImplementation(() => pending)
  mount()
  expect(screen.getByText("Loading accounts…")).toBeVisible()
  expect(screen.getByRole("combobox", { name: "Account" })).toBeDisabled()
  expect(screen.getByTestId("selected")).toBeEmptyDOMElement()
  await act(async () =>
    ready({
      actors: [{ id: "self", label: "Current user" }],
      count: 1,
      limit: 25,
      offset: 0,
    })
  )
  await waitFor(() =>
    expect(screen.getByTestId("selected")).toHaveTextContent("self")
  )
})

it("handles empty types without a free-form identity fallback", async () => {
  accounts.user = []
  mount()
  expect(
    await screen.findByText("No accounts are available for this account type.")
  ).toBeVisible()
  expect(screen.getByRole("combobox", { name: "Account" })).toBeDisabled()
  expect(screen.getByTestId("selected")).toBeEmptyDOMElement()
})

it("reports unavailable custom actor lists and retries through the provider", async () => {
  accounts.vendor = new Error(
    "This account type does not provide searchable accounts"
  )
  const { user } = mount({ actorType: "vendor", initialId: "" })
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "does not provide searchable accounts"
  )
  expect(screen.getByRole("combobox", { name: "Account" })).toBeDisabled()
  accounts.vendor = [{ id: "vendor_1", label: "Supplier" }]
  await user.click(screen.getByRole("button", { name: "Retry accounts" }))
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Account" })).toBeEnabled()
  )
  await user.click(screen.getByRole("combobox", { name: "Account" }))
  await user.click(await screen.findByRole("option", { name: "Supplier" }))
  expect(screen.getByTestId("selected")).toHaveTextContent("vendor_1")
})

it("isolates account types even when the previous type resolves after switching", async () => {
  let ready!: (value: unknown) => void
  const pending = new Promise((resolve) => {
    ready = resolve
  })
  const original = fetcher.getMockImplementation()
  fetcher.mockImplementation((url: string, options: unknown) =>
    url.endsWith("/user") ? pending : original(url, options)
  )
  const { user } = mount()
  await user.click(screen.getByRole("button", { name: "Choose customers" }))
  const input = screen.getByRole("combobox", { name: "Account" })
  await waitFor(() => expect(input).toBeEnabled())
  await user.click(input)
  await user.click(
    await screen.findByRole("option", { name: "Buyer · buyer@example.test" })
  )
  await act(async () =>
    ready({
      actors: [{ id: "self", label: "Current user" }],
      count: 1,
      offset: 0,
      limit: 25,
    })
  )
  expect(screen.getByTestId("selected")).toHaveTextContent("cus_1")
  expect(screen.queryByText("Current user")).not.toBeInTheDocument()
  expect(
    fetcher.mock.calls.filter(([url]: [string]) => url.endsWith("/customer"))
      .length
  ).toBeGreaterThan(0)
})

it("loads the next provider page when the native combobox sentinel is visible", async () => {
  const observed: {
    target: Element
    callback: IntersectionObserverCallback
  }[] = []
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        observed.push({ target, callback: this.callback })
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver
  )
  accounts.user = Array.from({ length: 26 }, (_, i) => ({
    id: `user_${i}`,
    label: `Staff ${i}`,
  }))
  const { user, unmount } = mount({ initialId: "" })
  try {
    const input = screen.getByRole("combobox", { name: "Account" })
    await waitFor(() => expect(input).toBeEnabled())
    await user.click(input)
    await screen.findByRole("option", { name: "Staff 24" })
    expect(observed.length).toBeGreaterThan(0)
    await act(async () => {
      ;[...observed].forEach(({ target, callback }) =>
        callback(
          [
            {
              isIntersecting: true,
              intersectionRatio: 1,
              target,
            } as IntersectionObserverEntry,
          ],
          {} as IntersectionObserver
        )
      )
    })
    expect(
      await screen.findByRole("option", { name: "Staff 25" })
    ).toBeVisible()
    expect(fetcher).toHaveBeenCalledWith("/admin/access/actors/user", {
      query: { q: undefined, limit: 25, offset: 25 },
    })
  } finally {
    unmount()
    vi.unstubAllGlobals()
  }
})

it("uses the actor-specific public endpoint with default and explicit paging arguments", async () => {
  await accessApi.actors("user")
  expect(fetcher).toHaveBeenCalledWith("/admin/access/actors/user", {
    query: {},
  })
  await accessApi.actors("user", { q: "current", offset: 0, limit: 25 })
  expect(fetcher).toHaveBeenCalledWith("/admin/access/actors/user", {
    query: { q: "current", offset: 0, limit: 25 },
  })
})

it("keeps server-side matches when the provider searches fields beyond the display label", async () => {
  fetcher.mockImplementation(async (_url: string, options: any) => ({
    actors: [{ id: "vendor_1", label: "Acme supplier" }],
    count: 1,
    offset: options.query.offset || 0,
    limit: options.query.limit,
  }))
  const { user } = mount({ actorType: "vendor", initialId: "" })
  const input = screen.getByRole("combobox", { name: "Account" })
  await waitFor(() => expect(input).toBeEnabled())
  await user.click(input)
  await user.paste("internal-account-number")
  await user.click(await screen.findByRole("option", { name: "Acme supplier" }))
  expect(screen.getByTestId("selected")).toHaveTextContent("vendor_1")
})

it("clears the selected account through an accessible action without restoring the default", async () => {
  const { user } = mount()
  const clear = screen.getByRole("button", { name: "Clear account" })
  await waitFor(() => expect(clear).toBeEnabled())
  await user.click(clear)
  expect(screen.getByTestId("selected")).toBeEmptyDOMElement()
  expect(clear).toBeDisabled()
  await user.click(screen.getByRole("combobox", { name: "Account" }))
  expect(screen.getByTestId("selected")).toBeEmptyDOMElement()
})
