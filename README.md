# Branch Diff

Branch Diff shows every change made on your current Git branch using VS Code's native source-control gutter decorations and diff peek UI.

It compares your working tree with the commit where your branch split from its base, so the markers include committed, staged, and unstaged branch changes together.

## Try it locally

1. Run `npm install`.
2. Open this folder in VS Code.
3. Press `F5` and open a Git project in the Extension Development Host.

The extension starts enabled. Click **Base: …** in the status bar or run **Branch Diff: Choose Comparison Branch** to select a different base. Choose **Automatic** to return to parent-branch detection.

Other commands:

- **Branch Diff: Refresh**
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

## Notes

- VS Code can show more than one quick-diff source. Use the gutter diff selector to switch between normal working-tree changes and **Branch changes** when both apply.
- Nested repositories that are not the workspace root are not discovered in this first version.
