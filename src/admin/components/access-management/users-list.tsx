import { useMemo, useState } from "react"
import { useMutation, useQuery, keepPreviousData } from "@tanstack/react-query"
import {
  Button,
  DropdownMenu,
  IconButton,
  toast,
  usePrompt,
  createDataTableColumnHelper,
  useDataTable,
} from "@medusajs/ui"
import { Link } from "react-router-dom"
import {
  accessApi,
  errorMessage,
  useRefreshAccess,
  type Staff,
} from "../../lib/access"
import { SettingsTable } from "./settings-table"

import { EllipsisHorizontal, Trash } from "@medusajs/icons"
import { InvitationEditor } from "../invitation-editor"

const column = createDataTableColumnHelper<Staff>()
export function UsersList({
  userId,
  superuser,
}: {
  userId: string
  superuser: boolean
}) {
  const [inviting, setInviting] = useState(false)
  const prompt = usePrompt()
  const refresh = useRefreshAccess()
  const remove = useMutation({
    mutationFn: accessApi.deleteUser,
    onSuccess: async () => {
      await refresh()
      toast.success("User deleted")
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
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
      ...(superuser
        ? [
            column.display({
              id: "actions",
              header: "",
              cell: ({ row }) =>
                row.original.id === userId ? null : (
                  <DropdownMenu>
                    <DropdownMenu.Trigger asChild>
                      <IconButton
                        size="small"
                        variant="transparent"
                        aria-label={`Actions for ${row.original.email}`}
                      >
                        <EllipsisHorizontal />
                      </IconButton>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end">
                      <DropdownMenu.Item
                        className="text-ui-fg-error"
                        disabled={remove.isPending}
                        onClick={async () => {
                          if (
                            await prompt({
                              title: "Delete user?",
                              description: `Delete ${row.original.email} and revoke their access? This cannot be undone.`,
                              confirmText: "Delete",
                              cancelText: "Cancel",
                            })
                          )
                            remove.mutate(row.original.id)
                        }}
                      >
                        <Trash />
                        Delete
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu>
                ),
            }),
          ]
        : []),
    ],
    [superuser, userId, prompt, remove.isPending, remove.mutate]
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
    <>
      <SettingsTable
        title="Users"
        instance={table}
        empty="No users yet"
        search="Search users"
        error={users.error}
        action={
          superuser && (
            <Button size="small" onClick={() => setInviting(true)}>
              Invite user
            </Button>
          )
        }
      />
      {inviting && <InvitationEditor onClose={() => setInviting(false)} />}
    </>
  )
}
