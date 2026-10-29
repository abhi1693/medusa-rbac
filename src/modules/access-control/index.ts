import { Module } from "@medusajs/framework/utils"
import AccessControlService from "./service"

export const ACCESS_CONTROL = "rbac_access"
export default Module(ACCESS_CONTROL, { service: AccessControlService })
