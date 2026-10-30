export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
export type RouteRegistration = { path: string; methods: readonly string[] }
export type RouteSegment =
  | { kind: "literal"; value: string }
  | { kind: "parameter"; name: string; value: string }
export type RouteFacts = {
  template: string
  method: string
  namespace: string
  root: string
  segments: RouteSegment[]
  params: Record<string, string>
}

export function canonicalPath(url: string): string | null {
  const raw = url.split("?")[0]
  if (
    !raw.startsWith("/") ||
    /%(?:2f|5c|2e|25)/i.test(raw) ||
    raw.includes("\\") ||
    raw.includes("//")
  )
    return null
  try {
    decodeURIComponent(raw)
    return raw.replace(/\/+$/, "")
  } catch {
    return null
  }
}

export function createRouteMatcher(
  registrations: readonly RouteRegistration[]
) {
  const index = new Map<
    string,
    { route: { path: string }; parts: string[] }[]
  >()
  for (const registration of registrations) {
    const parts = registration.path.split("/").slice(1)
    for (const method of registration.methods) {
      const key = `${method}:${parts.length}`
      const group = index.get(key) || []
      group.push({ route: { path: registration.path }, parts })
      index.set(key, group)
    }
  }
  for (const group of index.values())
    group.sort((left, right) => {
      for (let i = 0; i < left.parts.length; i++) {
        const difference =
          Number(left.parts[i].startsWith(":")) -
          Number(right.parts[i].startsWith(":"))
        if (difference) return difference
      }
      return left.route.path.localeCompare(right.route.path)
    })
  return (method: string, url: string): RouteFacts | null => {
    const path = canonicalPath(url)
    if (!path) return null
    const values = path.split("/").slice(1)
    const verb = method === "HEAD" ? "GET" : method
    const candidates = index.get(`${verb}:${values.length}`) || []
    for (const { route, parts } of candidates) {
      if (
        !parts.every(
          (part, i) =>
            part.startsWith(":") ||
            part.toLowerCase() === values[i].toLowerCase()
        )
      )
        continue
      const params: Record<string, string> = {}
      const segments = parts.map((part, i): RouteSegment => {
        if (!part.startsWith(":"))
          return { kind: "literal", value: part.toLowerCase() }
        const name = part.slice(1)
        const value = decodeURIComponent(values[i])
        params[name] = value
        return { kind: "parameter", name, value }
      })
      return {
        template: route.path,
        method: verb,
        namespace: parts.length > 1 ? parts[0].toLowerCase() : "",
        root: (parts[1] || parts[0]).toLowerCase(),
        segments: segments.slice(2),
        params,
      }
    }
    return null
  }
}

export function matchRoute(
  registrations: readonly RouteRegistration[],
  method: string,
  url: string
): RouteFacts | null {
  return createRouteMatcher(registrations)(method, url)
}
