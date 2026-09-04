# Branch Diff

[![CI](https://github.com/SlightOfHandio2/branch-diff/actions/workflows/ci.yml/badge.svg)](https://github.com/SlightOfHandio2/branch-diff/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Branch Diff shows everything changed on the current Git branch, including committed work that VS Code's standard working-tree view no longer shows. It compares against the commit where the branch split from its base and integrates with VS Code's Source Control view, editor markers, and diff UI.

## Features

- Automatically detects the nearest parent branch, including stacked branches.
- Shows committed, staged, unstaged, and untracked changes in one Source Control group.
- Switches between committed-only, committed-plus-staged, and complete diff scopes.
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

The extension starts enabled. Click **Base: …** in the status bar or run **Branch Diff: Choose Comparison Branch** to select a different base. Choose **Automatic** to return to parent-branch detection.

Use the scope control beside the base to choose what the comparison includes:

- **Committed only** — commits made after the branch split.
- **Committed + staged** — committed changes plus the current Git index.
- **Everything** — committed, staged, unstaged, and untracked changes.

The choice is saved per workspace in `branchDiff.scope`.

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

Changed files also appear under **Branch Changes** in the Source Control view. Selecting one opens the full diff.

## How automatic base detection works

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

VS Code uses shared colors for every native Quick Diff provider, so Branch Diff adds its own colored line and overview-ruler markers while preserving the clickable native gutter diff. Customize them in User Settings:

```json
"branchDiff.colors": {
  "added": "#C586C0",
  "modified": "#D7BA7D",
  "deleted": "#F48771"
}
```

## Notes

- VS Code can show more than one quick-diff source. Use the gutter diff selector to switch between normal working-tree changes and **Branch changes** when both apply.
- Nested repositories that are not the workspace root are not discovered in this first version.

## Contributing and support

Contributions are welcome. Please read the [contribution guide](CONTRIBUTING.md) and [code of conduct](CODE_OF_CONDUCT.md) before opening a pull request. Use [GitHub Issues](https://github.com/SlightOfHandio2/branch-diff/issues) for bugs and feature requests, and follow the [security policy](SECURITY.md) for vulnerability reports.

Branch Diff is available under the [MIT License](LICENSE).
