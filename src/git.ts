import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface BranchChange {
  path: string;
  status: string;
}

export interface BranchLineChange {
  startLine: number;
  lineCount: number;
  kind: 'added' | 'modified' | 'deleted';
}

export type AutomaticBaseStrategy = 'nearestAncestor' | 'defaultBranch';
export type DiffScope = 'committed' | 'staged' | 'all';

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
  strategy: AutomaticBaseStrategy = 'nearestAncestor',
  branchBases: Record<string, string> = {}
): Promise<string> {
  if (configuredBase.trim()) {
    await git(root, ['rev-parse', '--verify', `${configuredBase.trim()}^{commit}`]);
    return configuredBase.trim();
  }

  const current = (await git(root, ['branch', '--show-current'])).trim();
  const mapped = mappedBase(current, branchBases);
  if (mapped) {
    await git(root, ['rev-parse', '--verify', `${mapped}^{commit}`]);
    return mapped;
  }

  if (strategy === 'nearestAncestor') {
    const nearest = await nearestAncestorBranch(root);
    if (nearest) {
      return nearest;
    }
  }

  return resolveDefaultBranch(root);
}

export function mappedBase(currentBranch: string, branchBases: Record<string, string>): string | undefined {
  const exact = branchBases[currentBranch]?.trim();
  if (exact) {
    return exact;
  }
  for (const [pattern, base] of Object.entries(branchBases)) {
    const value = base.trim();
    if (value && pattern !== currentBranch && matchesBranchPattern(currentBranch, pattern)) {
      return value;
    }
  }
  return undefined;
}

function matchesBranchPattern(branch: string, pattern: string): boolean {
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${expression}$`).test(branch);
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

export async function listChanges(
  root: string,
  comparisonCommit: string,
  scope: DiffScope = 'all'
): Promise<BranchChange[]> {
  const output = await git(root, diffArgs(scope, comparisonCommit, ['--name-status', '-z']));
  const fields = output.split('\0').filter(Boolean);
  const changes: BranchChange[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    changes.push({ status: fields[i][0], path: fields[i + 1] });
  }

  if (scope === 'all') {
    const untracked = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
    for (const file of untracked.split('\0').filter(Boolean)) {
      changes.push({ status: '?', path: file });
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export async function listLineChanges(
  root: string,
  comparisonCommit: string,
  relativePath: string,
  scope: DiffScope = 'all'
): Promise<BranchLineChange[]> {
  const output = await git(root, diffArgs(scope, comparisonCommit, [
    '--unified=0',
    '--no-ext-diff'
  ], relativePath));
  return parseLineChanges(output);
}

function diffArgs(
  scope: DiffScope,
  comparisonCommit: string,
  options: string[],
  relativePath?: string
): string[] {
  const args = ['diff', ...options, '--no-renames'];
  if (scope === 'staged') {
    args.push('--cached', comparisonCommit);
  } else if (scope === 'committed') {
    args.push(comparisonCommit, 'HEAD');
  } else {
    args.push(comparisonCommit);
  }
  args.push('--');
  if (relativePath) {
    args.push(relativePath);
  }
  return args;
}

export function parseLineChanges(diff: string): BranchLineChange[] {
  const changes: BranchLineChange[] = [];
  for (const line of diff.split('\n')) {
    const match = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) {
      continue;
    }
    const oldCount = match[1] === undefined ? 1 : Number.parseInt(match[1], 10);
    const startLine = Number.parseInt(match[2], 10);
    const newCount = match[3] === undefined ? 1 : Number.parseInt(match[3], 10);
    changes.push({
      startLine: Math.max(1, startLine),
      lineCount: Math.max(1, newCount),
      kind: oldCount === 0 ? 'added' : newCount === 0 ? 'deleted' : 'modified'
    });
  }
  return changes;
}

export async function fileAtCommit(root: string, commit: string, relativePath: string): Promise<string> {
  try {
    return await git(root, ['show', `${commit}:${relativePath}`]);
  } catch {
    // Missing at the baseline means the current file was added on this branch.
    return '';
  }
}

export async function fileAtIndex(root: string, relativePath: string): Promise<string> {
  try {
    return await git(root, ['show', `:${relativePath}`]);
  } catch {
    return '';
  }
}
