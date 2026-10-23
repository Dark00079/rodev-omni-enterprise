import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LuauVM } from '../../src/luau/LuauVM.js';
import { installEnvironment } from '../../src/luau/RobloxEnvironment.js';
import { DataModel } from '../../src/runtime/services.js';

async function runMain(src: string): Promise<{ err: string | null; logs: string[] }> {
  const vm = await LuauVM.create();
  const env = installEnvironment(vm, new DataModel());
  const err = env.scheduler.runMain(src, 't');
  const logs = env.logs.map((l) => (l.level === 'error' ? 'ERR:' : '') + l.text);
  vm.close();
  return { err, logs };
}

test('task.spawn runs synchronously, task.defer after the cycle', async () => {
  const { logs } = await runMain(`
    print("a")
    task.spawn(function() print("b") end)
    print("c")
    task.defer(function() print("d") end)
    local t = task.wait(0.5)
    print("e="..t)
  `);
  assert.deepEqual(logs, ['a', 'b', 'c', 'd', 'e=0.5']);
});

test('task.delay fires before a longer wait', async () => {
  const { logs } = await runMain(`
    task.delay(1, function() print("delayed") end)
    task.wait(2)
    print("after")
  `);
  assert.deepEqual(logs, ['delayed', 'after']);
});

test('coroutine interleaving across waits is ordered by time', async () => {
  const { logs } = await runMain(`
    task.spawn(function() print("s1") task.wait(0.1) print("s2") end)
    print("main")
    task.wait(0.2)
    print("mainend")
  `);
  assert.deepEqual(logs, ['s1', 'main', 's2', 'mainend']);
});

test('staggered spawned waits resume in deadline order', async () => {
  const { logs } = await runMain(`
    for i=1,3 do task.spawn(function() task.wait(i*0.1) print("tick"..i) end) end
    task.wait(0.5)
    print("done")
  `);
  assert.deepEqual(logs, ['tick1', 'tick2', 'tick3', 'done']);
});

test('an error on a spawned thread is isolated from the main script', async () => {
  const { logs } = await runMain(`
    print("before")
    task.spawn(function() error("kaboom") end)
    print("after")
  `);
  assert.equal(logs[0], 'before');
  assert.equal(logs[logs.length - 1], 'after');
  assert.ok(logs.some((l) => l.startsWith('ERR:') && l.includes('kaboom')));
});
