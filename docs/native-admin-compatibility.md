# Native Admin field selections

Reviewed on 2026-10-30 against Medusa and Dashboard 2.22.2.

The native Product details page requests `*categories,*shipping_profile,-variants`. Its shipping profile is a public linked Fulfillment record used by the native page. This selection is defined in Dashboard's `src/routes/products/product-detail/constants.ts`; the Product API's default field exports do not include the additional linked profile. The RBAC policy therefore explicitly includes `*shipping_profile` alongside the reviewed native product fields.

The page also loads its Variant table through `GET /admin/products/:id/variants`; Variant details use `GET /admin/products/:id/variants/:variant_id`. Both native handlers return Variant records. RBAC validates these nested reads against the Variant field catalog, including the exact inventory, option, price-rule and image paths used by Dashboard's `ProductVariantSection` and `VARIANT_DETAIL_FIELDS`. Inventory expansions still require `inventory.view`, alongside the product and price read grants. Variant-only paths are not added to the top-level Product catalog.

Medusa supports field selection and relation expansion through the `fields` query parameter. See the official [allowed-fields guide](https://docs.medusajs.com/learn/fundamentals/api-routes/allowed-fields) and [Admin API reference](https://docs.medusajs.com/api/admin). Native exclusions such as `-variants` remain valid. The plugin bounds requested paths independently of role grants: Superuser does not bypass this field boundary, and adding the shipping profile does not permit its nested relations, unknown paths or an unrestricted `*` selection.

Regression checks inspect the matching published Dashboard Product/Variant constants, Product breadcrumb exclusions and Variant table request. Middleware checks cover Superuser and authorized ordinary accounts; negative cases retain route and inventory permissions and reject unreviewed subrelations, unknown fields, unrestricted wildcards and Variant-only fields on top-level Product reads.
