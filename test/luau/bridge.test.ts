import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LuauVM } from '../../src/luau/LuauVM.js';
import { installEnvironment } from '../../src/luau/RobloxEnvironment.js';
import { DataModel } from '../../src/runtime/services.js';

async function evalLua(src: string): Promise<string> {
  const vm = await LuauVM.create();
  installEnvironment(vm, new DataModel());
  const le = vm.load(src, 't');
  if (le) throw new Error('load: ' + le);
  const pe = vm.pcall(0, 1);
  if (pe) throw new Error('run: ' + pe);
  const out = vm.toString(-1);
  vm.close();
  return out;
}

const cases: Array<[string, string, string]> = [
  ['vector add', 'return tostring((Vector3.new(1,2,3)+Vector3.new(1,1,1)).X)', '2'],
  ['vector magnitude', 'return tostring(Vector3.new(3,4,0).Magnitude)', '5'],
  ['vector scalar mul', 'return tostring((Vector3.new(1,2,3)*2).Z)', '6'],
  ['vector unit', 'return tostring(Vector3.new(0,5,0).Unit.Y)', '1'],
  ['cframe mul position', 'return tostring((CFrame.new(1,2,3)*CFrame.new(1,0,0)).Position.X)', '2'],
  ['instance props', 'local p=Instance.new("Part") p.Name="Hero" p.Size=Vector3.new(2,3,4) return p.Name..":"..p.Size.Y', 'Hero:3'],
  ['parenting', 'local p=Instance.new("Part", workspace) return p.Parent.Name', 'Workspace'],
  ['child index lookup', 'local f=Instance.new("Folder", workspace) f.Name="Stuff" return workspace.Stuff.Name', 'Stuff'],
  ['GetService', 'return game:GetService("Players").Name', 'Players'],
  ['IsA', 'local p=Instance.new("Part") return tostring(p:IsA("BasePart"))..","..tostring(p:IsA("Model"))', 'true,false'],
  ['typeof instance', 'return typeof(Instance.new("Part"))', 'Instance'],
  ['typeof vector', 'return typeof(Vector3.new())', 'Vector3'],
  ['typeof enumitem', 'return typeof(Enum.Material.Neon)', 'EnumItem'],
  ['enum equality', 'return tostring(Enum.Material.Neon == Enum.Material.Neon)', 'true'],
  ['enum value', 'return tostring(Enum.KeyCode.Space.Value)', '37'],
  ['tostring vector', 'return tostring(Vector3.new(1,2,3))', '1, 2, 3'],
];

for (const [name, src, expected] of cases) {
  test(`bridge: ${name}`, async () => {
    assert.equal(await evalLua(src), expected);
  });
}

test('Changed fires once per property write', async () => {
  const vm = await LuauVM.create();
  installEnvironment(vm, new DataModel());
  vm.load('local p=Instance.new("Part") local n=0 p.Changed:Connect(function() n+=1 end) p.Name="X" p.Name="Y" return n', 't');
  vm.pcall(0, 1);
  assert.equal(vm.toNumber(-1), 2);
  vm.close();
});

test('GetPropertyChangedSignal delivers the new value', async () => {
  const vm = await LuauVM.create();
  installEnvironment(vm, new DataModel());
  vm.load('local p=Instance.new("Part") local got="" p:GetPropertyChangedSignal("Name"):Connect(function() got=p.Name end) p.Name="Zed" return got', 't');
  vm.pcall(0, 1);
  assert.equal(vm.toString(-1), 'Zed');
  vm.close();
});

test('assigning to an immutable datatype field errors', async () => {
  const vm = await LuauVM.create();
  installEnvironment(vm, new DataModel());
  vm.load('local ok = pcall(function() Vector3.new(1,2,3).X = 9 end) return tostring(ok)', 't');
  vm.pcall(0, 1);
  assert.equal(vm.toString(-1), 'false');
  vm.close();
});
