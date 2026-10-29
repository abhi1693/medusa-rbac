import { useState } from "react"
import { Button, Drawer, Text, toast } from "@medusajs/ui"
import { RolesTable } from "./roles-table"
import { useMutation } from "@tanstack/react-query"
import {
  accessApi,
  errorMessage,
  useRefreshAccess,
  type Role,
  type Staff,
} from "../lib/access"

export const StaffEditor = ({
  staff,
  roles,
  onClose,
}: {
  staff: Staff
  roles: Role[]
  onClose: () => void
}) => {
  const [roleIds, setRoleIds] = useState(staff.access.role_ids)
  const refresh = useRefreshAccess()
  const save = useMutation({
    mutationFn: () => accessApi.saveStaff(staff, roleIds),
    onSuccess: async () => {
      await refresh()
      toast.success("Staff access updated")
      onClose()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <Drawer open onOpenChange={onClose}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Manage staff access</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex min-h-0 flex-col gap-y-5 overflow-y-auto">
          <Text>{staff.email}</Text>
          <Text size="small">Assign one or more roles.</Text>
          <RolesTable
            roles={roles}
            selectedRoleIds={roleIds}
            onSelectionChange={setRoleIds}
          />
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button isLoading={save.isPending} onClick={() => save.mutate()}>
            Save access
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
