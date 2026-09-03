import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface BranchChange {
  path: string;
  status: string;
}

export type AutomaticBaseStrategy = 'nearestAncestor' | 'defaultBranch';

export async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true
  });
  return stdout;
}

export async function findRepositoryRoot(folder: string): Promise<string | undefined> {
  try {
    return (await git(folder, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return undefined;
  }
}

export async function resolveBase(
  root: string,
  configuredBase: string,
  strategy: AutomaticBaseStrategy = 'nearestAncestor'
): Promise<string> {
  if (configuredBase.trim()) {
    await git(root, ['rev-parse', '--verify', `${configuredBase.trim()}^{commit}`]);
    return configuredBase.trim();
  }

  if (strategy === 'nearestAncestor') {
    const nearest = await nearestAncestorBranch(root);
    if (nearest) {
      return nearest;
    }
  }

  return resolveDefaultBranch(root);
}

async function nearestAncestorBranch(root: string): Promise<string | undefined> {
  const current = (await git(root, ['branch', '--show-current'])).trim();
  const output = await git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  const branches = output.split('\n').map(branch => branch.trim()).filter(branch => branch && branch !== current);
  const candidates = await Promise.all(branches.map(async branch => {
    try {
      await git(root, ['merge-base', '--is-ancestor', branch, 'HEAD']);
      const distance = Number.parseInt((await git(root, ['rev-list', '--count', `${branch}..HEAD`])).trim(), 10);
      return distance > 0 ? { branch, distance } : undefined;
    } catch {
      return undefined;
    }
  }));

  return candidates
    .filter((candidate): candidate is { branch: string; distance: number } => candidate !== undefined)
    .sort((a, b) => a.distance - b.distance || a.branch.localeCompare(b.branch))[0]?.branch;
}

async function resolveDefaultBranch(root: string): Promise<string> {

  const candidates: string[] = [];
  try {
    candidates.push((await git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])).trim());
  } catch {
    // A local-only repository commonly has no origin/HEAD.
  }

  candidates.push('main', 'master', 'develop', 'development');
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try {
      await git(root, ['rev-parse', '--verify', `${candidate}^{commit}`]);
      return candidate;
    } catch {
      // Try the next conventional default branch.
    }
  }

  // A detached HEAD or single-branch repository still gets a useful baseline.
  await git(root, ['rev-parse', '--verify', 'HEAD^']);
  return 'HEAD^';
}

export async function mergeBase(root: string, base: string): Promise<string> {
  return (await git(root, ['merge-base', base, 'HEAD'])).trim();
}

export async function listRefs(root: string): Promise<string[]> {
  const output = await git(root, [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads',
    'refs/remotes'
  ]);
  return [...new Set(output.split('\n').map(ref => ref.trim()).filter(ref => ref && !ref.endsWith('/HEAD')))];
}

export async function listChanges(root: string, comparisonCommit: string): Promise<BranchChange[]> {
  const output = await git(root, [
    'diff',
    '--name-status',
    '-z',
    '--no-renames',
    comparisonCommit,
    '--'
  ]);
  const fields = output.split('\0').filter(Boolean);
  const changes: BranchChange[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    changes.push({ status: fields[i][0], path: fields[i + 1] });
  }

  const untracked = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  for (const file of untracked.split('\0').filter(Boolean)) {
    changes.push({ status: '?', path: file });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export async function fileAtCommit(root: string, commit: string, relativePath: string): Promise<string> {
  try {
    return await git(root, ['show', `${commit}:${relativePath}`]);
  } catch {
    // Missing at the baseline means the current file was added on this branch.
    return '';
  }
}
