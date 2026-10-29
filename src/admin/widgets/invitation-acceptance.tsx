import { defineWidgetConfig } from "@medusajs/admin-sdk"
import {
  Alert,
  Badge,
  Button,
  FocusModal,
  Hint,
  Input,
  Label,
  Text,
} from "@medusajs/ui"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { errorMessage, sdk } from "../lib/access"

export async function acceptInvitationAccount(input: {
  token: string
  email: string
  first_name: string
  last_name: string
  password: string
}) {
  const credentials = { email: input.email, password: input.password }
  let token: unknown
  try {
    token = await sdk.auth.register("user", "emailpass", credentials)
  } catch (error) {
    if (
      (error as { status?: number }).status !== 401 ||
      !/already exists/i.test(errorMessage(error))
    )
      throw error
    token = await sdk.auth.login("user", "emailpass", credentials)
  }
  if (typeof token !== "string")
    throw new Error(
      "Complete your account's sign-in verification before accepting this invitation"
    )
  return sdk.client.fetch("/access/invites/accept", {
    method: "POST",
    query: { token: input.token },
    body: {
      email: input.email,
      first_name: input.first_name,
      last_name: input.last_name,
    },
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function InvitationAcceptance({
  token,
  onClose,
}: {
  token: string
  onClose: () => void
}) {
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [mismatch, setMismatch] = useState(false)
  const preview = useQuery({
    queryKey: ["medusa-rbac", "invitation-preview", token],
    retry: false,
    queryFn: () =>
      sdk.client.fetch<{
        invite: { email: string; roles: { id: string; name: string }[] }
      }>("/access/invites/preview", { query: { token } }),
  })
  const accept = useMutation({
    mutationFn: () =>
      acceptInvitationAccount({
        token,
        email: preview.data!.invite.email,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        password,
      }),
  })
  return (
    <FocusModal
      open
      onOpenChange={() => {
        if (!accept.isPending) onClose()
      }}
    >
      <FocusModal.Content>
        <FocusModal.Header>
          <Text size="small" weight="plus">
            Team invitation
          </Text>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center overflow-y-auto px-6">
          <div className="flex w-full max-w-lg flex-col gap-y-6 py-12">
            <div className="flex flex-col gap-y-2">
              <FocusModal.Title className="text-ui-fg-base text-xl font-medium">
                {accept.isSuccess
                  ? "Your account is ready"
                  : "Accept invitation"}
              </FocusModal.Title>
              <FocusModal.Description className="text-ui-fg-subtle text-sm">
                {accept.isSuccess
                  ? "Sign in to start using your assigned access."
                  : "Create your account to join the team."}
              </FocusModal.Description>
            </div>
            {preview.isPending && (
              <Text size="small" className="text-ui-fg-subtle">
                Loading invitation…
              </Text>
            )}
            {preview.error && (
              <Alert variant="error" role="alert">
                {errorMessage(preview.error)}
              </Alert>
            )}
            {accept.error && (
              <Alert variant="error" role="alert">
                {errorMessage(accept.error)}
              </Alert>
            )}
            {accept.isSuccess ? (
              <Badge color="green">Invitation accepted</Badge>
            ) : (
              preview.data && (
                <form
                  id="accept-rbac-invitation"
                  className="flex flex-col gap-y-5"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (password !== confirmation) {
                      setMismatch(true)
                      return
                    }
                    accept.mutate()
                  }}
                >
                  <div className="flex flex-col gap-y-2">
                    <Label htmlFor="invite-account-email">Email</Label>
                    <Input
                      id="invite-account-email"
                      value={preview.data.invite.email}
                      readOnly
                      autoComplete="email"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-y-2">
                      <Label htmlFor="invite-first-name">First name</Label>
                      <Input
                        id="invite-first-name"
                        value={firstName}
                        onChange={(event) => setFirstName(event.target.value)}
                        maxLength={100}
                        autoComplete="given-name"
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-y-2">
                      <Label htmlFor="invite-last-name">Last name</Label>
                      <Input
                        id="invite-last-name"
                        value={lastName}
                        onChange={(event) => setLastName(event.target.value)}
                        maxLength={100}
                        autoComplete="family-name"
                        required
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-y-2">
                    <Label htmlFor="invite-account-password">Password</Label>
                    <Input
                      id="invite-account-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-y-2">
                    <Label htmlFor="invite-confirm-password">
                      Confirm password
                    </Label>
                    <Input
                      id="invite-confirm-password"
                      type="password"
                      value={confirmation}
                      onChange={(event) => {
                        setConfirmation(event.target.value)
                        setMismatch(false)
                      }}
                      autoComplete="new-password"
                      required
                      aria-invalid={mismatch}
                    />
                    {mismatch && (
                      <Hint variant="error">Passwords must match.</Hint>
                    )}
                  </div>
                  <div className="flex flex-col gap-y-2">
                    <Text size="small" weight="plus">
                      Assigned roles
                    </Text>
                    <div className="flex flex-wrap gap-2">
                      {preview.data.invite.roles.length ? (
                        preview.data.invite.roles.map((role) => (
                          <Badge key={role.id}>{role.name}</Badge>
                        ))
                      ) : (
                        <Text size="small" className="text-ui-fg-subtle">
                          A Superuser will assign your roles after registration.
                        </Text>
                      )}
                    </div>
                  </div>
                </form>
              )
            )}
          </div>
        </FocusModal.Body>
        <FocusModal.Footer>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={accept.isPending}
          >
            {accept.isSuccess ? "Continue to sign in" : "Cancel"}
          </Button>
          {preview.data && !accept.isSuccess && (
            <Button
              type="submit"
              form="accept-rbac-invitation"
              isLoading={accept.isPending}
            >
              Create account
            </Button>
          )}
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}

const InvitationAcceptanceWidget = () => {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get("rbac_invite")
  return token ? (
    <InvitationAcceptance
      token={token}
      onClose={() => navigate("/login", { replace: true })}
    />
  ) : null
}
export const config = defineWidgetConfig({
  zone: "login.before",
  id: "medusa-rbac-invitation-acceptance",
})
export default InvitationAcceptanceWidget
