import {
  PermissionRules,
  ruleDrafts,
  parseRuleDrafts,
} from "./permission-rules"
import { useState } from "react"
import {
  Button,
  Checkbox,
  FocusModal,
  Tabs,
  Text,
  Alert,
  Heading,
  Input,
  Label,
  toast,
} from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"
import {
  accessApi,
  errorMessage,
  useRefreshAccess,
  type PermissionEntry,
  type Role,
} from "../lib/access"
import type { Permission } from "../../lib/access/permissions"

type Props = {
  role?: Role
  permissions: PermissionEntry[]
  open: boolean
  readOnly?: boolean
  onClose: () => void
}

export const RoleEditor = ({
  role,
  permissions,
  open,
  onClose,
  readOnly = false,
}: Props) => {
  const [search, setSearch] = useState("")
  const [name, setName] = useState(role?.name || "")
  const [selected, setSelected] = useState<Permission[]>(
    role?.permissions || []
  )
  const [rules, setRules] = useState(() => ruleDrafts(role?.rules || []))
  const refresh = useRefreshAccess()
  const save = useMutation({
    mutationFn: () =>
      accessApi.saveRole({
        ...(role ? { id: role.id, version: role.version } : {}),
        name,
        permissions: selected,
        rules: parseRuleDrafts(rules),
      }),
    onSuccess: async () => {
      await refresh()
      toast.success("Role saved")
      onClose()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <FocusModal
      open={open}
      onOpenChange={() => {
        if (!save.isPending) onClose()
      }}
    >
      <FocusModal.Content>
        <FocusModal.Header>
          <FocusModal.Title className="text-ui-fg-base text-sm font-medium">
            {readOnly ? "Role permissions" : role ? "Edit role" : "Create role"}
          </FocusModal.Title>
        </FocusModal.Header>
        <FocusModal.Body className="overflow-y-auto">
          <form
            id="rbac-role"
            onSubmit={(event) => {
              event.preventDefault()
              save.mutate()
            }}
            className="mx-auto flex w-full max-w-3xl flex-col gap-y-6 px-6 py-10"
          >
            <FocusModal.Description className="text-ui-fg-subtle text-sm">
              {role?.is_superuser
                ? "Superuser is a protected system role with access to every registered permission."
                : "Choose permissions and contextual rules for this role. Changes apply to every assigned account."}
            </FocusModal.Description>
            {save.error && (
              <Alert role="alert" variant="error">
                {errorMessage(save.error)}
              </Alert>
            )}
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="role-name">Role name</Label>
              <Input
                id="role-name"
                required
                value={name}
                disabled={readOnly}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <Tabs defaultValue="permissions">
              <Tabs.List>
                <Tabs.Trigger value="permissions">
                  Permissions ({selected.length})
                </Tabs.Trigger>
                <Tabs.Trigger value="rules">
                  Rules ({rules.length})
                </Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content
                value="permissions"
                className="flex flex-col gap-y-6 pt-6"
              >
                <Input
                  aria-label="Search permissions"
                  type="search"
                  placeholder="Search permissions"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {[
                  ...new Set(
                    permissions
                      .filter((permission) =>
                        `${permission.label} ${permission.group} ${permission.id}`
                          .toLowerCase()
                          .includes(search.toLowerCase())
                      )
                      .map((p) => p.group)
                  ),
                ].map((group) => (
                  <div key={group} className="flex flex-col gap-y-3">
                    <Heading level="h2">{group}</Heading>
                    {permissions
                      .filter(
                        (p) =>
                          p.group === group &&
                          `${p.label} ${p.id} ${p.group}`
                            .toLowerCase()
                            .includes(search.toLowerCase())
                      )
                      .map((permission) => (
                        <label
                          key={permission.id}
                          className="flex items-start gap-x-3 text-sm"
                        >
                          <Checkbox
                            aria-label={permission.label}
                            disabled={readOnly}
                            checked={selected.includes(permission.id)}
                            onCheckedChange={(checked) =>
                              setSelected((current) =>
                                checked
                                  ? [...current, permission.id]
                                  : current.filter((id) => id !== permission.id)
                              )
                            }
                          />
                          <span>{permission.label}</span>
                        </label>
                      ))}
                  </div>
                ))}
              </Tabs.Content>
              <Tabs.Content value="rules" className="pt-6">
                <PermissionRules
                  permissions={permissions}
                  value={rules}
                  onChange={setRules}
                  readOnly={readOnly}
                />
              </Tabs.Content>
            </Tabs>
          </form>
        </FocusModal.Body>
        <FocusModal.Footer>
          <Button variant="secondary" onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button
              disabled={!name.trim()}
              isLoading={save.isPending}
              type="submit"
              form="rbac-role"
            >
              Save role
            </Button>
          )}
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}
