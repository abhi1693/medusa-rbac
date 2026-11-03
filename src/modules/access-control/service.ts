import {
  createAccessConfig,
  validateRules,
  evaluatePermission,
  type AccessControlOptions,
  type PermissionRule,
  type PermissionContext,
} from "../../lib/access/config"
import type { MedusaRequest } from "@medusajs/framework/http"
import { hasPermissionCandidate } from "../../lib/access/permission-key"
import {
  SUPERUSER_ROLE,
  configuredRoleKey,
  roleSource,
  type RoleSource,
} from "../../lib/access/roles"
import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import {
  InjectManager,
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
  Modules,
} from "@medusajs/framework/utils"
import type {
  IUserModuleService,
  ICustomerModuleService,
  Context,
} from "@medusajs/framework/types"
import type { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import AccessRole from "./models/access-role"
import ActorAccess from "./models/actor-access"
import AccessAudit from "./models/access-audit"
import RoleAssignment from "./models/role-assignment"
import InvitationAccess from "./models/invitation-access"
import InvitationRole from "./models/invitation-role"
import {
  validatePermissions,
  type AccessPrincipal,
  type Permission,
} from "../../lib/access/permissions"

export type Role = {
  id: string
  key: string
  name: string
  permissions: Permission[]
  rules?: PermissionRule[]
  is_superuser: boolean
  version: number
  created_at?: string
  source?: RoleSource
  actor_count?: number
  pending_invitation_count?: number
  configuration_status?: "active" | "removed"
}
export type RoleActor = {
  actor_type: string
  actor_id: string
  active: boolean
}
export type RoleSynchronization = {
  created: number
  updated: number
  revoked: number
}
export type ActorAccessRecord = {
  id: string
  actor_id: string
  actor_type: string
  active: boolean
  role_ids: string[]
  version: number
  deleted_at?: string | null
}
export type UserDeletion = {
  actor_id: string
  user_id: string
  access_id: string
  version: number
  previous_active: boolean | null
  role_ids: string[]
}
export type ActorReference = { id: string; type: string }
type Mutation =
  | {
      kind: "record_invite"
      invite_id: string
      email: string
      role_ids: string[]
    }
  | { kind: "accept_invite"; invite_id: string; user_id: string }
  | { kind: "cancel_invite"; invite_id: string }
  | {
      kind: "create_role"
      name: string
      permissions: Permission[]
      rules?: PermissionRule[]
    }
  | {
      kind: "update_role"
      id: string
      name: string
      permissions: Permission[]
      rules?: PermissionRule[]
      version: number
    }
  | { kind: "delete_role"; id: string; version: number }
  | {
      kind: "set_actor"
      actor: ActorReference
      role_ids: string[]
      active: boolean
      version: number
    }
  | {
      kind: "set_staff"
      user_id: string
      role_ids: string[]
      active: boolean
      version: number
    }

const forbidden = (message: string): never => {
  throw new MedusaError(MedusaError.Types.FORBIDDEN, message)
}
const invalid = (message: string): never => {
  throw new MedusaError(MedusaError.Types.INVALID_DATA, message)
}
const conflict = (): never => {
  throw new MedusaError(
    MedusaError.Types.CONFLICT,
    "Access changed; reload and try again"
  )
}

const roleColumns =
  "r.*, (select count(*) from rbac_role_assignment a join rbac_actor_access s on s.id = a.access_id where a.role_id = r.id and a.deleted_at is null and s.deleted_at is null) as actor_count, (select count(*) from rbac_invitation_role a join rbac_invitation_access i on i.id = a.invitation_id where a.role_id = r.id and a.deleted_at is null and i.deleted_at is null and i.status = 'pending') as pending_invitation_count"

class AccessControlService extends MedusaService({
  AccessRole,
  ActorAccess,
  AccessAudit,
  RoleAssignment,
  InvitationAccess,
  InvitationRole,
}) {
  protected accessConfig_?: ReturnType<typeof createAccessConfig>
  constructor(
    container: Record<string, unknown>,
    options: AccessControlOptions = {}
  ) {
    super(...arguments)
    this.accessConfig_ = createAccessConfig(options)
  }

  get configuration() {
    return this.accessConfig_ || createAccessConfig()
  }
  permissionDefinitions() {
    return this.configuration.permissions
  }
  validatePermissions(values: unknown) {
    try {
      return validatePermissions(values, this.configuration.ids)
    } catch (error) {
      return invalid((error as Error).message)
    }
  }
  validateRules(values: unknown) {
    try {
      return validateRules(values, this.configuration.ids)
    } catch (error) {
      return invalid((error as Error).message)
    }
  }
  private validateEditableRoleName(name: string): string {
    const normalized = name.trim()
    if (normalized.toLowerCase() === SUPERUSER_ROLE.name.toLowerCase())
      invalid("The Superuser name is reserved for the system role")
    if (
      this.configuration.roles.some(
        (role) => role.name.toLowerCase() === normalized.toLowerCase()
      )
    )
      invalid("This role name is reserved by application configuration")
    return normalized
  }
  /** Static inspection only; never a substitute for request resolution and enforcement. */
  policyFor(method: string, path: string) {
    return this.configuration.policyFor(method, path)
  }
  resolveRequest(request: MedusaRequest) {
    return this.configuration.resolveRequest(request)
  }
  async permissionContext(request: MedusaRequest): Promise<PermissionContext> {
    const auth = (request as any).auth_context
    const context: PermissionContext = {}
    for (const resolve of this.configuration.contextResolvers)
      Object.assign(context, await resolve(request))
    // Actor identity and route are always server-owned, even with custom resolvers.
    return {
      ...context,
      actor_id: auth?.actor_id || null,
      actor_type: auth?.actor_type || null,
      route: request.originalUrl.split("?")[0],
      method: request.method,
    }
  }
  async validateActor(
    actor: ActorReference,
    request: MedusaRequest
  ): Promise<void> {
    if (actor.type === "user") {
      await request.scope
        .resolve<IUserModuleService>(Modules.USER)
        .retrieveUser(actor.id, { select: ["id"] })
    } else if (actor.type === "customer") {
      await request.scope
        .resolve<ICustomerModuleService>(Modules.CUSTOMER)
        .retrieveCustomer(actor.id, { select: ["id"] })
    } else {
      const provider = this.configuration.actors.find(
        (provider) => provider.type === actor.type
      )
      if (!provider) return invalid("Unknown actor type")
      await provider.validate(actor.id, request)
    }
  }
  async principalForRequest(
    request: MedusaRequest
  ): Promise<AccessPrincipal | null> {
    const auth = (request as any).auth_context
    if (
      !auth?.actor_id ||
      ![
        "user",
        "customer",
        ...this.configuration.actors.map((actor) => actor.type),
      ].includes(auth.actor_type)
    )
      return null
    const actor = { type: auth.actor_type, id: auth.actor_id }
    await this.validateActor(actor, request)
    return this.actorPrincipal(actor)
  }
  @InjectManager()
  async actorAccess(
    actor: ActorReference,
    @MedusaContext() context?: Context<EntityManager>
  ) {
    const manager = context!.transactionManager || context!.manager!
    const [access] = await manager.execute<ActorAccessRecord[]>(
      "select s.*, coalesce((select jsonb_agg(a.role_id order by a.role_id) from rbac_role_assignment a where a.access_id = s.id and a.deleted_at is null), '[]'::jsonb) as role_ids from rbac_actor_access s where s.actor_type = ? and s.actor_id = ? and s.deleted_at is null",
      [actor.type, actor.id]
    )
    return (
      access || {
        actor_type: actor.type,
        actor_id: actor.id,
        active: false,
        role_ids: [],
        version: 0,
      }
    )
  }
  allows(
    principal: AccessPrincipal,
    permission: string,
    context: PermissionContext = {}
  ) {
    return (
      this.configuration.ids.includes(permission) &&
      evaluatePermission(principal, permission, context)
    )
  }

  permissionCandidates(principal: AccessPrincipal) {
    return this.configuration.ids.filter((permission) =>
      hasPermissionCandidate(principal, permission)
    )
  }

  @InjectManager()
  async prepareUserDeletion(
    actorId: string,
    userId: string,
    @MedusaContext() context?: Context<EntityManager>
  ) {
    return this.prepareUserDeletionTransaction(actorId, userId, context)
  }

  @InjectTransactionManager()
  protected async prepareUserDeletionTransaction(
    actorId: string,
    userId: string,
    @MedusaContext() context?: Context<EntityManager>
  ): Promise<UserDeletion> {
    const manager = context!.transactionManager!
    await this.requireSuperuser(actorId, manager)
    if (actorId === userId)
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "You cannot delete your own account"
      )
    const [staff] = await manager.execute<ActorAccessRecord[]>(
      "select * from rbac_actor_access where actor_id = ? and actor_type = 'user' order by created_at desc limit 1",
      [userId]
    )
    if (staff?.deleted_at) conflict()
    const assignments = staff
      ? await manager.execute<{ role_id: string }[]>(
          "select role_id from rbac_role_assignment where access_id = ? and deleted_at is null",
          [staff.id]
        )
      : []
    const deletion: UserDeletion = {
      actor_id: actorId,
      user_id: userId,
      access_id: staff ? staff.id : `rbas_${randomUUID()}`,
      version: staff ? staff.version + 1 : 1,
      previous_active: staff ? staff.active : null,
      role_ids: assignments.map((assignment) => assignment.role_id),
    }
    // Archive before the native workflow runs. This also blocks concurrent role assignment.
    if (staff)
      await manager.execute(
        "update rbac_actor_access set active = false, deleted_at = now(), updated_at = now(), version = version + 1 where id = ?",
        [staff.id]
      )
    else
      await manager.execute(
        "insert into rbac_actor_access (id, actor_type, actor_id, active, version, deleted_at) values (?, 'user', ?, false, 1, now())",
        [deletion.access_id, userId]
      )
    await this.ensureSuperuserRemains(manager)
    await this.writeAudit(
      manager,
      actorId,
      "prepare_user_deletion",
      userId,
      deletion
    )
    return deletion
  }

  @InjectManager()
  async settleUserDeletion(
    deletion: UserDeletion,
    outcome: "deleted" | "restore",
    @MedusaContext() context?: Context<EntityManager>
  ) {
    return this.settleUserDeletionTransaction(deletion, outcome, context)
  }

  @InjectTransactionManager()
  protected async settleUserDeletionTransaction(
    deletion: UserDeletion,
    outcome: "deleted" | "restore",
    @MedusaContext() context?: Context<EntityManager>
  ) {
    const manager = context!.transactionManager!
    await manager.execute("select pg_advisory_xact_lock(718231910)")
    const [staff] = await manager.execute<ActorAccessRecord[]>(
      "select * from rbac_actor_access where id = ?",
      [deletion.access_id]
    )
    if (
      !staff ||
      !staff.deleted_at ||
      staff.version !== deletion.version ||
      staff.actor_id !== deletion.user_id ||
      staff.actor_type !== "user"
    ) {
      if (outcome === "restore") return
      conflict()
    }
    if (outcome === "restore") {
      if (deletion.previous_active === null)
        await manager.execute("delete from rbac_actor_access where id = ?", [
          staff.id,
        ])
      else
        await manager.execute(
          "update rbac_actor_access set active = ?, deleted_at = null, version = version + 1, updated_at = now() where id = ?",
          [deletion.previous_active, staff.id]
        )
    } else {
      await manager.execute(
        "delete from rbac_role_assignment where access_id = ?",
        [staff.id]
      )
      await manager.execute(
        "update rbac_actor_access set version = version + 1, updated_at = now() where id = ?",
        [staff.id]
      )
    }
    await this.writeAudit(
      manager,
      deletion.actor_id,
      outcome === "deleted" ? "delete_user" : "restore_user_access",
      deletion.user_id,
      deletion
    )
  }

  private async requireSuperuser(actorId: string, manager: EntityManager) {
    await manager.execute("select pg_advisory_xact_lock(718231910)")
    const actor = await this.principalWithManager(actorId, manager)
    if (!actor.active || !actor.is_superuser)
      forbidden("Only Superusers can manage access")
  }

  private async ensureSuperuserRemains(manager: EntityManager) {
    const [remaining] = await manager.execute<{ count: string }[]>(
      "select count(distinct s.id) as count from rbac_actor_access s join rbac_role_assignment a on a.access_id = s.id join rbac_access_role r on r.id = a.role_id where s.actor_type = 'user' and s.active = true and s.deleted_at is null and a.deleted_at is null and r.deleted_at is null and r.is_superuser = true"
    )
    if (Number(remaining.count) === 0)
      invalid("At least one active Superuser must remain")
  }

  @InjectManager()
  async invitation(
    inviteId: string,
    @MedusaContext() context?: Context<EntityManager>
  ) {
    const manager = context!.transactionManager || context!.manager!
    const [invitation] = await manager.execute<
      {
        id: string
        invite_id: string
        email: string
        actor_id: string
        status: "pending" | "accepted" | "cancelled"
        user_id: string | null
        role_ids: string[]
      }[]
    >(
      "select i.*, coalesce((select jsonb_agg(a.role_id order by a.role_id) from rbac_invitation_role a where a.invitation_id = i.id and a.deleted_at is null), '[]'::jsonb) as role_ids from rbac_invitation_access i where i.invite_id = ? and i.deleted_at is null",
      [inviteId]
    )
    return invitation
  }

  @InjectManager()
  async invitationSummaries(
    inviteIds: string[],
    @MedusaContext() context?: Context<EntityManager>
  ) {
    if (!inviteIds.length) return []
    const manager = context!.transactionManager || context!.manager!
    return manager.execute<
      {
        invite_id: string
        email: string
        actor_id: string
        status: string
        role_ids: string[]
        roles: { id: string; name: string }[]
      }[]
    >(
      "select i.invite_id, i.email, i.actor_id, i.status, coalesce((select jsonb_agg(r.id order by r.name) from rbac_invitation_role a join rbac_access_role r on r.id = a.role_id where a.invitation_id = i.id and a.deleted_at is null and r.deleted_at is null), '[]'::jsonb) as role_ids, coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.name) from rbac_invitation_role a join rbac_access_role r on r.id = a.role_id where a.invitation_id = i.id and a.deleted_at is null and r.deleted_at is null), '[]'::jsonb) as roles from rbac_invitation_access i where i.deleted_at is null and i.invite_id in (select jsonb_array_elements_text(?::jsonb))",
      [JSON.stringify(inviteIds)]
    )
  }
  @InjectManager()
  async actorPrincipal(
    actor: ActorReference,
    @MedusaContext() context?: Context<EntityManager>
  ): Promise<AccessPrincipal> {
    return this.principalWithManager(
      actor.id,
      context!.transactionManager || context!.manager!,
      actor.type
    )
  }

  @InjectManager()
  async principal(
    userId: string,
    @MedusaContext() context?: Context<EntityManager>
  ): Promise<AccessPrincipal> {
    return this.principalWithManager(
      userId,
      context!.transactionManager || context!.manager!
    )
  }

  private async principalWithManager(
    userId: string,
    manager: EntityManager,
    actorType = "user"
  ): Promise<AccessPrincipal> {
    const [subject] = await manager.execute<ActorAccessRecord[]>(
      "select * from rbac_actor_access where actor_id = ? and actor_type = ? and deleted_at is null",
      [userId, actorType]
    )
    if (!subject?.active)
      return {
        actor_id: userId,
        actor_type: actorType,
        active: false,
        is_superuser: false,
        role_ids: [],
        permissions: [],
      }
    const persisted = await manager.execute<Role[]>(
      "select r.* from rbac_access_role r join rbac_role_assignment a on a.role_id = r.id where a.access_id = ? and a.deleted_at is null and r.deleted_at is null",
      [subject.id]
    )
    const assigned = persisted
      .filter((role) => actorType === "user" || !role.is_superuser)
      .map((role) => this.effectiveRole(role))
    return {
      actor_id: userId,
      actor_type: actorType,
      active: true,
      ...(assigned.some((r) => r.rules?.length)
        ? {
            rules: assigned.flatMap((r) =>
              validateRules(r.rules, this.configuration.ids)
            ),
          }
        : {}),
      role_ids: assigned.map((r) => r.id),
      is_superuser: assigned.some((r) => r.is_superuser),
      permissions: [
        ...new Set(
          assigned.flatMap((r) =>
            r.is_superuser
              ? this.configuration.ids
              : this.validatePermissions(r.permissions)
          )
        ),
      ],
    }
  }

  @InjectManager()
  async snapshot(
    userIds: string[] = [],
    @MedusaContext() context?: Context<EntityManager>
  ) {
    const manager = context!.transactionManager || context!.manager!
    return {
      roles: (
        await manager.execute<Role[]>(
          `select ${roleColumns} from rbac_access_role r where r.deleted_at is null order by r.is_superuser desc, r.name, r.id`
        )
      ).map((role) => this.presentRole(role)),
      staff: userIds.length
        ? await manager.execute<ActorAccessRecord[]>(
            "select s.*, coalesce((select jsonb_agg(a.role_id order by a.role_id) from rbac_role_assignment a where a.access_id = s.id and a.deleted_at is null), '[]'::jsonb) as role_ids from rbac_actor_access s where s.actor_type = 'user' and s.deleted_at is null and s.actor_id in (select jsonb_array_elements_text(?::jsonb)) order by s.created_at, s.id",
            [JSON.stringify(userIds)]
          )
        : [],
    }
  }

  private effectiveRole(role: Role): Role {
    if (
      roleSource(role) === "configuration" &&
      !this.configuration.roles.some(
        (definition) => configuredRoleKey(definition.key) === role.key
      )
    )
      return { ...role, permissions: [], rules: [] }
    return role
  }

  private presentRole(persisted: Role): Role {
    const role = this.effectiveRole(persisted)
    const source = roleSource(role)
    return {
      ...role,
      permissions: role.is_superuser
        ? this.configuration.ids
        : role.permissions,
      source,
      actor_count: Number(role.actor_count || 0),
      pending_invitation_count: Number(role.pending_invitation_count || 0),
      ...(source === "configuration"
        ? {
            configuration_status: this.configuration.roles.some(
              (definition) => configuredRoleKey(definition.key) === role.key
            )
              ? "active"
              : "removed",
          }
        : {}),
    }
  }

  @InjectManager()
  async roleDetail(
    id: string,
    pagination: { offset?: number; limit?: number } = {},
    @MedusaContext() context?: Context<EntityManager>
  ) {
    const offset = pagination.offset ?? 0
    const limit = pagination.limit ?? 20
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      invalid("Role pagination requires a nonnegative offset and limit 1–100")
    const manager = context!.transactionManager || context!.manager!
    const [role] = await manager.execute<Role[]>(
      `select ${roleColumns} from rbac_access_role r where r.deleted_at is null and r.id = ?`,
      [id]
    )
    if (!role)
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Role not found")
    const actors = await manager.execute<RoleActor[]>(
      "select s.actor_type, s.actor_id, s.active from rbac_role_assignment a join rbac_actor_access s on s.id = a.access_id where a.role_id = ? and a.deleted_at is null and s.deleted_at is null order by s.actor_type, s.actor_id limit ? offset ?",
      [id, limit, offset]
    )
    const detail = this.presentRole(role)
    return {
      role: detail,
      actors,
      actor_count: detail.actor_count!,
      pending_invitation_count: detail.pending_invitation_count!,
      offset,
      limit,
    }
  }

  @InjectManager()
  async syncConfiguredRoles(
    @MedusaContext() context?: Context<EntityManager>
  ): Promise<RoleSynchronization> {
    return this.syncConfiguredRolesTransaction(context)
  }

  @InjectTransactionManager()
  protected async syncConfiguredRolesTransaction(
    @MedusaContext() context?: Context<EntityManager>
  ): Promise<RoleSynchronization> {
    const manager = context!.transactionManager!
    await manager.execute("select pg_advisory_xact_lock(718231910)")
    const roles = await manager.execute<Role[]>(
      "select * from rbac_access_role where deleted_at is null"
    )
    return this.synchronizeRoleRecords(manager, roles)
  }

  private async synchronizeRoleRecords(
    manager: EntityManager,
    roles: Role[]
  ): Promise<RoleSynchronization> {
    const result: RoleSynchronization = { created: 0, updated: 0, revoked: 0 }
    const keys = new Set(
      this.configuration.roles.map((definition) =>
        configuredRoleKey(definition.key)
      )
    )
    for (const definition of this.configuration.roles) {
      const key = configuredRoleKey(definition.key)
      const existing = roles.find((role) => role.key === key)
      if (existing?.is_superuser)
        invalid("A configured role cannot replace the protected Superuser")
      if (
        roles.some(
          (role) =>
            role.key !== key &&
            role.name.trim().toLowerCase() === definition.name.toLowerCase() &&
            !(roleSource(role) === "configuration" && keys.has(role.key))
        )
      )
        invalid(
          `Configured role name conflicts with another role: ${definition.name}`
        )
      if (
        existing &&
        existing.name === definition.name &&
        isDeepStrictEqual(existing.permissions, definition.permissions) &&
        isDeepStrictEqual(existing.rules || [], definition.rules)
      )
        continue
      let after: Role
      if (existing) {
        ;[after] = await manager.execute<Role[]>(
          "update rbac_access_role set name = ?, permissions = ?::jsonb, rules = ?::jsonb, version = version + 1, updated_at = now() where id = ? returning *",
          [
            definition.name,
            JSON.stringify(definition.permissions),
            JSON.stringify(definition.rules),
            existing.id,
          ]
        )
        result.updated++
      } else {
        ;[after] = await manager.execute<Role[]>(
          "insert into rbac_access_role (id, key, name, permissions, is_superuser, version, rules) values (?, ?, ?, ?::jsonb, false, 1, ?::jsonb) returning *",
          [
            `rbar_${randomUUID()}`,
            key,
            definition.name,
            JSON.stringify(definition.permissions),
            JSON.stringify(definition.rules),
          ]
        )
        result.created++
      }
      await this.writeAudit(
        manager,
        "system:configuration",
        "sync_configured_role",
        after.id,
        { before: existing || null, after }
      )
    }
    for (const role of roles) {
      if (
        roleSource(role) !== "configuration" ||
        keys.has(role.key) ||
        (!role.permissions.length && !role.rules?.length)
      )
        continue
      const [after] = await manager.execute<Role[]>(
        "update rbac_access_role set permissions = '[]'::jsonb, rules = '[]'::jsonb, version = version + 1, updated_at = now() where id = ? returning *",
        [role.id]
      )
      await this.writeAudit(
        manager,
        "system:configuration",
        "revoke_configured_role",
        role.id,
        { before: role, after }
      )
      result.revoked++
    }
    return result
  }

  @InjectManager()
  async auditPage(
    offset: number,
    limit: number,
    @MedusaContext() context?: Context<EntityManager>
  ) {
    const manager = context!.manager!
    const events = await manager.execute(
      "select id, actor_id, action, target_id, detail, created_at from rbac_access_audit where deleted_at is null order by created_at desc, id desc limit ? offset ?",
      [limit, offset]
    )
    const [count] = await manager.execute<{ count: string }[]>(
      "select count(*) as count from rbac_access_audit where deleted_at is null"
    )
    return { events, count: Number(count.count), offset, limit }
  }

  @InjectManager()
  async mutate(
    actorId: string,
    input: Mutation,
    @MedusaContext() context?: Context<EntityManager>
  ) {
    return this.mutateTransaction(actorId, input, context)
  }

  @InjectTransactionManager()
  protected async mutateTransaction(
    actorId: string,
    input: Mutation,
    @MedusaContext() context?: Context<EntityManager>
  ) {
    const manager = context!.transactionManager!
    // Serialize access mutations across processes, including authorization and last-admin checks.
    await this.requireSuperuser(actorId, manager)
    let targetId: string
    let before: unknown = null
    let after: unknown = null
    if (input.kind === "record_invite") {
      const ids = [...new Set(input.role_ids)]
      const roles = await manager.execute<Role[]>(
        "select * from rbac_access_role where deleted_at is null"
      )
      if (
        !ids.length ||
        ids.some((id) => !roles.some((role) => role.id === id))
      )
        invalid("Select at least one existing role")
      targetId = input.invite_id
      const id = `rbia_${randomUUID()}`
      await manager.execute(
        "insert into rbac_invitation_access (id, invite_id, email, actor_id, status) values (?, ?, ?, ?, 'pending')",
        [id, input.invite_id, input.email, actorId]
      )
      for (const roleId of ids)
        await manager.execute(
          "insert into rbac_invitation_role (id, invitation_id, role_id) values (?, ?, ?)",
          [`rbir_${randomUUID()}`, id, roleId]
        )
      after = { invite_id: input.invite_id, email: input.email, role_ids: ids }
    } else if (
      input.kind === "accept_invite" ||
      input.kind === "cancel_invite"
    ) {
      const invitation = await this.invitation(input.invite_id, context)
      if (!invitation || invitation.status !== "pending")
        invalid("Invitation access is no longer pending")
      targetId = input.invite_id
      before = invitation
      if (input.kind === "accept_invite") {
        if (invitation.actor_id !== actorId)
          forbidden("The inviting superuser must authorize this access")
        await this.mutateTransaction(
          actorId,
          {
            kind: "set_staff",
            user_id: input.user_id,
            role_ids: invitation.role_ids,
            active: true,
            version: 0,
          },
          context
        )
        await manager.execute(
          "update rbac_invitation_access set status = 'accepted', user_id = ?, updated_at = now() where id = ?",
          [input.user_id, invitation.id]
        )
        after = { ...invitation, status: "accepted", user_id: input.user_id }
      } else {
        await manager.execute(
          "update rbac_invitation_access set status = 'cancelled', updated_at = now() where id = ?",
          [invitation.id]
        )
        after = { ...invitation, status: "cancelled" }
      }
      await manager.execute(
        "delete from rbac_invitation_role where invitation_id = ?",
        [invitation.id]
      )
    } else if (input.kind === "set_staff" || input.kind === "set_actor") {
      const target =
        input.kind === "set_staff"
          ? { type: "user", id: input.user_id }
          : input.actor
      if (
        ![
          "user",
          "customer",
          ...this.configuration.actors.map((actor) => actor.type),
        ].includes(target.type) ||
        !target.id
      )
        invalid("Unknown actor type or identifier")
      const ids = [...new Set(input.role_ids)]
      const roles = await manager.execute<Role[]>(
        "select * from rbac_access_role where deleted_at is null"
      )
      if (ids.some((id) => !roles.some((r) => r.id === id)))
        invalid("Unknown role")
      if (
        target.type !== "user" &&
        roles.some((role) => role.is_superuser && ids.includes(role.id))
      )
        forbidden("Superuser can only be assigned to admin users")
      const [subject] = await manager.execute<ActorAccessRecord[]>(
        "select * from rbac_actor_access where actor_id = ? and actor_type = ? order by created_at desc limit 1",
        [target.id, target.type]
      )
      if (subject?.deleted_at) conflict()
      if ((subject?.version || 0) !== input.version) conflict()
      const previousAssignments = subject
        ? await manager.execute<{ role_id: string }[]>(
            "select role_id from rbac_role_assignment where access_id = ? and deleted_at is null",
            [subject.id]
          )
        : []
      before = subject
        ? { ...subject, role_ids: previousAssignments.map((a) => a.role_id) }
        : null
      targetId = target.id
      if (subject) {
        await manager.execute(
          "update rbac_actor_access set active = ?, version = version + 1, updated_at = now() where id = ?",
          [input.active, subject.id]
        )
      } else {
        await manager.execute(
          "insert into rbac_actor_access (id, actor_type, actor_id, active, version) values (?, ?, ?, ?, 1)",
          [`rbas_${randomUUID()}`, target.type, target.id, input.active]
        )
      }
      const [current] = await manager.execute<ActorAccessRecord[]>(
        "select * from rbac_actor_access where actor_id = ? and actor_type = ? and deleted_at is null",
        [target.id, target.type]
      )
      await manager.execute(
        "delete from rbac_role_assignment where access_id = ?",
        [current.id]
      )
      for (const roleId of ids)
        await manager.execute(
          "insert into rbac_role_assignment (id, access_id, role_id) values (?, ?, ?)",
          [`rbra_${randomUUID()}`, current.id, roleId]
        )
      await this.ensureSuperuserRemains(manager)
      after = { ...current, role_ids: ids }
    } else if (input.kind === "create_role") {
      const name = this.validateEditableRoleName(input.name)
      const permissions = this.validatePermissions(input.permissions)
      const rules = this.validateRules(input.rules)
      targetId = `rbar_${randomUUID()}`
      ;[after] = await manager.execute(
        "insert into rbac_access_role (id, key, name, permissions, is_superuser, version, rules) values (?, ?, ?, ?::jsonb, false, 1, ?::jsonb) returning *",
        [
          targetId,
          `custom_${randomUUID()}`,
          name,
          JSON.stringify(permissions),
          JSON.stringify(rules),
        ]
      )
    } else {
      const [role] = await manager.execute<Role[]>(
        "select * from rbac_access_role where id = ? and deleted_at is null",
        [input.id]
      )
      if (!role)
        throw new MedusaError(MedusaError.Types.NOT_FOUND, "Role not found")
      if (role.is_superuser) forbidden("The Superuser role is protected")
      if (roleSource(role) === "configuration")
        forbidden("This role is managed in application configuration")
      if (role.version !== input.version) conflict()
      targetId = role.id
      before = role
      if (input.kind === "delete_role") {
        const [used] = await manager.execute<{ count: string }[]>(
          "select (select count(*) from rbac_role_assignment where deleted_at is null and role_id = ?) + (select count(*) from rbac_invitation_role a join rbac_invitation_access i on i.id = a.invitation_id where a.deleted_at is null and i.deleted_at is null and i.status = 'pending' and a.role_id = ?) as count",
          [role.id, role.id]
        )
        if (Number(used.count))
          invalid(
            "Reassign staff or revoke pending invitations before deleting this role"
          )
        await manager.execute(
          "update rbac_access_role set deleted_at = now(), updated_at = now(), version = version + 1 where id = ?",
          [role.id]
        )
      } else {
        const name = this.validateEditableRoleName(input.name)
        ;[after] = await manager.execute(
          "update rbac_access_role set name = ?, permissions = ?::jsonb, rules = ?::jsonb, version = version + 1, updated_at = now() where id = ? returning *",
          [
            name,
            JSON.stringify(this.validatePermissions(input.permissions)),
            JSON.stringify(this.validateRules(input.rules)),
            role.id,
          ]
        )
      }
    }
    await this.writeAudit(manager, actorId, input.kind, targetId!, {
      before,
      after,
    })
    return { result: after }
  }

  private async writeAudit(
    manager: EntityManager,
    actorId: string,
    action: string,
    targetId: string,
    detail: unknown
  ) {
    await manager.execute(
      "insert into rbac_access_audit (id, actor_id, action, target_id, detail) values (?, ?, ?, ?, ?::jsonb)",
      [
        `rbaa_${randomUUID()}`,
        actorId,
        action,
        targetId,
        JSON.stringify(detail),
      ]
    )
  }

  @InjectManager()
  async bootstrap(
    userId: string,
    @MedusaContext() context?: Context<EntityManager>
  ) {
    return this.bootstrapTransaction(userId, context)
  }

  @InjectTransactionManager()
  protected async bootstrapTransaction(
    userId: string,
    @MedusaContext() context?: Context<EntityManager>
  ) {
    const manager = context!.transactionManager!
    await manager.execute("select pg_advisory_xact_lock(718231910)")
    const roles = await manager.execute<Role[]>(
      "select * from rbac_access_role where deleted_at is null"
    )
    await this.synchronizeRoleRecords(manager, roles)
    const adminRole = roles.find((r) => r.is_superuser)
    if (adminRole) {
      const principal = await this.principalWithManager(userId, manager)
      if (principal.active && principal.is_superuser) return { created: false }
      forbidden(
        "Access has already been bootstrapped; use a Superuser to assign access"
      )
    }
    const id = `rbar_${randomUUID()}`
    await manager.execute(
      "insert into rbac_access_role (id, key, name, permissions, is_superuser, version) values (?, ?, ?, ?::jsonb, true, 1)",
      [
        id,
        SUPERUSER_ROLE.key,
        SUPERUSER_ROLE.name,
        JSON.stringify(this.configuration.ids),
      ]
    )
    const staffId = `rbas_${randomUUID()}`
    await manager.execute(
      "insert into rbac_actor_access (id, actor_type, actor_id, active, version) values (?, 'user', ?, true, 1)",
      [staffId, userId]
    )
    await manager.execute(
      "insert into rbac_role_assignment (id, access_id, role_id) values (?, ?, ?)",
      [`rbra_${randomUUID()}`, staffId, id]
    )
    await this.writeAudit(manager, userId, "bootstrap_superuser", userId, {
      role_id: id,
    })
    return { created: true }
  }
}

export default AccessControlService
