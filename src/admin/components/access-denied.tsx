import { MY_ACCESS_PATH } from "../lib/access-presentation"
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { FetchError } from "@medusajs/js-sdk"
import { accessFingerprint, useAccess } from "../lib/access"

export const AccessDenied = ({ error }: { error: unknown }) => {
  const access = useAccess()
  const client = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const checked = useRef<string>()
  const fingerprint =
    access.data?.access && accessFingerprint(access.data.access)
  useEffect(() => {
    if (
      !access.isFetchedAfterMount ||
      !fingerprint ||
      checked.current === fingerprint
    )
      return
    const changed = checked.current !== undefined
    checked.current = fingerprint
    const forbidden = client.getQueryCache().findAll({
      predicate: (query) =>
        query.state.error instanceof FetchError &&
        query.state.error.status === 403,
    })
    // Re-run denied reads before resetting the route, so unchanged denials do not loop.
    void client
      .refetchQueries(
        { predicate: (query) => forbidden.includes(query), type: "all" },
        { cancelRefetch: false }
      )
      .then(() => {
        if (
          changed ||
          forbidden.some((query) => query.state.status === "success")
        )
          void navigate(
            {
              pathname: location.pathname,
              search: location.search,
              hash: location.hash,
            },
            { replace: true, state: location.state }
          )
      })
  }, [
    access.isFetchedAfterMount,
    client,
    fingerprint,
    navigate,
    location.pathname,
    location.search,
    location.hash,
    location.state,
  ])
  const inactive =
    error instanceof Error &&
    error.message === "Staff access is inactive or has not been assigned"

  return (
    <div className="flex min-h-[calc(100vh-120px)] items-center justify-center p-6">
      <Container
        className="flex w-full max-w-lg flex-col items-center gap-y-4 p-8 text-center"
        role="region"
        aria-label="Access denied"
      >
        <Badge color="orange">403 · Access required</Badge>
        <Heading level="h1">You don’t have access to this page</Heading>
        <Text className="text-ui-fg-subtle">
          {inactive
            ? "Your account access is disabled or hasn’t been assigned yet."
            : "Your current roles don’t include permission to open this page."}
        </Text>
        <Text className="text-ui-fg-subtle">
          Ask a Superuser to review your access. You can still view your
          permissions and manage your profile.
        </Text>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link to={MY_ACCESS_PATH}>View my access</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link to="/settings/profile">Go to my profile</Link>
          </Button>
        </div>
      </Container>
    </div>
  )
}
