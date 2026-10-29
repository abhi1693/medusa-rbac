import { MY_ACCESS_PATH } from "../lib/access-presentation"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button } from "@medusajs/ui"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { accessFingerprint, useAccess } from "../lib/access"

const CurrentAccess = () => {
  const access = useAccess()
  const navigate = useNavigate()
  const location = useLocation()
  const client = useQueryClient()
  const previous = useRef<string>()
  const fingerprint = access.data && accessFingerprint(access.data.access)
  useEffect(() => {
    if (!fingerprint || !access.isFetchedAfterMount) return
    const changed = previous.current && previous.current !== fingerprint
    previous.current = fingerprint
    let cancelled = false
    if (changed)
      void client
        .refetchQueries(
          {
            predicate: (query) => query.queryKey[0] !== "medusa-rbac",
            type: "all",
          },
          { cancelRefetch: false }
        )
        .then(() => {
          if (!cancelled)
            return navigate(
              {
                pathname: location.pathname,
                search: location.search,
                hash: location.hash,
              },
              { replace: true, state: location.state }
            )
        })
    return () => {
      cancelled = true
    }
  }, [
    fingerprint,
    access.isFetchedAfterMount,
    client,
    navigate,
    location.pathname,
    location.search,
    location.hash,
    location.state,
  ])
  if (!access.data) return null
  return (
    <Button size="small" variant="transparent" asChild>
      <Link to={MY_ACCESS_PATH}>My access</Link>
    </Button>
  )
}
export const config = defineWidgetConfig({
  zone: "topbar",
  id: "medusa-rbac-current-access",
})
export default CurrentAccess
