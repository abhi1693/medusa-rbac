import { useState } from "react"
import { it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PermissionPicker } from "../../src/admin/components/permission-picker"
import { editorPermissions } from "../fixtures/access"

it("selects visible groups without dropping grants outside the current search", async () => {
  const change = vi.fn()
  function Picker() {
    const [selected, setSelected] = useState(["staff.view"])
    return (
      <PermissionPicker
        permissions={editorPermissions}
        selected={selected}
        onChange={(value) => {
          setSelected(value)
          change(value)
        }}
        readOnly={false}
      />
    )
  }
  render(<Picker />)
  const user = userEvent.setup()
  await user.click(
    screen.getByRole("checkbox", { name: "Select Catalog permissions" })
  )
  expect(change).toHaveBeenLastCalledWith([
    "staff.view",
    "products.view",
    "prices.view",
  ])
  await user.click(screen.getByRole("checkbox", { name: "View products" }))
  expect(
    screen.getByRole("checkbox", { name: "Select Catalog permissions" })
  ).toHaveAttribute("data-state", "indeterminate")
  await user.type(
    screen.getByRole("searchbox", { name: "Search permissions" }),
    "prices"
  )
  await user.click(
    screen.getByRole("checkbox", { name: "Select Catalog permissions" })
  )
  expect(change).toHaveBeenLastCalledWith(["staff.view"])
  await user.clear(screen.getByRole("searchbox"))
  await user.click(screen.getByRole("checkbox", { name: "View products" }))
  expect(change).toHaveBeenLastCalledWith(["staff.view", "products.view"])
  await user.click(screen.getByRole("button", { name: "Selected (2)" }))
  expect(
    screen.queryByRole("checkbox", { name: "View prices" })
  ).not.toBeInTheDocument()
  await user.type(screen.getByRole("searchbox"), "missing")
  expect(
    screen.getByRole("heading", { name: "No matching permissions" })
  ).toBeVisible()
  await user.click(screen.getByRole("button", { name: "Reset filters" }))
  expect(screen.getByRole("checkbox", { name: "View prices" })).toBeVisible()
  expect(screen.getByRole("button", { name: "Selected (2)" })).toHaveAttribute(
    "aria-pressed",
    "false"
  )
})

it("keeps read-only permissions searchable without bulk selection or mutation", async () => {
  render(
    <PermissionPicker
      permissions={editorPermissions}
      selected={[]}
      onChange={vi.fn()}
      readOnly
    />
  )
  expect(
    screen.queryByRole("checkbox", { name: "Select Catalog permissions" })
  ).not.toBeInTheDocument()
  expect(screen.getByRole("checkbox", { name: "View products" })).toBeDisabled()
  await userEvent.click(screen.getByRole("button", { name: "Selected (0)" }))
  expect(
    screen.getByRole("heading", { name: "No matching permissions" })
  ).toBeVisible()
})
