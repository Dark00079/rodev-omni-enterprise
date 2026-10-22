/**
 * TypeScript binding over the Luau VM compiled to WebAssembly (src/luau/wasm).
 *
 * This is interpreter-embedding glue: it loads the WASM module once, owns a
 * lua_State, and exposes the Lua C API as typed methods plus a host-function
 * bridge. It knows nothing about Roblox; the DataModel/runtime layer builds on
 * top of it.
 */

import createLuauModule from './wasm/luau.mjs';

// Ids must match the rd_const switch in native/luau_glue.cpp.
const C = {
  MULTRET: 0,
  REGISTRYINDEX: 1,
  ENVIRONINDEX: 2,
  GLOBALSINDEX: 3,
  TNIL: 10, TBOOLEAN: 11, TLIGHTUSERDATA: 12, TNUMBER: 13, TVECTOR: 14,
  TSTRING: 15, TTABLE: 16, TFUNCTION: 17, TUSERDATA: 18, TTHREAD: 19, TBUFFER: 20,
  OK: 30, YIELD: 31, ERRRUN: 32, ERRSYNTAX: 33, ERRMEM: 34, ERRERR: 35, BREAK: 36,
  CORUN: 40, COSUS: 41, CONOR: 42, COFIN: 43, COERR: 44,
} as const;

export enum LuaType {
  Nil, Boolean, LightUserdata, Number, Vector, String, Table, Function, Userdata, Thread, Buffer,
}

export enum CoStatus { Running, Suspended, Normal, Finished, Error }

/** A host function operates on the VM stack and returns the number of results. */
export type HostFunction = (vm: LuauVM) => number;

/** Thrown by a host function to raise a Lua error; `message` becomes the error value. */
export class LuauHostError extends Error {}

const YIELD = Symbol('luau-yield');

interface LuauWasmModule {
  _malloc(n: number): number;
  _free(p: number): void;
  HEAP8: Int8Array;
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  UTF8ToString(ptr: number, maxBytes?: number): string;
  stringToUTF8(str: string, outPtr: number, maxBytes: number): number;
  lengthBytesUTF8(str: string): number;
  rdHost?: unknown;
  [key: string]: any;
}

let modulePromise: Promise<LuauWasmModule> | null = null;

/** Loads (once) and returns the initialized WASM module. */
export async function loadLuauModule(): Promise<LuauWasmModule> {
  if (!modulePromise) {
    modulePromise = createLuauModule() as Promise<LuauWasmModule>;
  }
  return modulePromise;
}

// Userdata tag namespace. The runtime layer picks a tag per bridged class
// family; tag 0 is reserved for "plain reference".
export const REF_TAG = 1;

export class LuauVM {
  public readonly M: LuauWasmModule;
  public readonly L: number;
  private readonly isMain: boolean;

  // Host function registry. Index is the id baked into the dispatch closure.
  private readonly hostFns: HostFunction[] = [];
  // Reference userdata: handle -> JS object, and the reverse for identity reuse.
  private readonly refs = new Map<number, any>();
  private readonly refHandles = new WeakMap<object, number>();
  private nextRefHandle = 1;
  private pendingYield = 0;
  private interruptDeadline = Infinity;
  private threadRegistry = new Map<number, LuauVM>();

  private constructor(M: LuauWasmModule, L: number, isMain: boolean) {
    this.M = M;
    this.L = L;
    this.isMain = isMain;
  }

  /** Creates a fresh VM with the standard libraries opened. */
  static async create(): Promise<LuauVM> {
    const M = await loadLuauModule();
    const L = M._rd_newstate();
    const vm = new LuauVM(M, L, true);
    vm.installHostBridge();
    M._rd_registerrefdtor(L, REF_TAG);
    return vm;
  }

  private installHostBridge(): void {
    // The native glue calls into these. Routed through the main VM instance;
    // child threads share the same registry via threadRegistry lookup.
    this.M.rdHost = {
      call: (L: number, id: number): number => {
        const vm = this.vmForState(L);
        const fn = this.hostFns[id];
        if (!fn) {
          vm.pushString(`host function ${id} is not registered`);
          return -2;
        }
        try {
          return fn(vm);
        } catch (err: any) {
          if (err === YIELD) return -3 - vm.pendingYield;
          const msg = err instanceof Error ? err.message : String(err);
          vm.pushString(msg);
          return -2;
        }
      },
      refGc: (_tag: number, handle: number): void => {
        const obj = this.refs.get(handle);
        if (obj) {
          this.refs.delete(handle);
          if (typeof obj === 'object' && obj !== null) this.refHandles.delete(obj);
        }
      },
      interrupt: (_L: number): number => {
        if (Date.now() > this.interruptDeadline) {
          this.pushString('script exceeded execution budget');
          return 1;
        }
        return 0;
      },
      userthread: (_parent: number, _L: number): void => {
        // Threads are tracked explicitly when created via newThread().
      },
    };
  }

