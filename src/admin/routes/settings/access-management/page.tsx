import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Alert, Container, Heading, Tabs, Text } from "@medusajs/ui"
import { useSearchParams } from "react-router-dom"
import { errorMessage, useAccess } from "../../../lib/access"
import { RolesList } from "../../../components/access-management/roles-list"
import { UsersList } from "../../../components/access-management/users-list"
import { ActivityList } from "../../../components/access-management/activity-list"
import { MyAccess } from "../../../components/access-management/my-access"

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
    ...(access.permissions.includes("roles.view")
      ? [{ id: "roles", label: "Roles" }]
      : []),
    ...(access.permissions.includes("staff.view")
      ? [{ id: "users", label: "Users" }]
      : []),
    ...(access.permissions.includes("audit.view")
      ? [{ id: "activity", label: "Activity" }]
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
      <Tabs.List aria-label="Access management">
        {views.map((view) => (
          <Tabs.Trigger key={view.id} value={view.id}>
            {view.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value="roles">
        <RolesList userId={access.user_id} superuser={access.is_superuser} />
      </Tabs.Content>
      <Tabs.Content value="users">
        <UsersList userId={access.user_id} superuser={access.is_superuser} />
      </Tabs.Content>
      <Tabs.Content value="activity">
        <ActivityList userId={access.user_id} />
      </Tabs.Content>
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
