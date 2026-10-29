import { useMemo, useState } from "react"
import { useMutation, useQuery, keepPreviousData } from "@tanstack/react-query"
import { EllipsisHorizontal, ArrowPath, Trash } from "@medusajs/icons"
import {
  Button,
  Copy,
  DropdownMenu,
  IconButton,
  StatusBadge,
  createDataTableColumnHelper,
  useDataTable,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useHref } from "react-router-dom"
import {
  accessApi,
  errorMessage,
  useRefreshAccess,
  type Invitation,
} from "../../lib/access"
import { invitationLink, InvitationEditor } from "../invitation-editor"
import { SettingsTable } from "./settings-table"

const column = createDataTableColumnHelper<Invitation>()
export function InvitationsList({ userId }: { userId: string }) {
  const [editing, setEditing] = useState(false)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 })
  const [search, setSearch] = useState("")
  const loginPath = useHref("/login")
  const refresh = useRefreshAccess()
  const prompt = usePrompt()
  const invitations = useQuery({
    queryKey: [
      "medusa-rbac",
      userId,
      "invitations",
      pagination.pageIndex,
      search,
    ],
    queryFn: () => accessApi.invitations(pagination.pageIndex * 25, search),
    placeholderData: keepPreviousData,
    retry: false,
  })
  const resend = useMutation({
    mutationFn: accessApi.resendInvitation,
    onSuccess: async () => {
      await refresh()
      toast.success("Invitation renewed")
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const remove = useMutation({
    mutationFn: accessApi.deleteInvitation,
    onSuccess: async () => {
      await refresh()
      toast.success("Invitation revoked")
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const columns = useMemo(
    () => [
      column.accessor("email", { header: "Email" }),
      column.display({
        id: "roles",
        header: "Roles",
        cell: ({ row }) =>
          row.original.roles.map((role) => role.name).join(", ") ||
          "No roles assigned",
      }),
      column.accessor("expires_at", {
        header: "Status",
        cell: ({ getValue }) =>
          new Date(getValue()).getTime() <= Date.now() ? (
            <StatusBadge color="red">Expired</StatusBadge>
          ) : (
            <StatusBadge color="orange">Pending</StatusBadge>
          ),
      }),
      column.display({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
            <Copy
              content={invitationLink(loginPath, row.original.token)}
              aria-label={`Copy invitation for ${row.original.email}`}
            />
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
                  disabled={resend.isPending}
                  onClick={() => resend.mutate(row.original.id)}
                >
                  <ArrowPath />
                  Renew invitation
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  className="text-ui-fg-error"
                  disabled={remove.isPending}
                  onClick={async () => {
                    if (
                      await prompt({
                        title: "Revoke invitation?",
                        description: `The invitation for ${row.original.email} will stop working.`,
                        confirmText: "Revoke",
                        cancelText: "Cancel",
                      })
                    )
                      remove.mutate(row.original.id)
                  }}
                >
                  <Trash />
                  Revoke
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
          </div>
        ),
      }),
    ],
    [
      loginPath,
      prompt,
      remove.isPending,
      remove.mutate,
      resend.isPending,
      resend.mutate,
    ]
  )
  const table = useDataTable({
    data: invitations.data?.invitations || [],
    columns,
    getRowId: (invite) => invite.id,
    rowCount: invitations.data?.count || 0,
    isLoading: invitations.isPending,
    pagination: { state: pagination, onPaginationChange: setPagination },
    search: { state: search, onSearchChange: setSearch },
  })
  return (
    <>
      <SettingsTable
        title="Invitations"
        instance={table}
        empty="No pending invitations"
        search="Search invitations"
        error={invitations.error}
        action={
          <Button size="small" onClick={() => setEditing(true)}>
            Invite user
          </Button>
        }
      />
      {editing && <InvitationEditor onClose={() => setEditing(false)} />}
    </>
  )
}
