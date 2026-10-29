export type ActorAccessSummary = {
  actor: { id: string; type: string; active: boolean }
  roles: { id: string; name: string }[]
  permission_candidates: string[]
}
