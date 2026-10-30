import {
  PermissionRules,
  ruleDrafts,
  parseRuleDrafts,
} from "./permission-rules"
import { useState } from "react"
import { PermissionPicker } from "./permission-picker"
import { roleIsManaged } from "../lib/access-presentation"
import {
  Button,
  FocusModal,
  Tabs,
  Alert,
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
  initialRole?: Role
  permissions: PermissionEntry[]
  open: boolean
  readOnly?: boolean
  onClose: () => void
}

export const RoleEditor = ({
  role,
  initialRole,
  permissions,
  open,
  onClose,
  readOnly: viewOnly = false,
}: Props) => {
  const readOnly = viewOnly || Boolean(role && roleIsManaged(role))
  const [name, setName] = useState(
    role?.name || (initialRole ? `${initialRole.name} copy` : "")
  )
  const [selected, setSelected] = useState<Permission[]>(
    role?.permissions || initialRole?.permissions || []
  )
  const [rules, setRules] = useState(() =>
    ruleDrafts(role?.rules || initialRole?.rules || [])
  )
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
                <PermissionPicker
                  permissions={permissions}
                  selected={selected}
                  onChange={setSelected}
                  readOnly={readOnly}
                />
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
          <Button
            variant="secondary"
            disabled={save.isPending}
            onClick={onClose}
          >
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
