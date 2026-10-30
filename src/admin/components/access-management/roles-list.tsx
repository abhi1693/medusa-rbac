import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  EllipsisHorizontal,
  PencilSquare,
  Trash,
  Eye,
  SquareTwoStack,
} from "@medusajs/icons"
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
import {
  roleRows,
  roleDetailPath,
  roleIsManaged,
  roleSourceLabel,
  roleCreatedAt,
} from "../../lib/access-presentation"
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
    initialRole?: Role
    viewOnly: boolean
  } | null>(null)
  const navigate = useNavigate()
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
          <Link
            className="text-ui-fg-base hover:text-ui-fg-interactive font-medium"
            to={roleDetailPath(row.original.id)}
          >
            {row.original.name}
          </Link>
        ),
      }),
      column.display({
        id: "source",
        header: "Managed in",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            <Badge size="2xsmall">{roleSourceLabel(row.original)}</Badge>
            {row.original.configuration_status === "removed" && (
              <Badge size="2xsmall" color="red">
                Definition missing
              </Badge>
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
        id: "members",
        header: "Accounts",
        cell: ({ row }) => row.original.actor_count ?? "—",
      }),
      column.display({
        id: "created",
        header: "Created",
        cell: ({ row }) => roleCreatedAt(row.original.created_at),
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
                onClick={() => navigate(roleDetailPath(row.original.id))}
              >
                <Eye />
                View permissions
              </DropdownMenu.Item>
              {superuser &&
                !row.original.is_superuser &&
                row.original.configuration_status !== "removed" && (
                  <DropdownMenu.Item
                    disabled={!permissions.data}
                    onClick={() =>
                      setEditor({ initialRole: row.original, viewOnly: false })
                    }
                  >
                    <SquareTwoStack />
                    Duplicate
                  </DropdownMenu.Item>
                )}
              {superuser && !roleIsManaged(row.original) && (
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
    [
      superuser,
      permissions.data,
      prompt,
      remove.isPending,
      remove.mutate,
      navigate,
    ]
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
    onRowClick: (_event, row) => navigate(roleDetailPath(row.id)),
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
          key={editor.role?.id || editor.initialRole?.id || "new"}
          role={editor.role}
          initialRole={editor.initialRole}
          permissions={permissions.data.permissions}
          open
          readOnly={editor.viewOnly || !superuser}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  )
}
