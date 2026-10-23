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
};
export var LuaType;
(function (LuaType) {
    LuaType[LuaType["Nil"] = 0] = "Nil";
    LuaType[LuaType["Boolean"] = 1] = "Boolean";
    LuaType[LuaType["LightUserdata"] = 2] = "LightUserdata";
    LuaType[LuaType["Number"] = 3] = "Number";
    LuaType[LuaType["Vector"] = 4] = "Vector";
    LuaType[LuaType["String"] = 5] = "String";
    LuaType[LuaType["Table"] = 6] = "Table";
    LuaType[LuaType["Function"] = 7] = "Function";
    LuaType[LuaType["Userdata"] = 8] = "Userdata";
    LuaType[LuaType["Thread"] = 9] = "Thread";
    LuaType[LuaType["Buffer"] = 10] = "Buffer";
})(LuaType || (LuaType = {}));
export var CoStatus;
(function (CoStatus) {
    CoStatus[CoStatus["Running"] = 0] = "Running";
    CoStatus[CoStatus["Suspended"] = 1] = "Suspended";
    CoStatus[CoStatus["Normal"] = 2] = "Normal";
    CoStatus[CoStatus["Finished"] = 3] = "Finished";
    CoStatus[CoStatus["Error"] = 4] = "Error";
})(CoStatus || (CoStatus = {}));
/** Thrown by a host function to raise a Lua error; `message` becomes the error value. */
export class LuauHostError extends Error {
}
const YIELD = Symbol('luau-yield');
let modulePromise = null;
/** Loads (once) and returns the initialized WASM module. */
export async function loadLuauModule() {
    if (!modulePromise) {
        modulePromise = createLuauModule();
    }
    return modulePromise;
}
// Userdata tag namespace. The runtime layer picks a tag per bridged class
// family; tag 0 is reserved for "plain reference".
export const REF_TAG = 1;
export class LuauVM {
    M;
    L;
    isMain;
    // Host function registry. Index is the id baked into the dispatch closure.
    hostFns = [];
    // Reference userdata: handle -> JS object, and the reverse for identity reuse.
    refs = new Map();
    refHandles = new WeakMap();
    nextRefHandle = 1;
    pendingYield = 0;
    interruptDeadline = Infinity;
    threadRegistry = new Map();
    // Cached VM constants and a reusable 8-byte scratch buffer (avoids malloc on
    // hot paths like toString/namecallName).
    typeCodes;
    gidx;
    ridx;
    okCode;
    scratch;
    constructor(M, L, isMain) {
        this.M = M;
        this.L = L;
        this.isMain = isMain;
    }
    /** Creates a fresh VM with the standard libraries opened. */
    static async create() {
        const M = await loadLuauModule();
        const L = M._rd_newstate();
        const vm = new LuauVM(M, L, true);
        vm.cacheConstants();
        vm.installHostBridge();
        M._rd_registerrefdtor(L, REF_TAG);
        return vm;
    }
    cacheConstants() {
        const k = (id) => this.M._rd_const(id);
        this.gidx = k(C.GLOBALSINDEX);
        this.ridx = k(C.REGISTRYINDEX);
        this.okCode = k(C.OK);
        this.scratch = this.M._malloc(8);
        this.typeCodes = {
            [k(C.TNIL)]: LuaType.Nil,
            [k(C.TBOOLEAN)]: LuaType.Boolean,
            [k(C.TLIGHTUSERDATA)]: LuaType.LightUserdata,
            [k(C.TNUMBER)]: LuaType.Number,
            [k(C.TVECTOR)]: LuaType.Vector,
            [k(C.TSTRING)]: LuaType.String,
            [k(C.TTABLE)]: LuaType.Table,
            [k(C.TFUNCTION)]: LuaType.Function,
            [k(C.TUSERDATA)]: LuaType.Userdata,
            [k(C.TTHREAD)]: LuaType.Thread,
            [k(C.TBUFFER)]: LuaType.Buffer,
        };
    }
    installHostBridge() {
        // The native glue calls into these. Routed through the main VM instance;
        // child threads share the same registry via threadRegistry lookup.
        this.M.rdHost = {
            call: (L, id) => {
                const vm = this.vmForState(L);
                const fn = this.hostFns[id];
                if (!fn) {
                    vm.pushString(`host function ${id} is not registered`);
                    return -2;
                }
                try {
                    return fn(vm);
                }
                catch (err) {
                    if (err === YIELD)
                        return -3 - vm.pendingYield;
                    const msg = err instanceof Error ? err.message : String(err);
                    vm.pushString(msg);
                    return -2;
                }
            },
            refGc: (_tag, handle) => {
                const obj = this.refs.get(handle);
                if (obj) {
                    this.refs.delete(handle);
                    if (typeof obj === 'object' && obj !== null)
                        this.refHandles.delete(obj);
                }
            },
            interrupt: (_L) => {
                if (Date.now() > this.interruptDeadline) {
                    this.pushString('script exceeded execution budget');
                    return 1;
                }
                return 0;
            },
            userthread: (_parent, _L) => {
                // Threads are tracked explicitly when created via newThread().
            },
        };
    }
    // A host callback receives a raw lua_State*; map it back to the owning VM.
    vmForState(L) {
        if (L === this.L)
            return this;
        const existing = this.threadRegistry.get(L);
        if (existing)
            return existing;
        const child = new LuauVM(this.M, L, false);
        child.shareRegistriesWith(this);
        this.threadRegistry.set(L, child);
        return child;
    }
    shareRegistriesWith(main) {
        this.hostFns = main.hostFns;
        this.refs = main.refs;
        this.refHandles = main.refHandles;
        this.threadRegistry = main.threadRegistry;
        // Cached VM constants are per global-state, so all threads share them.
        this.typeCodes = main.typeCodes;
        this.gidx = main.gidx;
        this.ridx = main.ridx;
        this.okCode = main.okCode;
        this.scratch = main.scratch;
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
    withCString(str, fn) {
        const len = this.M.lengthBytesUTF8(str);
        const ptr = this.M._malloc(len + 1);
        try {
            this.M.stringToUTF8(str, ptr, len + 1);
            return fn(ptr, len);
        }
        finally {
            this.M._free(ptr);
        }
    }
    // ---- stack basics ------------------------------------------------------
    getTop() { return this.M._lua_gettop(this.L); }
    setTop(idx) { this.M._lua_settop(this.L, idx); }
    pop(n) { this.M._lua_settop(this.L, -n - 1); }
    pushValue(idx) { this.M._lua_pushvalue(this.L, idx); }
    remove(idx) { this.M._lua_remove(this.L, idx); }
    insert(idx) { this.M._lua_insert(this.L, idx); }
    type(idx) { return this.mapType(this.M._lua_type(this.L, idx)); }
    // ---- push --------------------------------------------------------------
    pushNil() { this.M._lua_pushnil(this.L); }
    pushBoolean(b) { this.M._lua_pushboolean(this.L, b ? 1 : 0); }
    pushNumber(n) { this.M._lua_pushnumber(this.L, n); }
    pushVector(x, y, z) { this.M._rd_pushvector(this.L, x, y, z); }
    pushString(s) {
        this.withCString(s, (ptr, len) => this.M._lua_pushlstring(this.L, ptr, len));
    }
    pushJSFunction(fn, name = 'host') {
        const id = this.hostFns.length;
        this.hostFns.push(fn);
        this.withCString(name, (ptr) => this.M._rd_pushjsfunction(this.L, id, ptr));
    }
    /** Pushes reference userdata that the host can later resolve back to `obj`. */
    pushRef(obj, tag = REF_TAG) {
        let handle = typeof obj === 'object' && obj !== null ? this.refHandles.get(obj) : undefined;
        if (handle === undefined) {
            handle = this.nextRefHandle++;
            this.refs.set(handle, obj);
            if (typeof obj === 'object' && obj !== null)
                this.refHandles.set(obj, handle);
        }
        this.M._rd_newref(this.L, tag, handle);
    }
    // ---- read --------------------------------------------------------------
    toBoolean(idx) { return this.M._lua_toboolean(this.L, idx) !== 0; }
    toNumber(idx) { return this.M._rd_tonumber(this.L, idx); }
    toString(idx) {
        const lenPtr = this.M._malloc(4);
        try {
            const ptr = this.M._rd_tolstring(this.L, idx, lenPtr);
            if (ptr === 0)
                return '';
            const len = this.M.HEAP32[lenPtr >> 2];
            return this.M.UTF8ToString(ptr, len);
        }
        finally {
            this.M._free(lenPtr);
        }
    }
    toVector(idx) {
        const ptr = this.M._lua_tovector(this.L, idx);
        if (ptr === 0)
            return null;
        const base = ptr >> 2;
        return [this.M.HEAPF32[base], this.M.HEAPF32[base + 1], this.M.HEAPF32[base + 2]];
    }
    /** Resolves reference userdata at `idx` back to its JS object, or undefined. */
    toRef(idx, tag = REF_TAG) {
        const ptr = this.M._lua_touserdatatagged(this.L, idx, tag);
        if (ptr === 0)
            return undefined;
        const handle = this.M.HEAP32[(ptr >> 2) + 1];
        return this.refs.get(handle);
    }
    // ---- tables & globals --------------------------------------------------
    newTable() { this.M._lua_createtable(this.L, 0, 0); }
    setReadonly(idx, enabled) { this.M._lua_setreadonly(this.L, idx, enabled ? 1 : 0); }
    getReadonly(idx) { return this.M._lua_getreadonly(this.L, idx) !== 0; }
    rawSetI(idx, n) { this.M._lua_rawseti(this.L, idx, n); }
    rawGetI(idx, n) { return this.mapType(this.M._lua_rawgeti(this.L, idx, n)); }
    getMetatable(idx) { return this.M._lua_getmetatable(this.L, idx) !== 0; }
    setMetatable(idx) { this.M._lua_setmetatable(this.L, idx); }
    next(idx) { return this.M._lua_next(this.L, idx) !== 0; }
    getField(idx, key) {
        return this.withCString(key, (ptr) => this.mapType(this.M._lua_getfield(this.L, idx, ptr)));
    }
    setField(idx, key) {
        this.withCString(key, (ptr) => this.M._lua_setfield(this.L, idx, ptr));
    }
    getGlobal(key) { return this.getField(this.globalsIndex, key); }
    setGlobal(key) { this.setField(this.globalsIndex, key); }
    get globalsIndex() { return this.gidx; }
    get registryIndex() { return this.ridx; }
    get multret() { return this.M._rd_const(C.MULTRET); }
    mapType(t) {
        return this.typeCodes[t] ?? LuaType.Nil;
    }
    // ---- references & namecall --------------------------------------------
    /** Creates a registry reference to the value at idx (does not pop). */
    ref(idx) { return this.M._lua_ref(this.L, idx); }
    unref(r) { this.M._lua_unref(this.L, r); }
    /** Pushes the referenced value; returns its type. */
    getRef(r) { return this.rawGetI(this.registryIndex, r); }
    /** Method name during a __namecall metamethod, or '' outside one. */
    namecallName() {
        const ptr = this.M._lua_namecallatom(this.L, this.scratch);
        return ptr === 0 ? '' : this.M.UTF8ToString(ptr);
    }
    concat(n) { this.M._lua_concat(this.L, n); }
    // ---- threads / coroutines ---------------------------------------------
    /** Registry ref that keeps this thread alive; set for thread VMs. */
    threadRef = 0;
    /** Creates a new coroutine thread (kept alive via a registry ref). */
    newThread() {
        const threadL = this.M._lua_newthread(this.L);
        const ref = this.ref(-1);
        this.pop(1);
        const child = this.vmForState(threadL);
        child.threadRef = ref;
        return child;
    }
    /** Resumes this thread. Returns the raw lua_Status code. */
    resume(from, nargs) {
        return this.M._lua_resume(this.L, from ? from.L : 0, nargs);
    }
    /** Coroutine status of this thread as observed from `from`. */
    coStatus(from) {
        const s = this.M._lua_costatus(from.L, this.L);
        const k = (id) => this.M._rd_const(id);
        if (s === k(40))
            return CoStatus.Running;
        if (s === k(41))
            return CoStatus.Suspended;
        if (s === k(42))
            return CoStatus.Normal;
        if (s === k(43))
            return CoStatus.Finished;
        return CoStatus.Error;
    }
    /** Moves the top `n` values from this stack onto `target`'s stack. */
    xmoveTo(target, n) {
        this.M._lua_xmove(this.L, target.L, n);
    }
    /** Pushes a thread VM's thread value onto this stack. */
    pushThread(thread) {
        if (thread.threadRef)
            this.getRef(thread.threadRef);
        else
            this.pushNil();
    }
    isStatusOk(code) { return code === this.okCode; }
    isStatusYield(code) { return code === this.M._rd_const(C.YIELD); }
    /** Releases a thread VM's keep-alive ref so it can be collected. */
    releaseThread(thread) {
        if (thread.threadRef) {
            this.unref(thread.threadRef);
            thread.threadRef = 0;
            this.threadRegistry.delete(thread.L);
        }
    }
    // ---- yielding & interrupts --------------------------------------------
    /** Call from inside a host function, then `return vm.yield()`. */
    prepareYield(nresults) {
        this.pendingYield = nresults;
        throw YIELD;
    }
    setExecutionBudget(ms) {
        this.interruptDeadline = ms > 0 ? Date.now() + ms : Infinity;
        this.M._rd_resetinterrupt();
    }
    clearExecutionBudget() { this.interruptDeadline = Infinity; }
    // ---- load & call -------------------------------------------------------
    /**
     * Compiles and loads Luau source. On success pushes the chunk function and
     * returns null; on failure returns the error message (nothing left on stack).
     */
    load(source, chunkName = 'chunk') {
        return this.withCString(source, (srcPtr, srcLen) => this.withCString(chunkName, (namePtr) => {
            const status = this.M._rd_load(this.L, namePtr, srcPtr, srcLen, 1, 1, 0);
            if (status !== this.M._rd_const(C.OK)) {
                const err = this.toString(-1);
                this.pop(1);
                return err || 'load error';
            }
            return null;
        }));
    }
    /** Protected call. Returns null on success, or the error message. */
    pcall(nargs, nresults) {
        const status = this.M._lua_pcall(this.L, nargs, nresults, 0);
        if (status !== this.M._rd_const(C.OK)) {
            const err = this.toString(-1);
            this.pop(1);
            return err || 'runtime error';
        }
        return null;
    }
    close() {
        if (this.isMain)
            this.M._lua_close(this.L);
    }
}
