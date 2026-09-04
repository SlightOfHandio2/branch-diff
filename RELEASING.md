# Releasing Branch Diff

Releases are built by GitHub Actions when a version tag is pushed.

## Prepare a release

1. Move the relevant entries in `CHANGELOG.md` from **Unreleased** into a versioned section.
2. Update `version` in both `package.json` and `package-lock.json`.
3. Run `npm test`.
4. Run `npm run package` and install the VSIX locally for a final smoke test.
5. Commit the release changes.

## Create the release

For version `0.3.0`, create and push a matching tag:

```bash
git tag -a v0.3.0 -m "Branch Diff 0.3.0"
git push origin v0.3.0
```

The release workflow verifies that the tag matches the package version, runs the test suite, packages the extension, and creates a GitHub release with the VSIX attached.

## VS Code Marketplace

Marketplace publishing requires a VS Code Marketplace publisher and a publishing token. Before enabling it, replace the temporary `local` value in `package.json` with the real publisher identifier and store the token as an encrypted GitHub Actions secret. GitHub releases do not require a Marketplace account.
