# RoDev-Omni-Enterprise MCP Server

**RoDev-Omni-Enterprise** is an enterprise-grade Model Context Protocol (MCP) server that empowers AI coding agents (and human engineers) with a full-fidelity headless Roblox execution, 3D simulation, multi-device UI diagnostics, synthetic interaction, and security fuzzing pipeline.

Built with **Node.js, TypeScript, Fengari (Lua 5.3 VM), @napi-rs/canvas, and Headless Playwright Chromium**, it enables IDE agents to execute, test, render, click, and security-audit Roblox code headlessly — **with zero dependency on a running Roblox client or live injection**.

---

## Table of Contents
1. [Core Architecture & Dual Render Pipeline](#core-architecture--dual-render-pipeline)
2. [Universal Portability & Workspace Auto-Discovery](#universal-portability--workspace-auto-discovery)
3. [Luau-to-Lua 5.3 Lexical Preprocessor](#luau-to-lua-53-lexical-preprocessor)
4. [Headless Roblox Engine Harness & Fast Canvas Renderer](#headless-roblox-engine-harness--fast-canvas-renderer)
5. [The 15 Enterprise MCP Tools](#the-15-enterprise-mcp-tools)
   - [`render_and_diagnose_ui`](#1-render_and_diagnose_ui)
   - [`interact_and_diff_ui`](#2-interact_and_diff_ui)
   - [`run_sunc_executor_test`](#3-run_sunc_executor_test)
   - [`simulate_3d_workspace`](#4-simulate_3d_workspace)
   - [`launch_interactive_dashboard`](#5-launch_interactive_dashboard)
   - [`stop_interactive_dashboard`](#6-stop_interactive_dashboard)
   - [`test_client_server_remotes`](#7-test_client_server_remotes)
   - [`profile_memory_and_leaks`](#8-profile_memory_and_leaks)
   - [`test_datastore_and_persistence`](#9-test_datastore_and_persistence)
   - [`analyze_luau_script`](#10-analyze_luau_script)
   - [`inspect_datamodel_tree`](#11-inspect_datamodel_tree)
   - [`reset_session`](#12-reset_session)
   - [`create_roblox_game`](#13-create_roblox_game)
   - [`interact_game_world`](#14-interact_game_world)
   - [`inspect_game_state`](#15-inspect_game_state)
6. [Automated Verification Suite](#automated-verification-suite)
7. [Installation & IDE Integration Guide](#installation--ide-integration-guide)

---

## Core Architecture & Dual Render Pipeline

```
                                  ┌─────────────────────────────────────────────────────────┐
                                  │           AI Agent / MCP Client (IDE, CLI, Host)        │
                                  └────────────────────────────┬────────────────────────────┘
                                                               │ (JSON-RPC stdio)
                                  ┌────────────────────────────▼────────────────────────────┐
                                  │            RoDev-Omni-Enterprise MCP Server             │
                                  │                      (src/index.ts)                     │
                                  └──────┬─────────────────────┬─────────────────────┬──────┘
                                         │                     │                     │
                ┌────────────────────────▼────────┐  ┌─────────▼───────────┐  ┌──────▼──────────────────────────┐
                │    Luau Preprocessor & Linter   │  │  In-Process VM      │  │  Multi-Engine UI Renderer       │
                │   - Token-level AST transpiler  │  │  - Fengari Lua 5.3  │  │  Engine A: Fast @napi-rs Canvas │
                │   - Lexical loop continue goto  │  │  - Roblox DataModel │  │  Engine B: Playwright Chromium  │
                │   - Compound assignment lowerer │  │  - sUNC Hooking     │  │  - Layout Math & TextBounds     │
                │   - Static deprecation oracle   │  │  - Drawing Library  │  │  - Synthetic Input Click Engine │
                │                                 │  │  - Remote Fuzzer    │  │  - Vector Icon Asset Pipeline   │
                └─────────────────────────────────┘  └─────────────────────┘  └─────────────────────────────────┘
```

The server provides two complementary rendering pipelines:

1. **High-Fidelity Headless Harness (`mock_roblox.lua` + `@napi-rs/canvas`)**:
   - Executes complete monolithic UI frameworks (including 35,000+ line studios like Vanta Studio) in **~700ms**.
   - Implements full Roblox layout semantics: `AbsolutePosition`, `AbsoluteSize`, `UIListLayout` flow, `UIPadding`, `AutomaticSize` (X/Y/XY), `AutomaticCanvasSize` scrolling frames, font em-metric `TextBounds`, and `TweenService` animation stepping.
   - Supports **synthetic input dispatch**: locate controls by name, text label, or coordinates, fire Roblox signals (`MouseButton1Click:Fire()`, `Activated:Fire()`), and step the TaskScheduler to allow animations and state machines to settle before export.
   - Pre-decodes local PNG disk assets (`rbxasset://`, `customasset://`, `getcustomasset://`) and performs offscreen canvas alpha color-tinting (`globalCompositeOperation = 'source-in'`).

2. **Playwright Chromium Engine (`playwrightEngine.ts` + `guiDomTranslator.ts`)**:
   - Translates Roblox `GuiObject` trees into pixel-accurate HTML5/CSS3.
   - Provides visual pixel-diffing for interaction test suites.

---

## Universal Portability & Workspace Auto-Discovery

RoDev-Omni-Enterprise is built with **zero hardcoded machine paths**, allowing it to run out of the box on Windows, macOS, Linux, and inside any IDE container.

### Dynamic Root Discovery (`findWorkspaceRoot`)
The server dynamically determines the active workspace root using a multi-tiered fallback:
1. Environment overrides: `process.env.WORKSPACE_ROOT` or `process.env.ROBLOX_WORKSPACE`.
2. Explicit script context: if a script path is provided via `filePath`, traverses upward from its directory.
3. Upward crawler: walks up to 12 parent directory levels from `process.cwd()` and `__dirname` searching for workspace markers:
   - `Public/Icons/` or `Icons/`
   - `.git/`
   - `package.json`

### Asset Pipeline Resolution (`resolveImagePath`)
When scripts call `isfile()`, `readfile()`, or `getcustomasset()`, paths are normalized and resolved dynamically across:
- `<workspace>/<path>`
- `<workspace>/Public/Icons/<name>.png`
- `<workspace>/Icons/<name>.png`
- `<workspace>/assets/<name>.png`
- Relative execution directories.

---

## Luau-to-Lua 5.3 Lexical Preprocessor

Roblox Luau introduces non-standard syntax additions that standard Lua 5.3 runtimes reject. The preprocessor (`src/luau/preprocessor.ts`) uses token-level lexical parsing to transpile Luau code cleanly:

- **Lexical Loop-Depth `continue` Transformation**: Naive regex replacements break on nested loops or string literals. Our preprocessor tracks lexical loop depths (`for`, `while`, `repeat`) and replaces `continue` with unique target labels (`goto __cont_${loopId}__`), placing `::__cont_${loopId}__::` at the true loop termination.
- **Compound Assignment Lowering**: Expands `a += b`, `x *= y`, `s ..= t` into standard assignments while preserving left-hand expression purity.
- **Type Annotation Removal**: Strips type assertions (`:: any`, `:: Vector3`), generic type packs, and function parameter/return signatures.
- **Numeric & String Literals**: Converts binary literals (`0b1010`), numeric digit separators (`1_000_000`), and interpolated strings (`\`Hello {name}\``).
- **Safe Navigation & Default Operators**: Normalizes `?.` optional chaining syntax.

---

## Headless Roblox Engine Harness & Fast Canvas Renderer

The harness accurately reproduces the Roblox client environment headlessly:

- **DataModel & Hierarchy**: Complete implementation of `game`, `workspace`, `CoreGui`, `Players.LocalPlayer.PlayerGui`, and `gethui()`.
- **GuiObjects & Modifiers**:
  - `ScreenGui`, `Frame`, `CanvasGroup`, `ScrollingFrame`
  - `TextLabel`, `TextButton`, `TextBox`
  - `ImageLabel`, `ImageButton`
  - `UICorner`, `UIStroke` (Border and Contextual modes), `UIGradient`, `UIPadding`, `UIListLayout` (Horizontal/Vertical flow, alignments, wrap), `UIScale`, `UISizeConstraint`
- **Signal & Connection Architecture**: Full `RBXScriptSignal` implementation supporting `:Connect()`, `:Once()`, `:Wait()`, and `:Fire()`.
- **TaskScheduler**: Steppable virtual time (`MOCK.Run(dt)`), `task.spawn`, `task.delay`, `task.wait`, and `TweenService` easing functions.
- **Vector Icon Rasterizer**: Loads local PNG assets via `@napi-rs/canvas` `loadImage` and applies `ImageColor3` tinting via canvas compositing.

---

## The 12 Enterprise MCP Tools

### 1. `render_and_diagnose_ui`
Renders a Roblox UI script, applies layout calculations, dispatches optional synthetic click interactions, and captures a high-resolution PNG screenshot with clipping and overflow diagnostics.

#### Parameters:
- `code` *(string, optional)*: Raw Luau script creating GUI elements.
- `filePath` *(string, optional)*: Path to a `.lua` or `.luau` file on disk.
- `devicePreset` *(enum, optional)*: Viewport preset (`"desktop_1080p"`, `"mobile_landscape"`, `"tablet"`, `"console_1080p"`). Default: `"desktop_1080p"`.
- `outputPath` *(string, optional)*: Path to save the output PNG file.
- `clickTarget` *(string, optional)*: Name, text label, or path of a button to click before capturing.
- `clickCoords` *(array of 2 numbers, optional)*: Viewport coordinates `[x, y]` to hit-test and click.
- `actions` *(array of objects, optional)*: Sequential user interactions executed natively before capture:
  - `{ "type": "click", "target": "ButtonName" }` or `{ "type": "click", "coords": [450, 320] }`
  - `{ "type": "drag", "source": "DraggableItem", "toCoords": [550, 200] }` (drag to screen coordinates)
  - `{ "type": "drag", "source": "DraggableItem", "toTarget": "DropZone", "placement": "center" }` (drop into target element; supports `"center"`, `"bottom"`, `"top"`)
  - `{ "type": "type", "target": "InputTextBox", "text": "Hello World" }` (type into input field)
  - `{ "type": "wait", "duration": 0.5 }` (step engine simulation)
- `interactionScript` *(string, optional)*: Luau code to execute on the rendered GUI before capturing.

#### Example Request:
```json
{
  "filePath": "src/client/gui.luau",
  "devicePreset": "desktop_1080p",
  "actions": [
    { "type": "click", "target": "OpenMenu" },
    { "type": "drag", "source": "InventoryItem", "toTarget": "HotbarSlot1" }
  ],
  "outputPath": "test/artifacts/rendered_ui.png"
}
```

---

### 2. `interact_and_diff_ui`
Dispatches synthetic input interactions (click, drag, type) to rendered UI, mutates state, and computes a visual pixel diff percentage report between the before and after states.

#### Parameters:
- `initialCode` *(string)*: Luau code generating the baseline UI.
- `action` *(object)*: Input action description:
  - `type`: `"click"` | `"drag"` | `"type"`
  - `targetPath` *(string, optional)*: Target element identifier.
  - `x`, `y` *(number, optional)*: Start coordinates.
  - `toX`, `toY` *(number, optional)*: Destination coordinates for drag actions.
  - `text` *(string, optional)*: String to input for typing actions.
- `interactionScript` *(string, optional)*: Luau mutation script to run concurrently with the interaction.
- `outBeforePath`, `outAfterPath` *(string, optional)*: Paths for before/after screenshots.

---

### 3. `run_sunc_executor_test`
Runs Luau scripts inside a Thread Identity 8 sandbox equipped with the full **sUNC / UNC** specification:
- **Closure Hooking**: `hookfunction`, `hookmetamethod`, `newcclosure`, original closure chaining.
- **Drawing Library**: `Drawing.new("Line" | "Circle" | "Square" | "Text" | "Image")` with full color, thickness, and visibility mutation.
- **Environment Agnosticism**: `getgenv()`, `getrenv()`, `checkcaller()`, `cloneref()`, `clonefunction()`.
- **Filesystem VFS**: Sandboxed `readfile`, `writefile`, `isfile`, `isfolder`, `makefolder`, `listfiles`, `delfile`.
- **Signals & Input**: `getconnections`, `firesignal`.

---

### 4. `simulate_3d_workspace`
Simulates Roblox 3D Workspace environments, Baseplate templates, player avatars, humanoid movement, and raycasting physics without opening the Roblox client. Generates high-resolution 1920x1080 3D perspective screenshots from any omnidirectional viewpoint.

#### Parameters:
- `template` *(enum, optional)*: Environment template:
  - `"baseplate"` *(default)*: Standard 512×1×512 stud Baseplate with grid markings, SpawnLocation platform, and ambient sky lighting.
  - `"obstacles"`: Baseplate + jump platforms, ramps, truss pillars, and colored obstacle courses.
  - `"empty"`: Clean slate for custom scripts.
- `spawnPlayer` *(boolean, optional)*: Automatically spawns an authentic Roblox player character avatar (default: `true`).
- `playerRig` *(enum, optional)*: `"R6"` *(default)* or `"R15"`. Spawns Head with classic smiley face decal, Torso, Limbs, and Motor6D joints.
- `playerMovement` *(object, optional)*:
  - `moveTo`: Destination coordinates `[x, y, z]` to step character towards.
  - `jump`: Set character to jump state.
  - `speed`: WalkSpeed override (default: `16`).
- `cameraMode` *(enum, optional)*:
  - `"third_person"` *(default)*: Classic over-the-shoulder chase camera.
  - `"first_person"`: Locks camera at avatar's eyes with reticle targeting.
  - `"overhead"`: High-angle drone perspective looking down at player and environment.
  - `"custom"`: Exact arbitrary eye coordinates and target orientation.
  - `"isometric"`: CAD split-view diagram with Top-Down tactical radar.
- `cameraPosition` *(array of 3 numbers, optional)*: Eye `[x, y, z]` coordinates for `"custom"` mode.
- `cameraLookAt` *(array of 3 numbers, optional)*: Target `[x, y, z]` coordinates to point towards.
- `simulationDuration` *(number, optional)*: Simulation time in seconds to step character physics and procedural limb swing animations (default: `0.5`).
- `script` *(string, optional)*: Luau script to spawn additional parts, run raycasts, or manipulate instances.
- `outputPath` *(string, optional)*: Path to save the output 1920x1080 PNG screenshot.
- `launchDashboard` *(boolean, optional)*: Whether to host the live 60 FPS viewer at `http://localhost:4050` and auto-launch in browser (default: `false`).
- `dashboardPort` *(number, optional)*: Port for interactive dashboard (default: `4050`).

#### Example Request:
```json
{
  "template": "obstacles",
  "spawnPlayer": true,
  "playerMovement": {
    "moveTo": [0, 3, -16],
    "speed": 16
  },
  "cameraMode": "third_person",
  "outputPath": "test/artifacts/player_simulation.png",
  "launchDashboard": true
}
```

---

### 5. `launch_interactive_dashboard`
Hosts a local interactive 3D Web Dashboard on `http://localhost:4050` and auto-opens in your default web browser, allowing direct real-time interaction with the simulated Roblox world:
- **60 FPS Character Controls**: WASD to walk, Space to jump with physics & gravity, Shift to sprint.
- **Mouse Navigation**: Left-click drag to orbit camera smoothly around the avatar; scroll wheel to zoom in/out.
- **Perspective Hotkeys**: Switch between 3rd Person (`3`), 1st Person (`1`), and Overhead Drone (`O`).
- **Live Raycasting & Physics**: Press `F` to fire real-time laser raycasts from the avatar.
- **Live Luau Script Execution**: REST API endpoint (`POST /api/execute`) dynamically mutates the active DataModel and refreshes the 3D scene in real time.

#### Parameters:
- `template` *(enum, optional)*: Environment template (`"baseplate"`, `"obstacles"`, `"empty"`). Default: `"baseplate"`.
- `spawnPlayer` *(boolean, optional)*: Whether to spawn a standard Roblox avatar (default: `true`).
- `playerRig` *(enum, optional)*: Avatar rig (`"R6"`, `"R15"`). Default: `"R6"`.
- `script` *(string, optional)*: Optional Luau script executed into the workspace before launching.
- `port` *(number, optional)*: Port to host the dashboard on (default: `4050`).
- `autoOpen` *(boolean, optional)*: Automatically launch default web browser (default: `true`).

---

### 6. `stop_interactive_dashboard`
Gracefully shuts down the local interactive 3D Web Dashboard server and releases the port.

---

### 7. `test_client_server_remotes`
Automated security fuzzer for Roblox networking. Automatically discovers all `RemoteEvent` and `RemoteFunction` instances across the DataModel and fires adversarial payload matrices:
- `nil` payload
- Extreme negative integers (`-999999999`)
- `NaN` (`0/0`)
- `math.huge` (Infinity)
- Path traversal sequences (`"../../../etc/passwd"`)
- Deeply nested recursive table structures
- Type confusion vectors (boolean passed to number parameters)
- Buffer strings (10,000+ characters)

Returns a vulnerability report identifying unhandled server exceptions, parameter type confusion vulnerabilities, and remediation recommendations.

---

### 8. `profile_memory_and_leaks`
Analyzes script lifecycles for memory leaks, dead pointer traps, and orphaned signal connections.
- Compares baseline vs post-teardown snapshots.
- Identifies connections not disconnected on feature toggle or space close.
- Flags retained references to destroyed character models or instances.

---

### 9. `test_datastore_and_persistence`
Emulates Roblox's `DataStoreService` (`GetDataStore`, `GetAsync`, `SetAsync`, `UpdateAsync`) with a fault-injection engine. Allows developers to test how their scripts handle:
- Network dropouts (`timeout`)
- Engine rate-limiting (`throttle_429`)
- Schema corruption (`corrupt`)

---

### 10. `analyze_luau_script`
Static AST analyzer and deprecation oracle for Roblox Luau code.
- Detects deprecated legacy globals (`wait`, `spawn`, `delay`, `tick()`).
- Flags obsolete physics objects (`BodyVelocity`, `BodyGyro`, `BodyPosition`).
- Identifies unhandled DataStore calls missing `pcall` protection.
- Computes an overall software quality score (0–100) and actionable remediation steps.

---

### 11. `inspect_datamodel_tree`
Serializes the runtime DataModel hierarchy into structured JSON. Allows inspection of `CoreGui`, `Workspace`, `ReplicatedStorage`, or custom containers with class names, properties, and child counts.

---

### 12. `reset_session`
Performs complete sandbox cleanup:
- Wipes `getgenv()` mutations.
- Clears the Drawing cache and canvas instances.
- Flushes console logs.
- Resets the virtual DataModel to a pristine state.

---

### 13. `create_roblox_game`
Autonomously creates, scaffolds, and boots an entire playable Roblox experience from a structured specification or genre template.
- **Templates**: `"obby"`, `"sword_arena"`, `"tycoon"`, or `"custom"`.
- **Custom Maps**: Declaratively specify parts, positions, colors, sizes, materials (`Neon`, `Metal`, `Wood`, `Grass`, `Concrete`), and `Touched` scripts.
- **Tools & Weapons**: Add custom tools with handles, tooltips, and `Activated` scripts automatically placed in `StarterPack` and the local player's `Backpack`.
- **Scripts**: Ingest and run `serverScripts` in `ServerScriptService` and `clientScripts` in `StarterPlayerScripts`.
- **Player Spawning**: Spawns a full R6/R15 character model with `HumanoidRootPart`, `Torso`, `Head`, `Limbs`, and `Humanoid` (with automated death & respawn lifecycle).

#### Example Request:
```json
{
  "title": "Neon Tower Obby",
  "genre": "obby",
  "map": {
    "parts": [
      {
        "name": "SuperJumpPad",
        "size": [6, 1, 6],
        "position": [0, 1, -10],
        "color": "#00ffcc",
        "material": "Neon",
        "touchedScript": "hit.Parent.Humanoid.JumpPower = 100"
      }
    ]
  }
}
```

---

### 14. `interact_game_world`
Enables the AI agent to embody an interactive Roblox player avatar, move through the 3D space, interact with objects, and step the physical simulation.
- **Movement**: `move` / `targetPosition` `[x, y, z]`, `jump` (boolean), `sprint` (boolean), `duration` (stepping time).
- **Inventory & Combat**: `equipTool` (tool name or hotbar slot 1..9), `unequipTool` (boolean), `activateTool` (triggers tool activation / weapon raycast).
- **Proximity Prompts & Click Detectors**: `triggerPrompt` (triggers `ProximityPrompt.Triggered`), `clickObject` (clicks `ClickDetector`).
- **Chat**: Dispatches chat messages in `Players.LocalPlayer`'s chat log.
- **Visual Capture**: Set `captureScreenshot: true` to generate 1080p WebGL screenshots with CoreGui TopBar and HUD.

#### Example Request:
```json
{
  "type": "equipTool",
  "toolName": "ClassicSword"
}
```

---

### 15. `inspect_game_state`
Perceives the current state of the game world and player telemetry.
- **Player Telemetry**: Position `[x, y, z]`, Health/MaxHealth, WalkSpeed, isAlive status, equippedTool, full Backpack inventory, and `leaderstats` values.
- **Nearby Interactables**: Distance-sorted list of `ProximityPrompt`s, `ClickDetector`s, hazards, and interactive parts within 40 studs.
- **Recent Events**: Captures recent signal events (`Touched`, `Died`, `ToolEquipped`, `ToolActivated`, `PromptTriggered`, `DamageDealt`, `KillScored`).
- **Visual Sensory**: Optionally captures a 1080p screenshot of the scene.

---

## Automated Verification Suite

The repository includes a comprehensive end-to-end verification suite:

```bash
npm run test:verify
```

### Verified Test Results:
```
=======================================================
   RODEV-OMNI-ENTERPRISE END-TO-END VERIFICATION SUITE   
=======================================================

--> Running Test 1: sUNC Hookfunction & Closure Interception...
[VM Print]: HOOK TRIGGERED: intercepting base=10, mult=5
[VM Print]: FINAL DAMAGE RESULT: 1050
✔ [PASS] Test 1: Script executed without error
✔ [PASS] Test 1: Hook intercepted, altered execution, and chained to original
✔ [PASS] Test 1: Hook callback logged parameters to console

--> Running Test 2: Drawing API Vector Elements & Headless Canvas...
✔ [PASS] Test 2: Drawing script executed successfully
✔ [PASS] Test 2: Drawing objects registered in cache (Count: 3)
✔ [PASS] Test 2: Drawing Canvas PNG screenshot saved to disk
✔ [PASS] Test 2: Valid non-empty PNG buffer captured (27152 bytes)

--> Running Test 3: Complex UI Hub + Synthetic Input Diffing...
✔ [PASS] Test 3: UI script initialized instances in CoreGui
✔ [PASS] Test 3: Saved UI before interaction screenshot
✔ [PASS] Test 3: Saved UI after interaction screenshot
✔ [PASS] Test 3: Visual diffing detected state divergence (79.28% changed)

--> Running Test 4: 3D Part Simulation, Raycasting & Isometric Diagram...
[VM Print]: RAYCAST HIT INSTANCE: EnemyTarget at distance: 18.0
✔ [PASS] Test 4: 3D Workspace script executed successfully
✔ [PASS] Test 4: Raycast history recorded 2 queries
✔ [PASS] Test 4: Raycast 1 scored a direct hit on EnemyTarget
✔ [PASS] Test 4: Raycast 2 registered a clean miss
✔ [PASS] Test 4: 1920x1080 Split-screen 3D isometric diagram PNG saved
✔ [PASS] Test 4: High-resolution wireframe diagram captured

--> Running Test 5: Automated RemoteEvent Security Fuzzer...
✔ [PASS] Test 5: Server remote event handler registered
✔ [PASS] Test 5: Fuzzer discovered RemoteEvent
✔ [PASS] Test 5: Fuzzer executed all adversarial test vectors (Run: 8)
✔ [PASS] Test 5: Fuzzer identified unvalidated crash/negative integer flaw (6 crashes caught)
✔ [PASS] Test 5: Security recommendations generated for developer remediation

=======================================================
   ✔ ALL 5 ENTERPRISE VERIFICATION SUITES PASSED (100%)   
   Artifacts generated in test/artifacts/                  
=======================================================
```

---

## Installation & IDE Integration Guide

### 1. Build the Server
```bash
# Clone or navigate to the directory
cd rodev-omni-enterprise

# Install dependencies
npm install

# Compile TypeScript and bundle harness assets
npm run build
```

### 2. Configure MCP in Your IDE

Add the server entry to your MCP configuration file:

#### Antigravity IDE / Claude Desktop (`mcp_config.json`):
```json
{
  "mcpServers": {
    "rodev-omni-enterprise": {
      "command": "node",
      "args": [
        "<PATH_TO_RODEV_OMNI_ENTERPRISE>/dist/index.js"
      ]
    }
  }
}
```

#### Cursor (`settings.json` or MCP Settings):
```json
{
  "mcp.servers": {
    "rodev-omni-enterprise": {
      "command": "node",
      "args": ["<PATH_TO_RODEV_OMNI_ENTERPRISE>/dist/index.js"]
    }
  }
}
```

#### VS Code (Continue / Roo Code):
```json
{
  "servers": [
    {
      "name": "rodev-omni-enterprise",
      "command": "node",
      "args": ["<PATH_TO_RODEV_OMNI_ENTERPRISE>/dist/index.js"]
    }
  ]
}
```

---

## License

MIT License. Designed for elite Roblox exploit engineers, UI architects, Security Developers and autonomous coding agents.
