import {
  PermissionRules,
  ruleDrafts,
  parseRuleDrafts,
} from "./permission-rules"
import { useState } from "react"
import {
  Button,
  Checkbox,
  Drawer,
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
    <Drawer open={open} onOpenChange={onClose}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            {readOnly ? "Role permissions" : role ? "Edit role" : "Create role"}
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex min-h-0 flex-col gap-y-6 overflow-y-auto">
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="role-name">Role name</Label>
            <Input
              id="role-name"
              value={name}
              disabled={readOnly}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {[...new Set(permissions.map((p) => p.group))].map((group) => (
            <div key={group} className="flex flex-col gap-y-3">
              <Heading level="h2">{group}</Heading>
              {permissions
                .filter((p) => p.group === group)
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
          <PermissionRules
            value={rules}
            onChange={setRules}
            readOnly={readOnly}
          />
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button
              disabled={!name.trim()}
              isLoading={save.isPending}
              onClick={() => save.mutate()}
            >
              Save role
            </Button>
          )}
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
