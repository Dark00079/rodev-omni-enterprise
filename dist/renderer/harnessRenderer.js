import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fengari from 'fengari';
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;
import { LuauPreprocessor } from '../luau/preprocessor.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function findHarnessPath(filename) {
    const candidates = [
        path.resolve(__dirname, '../harness', filename),
        path.resolve(__dirname, '../../src/harness', filename),
        path.resolve(process.cwd(), 'src/harness', filename),
        path.resolve(process.cwd(), 'rodev-omni-enterprise/src/harness', filename)
    ];
    for (const c of candidates) {
        if (fs.existsSync(c))
            return c;
    }
    return candidates[0];
}
export function findWorkspaceRoot(startPath) {
    if (process.env.WORKSPACE_ROOT && fs.existsSync(process.env.WORKSPACE_ROOT)) {
        return path.resolve(process.env.WORKSPACE_ROOT);
    }
    if (process.env.ROBLOX_WORKSPACE && fs.existsSync(process.env.ROBLOX_WORKSPACE)) {
        return path.resolve(process.env.ROBLOX_WORKSPACE);
    }
    const origins = [startPath, process.cwd(), __dirname].filter(Boolean);
    for (const origin of origins) {
        try {
            let current = fs.statSync(origin).isDirectory() ? path.resolve(origin) : path.dirname(path.resolve(origin));
            for (let i = 0; i < 12; i++) {
                if (fs.existsSync(path.join(current, 'Public', 'Icons')) ||
                    fs.existsSync(path.join(current, 'Icons')) ||
                    fs.existsSync(path.join(current, '.git')) ||
                    fs.existsSync(path.join(current, 'package.json'))) {
                    if (path.basename(current) === 'rodev-omni-enterprise') {
                        const parent = path.dirname(current);
                        if (fs.existsSync(path.join(parent, 'Public', 'Icons')) || fs.existsSync(path.join(parent, '.git'))) {
                            return parent;
                        }
                    }
                    return current;
                }
                const parent = path.dirname(current);
                if (parent === current)
                    break;
                current = parent;
            }
        }
        catch { }
    }
    return process.cwd();
}
const renderJsPath = fs.existsSync(findHarnessPath('render.cjs')) ? findHarnessPath('render.cjs') : findHarnessPath('render.js');
const { render, audit, measure } = require(renderJsPath);
export class HarnessRenderer {
    static async render(scriptCode, devicePresetOrOptions = "desktop_1080p", outputPath, scriptPath, clickTarget) {
        const opts = typeof devicePresetOrOptions === 'object'
            ? devicePresetOrOptions
            : {
                devicePreset: devicePresetOrOptions,
                outputPath,
                scriptPath,
                clickTarget
            };
        const devicePreset = opts.devicePreset || "desktop_1080p";
        outputPath = opts.outputPath;
        scriptPath = opts.scriptPath;
        clickTarget = opts.clickTarget;
        const clickCoords = opts.clickCoords;
        const interactionScript = opts.interactionScript;
        const logs = [];
        const L = lauxlib.luaL_newstate();
        lualib.luaL_openlibs(L);
        // Register __measure
        lua.lua_pushjsfunction(L, (L) => {
            const text = lua.lua_tojsstring(L, 1);
            const size = lua.lua_tonumber(L, 2);
            const weight = lua.lua_tojsstring(L, 3);
            const mono = lua.lua_tonumber(L, 4) === 1;
            const maxWidth = lua.lua_tonumber(L, 5);
            const [w, h] = measure(text, size, weight, mono, maxWidth);
            lua.lua_pushnumber(L, w);
            lua.lua_pushnumber(L, h);
            return 2;
        });
        lua.lua_setglobal(L, to_luastring("__measure"));
        // Override print & warn
        lua.lua_pushjsfunction(L, (L) => {
            const n = lua.lua_gettop(L);
            const parts = [];
            for (let i = 1; i <= n; i++)
                parts.push(lua.lua_tojsstring(L, i) ?? "");
            const msg = parts.join("\t");
            logs.push(`[PRINT] ${msg}`);
            return 0;
        });
        lua.lua_setglobal(L, to_luastring("print"));
        lua.lua_pushjsfunction(L, (L) => {
            const n = lua.lua_gettop(L);
            const parts = [];
            for (let i = 1; i <= n; i++)
                parts.push(lua.lua_tojsstring(L, i) ?? "");
            const msg = parts.join("\t");
            logs.push(`[WARN] ${msg}`);
            return 0;
        });
        lua.lua_setglobal(L, to_luastring("warn"));
        // Load mock_roblox.lua
        const mockPath = findHarnessPath('mock_roblox.lua');
        const mockCode = fs.readFileSync(mockPath, 'utf8');
        let st = lauxlib.luaL_dostring(L, to_luastring(mockCode));
        if (st !== 0) {
            const err = to_jsstring(lua.lua_tostring(L, -1));
            return { success: false, error: `Harness mock_roblox init error: ${err}`, logs };
        }
        // Bridge host filesystem for getcustomasset and VFS resolution dynamically
        const rootDir = findWorkspaceRoot(scriptPath);
        lua.lua_pushjsfunction(L, (L) => {
            const p = lua.lua_tojsstring(L, 1);
            if (!p) {
                lua.lua_pushnil(L);
                return 1;
            }
            const clean = p.replace(/^rbxasset:\/\//, '').replace(/^customasset:\/\//, '').replace(/^getcustomasset:\/\//, '');
            const baseName = path.basename(clean);
            const baseNoExt = path.basename(clean, path.extname(clean));
            const candidates = [
                clean,
                path.resolve(clean),
                path.resolve(rootDir, clean),
                path.resolve(process.cwd(), clean),
                path.resolve(rootDir, 'Public/Icons', baseName),
                path.resolve(rootDir, 'Public/Icons', baseNoExt + '.png'),
                path.resolve(rootDir, 'Icons', baseName),
                path.resolve(rootDir, 'Icons', baseNoExt + '.png'),
                path.resolve(rootDir, 'Public', clean),
                path.resolve(rootDir, 'assets', baseName),
                path.resolve(rootDir, 'assets', baseNoExt + '.png'),
                path.resolve(process.cwd(), 'Public/Icons', baseName),
                path.resolve(process.cwd(), 'Icons', baseName)
            ];
            for (const c of candidates) {
                if (fs.existsSync(c)) {
                    try {
                        if (fs.statSync(c).isFile()) {
                            lua.lua_pushstring(L, to_luastring(c.replace(/\\/g, '/')));
                            return 1;
                        }
                    }
                    catch { }
                }
            }
            lua.lua_pushnil(L);
            return 1;
        });
        lua.lua_setglobal(L, to_luastring("__disk_resolve_file"));
        lua.lua_pushjsfunction(L, (L) => {
            const p = lua.lua_tojsstring(L, 1);
            try {
                const data = fs.readFileSync(p, 'utf8');
                lua.lua_pushstring(L, to_luastring(data));
                return 1;
            }
            catch {
                lua.lua_pushnil(L);
                return 1;
            }
        });
        lua.lua_setglobal(L, to_luastring("__disk_read_file"));
        lua.lua_pushjsfunction(L, (L) => {
            const p = lua.lua_tojsstring(L, 1);
            if (!p) {
                lua.lua_pushboolean(L, 0);
                return 1;
            }
            const candidates = [
                p,
                path.resolve(rootDir, p),
                path.resolve(process.cwd(), p)
            ];
            for (const c of candidates) {
                if (fs.existsSync(c)) {
                    try {
                        if (fs.statSync(c).isDirectory()) {
                            lua.lua_pushboolean(L, 1);
                            return 1;
                        }
                    }
                    catch { }
                }
            }
            lua.lua_pushboolean(L, 0);
            return 1;
        });
        lua.lua_setglobal(L, to_luastring("__disk_isfolder"));
        // Extended environment, dynamic Enums, services, and sUNC globals
        const setupGlobals = `
      local EnumItemMT = { __type = "EnumItem" }
      EnumItemMT.__tostring = function(item) return "Enum." .. tostring(item.EnumType) .. "." .. item.Name end

      local function makeEnum(enumName)
        local enum = { __name = enumName }
        local mt = {
          __type = "Enum",
          __tostring = function() return enumName end,
          __index = function(e, itemName)
            local item = setmetatable({ Name = itemName, Value = 0, EnumType = e }, EnumItemMT)
            rawset(e, itemName, item)
            return item
          end
        }
        return setmetatable(enum, mt)
      end

      setmetatable(Enum, {
        __index = function(self, key)
          local e = makeEnum(key)
          rawset(self, key, e)
          return e
        end
      })

      for k, v in pairs(Enum) do
        if type(v) == "table" then
          local mt = getmetatable(v)
          if mt then
            mt.__index = function(e, itemName)
              local item = setmetatable({ Name = itemName, Value = 0, EnumType = e }, EnumItemMT)
              rawset(e, itemName, item)
              return item
            end
          end
        end
      end

      local disk_resolve = __disk_resolve_file
      local disk_read = __disk_read_file
      local disk_isfolder = __disk_isfolder

      local genv = getgenv()

      genv.isfile = function(p)
        if MOCK.files[p] ~= nil then return true end
        return disk_resolve(p) ~= nil
      end

      genv.readfile = function(p)
        if MOCK.files[p] ~= nil then return MOCK.files[p] end
        local real = disk_resolve(p)
        if real then return disk_read(real) end
        error("file not found: " .. tostring(p))
      end

      genv.writefile = function(p, data)
        MOCK.files[p] = data
      end

      genv.getcustomasset = function(p)
        local real = disk_resolve(p)
        if real then return real end
        return p
      end
      genv.getsynasset = genv.getcustomasset
      genv.get_custom_asset = genv.getcustomasset
      genv.customasset = genv.getcustomasset

      genv.isfolder = function(p)
        if MOCK.folders[p] ~= nil then return true end
        if disk_isfolder(p) then return true end
        if p == "Public/Icons" or p == "Icons" or p == "Public" then return true end
        return false
      end

      genv.makefolder = function(p)
        MOCK.folders[p] = true
      end

      genv.listfiles = function(p)
        local list = {}
        for k in pairs(MOCK.files) do table.insert(list, k) end
        return list
      end

      genv.delfile = function(p)
        MOCK.files[p] = nil
      end

      isfile = genv.isfile
      readfile = genv.readfile
      writefile = genv.writefile
      getcustomasset = genv.getcustomasset
      getsynasset = genv.getsynasset
      get_custom_asset = genv.getcustomasset
      customasset = genv.getcustomasset
      isfolder = genv.isfolder
      makefolder = genv.makefolder
      listfiles = genv.listfiles
      delfile = genv.delfile

      local genericServices = {}
      MOCK.Services.ContextActionService = {
        BindAction = function() end,
        UnbindAction = function() end,
        BindActionAtPriority = function() end,
        GetAllBoundActionInfo = function() return {} end,
      }
      MOCK.Services.SoundService = {
        RespectFilteringEnabled = true,
        PlayLocalSound = function() end,
      }
      MOCK.Services.StarterGui = {
        SetCore = function() end,
        SetCoreGuiEnabled = function() end,
        GetCoreGuiEnabled = function() return true end,
      }
      MOCK.Services.Debris = {
        AddItem = function(_, item, lifetime)
          task.delay(lifetime or 1, function()
            pcall(function() item:Destroy() end)
          end)
        end
      }

      game.GetService = function(self, name)
        if MOCK.Services[name] then return MOCK.Services[name] end
        if not genericServices[name] then
          genericServices[name] = MOCK.NewInstance("Folder", name)
        end
        return genericServices[name]
      end

      cloneref = function(x) return x end
      checkcaller = function() return true end
      loadstring = load
      identifyexecutor = function() return "RoDev-Omni-Enterprise", "1.0.0" end
      request = function(opts) return { StatusCode = 200, Body = "", Success = true } end
      http_request = request

      Drawing = {
        new = function(kind)
          return {
            Visible = true,
            Color = Color3.new(1, 1, 1),
            Transparency = 1,
            Remove = function() end,
            Destroy = function() end,
          }
        end,
        Fonts = { UI = 0, System = 1, Plex = 2, Monospace = 3 }
      }
    `;
        lauxlib.luaL_dostring(L, to_luastring(setupGlobals));
        // Viewport presets
        const presets = {
            desktop_1080p: [1920, 1080],
            mobile_landscape: [844, 390],
            tablet: [1024, 768],
            console_1080p: [1920, 1080]
        };
        const [vpW, vpH] = presets[devicePreset] || [1920, 1080];
        lauxlib.luaL_dostring(L, to_luastring(`MOCK.SetViewport(${vpW}, ${vpH})`));
        // Transpile Luau code
        const res = LuauPreprocessor.transpile(scriptCode);
        // Execute script
        st = lauxlib.luaL_dostring(L, to_luastring(res.luaCode));
        if (st !== 0) {
            const err = to_jsstring(lua.lua_tostring(L, -1));
            return { success: false, error: err, logs };
        }
        // Step mock engine to let tweens and deferred layout settle
        lauxlib.luaL_dostring(L, to_luastring('MOCK.Run(0.5)'));
        // Build unified actions list from opts.actions or legacy clickTarget/clickCoords
        const allActions = [];
        if (opts.actions && opts.actions.length > 0) {
            allActions.push(...opts.actions);
        }
        else {
            if (clickTarget)
                allActions.push({ type: "click", target: clickTarget });
            if (clickCoords)
                allActions.push({ type: "click", coords: clickCoords });
        }
        if (allActions.length > 0 || interactionScript) {
            if (allActions.length > 0) {
                const actionsJson = JSON.stringify(allActions);
                const actionRunnerLua = `
          local HttpService = game:GetService("HttpService")
          local actions = HttpService:JSONDecode([====[${actionsJson}]====])
          local function findTarget(query)
            if not query or query == "" then return nil end
            local containers = { MOCK.HUI, MOCK.CoreGui, MOCK.PlayerGui }
            -- 1. Exact name match
            for _, gui in ipairs(containers) do
              if gui then
                for _, d in ipairs(gui:GetDescendants()) do
                  if d.Name == query then return d end
                end
              end
            end
            -- 2. Common prefix matches
            for _, gui in ipairs(containers) do
              if gui then
                for _, d in ipairs(gui:GetDescendants()) do
                  if d.Name == "Btn_" .. query or d.Name == "CatBtn_" .. query or d.Name == "Wrap_" .. query or d.Name == "Stack_" .. query or d.Name == "Block_" .. query then
                    return d
                  end
                end
              end
            end
            -- 3. Exact text match
            for _, gui in ipairs(containers) do
              if gui then
                for _, d in ipairs(gui:GetDescendants()) do
                  if (d:IsA("TextLabel") or d:IsA("TextButton")) and d.Text == query then
                    return d
                  end
                end
              end
            end
            -- 4. Case-insensitive substring match
            local qLower = query:lower()
            for _, gui in ipairs(containers) do
              if gui then
                for _, d in ipairs(gui:GetDescendants()) do
                  if d.Name:lower():find(qLower, 1, true) then return d end
                  if (d:IsA("TextLabel") or d:IsA("TextButton")) and d.Text:lower():find(qLower, 1, true) then
                    return d
                  end
                end
              end
            end
            return nil
          end

          local function getClickable(target)
            if not target then return nil end
            if target:IsA("TextButton") or target:IsA("ImageButton") then return target end
            local childBtn = target:FindFirstChildWhichIsA("TextButton", true) or target:FindFirstChildWhichIsA("ImageButton", true) or target:FindFirstChild("Button")
            return childBtn or target
          end

          for idx, act in ipairs(actions) do
            MOCK.Layout.Run()
            if act.type == "click" then
              local btn = nil
              if act.coords then
                local cx, cy = act.coords[1], act.coords[2]
                local maxZ = -math.huge
                local containers = { MOCK.HUI, MOCK.CoreGui, MOCK.PlayerGui }
                for _, gui in ipairs(containers) do
                  if gui then
                    for _, d in ipairs(gui:GetDescendants()) do
                      if (d:IsA("TextButton") or d:IsA("ImageButton")) and d.Visible then
                        local p, s = d.AbsolutePosition, d.AbsoluteSize
                        if cx >= p.X and cx <= p.X + s.X and cy >= p.Y and cy <= p.Y + s.Y then
                          if d.ZIndex >= maxZ then
                            maxZ = d.ZIndex
                            btn = d
                          end
                        end
                      end
                    end
                  end
                end
              elseif act.target then
                local t = findTarget(act.target)
                btn = getClickable(t)
              end

              if btn then
                print("[MOCK INTERACTION] Action #" .. idx .. " Click: " .. btn:GetFullName())
                MOCK.Fire(btn, "MouseEnter")
                local press = MOCK.Input("MouseButton1")
                MOCK.Fire(btn, "InputBegan", press)
                if btn.MouseButton1Click then btn.MouseButton1Click:Fire() end
                if btn.Activated then btn.Activated:Fire(press) end
                press.UserInputState = Enum.UserInputState.End
                MOCK.Fire(btn, "InputEnded", press)
                MOCK.Flush()
                MOCK.Run(0.3)
              else
                print("[MOCK INTERACTION] Action #" .. idx .. " Click target not found: " .. tostring(act.target or act.coords))
              end

            elseif act.type == "drag" then
              local src = findTarget(act.source)
              local srcBtn = getClickable(src)
              if not srcBtn then
                print("[MOCK INTERACTION] Action #" .. idx .. " Drag source not found: " .. tostring(act.source))
              else
                local srcPos = srcBtn.AbsolutePosition
                local startX = srcPos.X + 20
                local startY = srcPos.Y + 10
                local destX, destY = 550, 200

                local targetQuery = act.toTarget or act.attachTo
                local placement = act.placement or (act.attachTo and "bottom") or "center"

                if targetQuery then
                  local t = findTarget(targetQuery)
                  if t then
                    local tPos = t.AbsolutePosition
                    local tSize = t.AbsoluteSize
                    if placement == "bottom" then
                      destX = tPos.X + 24
                      destY = tPos.Y + tSize.Y + 16
                    elseif placement == "top" then
                      destX = tPos.X + tSize.X / 2
                      destY = tPos.Y - 10
                    else
                      destX = tPos.X + tSize.X / 2
                      destY = tPos.Y + tSize.Y / 2
                    end
                    print("[MOCK INTERACTION] Action #" .. idx .. " Drop target resolved: " .. t:GetFullName() .. " (" .. placement .. ") -> (" .. destX .. ", " .. destY .. ")")
                  else
                    print("[MOCK INTERACTION] Action #" .. idx .. " Drop target not found: " .. tostring(targetQuery))
                  end
                elseif act.toCoords then
                  destX, destY = act.toCoords[1], act.toCoords[2]
                end

                print("[MOCK INTERACTION] Action #" .. idx .. " Dragging " .. srcBtn:GetFullName() .. " to (" .. destX .. ", " .. destY .. ")")
                MOCK.MoveTo(startX, startY)
                local press = MOCK.Input("MouseButton1", {
                  Position = Vector3.new(startX, startY, 0),
                  UserInputState = Enum.UserInputState.Begin
                })
                srcBtn.InputBegan:Fire(press)
                MOCK.Flush()

                -- Step movement through midpoint to trigger drag threshold (> 6px) and snap checks
                local midX = (startX + destX) / 2
                local midY = (startY + destY) / 2
                MOCK.MoveTo(midX, midY)
                MOCK.Flush()
                MOCK.MoveTo(destX, destY)
                MOCK.Flush()

                press.UserInputState = Enum.UserInputState.End
                press.Position = Vector3.new(destX, destY, 0)
                if press.Changed then press.Changed:Fire("UserInputState") end
                srcBtn.InputEnded:Fire(press)
                MOCK.Flush()
                MOCK.Run(0.4)
              end

            elseif act.type == "type" then
              local target = findTarget(act.target)
              if target and target:IsA("TextBox") then
                print("[MOCK INTERACTION] Action #" .. idx .. " Typing into " .. target:GetFullName() .. ": " .. tostring(act.text))
                target.Text = act.text or ""
                if target.FocusLost then target.FocusLost:Fire(true) end
                MOCK.Flush()
                MOCK.Run(0.1)
              end

            elseif act.type == "wait" then
              MOCK.Run(act.duration or 0.5)
            end
          end
        `;
                const stAct = lauxlib.luaL_dostring(L, to_luastring(actionRunnerLua));
                if (stAct !== 0) {
                    const actErr = to_jsstring(lua.lua_tostring(L, -1));
                    console.error("[ACTION ERROR]", actErr);
                    logs.push("[ACTION ERROR] " + actErr);
                }
            }
            if (interactionScript) {
                const { luaCode: interLua } = LuauPreprocessor.transpile(interactionScript);
                lauxlib.luaL_dostring(L, to_luastring(interLua));
            }
            // Settle again after all interactions
            lauxlib.luaL_dostring(L, to_luastring('MOCK.Run(0.5)'));
        }
        // Export GUI tree
        lauxlib.luaL_dostring(L, to_luastring('return MOCK.Export()'));
        const jsonStr = to_jsstring(lua.lua_tostring(L, -1));
        const tree = JSON.parse(jsonStr);
        const out = outputPath || path.resolve('test/artifacts/rendered_gui.png');
        const outDir = path.dirname(out);
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }
        const pngBuffer = await render(tree, { rootDir });
        fs.writeFileSync(out, pngBuffer);
        const diagnostics = audit(tree);
        return {
            success: true,
            savedTo: out,
            rootsCount: tree.roots ? tree.roots.length : 0,
            diagnostics,
            logs,
            imageSize: pngBuffer.length
        };
    }
}
