/** Copy policy data before freezing it; callbacks retain their server-owned identity. */
export function immutableConfig<T>(value: T): T {
  if (Array.isArray(value))
    return Object.freeze(value.map(immutableConfig)) as T
  if (value instanceof RegExp)
    return Object.freeze(new RegExp(value.source, value.flags)) as T
  if (value && typeof value === "object")
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          immutableConfig(child),
        ])
      )
    ) as T
  return value
}
