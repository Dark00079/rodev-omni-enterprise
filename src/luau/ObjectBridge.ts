/**
 * Bridges the JS Roblox object model (Instances, datatypes, signals, Enum)
 * into the Luau VM as userdata with authentic metatable semantics:
 *   - obj.Prop            -> __index  (property, method, or child lookup)
 *   - obj:Method(a, b)    -> __namecall
 *   - obj.Prop = value    -> __newindex (fires Changed for Instances)
 *   - a + b, a == b, ...  -> arithmetic/relational metamethods on datatypes
 *   - tostring(obj)       -> __tostring
 *   - typeof(obj)         -> __type
 *
 * A single set of generic metamethod closures works for every bridged class;
 * only the __type string differs per metatable, so metatables are built once
 * per type name and cached in the registry.
 */

import { LuauVM, LuaType, REF_TAG } from './LuauVM.js';
import {
  Vector2, Vector3, CFrame, UDim, UDim2, Color3, ColorSequence, ColorSequenceKeypoint,
  NumberSequence, NumberSequenceKeypoint, Ray, RaycastParams, RaycastResult, OverlapParams,
  TweenInfo, Rect, Enum,
} from '../runtime/datatypes.js';
import { Instance, RBXScriptSignal, RBXScriptConnection } from '../runtime/instanceEngine.js';

// Datatype constructor -> Roblox type name (for `typeof`).
const DATATYPE_NAMES = new Map<Function, string>([
  [Vector2, 'Vector2'], [Vector3, 'Vector3'], [CFrame, 'CFrame'],
  [UDim, 'UDim'], [UDim2, 'UDim2'], [Color3, 'Color3'],
  [ColorSequence, 'ColorSequence'], [ColorSequenceKeypoint, 'ColorSequenceKeypoint'],
  [NumberSequence, 'NumberSequence'], [NumberSequenceKeypoint, 'NumberSequenceKeypoint'],
  [Ray, 'Ray'], [RaycastParams, 'RaycastParams'], [RaycastResult, 'RaycastResult'],
  [OverlapParams, 'OverlapParams'], [TweenInfo, 'TweenInfo'], [Rect, 'Rect'],
]);

// Immutable datatypes reject property assignment (Roblox raises on these).
const IMMUTABLE = new Set(['Vector2', 'Vector3', 'CFrame', 'UDim', 'UDim2', 'Color3', 'Rect']);

// Methods whose JS array return represents multiple Lua return values rather
// than a single table.
const TUPLE_METHODS = new Set([
  'GetBoundingBox', 'WorldToViewportPoint', 'WorldToScreenPoint', 'ViewportPointToRay',
  'ScreenPointToRay', 'ToHSV', 'ToEulerAnglesXYZ', 'ToOrientation', 'GetComponents', 'components',
]);

function isEnumItem(o: any): boolean {
  return o && typeof o === 'object' && typeof o.EnumType === 'string' && typeof o.Value === 'number' && typeof o.Name === 'string';
}
function isEnumGroupOrRoot(o: any): boolean {
  return o === Enum || (o && typeof o === 'object' && typeof o.GetEnumItems === 'function');
}

export function robloxTypeOf(obj: any): string {
  if (obj instanceof Instance) return 'Instance';
  if (obj instanceof RBXScriptSignal) return 'RBXScriptSignal';
  if (obj instanceof RBXScriptConnection) return 'RBXScriptConnection';
  const dt = DATATYPE_NAMES.get(obj?.constructor);
  if (dt) return dt;
  if (isEnumItem(obj)) return 'EnumItem';
  if (isEnumGroupOrRoot(obj)) return 'Enum';
  return 'userdata';
}

export class ObjectBridge {
  private readonly metatables = new Map<string, number>(); // type name -> registry ref
  // Shared metamethod closures, reffed once and reused across all metatables.
  private sharedRefs: Record<string, number> | null = null;

  constructor(private readonly vm: LuauVM) {}

  /** Pushes a JS object as bridged userdata with the metatable for its type. */
  pushObject(obj: any): void {
    const vm = this.vm;
    vm.pushRef(obj, REF_TAG);
    const mtRef = this.metatableFor(robloxTypeOf(obj));
    vm.getRef(mtRef);     // metatable on top, userdata below
    vm.setMetatable(-2);  // pops metatable, sets it on the userdata
  }

  /** Marshals a JS value onto the Lua stack. */
  marshalToLua(value: any): void {
    const vm = this.vm;
    if (value === null || value === undefined) { vm.pushNil(); return; }
    switch (typeof value) {
      case 'number': vm.pushNumber(value); return;
      case 'boolean': vm.pushBoolean(value); return;
      case 'string': vm.pushString(value); return;
      case 'function': this.pushJSWrapped(value); return;
      case 'object': break;
      default: vm.pushNil(); return;
    }
    if (Array.isArray(value)) {
      vm.newTable();
      for (let i = 0; i < value.length; i++) {
        this.marshalToLua(value[i]);
        vm.rawSetI(-2, i + 1);
      }
      return;
    }
    // Any recognized Roblox object (or Enum tree) becomes bridged userdata.
    this.pushObject(value);
  }

