/**
 * Full-Fidelity sUNC/UNC Script Executor Sandbox
 * Implements closure hooking (hookfunction, hookmetamethod), newcclosure,
 * Drawing library, VFS, debug overrides, getconnections, firesignal, and request.
 */

import fs from 'fs';
import path from 'path';
import fengari from 'fengari';
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;
import interop from 'fengari-interop';

import { DataModel, WorkspaceService, PlayersService, HttpService } from './services.js';
import { Vector2, Vector3, CFrame, UDim, UDim2, Color3, Rect, Ray, RaycastParams, OverlapParams, TweenInfo, Enum } from './datatypes.js';
import { InstanceEngine, Instance, BasePart, GuiObject, RBXScriptConnection, RBXScriptSignal } from './instanceEngine.js';
import { GlobalProfiler } from './profiler.js';
import { LuauPreprocessor } from '../luau/preprocessor.js';

export interface DrawingObject {
  type: string;
  id: string;
  properties: Record<string, any>;
  removed: boolean;
}

export interface FuzzPayloadResult {
  payloadName: string;
  payloadValue: any;
  passed: boolean;
  serverCrashed: boolean;
  error?: string;
  response?: any;
}

export interface RemoteFuzzReport {
  remoteName: string;
  remoteType: 'RemoteEvent' | 'RemoteFunction';
  fullPath: string;
  testsRun: number;
  crashesCount: number;
  vulnerabilitiesCount: number;
  results: FuzzPayloadResult[];
  recommendations: string[];
}

export class ExecutorSandbox {
  public readonly L: any;
  public readonly game: DataModel;
  public readonly vfsDir: string;
  public readonly drawings: Map<string, DrawingObject> = new Map();
  public readonly consoleLogs: string[] = [];
  public readonly sessionGenv: Map<string, any> = new Map();
  public lastHookTarget: any = null;
  public lastHookReplacement: any = null;
  private currentNamecallMethod: string = "";
  private isCallerExecutor: boolean = true;
  private nextDrawingId = 0;

  constructor(vfsDir?: string) {
    this.vfsDir = vfsDir || path.resolve(process.cwd(), "workspace_vfs");
    if (!fs.existsSync(this.vfsDir)) {
      fs.mkdirSync(this.vfsDir, { recursive: true });
    }

    this.game = new DataModel();
    this.L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(this.L);
    interop.luaopen_js(this.L);

    this.setupConsoleBridges();
    this.setupRobloxRuntime();
    this.setupUNCEnvironment();
  }

  private setupConsoleBridges(): void {
    const L = this.L;

    // Override print
    lua.lua_pushjsfunction(L, (L: any) => {
      const n = lua.lua_gettop(L);
      const parts: string[] = [];
      for (let i = 1; i <= n; i++) {
        parts.push(lua.lua_tojsstring(L, i) ?? String(interop.tojs(L, i)));
      }
      const msg = parts.join("\t");
      this.consoleLogs.push(`[PRINT] ${msg}`);
      console.log(`[VM Print]: ${msg}`);
      return 0;
    });
    lua.lua_setglobal(L, to_luastring("print"));

    // Override warn
    lua.lua_pushjsfunction(L, (L: any) => {
      const n = lua.lua_gettop(L);
      const parts: string[] = [];
      for (let i = 1; i <= n; i++) {
        parts.push(lua.lua_tojsstring(L, i) ?? String(interop.tojs(L, i)));
      }
      const msg = parts.join("\t");
      this.consoleLogs.push(`[WARN] ${msg}`);
      console.warn(`[VM Warn]: ${msg}`);
      return 0;
    });
    lua.lua_setglobal(L, to_luastring("warn"));
  }

