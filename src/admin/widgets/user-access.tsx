import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { DetailWidgetProps, HttpTypes } from "@medusajs/framework/types"
import { Alert, Button, Container, Heading, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { accessApi, errorMessage, useAccess } from "../lib/access"
import { RolesTable } from "../components/roles-table"
import { StaffEditor } from "../components/staff-editor"

const UserAccess = ({ data: user }: DetailWidgetProps<HttpTypes.AdminUser>) => {
  const access = useAccess()
  const superuser = Boolean(
    access.isFetchedAfterMount &&
    access.data?.access.active &&
    access.data.access.is_superuser
  )
  const [editing, setEditing] = useState(false)
  const staff = useQuery({
    queryKey: ["medusa-rbac", access.data?.access.actor_id, "staff", user.id],
    queryFn: () => accessApi.staffUser(user.id),
    enabled: superuser,
    retry: false,
  })
  const roles = useQuery({
    queryKey: ["medusa-rbac", access.data?.access.actor_id, "roles"],
    queryFn: accessApi.roles,
    enabled: superuser,
    retry: false,
  })
  if (!superuser) return null
  const error = staff.error || roles.error
  const person = staff.data?.staff
  return (
    <Container className="divide-y p-0" role="region" aria-label="User roles">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Roles</Heading>
        <Button
          variant="secondary"
          size="small"
          disabled={!person || !roles.data}
          onClick={() => setEditing(true)}
        >
          Edit roles
        </Button>
      </div>
      {error && (
        <Alert role="alert" variant="error">
          {errorMessage(error)}
        </Alert>
      )}
      {!person ? (
        <Text className="px-6 py-4">Loading roles…</Text>
      ) : (
        <RolesTable
          roles={person.access.role_ids.map(
            (id) =>
              roles.data?.roles.find((role) => role.id === id) || {
                id,
                name: "Unavailable role",
                permissions: [],
              }
          )}
        />
      )}
      {editing && person && roles.data && (
        <StaffEditor
          staff={person}
          roles={roles.data.roles}
          onClose={() => setEditing(false)}
        />
      )}
    </Container>
  )
}
export const config = defineWidgetConfig({
  zone: "user.details",
  id: "medusa-rbac-user-access",
})
export default UserAccess
