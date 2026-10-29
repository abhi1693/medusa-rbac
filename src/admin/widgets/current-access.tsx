import { MY_ACCESS_PATH } from "../lib/access-presentation"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Avatar, DropdownMenu, Text, toast } from "@medusajs/ui"
import { Link, useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { accessApi, errorMessage, sdk, useAccess } from "../lib/access"

const CurrentAccess = () => {
  const access = useAccess()
  const client = useQueryClient()
  const navigate = useNavigate()
  const profile = useQuery({
    queryKey: ["medusa-rbac", access.data?.access.actor_id, "profile"],
    queryFn: accessApi.profile,
    enabled: Boolean(access.data?.access.actor_id),
    retry: false,
  })
  const logout = useMutation({
    mutationFn: () => sdk.auth.logout(),
    onSuccess: () => {
      client.clear()
      navigate("/login", { replace: true })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  if (!access.data) return null
  const user = profile.data?.user
  const name =
    [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
    user?.email ||
    "Account"
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label="Account menu"
          className="rounded-full outline-none focus-visible:shadow-borders-focus"
        >
          <Avatar
            src={user?.avatar_url || undefined}
            fallback={name[0].toUpperCase()}
            size="small"
          />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" className="min-w-56">
        <DropdownMenu.Label>
          <Text size="small" weight="plus">
            {name}
          </Text>
          {user?.email && (
            <Text size="xsmall" className="text-ui-fg-subtle">
              {user.email}
            </Text>
          )}
        </DropdownMenu.Label>
        <DropdownMenu.Separator />
        <DropdownMenu.Item asChild>
          <Link to="/settings/profile">My profile</Link>
        </DropdownMenu.Item>
        <DropdownMenu.Item asChild>
          <Link to={MY_ACCESS_PATH}>My access</Link>
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
        >
          Log out
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}
export const config = defineWidgetConfig({
  zone: "topbar",
  id: "medusa-rbac-current-access",
})
export default CurrentAccess
