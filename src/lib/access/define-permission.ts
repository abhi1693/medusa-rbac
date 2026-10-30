import type { PermissionDefinition } from "./config"

/** Define a permission with named fields while preserving its literal identifier. */
export function definePermission<const Id extends string>(definition: {
  id: Id
  label: string
  group: string
}): readonly [Id, string, string] {
  return [
    definition.id,
    definition.label,
    definition.group,
  ] satisfies PermissionDefinition
}
