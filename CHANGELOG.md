# Changelog

Notable changes to Branch Diff are documented here. This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- A dedicated Branch Diff Activity Bar view, separate from normal Source Control changes.
- Colored branch-status icons, explicit branch labels, and a comparison banner in the new view.
- Per-branch comparison-base mappings with wildcard support.
- Configurable colors for separate branch-change markers.
- Diff scopes for committed-only, committed-plus-staged, and all changes.
- Glob-based file exclusions across all diff scopes.

### Fixed

- Keep branch-change markers in the glyph margin so they never overlap code or indentation guides.
- Refresh branch changes immediately after checking out another branch.
- Prevent an older asynchronous refresh from replacing newer results.

## 0.2.0

- Initial public version of the Branch Diff source-control provider.
