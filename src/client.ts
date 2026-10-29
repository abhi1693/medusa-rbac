import type Medusa from "@medusajs/js-sdk"
import type { ClientHeaders } from "@medusajs/js-sdk"
import type { ActorAccessSummary } from "./lib/access/summary"

/** Reuse the application's configured SDK and its native authentication. */
export function createAccessClient(sdk: Pick<Medusa, "client">) {
  return {
    me: (actorType: string, headers?: ClientHeaders) =>
      sdk.client.fetch<ActorAccessSummary>(
        `/access/actors/${encodeURIComponent(actorType)}/me`,
        { headers }
      ),
  }
}
export type { ActorAccessSummary }
