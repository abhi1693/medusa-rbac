# Native Admin compatibility

Reviewed on 2026-10-30 against Medusa and Dashboard 2.22.2.

The native Product details page requests `*categories,*shipping_profile,-variants`. Its shipping profile is a public linked Fulfillment record used by the native page. This selection is defined in Dashboard's `src/routes/products/product-detail/constants.ts`; the Product API's default field exports do not include the additional linked profile. The RBAC policy therefore explicitly includes `*shipping_profile` alongside the reviewed native product fields.

The page also loads its Variant table through `GET /admin/products/:id/variants`; Variant details use `GET /admin/products/:id/variants/:variant_id`. Both native handlers return Variant records. RBAC validates these nested reads against the Variant field catalog, including the exact inventory, option, price-rule and image paths used by Dashboard's `ProductVariantSection` and `VARIANT_DETAIL_FIELDS`. Inventory expansions still require `inventory.view`, alongside the product and price read grants. Variant-only paths are not added to the top-level Product catalog.

Medusa supports field selection and relation expansion through the `fields` query parameter. See the official [allowed-fields guide](https://docs.medusajs.com/learn/fundamentals/api-routes/allowed-fields) and [Admin API reference](https://docs.medusajs.com/api/admin). Native exclusions such as `-variants` remain valid. The plugin bounds requested paths for ordinary roles. Active native-user Superusers use the native route validators without the plugin field allowlist; ordinary roles still require reviewed fields and their associated grants.

The existing regression suite predates unrestricted Superuser authority: its Superuser route/field denial expectations must be revised in the approved test batch. Ordinary-role negative cases must continue to retain route and inventory permissions and reject unreviewed fields. Direct isolated checks of this change cover native API-key/workflow routes, unmapped plugins, customer/inventory fields, inactive and non-staff rejection, guarded deletion, backend catalog responses and rendered permission summaries.

## Personal and shared layouts

Reviewed on 2026-10-31 against Medusa 2.22.2. Native layout configuration is available since 2.17.2; see the official [layout guide](https://docs.medusajs.com/resources/commerce-modules/settings/layout-configurations) and [Admin layout guide](https://docs.medusajs.com/user-guide/tips/layout-configurations).

The handlers at `api/admin/layouts/[zone]/configuration/route.ts` take personal layout ownership from `req.auth_context.actor_id`. GET returns that user's personal configuration and the shared default. DELETE clears only that user's personal layout. POST selects the shared default only through `is_default`; its public `setLayoutConfigurationWorkflow` delegates to either `setSystemDefaultLayoutConfiguration` or the actor's `setLayoutConfiguration`. The list handler at `layouts/configurations/route.ts` adds an actor-or-system-default filter independently of supplied query filters.

RBAC permits the two reviewed native layout routes for active staff: GET `/admin/layouts/configurations` and GET/POST/DELETE `/admin/layouts/:zone/configuration`. Personal preferences require no commerce-setting grant. A shared POST requires `settings.manage`, including its contextual rules. The native handler reads the raw body rather than the transformed body, so the RBAC scope check accepts only an absent or boolean `is_default`; strings, numbers, arrays, objects and null cannot turn a personal save into a shared write. Unknown layout paths and methods remain denied. Field selection accepts only the seven native Layout DTO fields and no user relations.

Permanent integration checks start the native HTTP server against a disposable database and authenticate separate staff identities. They verify personal ownership despite forged actor inputs, actor-scoped listing, restricted shared saves, authorized shared saves, personal deletion preserving other users and the shared default, inactive access, malformed scopes and unknown-route denial. The plugin does not modify native handlers or stored layout records directly.

## Resource and operation resolution

Authorization has three layers. The pinned native inventory records available route templates and methods. Template matching preserves opaque parameter values and selects static segments before parameters for the requested method. Resource profiles then resolve those structural facts into declared operations, field catalogs and scope. A capability registry supplies the existing permission requirements; the generic Admin middleware evaluates the resolved descriptor and its declared effects.

Native commerce adapters declare their reviewed member vocabulary and commands. The shared profile machinery handles collection/item shapes and nested resources, while command definitions retain import/export/refund/cancel distinctions. A Product's nested Variant reads select the Variant field catalog through the descriptor. Product payload requirements use an adapter callback; other plugins can register their own payload checks without a core switch. Bootstrap fields, self-profile updates and guarded deletion delegation are declared effects, with self access based on an authenticated actor and an exact-case bound parameter. Active native-user Superusers bypass authorization classification; canonical paths, native authentication, payload validation and guarded staff deletion remain enforced.

For ordinary principals, every resolved descriptor passes actor-type and capability evaluation before its effects apply, including self-profile operations. Self access can permit safe profile edits for an inactive or unassigned native user through authenticated access with no required grants; it cannot bypass another resource's declared actor types or additional payload permissions.

The public `ResourceDefinition` API also supports application-owned resources through structural profiles. Registration checks native/reserved collisions, operation references, permissions, parameter bindings and profile structure. Undeclared methods, commands and descendants remain denied. The existing explicit `routes` option remains available for custom APIs; it cannot override native resources or a resource registration.

Medusa 2.22.2 does not expose a public `httpModule` route registry. Its public [`RouteDescriptor`](https://github.com/medusajs/medusa/blob/v2.22.2/packages/core/framework/src/http/types.ts) contains routing/authentication/CORS facts, without complete business-action or ownership metadata. `ApiLoader` discovery is private and its trace callbacks are instrumentation hooks. Some native middleware declarations include policy data, but it is incomplete for these capabilities and its execution belongs to the [Enterprise RBAC implementation](https://github.com/medusajs/medusa/blob/v2.22.2/ENTERPRISE-LICENSE.md). This plugin uses the documented [middleware extension](https://docs.medusajs.com/learn/fundamentals/api-routes/middlewares), independently authored capability definitions, and public owning-module APIs.

The registry does not discover grants automatically. A new framework route or unfamiliar command remains subject to inventory and semantic review. Native saved views are not enabled by the layout profile: their shared flags and existing-record scope differ and require their own ownership adapter and validation.

## Inventory detail fields

Dashboard 2.22.2 `src/routes/inventory/inventory-detail/constants.ts` declares `*variants,*variants.product,*variants.options`. Native `dist/api/admin/inventory-items/query-config.js` contains default scalar/location-level selections; it does not enumerate these Dashboard additions. The native item GET forwards selected fields through `refetchInventoryItem`. The reviewed relation selections are therefore registered in the native inventory field profile, alongside query-config defaults, without changing route bindings, actor boundaries or capabilities. Inventory reads already require `inventory.view`, `products.view`, `prices.view` and `stock_locations.view`.

The native Dashboard constant is read in the contract suite. HTTP middleware tests exercise GET/HEAD with every required grant, deny each missing grant independently, and continue denying root wildcards and deeper product, price, option and private specification expansions. Official relation-selection semantics: https://docs.medusajs.com/api/admin#select-nested-relations .

The same page’s `components/location-levels-table/location-list-table.tsx` requests `+stock_locations.id,+stock_locations.name` for inventory location levels and throws its query error at the page boundary. Those two scalar relation paths are reviewed explicitly in the same field profile. Broader stock-location expansion and address/metadata/order projections remain denied. The existing stock-location read grant remains required.

The Medusa Dashboard 2.22.2 customer detail loader and component both select
`+*addresses`. The native customer retrieve route uses that projection to
populate its address panel. The adapter allows the direct addresses relation
under the existing `customers.view` capability and rejects deeper expansions.
The adjacent order table selects `shipping_address.country_code` under the
existing order read policy. No additional shipping-address fields are enabled.

The reviewed Dashboard order detail, region list/detail, location list/detail,
category product picker, option detail and product stock selectors use a
bounded set of additional fields. Inventory fields still require inventory
read access. Order payment session/refund reason expansion requires payment
read access, and location fulfillment/sales channel expansions require
settings read access. The product option's `-products` exclusion does not grant
access to the products relation. API-key administration, workflow internals
and notification payloads retain their existing denied policy.

The customer group picker requests `*customers` but checks only member IDs.
After the existing customer permission succeeds, the adapter projects the
exact picker request to `+customers.id`. Mixed or nested wildcard requests
continue to be denied.

The order summary and timeline request return items and their reason, plus
claim/exchange additional items under the existing order read policy. Option
detail lists the native product-option join rows under the existing product
read policy. These are direct, reviewed selections; deeper relations are
not added.

The shipping-option editor and service-zone areas form use the explicit
fulfillment-set type and zone name fields with existing settings permissions.

Native image assignment, variant media, campaign membership, price list
editing, customer group assignment, and order allocation/fulfillment forms
select the direct relations or named identifiers exercised by the pinned
Dashboard. The existing product, customer, promotion, price, settings and
inventory capabilities still apply. Nested customer, location, shipping
profile and image expansions outside the reviewed selectors remain denied.

The native promotion rule editor sends `id` with `limit=1` when hydrating
an existing sales-channel rule, while the owning validator accepts `value`.
After the existing promotions read grant succeeds, the adapter translates
that exact scalar lookup. Ambiguous, invalid or unrelated queries are left
to the native validator.

## Superuser authority and its display

Superuser recognition requires an active native staff principal resolved from current persisted assignments. It precedes the RBAC registration/mapping and field allowlists for Admin requests. Unmapped routes still need an installed native or plugin handler: authorization does not create endpoints or skip their native validators. Customer/custom actors do not acquire Superuser authority, and non-Admin resource descriptors retain their actor-type boundary.

The permission catalog and personal-access response include one backend-owned `superuser_authority` description. Personal access, role details, the catalog and diagnostics use that response, while all permission labels/identifiers come from the configured registry. The catalog is finite; API keys, workflows and unmapped Admin handlers are covered by the broader authority, not invented assignable grants. Ordinary accounts keep their existing explicit-grant/rule representation.

Local verification uses an isolated source snapshot and generated server/Admin build; it does not certify a signed-in browser journey against the running package. Runtime activation and browser coverage must be reported separately.
