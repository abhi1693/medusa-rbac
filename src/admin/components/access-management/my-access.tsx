import { useState } from "react"
import {
  Container,
  Heading,
  Text,
  createDataTableColumnHelper,
  useDataTable,
} from "@medusajs/ui"
import {
  PERMISSIONS,
  type AccessPrincipal,
} from "../../../lib/access/permissions"
import type { PermissionEntry, Role } from "../../lib/access"
import { SettingsTable } from "./settings-table"

const catalog = PERMISSIONS.map(([id, label, group]) => ({ id, label, group }))
const column = createDataTableColumnHelper<PermissionEntry>()
const columns = [
  column.accessor("group", { header: "Area" }),
  column.accessor("label", { header: "Permission" }),
]
export function MyAccess({
  access,
  roles,
  permissionCatalog = catalog,
}: {
  access: AccessPrincipal
  roles?: Pick<Role, "id" | "name">[]
  permissionCatalog?: PermissionEntry[]
}) {
  const [search, setSearch] = useState("")
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 })
  const rows = permissionCatalog.filter(
    (permission) =>
      access.permissions.includes(permission.id) &&
      `${permission.label} ${permission.group}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
  )
  const table = useDataTable({
    data: rows.slice(
      pagination.pageIndex * 25,
      (pagination.pageIndex + 1) * 25
    ),
    columns,
    getRowId: (permission) => permission.id,
    rowCount: rows.length,
    search: { state: search, onSearchChange: setSearch },
    pagination: { state: pagination, onPaginationChange: setPagination },
  })
  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h1">My access</Heading>
        </div>
        <div className="grid grid-cols-2 px-6 py-4">
          <Text size="small" weight="plus">
            Roles
          </Text>
          <Text size="small">
            {roles
              ? roles.map((role) => role.name).join(", ") || "No roles assigned"
              : "Roles unavailable"}
          </Text>
        </div>
      </Container>
      <SettingsTable
        title="Permissions"
        headingLevel="h2"
        instance={table}
        empty="No permissions assigned"
        search="Search permissions"
      />
    </div>
  )
}
