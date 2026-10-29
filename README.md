# Medusa RBAC

Reusable access control for Medusa v2. Define permissions for your own modules, create roles in Admin, and enforce access on the server. The plugin includes role and staff management, invitations, live revocation, contextual permission rules and transactional access auditing.

**Superuser is the only built-in role.** Bootstrap explicitly assigns it to a chosen native Medusa user. No operational roles are created at installation, startup or bootstrap. Create all other roles through Admin or the API.

Targets Medusa **2.22.1**, without enabling native Enterprise RBAC.

## Install

Until an npm release is published, install from this repository, pinned to a reviewed commit:

```sh
npm install 'git+https://github.com/abhi1693/medusa-rbac.git#<commit>'
```

The Git dependency runs `prepare` to build server and Admin extensions. Node 22.22 or newer is required.

```ts
// medusa-config.ts
import { defineConfig } from "@medusajs/framework/utils"
import type { AccessControlOptions } from "@abhi1693/medusa-rbac/config"

const access: AccessControlOptions = {
  permissions: [["documents.read", "Read documents", "Documents"]],
  routes: [
    {
      method: "GET",
      path: "/admin/documents/:id",
      permissions: ["documents.read"],
    },
  ],
  contextResolvers: [
    async (request) => {
      // Resolve trusted scope from your own module, rather than accepting a tenant
      // identifier supplied by the client as proof of resource ownership.
      return { workspace_id: "your-resolved-workspace-id" }
    },
  ],
}

module.exports = defineConfig({
  featureFlags: { rbac: false, rbac_filter_fields: false },
  // ...projectConfig...
  plugins: [{ resolve: "@abhi1693/medusa-rbac", options: access }],
})
```

The plugin registers its module and Admin middleware. Do not register a second instance of the module or middleware in the host.

Run `npx medusa db:migrate`. Add an application CLI wrapper:

```ts
// src/scripts/bootstrap-superuser.ts
export { default } from "@abhi1693/medusa-rbac/bootstrap"
```

Set `RBAC_SUPERUSER_EMAIL` and run `npx medusa exec ./src/scripts/bootstrap-superuser.ts`. For a new user, supply `RBAC_SUPERUSER_PASSWORD` through a secret environment variable (at least 12 characters). Existing user credentials are preserved when no password is provided. Repeating bootstrap succeeds only for an existing active Superuser; it cannot elevate an unrelated account.

Open **Settings → Access management**. Create roles, select permissions or scoped rules, and assign one or more roles to native users.

## Configuration and extension points

