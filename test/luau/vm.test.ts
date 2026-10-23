import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LuauVM, LuaType } from '../../src/luau/LuauVM.js';

test('evaluates arithmetic and returns a number', async () => {
  const vm = await LuauVM.create();
  assert.equal(vm.load('return 2 + 40'), null);
  assert.equal(vm.pcall(0, 1), null);
  assert.equal(vm.type(-1), LuaType.Number);
  assert.equal(vm.toNumber(-1), 42);
  vm.close();
});

test('calls a host function from Lua', async () => {
  const vm = await LuauVM.create();
  vm.pushJSFunction((v) => { v.pushNumber(v.toNumber(1) * v.toNumber(2)); return 1; }, 'mul');
  vm.setGlobal('mul');
  assert.equal(vm.load('return mul(6, 7)'), null);
  assert.equal(vm.pcall(0, 1), null);
  assert.equal(vm.toNumber(-1), 42);
  vm.close();
});

test('propagates a host error through pcall', async () => {
  const vm = await LuauVM.create();
  vm.pushJSFunction(() => { throw new Error('boom'); }, 'kaboom');
  vm.setGlobal('kaboom');
  assert.equal(vm.load('local ok, e = pcall(kaboom); return tostring(ok) .. "|" .. tostring(e)'), null);
  assert.equal(vm.pcall(0, 1), null);
  assert.match(vm.toString(-1), /^false\|.*boom/);
  vm.close();
});

test('reference userdata round-trips JS object identity', async () => {
  const vm = await LuauVM.create();
  const obj = { tag: 'unique' };
  vm.pushRef(obj); vm.setGlobal('ref');
  vm.pushJSFunction((v) => { v.pushBoolean(v.toRef(1) === obj); return 1; }, 'same');
  vm.setGlobal('same');
  assert.equal(vm.load('return same(ref)'), null);
  assert.equal(vm.pcall(0, 1), null);
  assert.equal(vm.toBoolean(-1), true);
  vm.close();
});

test('the real Luau compiler supports continue, compound assignment and interpolation', async () => {
  const vm = await LuauVM.create();
  assert.equal(vm.load('local s=0 for i=1,5 do if i%2==0 then continue end s+=i end return `s={s}`'), null);
  assert.equal(vm.pcall(0, 1), null);
  assert.equal(vm.toString(-1), 's=9');
  vm.close();
});

test('rejects invalid syntax at load time without leaving stack residue', async () => {
  const vm = await LuauVM.create();
  const err = vm.load('return ++');
  assert.notEqual(err, null);
  assert.equal(vm.getTop(), 0);
  vm.close();
});
