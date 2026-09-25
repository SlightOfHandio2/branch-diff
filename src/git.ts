import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

export interface BranchChange {
  path: string;
  status: string;
  originalPath?: string;
  stats?: { added: number; deleted: number } | 'binary';
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
  return (await resolveBaseDetails(root, configuredBase, strategy, branchBases)).ref;
}

export interface BaseSelection {
  ref: string;
  reason: string;
}

export async function resolveBaseDetails(
  root: string,
  configuredBase: string,
  strategy: AutomaticBaseStrategy = 'nearestAncestor',
  branchBases: Record<string, string> = {}
): Promise<BaseSelection> {
  if (configuredBase.trim()) {
    await git(root, ['rev-parse', '--verify', `${configuredBase.trim()}^{commit}`]);
    return { ref: configuredBase.trim(), reason: 'Explicit comparison base from branchDiff.baseBranch.' };
  }

  const current = (await git(root, ['branch', '--show-current'])).trim();
  const mapped = mappedBase(current, branchBases);
  if (mapped) {
    await git(root, ['rev-parse', '--verify', `${mapped}^{commit}`]);
    const pattern = branchBases[current]?.trim() ? current : Object.keys(branchBases)
      .find(pattern => branchBases[pattern].trim() && matchesBranchPattern(current, pattern));
    return { ref: mapped, reason: `Branch mapping "${pattern}" matched "${current}".` };
  }

  if (strategy === 'nearestAncestor') {
    const nearest = await nearestAncestorBranch(root);
    if (nearest) {
      return { ref: nearest, reason: 'Automatically selected the nearest local ancestor branch. Equal-distance candidates are ordered by name.' };
    }
  }

  const selected = await resolveDefaultBranch(root);
  return { ...selected, reason: (strategy === 'nearestAncestor'
    ? 'No suitable local ancestor branch was found. ' : 'Repository-default strategy. ') + selected.reason };
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

async function resolveDefaultBranch(root: string): Promise<BaseSelection> {

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
      return { ref: candidate, reason: candidate === candidates[0] && candidate.includes('/')
        ? 'Selected the remote default branch from origin/HEAD.'
        : 'Selected the first available conventional default: main, master, develop, development.' };
    } catch {
      // Try the next conventional default branch.
    }
  }

  // A detached HEAD or single-branch repository still gets a useful baseline.
  await git(root, ['rev-parse', '--verify', 'HEAD^']);
  return { ref: 'HEAD^', reason: 'No default branch was found; using the previous commit (HEAD^).' };
}

export async function mergeBase(root: string, base: string): Promise<string> {
  return (await git(root, ['merge-base', base, 'HEAD'])).trim();
}

export async function isCurrentBranch(root: string, branch: string): Promise<boolean> {
  let current: string;
  try {
    current = (await git(root, ['symbolic-ref', '--quiet', 'HEAD'])).trim();
  } catch {
    // A detached HEAD is a commit, not a checked-out comparison branch.
    return false;
  }
  if (!current) {
    return false;
  }

  try {
    const comparison = (await git(root, ['rev-parse', '--symbolic-full-name', branch])).trim();
    return comparison === current;
  } catch {
    return false;
  }
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
  scope: DiffScope = 'all',
  excludePatterns: string[] = []
): Promise<BranchChange[]> {
  const output = await git(root, diffArgs(scope, comparisonCommit, ['--name-status', '-z']));
  const fields = output.split('\0').filter(Boolean);
  const changes: BranchChange[] = [];
  for (let i = 0; i + 1 < fields.length;) {
    const status = fields[i++][0];
    const firstPath = fields[i++];
    if (status === 'R' || status === 'C') {
      const destination = fields[i++];
      if (destination) changes.push({ status, path: destination, originalPath: firstPath });
    } else {
      changes.push({ status, path: firstPath });
    }
  }

  if (scope === 'all') {
    const untracked = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
    for (const file of untracked.split('\0').filter(Boolean)) {
      changes.push({ status: '?', path: file });
    }
  }
  return changes
    .filter(change => !excludePatterns.some(pattern => pathMatchesPattern(change.path, pattern)))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function addChangeStats(root: string, comparisonCommit: string, scope: DiffScope,
  changes: BranchChange[]): Promise<void> {
  const fields = (await git(root, diffArgs(scope, comparisonCommit, ['--numstat', '-z']))).split('\0');
  const stats = new Map<string, BranchChange['stats']>();
  for (let i = 0; i < fields.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(fields[i]);
    if (!match) continue;
    let file = match[3];
    if (!file) {
      i++; // NUL-delimited rename source.
      file = fields[++i];
    }
    stats.set(file, match[1] === '-' || match[2] === '-'
      ? 'binary' : { added: Number(match[1]), deleted: Number(match[2]) });
  }
  for (const change of changes) {
    change.stats = stats.get(change.path);
    if (change.status === '?') {
      try {
        const content = await readFile(path.join(root, change.path));
        change.stats = content.subarray(0, 8000).includes(0) ? 'binary' : {
          added: content.reduce((count, byte) => count + (byte === 10 ? 1 : 0), 0)
            + (content.length && content[content.length - 1] !== 10 ? 1 : 0),
          deleted: 0
        };
      } catch {
        // A file removed during refresh has unavailable statistics.
      }
    }
  }
}

export function pathMatchesPattern(relativePath: string, pattern: string): boolean {
  const path = relativePath.replace(/\\/g, '/');
  let glob = pattern.replace(/\\/g, '/').trim();
  if (!glob) {
    return false;
  }

  const anchored = glob.startsWith('/');
  if (anchored) {
    glob = glob.slice(1);
  }
  if (glob.endsWith('/')) {
    glob += '**';
  }

  let expression = '';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === '*' && glob[index + 1] === '*') {
      index += 1;
      if (glob[index + 1] === '/') {
        index += 1;
        expression += '(?:.*/)?';
      } else {
        expression += '.*';
      }
    } else if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }

  const prefix = anchored || glob.includes('/') ? '^' : '(?:^|/)';
  return new RegExp(`${prefix}${expression}$`).test(path);
}

export async function listLineChanges(
  root: string,
  comparisonCommit: string,
  relativePath: string,
  scope: DiffScope = 'all',
  originalPath?: string
): Promise<BranchLineChange[]> {
  const output = await git(root, diffArgs(scope, comparisonCommit, [
    '--unified=0',
    '--no-ext-diff'
  ], originalPath ? [originalPath, relativePath] : [relativePath]));
  // The old path may have been recreated. Only the rename patch belongs to
  // the destination editor; ignore any separate addition at the old path.
  const patch = originalPath
    ? output.split(/^diff --git /m).filter(section => /^rename from /m.test(section)).join('\n')
    : output;
  return parseLineChanges(patch);
}

function diffArgs(
  scope: DiffScope,
  comparisonCommit: string,
  options: string[],
  relativePaths: string[] = []
): string[] {
  const args = ['diff', ...options, '--find-renames'];
  if (scope === 'staged') {
    args.push('--cached', comparisonCommit);
  } else if (scope === 'committed') {
    args.push(comparisonCommit, 'HEAD');
  } else {
    args.push(comparisonCommit);
  }
  args.push('--');
  args.push(...relativePaths.map(file => `:(literal)${file}`));
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