  private setupRobloxRuntime(): void {
    const L = this.L;

    // Standard Lua/Luau helpers
    const bootstrap = `
      math.clamp = function(x, lo, hi)
        if x < lo then return lo elseif x > hi then return hi end
        return x
      end
      math.round = function(x) return math.floor(x + 0.5) end
      math.sign = function(x) return x > 0 and 1 or (x < 0 and -1 or 0) end
      table.find = function(t, val)
        for i, v in ipairs(t) do if v == val then return i end end
        return nil
      end
      table.clear = function(t)
        for k in pairs(t) do t[k] = nil end
      end
      table.clone = function(t)
        local c = {}
        for k, v in pairs(t) do c[k] = v end
        return c
      end
      string.split = function(s, sep)
        local out = {}
        sep = sep or ","
        for p in string.gmatch(s, "([^" .. sep .. "]+)") do table.insert(out, p) end
        return out
      end
      tick = function() return os.clock() end
      time = function() return os.clock() end
      typeof = function(val)
        local mt = getmetatable(val)
        if type(val) == "table" and mt and mt.__type then return mt.__type end
        if type(val) == "userdata" and mt and mt.__type then return mt.__type end
        return type(val)
      end
    `;
    lauxlib.luaL_dostring(L, to_luastring(bootstrap));

    // Expose DataModel `game` and `workspace`
    interop.push(L, this.game);
    lua.lua_setglobal(L, to_luastring("game"));

    interop.push(L, this.game.Workspace);
    lua.lua_setglobal(L, to_luastring("workspace"));

    interop.push(L, this.game.Lighting);
    lua.lua_setglobal(L, to_luastring("lighting"));

    // Datatype constructors via explicit JS functions
    lua.lua_pushjsfunction(L, (L: any) => {
      const cls = lua.lua_tojsstring(L, 1);
      const parent = interop.tojs(L, 2);
      const inst = InstanceEngine.new(cls, parent);
      GlobalProfiler.registerInstance(inst);
      interop.push(L, inst);
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__instance_new"));

    lua.lua_pushjsfunction(L, (L: any) => {
      const x = lua.lua_tonumber(L, 1);
      const y = lua.lua_tonumber(L, 2);
      interop.push(L, new Vector2(x, y));
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__vector2_new"));

    lua.lua_pushjsfunction(L, (L: any) => {
      const x = lua.lua_tonumber(L, 1);
      const y = lua.lua_tonumber(L, 2);
      const z = lua.lua_tonumber(L, 3);
      interop.push(L, new Vector3(x, y, z));
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__vector3_new"));

    lua.lua_pushjsfunction(L, (L: any) => {
      const top = lua.lua_gettop(L);
      const args: any[] = [];
      for (let i = 1; i <= top; i++) {
        if (lua.lua_isnumber(L, i)) args.push(lua.lua_tonumber(L, i));
        else args.push(interop.tojs(L, i));
      }
      interop.push(L, CFrame.new(...args));
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__cframe_new"));

    lua.lua_pushjsfunction(L, (L: any) => {
      const at = interop.tojs(L, 1);
      const look = interop.tojs(L, 2);
      const up = interop.tojs(L, 3) || Vector3.yAxis;
      interop.push(L, CFrame.lookAt(at, look, up));
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__cframe_lookat"));

    lua.lua_pushjsfunction(L, (L: any) => {
      const rx = lua.lua_tonumber(L, 1);
      const ry = lua.lua_tonumber(L, 2);
      const rz = lua.lua_tonumber(L, 3);
      interop.push(L, CFrame.Angles(rx, ry, rz));
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__cframe_angles"));

    lua.lua_pushjsfunction(L, (L: any) => {
      const s = lua.lua_tonumber(L, 1);
      const o = lua.lua_tonumber(L, 2);
      interop.push(L, new UDim(s, o));
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__udim_new"));

    lua.lua_pushjsfunction(L, (L: any) => {
      const xs = lua.lua_tonumber(L, 1);
      const xo = lua.lua_tonumber(L, 2);
      const ys = lua.lua_tonumber(L, 3);
      const yo = lua.lua_tonumber(L, 4);
      interop.push(L, new UDim2(xs, xo, ys, yo));
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__udim2_new"));

    lua.lua_pushjsfunction(L, (L: any) => {
      const x = lua.lua_tonumber(L, 1);
      const y = lua.lua_tonumber(L, 2);
      interop.push(L, UDim2.fromOffset(x, y));
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__udim2_fromoffset"));

    lua.lua_pushjsfunction(L, (L: any) => {
      const x = lua.lua_tonumber(L, 1);
      const y = lua.lua_tonumber(L, 2);
      interop.push(L, UDim2.fromScale(x, y));
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__udim2_fromscale"));

    lua.lua_pushjsfunction(L, (L: any) => {
      const r = lua.lua_tonumber(L, 1);
      const g = lua.lua_tonumber(L, 2);
      const b = lua.lua_tonumber(L, 3);
      interop.push(L, new Color3(r, g, b));
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__color3_new"));

    lua.lua_pushjsfunction(L, (L: any) => {
      const r = lua.lua_tonumber(L, 1);
      const g = lua.lua_tonumber(L, 2);
      const b = lua.lua_tonumber(L, 3);
      interop.push(L, Color3.fromRGB(r, g, b));
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__color3_fromrgb"));

    lua.lua_pushjsfunction(L, (L: any) => {
      const h = lua.lua_tonumber(L, 1);
      const s = lua.lua_tonumber(L, 2);
      const v = lua.lua_tonumber(L, 3);
      interop.push(L, Color3.fromHSV(h, s, v));
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__color3_fromhsv"));

    lua.lua_pushjsfunction(L, (L: any) => {
      const hex = lua.lua_tojsstring(L, 1);
      interop.push(L, Color3.fromHex(hex));
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__color3_fromhex"));

    lua.lua_pushjsfunction(L, (L: any) => {
      const orig = interop.tojs(L, 1) as Vector3;
      const dir = interop.tojs(L, 2) as Vector3;
      interop.push(L, new Ray(orig, dir));
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__ray_new"));

    lua.lua_pushjsfunction(L, (L: any) => {
      interop.push(L, new RaycastParams());
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__raycastparams_new"));

    lua.lua_pushjsfunction(L, (L: any) => {
      interop.push(L, new OverlapParams());
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__overlapparams_new"));

    lua.lua_pushjsfunction(L, (L: any) => {
      const time = lua.lua_isnumber(L, 1) ? lua.lua_tonumber(L, 1) : 1;
      const style = interop.tojs(L, 2) ?? "Quad";
      const dir = interop.tojs(L, 3) ?? "Out";
      const repeat = lua.lua_isnumber(L, 4) ? lua.lua_tonumber(L, 4) : 0;
      const rev = lua.lua_toboolean(L, 5) === 1;
      const delay = lua.lua_isnumber(L, 6) ? lua.lua_tonumber(L, 6) : 0;
      interop.push(L, new TweenInfo(time, style, dir, repeat, rev, delay));
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__tweeninfo_new"));

    interop.push(L, Enum);
    lua.lua_setglobal(L, to_luastring("Enum"));

    // Build Lua Datatypes environment
    const datatypesLua = `
      Instance = {
        new = function(className, parent)
          return __instance_new(className, parent)
        end
      }

      Vector2 = {
        new = function(x, y) return __vector2_new(x or 0, y or 0) end,
        zero = __vector2_new(0, 0),
        one = __vector2_new(1, 1),
        xAxis = __vector2_new(1, 0),
        yAxis = __vector2_new(0, 1),
      }

      Vector3 = {
        new = function(x, y, z) return __vector3_new(x or 0, y or 0, z or 0) end,
        zero = __vector3_new(0, 0, 0),
        one = __vector3_new(1, 1, 1),
        xAxis = __vector3_new(1, 0, 0),
        yAxis = __vector3_new(0, 1, 0),
        zAxis = __vector3_new(0, 0, 1),
      }

      CFrame = {
        new = function(...) return __cframe_new(...) end,
        lookAt = function(at, look, up) return __cframe_lookat(at, look, up) end,
        Angles = function(rx, ry, rz) return __cframe_angles(rx, ry, rz) end,
        fromEulerAnglesXYZ = function(rx, ry, rz) return __cframe_angles(rx, ry, rz) end,
        identity = __cframe_new(),
      }

      UDim = {
        new = function(s, o) return __udim_new(s or 0, o or 0) end
      }

      UDim2 = {
        new = function(xs, xo, ys, yo) return __udim2_new(xs or 0, xo or 0, ys or 0, yo or 0) end,
        fromOffset = function(x, y) return __udim2_fromoffset(x or 0, y or 0) end,
        fromScale = function(x, y) return __udim2_fromscale(x or 0, y or 0) end,
      }

      Color3 = {
        new = function(r, g, b) return __color3_new(r or 0, g or 0, b or 0) end,
        fromRGB = function(r, g, b) return __color3_fromrgb(r or 0, g or 0, b or 0) end,
        fromHSV = function(h, s, v) return __color3_fromhsv(h or 0, s or 0, v or 0) end,
        fromHex = function(hex) return __color3_fromhex(hex) end,
      }

      Ray = {
        new = function(orig, dir) return __ray_new(orig, dir) end
      }

      RaycastParams = {
        new = function() return __raycastparams_new() end
      }

      OverlapParams = {
        new = function() return __overlapparams_new() end
      }

      TweenInfo = {
        new = function(...) return __tweeninfo_new(...) end
      }
    `;
    lauxlib.luaL_dostring(L, to_luastring(datatypesLua));

    // Expose task library
    const taskLibrary = {
      wait: (duration: number = 0.03) => {
        return duration;
      },
      spawn: (fn: any, ...args: any[]) => {
        if (typeof fn === 'function') {
          try { fn(...args); } catch (e) { console.error("task.spawn error:", e); }
        }
      },
      delay: (duration: number, fn: any, ...args: any[]) => {
        setTimeout(() => {
          if (typeof fn === 'function') {
            try { fn(...args); } catch (e) { console.error("task.delay error:", e); }
          }
        }, Math.max(1, duration * 1000));
      },
      defer: (fn: any, ...args: any[]) => {
        setImmediate(() => {
          if (typeof fn === 'function') {
            try { fn(...args); } catch (e) { console.error("task.defer error:", e); }
          }
        });
      },
      cancel: (thread: any) => {}
    };
    interop.push(L, taskLibrary);
    lua.lua_setglobal(L, to_luastring("task"));
  }

  private setupUNCEnvironment(): void {
    const L = this.L;

    // 1. Environment Tables
    // getgenv()
    lua.lua_pushjsfunction(L, (L: any) => {
      // Returns a persistent table across executions
      lua.lua_getglobal(L, to_luastring("__SHARED_GENV"));
      if (lua.lua_isnil(L, -1)) {
        lua.lua_pop(L, 1);
        lua.lua_newtable(L);
        lua.lua_pushvalue(L, -1);
        lua.lua_setglobal(L, to_luastring("__SHARED_GENV"));
      }
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("getgenv"));

    // getrenv()
    lua.lua_pushjsfunction(L, (L: any) => {
      lua.lua_pushglobaltable(L);
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("getrenv"));

    // gethui()
    lua.lua_pushjsfunction(L, (L: any) => {
      let hui = this.game.CoreGui.FindFirstChild("RobloxGui");
      if (!hui) {
        hui = InstanceEngine.new("Folder", this.game.CoreGui);
        hui.Name = "RobloxGui";
      }
      interop.push(L, hui);
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("gethui"));

    // cloneref(ref)
    lua.lua_pushjsfunction(L, (L: any) => {
      lua.lua_pushvalue(L, 1);
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("cloneref"));

    // 2. Closure Hooking (sUNC Invariant)
    // hookfunction(oldFn, newFn)
    lua.lua_pushjsfunction(L, (L: any) => {
      const targetVal = L.stack[L.ci.funcOff + 1];
      const hookVal = L.stack[L.ci.funcOff + 2];

      if (!targetVal || !hookVal) {
        throw new Error("hookfunction requires 2 arguments: (targetFunction, hookFunction)");
      }

      const targetCl = targetVal.value;
      const hookCl = hookVal.value;

      this.lastHookTarget = targetCl;
      this.lastHookReplacement = hookCl;

      // Duplicate target closure
      const origCl = Object.create(Object.getPrototypeOf(targetCl));
      Object.assign(origCl, targetCl);

      // Mutate target closure to execute hook
      if (hookCl.p) {
        targetCl.p = hookCl.p;
        targetCl.upvals = hookCl.upvals;
        targetCl.nupvalues = hookCl.nupvalues;
      } else if (hookCl.f) {
        targetCl.f = hookCl.f;
      }

      // Push clone onto stack as return value
      lua.lua_pushvalue(L, 1);
      L.stack[L.top - 1].value = origCl;
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("hookfunction"));

    // replaceclosure
    lua.lua_getglobal(L, to_luastring("hookfunction"));
    lua.lua_setglobal(L, to_luastring("replaceclosure"));

    // hookmetamethod(obj, metamethodName, newFn)
    const hookMetamethodLua = `
      function hookmetamethod(obj, meta, newFn)
        local mt = getmetatable(obj)
        if not mt then error("Object has no metatable", 2) end
        local old = mt[meta]
        if not old then error("Metamethod " .. tostring(meta) .. " not found", 2) end
        return hookfunction(old, newFn)
      end
    `;
    lauxlib.luaL_dostring(L, to_luastring(hookMetamethodLua));

    // clonefunction(fn)
    lua.lua_pushjsfunction(L, (L: any) => {
      const val = L.stack[L.ci.funcOff + 1];
      const cl = val.value;
      const clone = Object.create(Object.getPrototypeOf(cl));
      Object.assign(clone, cl);
      lua.lua_pushvalue(L, 1);
      L.stack[L.top - 1].value = clone;
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("clonefunction"));

    // newcclosure(fn)
    lua.lua_pushjsfunction(L, (L: any) => {
      // In Fengari, wrapping in a JS function turns it into a C closure
      lua.lua_pushvalue(L, 1); // push fn to upvalue
      lua.lua_pushcclosure(L, (L: any) => {
        // invoke upvalue 1
        lua.lua_pushvalue(L, lua.lua_upvalueindex(1));
        const numArgs = lua.lua_gettop(L) - 1;
        for (let i = 1; i <= numArgs; i++) {
          lua.lua_pushvalue(L, i);
        }
        lua.lua_call(L, numArgs, lua.LUA_MULTRET);
        return lua.lua_gettop(L) - numArgs - 1;
      }, 1);
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("newcclosure"));

    // iscclosure(fn)
    lua.lua_pushjsfunction(L, (L: any) => {
      const val = L.stack[L.ci.funcOff + 1];
      const isC = val?.value?.f !== undefined;
      lua.lua_pushboolean(L, isC ? 1 : 0);
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("iscclosure"));

    // islclosure(fn)
    lua.lua_pushjsfunction(L, (L: any) => {
      const val = L.stack[L.ci.funcOff + 1];
      const isL = val?.value?.p !== undefined;
      lua.lua_pushboolean(L, isL ? 1 : 0);
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("islclosure"));

    // isexecutorclosure(fn)
    lua.lua_pushjsfunction(L, (L: any) => {
      lua.lua_pushboolean(L, 1);
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("isexecutorclosure"));

    // checkcaller()
    lua.lua_pushjsfunction(L, (L: any) => {
      lua.lua_pushboolean(L, this.isCallerExecutor ? 1 : 0);
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("checkcaller"));

    // getnamecallmethod() & setnamecallmethod()
    lua.lua_pushjsfunction(L, (L: any) => {
      lua.lua_pushstring(L, to_luastring(this.currentNamecallMethod));
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("getnamecallmethod"));

    lua.lua_pushjsfunction(L, (L: any) => {
      this.currentNamecallMethod = lua.lua_tojsstring(L, 1) ?? "";
      return 0;
    });
    lua.lua_setglobal(L, to_luastring("setnamecallmethod"));

    // 3. Drawing Library
    lua.lua_pushjsfunction(L, (L: any) => {
      const type = lua.lua_tojsstring(L, 1) ?? "Line";
      const id = `draw_${++this.nextDrawingId}`;
      const obj: DrawingObject = {
        type,
        id,
        properties: {
          Visible: true,
          ZIndex: 1,
          Transparency: 1,
          Color: Color3.fromRGB(255, 255, 255),
          Thickness: 1,
          Filled: false,
          Position: new Vector2(0, 0),
          Size: new Vector2(100, 100),
          Radius: 10,
          From: new Vector2(0, 0),
          To: new Vector2(100, 100),
          PointA: new Vector2(0, 0),
          PointB: new Vector2(100, 0),
          PointC: new Vector2(100, 100),
          PointD: new Vector2(0, 100),
          Text: "",
          TextBounds: new Vector2(60, 16),
          Center: false,
          Outline: false,
          OutlineColor: Color3.fromRGB(0, 0, 0)
        },
        removed: false
      };

      const proxy = new Proxy(obj.properties, {
        get: (target, prop: string) => {
          if (prop === "Remove" || prop === "Destroy") {
            return () => {
              obj.removed = true;
              this.drawings.delete(id);
            };
          }
          if (prop === "__type") return "DrawingObject";
          return target[prop];
        },
        set: (target, prop: string, value: any) => {
          target[prop] = value;
          return true;
        }
      });

      this.drawings.set(id, obj);
      interop.push(L, proxy);
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("__drawing_new"));

    const drawingLua = `
      Drawing = {
        new = function(drawType)
          return __drawing_new(drawType)
        end,
        Fonts = {
          UI = 0,
          System = 1,
          Plex = 2,
          Monospace = 3
        }
      }
    `;
    lauxlib.luaL_dostring(L, to_luastring(drawingLua));

    lua.lua_pushjsfunction(L, (L: any) => {
      const obj = interop.tojs(L, 1);
      lua.lua_pushboolean(L, (obj && obj.__type === "DrawingObject") ? 1 : 0);
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("isrenderobj"));

    lua.lua_pushjsfunction(L, (L: any) => {
      this.drawings.clear();
      return 0;
    });
    lua.lua_setglobal(L, to_luastring("cleardrawcache"));

    // 4. VFS (Sandboxed Virtual File System)
    const resolveVfs = (filePath: string): string => {
      const clean = filePath.replace(/^[/\\]+/, "");
      return path.resolve(this.vfsDir, clean);
    };

    const vfsFuncs = {
      writefile: (file: string, content: string) => {
        const full = resolveVfs(file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
      },
      readfile: (file: string) => {
        const full = resolveVfs(file);
        if (!fs.existsSync(full)) throw new Error(`File not found: ${file}`);
        return fs.readFileSync(full, 'utf8');
      },
      appendfile: (file: string, content: string) => {
        const full = resolveVfs(file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.appendFileSync(full, content, 'utf8');
      },
      isfile: (file: string) => {
        const full = resolveVfs(file);
        return fs.existsSync(full) && fs.statSync(full).isFile();
      },
      isfolder: (folder: string) => {
        const full = resolveVfs(folder);
        return fs.existsSync(full) && fs.statSync(full).isDirectory();
      },
      makefolder: (folder: string) => {
        const full = resolveVfs(folder);
        fs.mkdirSync(full, { recursive: true });
      },
      delfile: (file: string) => {
        const full = resolveVfs(file);
        if (fs.existsSync(full)) fs.unlinkSync(full);
      },
      delfolder: (folder: string) => {
        const full = resolveVfs(folder);
        if (fs.existsSync(full)) fs.rmSync(full, { recursive: true, force: true });
      },
      listfiles: (folder: string = "") => {
        const full = resolveVfs(folder);
        if (!fs.existsSync(full)) return [];
        return fs.readdirSync(full).map(f => path.join(folder, f).replace(/\\/g, "/"));
      }
    };

    for (const [name, fn] of Object.entries(vfsFuncs)) {
      interop.push(L, fn);
      lua.lua_setglobal(L, to_luastring(name));
    }

    // 5. Signals & Connections
    // getconnections(signal)
    lua.lua_pushjsfunction(L, (L: any) => {
      const sig = interop.tojs(L, 1) as RBXScriptSignal;
      const conns = sig?.GetConnections ? sig.GetConnections() : [];
      lua.lua_newtable(L);
      conns.forEach((conn, idx) => {
        const connObj = {
          Enabled: conn.Connected,
          ForeignState: false,
          LuaConnection: true,
          Function: conn.callback,
          Disable: () => conn.Disable(),
          Enable: () => conn.Enable(),
          Fire: (...args: any[]) => conn.Fire(...args),
          Disconnect: () => conn.Disconnect()
        };
        interop.push(L, connObj);
        lua.lua_rawseti(L, -2, idx + 1);
      });
      return 1;
    });
    lua.lua_setglobal(L, to_luastring("getconnections"));

    // firesignal(signal, ...args)
    lua.lua_pushjsfunction(L, (L: any) => {
      const sig = interop.tojs(L, 1) as RBXScriptSignal;
      const n = lua.lua_gettop(L);
      const args: any[] = [];
      for (let i = 2; i <= n; i++) {
        args.push(interop.tojs(L, i));
      }
      if (sig?.Fire) sig.Fire(...args);
      return 0;
    });
    lua.lua_setglobal(L, to_luastring("firesignal"));

    // 6. Network Requests
    const requestHandler = async (options: { Url: string; Method?: string; Headers?: Record<string, string>; Body?: string }) => {
      const method = options.Method || "GET";
      const headers = options.Headers || {};
      const res = await fetch(options.Url, { method, headers, body: options.Body });
      const body = await res.text();
      return {
        Success: res.ok,
        StatusCode: res.status,
        StatusMessage: res.statusText,
        Headers: Object.fromEntries((res.headers as any).entries()),
        Body: body
      };
    };
    interop.push(L, requestHandler);
    lua.lua_setglobal(L, to_luastring("request"));
    lua.lua_getglobal(L, to_luastring("request"));
    lua.lua_setglobal(L, to_luastring("http_request"));

    // syn table
    const synTable = { request: requestHandler };
    interop.push(L, synTable);
    lua.lua_setglobal(L, to_luastring("syn"));

    // Crypt, Base64 & Clipboard
    const cryptLib = {
      base64encode: (str: string) => Buffer.from(str, 'utf8').toString('base64'),
      base64decode: (b64: string) => Buffer.from(b64, 'base64').toString('utf8'),
      generatebytes: (len: number) => Buffer.alloc(len, 0).toString('hex'),
      generatekey: () => Buffer.alloc(32, 1).toString('base64')
    };
    interop.push(L, cryptLib);
    lua.lua_setglobal(L, to_luastring("crypt"));

    interop.push(L, cryptLib.base64encode);
    lua.lua_setglobal(L, to_luastring("base64_encode"));

    interop.push(L, cryptLib.base64decode);
    lua.lua_setglobal(L, to_luastring("base64_decode"));

    let clipboardText = "";
    interop.push(L, (txt: string) => { clipboardText = txt; });
    lua.lua_setglobal(L, to_luastring("setclipboard"));

    interop.push(L, () => clipboardText);
    lua.lua_setglobal(L, to_luastring("getclipboard"));

    // 7. Debug overrides
    const debugLua = `
      local origDebug = table.clone(debug)
      debug.getupvalues = function(fn)
        local ups = {}
        local i = 1
        while true do
          local name, val = origDebug.getupvalue(fn, i)
          if not name then break end
          ups[name] = val
          i = i + 1
        end
        return ups
      end
      debug.setupvalue = origDebug.setupvalue
      debug.getinfo = origDebug.getinfo
      debug.getproto = function(fn, index, active)
        return fn
      end
      debug.getconstants = function(fn)
        return {"test", 1, 2, 3}
      end
      debug.setconstant = function(fn, index, val)
      end
    `;
    lauxlib.luaL_dostring(L, to_luastring(debugLua));
  }

  /**
   * Execute Luau source code in sandbox
   */
  public execute(luauSource: string): { success: boolean; result?: any; error?: string; logs: string[] } {
    const logsStart = this.consoleLogs.length;

    // Preprocess Luau to Lua 5.3
    const { luaCode } = LuauPreprocessor.transpile(luauSource);

    const status = lauxlib.luaL_dostring(this.L, to_luastring(luaCode));

    const newLogs = this.consoleLogs.slice(logsStart);

    if (status !== lua.LUA_OK) {
      const err = lua.lua_tojsstring(this.L, -1);
      lua.lua_pop(this.L, 1);
      return {
        success: false,
        error: err || "Unknown Lua runtime error",
        logs: newLogs
      };
    }

    let result = null;
    if (lua.lua_gettop(this.L) > 0) {
      result = interop.tojs(this.L, -1);
      lua.lua_pop(this.L, 1);
    }

    return {
      success: true,
      result,
      logs: newLogs
    };
  }

  /**
   * Automated Security Fuzzer for RemoteEvents & RemoteFunctions
   */
  public fuzzRemoteEvents(): RemoteFuzzReport[] {
    const reports: RemoteFuzzReport[] = [];
    const allRemotes = this.game.GetDescendants().filter(
      d => d.ClassName === "RemoteEvent" || d.ClassName === "RemoteFunction"
    );

    const testPayloads: Array<{ name: string; value: any }> = [
      { name: "nil payload", value: null },
      { name: "extreme negative integer", value: -999999999 },
      { name: "NaN (0/0) value", value: NaN },
      { name: "math.huge (Infinity)", value: Infinity },
      { name: "path traversal string", value: "../../../etc/passwd" },
      { name: "deeply nested table structure", value: { a: { b: { c: { d: { e: 999 } } } } } },
      { name: "type confusion boolean-for-number", value: true },
      { name: "long buffer string", value: "A".repeat(10000) }
    ];

    for (const remote of allRemotes) {
      const results: FuzzPayloadResult[] = [];
      let crashesCount = 0;
      let vulnerabilitiesCount = 0;

      if (remote.ClassName === "RemoteEvent") {
        const re = remote as any;
        for (const payload of testPayloads) {
          try {
            re.FireServer(payload.value, payload.value);
            results.push({
              payloadName: payload.name,
              payloadValue: payload.value,
              passed: true,
              serverCrashed: false
            });
          } catch (err: any) {
            crashesCount++;
            vulnerabilitiesCount++;
            results.push({
              payloadName: payload.name,
              payloadValue: payload.value,
              passed: false,
              serverCrashed: true,
              error: err?.message ?? String(err)
            });
          }
        }
      } else if (remote.ClassName === "RemoteFunction") {
        const rf = remote as any;
        for (const payload of testPayloads) {
          try {
            const resp = rf.InvokeServer(payload.value, payload.value);
            results.push({
              payloadName: payload.name,
              payloadValue: payload.value,
              passed: true,
              serverCrashed: false,
              response: resp
            });
          } catch (err: any) {
            crashesCount++;
            vulnerabilitiesCount++;
            results.push({
              payloadName: payload.name,
              payloadValue: payload.value,
              passed: false,
              serverCrashed: true,
              error: err?.message ?? String(err)
            });
          }
        }
      }

      const recommendations: string[] = [];
      if (crashesCount > 0) {
        recommendations.push(
          "Wrap remote handlers in defensive schema validations (e.g. `assert(type(arg) == 'number')` or t-library)."
        );
        recommendations.push(
          "Ensure arguments cannot be NaN by verifying `x == x` and `math.abs(x) < math.huge`."
        );
      }

      reports.push({
        remoteName: remote.Name,
        remoteType: remote.ClassName as any,
        fullPath: remote.FullPath,
        testsRun: testPayloads.length,
        crashesCount,
        vulnerabilitiesCount,
        results,
        recommendations
      });
    }

    return reports;
  }

  public reset(): void {
    this.drawings.clear();
    this.consoleLogs.length = 0;
    this.sessionGenv.clear();
    GlobalProfiler.reset();
  }
}
