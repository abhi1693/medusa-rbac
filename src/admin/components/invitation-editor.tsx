import { useState } from "react"
import { Button, Copy, Drawer, Input, Label, Text, Alert } from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"
import { useHref } from "react-router-dom"
import { accessApi, errorMessage, useRefreshAccess } from "../lib/access"
import { InviteRoles } from "./invite-roles"

export function invitationLink(loginPath: string, token: string) {
  const url = new URL(loginPath, window.location.origin)
  url.searchParams.set("rbac_invite", token)
  return url.toString()
}

export function InvitationEditor({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("")
  const [roles, setRoles] = useState<string[]>([])
  const refresh = useRefreshAccess()
  const loginPath = useHref("/login")
  const save = useMutation({
    mutationFn: () =>
      accessApi.createInvitation({ email: email.trim(), role_ids: roles }),
    onSuccess: () => refresh(),
  })
  const link = save.data && invitationLink(loginPath, save.data.invite.token)
  return (
    <Drawer
      open
      onOpenChange={() => {
        if (!save.isPending) onClose()
      }}
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            {link ? "Invitation created" : "Invite user"}
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-6 overflow-y-auto">
          {save.error && (
            <Alert variant="error" role="alert">
              {errorMessage(save.error)}
            </Alert>
          )}
          {link ? (
            <>
              <Text size="small" className="text-ui-fg-subtle">
                Share this private link with {email.trim()}. It grants the roles
                you selected when the account is created.
              </Text>
              <div className="flex flex-col gap-y-2">
                <Label htmlFor="invitation-link">Invitation link</Label>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Input id="invitation-link" value={link} readOnly />
                  </div>
                  <Copy content={link} aria-label="Copy invitation link" />
                </div>
              </div>
            </>
          ) : (
            <form
              id="rbac-invite"
              className="flex flex-col gap-y-6"
              onSubmit={(event) => {
                event.preventDefault()
                save.mutate()
              }}
            >
              <div className="flex flex-col gap-y-2">
                <Label htmlFor="invitation-email">Email</Label>
                <Input
                  id="invitation-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="off"
                />
              </div>
              <InviteRoles value={roles} onChange={setRoles} />
            </form>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Button
            variant="secondary"
            disabled={save.isPending}
            onClick={onClose}
          >
            {link ? "Done" : "Cancel"}
          </Button>
          {!link && (
            <Button
              type="submit"
              form="rbac-invite"
              disabled={!email.trim() || !roles.length}
              isLoading={save.isPending}
            >
              Create invitation
            </Button>
          )}
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