  // A host callback receives a raw lua_State*; map it back to the owning VM.
  private vmForState(L: number): LuauVM {
    if (L === this.L) return this;
    const existing = this.threadRegistry.get(L);
    if (existing) return existing;
    const child = new LuauVM(this.M, L, false);
    child.shareRegistriesWith(this);
    this.threadRegistry.set(L, child);
    return child;
  }

  private shareRegistriesWith(main: LuauVM): void {
    (this as any).hostFns = main.hostFns;
    (this as any).refs = main.refs;
    (this as any).refHandles = main.refHandles;
    (this as any).threadRegistry = main.threadRegistry;
    Object.defineProperty(this, 'nextRefHandle', {
      get: () => main.nextRefHandle,
      set: (v) => { main.nextRefHandle = v; },
    });
    Object.defineProperty(this, 'interruptDeadline', {
      get: () => main.interruptDeadline,
      set: (v) => { main.interruptDeadline = v; },
    });
  }

  // ---- memory helpers ----------------------------------------------------

  private withCString<T>(str: string, fn: (ptr: number, len: number) => T): T {
    const len = this.M.lengthBytesUTF8(str);
    const ptr = this.M._malloc(len + 1);
    try {
      this.M.stringToUTF8(str, ptr, len + 1);
      return fn(ptr, len);
    } finally {
      this.M._free(ptr);
    }
  }

  // ---- stack basics ------------------------------------------------------

  getTop(): number { return this.M._lua_gettop(this.L); }
  setTop(idx: number): void { this.M._lua_settop(this.L, idx); }
  pop(n: number): void { this.M._lua_settop(this.L, -n - 1); }
  pushValue(idx: number): void { this.M._lua_pushvalue(this.L, idx); }
  remove(idx: number): void { this.M._lua_remove(this.L, idx); }
  insert(idx: number): void { this.M._lua_insert(this.L, idx); }
  type(idx: number): LuaType { return this.mapType(this.M._lua_type(this.L, idx)); }

  // ---- push --------------------------------------------------------------

  pushNil(): void { this.M._lua_pushnil(this.L); }
  pushBoolean(b: boolean): void { this.M._lua_pushboolean(this.L, b ? 1 : 0); }
  pushNumber(n: number): void { this.M._lua_pushnumber(this.L, n); }
  pushVector(x: number, y: number, z: number): void { this.M._rd_pushvector(this.L, x, y, z); }

  pushString(s: string): void {
    this.withCString(s, (ptr, len) => this.M._lua_pushlstring(this.L, ptr, len));
  }

  pushJSFunction(fn: HostFunction, name = 'host'): void {
    const id = this.hostFns.length;
    this.hostFns.push(fn);
    this.withCString(name, (ptr) => this.M._rd_pushjsfunction(this.L, id, ptr));
  }

  /** Pushes reference userdata that the host can later resolve back to `obj`. */
  pushRef(obj: any, tag = REF_TAG): void {
    let handle = typeof obj === 'object' && obj !== null ? this.refHandles.get(obj) : undefined;
    if (handle === undefined) {
      handle = this.nextRefHandle++;
      this.refs.set(handle, obj);
      if (typeof obj === 'object' && obj !== null) this.refHandles.set(obj, handle);
    }
    this.M._rd_newref(this.L, tag, handle);
  }

  // ---- read --------------------------------------------------------------

  toBoolean(idx: number): boolean { return this.M._lua_toboolean(this.L, idx) !== 0; }
  toNumber(idx: number): number { return this.M._rd_tonumber(this.L, idx); }

  toString(idx: number): string {
    const lenPtr = this.M._malloc(4);
    try {
      const ptr = this.M._rd_tolstring(this.L, idx, lenPtr);
      if (ptr === 0) return '';
      const len = this.M.HEAP32[lenPtr >> 2];
      return this.M.UTF8ToString(ptr, len);
    } finally {
      this.M._free(lenPtr);
    }
  }

  toVector(idx: number): [number, number, number] | null {
    const ptr = this.M._lua_tovector(this.L, idx);
    if (ptr === 0) return null;
    const base = ptr >> 2;
    return [this.M.HEAPF32[base], this.M.HEAPF32[base + 1], this.M.HEAPF32[base + 2]];
  }

