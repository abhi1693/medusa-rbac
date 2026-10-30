# Preparing and publishing a release

Releases contain a built npm-compatible package, `SHA256SUMS` and, when prepared by GitHub Actions, a provenance bundle. Preparation creates a draft GitHub release. It does not publish a release, create a public tag, or publish to npm.

1. Update `package.json` and `package-lock.json` to the release version, and add notes at `docs/releases/<version>.md`.
2. Commit the reviewed source. Release packaging requires a clean checkout; the requested version must match the package version.
3. Run **Prepare release** for that commit's branch with the version, initially `0.0.1`. Once a workflow is present on the default branch, GitHub allows dispatching it for another branch.
4. Review the draft's target commit, package, checksums and release notes. The release commit must be on `master` before publication.

The workflow first calls the same CI and security checks used for pull requests. Packaging checks every explicit server, Admin and client export in the actual archive, excludes test/private files, and exercises both ESM and CommonJS storefront clients from an extracted package. The release job checks out the exact validated `github.sha` and records that SHA as the draft's target. It downloads the uploaded assets again to verify their checksums and provenance bundle. A retry may update only a draft for that same commit; published releases and drafts for another commit are rejected.

For a local Docker verification, run `npm run ci:build` in the plugin's CI tooling container. `--check-only` validates a temporary archive without requiring a clean working tree. After committing, `npm run release:package` writes the package and checksums to the ignored `.release/` directory. `RELEASE_OUTPUT_DIR` can select another dedicated output directory. Local packages have checksums but no GitHub OIDC provenance; do not describe them as attested.

Verify a downloaded release with `sha256sum -c SHA256SUMS`. Use `gh attestation verify <package.tgz> --repo abhi1693/medusa-rbac --bundle provenance.json` to verify the downloaded GitHub build-provenance bundle. Check that its source commit and signing workflow match the prepared release.

## Publishing to npm

Publish the reviewed draft through the GitHub UI or an authenticated maintainer CLI session. This emits the `release: published` event and starts **Publish to npm** (`publish.yml`). For example:

```sh
gh release edit v0.0.1 --draft=false --repo abhi1693/medusa-rbac
```

The publication workflow runs the shared CI and security checks again, checks out the release tag's exact commit and requires that SHA to match the event and belong to `master`. It downloads the prepared package, `SHA256SUMS` and `provenance.json`, verifies the checksum and the preparation workflow's attestation against that source SHA, then publishes that exact archive to the public npm registry with npm provenance. It does not rebuild or run package lifecycle scripts during publication.

Preparation remains separate from publication: creating or editing a draft does not publish to npm. A release published by another workflow using `GITHUB_TOKEN` does not trigger a second release-event workflow. Use a maintainer session for the publication step, or explicitly dispatch the publication workflow.

For a retry after correcting credentials or a transient failure, dispatch against the existing release tag so the workflow SHA is the tagged commit:

```sh
gh workflow run publish.yml --ref v0.0.1 -f tag=v0.0.1 --repo abhi1693/medusa-rbac
```

The retry requires an already published GitHub release and performs the same validation. An npm version that already exists is accepted only when its downloaded archive matches the prepared bytes. A different archive fails validation; npm versions cannot be replaced.

### First publication credentials

The npm package must exist before its trusted publisher can be configured. For the first workflow publication, configure the repository's `NPM_TOKEN` secret with a short-lived granular token that can create and publish packages under the `@abhi1693` scope, has read/write publishing access and enables bypass 2FA. Keep the token out of source and remove it after transitioning to trusted publishing. No placeholder or dummy package version is needed.

### Trusted publishing for subsequent releases

Configure the package's npm trusted publisher shortly before the next release, with owner `abhi1693`, repository `medusa-rbac` and workflow filename `publish.yml`. Explicitly allow direct `npm publish`; staging permission alone does not permit the automatic publication used here. Match any configured environment to the workflow. A new trust configuration must complete a successful publication within two days.

The workflow uses a GitHub-hosted runner, Node.js 24 and npm 11.5.1 or newer, with `id-token: write`. npm uses OIDC when the trust relationship is configured and can use the bootstrap token otherwise. Public npm provenance is generated for this public repository and package. This registry provenance is separate from the preparation workflow's GitHub artifact attestation; do not pass the GitHub bundle as npm's `--provenance-file`.

### Registry verification

Confirm the published version and distribution tag in the workflow results and on npm:

```sh
npm view @abhi1693/medusa-rbac@0.0.1 version dist.integrity dist.tarball
npm view @abhi1693/medusa-rbac dist-tags
```

The workflow downloads the registry archive and compares it with the prepared package. Consumers can also install into an isolated application and run `npm audit signatures` to verify registry signatures and npm provenance. A published GitHub release and a successful npm publication are separate results; check both.

## Publication readiness

Require successful security, native compatibility and package checks for the final commit before publishing a GitHub release or an npm package. The security workflow remains blocking. The refreshed dependency tree passes the high-severity audit; [lower-severity upstream findings](dependency-compatibility.md#validation) remain. Local package verification provides checksums and package checks; GitHub build attestation and npm registry provenance require their respective hosted workflows.

## Compatibility baseline

Medusa 2.22.2 is the minimum supported version and the exact version used for validation and native route/field snapshots. Keep the Medusa package versions aligned; the corresponding Admin components use `@medusajs/ui` 4.2.9. Review the scoped [dependency compatibility configuration](dependency-compatibility.md). Regenerate the snapshots and validate the installed package when changing this baseline.

The [official Medusa 2.22.2 release notes](https://github.com/medusajs/medusa/releases/tag/v2.22.2), reviewed on 2026-10-30, describe dependency updates across the server, CLI and Admin. They include Vite 7.3.7, errors for invalid `BigNumber`/`MathBN` inputs or invalid middleware body-size limits, and removal of the unused Tailwind Forms dependency. The plugin does not rely on these invalid-input behaviors or load Tailwind Forms. Use the supported upstream versions and rerun the compatibility checks after installation.

## Workflow references

The owned Node CI and Security callers use the maintained `abhi1693/actions@v1` line. Its public contract was checked against `v1.0.5`, commit `4bc25a3100cbfbece517ddad161d59d13c029675`. Node CI accepts the declared npm stages and exports a disposable PostgreSQL URL through `RBAC_TEST_DATABASE_URL`. Security keeps secret scanning, workflow linting and the high-severity npm audit enabled, including development dependencies. Other actions are pinned to reviewed commit SHAs.

References checked on 2026-10-30: [reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows), [release events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release), [workflow dispatch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), [artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations), [trusted publishing](https://docs.npmjs.com/trusted-publishers/), [initial package requirements](https://docs.npmjs.com/cli/v11/commands/npm-trust/), [granular tokens](https://docs.npmjs.com/about-access-tokens/), [npm provenance](https://docs.npmjs.com/generating-provenance-statements/) and [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/). `abhi1693/actions` supplies the shared validation and security workflows; this repository owns package preparation and npm publication.
