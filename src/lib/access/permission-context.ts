import type { PermissionContext } from "./config"

/** Validate a diagnostic context without accepting expressions or nested objects. */
export function isPermissionContext(
  value: unknown
): value is PermissionContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return (
    entries.length <= 30 &&
    entries.every(
      ([key, entry]) =>
        /^[a-z][a-z0-9_]*$/.test(key) &&
        (entry === null ||
          typeof entry === "boolean" ||
          (typeof entry === "string" && entry.length <= 1000) ||
          (typeof entry === "number" && Number.isFinite(entry)))
    )
  )
}
