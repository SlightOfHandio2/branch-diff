import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { BranchLineChange } from './git';

const exec = promisify(execFile);

// Map only surviving lines. A replaced/deleted scoped line has no reliable
// counterpart in the working editor, so its marker is omitted.
export function mapLineChanges(changes: BranchLineChange[], patch: string): BranchLineChange[] {
  const edits = [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map(match => {
    const oldCount = match[2] === undefined ? 1 : Number(match[2]);
    return { start: Number(match[1]) - (oldCount ? 1 : 0), oldCount,
      newCount: match[4] === undefined ? 1 : Number(match[4]) };
  });
  const result: BranchLineChange[] = [];
  for (const change of changes) {
    let cursor = change.startLine - 1;
    const end = cursor + change.lineCount;
    let offset = 0;
    for (const edit of edits) {
      if (edit.start >= end) break;
      if (cursor < edit.start) {
        result.push({ ...change, startLine: cursor + offset + 1, lineCount: edit.start - cursor });
        cursor = edit.start;
      }
      cursor = Math.max(cursor, edit.start + edit.oldCount);
      offset += edit.newCount - edit.oldCount;
      if (cursor >= end) break;
    }
    if (cursor < end) result.push({ ...change, startLine: cursor + offset + 1, lineCount: end - cursor });
  }
  return result;
}

export async function alignLineChanges(changes: BranchLineChange[], source: string, working: string): Promise<BranchLineChange[]> {
  source = source.replace(/\r\n/g, '\n');
  working = working.replace(/\r\n/g, '\n');
  if (!changes.length || source === working) return changes;
  const directory = await mkdtemp(path.join(tmpdir(), 'branch-diff-lines-'));
  try {
    const before = path.join(directory, 'before');
    const after = path.join(directory, 'after');
    await Promise.all([writeFile(before, source), writeFile(after, working)]);
    let patch: string;
    try {
      patch = (await exec('git', ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color',
        '--text', '--unified=0', '--', before, after], { encoding: 'utf8', windowsHide: true,
        maxBuffer: 20 * 1024 * 1024 })).stdout;
    } catch (error) {
      const failure = error as { code?: number; stdout?: string };
      if (failure.code !== 1 || typeof failure.stdout !== 'string') throw error;
      patch = failure.stdout;
    }
    return mapLineChanges(changes, patch);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
