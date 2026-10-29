import { useMemo, useState } from "react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { Button, createDataTableColumnHelper, useDataTable } from "@medusajs/ui"
import { Link } from "react-router-dom"
import { accessApi, type Staff } from "../../lib/access"
import { SettingsTable } from "./settings-table"

const column = createDataTableColumnHelper<Staff>()
export function UsersList({
  userId,
  superuser,
}: {
  userId: string
  superuser: boolean
}) {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 })
  const [search, setSearch] = useState("")
  const users = useQuery({
    queryKey: ["medusa-rbac", userId, "staff", pagination.pageIndex, search],
    queryFn: () => accessApi.staff(pagination.pageIndex * 25, search),
    placeholderData: keepPreviousData,
    retry: false,
  })
  const columns = useMemo(
    () => [
      column.accessor("email", {
        header: "Email",
        cell: ({ row }) =>
          superuser ? (
            <Link
              className="hover:text-ui-fg-base"
              to={`/settings/users/${row.original.id}`}
            >
              {row.original.email}
            </Link>
          ) : (
            row.original.email
          ),
      }),
      column.display({
        id: "name",
        header: "Name",
        cell: ({ row }) =>
          [row.original.first_name, row.original.last_name]
            .filter(Boolean)
            .join(" ") || "—",
      }),
      column.display({
        id: "roles",
        header: "Roles",
        cell: ({ row }) =>
          row.original.roles?.length
            ? row.original.roles.map((role) => role.name).join(", ")
            : row.original.access.role_ids.length
              ? "Roles unavailable"
              : "No roles assigned",
      }),
    ],
    [superuser]
  )
  const table = useDataTable({
    data: users.data?.staff || [],
    columns,
    getRowId: (user) => user.id,
    rowCount: users.data?.count || 0,
    isLoading: users.isPending,
    pagination: { state: pagination, onPaginationChange: setPagination },
    search: { state: search, onSearchChange: setSearch },
  })
  return (
    <SettingsTable
      title="Users"
      instance={table}
      empty="No users yet"
      search="Search users"
      error={users.error}
      action={
        superuser && (
          <Button size="small" variant="secondary" asChild>
            <Link to="/settings/users">Manage users</Link>
          </Button>
        )
      }
    />
  )
}
