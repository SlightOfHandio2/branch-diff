# Releasing Branch Diff

Releases are built by GitHub Actions when a version tag is pushed.

## Prepare a release

1. Decide the release version and move the relevant entries in `CHANGELOG.md` from **Unreleased** into a matching versioned section.
2. Update `version` in both `package.json` and `package-lock.json`.
3. Run `npm test`.
4. Run `npm run package` and install the generated VSIX in a clean VS Code profile.
5. Smoke-test automatic and manual comparison bases, all three diff scopes, flat and folder layouts, editor markers, renames, deletions, and a multi-root workspace.
6. Confirm the repository visibility and distribution channel. For Marketplace publishing, use the `oddiss` publisher account matching `package.json`.
7. Commit the release changes and confirm CI passes on the release commit.

## Create the release

Set the version once, then create and push a matching annotated tag. For example, for version `1.0.0`:

```bash
git tag -a v1.0.0 -m "Branch Diff 1.0.0"
git push origin v1.0.0
```

The release workflow verifies that the tag matches the package version, runs the test suite, packages the extension, and creates a GitHub release with the VSIX attached. Do not create the tag until the matching version is committed on the default branch.

For curated release notes, add `.github/release-notes/v<VERSION>.md` before tagging. The workflow uses that file when present and otherwise generates notes automatically. Notes for `v1.0.0` are prepared.

## Product website

The site is deployed to existing Oddiss hosting. Build it with `npm ci --prefix website` and `npm run build --prefix website`, then upload the contents of `website/dist/` to the site's web root after the GitHub release is available. See `website/README.md` for deployment details. CI also produces a `branch-diff-website` artifact.

## VS Code Marketplace

The extension uses publisher ID `oddiss`, giving it the Marketplace identifier `oddiss.branch-diff`.

For a manual release:

1. Sign into the Marketplace publisher dashboard and select publisher `oddiss`.
2. Run `npm run package` to produce `branch-diff-1.0.0.vsix` for this release.
3. Choose **New extension → Visual Studio Code** and upload the VSIX. For later releases, increase the version and use **Update** on the existing extension.

Manual uploads do not need a publishing token or CI. The GitHub release workflow publishes to GitHub only.

GitHub releases do not require a Marketplace account.
