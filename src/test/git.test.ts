import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  fileAtCommit,
  isCurrentBranch,
  listChanges,
  mappedBase,
  mergeBase,
  parseLineChanges,
  pathMatchesPattern,
  resolveBase
} from '../git';

function run(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function repository(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'branch-diff-test-'));
  run(root, 'init', '-b', 'main');
  run(root, 'config', 'user.name', 'Branch Diff Test');
  run(root, 'config', 'user.email', 'test@example.invalid');
  run(root, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(root, 'existing.txt'), 'baseline\n');
  run(root, 'add', '.');
  run(root, 'commit', '-m', 'baseline');
  return root;
}

test('automatic base resolves the nearest branch in a branch stack', async t => {
  const root = repository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  run(root, 'switch', '-c', 'A');
  writeFileSync(path.join(root, 'stack.txt'), 'A\n');
  run(root, 'add', '.');
  run(root, 'commit', '-m', 'A');
  run(root, 'switch', '-c', 'B');
  writeFileSync(path.join(root, 'stack.txt'), 'B\n');
  run(root, 'commit', '-am', 'B');
  run(root, 'switch', '-c', 'C');
  writeFileSync(path.join(root, 'stack.txt'), 'C\n');
  run(root, 'commit', '-am', 'C');

  assert.equal(await resolveBase(root, ''), 'B');
  run(root, 'switch', 'B');
  assert.equal(await resolveBase(root, ''), 'A');
  run(root, 'switch', 'A');
  assert.equal(await resolveBase(root, ''), 'main');
});

test('repository-default strategy remains available', async t => {
  const root = repository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  run(root, 'switch', '-c', 'A');
  writeFileSync(path.join(root, 'stack.txt'), 'A\n');
  run(root, 'add', '.');
  run(root, 'commit', '-m', 'A');
  run(root, 'switch', '-c', 'B');

  assert.equal(await resolveBase(root, '', 'defaultBranch'), 'main');
});

test('branch base mappings prefer exact names and support wildcards', () => {
  const mappings = {
    'feature/*': 'develop',
    'feature/special': 'release',
    'release/?': 'main'
  };
  assert.equal(mappedBase('feature/special', mappings), 'release');
  assert.equal(mappedBase('feature/login', mappings), 'develop');
  assert.equal(mappedBase('release/1', mappings), 'main');
  assert.equal(mappedBase('other', mappings), undefined);
});

test('configured branch base mappings are used before automatic detection', async t => {
  const root = repository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  run(root, 'switch', '-c', 'develop');
  run(root, 'switch', '-c', 'feature/login');

  assert.equal(await resolveBase(root, '', 'nearestAncestor', { 'feature/*': 'develop' }), 'develop');
});

test('current branch is recognized as the comparison branch', async t => {
  const root = repository();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(await isCurrentBranch(root, 'main'), true);
  assert.equal(await isCurrentBranch(root, 'refs/heads/main'), true);
  assert.equal(await isCurrentBranch(root, 'HEAD'), true);

  run(root, 'switch', '-c', 'feature');
  assert.equal(await isCurrentBranch(root, 'main'), false);

  run(root, 'switch', '--detach');
  assert.equal(await isCurrentBranch(root, 'feature'), false);
});

test('branch changes include committed, working-tree, and untracked files', async t => {
  const root = repository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  run(root, 'switch', '-c', 'feature');
  writeFileSync(path.join(root, 'committed.txt'), 'committed\n');
  run(root, 'add', '.');
  run(root, 'commit', '-m', 'feature work');
  writeFileSync(path.join(root, 'existing.txt'), 'working tree\n');
  writeFileSync(path.join(root, 'untracked.txt'), 'new\n');

  const base = await mergeBase(root, 'main');
  const changes = await listChanges(root, base);
  assert.deepEqual(changes, [
    { status: 'A', path: 'committed.txt' },
    { status: 'M', path: 'existing.txt' },
    { status: '?', path: 'untracked.txt' }
  ]);
});

test('diff scopes separate committed, staged, and working-tree changes', async t => {
  const root = repository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  run(root, 'switch', '-c', 'feature');
  writeFileSync(path.join(root, 'committed.txt'), 'committed\n');
  run(root, 'add', '.');
  run(root, 'commit', '-m', 'committed work');
  writeFileSync(path.join(root, 'staged.txt'), 'staged\n');
  run(root, 'add', 'staged.txt');
  writeFileSync(path.join(root, 'existing.txt'), 'unstaged\n');
  writeFileSync(path.join(root, 'untracked.txt'), 'untracked\n');
  const base = await mergeBase(root, 'main');

  assert.deepEqual(await listChanges(root, base, 'committed'), [
    { status: 'A', path: 'committed.txt' }
  ]);
  assert.deepEqual(await listChanges(root, base, 'staged'), [
    { status: 'A', path: 'committed.txt' },
    { status: 'A', path: 'staged.txt' }
  ]);
  assert.deepEqual(await listChanges(root, base, 'all'), [
    { status: 'A', path: 'committed.txt' },
    { status: 'M', path: 'existing.txt' },
    { status: 'A', path: 'staged.txt' },
    { status: '?', path: 'untracked.txt' }
  ]);
});

test('exclude patterns support filenames, directories, wildcards, and root anchoring', () => {
  assert.equal(pathMatchesPattern('package-lock.json', 'package-lock.json'), true);
  assert.equal(pathMatchesPattern('app/package-lock.json', 'package-lock.json'), true);
  assert.equal(pathMatchesPattern('component.snap', '**/*.snap'), true);
  assert.equal(pathMatchesPattern('src/components/component.snap', '**/*.snap'), true);
  assert.equal(pathMatchesPattern('dist/app.js', 'dist/**'), true);
  assert.equal(pathMatchesPattern('packages/app/dist/app.js', 'dist/**'), false);
  assert.equal(pathMatchesPattern('package-lock.json', '/package-lock.json'), true);
  assert.equal(pathMatchesPattern('app/package-lock.json', '/package-lock.json'), false);
  assert.equal(pathMatchesPattern('release/1', 'release/?'), true);
});

test('excluded files are removed from branch changes', async t => {
  const root = repository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  run(root, 'switch', '-c', 'feature');
  writeFileSync(path.join(root, 'keep.ts'), 'keep\n');
  writeFileSync(path.join(root, 'ignored.snap'), 'snapshot\n');
  writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  const base = await mergeBase(root, 'main');

  assert.deepEqual(await listChanges(root, base, 'all', ['**/*.snap', 'package-lock.json']), [
    { status: '?', path: 'keep.ts' }
  ]);
});

test('baseline content is returned without changing whitespace', async t => {
  const root = repository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const head = run(root, 'rev-parse', 'HEAD');

  assert.equal(await fileAtCommit(root, head, 'existing.txt'), 'baseline\n');
  assert.equal(await fileAtCommit(root, head, 'not-there.txt'), '');
});

test('unified diff hunks become added, modified, and deleted line markers', () => {
  const diff = [
    '@@ -0,0 +1,2 @@',
    '@@ -5 +7 @@',
    '@@ -10,3 +11,0 @@'
  ].join('\n');
  assert.deepEqual(parseLineChanges(diff), [
    { startLine: 1, lineCount: 2, kind: 'added' },
    { startLine: 7, lineCount: 1, kind: 'modified' },
    { startLine: 11, lineCount: 1, kind: 'deleted' }
  ]);
});
