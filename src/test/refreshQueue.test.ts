import assert from 'node:assert/strict';
import test from 'node:test';
import { RefreshQueue } from '../refreshQueue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('refresh bursts wait for the running pass and share one follow-up', async () => {
  const started = deferred();
  const release = deferred();
  const calls: boolean[] = [];
  let active = 0;
  const queue = new RefreshQueue(async showErrors => {
    assert.equal(++active, 1, 'refreshes must never overlap');
    calls.push(showErrors);
    if (calls.length === 1) {
      started.resolve();
      await release.promise;
    }
    active--;
  });
  const initial = queue.request();
  await started.promise;
  const requests = [queue.request(), queue.request(true), queue.request()];
  assert.deepEqual(calls, [false]);
  release.resolve();
  await Promise.all([initial, ...requests]);
  assert.deepEqual(calls, [false, true]);
  await queue.request();
  assert.deepEqual(calls, [false, true, false]);
});

test('requests before a pass starts coalesce and retain error reporting', async () => {
  const calls: boolean[] = [];
  const queue = new RefreshQueue(async showErrors => { calls.push(showErrors); });
  await Promise.all([queue.request(true), queue.request(), queue.request()]);
  assert.deepEqual(calls, [true]);
});

test('a failed refresh does not prevent a later request', async () => {
  let calls = 0;
  const queue = new RefreshQueue(async () => {
    if (++calls === 1) throw new Error('Git failed');
  });
  await assert.rejects(queue.request(), /Git failed/);
  await queue.request();
  assert.equal(calls, 2);
});
