import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LuauSandbox } from '../../src/luau/LuauSandbox.js';

test('WaitForChild resumes when the child appears later', async () => {
  const sbx = await LuauSandbox.create();
  const r = sbx.execute(`
    task.delay(0.1, function() local f=Instance.new("Folder") f.Name="Loaded" f.Parent=workspace end)
    local obj = workspace:WaitForChild("Loaded")
    print("got "..obj.Name)
  `);
  assert.ok(r.success, r.error ?? '');
  assert.deepEqual(r.logs.map((l) => l.text), ['got Loaded']);
  sbx.close();
});

test('WaitForChild with a timeout returns nil', async () => {
  const sbx = await LuauSandbox.create();
  const r = sbx.execute(`print("result="..tostring(workspace:WaitForChild("Nope", 0.2)))`);
  assert.ok(r.success, r.error ?? '');
  assert.deepEqual(r.logs.map((l) => l.text), ['result=nil']);
  sbx.close();
});

test('RunService.Heartbeat fires per stepped frame and honors Disconnect', async () => {
  const sbx = await LuauSandbox.create();
  sbx.execute(`
    _G.n = 0
    local conn
    conn = game:GetService("RunService").Heartbeat:Connect(function() _G.n += 1 if _G.n >= 3 then conn:Disconnect() end end)
  `);
  sbx.stepFrames(5);
  const r = sbx.execute(`print(_G.n)`);
  assert.equal(r.logs[0].text, '3');
  sbx.close();
});

test('RemoteFunction OnServerInvoke returns a value synchronously', async () => {
  const sbx = await LuauSandbox.create();
  const r = sbx.execute(`
    local rf = Instance.new("RemoteFunction", game:GetService("ReplicatedStorage"))
    rf.OnServerInvoke = function(_, a, b) return a + b end
    print("invoke="..tostring(rf:InvokeServer(20, 22)))
  `);
  assert.equal(r.logs[0].text, 'invoke=42');
  sbx.close();
});

test('BindableEvent delivers arguments to its handler', async () => {
  const sbx = await LuauSandbox.create();
  const r = sbx.execute(`
    local be = Instance.new("BindableEvent")
    local sum = 0
    be.Event:Connect(function(a, b) sum = a + b end)
    be:Fire(3, 4)
    print("sum="..sum)
  `);
  assert.equal(r.logs[0].text, 'sum=7');
  sbx.close();
});

test('indexing a missing Instance member raises a descriptive error', async () => {
  const sbx = await LuauSandbox.create();
  const r = sbx.execute(`local p = Instance.new("Part") return p.ThisDoesNotExist`);
  assert.equal(r.success, false);
  assert.match(r.error ?? '', /is not a valid member of Part/);
  sbx.close();
});
