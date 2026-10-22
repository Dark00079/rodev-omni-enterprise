// Emscripten JS library: forwards native callbacks to the host hooks installed
// on Module by src/luau/LuauVM.ts.
addToLibrary({
  rd_js_call: (L, id) => Module.rdHost.call(L, id),
  rd_js_ref_gc: (tag, handle) => Module.rdHost.refGc(tag, handle),
  rd_js_interrupt: (L) => Module.rdHost.interrupt(L),
  rd_js_userthread: (parent, L) => Module.rdHost.userthread(parent, L),
});
