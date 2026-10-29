import { TooltipProvider } from "@medusajs/ui"
import { useState } from "react"
import { it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  PermissionRules,
  ruleDrafts,
  parseRuleDrafts,
} from "../../src/admin/components/permission-rules"
import { MyAccess } from "../../src/admin/components/access-management/my-access"
import { createPrincipal } from "../fixtures/access"

it("edits, previews and removes scoped permission rules", async () => {
  const user = userEvent.setup()
  const changed = vi.fn()
  function Editor() {
    const [rules, setRules] = useState(
      ruleDrafts([{ permission: "orders.view", effect: "allow", priority: 2 }])
    )
    return (
      <PermissionRules
        value={rules}
        onChange={(next) => {
          changed(next)
          setRules(next)
        }}
        readOnly={false}
      />
    )
  }
  render(<Editor />)
  fireEvent.change(screen.getByLabelText("Permission or namespace"), {
    target: { value: "orders.*" },
  })
  fireEvent.change(screen.getByLabelText("Priority"), {
    target: { value: "5" },
  })
  fireEvent.change(screen.getByLabelText("Context conditions"), {
    target: { value: '{"region_id":"north"}' },
  })
  await user.click(screen.getByRole("combobox"))
  await user.click(screen.getByRole("option", { name: "Deny" }))
  expect(parseRuleDrafts(changed.mock.calls.at(-1)![0])).toEqual([
    {
      permission: "orders.*",
      effect: "deny",
      priority: 5,
      conditions: { region_id: "north" },
    },
  ])
  await user.click(screen.getByRole("button", { name: "Add rule" }))
  expect(screen.getAllByText("Permission or namespace")).toHaveLength(2)
  fireEvent.change(screen.getAllByLabelText("Permission or namespace")[0], {
    target: { value: "orders.view" },
  })
  await user.click(screen.getAllByRole("button", { name: "Remove rule" })[0])
  expect(screen.getAllByText("Permission or namespace")).toHaveLength(1)
  const drafts = ruleDrafts([
    {
      permission: "orders.view",
      effect: "allow",
      conditions: { actor_id: "user" },
    },
  ])
  expect(drafts[0].priority).toBe(0)
  expect(() =>
    parseRuleDrafts([{ ...drafts[0], conditions: "invalid" }])
  ).toThrow()
})

it("shows configured rules and custom permission labels in personal access", () => {
  const { unmount } = render(
    <PermissionRules
      value={ruleDrafts([{ permission: "documents.*", effect: "deny" }])}
      onChange={vi.fn()}
      readOnly
    />
  )
  expect(screen.getByLabelText("Permission or namespace")).toBeDisabled()
  expect(
    screen.queryByRole("button", { name: "Add rule" })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "Remove rule" })
  ).not.toBeInTheDocument()
  unmount()
  render(
    <TooltipProvider>
      <MyAccess
        access={createPrincipal({ permissions: ["documents.read"] })}
        permissionCatalog={[
          { id: "documents.read", label: "Read documents", group: "Documents" },
        ]}
      />
    </TooltipProvider>
  )
  expect(screen.getByText("Read documents")).toBeInTheDocument()
})