  /** Reads a Lua value at `idx` into a JS value. */
  marshalToJS(idx: number): any {
    const vm = this.vm;
    switch (vm.type(idx)) {
      case LuaType.Nil: return null;
      case LuaType.Boolean: return vm.toBoolean(idx);
      case LuaType.Number: return vm.toNumber(idx);
      case LuaType.String: return vm.toString(idx);
      case LuaType.Vector: {
        const v = vm.toVector(idx)!;
        return new Vector3(v[0], v[1], v[2]);
      }
      case LuaType.Userdata: return vm.toRef(idx, REF_TAG);
      case LuaType.Function: return this.wrapLuaFunction(idx);
      case LuaType.Table: return this.tableToJS(idx);
      default: return undefined;
    }
  }

  private tableToJS(idx: number): any {
    const vm = this.vm;
    const abs = idx < 0 ? vm.getTop() + idx + 1 : idx;
    const arr: any[] = [];
    const obj: Record<string, any> = {};
    let sequential = true;
    let count = 0;
    vm.pushNil();
    while (vm.next(abs)) {
      // key at -2, value at -1
      const value = this.marshalToJS(-1);
      if (vm.type(-2) === LuaType.Number) {
        const n = vm.toNumber(-2);
        if (Number.isInteger(n) && n >= 1) arr[n - 1] = value; else sequential = false;
        obj[String(n)] = value;
      } else {
        sequential = false;
        obj[vm.toString(-2)] = value;
      }
      count++;
      vm.pop(1); // pop value, keep key for next
    }
    if (sequential && count === arr.length) return arr;
    return obj;
  }

  /** Wraps a Lua function (at idx) as a JS callback. Holds a registry ref. */
  private wrapLuaFunction(idx: number): (...args: any[]) => any {
    const vm = this.vm;
    vm.pushValue(idx);
    const ref = vm.ref(-1);
    vm.pop(1);
    const bridge = this;
    return (...args: any[]) => {
      vm.getRef(ref);
      for (const a of args) bridge.marshalToLua(a);
      const err = vm.pcall(args.length, 1);
      if (err) { vm.clearExecutionBudget(); throw new Error(err); }
      const result = bridge.marshalToJS(-1);
      vm.pop(1);
      return result;
    };
  }

  // A JS function exposed to Lua (e.g. a constructor or library function).
  private pushJSWrapped(fn: (...args: any[]) => any): void {
    const vm = this.vm;
    const bridge = this;
    vm.pushJSFunction((v) => {
      const n = v.getTop();
      const args: any[] = [];
      for (let i = 1; i <= n; i++) args.push(bridge.marshalToJS(i));
      const result = fn(...args);
      return bridge.pushResult(result, false);
    }, fn.name || 'fn');
  }

  // Pushes a method/function result; returns the number of Lua return values.
  private pushResult(result: any, tuple: boolean): number {
    const vm = this.vm;
    if (result === undefined) return 0;
    if (tuple && Array.isArray(result)) {
      for (const item of result) this.marshalToLua(item);
      return result.length;
    }
    this.marshalToLua(result);
    return 1;
  }

  // ---- metamethod dispatch ----------------------------------------------

  private invokeMethod(vm: LuauVM, methodName: string): number {
    const self = vm.toRef(1, REF_TAG);
    if (self === undefined) throw new Error(`cannot invoke ${methodName} on a non-object`);
    const fn = self[methodName];
    if (typeof fn !== 'function') {
      throw new Error(`${methodName} is not a valid member of ${robloxTypeOf(self)}`);
    }
    const n = vm.getTop();
    const args: any[] = [];
    for (let i = 2; i <= n; i++) args.push(this.marshalToJS(i));
    const result = fn.apply(self, args);
    return this.pushResult(result, TUPLE_METHODS.has(methodName));
  }

  private indexMember(vm: LuauVM): number {
    const self = vm.toRef(1, REF_TAG);
    const key = vm.toString(2);
    if (self === undefined) { vm.pushNil(); return 1; }

    if (key in self) {
      const value = (self as any)[key];
      if (typeof value === 'function') {
        // Return an unbound method: expects self as arg 1, like a real Lua method.
        const bridge = this;
        vm.pushJSFunction((v) => bridge.invokeMethod(v, key), key);
        return 1;
      }
      this.marshalToLua(value);
      return 1;
    }

    // Roblox: indexing an Instance by an unknown key looks up a child by name.
    if (self instanceof Instance) {
      const child = self.FindFirstChild(key);
      if (child) { this.pushObject(child); return 1; }
      throw new Error(`${key} is not a valid member of ${self.ClassName} "${self.Name}"`);
    }
    vm.pushNil();
    return 1;
  }

