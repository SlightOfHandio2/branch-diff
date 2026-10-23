# Releasing Branch Diff

Releases are built by GitHub Actions when a version tag is pushed.

## Prepare a release

1. Decide the release version and move the relevant entries in `CHANGELOG.md` from **Unreleased** into a matching versioned section.
2. Update `version` in both `package.json` and `package-lock.json`.
3. Run `npm test`.
4. Run `npm run package` and install the generated VSIX in a clean VS Code profile.
5. Smoke-test automatic and manual comparison bases, all three diff scopes, flat and folder layouts, editor markers, renames, deletions, and a multi-root workspace.
6. Confirm the repository visibility and distribution channel. Public GitHub releases require a public repository; Marketplace publishing requires a real publisher identifier and token.
7. Commit the release changes and confirm CI passes on the release commit.

## Create the release

Set the version once, then create and push a matching annotated tag. For example, for version `1.0.0`:

```bash
git tag -a v1.0.0 -m "Branch Diff 1.0.0"
git push origin v1.0.0
```

The release workflow verifies that the tag matches the package version, runs the test suite, packages the extension, and creates a GitHub release with the VSIX attached. Do not create the tag until the matching version is committed on the default branch.

## VS Code Marketplace

Marketplace publishing requires a VS Code Marketplace publisher and a publishing token. Before enabling it:

1. Replace the temporary `local` value in `package.json` with the real publisher identifier.
2. Store the publishing token as an encrypted GitHub Actions secret.
3. Add a Marketplace publishing step to the release workflow and test it with a prerelease first.

GitHub releases do not require a Marketplace account.
