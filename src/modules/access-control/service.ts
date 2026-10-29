import {
  createAccessConfig,
  validateRules,
  evaluatePermission,
  type AccessControlOptions,
  type PermissionRule,
  type PermissionContext,
} from "../../lib/access/config"
import type { MedusaRequest } from "@medusajs/framework/http"
import { randomUUID } from "node:crypto"
import {
  InjectManager,
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
  Modules,
} from "@medusajs/framework/utils"
import type { IUserModuleService, Context } from "@medusajs/framework/types"
import type { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import AccessRole from "./models/access-role"
import StaffAccess from "./models/staff-access"
import AccessAudit from "./models/access-audit"
import RoleAssignment from "./models/role-assignment"
import InvitationAccess from "./models/invitation-access"
import InvitationRole from "./models/invitation-role"
import {
  validatePermissions,
  type AccessPrincipal,
  type Permission,
} from "../../lib/access/permissions"

type Role = {
  id: string
  key: string
  name: string
  permissions: Permission[]
  rules?: PermissionRule[]
  is_superuser: boolean
  version: number
}
type Staff = {
  id: string
  user_id: string
  active: boolean
  role_ids: string[]
  version: number
  deleted_at?: string | null
}
export type UserDeletion = {
  actor_id: string
  user_id: string
  staff_id: string
  version: number
  previous_active: boolean | null
  role_ids: string[]
}
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

class AccessControlService extends MedusaService({
  AccessRole,
  StaffAccess,
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
  policyFor(method: string, path: string) {
    return this.configuration.policyFor(method, path)
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
  async principalForRequest(
    request: MedusaRequest
  ): Promise<AccessPrincipal | null> {
    const auth = (request as any).auth_context
    if (!auth?.actor_id) return null
    if (auth.actor_type === "user") {
      await request.scope
        .resolve<IUserModuleService>(Modules.USER)
        .retrieveUser(auth.actor_id, { select: ["id"] })
      return this.principal(auth.actor_id)
    }
    const actor = this.configuration.actors.find(
      (actor) => actor.type === auth.actor_type
    )
    return actor ? actor.resolve(auth.actor_id, request) : null
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
    const [staff] = await manager.execute<Staff[]>(
      "select * from rbac_staff_access where user_id = ? order by created_at desc limit 1",
      [userId]
    )
    if (staff?.deleted_at) conflict()
    const assignments = staff
      ? await manager.execute<{ role_id: string }[]>(
          "select role_id from rbac_role_assignment where staff_id = ? and deleted_at is null",
          [staff.id]
        )
      : []
    const deletion: UserDeletion = {
      actor_id: actorId,
      user_id: userId,
      staff_id: staff ? staff.id : `usa_${randomUUID()}`,
      version: staff ? staff.version + 1 : 1,
      previous_active: staff ? staff.active : null,
      role_ids: assignments.map((assignment) => assignment.role_id),
    }
    // Archive before the native workflow runs. This also blocks concurrent role assignment.
    if (staff)
      await manager.execute(
        "update rbac_staff_access set active = false, deleted_at = now(), updated_at = now(), version = version + 1 where id = ?",
        [staff.id]
      )
    else
      await manager.execute(
        "insert into rbac_staff_access (id, user_id, active, version, deleted_at) values (?, ?, false, 1, now())",
        [deletion.staff_id, userId]
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
    const [staff] = await manager.execute<Staff[]>(
      "select * from rbac_staff_access where id = ?",
      [deletion.staff_id]
    )
    if (
      !staff ||
      !staff.deleted_at ||
      staff.version !== deletion.version ||
      staff.user_id !== deletion.user_id
    ) {
      if (outcome === "restore") return
      conflict()
    }
    if (outcome === "restore") {
      if (deletion.previous_active === null)
        await manager.execute("delete from rbac_staff_access where id = ?", [
          staff.id,
        ])
      else
        await manager.execute(
          "update rbac_staff_access set active = ?, deleted_at = null, version = version + 1, updated_at = now() where id = ?",
          [deletion.previous_active, staff.id]
        )
    } else {
      await manager.execute(
        "delete from rbac_role_assignment where staff_id = ?",
        [staff.id]
      )
      await manager.execute(
        "update rbac_staff_access set version = version + 1, updated_at = now() where id = ?",
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
      "select count(distinct s.id) as count from rbac_staff_access s join rbac_role_assignment a on a.staff_id = s.id join rbac_access_role r on r.id = a.role_id where s.active = true and s.deleted_at is null and a.deleted_at is null and r.deleted_at is null and r.is_superuser = true"
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
    manager: EntityManager
  ): Promise<AccessPrincipal> {
    const [staff] = await manager.execute<Staff[]>(
      "select * from rbac_staff_access where user_id = ? and deleted_at is null",
      [userId]
    )
    if (!staff?.active)
      return {
        user_id: userId,
        active: false,
        is_superuser: false,
        role_ids: [],
        permissions: [],
      }
    const assigned = await manager.execute<Role[]>(
      "select r.* from rbac_access_role r join rbac_role_assignment a on a.role_id = r.id where a.staff_id = ? and a.deleted_at is null and r.deleted_at is null",
      [staff.id]
    )
    return {
      user_id: userId,
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
    const manager = context!.manager!
    return {
      roles: await manager.execute<Role[]>(
        "select * from rbac_access_role where deleted_at is null order by is_superuser desc, name"
      ),
      staff: userIds.length
        ? await manager.execute<Staff[]>(
            "select s.*, coalesce((select jsonb_agg(a.role_id order by a.role_id) from rbac_role_assignment a where a.staff_id = s.id and a.deleted_at is null), '[]'::jsonb) as role_ids from rbac_staff_access s where s.deleted_at is null and s.user_id in (select jsonb_array_elements_text(?::jsonb)) order by s.created_at, s.id",
            [JSON.stringify(userIds)]
          )
        : [],
    }
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
      const id = `uia_${randomUUID()}`
      await manager.execute(
        "insert into rbac_invitation_access (id, invite_id, email, actor_id, status) values (?, ?, ?, ?, 'pending')",
        [id, input.invite_id, input.email, actorId]
      )
      for (const roleId of ids)
        await manager.execute(
          "insert into rbac_invitation_role (id, invitation_id, role_id) values (?, ?, ?)",
          [`uir_${randomUUID()}`, id, roleId]
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
    } else if (input.kind === "set_staff") {
      const ids = [...new Set(input.role_ids)]
      const roles = await manager.execute<Role[]>(
        "select * from rbac_access_role where deleted_at is null"
      )
      if (ids.some((id) => !roles.some((r) => r.id === id)))
        invalid("Unknown role")
      const [staff] = await manager.execute<Staff[]>(
        "select * from rbac_staff_access where user_id = ? order by created_at desc limit 1",
        [input.user_id]
      )
      if (staff?.deleted_at) conflict()
      if ((staff?.version || 0) !== input.version) conflict()
      const previousAssignments = staff
        ? await manager.execute<{ role_id: string }[]>(
            "select role_id from rbac_role_assignment where staff_id = ? and deleted_at is null",
            [staff.id]
          )
        : []
      before = staff
        ? { ...staff, role_ids: previousAssignments.map((a) => a.role_id) }
        : null
      targetId = input.user_id
      if (staff) {
        await manager.execute(
          "update rbac_staff_access set active = ?, version = version + 1, updated_at = now() where id = ?",
          [input.active, staff.id]
        )
      } else {
        await manager.execute(
          "insert into rbac_staff_access (id, user_id, active, version) values (?, ?, ?, 1)",
          [`usa_${randomUUID()}`, input.user_id, input.active]
        )
      }
      const [current] = await manager.execute<Staff[]>(
        "select * from rbac_staff_access where user_id = ? and deleted_at is null",
        [input.user_id]
      )
      await manager.execute(
        "delete from rbac_role_assignment where staff_id = ?",
        [current.id]
      )
      for (const roleId of ids)
        await manager.execute(
          "insert into rbac_role_assignment (id, staff_id, role_id) values (?, ?, ?)",
          [`ura_${randomUUID()}`, current.id, roleId]
        )
      await this.ensureSuperuserRemains(manager)
      after = { ...current, role_ids: ids }
    } else if (input.kind === "create_role") {
      if (input.name.trim().toLowerCase() === "superuser")
        invalid("The Superuser name is reserved for the system role")
      const permissions = this.validatePermissions(input.permissions)
      const rules = this.validateRules(input.rules)
      targetId = `uar_${randomUUID()}`
      ;[after] = await manager.execute(
        "insert into rbac_access_role (id, key, name, permissions, is_superuser, version, rules) values (?, ?, ?, ?::jsonb, false, 1, ?::jsonb) returning *",
        [
          targetId,
          `custom_${randomUUID()}`,
          input.name.trim(),
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
        if (input.name.trim().toLowerCase() === "superuser")
          invalid("The Superuser name is reserved for the system role")
        ;[after] = await manager.execute(
          "update rbac_access_role set name = ?, permissions = ?::jsonb, rules = ?::jsonb, version = version + 1, updated_at = now() where id = ? returning *",
          [
            input.name.trim(),
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
      [`uaa_${randomUUID()}`, actorId, action, targetId, JSON.stringify(detail)]
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
    const adminRole = roles.find((r) => r.is_superuser)
    if (adminRole) {
      const principal = await this.principalWithManager(userId, manager)
      if (principal.active && principal.is_superuser) return { created: false }
      forbidden(
        "Access has already been bootstrapped; use a Superuser to assign access"
      )
    }
    const id = `uar_${randomUUID()}`
    await manager.execute(
      "insert into rbac_access_role (id, key, name, permissions, is_superuser, version) values (?, 'superuser', 'Superuser', ?::jsonb, true, 1)",
      [id, JSON.stringify(this.configuration.ids)]
    )
    const staffId = `usa_${randomUUID()}`
    await manager.execute(
      "insert into rbac_staff_access (id, user_id, active, version) values (?, ?, true, 1)",
      [staffId, userId]
    )
    await manager.execute(
      "insert into rbac_role_assignment (id, staff_id, role_id) values (?, ?, ?)",
      [`ura_${randomUUID()}`, staffId, id]
    )
    await this.writeAudit(manager, userId, "bootstrap_superuser", userId, {
      role_id: id,
    })
    return { created: true }
  }
}

export default AccessControlService
