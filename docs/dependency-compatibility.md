# Dependency compatibility

The validation baseline is Medusa 2.22.2, `@medusajs/ui` 4.2.9 and Node.js 22.22.0 or newer. Keep the Medusa packages aligned when upgrading a consuming application.

Medusa 2.22.2 includes [upstream dependency updates](https://github.com/medusajs/medusa/releases/tag/v2.22.2), including the Zod update. Its [`@medusajs/utils` manifest](https://github.com/medusajs/medusa/blob/v2.22.2/packages/core/utils/package.json) still selects GraphQL Code Generator 4.x. That older family retains GraphQL Tools 10.x and Lodash `~4.17.0` dependency paths affected by high-severity advisories.

This repository aligns the two Code Generator packages used by `@medusajs/utils@2.22.2` through a scoped npm override:

```json
{
  "overrides": {
    "@medusajs/utils@2.22.2": {
      "@graphql-codegen/core": "6.2.2",
      "@graphql-codegen/typescript": "6.1.2"
    }
  }
}
```

This changes dependency resolution without editing Medusa's source. It selects the corresponding core and TypeScript generator family together, rather than replacing their individual transitive dependencies. Medusa's native [`gqlSchemaToTypes`](https://github.com/medusajs/medusa/blob/v2.22.2/packages/core/utils/src/graphql/graphql-to-ts-types.ts) uses the documented [Code Generator programmatic API](https://the-guild.dev/graphql/codegen/docs/advanced/programmatic-usage): `codegen`, a parsed schema, TypeScript plugin configuration and `pluginMap`.

## Consuming applications

npm [considers overrides only in the project's root `package.json`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides). The plugin's overrides and development lockfile do not control a host application's dependency tree. A Medusa 2.22.2 application may need the same configuration in its own root manifest. Merge it with any existing overrides, regenerate the application's lockfile, and review the resulting tree before committing it. Other package managers have their own resolution configuration.

Reassess this version-specific override when upgrading Medusa. Remove it when upstream dependencies resolve the affected paths and compatibility checks pass without it.

## Validation

The installed dependency tree was audited on 2026-10-30 after this alignment. The high-severity gate passed with no high or critical findings. Fourteen lower-severity dependency entries remain in upstream dependency paths: nine moderate and five low. This result applies to this repository's refreshed lockfile and does not certify a consuming application's installation.

Keep the high-severity dependency audit enabled for development and runtime dependencies. Validate a clean locked installation, unit and Admin component tests, PostgreSQL integration tests, the plugin package and a consuming Medusa application's native CLI build. That build must generate query types through Medusa's own schema-to-TypeScript path and compile those declarations; a plugin build alone does not exercise that contract.

Documentation and native source references were reviewed on 2026-10-30. Successful checks apply to the exact lockfile and commit tested; consumers must audit and validate their own installation.