| Option             | Purpose                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permissions`      | Additional `[identifier, label, group]` definitions. Duplicate or invalid identifiers fail startup. Native identifiers remain registered.                                                               |
| `routes`           | Explicit method/path policies for custom Admin APIs. Paths support named segments such as `:id`; `HEAD` uses the corresponding `GET` policy. Require every listed permission, or set `superuser: true`. |
| `contextResolvers` | Async functions deriving rule context from trusted application data. Actor identity, method and route remain server-owned.                                                                              |
| `actors`           | `{ type, validate(id, request) }` identity providers for custom actor types. Native users and customers are validated through Medusa’s User and Customer modules.                                       |

A custom API outside `/admin` can use the exported middleware after Medusa authentication:

```ts
import { authenticate, defineMiddlewares } from "@medusajs/framework/http"
import { requirePermission } from "@abhi1693/medusa-rbac/require-permission"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/documents/:id",
      method: "GET",
      middlewares: [
        authenticate("user", ["session", "bearer"]),
        requirePermission("documents.read"),
      ],
    },
  ],
})
```

Use the module's `allows(principal, permission, context)` for application workflow/service checks. HTTP middleware does not automatically authorize jobs, scripts or workflows invoked outside HTTP; those callers must establish an actor and check permissions themselves.

The module token is `ACCESS_CONTROL` from `@abhi1693/medusa-rbac/modules/access-control`; its service type is exported from `@abhi1693/medusa-rbac/service`. Admin SDK helpers are exported from `@abhi1693/medusa-rbac/admin/access`. The framework-independent storefront client is exported from `@abhi1693/medusa-rbac/client`. Both reuse Medusa authentication.

## Admin and storefront actors

Assignments are keyed by both `actor_type` and `actor_id`. Admin users and storefront customers share the permission engine while retaining separate identity and access records. Custom actor types can register an identity validator backed by their owning module.

Admin APIs require a native `user` identity. The protected Superuser role can only be assigned to admin users. Customer credentials cannot gain Admin access through role assignments, and an identifier reused across actor types does not share grants.

Use `GET` or `POST /admin/access/actors/:actor_type/:id` to inspect or update an actor's assignments as a Superuser. Writes require `role_ids`, `active` and the current `version`. Validate storefront routes with Medusa authentication before checking a registered storefront permission:

```ts
middlewares: [
  authenticate("customer", ["session", "bearer"]),
  requirePermission("store.documents.read"),
]
```

The module exposes `actorPrincipal({ type, id })`, `actorAccess({ type, id })` and the `set_actor` mutation for backend workflows. Native commerce Store APIs retain their normal behavior unless an application explicitly adds permission enforcement.

## Permission rules

An ordinary role has explicit `permissions` and optional `rules`. For example:

```json
{
  "name": "Regional order reader",
  "permissions": [],
  "rules": [
    {
      "permission": "orders.view",
      "effect": "allow",
      "priority": 10,
      "conditions": { "region_id": ["north", "south"] }
    }
  ]
}
```

Keys support exact identifiers, namespace suffix wildcards (`orders.*`) and `*`. A wildcard must match a registered permission. Conditions use scalar equality or membership in an array; missing context never matches. All conditions must match. There is no query-derived ownership assumption, arbitrary expression execution or automatic database row filtering. Configure a trusted resolver and scope the underlying query when granting access to a collection.

Matching rules from all assigned roles are evaluated together: higher priority, then exact key or more specific namespace, then more conditions, then deny on a tie. Explicit permission grants behave like an exact allow at priority zero. Superuser has all registered permissions, including later additions. Inactive accounts always deny. A broad grant can defeat a narrower wildcard deny through specificity; use explicit deny priorities when required.

The role editor provides searchable permission groups and typed condition controls for text, numbers, booleans, empty values and alternatives. Personal access includes application-defined permission labels and read-only rule details. Its permission list describes explicit role grants; contextual access is decided per request.

## Server guarantees and boundaries

- Every Admin operation requires a native user identity. Customer and secret API-key principals cannot inherit staff access.
- Native commerce operations use a reviewed Medusa route/field inventory. Unknown methods/routes, arbitrary workflow execution, API-key management and native RBAC endpoints deny, including for Superuser. Extension policies cannot reopen native or access-management routes.
- Role, invitation and staff administration require an active Superuser. Ordinary roles cannot delegate this authority. The system role and its name are protected, self-deletion is rejected, and transactional locking preserves at least one active Superuser.
- Role/staff writes require record versions. Assignments, access mutations and before/after audit events commit atomically. Access is read on every request; Admin refreshes its access state while visible.
- Managed invitations compose native workflows and activate assigned roles before first login. Pending invitations reserve their roles. Account deletion and invitation failures use compensation.
- Audit history records access changes. It is not a log of every authorization decision or a complete commerce audit system.

## Administration and invitations

The plugin uses supported Admin routes and widget zones with Medusa UI tables, drawers and focus modals. It requires no modifications to Medusa packages. **Settings → Access management** includes roles, users, pending invitations, access history and personal access. The native user-detail page includes an editable Roles widget. Safe user deletion is available in the plugin’s Users table; self-deletion and deleting the last active Superuser are rejected.

Create an invitation in the Invitations tab, select its roles and share the generated private link. Links honor the application's Admin base path and open the acceptance form through the supported login widget. Acceptance uses native EmailPass registration, associates the identity with the new user and activates the selected roles before first login. A failed acceptance restores the invitation and identity association so the same credentials can retry. The workflow composes public user-creation, invite-deletion and grouped-event steps; events publish after successful completion.

Native invitation events remain available for an application notification subscriber. To deliver role-bound invitations by email, configure that subscriber to use the plugin’s login URL: `<admin-origin>/<admin-path>/login?rbac_invite=<token>`. Link creation itself does not require an email provider. Native invitation pages remain available for their normal flows; use the plugin's invitation screen when assigning roles during signup.

The native Admin keeps its navigation, account menu and error handling. The topbar **My access** link remains available when an operation is denied. Permission changes refresh access and revalidate native routes without requiring another login. Access management authorizes every read and write on the server.

The plugin works independently of Admin Kit. A host may separately install [medusa-admin-kit](https://github.com/zanreal-labs/medusa-admin-kit) for its shared Catalog table and cross-plugin column registry.

## Storefront client

Use your application's configured Medusa SDK, including its backend URL, publishable key and customer authentication:

```ts
import { createAccessClient } from "@abhi1693/medusa-rbac/client"

const access = createAccessClient(sdk)
const summary = await access.me("customer")
// summary.actor, summary.roles, summary.permission_candidates
```

`GET /access/actors/:actor_type/me` requires native session or bearer authentication for the requested actor type and validates the actor through its owning module. It returns only that actor's role names and candidate permission identifiers, without exposing policy conditions or another account's assignments. Candidates are navigation hints: context-dependent permissions still require server authorization for each operation. The client has no React or browser-global dependency and accepts optional request headers for server rendering.

## Development

```sh
npm ci
npm run typecheck
npm run format:check
npm test
npm pack --ignore-scripts --dry-run
```

The tests cover native route inventories, middleware denial, configurable registries, typed actor isolation, rule precedence/context, concurrency guards, workflow compensation and Admin components. Run `RBAC_TEST_DATABASE_URL=<local-postgres-url> npm run test:integration` for isolated PostgreSQL actor and invitation rollback/retry checks. Browser lifecycle checks also run in the consuming application’s isolated test harness. `npm run access:snapshot` refreshes the native inventory for a reviewed framework upgrade; generating a snapshot never authorizes new routes.

Framework references: [plugins](https://docs.medusajs.com/learn/fundamentals/plugins/create), [module options](https://docs.medusajs.com/learn/fundamentals/modules/options), [API middlewares](https://docs.medusajs.com/learn/fundamentals/api-routes/middlewares), [Admin widgets](https://docs.medusajs.com/learn/fundamentals/admin/widgets).

## License

MIT
