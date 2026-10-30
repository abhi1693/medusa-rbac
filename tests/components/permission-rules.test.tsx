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
import { createPrincipal, editorPermissions } from "../fixtures/access"

it("preserves typed scalars and alternatives and validates empty fields", () => {
  const rules = [
    {
      permission: "orders.*",
      effect: "allow" as const,
      conditions: {
        region: ["north", "south"],
        flag: true,
        missing: null,
        total: 42,
        flags: [false, 2, null],
      },
    },
  ]
  expect(parseRuleDrafts(ruleDrafts(rules))).toEqual([
    { ...rules[0], priority: 0 },
  ])
  const draft = ruleDrafts(rules)[0]
  expect(() => parseRuleDrafts([{ ...draft, permission: " " }])).toThrow(
    "permission"
  )
  expect(() =>
    parseRuleDrafts([
      {
        ...draft,
        conditions: [
          { key: " ", any: false, values: [{ type: "string", value: "" }] },
        ],
      },
    ])
  ).toThrow("unique")
  expect(() =>
    parseRuleDrafts([
      { ...draft, conditions: [draft.conditions[0], draft.conditions[0]] },
    ])
  ).toThrow("unique")
  for (const value of ["", "NaN"])
    expect(() =>
      parseRuleDrafts([
        {
          ...draft,
          conditions: [
            { key: "total", any: false, values: [{ type: "number", value }] },
          ],
        },
      ])
    ).toThrow("number")
})

it("edits scoped rules with typed conditions without raw JSON", async () => {
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
        permissions={editorPermissions}
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
  await user.click(screen.getByRole("combobox", { name: "Rule 1 effect" }))
  await user.click(screen.getByRole("option", { name: "Deny" }))
  await user.click(screen.getByRole("button", { name: "Add condition" }))
  await user.type(screen.getByLabelText("Context field"), "region")
  await user.type(screen.getByLabelText("Condition 1 value 1"), "north")
  expect(parseRuleDrafts(changed.mock.calls.at(-1)![0])).toEqual([
    {
      permission: "orders.*",
      effect: "deny",
      priority: 5,
      conditions: { region: "north" },
    },
  ])
  await user.click(
    screen.getByRole("button", { name: "Add alternative value" })
  )
  await user.type(screen.getByLabelText("Condition 1 value 2"), "south")
  expect(parseRuleDrafts(changed.mock.calls.at(-1)![0])[0].conditions).toEqual({
    region: ["north", "south"],
  })
  await user.click(
    screen.getByRole("combobox", { name: "Rule 1 condition 1 value 1 type" })
  )
  await user.click(screen.getByRole("option", { name: "Boolean" }))
  await user.click(
    screen.getByRole("combobox", { name: "Condition 1 value 1" })
  )
  await user.click(screen.getByRole("option", { name: "False" }))
  expect(parseRuleDrafts(changed.mock.calls.at(-1)![0])[0].conditions).toEqual({
    region: [false, "south"],
  })
  await user.click(screen.getByRole("button", { name: "Remove value 2" }))
  await user.click(screen.getByRole("button", { name: "Add condition" }))
  await user.click(
    screen.getByRole("combobox", { name: "Rule 1 condition 2 value 1 type" })
  )
  await user.click(screen.getByRole("option", { name: "Number" }))
  await user.type(screen.getByLabelText("Condition 2 value 1"), "12")
  await user.click(
    screen.getByRole("combobox", { name: "Rule 1 condition 2 value 1 type" })
  )
  await user.click(screen.getByRole("option", { name: "Empty" }))
  expect(screen.getByLabelText("Condition 2 value 1")).toBeDisabled()
  await user.click(
    screen.getAllByRole("button", { name: "Remove condition" })[0]
  )
  await user.click(screen.getByRole("button", { name: "Add rule" }))
  expect(screen.getAllByText("Permission or namespace")).toHaveLength(2)
  fireEvent.change(screen.getAllByLabelText("Permission or namespace")[0], {
    target: { value: "orders.view" },
  })
  await user.click(screen.getAllByRole("button", { name: "Remove rule" })[0])
  expect(screen.getAllByText("Permission or namespace")).toHaveLength(1)
})

it("shows immutable rule previews and custom personal permission labels", () => {
  const { unmount } = render(
    <PermissionRules
      value={ruleDrafts([
        {
          permission: "documents.*",
          effect: "deny",
          conditions: { flag: false },
        },
      ])}
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
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <MyAccess
        access={createPrincipal({
          permissions: ["documents.read"],
          rules: [{ permission: "documents.*", effect: "allow" }],
        })}
        permissionCatalog={[
          { id: "documents.read", label: "Read documents", group: "Documents" },
        ]}
      />
    </TooltipProvider>
  )
  expect(screen.getByText("Read documents")).toBeInTheDocument()
})
