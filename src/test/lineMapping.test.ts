import assert from 'node:assert/strict';
import test from 'node:test';
import { alignLineChanges, mapLineChanges } from '../lineMapping';

test('insertions shift and split scoped ranges without marking new lines', () => {
  assert.deepEqual(mapLineChanges([{ startLine: 2, lineCount: 3, kind: 'added' }],
    '@@ -0,0 +1,2 @@\n@@ -2,0 +5 @@'), [
    { startLine: 4, lineCount: 1, kind: 'added' },
    { startLine: 6, lineCount: 2, kind: 'added' }
  ]);
});

test('deleted and replaced scoped lines are hidden; surviving lines shift', () => {
  assert.deepEqual(mapLineChanges([{ startLine: 2, lineCount: 4, kind: 'modified' }],
    '@@ -2,2 +1,0 @@\n@@ -5 +3,2 @@'), [
    { startLine: 2, lineCount: 1, kind: 'modified' }
  ]);
});

test('deletion anchors shift with their surviving context line', () => {
  assert.deepEqual(mapLineChanges([{ startLine: 3, lineCount: 1, kind: 'deleted' }],
    '@@ -1 +0,0 @@'), [{ startLine: 2, lineCount: 1, kind: 'deleted' }]);
});

test('real text alignment handles unsaved edits and CRLF without changing scope', async () => {
  const changes = [{ startLine: 2, lineCount: 1, kind: 'modified' as const }];
  const source = 'first\nscoped change\nlast\n';
  assert.deepEqual(await alignLineChanges(changes, source, 'new\r\nfirst\r\nscoped change\r\nlast\r\n'),
    [{ startLine: 3, lineCount: 1, kind: 'modified' }]);
  assert.deepEqual(await alignLineChanges(changes, source, 'first\nreplacement\nlast\n'), []);
  assert.deepEqual(await alignLineChanges(changes, source, ''), []);
});
