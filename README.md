# Branch Diff

[![CI](https://github.com/SlightOfHandio2/branch-diff/actions/workflows/ci.yml/badge.svg)](https://github.com/SlightOfHandio2/branch-diff/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Branch Diff shows everything changed on the current Git branch, including committed work that VS Code's standard working-tree view no longer shows. It compares against the commit where the branch split from its base and presents the results in a dedicated Activity Bar view, alongside distinctive editor markers and the standard diff UI.

The small product website lives in [`website/`](website/README.md).

## Features

- Automatically detects the nearest parent branch, including stacked branches.
- Shows committed, staged, unstaged, and untracked changes in a dedicated Branch Diff view.
- Shows Git-detected renames as a single `old → new` entry, with diffs against the original file and markers for actual edits.
- Switches between committed-only, committed-plus-staged, and complete diff scopes.
- Switches between flat and folder-tree layouts, with per-file line counts and folder/repository totals.
- Maps branch patterns such as `feature/*` to configured base branches.
- Adds customizable branch-change colors distinct from normal working-tree decorations.
- Refreshes automatically after saves and branch checkouts.

## Installation

Download the latest `.vsix` file from [GitHub Releases](https://github.com/SlightOfHandio2/branch-diff/releases). In VS Code, open the Extensions view, select the `…` menu, choose **Install from VSIX…**, and select the downloaded file.

Branch Diff requires VS Code 1.95 or later and Git available on your system path.

## Development

1. Run `npm ci`.
2. Open this folder in VS Code.
3. Press `F5` and open a Git project in the Extension Development Host.

Run `npm test` to compile and test the extension, or `npm run package` to create an installable VSIX. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution workflow.

## Usage

The extension starts enabled. Open the distinctive **Branch Diff** tab in the Activity Bar. Use its title-bar controls or run **Branch Diff: Choose Comparison Branch** to select a different base. Choose **Automatic** to return to parent-branch detection.

Use the scope control beside the base to choose what the comparison includes:

- **Committed only** — commits made after the branch split.
- **Committed + staged** — committed changes plus the current Git index.
- **Everything** — committed, staged, unstaged, and untracked changes.

The choice is saved per workspace in `branchDiff.scope`.

Choosing the current branch (or `HEAD`) compares against its latest commit. **Committed only** is empty, **Committed + staged** shows staged changes, and **Everything** shows staged, unstaged, and untracked changes.

Use **Branch Diff: Toggle Flat / Folder Tree** or the tree icon in the view title to switch layouts. The choice is saved in `branchDiff.viewLayout` (default: `flat`). File rows show added/deleted line counts; folder rows and the view heading show totals for the visible comparison after exclusions. Binary files are counted separately, and unreadable untracked files show statistics as unavailable.

Exclude generated or noisy files with glob patterns. Patterns without a slash match a filename at any depth; a leading slash anchors the match to the repository root:

```json
"branchDiff.exclude": [
  "**/*.snap",
  "dist/**",
  "package-lock.json"
]
```

Other commands:

- **Branch Diff: Refresh**
- **Branch Diff: Choose Diff Scope**
- **Branch Diff: Toggle Decorations**
- **Branch Diff: Use Automatic Base**

Changed files appear only under **Branch Changes** in the dedicated Branch Diff view, keeping them separate from uncommitted changes in Source Control. The view uses its own accent colors and explicit branch-status labels. Selecting a file opens the full comparison.

When there are no files to show, the view explains whether the comparison is empty, Branch Diff is disabled, no repository was found, or the comparison failed. Use the actions in the view to choose a base or scope, enable Branch Diff, open a repository folder, or retry. Hover over a failed comparison message for the error details. In multi-repository workspaces, each repository shows its own state and recovery actions.

## How automatic base detection works

The **Comparison base** row shows the selected ref and the short merge-base commit ID. Hover over it to see why that base was chosen and the full comparison commit. Click it to choose another base. The explanation distinguishes explicit settings, matching branch mappings, nearest ancestors, and default/previous-commit fallbacks. It is available in both layouts, including empty comparisons.

By default, Branch Diff finds the closest local branch whose tip is an ancestor of the current branch. Given `main → A → B → C`, this selects `B` from `C`, `A` from `B`, and `main` from `A`.

Git does not store explicit parent-branch metadata. This graph-based approach works naturally for branch stacks while their parent branch tips remain in the current branch's history. If no suitable local ancestor exists, Branch Diff falls back to:

1. The remote default branch (`origin/HEAD`).
2. `main`, `master`, `develop`, or `development`.
3. The previous commit for a single-branch repository.

The comparison commit is the merge-base of that ref and `HEAD`.

- Set `branchDiff.automaticBaseStrategy` to `defaultBranch` to always use the repository default instead.
- Set `branchDiff.baseBranch` to a branch name to override automatic detection completely.

You can also map branch names or wildcard patterns to their bases in User Settings. Exact branch names take priority over patterns:

```json
"branchDiff.branchBases": {
  "feature/*": "develop",
  "release/*": "main",
  "feature/special": "release"
}
```

## Branch marker colors

Markers are aligned to the current editor text, including unsaved edits. In committed/staged scopes, later edits can move a marker but do not become scoped changes themselves. Markers for lines that have since been replaced or deleted are hidden. While typing, markers are cleared and recalculated after a short pause.

Branch Diff adds compact colored glyph-margin and overview-ruler markers instead of reusing VS Code's normal working-tree colors. The markers stay outside the code area so they do not compete with indentation or text. Customize them in User Settings:

```json
"branchDiff.colors": {
  "added": "#C586C0",
  "modified": "#D7BA7D",
  "deleted": "#F48771"
}
```

## Notes

- Rename detection follows Git's similarity matching for tracked files. Stage a moved file to let Git detect its rename; an untracked destination remains separate. Exclusions match the destination path of a rename.

- Branch Diff's colored editor and overview-ruler markers remain visually separate from VS Code's normal working-tree gutter markers.
- Nested repositories that are not the workspace root are not discovered in this first version.

## Contributing and support

Contributions are welcome. Please read the [contribution guide](CONTRIBUTING.md) and [code of conduct](CODE_OF_CONDUCT.md) before opening a pull request. Use [GitHub Issues](https://github.com/SlightOfHandio2/branch-diff/issues) for bugs and feature requests, and follow the [security policy](SECURITY.md) for vulnerability reports.

Branch Diff is available under the [MIT License](LICENSE).
