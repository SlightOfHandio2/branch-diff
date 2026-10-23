# Changelog

Notable changes to Branch Diff are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 1.0.0 — 2026-10-23

### Added

- First stable release, with automatic comparison bases, three diff scopes, file statistics, rename detection, and editor markers.
- Oddiss branding and a dedicated extension icon.
- A product website with installation links, documentation, and an Oddiss footer link.

### Fixed

- Reduce Git process spikes during branch changes: filter ancestor branches in one Git query, share distance checks for branch aliases, and limit concurrent checks.
- Coalesce overlapping refreshes and stop superseded comparisons before doing further diff work.

## 0.4.7

- Replace long toolbar labels with compact icons and add clickable Base and Scope rows.
- Simplify the sidebar heading and show file line counts before paths, with full details on hover.

- Refresh the comparison reliably when Git switches branches, including checkouts initiated outside VS Code.

## 0.4.0

### Added

- A comparison-base row explaining the selected ref, selection reason, and exact merge-base commit, with click-through to the base picker.

- Flat/folder-tree layout toggle with per-file added/deleted line counts, folder subtotals, and repository/workspace totals. Binary files and unavailable statistics are labelled separately.

- Git rename detection across diff scopes, with old-to-new paths, original-file comparisons, and line markers limited to edits within renamed files.

- Explicit loading, empty, disabled, missing-repository, and comparison-error states, with recovery actions in the Branch Diff view.

- A dedicated Branch Diff Activity Bar view, separate from normal Source Control changes.
- Colored branch-status icons, explicit branch labels, and a comparison banner in the new view.
- Per-branch comparison-base mappings with wildcard support.
- Configurable colors for separate branch-change markers.
- Diff scopes for committed-only, committed-plus-staged, and all changes.
- Glob-based file exclusions across all diff scopes.

### Fixed

- Align scoped markers with working-editor text, including unsaved edits, and hide markers for scoped lines that no longer survive. Discard stale decoration results after edits or refreshes.

- Comparing against the current branch now respects the selected scope instead of hiding staged, unstaged, and untracked changes.

- Keep branch-change markers in the glyph margin so they never overlap code or indentation guides.
- Refresh branch changes immediately after checking out another branch.
- Prevent an older asynchronous refresh from replacing newer results.

## 0.2.0

- Initial public version of the Branch Diff source-control provider.