  /** Resolves reference userdata at `idx` back to its JS object, or undefined. */
  toRef(idx: number, tag = REF_TAG): any {
    const ptr = this.M._lua_touserdatatagged(this.L, idx, tag);
    if (ptr === 0) return undefined;
    const handle = this.M.HEAP32[(ptr >> 2) + 1];
    return this.refs.get(handle);
  }

  // ---- tables & globals --------------------------------------------------

  newTable(): void { this.M._lua_createtable(this.L, 0, 0); }
  setReadonly(idx: number, enabled: boolean): void { this.M._lua_setreadonly(this.L, idx, enabled ? 1 : 0); }
  getReadonly(idx: number): boolean { return this.M._lua_getreadonly(this.L, idx) !== 0; }
  rawSetI(idx: number, n: number): void { this.M._lua_rawseti(this.L, idx, n); }
  rawGetI(idx: number, n: number): LuaType { return this.mapType(this.M._lua_rawgeti(this.L, idx, n)); }
  getMetatable(idx: number): boolean { return this.M._lua_getmetatable(this.L, idx) !== 0; }
  setMetatable(idx: number): void { this.M._lua_setmetatable(this.L, idx); }
  next(idx: number): boolean { return this.M._lua_next(this.L, idx) !== 0; }

  getField(idx: number, key: string): LuaType {
    return this.withCString(key, (ptr) => this.mapType(this.M._lua_getfield(this.L, idx, ptr)));
  }
  setField(idx: number, key: string): void {
    this.withCString(key, (ptr) => this.M._lua_setfield(this.L, idx, ptr));
  }

  getGlobal(key: string): LuaType { return this.getField(this.globalsIndex, key); }
  setGlobal(key: string): void { this.setField(this.globalsIndex, key); }

  get globalsIndex(): number { return this.M._rd_const(C.GLOBALSINDEX); }
  get registryIndex(): number { return this.M._rd_const(C.REGISTRYINDEX); }
  get multret(): number { return this.M._rd_const(C.MULTRET); }

  private mapType(t: number): LuaType {
    if (t === this.M._rd_const(C.TNIL)) return LuaType.Nil;
    if (t === this.M._rd_const(C.TBOOLEAN)) return LuaType.Boolean;
    if (t === this.M._rd_const(C.TLIGHTUSERDATA)) return LuaType.LightUserdata;
    if (t === this.M._rd_const(C.TNUMBER)) return LuaType.Number;
    if (t === this.M._rd_const(C.TVECTOR)) return LuaType.Vector;
    if (t === this.M._rd_const(C.TSTRING)) return LuaType.String;
    if (t === this.M._rd_const(C.TTABLE)) return LuaType.Table;
    if (t === this.M._rd_const(C.TFUNCTION)) return LuaType.Function;
    if (t === this.M._rd_const(C.TUSERDATA)) return LuaType.Userdata;
    if (t === this.M._rd_const(C.TTHREAD)) return LuaType.Thread;
    if (t === this.M._rd_const(C.TBUFFER)) return LuaType.Buffer;
    return LuaType.Nil;
  }

  // ---- yielding & interrupts --------------------------------------------

  /** Call from inside a host function, then `return vm.yield()`. */
  prepareYield(nresults: number): never {
    this.pendingYield = nresults;
    throw YIELD;
  }

  setExecutionBudget(ms: number): void {
    this.interruptDeadline = ms > 0 ? Date.now() + ms : Infinity;
    this.M._rd_resetinterrupt();
  }
  clearExecutionBudget(): void { this.interruptDeadline = Infinity; }

  // ---- load & call -------------------------------------------------------

  /**
   * Compiles and loads Luau source. On success pushes the chunk function and
   * returns null; on failure returns the error message (nothing left on stack).
   */
  load(source: string, chunkName = 'chunk'): string | null {
    return this.withCString(source, (srcPtr, srcLen) =>
      this.withCString(chunkName, (namePtr) => {
        const status = this.M._rd_load(this.L, namePtr, srcPtr, srcLen, 1, 1, 0);
        if (status !== this.M._rd_const(C.OK)) {
          const err = this.toString(-1);
          this.pop(1);
          return err || 'load error';
        }
        return null;
      }),
    );
  }

  /** Protected call. Returns null on success, or the error message. */
  pcall(nargs: number, nresults: number): string | null {
    const status = this.M._lua_pcall(this.L, nargs, nresults, 0);
    if (status !== this.M._rd_const(C.OK)) {
      const err = this.toString(-1);
      this.pop(1);
      return err || 'runtime error';
    }
    return null;
  }

  close(): void {
    if (this.isMain) this.M._lua_close(this.L);
  }
}
