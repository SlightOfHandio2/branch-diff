import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  fileAtCommit,
  addChangeStats,
  isCurrentBranch,
  listChanges,
  listLineChanges,
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

test('renames retain original paths across scopes and only mark actual edits', async t => {
  const root = repository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const originalPath = 'old name [1].txt';
  const destination = 'new name [2].txt';
  const content = Array.from({ length: 20 }, (_, i) => `original line ${i + 1}\n`).join('');
  writeFileSync(path.join(root, originalPath), content);
  run(root, 'add', '.');
  run(root, 'commit', '-m', 'rename baseline');
  const base = run(root, 'rev-parse', 'HEAD');
  run(root, 'mv', originalPath, destination);
  const renamed = [{ status: 'R', path: destination, originalPath }];
  assert.deepEqual(await listChanges(root, base, 'committed'), []);
  for (const scope of ['staged', 'all'] as const) {
    assert.deepEqual(await listChanges(root, base, scope), renamed);
    assert.deepEqual(await listLineChanges(root, base, destination, scope, originalPath), []);
  }
  writeFileSync(path.join(root, destination), content.replace('original line 10\n', 'edited line ten\n'));
  assert.deepEqual(await listLineChanges(root, base, destination, 'staged', originalPath), []);
  const markers = [{ startLine: 10, lineCount: 1, kind: 'modified' }];
  assert.deepEqual(await listLineChanges(root, base, destination, 'all', originalPath), markers);
  run(root, 'add', '.');
  run(root, 'commit', '-m', 'rename and edit');
  for (const scope of ['committed', 'staged', 'all'] as const) {
    assert.deepEqual(await listChanges(root, base, scope), renamed);
    assert.deepEqual(await listLineChanges(root, base, destination, scope, originalPath), markers);
    const changes = await listChanges(root, base, scope);
    await addChangeStats(root, base, scope, changes);
    assert.deepEqual(changes[0].stats, { added: 1, deleted: 1 });
  }
  assert.equal(await fileAtCommit(root, base, originalPath), content);
  assert.deepEqual(await listChanges(root, base, 'all', [destination.replace('[2]', '*')]), []);
  writeFileSync(path.join(root, originalPath), 'a different file at the old path\n');
  run(root, 'add', '.');
  // Git now sees a modified original and an added destination, not a rename.
  assert.deepEqual(await listChanges(root, base, 'all'), [
    { status: 'A', path: destination },
    { status: 'M', path: originalPath }
  ]);
});

test('statistics follow scopes and exclusions and distinguish binary and untracked files', async t => {
  const root = repository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = run(root, 'rev-parse', 'HEAD');
  writeFileSync(path.join(root, 'existing.txt'), 'staged one\nstaged two\n');
  writeFileSync(path.join(root, 'binary.dat'), Buffer.from([0, 1, 2, 3]));
  run(root, 'add', '.');
  writeFileSync(path.join(root, 'existing.txt'), 'working\n');
  writeFileSync(path.join(root, 'untracked.txt'), 'first\nlast without newline');
  writeFileSync(path.join(root, 'empty.txt'), '');
  writeFileSync(path.join(root, 'untracked.dat'), Buffer.from([0, 1]));
  const staged = await listChanges(root, base, 'staged');
  await addChangeStats(root, base, 'staged', staged);
  assert.deepEqual(staged.find(change => change.path === 'existing.txt')?.stats, { added: 2, deleted: 1 });
  assert.equal(staged.find(change => change.path === 'binary.dat')?.stats, 'binary');
  const all = await listChanges(root, base, 'all', ['binary.dat']);
  await addChangeStats(root, base, 'all', all);
  assert.equal(all.some(change => change.path === 'binary.dat'), false);
  assert.deepEqual(all.find(change => change.path === 'existing.txt')?.stats, { added: 1, deleted: 1 });
  assert.deepEqual(all.find(change => change.path === 'untracked.txt')?.stats, { added: 2, deleted: 0 });
  assert.deepEqual(all.find(change => change.path === 'empty.txt')?.stats, { added: 0, deleted: 0 });
  assert.equal(all.find(change => change.path === 'untracked.dat')?.stats, 'binary');
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
