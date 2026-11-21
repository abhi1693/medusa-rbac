# Preparing and publishing RBAC

Package preparation, archive checks, checksums, provenance, draft release assets and
npm publishing are centralized in [the shared npm release workflow](https://github.com/abhi1693/actions/blob/0ee6f40a5e89417ec69c29bd1d7bfca195cb225b/docs/npm-release.md).
This repository keeps only its CI and release event callers. Public bundle entry
points and compiler options are declared directly in package.json using esbuild;
there is no custom build-public.mjs wrapper. Both local npm builds/prepare and the
shared release workflow use the same npm run build command. The release caller
selects `package-check-preset: medusa-access-client`; the shared action checks every
explicit export and README image, then verifies the extracted ESM/CommonJS client
and its encoded actor request behavior. There is no local release/check script.

1. Choose the next version, update package.json and both package-lock root versions,
   and add docs/releases/VERSION.md. The current published version is 0.0.1.
2. Require normal CI and security checks for the reviewed commit. Run **Prepare
   release** with the exact version to build and verify the package and create a
   draft with checksums and provenance. Preparation does not publish to npm.
3. Review the draft's target commit, assets and notes. The release commit must belong
   to master before publication. Publish the approved draft using a maintainer
   session; the release event starts **Publish to npm**.
4. Require successful registry-byte verification before adopting this workflow in
   other plugins. A successful build or draft alone does not prove npm publication.

Keep the npm trusted publisher configured for owner `abhi1693`, repository
`medusa-rbac`, and caller workflow `publish.yml`, with direct npm publish allowed.
The shared workflow uses GitHub-hosted runners and OIDC; no npm token fallback is
passed by these callers. Configure any trust relationship before the real release;
its validity can only be proved by successful publication.

For a recovery, dispatch publish.yml from master, providing the already-published
release tag as its `tag` input. The publisher derives the preparation builder commit from the workflow pinned
in that immutable tag and verifies the signed artifact provenance against it.
No release-specific revision input is required. The shared publisher
checks out and verifies the tagged source and its original preparation attestation;
it does not rebuild assets or move the tag. The shared workflow refuses source/tag
mismatches, missing prepared assets, changed archive bytes or backwards latest moves.
Existing versions succeed only when registry bytes match the prepared archive.

The release callers pin the exact actions PR commit during rollout. Review and
update both caller SHAs together when adopting another shared workflow revision.
Normal Node CI and Security continue to use the existing actions v1 workflows.

## Compatibility baseline

Medusa 2.23.0, UI 4.3.0, React 19.3.1 and Vite 8.3.8 are the pinned build and native snapshot baseline. Regenerate and review the route and field snapshots for each upgrade. Validate the plugin build and the consuming host against the same dependency tree. [Medusa release notes](https://github.com/medusajs/medusa/releases/tag/v2.23.0)
