import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { ArrowLeft, SquareTwoStack } from "@medusajs/icons"
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Container,
  Heading,
  Text,
} from "@medusajs/ui"
import { accessApi, errorMessage, useAccess, type Role } from "../../lib/access"
import {
  roleCreatedAt,
  roleIsManaged,
  roleSourceLabel,
  ROLE_LIST_PATH,
} from "../../lib/access-presentation"
import { hasPermissionCandidate } from "../../../lib/access/permission-key"
import { RoleEditor } from "../role-editor"
import { PermissionSummary } from "./permission-summary"

export function RoleDetail({ roleId }: { roleId: string }) {
  const current = useAccess()
  const access = current.data?.access
  const allowed = Boolean(
    current.isFetchedAfterMount &&
    access?.active &&
    access.role_ids.length &&
    hasPermissionCandidate(access, "roles.view")
  )
  const [actorPage, setActorPage] = useState(0)
  const detail = useQuery({
    queryKey: ["medusa-rbac", access?.actor_id, "role", roleId, actorPage],
    queryFn: () => accessApi.role(roleId, actorPage * 25),
    placeholderData: keepPreviousData,
    enabled: allowed,
    retry: false,
  })
  const catalog = useQuery({
    queryKey: ["medusa-rbac", access?.actor_id, "permissions"],
    queryFn: accessApi.permissions,
    enabled: allowed,
    retry: false,
  })
  const [editor, setEditor] = useState<{
    mode: "edit" | "copy"
    role: Role
  } | null>(null)
  if (current.error || detail.error || catalog.error)
    return (
      <Alert role="alert" variant="error">
        {errorMessage(current.error || detail.error || catalog.error)}
      </Alert>
    )
  if (current.isPending || !current.isFetchedAfterMount)
    return (
      <Container>
        <Text role="status">Loading access…</Text>
      </Container>
    )
  if (!allowed)
    return (
      <Container>
        <Heading>Role unavailable</Heading>
        <Text className="text-ui-fg-subtle">
          You do not have permission to view this role.
        </Text>
        <Button asChild variant="secondary" size="small" className="mt-4">
          <Link to="/settings/access-management?view=my-access">
            View my access
          </Link>
        </Button>
      </Container>
    )
  if (detail.isPending || catalog.isPending)
    return (
      <Container>
        <Text role="status">Loading role…</Text>
      </Container>
    )
  const { role, actors, actor_count, pending_invitation_count } = detail.data!
  const managed = roleIsManaged(role)
  const canEdit = access!.is_superuser && !managed
  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          asChild
          variant="transparent"
          size="small"
          className="self-start"
        >
          <Link to={ROLE_LIST_PATH}>
            <ArrowLeft />
            Back to roles
          </Link>
        </Button>
        {access!.is_superuser &&
          !role.is_superuser &&
          role.configuration_status !== "removed" && (
            <Button
              variant="secondary"
              size="small"
              onClick={() => setEditor({ mode: "copy", role })}
              className="self-start"
            >
              <SquareTwoStack />
              Duplicate role
            </Button>
          )}
      </div>
      <Heading level="h1">{role.name}</Heading>
      {role.configuration_status === "removed" && (
        <Alert variant="warning">
          This role's definition is missing from application configuration. Its
          assignments are retained, but it grants no access. Restore the
          definition in code to activate it again.
        </Alert>
      )}
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PermissionSummary
            role={role}
            permissions={catalog.data!.permissions}
          />
        </div>
        <div className="flex flex-col gap-3">
          <Container className="divide-y p-0">
            <div className="flex items-center justify-between gap-3 px-6 py-4">
              <Heading level="h2">Details</Heading>
              {canEdit && (
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => setEditor({ mode: "edit", role })}
                >
                  Edit role
                </Button>
              )}
            </div>
            <dl className="divide-ui-border-base divide-y">
              <div className="grid grid-cols-2 gap-3 px-6 py-4">
                <dt className="text-ui-fg-subtle text-sm">Managed in</dt>
                <dd>
                  <Badge size="2xsmall">{roleSourceLabel(role)}</Badge>
                </dd>
              </div>
              <div className="grid grid-cols-2 gap-3 px-6 py-4">
                <dt className="text-ui-fg-subtle text-sm">Created</dt>
                <dd className="text-sm">{roleCreatedAt(role.created_at)}</dd>
              </div>
              <div className="grid grid-cols-2 gap-3 px-6 py-4">
                <dt className="text-ui-fg-subtle text-sm">
                  Pending invitations
                </dt>
                <dd className="text-sm">{pending_invitation_count}</dd>
              </div>
            </dl>
            {managed && (
              <Text size="small" className="text-ui-fg-subtle px-6 py-4">
                {role.is_superuser
                  ? "Superuser is a protected system role. Its permissions cannot be changed."
                  : role.configuration_status === "removed"
                    ? "This role is managed in code. Its definition must be restored in application configuration."
                    : "This role is defined in application configuration. Update its definition in code, or duplicate it to create an editable role."}
              </Text>
            )}
          </Container>
          <Container className="divide-y p-0">
            <div className="flex items-center justify-between px-6 py-4">
              <Heading level="h2">Assigned accounts</Heading>
              <Badge size="2xsmall">{actor_count}</Badge>
            </div>
            {actors.length ? (
              <ul className="divide-ui-border-base divide-y">
                {actors.map((actor) => (
                  <li
                    key={`${actor.actor_type}:${actor.actor_id}`}
                    className="flex min-w-0 items-start gap-3 px-6 py-4"
                  >
                    <Avatar
                      size="2xsmall"
                      fallback={(actor.label || actor.actor_type)
                        .charAt(0)
                        .toUpperCase()}
                    />
                    <div className="min-w-0 flex-1">
                      {actor.actor_type === "user" &&
                      hasPermissionCandidate(access!, "staff.view") ? (
                        <Link
                          className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover text-sm font-medium"
                          to={`/settings/users/${encodeURIComponent(actor.actor_id)}`}
                        >
                          {actor.label || actor.actor_id}
                        </Link>
                      ) : (
                        <Text size="small" weight="plus" className="break-all">
                          {actor.label || actor.actor_id}
                        </Text>
                      )}
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {actor.actor_type} ·{" "}
                        {actor.active ? "Active" : "Inactive"}
                      </Text>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-6 py-6">
                <Text size="small" weight="plus">
                  Not assigned yet
                </Text>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  Assign this role from a user's access settings or an
                  invitation.
                </Text>
              </div>
            )}
            {actor_count > actors.length && (
              <Text size="small" className="text-ui-fg-subtle px-6 py-3">
                Showing {actorPage * 25 + 1}–{actorPage * 25 + actors.length} of{" "}
                {actor_count} accounts.
              </Text>
            )}
            {actor_count > 25 && (
              <div className="flex items-center justify-between gap-2 px-6 py-3">
                <Button
                  variant="secondary"
                  size="small"
                  aria-label="Previous accounts"
                  disabled={actorPage === 0 || detail.isFetching}
                  onClick={() => setActorPage(actorPage - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  aria-label="Next accounts"
                  disabled={
                    (actorPage + 1) * 25 >= actor_count || detail.isFetching
                  }
                  onClick={() => setActorPage(actorPage + 1)}
                >
                  Next
                </Button>
              </div>
            )}
            {hasPermissionCandidate(access!, "staff.view") && (
              <div className="px-6 py-4">
                <Button asChild size="small" variant="secondary">
                  <Link to="/settings/access-management?view=users">
                    Manage users
                  </Link>
                </Button>
              </div>
            )}
          </Container>
        </div>
      </div>
      {editor && (
        <RoleEditor
          key={`${editor.role.id}-${editor.mode}`}
          open
          role={editor.mode === "edit" ? editor.role : undefined}
          initialRole={editor.mode === "copy" ? editor.role : undefined}
          permissions={catalog.data!.permissions}
          readOnly={
            !access!.is_superuser || (editor.mode === "edit" && managed)
          }
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  )
}
