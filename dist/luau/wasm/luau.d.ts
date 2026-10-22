// The WASM module is an Emscripten MODULARIZE/EXPORT_ES6 factory. Typed loosely;
// LuauVM.ts wraps it behind a strict interface.
declare const createLuauModule: (overrides?: Record<string, unknown>) => Promise<any>;
export default createLuauModule;
