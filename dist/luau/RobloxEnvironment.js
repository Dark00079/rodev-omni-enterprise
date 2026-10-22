/**
 * Installs the Roblox global environment onto a Luau VM: datatype constructors,
 * the Enum tree, the DataModel (`game`/`workspace`), and core globals such as
 * `typeof`, `print`, `warn`, `tick`, and a basic `task` library.
 *
 * Constructor libraries (Vector3, CFrame, Instance, ...) are installed as real
 * Lua tables of plain functions, so `Vector3.new(1, 2, 3)` takes positional
 * arguments with no implicit self. Live objects are bridged userdata (see
 * ObjectBridge).
 */
import { LuaType } from './LuauVM.js';
import { ObjectBridge, robloxTypeOf } from './ObjectBridge.js';
import { TaskScheduler } from './TaskScheduler.js';
import { Vector2, Vector3, CFrame, UDim, UDim2, Color3, ColorSequence, ColorSequenceKeypoint, NumberSequence, NumberSequenceKeypoint, Ray, RaycastParams, OverlapParams, TweenInfo, Rect, Enum, } from '../runtime/datatypes.js';
import { InstanceEngine } from '../runtime/instanceEngine.js';
export function installEnvironment(vm, game) {
    const bridge = new ObjectBridge(vm);
    const logs = [];
    const scheduler = new TaskScheduler(vm, bridge, (msg) => logs.push({ level: 'error', text: msg }));
    const env = { vm, bridge, game, logs, scheduler };
    // --- a library table of plain (no-self) functions/values --------------
    const lib = (name, members) => {
        vm.newTable();
        for (const [key, value] of Object.entries(members)) {
            if (typeof value === 'function') {
                installPlainFunction(vm, bridge, value, key);
            }
            else {
                bridge.marshalToLua(value);
            }
            vm.setField(-2, key);
        }
        vm.setGlobal(name);
    };
    // --- datatype constructors --------------------------------------------
    lib('Instance', {
        new: (className, parent) => InstanceEngine.new(className, parent ?? undefined),
    });
    lib('Vector2', {
        new: (x = 0, y = 0) => new Vector2(x, y),
        zero: Vector2.zero, one: Vector2.one, xAxis: Vector2.xAxis, yAxis: Vector2.yAxis,
    });
    lib('Vector3', {
        new: (x = 0, y = 0, z = 0) => new Vector3(x, y, z),
        zero: Vector3.zero, one: Vector3.one,
        xAxis: Vector3.xAxis, yAxis: Vector3.yAxis, zAxis: Vector3.zAxis,
        fromAxis: (a) => Vector3.fromAxis(a),
    });
    lib('CFrame', {
        new: (...a) => CFrame.new(...a),
        lookAt: (at, look, up) => CFrame.lookAt(at, look, up),
        Angles: (x, y, z) => CFrame.Angles(x, y, z),
        fromEulerAnglesXYZ: (x, y, z) => CFrame.fromEulerAnglesXYZ(x, y, z),
        identity: CFrame.identity,
    });
    lib('UDim', { new: (s = 0, o = 0) => new UDim(s, o) });
    lib('UDim2', {
        new: (xs = 0, xo = 0, ys = 0, yo = 0) => new UDim2(xs, xo, ys, yo),
        fromScale: (x, y) => UDim2.fromScale(x, y),
        fromOffset: (x, y) => UDim2.fromOffset(x, y),
    });
    lib('Color3', {
        new: (r = 0, g = 0, b = 0) => new Color3(r, g, b),
        fromRGB: (r = 0, g = 0, b = 0) => Color3.fromRGB(r, g, b),
        fromHSV: (h = 0, s = 0, v = 0) => Color3.fromHSV(h, s, v),
        fromHex: (hex) => Color3.fromHex(hex),
    });
    lib('ColorSequence', { new: (...a) => ColorSequence.new(...a) });
    lib('ColorSequenceKeypoint', { new: (t, c) => ColorSequenceKeypoint.new(t, c) });
    lib('NumberSequence', { new: (...a) => NumberSequence.new(...a) });
    lib('NumberSequenceKeypoint', { new: (t, v, e = 0) => NumberSequenceKeypoint.new(t, v, e) });
    lib('Ray', { new: (o, d) => Ray.new(o, d) });
    lib('RaycastParams', { new: () => RaycastParams.new() });
    lib('OverlapParams', { new: () => OverlapParams.new() });
    lib('TweenInfo', { new: (...a) => TweenInfo.new(...a) });
    lib('Rect', { new: (a = 0, b = 0, c = 0, d = 0) => Rect.new(a, b, c, d) });
    // --- Enum tree & live objects -----------------------------------------
    bridge.marshalToLua(Enum);
    vm.setGlobal('Enum');
    bridge.pushObject(game);
    vm.setGlobal('game');
    bridge.pushObject(game.Workspace);
    vm.setGlobal('workspace');
    // --- core globals ------------------------------------------------------
    installPlainFunction(vm, bridge, (...args) => {
        logs.push({ level: 'print', text: args.map(luaToDisplay).join('\t') });
    }, 'print');
    vm.setGlobal('print');
    installPlainFunction(vm, bridge, (...args) => {
        logs.push({ level: 'warn', text: args.map(luaToDisplay).join('\t') });
    }, 'warn');
    vm.setGlobal('warn');
    vm.pushJSFunction((v) => {
        v.pushString(luaTypeName(v, 1));
        return 1;
    }, 'typeof');
    vm.setGlobal('typeof');
    installPlainFunction(vm, bridge, () => scheduler.clock, 'tick');
    vm.setGlobal('tick');
    installPlainFunction(vm, bridge, () => scheduler.clock, 'time');
    vm.setGlobal('time');
    installPlainFunction(vm, bridge, () => scheduler.clock, 'elapsedTime');
    vm.setGlobal('elapsedTime');
    // --- task library (coroutine scheduler) --------------------------------
    vm.newTable();
    vm.pushJSFunction((v) => scheduler.wait(v, v.getTop() >= 1 ? v.toNumber(1) : 0), 'wait');
    vm.setField(-2, 'wait');
    vm.pushJSFunction((v) => { const t = scheduler.spawnFromStack(v); v.pushThread(t); return 1; }, 'spawn');
    vm.setField(-2, 'spawn');
    vm.pushJSFunction((v) => { const t = scheduler.deferFromStack(v); v.pushThread(t); return 1; }, 'defer');
    vm.setField(-2, 'defer');
    vm.pushJSFunction((v) => { const d = v.toNumber(1); const t = scheduler.delayFromStack(v, d); v.pushThread(t); return 1; }, 'delay');
    vm.setField(-2, 'delay');
    vm.pushJSFunction(() => 0, 'cancel'); // cancellation is a no-op placeholder
    vm.setField(-2, 'cancel');
    vm.setGlobal('task');
    // Legacy globals that map onto the scheduler.
    vm.pushJSFunction((v) => scheduler.wait(v, v.getTop() >= 1 ? v.toNumber(1) : 0), 'wait');
    vm.setGlobal('wait');
    vm.pushJSFunction((v) => { scheduler.spawnFromStack(v); return 0; }, 'spawn');
    vm.setGlobal('spawn');
    vm.pushJSFunction((v) => { const d = v.toNumber(1); scheduler.delayFromStack(v, d); return 0; }, 'delay');
    vm.setGlobal('delay');
    return env;
}
// Installs a function that takes positional args (no implicit self) and
// marshals a single result back, pushed onto the stack.
function installPlainFunction(_vm, bridge, fn, name) {
    bridge.pushFunction(fn, name);
}
function luaTypeName(vm, idx) {
    switch (vm.type(idx)) {
        case LuaType.Nil: return 'nil';
        case LuaType.Boolean: return 'boolean';
        case LuaType.Number: return 'number';
        case LuaType.String: return 'string';
        case LuaType.Vector: return 'Vector3';
        case LuaType.Function: return 'function';
        case LuaType.Thread: return 'thread';
        case LuaType.Buffer: return 'buffer';
        case LuaType.Table: return 'table';
        case LuaType.Userdata: return robloxTypeOf(vm.toRef(idx));
        default: return 'userdata';
    }
}
function luaToDisplay(value) {
    if (value === null || value === undefined)
        return 'nil';
    if (typeof value === 'object' && typeof value.toString === 'function')
        return value.toString();
    return String(value);
}
