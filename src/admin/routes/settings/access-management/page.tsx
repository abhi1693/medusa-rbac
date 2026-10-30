import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Alert, Container, Heading, Tabs, Text } from "@medusajs/ui"
import { useSearchParams } from "react-router-dom"
import { errorMessage, useAccess } from "../../../lib/access"
import { PermissionCatalog } from "../../../components/access-management/permission-catalog"
import { RolesList } from "../../../components/access-management/roles-list"
import { UsersList } from "../../../components/access-management/users-list"
import { ActivityList } from "../../../components/access-management/activity-list"
import { InvitationsList } from "../../../components/access-management/invitations-list"
import { MyAccess } from "../../../components/access-management/my-access"
import { hasPermissionCandidate } from "../../../../lib/access/permission-key"

const AccessManagement = () => {
  const query = useAccess()
  const [params, setParams] = useSearchParams()
  if (query.isPending || (!query.isFetchedAfterMount && !query.error))
    return (
      <Container>
        <Text>Loading access…</Text>
      </Container>
    )
  if (query.error)
    return (
      <Container>
        <Alert role="alert" variant="error">
          {errorMessage(query.error)}
        </Alert>
      </Container>
    )
  const access = query.data!.access
  if (!access.active || !access.role_ids.length)
    return (
      <Container>
        <Heading>Access pending</Heading>
        <Text>Ask a Superuser to assign your roles.</Text>
      </Container>
    )
  const views = [
    ...(hasPermissionCandidate(access, "roles.view")
      ? [{ id: "roles", label: "Roles" }]
      : []),
    ...(hasPermissionCandidate(access, "roles.view")
      ? [{ id: "permissions", label: "Permissions" }]
      : []),
    ...(hasPermissionCandidate(access, "staff.view")
      ? [{ id: "users", label: "Users" }]
      : []),
    ...(hasPermissionCandidate(access, "audit.view")
      ? [{ id: "activity", label: "Activity" }]
      : []),
    ...(access.is_superuser
      ? [{ id: "invitations", label: "Invitations" }]
      : []),
    { id: "my-access", label: "My access" },
  ]
  const selected =
    views.find((view) => view.id === params.get("view"))?.id || views[0].id
  return (
    <Tabs
      value={selected}
      onValueChange={(view) => {
        const next = new URLSearchParams(params)
        next.set("view", view)
        setParams(next)
      }}
      className="flex flex-col gap-y-3"
    >
      <Tabs.List aria-label="Access management" className="flex h-auto w-full flex-wrap justify-start">
        {views.map((view) => (
          <Tabs.Trigger key={view.id} value={view.id}>
            {view.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value="roles">
        <RolesList userId={access.actor_id} superuser={access.is_superuser} />
      </Tabs.Content>
      <Tabs.Content value="permissions">
        <PermissionCatalog
          userId={access.actor_id}
          superuser={access.is_superuser}
        />
      </Tabs.Content>
      <Tabs.Content value="users">
        <UsersList userId={access.actor_id} superuser={access.is_superuser} />
      </Tabs.Content>
      <Tabs.Content value="activity">
        <ActivityList userId={access.actor_id} />
      </Tabs.Content>
      {access.is_superuser && (
        <Tabs.Content value="invitations">
          <InvitationsList userId={access.actor_id} />
        </Tabs.Content>
      )}
      <Tabs.Content value="my-access">
        <MyAccess
          access={access}
          roles={query.data?.roles}
          permissionCatalog={query.data?.permission_catalog}
        />
      </Tabs.Content>
    </Tabs>
  )
}
export const config = defineRouteConfig({ label: "Access management" })
export default AccessManagement
