import type { LoaderOptions } from "@medusajs/framework/types"
import {
  createAccessConfig,
  type AccessControlOptions,
} from "../../../lib/access/config"

export default async function validateOptions({
  options,
}: LoaderOptions<AccessControlOptions>) {
  createAccessConfig(options)
}
