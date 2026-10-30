import { Module } from "@medusajs/framework/utils"
import AccessControlService from "./service"
import validateOptions from "./loaders/validate-options"

export const ACCESS_CONTROL = "rbac_access"
export default Module(ACCESS_CONTROL, {
  service: AccessControlService,
  loaders: [validateOptions],
})
