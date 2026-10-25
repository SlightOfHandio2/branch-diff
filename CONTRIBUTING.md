# Contributing to Diff Branch

Thanks for helping improve Diff Branch. Bug reports, feature ideas, documentation fixes, and code contributions are welcome.

## Before opening an issue

- Search existing issues first.
- Check that the problem still occurs with the latest version.
- For bugs, include your VS Code version, operating system, Git version, relevant Diff Branch settings, and clear reproduction steps.
- Do not post security vulnerabilities publicly; follow [SECURITY.md](SECURITY.md) instead.

## Development setup

Requirements:

- Node.js 22 or later
- Git
- VS Code 1.95 or later

Install and verify the project:

```bash
npm ci
npm test
```

Open the repository in VS Code and press `F5` to launch an Extension Development Host. Open a Git repository in that window to exercise the extension.

To create an installable package:

```bash
npm run package
```

## Pull requests

1. Create a focused branch from the default branch.
2. Add or update tests for behavior changes.
3. Run `npm test` before submitting.
4. Update the README and changelog when user-facing behavior changes.
5. Keep each pull request focused on one concern.

By contributing, you agree that your contributions are licensed under the project's MIT License.
