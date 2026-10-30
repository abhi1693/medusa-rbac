# Medusa RBAC

Reusable access control for Medusa v2. Register permissions for your modules, define roles in application code or Admin, and enforce access on the server. The plugin includes role and staff management, invitations, contextual permission rules, permission diagnostics, live revocation and transactional access auditing.

**Superuser is the only built-in role.** Its definition is exported in code, and bootstrap creates and explicitly assigns it to a chosen native Medusa user. Applications can declare additional roles through configuration or create them in Admin/API. Configured roles never assign access automatically.

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
import { definePermission } from "@abhi1693/medusa-rbac/define-permission"
import { defineRole } from "@abhi1693/medusa-rbac/roles"

const documentsRead = definePermission({
  id: "documents.read",
  label: "Read documents",
  group: "Documents",
})

const access: AccessControlOptions = {
  permissions: [documentsRead],
  // Optional: omit roles to keep only the built-in Superuser definition.
  roles: [
    defineRole({
      key: "document-reader",
      name: "Document reader",
      permissions: [documentsRead[0]],
    }),
  ],
  routes: [
    {
      method: "GET",
      path: "/admin/documents/:id",
      permissions: ["documents.read"],
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

Run `npx medusa db:migrate`. Add application CLI wrappers for administrator bootstrap and configured-role synchronization:

```ts
// src/scripts/bootstrap-superuser.ts
export { default } from "@abhi1693/medusa-rbac/bootstrap"
```

```ts
// src/scripts/sync-access-roles.ts
export { default } from "@abhi1693/medusa-rbac/sync-roles"
```

Set `RBAC_SUPERUSER_EMAIL` and run `npx medusa exec ./src/scripts/bootstrap-superuser.ts`. For a new user, supply `RBAC_SUPERUSER_PASSWORD` through a secret environment variable (at least 12 characters). Existing user credentials are preserved when no password is provided. Repeating bootstrap succeeds only for an existing active Superuser; it cannot elevate an unrelated account.

After native migrations, run `npx medusa exec ./src/scripts/sync-access-roles.ts` to apply configured roles. Include this step in your deployment's migration lifecycle before application processes start. Bootstrap also synchronizes configured roles. Neither synchronization nor configuration assigns those ordinary roles to accounts.

Open **Settings → Access management** to inspect roles and permissions, create editable roles, and assign one or more roles to users.

## Configuration and extension points

| Option | Purpose |
| --- | --- |
| `permissions` | Additional `[identifier, label, group]` definitions, including tuples returned by `definePermission({ id, label, group })`. Duplicate or invalid identifiers fail startup. Native identifiers remain registered. |
| `roles` | Optional application-owned roles declared with `defineRole({ key, name, permissions, rules })`. Definitions are synchronized explicitly and grant no automatic assignments. |
| `routes` | Explicit method/path policies for custom Admin APIs. Paths support named segments such as `:id`; `HEAD` uses the corresponding `GET` policy. Require every listed permission, or set `superuser: true`. |
| `contextResolvers` | Async functions deriving rule context from trusted application data. Actor identity, method and route remain server-owned. |
| `actors` | `{ type, validate(id, request) }` identity providers for custom actor types. Native users and customers are validated through Medusa's User and Customer modules. |

## Roles defined in code

`SUPERUSER_ROLE` and `DEFAULT_ROLES` are exported from `@abhi1693/medusa-rbac/roles`. `DEFAULT_ROLES` contains only the protected Superuser descriptor; bootstrap owns its creation and assignment. Additional application roles belong in `options.roles`. `defineRole` checks the declaration's shape while preserving literal types; startup validates identifiers, names, permissions and rules.

A configured role has a stable `key`, a display `name`, and optional `permissions` and `rules`. Keep the key unchanged when renaming the role so assignments remain attached to the same record. The key `superuser` and name `Superuser` are reserved. Configured role names cannot conflict with another role.

Synchronization creates or updates configured roles in one transaction with version changes and audit events. Repeating an unchanged configuration makes no changes. Existing assignments remain in place when grants change. Removing a definition makes that role grant no access and the next synchronization persists the revocation; its assignments and pending invitation references remain available for review. Restoring the same key and synchronizing reactivates its configured grants. A key change creates a different role and revokes the removed definition's grants.

Configured roles are marked as managed in application configuration. Their names, permissions and rules cannot be edited or deleted through Admin or the management API. **Duplicate role** creates an independent, editable Admin role; it does not copy account assignments. Superuser remains protected separately. Use the service's public `syncConfiguredRoles()` method when integrating synchronization into an existing application workflow.

## Server checks

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

`requirePermission(...identifiers)` requires every listed permission; `requireAnyPermission(...identifiers)`, exported from the same entry point, requires at least one. Both run after native authentication and resolve the actor and trusted context through the configured service.

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

The role editor groups permissions by area, supports search, group selection and a selected-only filter, and provides typed condition controls for text, numbers, booleans, empty values and alternatives. Personal access includes application-defined permission labels and read-only rule details. Its permission list describes explicit role grants; contextual access is decided per request.

## Server guarantees and boundaries

- Every Admin operation requires a native user identity. Customer and secret API-key principals cannot inherit staff access.
- Native commerce operations use a reviewed Medusa route/field inventory. Unknown methods/routes, arbitrary workflow execution, API-key management and native RBAC endpoints deny, including for Superuser. Extension policies cannot reopen native or access-management routes.
- Role, invitation and staff administration require an active Superuser. Ordinary roles cannot delegate this authority. The system role and its name are protected, self-deletion is rejected, and transactional locking preserves at least one active Superuser.
- Role/staff writes require record versions. Assignments, access mutations and before/after audit events commit atomically. Access is read on every request; Admin refreshes its access state while visible.
- Managed invitations compose native workflows and activate assigned roles before first login. Pending invitations reserve their roles. Account deletion and invitation failures use compensation.
- Audit history records access changes. It is not a log of every authorization decision or a complete commerce audit system.

## Administration and invitations

The plugin uses supported Admin routes and widget zones with Medusa UI tables, drawers and focus modals. It requires no modifications to Medusa packages. **Settings → Access management** includes Roles, Permissions, Users, Invitations, Activity and My access. Each role has a shareable detail page with readable permission groups, scoped rules, its management source, assigned-account counts, paginated account assignments and pending invitation counts. The native user-detail page includes an editable Roles widget. Safe user deletion is available in the plugin’s Users table; self-deletion and deleting the last active Superuser are rejected.

Create an invitation in the Invitations tab, select its roles and share the generated private link. Links honor the application's Admin base path and open the acceptance form through the supported login widget. Acceptance uses native EmailPass registration, associates the identity with the new user and activates the selected roles before first login. A failed acceptance restores the invitation and identity association so the same credentials can retry. The workflow composes public user-creation, invite-deletion and grouped-event steps; events publish after successful completion.

Native invitation events remain available for an application notification subscriber. To deliver role-bound invitations by email, configure that subscriber to use the plugin’s login URL: `<admin-origin>/<admin-path>/login?rbac_invite=<token>`. Link creation itself does not require an email provider. Native invitation pages remain available for their normal flows; use the plugin's invitation screen when assigning roles during signup.

The native Admin keeps its navigation, account menu and error handling. The topbar **My access** link remains available when an operation is denied. Permission changes refresh access and revalidate native routes without requiring another login. Access management authorizes every read and write on the server.

The plugin works independently of Admin Kit. A host may separately install [medusa-admin-kit](https://github.com/zanreal-labs/medusa-admin-kit) for its shared Catalog table and cross-plugin column registry.

## Permission diagnostics

The **Permissions** view lists registered identifiers, labels and groups. A Superuser can choose **Check access**, select an Admin user, customer or configured actor, and supply a context to inspect the current decision. The preview validates the actor through its owning module and uses the same permission engine as enforcement. It returns the outcome, reason, winning match and other matching rules. Actor identity comes from the selected account.

This is a permission preview: it does not grant access, invoke a route, run context resolvers for a hypothetical resource, or verify collection filtering. Route policies, trusted request context and application data scoping still apply to a real request. Access Activity records administrative changes, including configured-role synchronization; it does not store every permission decision.

Backend code can inspect a registered permission with the pure helper:

```ts
import { explainPermission } from "@abhi1693/medusa-rbac/explain"

const decision = explainPermission(principal, "documents.read", trustedContext)
// decision.allowed, decision.reason, decision.matches
```

Provide an established principal, a registered permission and trusted context. Use the service's `allows` method or middleware for enforcement. `POST /admin/access/evaluate` exposes the Admin preview and requires an active native-user Superuser.

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

The tests cover native route inventories, middleware denial, configurable permission/role registries, role synchronization and removal, typed actor isolation, rule precedence/context and explanations, concurrency guards, workflow compensation and Admin components. Run `RBAC_TEST_DATABASE_URL=<local-postgres-url> npm run test:integration` for isolated PostgreSQL actor and invitation rollback/retry checks. Browser lifecycle checks also run in the consuming application’s isolated test harness. `npm run access:snapshot` refreshes the native inventory for a reviewed framework upgrade; generating a snapshot never authorizes new routes.

Framework references: [plugins](https://docs.medusajs.com/learn/fundamentals/plugins/create), [module options](https://docs.medusajs.com/learn/fundamentals/modules/options), [API middlewares](https://docs.medusajs.com/learn/fundamentals/api-routes/middlewares), [Admin widgets](https://docs.medusajs.com/learn/fundamentals/admin/widgets).

## License

MIT
