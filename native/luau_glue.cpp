// Native glue between the official Luau VM and the TypeScript runtime.
//
// Every Lua-visible host function is a single C trampoline (`dispatch`) whose
// first upvalue is a numeric id into the JS function registry. Reference
// userdata (Instances, signals, connections, ...) store {tag, handle} and notify
// JS when collected so the host can drop its handle table entry.

#include "lua.h"
#include "lualib.h"
#include "luacode.h"

#include <emscripten.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

extern "C"
{
    // Implemented in luau_glue.js (emscripten --js-library)
    extern int rd_js_call(lua_State* L, int id);
    extern void rd_js_ref_gc(int tag, int handle);
    extern int rd_js_interrupt(lua_State* L);
    extern void rd_js_userthread(lua_State* parent, lua_State* L);
}

static const int RD_CALL_ERROR = -2;
static const int RD_INTERRUPT_STRIDE = 1024;
static int interruptCounter = 0;

static int dispatch(lua_State* L)
{
    int id = (int)lua_tonumber(L, lua_upvalueindex(1));
    int r = rd_js_call(L, id);
    if (r == RD_CALL_ERROR)
        lua_error(L); // error value is on top of the stack
    if (r <= -3)
        return lua_yield(L, -(r + 3)); // -3 - n encodes "yield with n results"
    return r;
}

static void refDestructor(lua_State* L, void* ud)
{
    int32_t* data = (int32_t*)ud;
    rd_js_ref_gc(data[0], data[1]);
}

static void interruptHook(lua_State* L, int gc)
{
    if (gc >= 0)
        return;
    if (++interruptCounter < RD_INTERRUPT_STRIDE)
        return;
    interruptCounter = 0;
    if (rd_js_interrupt(L))
        lua_error(L); // JS pushed the timeout message
}

static void userthreadHook(lua_State* parent, lua_State* L)
{
    rd_js_userthread(parent, L);
}

extern "C"
{
    EMSCRIPTEN_KEEPALIVE lua_State* rd_newstate()
    {
        lua_State* L = luaL_newstate();
        luaL_openlibs(L);
        lua_Callbacks* cb = lua_callbacks(L);
        cb->interrupt = interruptHook;
        cb->userthread = userthreadHook;
        return L;
    }

    EMSCRIPTEN_KEEPALIVE void rd_pushjsfunction(lua_State* L, int id, const char* debugname)
    {
        lua_pushnumber(L, id);
        lua_pushcclosurek(L, dispatch, debugname, 1, NULL);
    }

    // Returns the JS function id behind a host closure, or -1 for anything else.
    EMSCRIPTEN_KEEPALIVE int rd_getjsfunctionid(lua_State* L, int idx)
    {
        if (lua_tocfunction(L, idx) != dispatch)
            return -1;
        if (!lua_getupvalue(L, idx, 1))
            return -1;
        int id = (int)lua_tonumber(L, -1);
        lua_pop(L, 1);
        return id;
    }

    EMSCRIPTEN_KEEPALIVE void rd_registerrefdtor(lua_State* L, int tag)
    {
        lua_setuserdatadtor(L, tag, refDestructor);
    }

    EMSCRIPTEN_KEEPALIVE void rd_newref(lua_State* L, int tag, int handle)
    {
        int32_t* data = (int32_t*)lua_newuserdatatagged(L, sizeof(int32_t) * 2, tag);
        data[0] = tag;
        data[1] = handle;
    }

    // Compiles and loads a chunk. On success pushes the function and returns 0;
    // on failure pushes the error message and returns non-zero.
    EMSCRIPTEN_KEEPALIVE int rd_load(lua_State* L, const char* chunkname, const char* source, size_t size, int optimizationLevel, int debugLevel, int coverageLevel)
    {
        lua_CompileOptions options = {};
        options.optimizationLevel = optimizationLevel;
        options.debugLevel = debugLevel;
        options.coverageLevel = coverageLevel;
        options.vectorLib = "Vector3";
        options.vectorCtor = "new";
        options.vectorType = "Vector3";

        size_t bytecodeSize = 0;
        char* bytecode = luau_compile(source, size, &options, &bytecodeSize);
        int status = luau_load(L, chunkname, bytecode, bytecodeSize, 0);
        free(bytecode);
        return status;
    }

    // Loads precompiled bytecode (used by loadstring-from-bytecode and getscriptbytecode round trips).
    EMSCRIPTEN_KEEPALIVE int rd_loadbytecode(lua_State* L, const char* chunkname, const char* bytecode, size_t size)
    {
        return luau_load(L, chunkname, bytecode, size, 0);
    }

    // Compiles source to bytecode; caller frees the returned buffer with free().
    EMSCRIPTEN_KEEPALIVE char* rd_compile(const char* source, size_t size, size_t* outSize)
    {
        lua_CompileOptions options = {};
        options.optimizationLevel = 1;
        options.debugLevel = 1;
        options.vectorLib = "Vector3";
        options.vectorCtor = "new";
        options.vectorType = "Vector3";
        return luau_compile(source, size, &options, outSize);
    }

    EMSCRIPTEN_KEEPALIVE double rd_tonumber(lua_State* L, int idx)
    {
        return lua_tonumberx(L, idx, NULL);
    }

    EMSCRIPTEN_KEEPALIVE const char* rd_tolstring(lua_State* L, int idx, size_t* len)
    {
        return lua_tolstring(L, idx, len);
    }

    EMSCRIPTEN_KEEPALIVE void rd_pushvector(lua_State* L, float x, float y, float z)
    {
        lua_pushvector(L, x, y, z);
    }

    EMSCRIPTEN_KEEPALIVE int rd_getinfo(lua_State* L, int level, const char* what, lua_Debug* ar)
    {
        return lua_getinfo(L, level, what, ar);
    }

    EMSCRIPTEN_KEEPALIVE int rd_sizeof_debug()
    {
        return sizeof(lua_Debug);
    }

    // Offsets into lua_Debug so the JS side can read fields without hardcoding layout.
    EMSCRIPTEN_KEEPALIVE int rd_debug_offset(int field)
    {
        switch (field)
        {
        case 0:
            return offsetof(lua_Debug, name);
        case 1:
            return offsetof(lua_Debug, what);
        case 2:
            return offsetof(lua_Debug, source);
        case 3:
            return offsetof(lua_Debug, short_src);
        case 4:
            return offsetof(lua_Debug, linedefined);
        case 5:
            return offsetof(lua_Debug, currentline);
        case 6:
            return offsetof(lua_Debug, nupvals);
        case 7:
            return offsetof(lua_Debug, nparams);
        case 8:
            return offsetof(lua_Debug, isvararg);
        default:
            return -1;
        }
    }

    EMSCRIPTEN_KEEPALIVE void rd_resetinterrupt()
    {
        interruptCounter = 0;
    }
}
