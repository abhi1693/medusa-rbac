# Preparing a release

Releases contain a built npm-compatible package, `SHA256SUMS` and, when prepared by GitHub Actions, a provenance bundle. Preparation creates a draft GitHub release. It does not publish a release, create a public tag, or publish to npm.

1. Update `package.json` and `package-lock.json` to the release version, and add notes at `docs/releases/<version>.md`.
2. Commit the reviewed source. Release packaging requires a clean checkout; the requested version must match the package version.
3. Run **Prepare release** for that commit's branch with the version, initially `0.0.1`. Once a workflow is present on the default branch, GitHub allows dispatching it for another branch.
4. Review the draft's target commit, package, checksums and release notes before publication.

The workflow first calls the same CI and security checks used for pull requests. Packaging checks every explicit server, Admin and client export in the actual archive, excludes test/private files, and exercises both ESM and CommonJS storefront clients from an extracted package. The release job checks out the exact validated `github.sha` and records that SHA as the draft's target. It downloads the uploaded assets again to verify their checksums and provenance bundle. A retry may update only a draft for that same commit; published releases and drafts for another commit are rejected.

For a local Docker verification, run `npm run ci:build` in the plugin's CI tooling container. `--check-only` validates a temporary archive without requiring a clean working tree. After committing, `npm run release:package` writes the package and checksums to the ignored `.release/` directory. `RELEASE_OUTPUT_DIR` can select another dedicated output directory. Local packages have checksums but no GitHub OIDC provenance; do not describe them as attested.

Verify a downloaded release with `sha256sum -c SHA256SUMS`. When provenance is attached, use `gh attestation verify <package.tgz> --repo abhi1693/medusa-rbac` to retrieve GitHub's build evidence, or add `--bundle provenance.json` to verify the downloaded bundle. Installing a release archive is separate from a future npm registry publication.

## Publication readiness

The initial `0.0.1` draft has high-severity dependency audit findings in the locked Medusa 2.22.1 toolchain. Resolve the applicable upstream advisories and rerun the dependency and package checks before publishing a GitHub release or an npm package. The security workflow remains blocking. A locally prepared draft has verified checksums and package contents, but has no GitHub OIDC provenance unless the preparation workflow generated it.

## Workflow references

The owned Node CI and Security callers use the maintained `abhi1693/actions@v1` line. Its public contract was checked against `v1.0.5`, commit `4bc25a3100cbfbece517ddad161d59d13c029675`. Node CI accepts the declared npm stages and exports a disposable PostgreSQL URL through `RBAC_TEST_DATABASE_URL`. Security keeps secret scanning, workflow linting and the high-severity npm audit enabled, including development dependencies. Other actions are pinned to reviewed commit SHAs.

References checked on 2026-10-30: [reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows), [manual workflow dispatch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), [artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations), and [npm pack](https://docs.npmjs.com/cli/v11/commands/npm-pack/). `abhi1693/actions` has no reusable npm publication workflow; its `release-shared.yml` publishes the shared workflow library itself and is not used for plugin releases.