  private newindexMember(vm: LuauVM): number {
    const self = vm.toRef(1, REF_TAG);
    const key = vm.toString(2);
    const value = this.marshalToJS(3);
    if (self === undefined) return 0;

    const typeName = robloxTypeOf(self);
    if (IMMUTABLE.has(typeName)) {
      throw new Error(`${key} cannot be assigned to (${typeName} is immutable)`);
    }

    const hadAccessor = hasSetter(self, key);
    (self as any)[key] = value;
    // Plain-field writes on an Instance still fire Changed; accessor setters
    // (e.g. BasePart.Position) already fire it themselves.
    if (!hadAccessor && self instanceof Instance && typeof (self as any).firePropertyChanged === 'function') {
      (self as any).firePropertyChanged(key);
    }
    return 0;
  }

  private arithMetamethod(vm: LuauVM, op: 'add' | 'sub' | 'mul' | 'div', commutative: boolean): number {
    const a = this.marshalToJS(1);
    const b = this.marshalToJS(2);
    let result: any;
    if (a && typeof a[op] === 'function') result = a[op](b);
    else if (commutative && b && typeof b[op] === 'function') result = b[op](a);
    else throw new Error(`attempt to perform arithmetic (${op}) on incompatible values`);
    this.marshalToLua(result);
    return 1;
  }

  private eqMetamethod(vm: LuauVM): number {
    const a = this.marshalToJS(1);
    const b = this.marshalToJS(2);
    vm.pushBoolean(valuesEqual(a, b));
    return 1;
  }

  private tostringMetamethod(vm: LuauVM): number {
    const self = vm.toRef(1, REF_TAG);
    let text: string;
    if (self instanceof Instance) text = self.Name;
    else if (self && typeof self.toString === 'function') text = self.toString();
    else text = robloxTypeOf(self);
    vm.pushString(text);
    return 1;
  }

  // ---- metatable construction -------------------------------------------

  private ensureSharedRefs(): Record<string, number> {
    if (this.sharedRefs) return this.sharedRefs;
    const vm = this.vm;
    const bridge = this;
    const make = (fn: (v: LuauVM) => number, name: string): number => {
      vm.pushJSFunction(fn, name);
      const ref = vm.ref(-1);
      vm.pop(1);
      return ref;
    };
    this.sharedRefs = {
      __index: make((v) => bridge.indexMember(v), '__index'),
      __newindex: make((v) => bridge.newindexMember(v), '__newindex'),
      __namecall: make((v) => bridge.invokeMethod(v, v.namecallName()), '__namecall'),
      __tostring: make((v) => bridge.tostringMetamethod(v), '__tostring'),
      __add: make((v) => bridge.arithMetamethod(v, 'add', true), '__add'),
      __sub: make((v) => bridge.arithMetamethod(v, 'sub', false), '__sub'),
      __mul: make((v) => bridge.arithMetamethod(v, 'mul', true), '__mul'),
      __div: make((v) => bridge.arithMetamethod(v, 'div', false), '__div'),
      __eq: make((v) => bridge.eqMetamethod(v), '__eq'),
    };
    return this.sharedRefs;
  }

  private metatableFor(typeName: string): number {
    const existing = this.metatables.get(typeName);
    if (existing !== undefined) return existing;

    const vm = this.vm;
    const shared = this.ensureSharedRefs();
    vm.newTable();
    vm.pushString(typeName);
    vm.setField(-2, '__type');
    for (const [field, ref] of Object.entries(shared)) {
      vm.getRef(ref);
      vm.setField(-2, field);
    }
    vm.setReadonly(-1, true); // Roblox metatables are locked
    const mtRef = vm.ref(-1);
    vm.pop(1);
    this.metatables.set(typeName, mtRef);
    return mtRef;
  }
}

function hasSetter(obj: any, key: string): boolean {
  let proto = obj;
  while (proto && proto !== Object.prototype) {
    const desc = Object.getOwnPropertyDescriptor(proto, key);
    if (desc) return typeof desc.set === 'function';
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}

function valuesEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (isEnumItem(a) && isEnumItem(b)) return a.EnumType === b.EnumType && a.Value === b.Value;
  const ta = robloxTypeOf(a), tb = robloxTypeOf(b);
  if (ta !== tb) return false;
  if (DATATYPE_NAMES.has(a.constructor) && typeof a.toString === 'function') {
    return a.toString() === b.toString();
  }
  return false;
}
