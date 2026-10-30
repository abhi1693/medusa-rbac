import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Badge,
  Button,
  Text,
  createDataTableColumnHelper,
  useDataTable,
} from "@medusajs/ui"
import { accessApi, type PermissionEntry } from "../../lib/access"
import { SettingsTable } from "./settings-table"
import { PermissionChecker } from "./permission-checker"

const column = createDataTableColumnHelper<PermissionEntry>()

export function PermissionCatalog({
  userId,
  superuser,
}: {
  userId: string
  superuser: boolean
}) {
  const [search, setSearch] = useState("")
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 })
  const [selected, setSelected] = useState<PermissionEntry | null>(null)
  const catalog = useQuery({
    queryKey: ["medusa-rbac", userId, "permissions"],
    queryFn: accessApi.permissions,
    retry: false,
  })
  const columns = useMemo(
    () => [
      column.accessor("label", {
        header: "Permission",
        cell: ({ row }) => (
          <div>
            <Text size="small" weight="plus">
              {row.original.label}
            </Text>
            <Text size="small" className="text-ui-fg-subtle font-mono">
              {row.original.id}
            </Text>
          </div>
        ),
      }),
      column.accessor("group", {
        header: "Group",
        cell: ({ getValue }) => <Badge size="2xsmall">{getValue()}</Badge>,
      }),
      ...(superuser
        ? [
            column.display({
              id: "check",
              header: "",
              cell: ({ row }) => (
                <Button
                  variant="transparent"
                  size="small"
                  aria-label={`Check ${row.original.id}`}
                  onClick={() => setSelected(row.original)}
                >
                  Check access
                </Button>
              ),
            }),
          ]
        : []),
    ],
    [superuser]
  )
  const rows = (catalog.data?.permissions || []).filter((permission) =>
    `${permission.id} ${permission.label} ${permission.group}`
      .toLowerCase()
      .includes(search.trim().toLowerCase())
  )
  const table = useDataTable({
    data: rows.slice(
      pagination.pageIndex * pagination.pageSize,
      (pagination.pageIndex + 1) * pagination.pageSize
    ),
    columns,
    getRowId: (permission) => permission.id,
    rowCount: rows.length,
    isLoading: catalog.isPending,
    search: {
      state: search,
      onSearchChange: (value) => {
        setSearch(value)
        setPagination((current) => ({ ...current, pageIndex: 0 }))
      },
    },
    pagination: { state: pagination, onPaginationChange: setPagination },
  })
  return (
    <div className="flex flex-col gap-y-3">
      <Text className="text-ui-fg-subtle">
        Permissions are registered by the plugin and your application. Use their
        identifiers in role definitions, rules and server checks.
      </Text>
      <SettingsTable
        title="Permission catalog"
        instance={table}
        search="Search permissions"
        error={catalog.error}
        empty="No permissions registered"
      />
      {selected && (
        <PermissionChecker
          permission={selected}
          actorTypes={catalog.data?.actor_types || ["user", "customer"]}
          userId={userId}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
