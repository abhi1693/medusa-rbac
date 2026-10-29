import { Checkbox, Table } from "@medusajs/ui"
import type { Role } from "../lib/access"

export function RolesTable({
  roles,
  selectedRoleIds = [],
  onSelectionChange,
}: {
  roles: Pick<Role, "id" | "name" | "permissions">[]
  selectedRoleIds?: string[]
  onSelectionChange?: (ids: string[]) => void
}) {
  return (
    <Table>
      <Table.Header>
        <Table.Row>
          {onSelectionChange && (
            <Table.HeaderCell className="w-12">
              <span className="sr-only">Select roles</span>
            </Table.HeaderCell>
          )}
          <Table.HeaderCell>Role</Table.HeaderCell>
          <Table.HeaderCell className="text-right">
            Permissions
          </Table.HeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {roles.map((role) => (
          <Table.Row key={role.id}>
            {onSelectionChange && (
              <Table.Cell>
                <Checkbox
                  aria-label={role.name}
                  checked={selectedRoleIds.includes(role.id)}
                  onCheckedChange={(checked) =>
                    onSelectionChange(
                      checked
                        ? [...selectedRoleIds, role.id]
                        : selectedRoleIds.filter((id) => id !== role.id)
                    )
                  }
                />
              </Table.Cell>
            )}
            <Table.Cell>{role.name}</Table.Cell>
            <Table.Cell className="text-right">
              {role.permissions.length}
            </Table.Cell>
          </Table.Row>
        ))}
        {!roles.length && (
          <Table.Row>
            <td
              colSpan={onSelectionChange ? 3 : 2}
              className="text-ui-fg-subtle px-6 py-8 text-center"
            >
              No roles assigned
            </td>
          </Table.Row>
        )}
      </Table.Body>
    </Table>
  )
}
