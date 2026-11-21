# Dependency compatibility

The plugin targets Medusa 2.23.0, Medusa UI 4.3.0 and React 19.3.1. The native plugin build uses Vite 8.3.8. Install the matching React and React DOM peers in the host and check their resolved copies with `npm ls react react-dom vite`. [Medusa 2.23.0 release notes](https://github.com/medusajs/medusa/releases/tag/v2.23.0)

Medusa 2.23.0 selects GraphQL Code Generator 6 directly. The scoped Code Generator overrides for 2.22.2 can be removed during the host upgrade. The integration suite builds a consuming Medusa application and type-checks generated query declarations. [Medusa utils manifest](https://github.com/medusajs/medusa/blob/v2.23.0/packages/core/utils/package.json)
