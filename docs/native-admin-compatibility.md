# Native Admin field selections

Reviewed on 2026-10-30 against Medusa and Dashboard 2.22.2.

The native Product details page requests `*categories,*shipping_profile,-variants`. Its shipping profile is a public linked Fulfillment record used by the native page. This selection is defined in Dashboard's `src/routes/products/product-detail/constants.ts`; the Product API's default field exports do not include the additional linked profile. The RBAC policy therefore explicitly includes `*shipping_profile` alongside the reviewed native product fields.

Medusa supports field selection and relation expansion through the `fields` query parameter. See the official [allowed-fields guide](https://docs.medusajs.com/learn/fundamentals/api-routes/allowed-fields) and [Admin API reference](https://docs.medusajs.com/api/admin). Native exclusions such as `-variants` remain valid. The plugin bounds requested paths independently of role grants: Superuser does not bypass this field boundary, and adding the shipping profile does not permit its nested relations, unknown paths or an unrestricted `*` selection.

Regression checks inspect the matching published Dashboard constant and exercise the native selection through RBAC middleware for Superuser and an authorized ordinary account. Negative cases retain route permission checks and reject unreviewed shipping-profile subrelations, unknown fields and wildcards.
