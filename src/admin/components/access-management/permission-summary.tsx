import { Badge, Container, Heading, Text } from "@medusajs/ui"
import type { PermissionEntry, Role } from "../../lib/access"

function conditionValue(value: unknown): string {
  return Array.isArray(value)
    ? value.map((entry) => JSON.stringify(entry)).join(" or ")
    : JSON.stringify(value)
}

export function PermissionSummary({
  role,
  permissions,
}: {
  role: Role
  permissions: PermissionEntry[]
}) {
  const grants = permissions.filter((permission) =>
    role.permissions.includes(permission.id)
  )
  const groups = [...new Set(grants.map((permission) => permission.group))]
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between gap-3 px-6 py-4">
        <Heading level="h2">Permissions</Heading>
        <Badge size="2xsmall">
          {role.is_superuser
            ? "All permissions"
            : `${grants.length} ${grants.length === 1 ? "grant" : "grants"}`}
        </Badge>
      </div>
      {role.is_superuser && (
        <Text size="small" className="text-ui-fg-subtle px-6 py-4">
          Superuser has every registered permission, including permissions added
          later.
        </Text>
      )}
      {groups.map((group) => (
        <section key={group} className="px-6 py-4">
          <Heading level="h3" className="mb-3">
            {group}
          </Heading>
          <ul className="grid gap-3 sm:grid-cols-2">
            {grants
              .filter((permission) => permission.group === group)
              .map((permission) => (
                <li
                  key={permission.id}
                  className="border-ui-border-base rounded-md border px-3 py-2"
                >
                  <Text size="small" weight="plus">
                    {permission.label}
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-muted break-all">
                    {permission.id}
                  </Text>
                </li>
              ))}
          </ul>
        </section>
      ))}
      {(role.rules || []).map((rule, index) => (
        <section key={index} className="px-6 py-4">
          <div className="border-ui-border-base overflow-hidden rounded-lg border">
            <div className="flex flex-col gap-2 px-4 py-3">
              <Text size="small" weight="plus">
                {permissions.find(
                  (permission) => permission.id === rule.permission
                )?.label || rule.permission}
              </Text>
              <Text size="xsmall" className="text-ui-fg-muted break-all">
                {rule.permission}
              </Text>
              <div className="flex flex-wrap gap-2">
                <Badge
                  size="2xsmall"
                  color={rule.effect === "allow" ? "green" : "red"}
                >
                  {rule.effect === "allow" ? "Allow" : "Deny"}
                </Badge>
                <Badge size="2xsmall">Priority {rule.priority || 0}</Badge>
              </div>
            </div>
            <div className="border-ui-border-base bg-ui-bg-subtle border-t px-4 py-3">
              {Object.keys(rule.conditions || {}).length ? (
                <dl className="flex flex-col gap-2">
                  {Object.entries(rule.conditions!).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex flex-wrap items-start gap-x-2 text-sm"
                    >
                      <dt className="text-ui-fg-subtle font-medium">{key}</dt>
                      <dd className="text-ui-fg-base min-w-0 break-all">
                        {conditionValue(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <Text size="small" className="text-ui-fg-subtle">
                  Applies in every context
                </Text>
              )}
            </div>
          </div>
        </section>
      ))}
      {!grants.length && !role.rules?.length && !role.is_superuser && (
        <div className="px-6 py-10 text-center">
          <Text size="small" weight="plus">
            No permissions assigned
          </Text>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            This role does not grant access to any operation.
          </Text>
        </div>
      )}
    </Container>
  )
}
