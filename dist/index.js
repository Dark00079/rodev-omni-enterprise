#!/usr/bin/env node
/**
 * RoDev-Omni-Enterprise MCP Server
 * Full-Fidelity Roblox Script Executor, 3D Spatial Simulator, Visual UI Diffing & Remote Security Fuzzer
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import { LuauPreprocessor } from './luau/preprocessor.js';
import { LuauStaticAnalyzer } from './luau/staticAnalyzer.js';
import { GlobalProfiler } from './runtime/profiler.js';
import { GuiDomTranslator } from './renderer/guiDomTranslator.js';
import { Workspace3dRenderer } from './renderer/workspace3dRenderer.js';
import { PlaywrightEngine } from './renderer/playwrightEngine.js';
import { HarnessRenderer } from './renderer/harnessRenderer.js';
import { Vector3 } from './runtime/datatypes.js';
import { InteractiveDashboard } from './server/interactiveDashboard.js';
import { GameWorldSimulator } from './runtime/gameWorldSimulator.js';
// Global shared sandbox session
const gameSimulator = GameWorldSimulator.getInstance();
let activeSandbox = gameSimulator.sandbox;
const server = new McpServer({
    name: "rodev-omni-enterprise",
    version: "1.0.0"
});
// 1. analyze_luau_script
server.tool("analyze_luau_script", "Performs static analysis and Roblox API deprecation checks on Luau source code.", {
    code: z.string().optional().describe("The Luau script code to analyze"),
    filePath: z.string().optional().describe("Optional path to .lua/.luau file on disk")
}, async ({ code, filePath }) => {
    let scriptCode = code ?? "";
    if (filePath && fs.existsSync(filePath)) {
        scriptCode = fs.readFileSync(filePath, 'utf8');
    }
    const analysis = LuauStaticAnalyzer.analyze(scriptCode);
    const preprocessed = LuauPreprocessor.transpile(scriptCode);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    summary: analysis.summary,
                    score: analysis.score,
                    passed: analysis.passed,
                    deprecationsCount: analysis.deprecationsCount,
                    warningsCount: analysis.warningsCount,
                    errorsCount: analysis.errorsCount,
                    issues: analysis.issues,
                    extractedTypes: preprocessed.extractedTypes
                }, null, 2)
            }
        ]
    };
});
// 2. render_and_diagnose_ui
server.tool("render_and_diagnose_ui", "Executes a UI script, translates GuiObjects to pixel-accurate HTML5/CSS3, and captures a PNG screenshot with layout diagnostics.", {
    code: z.string().optional().describe("Luau script creating ScreenGui and GuiObjects"),
    filePath: z.string().optional().describe("Optional path to a .lua/.luau script on disk"),
    devicePreset: z.enum(["desktop_1080p", "mobile_landscape", "tablet", "console_1080p"]).optional().describe("Target device screen preset"),
    outputPath: z.string().optional().describe("Optional absolute path to save the output PNG file"),
    clickTarget: z.string().optional().describe("Optional button name, text label, or path to click before capturing screenshot (e.g. 'Overall', 'Run', 'Settings')"),
    clickCoords: z.array(z.number()).length(2).optional().describe("Optional [x, y] coordinates to click"),
    interactionScript: z.string().optional().describe("Optional Luau code executed upon the GUI to mutate state before capturing screenshot"),
    actions: z.array(z.object({
        type: z.enum(["click", "drag", "type", "wait"]),
        target: z.string().optional().describe("Button name, text label, or path to click or type into"),
        coords: z.array(z.number()).length(2).optional().describe("[x, y] coordinates to click"),
        source: z.string().optional().describe("Button or element to start dragging from"),
        toCoords: z.array(z.number()).length(2).optional().describe("Target [x, y] coordinates to drop at"),
        toTarget: z.string().optional().describe("Target element name to drop onto"),
        placement: z.enum(["center", "bottom", "top", "inside"]).optional().describe("Drop placement relative to toTarget ('center', 'bottom', 'top', 'inside')"),
        attachTo: z.string().optional().describe("Convenience alias: target element to drop onto with bottom placement"),
        text: z.string().optional().describe("Text to type into input field"),
        duration: z.number().optional().describe("Seconds to wait/step engine")
    })).optional().describe("List of sequential actions (click, drag, type, wait) executed natively before capturing screenshot")
}, async ({ code, filePath, devicePreset, outputPath, clickTarget, clickCoords, interactionScript, actions }) => {
    const preset = devicePreset || "desktop_1080p";
    activeSandbox.reset();
    let scriptCode = code ?? "";
    if (filePath && fs.existsSync(filePath)) {
        scriptCode = fs.readFileSync(filePath, 'utf8');
    }
    // Attempt high-fidelity layout engine via HarnessRenderer first
    try {
        const harnessRes = await HarnessRenderer.render(scriptCode, {
            devicePreset: preset,
            outputPath,
            scriptPath: filePath,
            clickTarget,
            clickCoords: clickCoords,
            interactionScript,
            actions: actions
        });
        if (harnessRes.success && (harnessRes.rootsCount ?? 0) > 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            devicePreset: preset,
                            engine: "mock_roblox_harness",
                            savedTo: harnessRes.savedTo,
                            rootsCount: harnessRes.rootsCount,
                            diagnostics: harnessRes.diagnostics,
                            logs: harnessRes.logs,
                            imageSize: harnessRes.imageSize
                        }, null, 2)
                    }
                ]
            };
        }
    }
    catch {
        // Fallback to DOM Playwright pipeline
    }
    const execResult = activeSandbox.execute(scriptCode);
    if (!execResult.success) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: false, error: execResult.error, logs: execResult.logs }, null, 2)
                }
            ]
        };
    }
    // Collect root UI instances from CoreGui and PlayerGui
    const rootUIs = [
        ...activeSandbox.game.CoreGui.GetChildren(),
        ...activeSandbox.game.Players.LocalPlayer.GetChildren()
    ];
    const drawings = Array.from(activeSandbox.drawings.values());
    const html = GuiDomTranslator.translateToHtml(rootUIs, drawings, preset);
    const renderResult = await PlaywrightEngine.renderAndDiagnose(html, preset, outputPath);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    success: true,
                    devicePreset: preset,
                    savedTo: renderResult.outputPath ?? "base64_only",
                    diagnostics: renderResult.diagnostics,
                    logs: execResult.logs,
                    base64Length: renderResult.base64Png.length
                }, null, 2)
            }
        ]
    };
});
// 3. interact_and_diff_ui
server.tool("interact_and_diff_ui", "Dispatches synthetic input actions (click, drag, type) to rendered UI and computes visual pixel diff.", {
    initialCode: z.string().describe("Luau script generating initial UI"),
    action: z.object({
        type: z.enum(["click", "drag", "type"]),
        targetPath: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        toX: z.number().optional(),
        toY: z.number().optional(),
        text: z.string().optional()
    }),
    interactionScript: z.string().optional().describe("Optional Luau script executed upon interaction to mutate UI state"),
    devicePreset: z.enum(["desktop_1080p", "mobile_landscape", "tablet", "console_1080p"]).optional(),
    outBeforePath: z.string().optional(),
    outAfterPath: z.string().optional()
}, async ({ initialCode, action, interactionScript, devicePreset, outBeforePath, outAfterPath }) => {
    const preset = devicePreset || "desktop_1080p";
    activeSandbox.reset();
    activeSandbox.execute(initialCode);
    let rootUIs = [
        ...activeSandbox.game.CoreGui.GetChildren(),
        ...activeSandbox.game.Players.LocalPlayer.GetChildren()
    ];
    let drawings = Array.from(activeSandbox.drawings.values());
    const initialHtml = GuiDomTranslator.translateToHtml(rootUIs, drawings, preset);
    if (interactionScript) {
        activeSandbox.execute(interactionScript);
    }
    rootUIs = [
        ...activeSandbox.game.CoreGui.GetChildren(),
        ...activeSandbox.game.Players.LocalPlayer.GetChildren()
    ];
    drawings = Array.from(activeSandbox.drawings.values());
    const updatedHtml = GuiDomTranslator.translateToHtml(rootUIs, drawings, preset);
    const diffResult = await PlaywrightEngine.interactAndDiff(initialHtml, action, updatedHtml, preset, outBeforePath, outAfterPath);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    success: true,
                    diffReport: diffResult.diffReport,
                    pixelDifferencePercent: diffResult.pixelDifference,
                    beforeSaved: outBeforePath ?? "base64",
                    afterSaved: outAfterPath ?? "base64"
                }, null, 2)
            }
        ]
    };
});
// 4. run_sunc_executor_test
server.tool("run_sunc_executor_test", "Executes user script against the full sUNC closure hooking, metamethods, and Drawing API test suite.", {
    script: z.string().optional().describe("Luau script testing sUNC/UNC capabilities"),
    filePath: z.string().optional().describe("Optional path to .lua/.luau file on disk")
}, async ({ script, filePath }) => {
    let scriptCode = script ?? "";
    if (filePath && fs.existsSync(filePath)) {
        scriptCode = fs.readFileSync(filePath, 'utf8');
    }
    const execResult = activeSandbox.execute(scriptCode);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    success: execResult.success,
                    result: execResult.result,
                    error: execResult.error,
                    logs: execResult.logs,
                    drawingsCreated: activeSandbox.drawings.size,
                    lastHookIntercepted: activeSandbox.lastHookTarget !== null
                }, null, 2)
            }
        ]
    };
});
// 5. simulate_3d_workspace
server.tool("simulate_3d_workspace", "Simulates Roblox 3D Workspace world, environment, Baseplate templates, player avatar, humanoid movement, and Raycasts, rendering a high-resolution 1920x1080 3D perspective screenshot from any viewpoint (first-person, third-person, overhead, custom, or isometric).", {
    script: z.string().optional().describe("Optional Luau script creating Workspace parts, moving players, and performing Raycasts"),
    template: z.enum(["baseplate", "obstacles", "empty"]).optional().describe("World environment template (default: 'baseplate')"),
    spawnPlayer: z.boolean().optional().describe("Whether to spawn a standard Roblox character avatar (default: true)"),
    playerRig: z.enum(["R6", "R15"]).optional().describe("Avatar rig type (default: 'R6')"),
    playerMovement: z.object({
        moveTo: z.array(z.number()).length(3).optional().describe("Target [x, y, z] destination to move player towards"),
        jump: z.boolean().optional().describe("Whether character is in a jump state"),
        speed: z.number().optional().describe("WalkSpeed override (default: 16)")
    }).optional().describe("Player movement simulation controls"),
    cameraMode: z.enum(["third_person", "first_person", "overhead", "isometric", "custom"]).optional().describe("Camera perspective mode (default: 'third_person')"),
    cameraPosition: z.array(z.number()).length(3).optional().describe("Custom camera eye [x, y, z] coordinates"),
    cameraLookAt: z.array(z.number()).length(3).optional().describe("Custom camera target [x, y, z] coordinates to point at"),
    simulationDuration: z.number().optional().describe("Simulation time in seconds to step character physics and animations (default: 0.5)"),
    outputPath: z.string().optional().describe("Optional path to save the 1920x1080 screenshot PNG"),
    launchDashboard: z.boolean().optional().describe("Whether to host the interactive 60 FPS viewer at http://localhost:4050 and open in browser (default: false)"),
    dashboardPort: z.number().optional().describe("Port for interactive dashboard (default: 4050)")
}, async ({ script, template = "baseplate", spawnPlayer = true, playerRig = "R6", playerMovement, cameraMode = "third_person", cameraPosition, cameraLookAt, simulationDuration = 0.5, outputPath, launchDashboard = false, dashboardPort = 4050 }) => {
    activeSandbox.reset();
    // 1. Populate Environment Template
    Workspace3dRenderer.populateTemplate(activeSandbox.game.Workspace, template);
    // 2. Spawn Player Character if requested
    let playerModel = null;
    let walkCycle = 0;
    if (spawnPlayer) {
        playerModel = activeSandbox.game.Players.LocalPlayer.spawnMockCharacter(playerRig, new Vector3(0, 3, 0));
        playerModel.Parent = activeSandbox.game.Workspace;
    }
    // 3. Execute custom Luau script if provided
    let logs = [];
    if (script && script.trim().length > 0) {
        const execResult = activeSandbox.execute(script);
        if (!execResult.success) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ success: false, error: execResult.error, logs: execResult.logs }, null, 2)
                    }
                ]
            };
        }
        logs = execResult.logs;
    }
    // 4. Step Player Movement & Animation simulation
    if (playerModel) {
        walkCycle = Workspace3dRenderer.stepPlayerMovement(playerModel, playerMovement, simulationDuration);
    }
    // 5. Generate 3D HTML Scene & Capture Screenshot
    const renderOptions = {
        cameraMode,
        cameraPosition: cameraPosition,
        cameraLookAt: cameraLookAt,
        lighting: activeSandbox.game.Lighting,
        playerModel,
        walkCycle,
        template
    };
    const html = Workspace3dRenderer.generateHtml(activeSandbox.game.Workspace, renderOptions);
    const renderRes = await PlaywrightEngine.renderAndDiagnose(html, "desktop_1080p", outputPath);
    let dashboardInfo = null;
    if (launchDashboard) {
        dashboardInfo = await InteractiveDashboard.start(dashboardPort, activeSandbox.game.Workspace, renderOptions, true, activeSandbox);
    }
    const parts = activeSandbox.game.Workspace.GetDescendants().filter(d => d.IsA("BasePart"));
    const raycasts = activeSandbox.game.Workspace.raycastHistory;
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    success: true,
                    cameraMode,
                    template,
                    playerSpawned: !!playerModel,
                    playerRig: playerModel ? playerRig : null,
                    partsCount: parts.length,
                    raycastsCount: raycasts.length,
                    hitsCount: raycasts.filter(r => r.hit).length,
                    savedTo: renderRes.outputPath ?? "base64",
                    dashboard: dashboardInfo,
                    logs,
                    base64Length: renderRes.base64Png.length
                }, null, 2)
            }
        ]
    };
});
// 6. launch_interactive_dashboard
server.tool("launch_interactive_dashboard", "Starts a local interactive 3D Web Dashboard on http://localhost:4050 allowing live 60 FPS WASD movement, jumping, mouse-orbit camera, raycasts, and custom Luau execution in your web browser.", {
    template: z.enum(["baseplate", "obstacles", "empty"]).optional().describe("World environment template (default: 'baseplate')"),
    spawnPlayer: z.boolean().optional().describe("Whether to spawn a standard Roblox character avatar (default: true)"),
    playerRig: z.enum(["R6", "R15"]).optional().describe("Avatar rig type (default: 'R6')"),
    script: z.string().optional().describe("Optional Luau script executed into the workspace before launching"),
    port: z.number().optional().describe("Local port to host on (default: 4050)"),
    autoOpen: z.boolean().optional().describe("Whether to automatically open your default browser (default: true)")
}, async ({ template = "baseplate", spawnPlayer = true, playerRig = "R6", script, port = 4050, autoOpen = true }) => {
    activeSandbox.reset();
    Workspace3dRenderer.populateTemplate(activeSandbox.game.Workspace, template);
    let playerModel = null;
    if (spawnPlayer) {
        playerModel = activeSandbox.game.Players.LocalPlayer.spawnMockCharacter(playerRig, new Vector3(0, 3, 0));
        playerModel.Parent = activeSandbox.game.Workspace;
    }
    let logs = [];
    if (script && script.trim().length > 0) {
        const execResult = activeSandbox.execute(script);
        if (!execResult.success) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ success: false, error: execResult.error, logs: execResult.logs }, null, 2)
                    }
                ]
            };
        }
        logs = execResult.logs;
    }
    const dashboard = await InteractiveDashboard.start(port, activeSandbox.game.Workspace, {
        cameraMode: "third_person",
        lighting: activeSandbox.game.Lighting,
        playerModel,
        walkCycle: 0,
        template
    }, autoOpen, activeSandbox);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    success: true,
                    message: `Interactive 3D Dashboard running at ${dashboard.url}`,
                    url: dashboard.url,
                    port: dashboard.port,
                    template,
                    playerSpawned: !!playerModel,
                    playerRig: playerModel ? playerRig : null,
                    logs
                }, null, 2)
            }
        ]
    };
});
// 7. stop_interactive_dashboard
server.tool("stop_interactive_dashboard", "Stops the local interactive 3D Web Dashboard server.", {}, async () => {
    const isRunning = InteractiveDashboard.isRunning();
    await InteractiveDashboard.stop();
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    success: true,
                    wasRunning: isRunning,
                    message: isRunning ? "Interactive dashboard server stopped." : "Interactive dashboard was not running."
                }, null, 2)
            }
        ]
    };
});
// 8. test_client_server_remotes
server.tool("test_client_server_remotes", "Runs server script and executes an automated security fuzzing battery against registered RemoteEvents and RemoteFunctions.", {
    serverScript: z.string().describe("Luau script defining RemoteEvent/RemoteFunction OnServerEvent handlers"),
    fuzzAdversarial: z.boolean().optional().describe("Whether to run the adversarial battery (NaN, negatives, path traversal)")
}, async ({ serverScript, fuzzAdversarial = true }) => {
    activeSandbox.reset();
    const execResult = activeSandbox.execute(serverScript);
    if (!execResult.success) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: false, error: execResult.error, logs: execResult.logs }, null, 2)
                }
            ]
        };
    }
    const fuzzReports = fuzzAdversarial ? activeSandbox.fuzzRemoteEvents() : [];
    const totalCrashes = fuzzReports.reduce((acc, r) => acc + r.crashesCount, 0);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    success: true,
                    remotesDiscovered: fuzzReports.length,
                    totalCrashesDetected: totalCrashes,
                    securityVulnerable: totalCrashes > 0,
                    reports: fuzzReports,
                    logs: execResult.logs
                }, null, 2)
            }
        ]
    };
});
// 9. profile_memory_and_leaks
server.tool("profile_memory_and_leaks", "Profiles signal connections and instance allocations, detecting memory leaks between setup and cleanup.", {
    setupScript: z.string().describe("Script that connects signals or creates UI/entities"),
    cleanupScript: z.string().describe("Script that attempts to tear down and cleanup")
}, async ({ setupScript, cleanupScript }) => {
    activeSandbox.reset();
    GlobalProfiler.takeSnapshot("baseline");
    activeSandbox.execute(setupScript);
    GlobalProfiler.takeSnapshot("after_setup");
    activeSandbox.execute(cleanupScript);
    GlobalProfiler.takeSnapshot("after_cleanup");
    const diff = GlobalProfiler.diffSnapshots("baseline", "after_cleanup");
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(diff, null, 2)
            }
        ]
    };
});
// 10. test_datastore_and_persistence
server.tool("test_datastore_and_persistence", "Tests DataStore operations with optional fault injection (timeouts, rate limits, corruption).", {
    script: z.string().describe("Luau script interacting with DataStoreService"),
    faultMode: z.enum(["none", "timeout", "throttle_429", "corrupt"]).optional()
}, async ({ script, faultMode = "none" }) => {
    activeSandbox.reset();
    activeSandbox.game.DataStoreService.setFaultMode(faultMode);
    const execResult = activeSandbox.execute(script);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    success: execResult.success,
                    faultModeApplied: faultMode,
                    error: execResult.error,
                    logs: execResult.logs
                }, null, 2)
            }
        ]
    };
});
// 11. inspect_datamodel_tree
server.tool("inspect_datamodel_tree", "Inspects and returns a hierarchical JSON representation of any DataModel Service or container.", {
    rootService: z.string().optional().describe("Service name to inspect (e.g. Workspace, CoreGui, ReplicatedStorage)"),
    maxDepth: z.number().optional().describe("Maximum traversal depth")
}, async ({ rootService = "Workspace", maxDepth = 4 }) => {
    const root = activeSandbox.game.GetService(rootService);
    const dumpTree = (inst, depth) => {
        if (depth > maxDepth)
            return { name: inst.Name, className: inst.ClassName, truncated: true };
        return {
            name: inst.Name,
            className: inst.ClassName,
            childrenCount: inst.GetChildren().length,
            children: inst.GetChildren().map((c) => dumpTree(c, depth + 1))
        };
    };
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(dumpTree(root, 1), null, 2)
            }
        ]
    };
});
// 12. reset_session
server.tool("reset_session", "Cleans getgenv(), Drawing objects, VFS buffers, and resets the active sandbox DataModel.", {
    clearVfs: z.boolean().optional().describe("Whether to delete workspace_vfs directory contents")
}, async ({ clearVfs = false }) => {
    activeSandbox.reset();
    if (clearVfs && fs.existsSync(activeSandbox.vfsDir)) {
        fs.rmSync(activeSandbox.vfsDir, { recursive: true, force: true });
        fs.mkdirSync(activeSandbox.vfsDir, { recursive: true });
    }
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ success: true, message: "Sandbox session reset cleanly." }, null, 2)
            }
        ]
    };
});
// 13. create_roblox_game
server.tool("create_roblox_game", "Scaffolds and simulates a complete, fully-playable Roblox game with physics, scripts, avatar, tools, and UI.", {
    title: z.string().describe("Title of the Roblox game experience"),
    genre: z.enum(["obby", "sword_arena", "tycoon", "custom"]).default("obby").describe("Pre-built genre template or custom game"),
    description: z.string().optional().describe("Description of the gameplay mechanics"),
    serverScript: z.string().optional().describe("Custom server-side Luau script"),
    clientScript: z.string().optional().describe("Custom client-side Luau script"),
    customParts: z.array(z.object({
        name: z.string(),
        className: z.string().optional(),
        size: z.tuple([z.number(), z.number(), z.number()]).optional(),
        position: z.tuple([z.number(), z.number(), z.number()]).optional(),
        color: z.string().optional(),
        material: z.string().optional(),
        transparency: z.number().optional(),
        anchored: z.boolean().optional(),
        canCollide: z.boolean().optional(),
        canTouch: z.boolean().optional(),
        touchedScript: z.string().optional()
    })).optional().describe("Additional parts to spawn in Workspace"),
    tools: z.array(z.object({
        name: z.string(),
        tooltip: z.string().optional(),
        handleSize: z.tuple([z.number(), z.number(), z.number()]).optional(),
        handleColor: z.string().optional(),
        onActivatedScript: z.string().optional()
    })).optional().describe("Tools to place in StarterPack/Backpack"),
    launchViewer: z.boolean().optional().default(false).describe("Whether to launch the live interactive web viewer"),
    viewerPort: z.number().optional().default(4050).describe("Local port for web viewer")
}, async ({ title, genre, description, serverScript, clientScript, customParts, tools, launchViewer, viewerPort }) => {
    const simulator = GameWorldSimulator.getInstance();
    activeSandbox = simulator.sandbox;
    const gameSpec = {
        title,
        genre,
        description,
        serverScripts: serverScript ? [{ name: "MainServerScript", code: serverScript }] : [],
        clientScripts: clientScript ? [{ name: "MainClientScript", code: clientScript }] : [],
        tools: tools ?? [],
        map: {
            parts: customParts ?? []
        }
    };
    const result = await simulator.createGame(gameSpec);
    let dashboardInfo = null;
    if (launchViewer) {
        dashboardInfo = await InteractiveDashboard.start(viewerPort, simulator.sandbox.game.Workspace, {
            playerName: "Player1",
            experienceTitle: title,
            leaderstats: result.sensoryObservation.player.leaderstats,
            backpackTools: result.sensoryObservation.player.backpack,
            equippedTool: result.sensoryObservation.player.equippedTool,
            health: result.sensoryObservation.player.health,
            maxHealth: result.sensoryObservation.player.maxHealth
        }, true, simulator.sandbox);
    }
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    ...result,
                    dashboard: dashboardInfo
                }, null, 2)
            }
        ]
    };
});
// 14. interact_game_world
server.tool("interact_game_world", "Performs embodied player actions in the simulated Roblox world (walk, jump, attack, equip tool, proximity prompt, chat, screenshot).", {
    type: z.enum([
        "move",
        "jump",
        "sprint",
        "equipTool",
        "unequipTool",
        "activateTool",
        "triggerPrompt",
        "clickObject",
        "chat",
        "captureScreenshot"
    ]).describe("Type of player interaction to perform"),
    direction: z.tuple([z.number(), z.number(), z.number()]).optional().describe("Movement direction vector [X, Y, Z]"),
    targetPosition: z.tuple([z.number(), z.number(), z.number()]).optional().describe("Absolute world target position to walk toward"),
    toolName: z.string().optional().describe("Name of the tool to equip or activate"),
    promptObject: z.string().optional().describe("Name of ProximityPrompt or parent Part to trigger"),
    clickTarget: z.string().optional().describe("Name of Part with ClickDetector to click"),
    message: z.string().optional().describe("Chat message text"),
    duration: z.number().optional().default(0.5).describe("Action simulation duration in seconds"),
    cameraMode: z.enum(["third_person", "first_person", "overhead", "custom"]).optional().default("third_person").describe("Camera mode for observation/screenshot"),
    outputPath: z.string().optional().describe("File path to save PNG screenshot (e.g. ./screenshot.png)"),
    captureScreenshot: z.boolean().optional().default(false).describe("Whether to render and return a full 3D visual screenshot of the action outcome")
}, async (action) => {
    const simulator = GameWorldSimulator.getInstance();
    const result = await simulator.interact(action);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(result, null, 2)
            }
        ]
    };
});
// 15. inspect_game_state
server.tool("inspect_game_state", "Inspects comprehensive real-time game world state, player sensory observation, leaderstats, inventory, and nearby interactables.", {
    detail: z.enum(["overview", "inventory", "leaderboard", "nearby", "datamodel"]).optional().default("overview").describe("Level of detail to query"),
    captureScreenshot: z.boolean().optional().default(false).describe("Whether to capture and attach a 3D visual snapshot"),
    cameraMode: z.enum(["third_person", "first_person", "overhead"]).optional().default("third_person").describe("Camera view angle for visual capture"),
    outputPath: z.string().optional().describe("Optional output path for screenshot PNG")
}, async ({ detail, captureScreenshot, cameraMode, outputPath }) => {
    const simulator = GameWorldSimulator.getInstance();
    const obs = await simulator.getSensoryObservation({
        captureScreenshot,
        cameraMode,
        outputPath
    });
    let filteredData = obs;
    if (detail === "inventory") {
        filteredData = {
            equippedTool: obs.player.equippedTool,
            backpack: obs.player.backpack,
            walkSpeed: obs.player.walkSpeed
        };
    }
    else if (detail === "leaderboard") {
        filteredData = {
            leaderstats: obs.player.leaderstats,
            health: obs.player.health,
            isAlive: obs.player.isAlive
        };
    }
    else if (detail === "nearby") {
        filteredData = {
            nearbyInteractables: obs.nearbyInteractables,
            playerPosition: obs.player.position
        };
    }
    else if (detail === "datamodel") {
        filteredData = {
            partsCount: simulator.sandbox.game.Workspace.GetDescendants().filter(d => d.IsA("BasePart")).length,
            instancesCount: simulator.sandbox.game.Workspace.GetDescendants().length,
            raycastsCount: simulator.sandbox.game.Workspace.raycastHistory.length,
            player: obs.player,
            events: obs.recentEvents
        };
    }
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(filteredData, null, 2)
            }
        ]
    };
});
// Server startup
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("RoDev-Omni-Enterprise MCP Server running on stdio");
}
if (process.env.NODE_ENV !== "test") {
    main().catch((err) => {
        console.error("Fatal MCP Server Error:", err);
        process.exit(1);
    });
}
