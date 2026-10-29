import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { EllipsisHorizontal, PencilSquare, Trash, Eye } from "@medusajs/icons"
import {
  Badge,
  Button,
  DropdownMenu,
  IconButton,
  createDataTableColumnHelper,
  useDataTable,
  toast,
  usePrompt,
  type DataTableSortingState,
} from "@medusajs/ui"
import {
  accessApi,
  errorMessage,
  useRefreshAccess,
  type Role,
} from "../../lib/access"
import { roleRows } from "../../lib/access-presentation"
import { RoleEditor } from "../role-editor"
import { SettingsTable } from "./settings-table"

const column = createDataTableColumnHelper<Role>()
export function RolesList({
  userId,
  superuser,
}: {
  userId: string
  superuser: boolean
}) {
  const [editor, setEditor] = useState<{
    role?: Role
    viewOnly: boolean
  } | null>(null)
  const [search, setSearch] = useState("")
  const [sorting, setSorting] = useState<DataTableSortingState | null>(null)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 })
  const roles = useQuery({
    queryKey: ["medusa-rbac", userId, "roles"],
    queryFn: accessApi.roles,
    retry: false,
  })
  const permissions = useQuery({
    queryKey: ["medusa-rbac", userId, "permissions"],
    queryFn: accessApi.permissions,
    retry: false,
  })
  const refresh = useRefreshAccess()
  const prompt = usePrompt()
  const remove = useMutation({
    mutationFn: accessApi.deleteRole,
    onSuccess: async () => {
      await refresh()
      toast.success("Role deleted")
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const columns = useMemo(
    () => [
      column.accessor("name", {
        header: "Role",
        enableSorting: true,
        cell: ({ row }) => (
          <div className="flex items-center gap-x-2">
            {row.original.name}
            {row.original.is_superuser && (
              <Badge size="2xsmall">System role</Badge>
            )}
          </div>
        ),
      }),
      column.accessor("permissions", {
        header: "Permissions",
        enableSorting: true,
        cell: ({ getValue }) => getValue().length,
      }),
      column.display({
        id: "rules",
        header: "Rules",
        cell: ({ row }) => row.original.rules?.length || 0,
      }),
      column.display({
        ...column.action({ actions: [] }),
        header: "",
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenu.Trigger asChild>
              <IconButton
                size="small"
                variant="transparent"
                className="ml-1"
                aria-label={`Actions for ${row.original.name}`}
                onClick={(event) => event.stopPropagation()}
              >
                <EllipsisHorizontal />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              align="end"
              onClick={(event) => event.stopPropagation()}
            >
              <DropdownMenu.Item
                disabled={!permissions.data}
                onClick={() =>
                  setEditor({ role: row.original, viewOnly: true })
                }
              >
                <Eye />
                View permissions
              </DropdownMenu.Item>
              {superuser && !row.original.is_superuser && (
                <>
                  <DropdownMenu.Item
                    disabled={!permissions.data}
                    onClick={() =>
                      setEditor({ role: row.original, viewOnly: false })
                    }
                  >
                    <PencilSquare />
                    Edit
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    className="text-ui-fg-error"
                    disabled={remove.isPending}
                    onClick={async () => {
                      if (
                        await prompt({
                          title: "Delete role?",
                          description: `Delete ${row.original.name}? Remove it from users and pending invitations first.`,
                          confirmText: "Delete",
                          cancelText: "Cancel",
                        })
                      )
                        remove.mutate(row.original)
                    }}
                  >
                    <Trash />
                    Delete
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu>
        ),
      }),
    ],
    [superuser, permissions.data, prompt, remove.isPending, remove.mutate]
  )
  const rows = roleRows(roles.data?.roles || [], search, sorting)
  const table = useDataTable({
    data: rows.slice(
      pagination.pageIndex * 25,
      (pagination.pageIndex + 1) * 25
    ),
    columns,
    getRowId: (role) => role.id,
    rowCount: rows.length,
    isLoading: roles.isPending,
    search: { state: search, onSearchChange: setSearch },
    sorting: { state: sorting, onSortingChange: setSorting },
    pagination: { state: pagination, onPaginationChange: setPagination },
    onRowClick: (_event, row) => {
      const role = rows.find((item) => item.id === row.id)
      if (role && permissions.data) setEditor({ role, viewOnly: true })
    },
  })
  return (
    <>
      <SettingsTable
        title="Roles"
        instance={table}
        empty="No roles yet"
        search="Search roles"
        sorting
        error={roles.error || permissions.error}
        action={
          superuser && (
            <Button
              size="small"
              disabled={!permissions.data}
              onClick={() => setEditor({ viewOnly: false })}
            >
              Create role
            </Button>
          )
        }
      />
      {editor && permissions.data && (
        <RoleEditor
          key={editor.role?.id || "new"}
          role={editor.role}
          permissions={permissions.data.permissions}
          open
          readOnly={editor.viewOnly || !superuser}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  )
}
