import { useState } from "react"
import { Badge, Button, Checkbox, Heading, Input, Text } from "@medusajs/ui"
import type { PermissionEntry } from "../lib/access"

export function PermissionPicker({
  permissions,
  selected,
  onChange,
  readOnly,
}: {
  permissions: PermissionEntry[]
  selected: string[]
  onChange: (value: string[]) => void
  readOnly: boolean
}) {
  const [search, setSearch] = useState("")
  const [selectedOnly, setSelectedOnly] = useState(false)
  const visible = permissions.filter(
    (permission) =>
      `${permission.label} ${permission.group} ${permission.id}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (!selectedOnly || selected.includes(permission.id))
  )
  const groups = [...new Set(visible.map((permission) => permission.group))]
  const selectGroup = (entries: PermissionEntry[], checked: boolean) => {
    const ids = entries.map((permission) => permission.id)
    onChange(
      checked
        ? [...new Set([...selected, ...ids])]
        : selected.filter((id) => !ids.includes(id))
    )
  }
  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          aria-label="Search permissions"
          type="search"
          placeholder="Search by name, area, or identifier"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button
          type="button"
          size="small"
          variant="secondary"
          aria-pressed={selectedOnly}
          onClick={() => setSelectedOnly(!selectedOnly)}
          className="shrink-0"
        >
          Selected ({selected.length})
        </Button>
      </div>
      <Text size="small" className="text-ui-fg-subtle">
        Permissions grant access in every context. Use rules for conditional
        access or explicit denials.
      </Text>
      {!visible.length && (
        <div className="border-ui-border-base rounded-lg border px-6 py-10 text-center">
          <Heading level="h3">No matching permissions</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Try another search or show all permissions.
          </Text>
          <Button
            type="button"
            size="small"
            variant="secondary"
            className="mt-4"
            onClick={() => {
              setSearch("")
              setSelectedOnly(false)
            }}
          >
            Reset filters
          </Button>
        </div>
      )}
      {groups.map((group) => {
        const entries = visible.filter(
          (permission) => permission.group === group
        )
        const count = entries.filter((permission) =>
          selected.includes(permission.id)
        ).length
        return (
          <section
            key={group}
            className="border-ui-border-base overflow-hidden rounded-lg border"
          >
            <div className="bg-ui-bg-subtle flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-2">
                {!readOnly && (
                  <Checkbox
                    aria-label={`Select ${group} permissions`}
                    checked={
                      count === entries.length
                        ? true
                        : count
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={(checked) =>
                      selectGroup(entries, checked === true)
                    }
                  />
                )}
                <Heading level="h3">{group}</Heading>
              </div>
              <Badge size="2xsmall">
                {count} of {entries.length}
              </Badge>
            </div>
            <div className="divide-ui-border-base divide-y">
              {entries.map((permission) => (
                <label
                  key={permission.id}
                  className="hover:bg-ui-bg-base-hover flex cursor-pointer items-start gap-3 px-4 py-3"
                >
                  <Checkbox
                    aria-label={permission.label}
                    disabled={readOnly}
                    checked={selected.includes(permission.id)}
                    onCheckedChange={(checked) =>
                      selectGroup([permission], checked === true)
                    }
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <Text
                      as="span"
                      size="small"
                      weight="plus"
                      className="block"
                    >
                      {permission.label}
                    </Text>
                    <Text
                      as="span"
                      size="xsmall"
                      className="text-ui-fg-muted block break-all"
                    >
                      {permission.id}
                    </Text>
                  </span>
                </label>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
