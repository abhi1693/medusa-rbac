import { describe, expect, it } from "vitest"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  createAccessConfig,
  evaluatePermission,
} from "../../src/lib/access/config"
import { PERMISSION_IDS } from "../../src/lib/access/permissions"
import { enforceAdminAccess } from "../../src/api/middlewares/enforce-admin-access"
import contract from "../fixtures/native-authorization-contract.json"
import inventory from "../../src/lib/access/native-routes.json"
import {
  additionalWritePermissions,
  policyFor,
  validateFieldSelection,
} from "../../src/lib/access/policy"

type StructuralPolicy = {
  permissions: readonly string[]
  superuser?: boolean
}

const comparable = (policy: StructuralPolicy | null) =>
  policy && {
    permissions: [...policy.permissions].sort(),
    ...(policy.superuser ? { superuser: true } : {}),
  }

const configuration = createAccessConfig()
type ActorScenario = "anonymous" | "inactive" | "staff" | "superuser"
const observeEnforcement = async (
  method: string,
  path: string,
  scenario: ActorScenario
) => {
  let status = 200
  let allowed = false
  let redirected = false
  let redirectTarget: string | undefined
  const principal = {
    actor_id: "contract_actor",
    actor_type: "user",
    active: scenario !== "inactive",
    is_superuser: scenario === "superuser",
    role_ids: scenario === "inactive" ? [] : ["contract_role"],
    permissions: scenario === "staff" ? [...PERMISSION_IDS] : [],
    rules: [],
  }
  const access = {
    resolveRequest: configuration.resolveRequest,
    principal: async () => principal,
    permissionContext: async () => ({
      actor_id: principal.actor_id,
      actor_type: "user",
    }),
    allows: evaluatePermission,
  }
  const request = {
    originalUrl: path,
    method,
    body: {},
    query: {},
    auth_context:
      scenario === "anonymous"
        ? undefined
        : { actor_type: "user", actor_id: principal.actor_id },
    scope: {
      resolve: (key: string) =>
        key === "user"
          ? { retrieveUser: async () => ({ id: principal.actor_id }) }
          : access,
    },
  } as unknown as MedusaRequest
  const response = {
    setHeader() {},
    status(code: number) {
      status = code
      return this
    },
    json() {
      return this
    },
    redirect(code: number, target: string) {
      status = code
      redirected = true
      redirectTarget = target
      return this
    },
  } as unknown as MedusaResponse
  await enforceAdminAccess(request, response, (error?: unknown) => {
    if (error) throw error
    allowed = true
  })
  return {
    allowed: allowed || redirected,
    status,
    ...(typeof request.query.fields === "string"
      ? { fields: request.query.fields }
      : {}),
    ...(redirected ? { redirect: redirectTarget } : {}),
  }
}

// This fixture was captured through the public policy export of the installed
// reviewed 4981e92 package. It contains outcomes, not its implementation.
describe("reviewed native authorization contract", () => {
  it("covers every method of the pinned native route catalog", () => {
    const actual = contract.routes.map(
      ({ route, method }) => `${method} ${route}`
    )
    const expected = inventory.flatMap(({ path, methods }) =>
      methods.map((method) => `${method} ${path}`)
    )
    expect(actual.sort()).toEqual(expected.sort())
  })

  it.each(contract.routes)(
    "$method $route preserves its reviewed capability requirements",
    async ({ method, path, policy, enforcement }) => {
      if (enforcement.anonymous.allowed) {
        // The old middleware bypassed policyFor for public token verification
        // and feature flags. Preserve that observable boundary explicitly.
        expect(
          (
            await configuration.resolveRequest({
              method,
              originalUrl: path,
              body: {},
            } as MedusaRequest)
          )?.access
        ).toBe("public")
      } else expect(comparable(policyFor(method, path))).toEqual(policy)
      for (const scenario of [
        "anonymous",
        "inactive",
        "staff",
        "superuser",
      ] as const)
        expect(
          await observeEnforcement(method, path, scenario),
          scenario
        ).toEqual(enforcement[scenario])
    }
  )

  it("preserves HEAD authorization for every registered GET", () => {
    for (const entry of contract.routes.filter(
      ({ method }) => method === "GET"
    ))
      expect(comparable(policyFor("HEAD", entry.path)), entry.route).toEqual(
        entry.policy
      )
  })

  it.each(contract.writes)(
    "$name preserves sensitive mutation capabilities",
    (entry) => {
      const creating = "creating" in entry && entry.creating
      expect(additionalWritePermissions(entry.body, creating).sort()).toEqual(
        entry.permissions
      )
    }
  )

  it.each(contract.shared)(
    "preserves strict personal/shared scope classification for $body",
    async ({ body, permissions }) => {
      const operation = await createAccessConfig().resolveRequest({
        method: "POST",
        originalUrl: "/admin/layouts/Product.Detail_A/configuration",
        body,
      } as MedusaRequest)
      expect(operation?.policy.permissions ?? null).toEqual(permissions)
    }
  )

  it.each(contract.selections)(
    "$resource retains its reviewed field boundary: $fields",
    ({ resource, fields, allowed }) => {
      expect(validateFieldSelection(resource, fields)).toBe(allowed)
    }
  )
})
