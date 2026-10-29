import { Alert, Text } from "@medusajs/ui"
import { RolesTable } from "./roles-table"
import { useQuery } from "@tanstack/react-query"
import { accessApi, errorMessage } from "../lib/access"

export function InviteRoles({
  value,
  onChange,
  error,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  error?: string
}) {
  const roles = useQuery({
    queryKey: ["medusa-rbac", "invite-roles"],
    queryFn: accessApi.roles,
    retry: false,
  })
  return (
    <fieldset className="flex flex-col gap-y-3">
      <legend className="mb-2 text-sm font-medium">Roles</legend>
      <Text size="small" className="text-ui-fg-subtle">
        Assign one or more roles.
      </Text>
      {roles.isPending && <Text size="small">Loading roles…</Text>}
      {roles.error && (
        <Alert role="alert" variant="error">
          {errorMessage(roles.error)}
        </Alert>
      )}
      {roles.data && (
        <RolesTable
          roles={roles.data.roles}
          selectedRoleIds={value}
          onSelectionChange={onChange}
        />
      )}
      {error && (
        <Text role="alert" size="small" className="text-ui-fg-error">
          {error}
        </Text>
      )}
    </fieldset>
  )
}
