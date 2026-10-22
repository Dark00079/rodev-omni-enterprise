/**
 * Full-Fidelity Roblox 3D Workspace, Environment & Avatar Visualizer
 * Implements hardware/software WebGL 3D perspective rendering, Roblox Baseplate templates,
 * fully-articulated R6/R15 player avatars with smiley face decals, procedural walking animations,
 * dynamic Lighting/Atmosphere, and multi-perspective cameras (first-person, third-person, overhead, custom).
 * Supports both headless single-frame snapshot and live 60 FPS interactive WASD/mouse dashboard.
 */
import { InstanceEngine } from '../runtime/instanceEngine.js';
import { Vector3, CFrame, Color3 } from '../runtime/datatypes.js';
export class Workspace3dRenderer {
    /**
     * Applies built-in environment templates to the Workspace
     */
    static populateTemplate(workspace, template = "baseplate") {
        if (template === "empty")
            return;
        // Check if Baseplate already exists
        const existingBase = workspace.FindFirstChild("Baseplate");
        if (!existingBase) {
            const baseplate = InstanceEngine.new("Part", workspace);
            baseplate.Name = "Baseplate";
            baseplate.Size = new Vector3(512, 1, 512);
            baseplate.Position = new Vector3(0, -0.5, 0);
            baseplate.Color = Color3.fromRGB(99, 95, 98); // Classic Roblox Dark stone grey
            baseplate.Anchored = true;
            baseplate.CanCollide = true;
        }
        const existingSpawn = workspace.FindFirstChild("SpawnLocation");
        if (!existingSpawn) {
            const spawn = InstanceEngine.new("SpawnLocation", workspace);
            spawn.Name = "SpawnLocation";
            spawn.Size = new Vector3(12, 1, 12);
            spawn.Position = new Vector3(0, 0.5, 0);
            spawn.Color = Color3.fromRGB(163, 162, 165); // Medium stone grey
            spawn.Anchored = true;
            spawn.CanCollide = true;
        }
        if (template === "obstacles") {
            const p1 = InstanceEngine.new("Part", workspace);
            p1.Name = "Platform_Orange";
            p1.Size = new Vector3(8, 1, 8);
            p1.Position = new Vector3(0, 3, -16);
            p1.Color = Color3.fromRGB(255, 102, 0);
            p1.Anchored = true;
            const p2 = InstanceEngine.new("Part", workspace);
            p2.Name = "Platform_Cyan";
            p2.Size = new Vector3(8, 1, 8);
            p2.Position = new Vector3(10, 6, -26);
            p2.Color = Color3.fromRGB(0, 180, 255);
            p2.Anchored = true;
            const p3 = InstanceEngine.new("Part", workspace);
            p3.Name = "Platform_Green";
            p3.Size = new Vector3(10, 1, 10);
            p3.Position = new Vector3(0, 9, -38);
            p3.Color = Color3.fromRGB(50, 220, 100);
            p3.Anchored = true;
            const ramp = InstanceEngine.new("WedgePart", workspace);
            ramp.Name = "Ramp";
            ramp.Size = new Vector3(6, 4, 14);
            ramp.Position = new Vector3(-12, 2, -10);
            ramp.Color = Color3.fromRGB(180, 180, 190);
            ramp.Anchored = true;
            const pillar = InstanceEngine.new("Part", workspace);
            pillar.Name = "Pillar_Gold";
            pillar.Size = new Vector3(3, 16, 3);
            pillar.Position = new Vector3(16, 8, -12);
            pillar.Color = Color3.fromRGB(240, 200, 40);
            pillar.Anchored = true;
        }
    }
    /**
     * Simulates player movement towards target, returns walkCycle radians for animation
     */
    static stepPlayerMovement(playerModel, movement, duration = 0.5) {
        const hrp = playerModel.PrimaryPart || playerModel.FindFirstChild("HumanoidRootPart");
        if (!hrp)
            return 0;
        const speed = movement?.speed ?? 16;
        let walkCycle = 0;
        if (movement?.moveTo) {
            const target = new Vector3(movement.moveTo[0], movement.moveTo[1], movement.moveTo[2]);
            const currentPos = hrp.Position;
            const delta = target.sub(currentPos);
            const fullDist = delta.Magnitude;
            if (fullDist > 0.05) {
                const moveDist = Math.min(fullDist, speed * duration);
                const dir = delta.Unit;
                const newPos = currentPos.add(dir.mul(moveDist));
                const hDist = Math.sqrt(delta.X * delta.X + delta.Z * delta.Z);
                if (hDist > 0.01) {
                    const hDir = new Vector3(delta.X / hDist, 0, delta.Z / hDist);
                    const lookAtTarget = newPos.add(hDir.mul(5));
                    const newCFrame = CFrame.lookAt(newPos, lookAtTarget);
                    playerModel.PivotTo(newCFrame);
                }
                else {
                    playerModel.PivotTo(new CFrame(newPos.X, newPos.Y, newPos.Z, hrp.CFrame.R00, hrp.CFrame.R01, hrp.CFrame.R02, hrp.CFrame.R10, hrp.CFrame.R11, hrp.CFrame.R12, hrp.CFrame.R20, hrp.CFrame.R21, hrp.CFrame.R22));
                }
                walkCycle = (moveDist * 1.5) % (Math.PI * 2);
            }
        }
        if (movement?.jump) {
            const currentPos = hrp.Position;
            hrp.Position = new Vector3(currentPos.X, currentPos.Y + 3.5, currentPos.Z);
        }
        return walkCycle;
    }
    /**
     * Generates self-contained HTML5 WebGL / Canvas scene capturing 3D perspective
     */
    static generateHtml(workspace, options = {}) {
        const cameraMode = options.cameraMode || "third_person";
        const walkCycle = options.walkCycle ?? 0;
        const showHud = options.showHud ?? true;
        const isInteractive = options.interactive ?? false;
        // Collect all BaseParts
        const allParts = workspace.GetDescendants().filter(d => d.IsA("BasePart"));
        const raycasts = workspace.raycastHistory;
        // Detect Player character if present
        const playerModel = options.playerModel;
        let playerHeadPos = null;
        let playerHrpPos = [0, 3, 0];
        let playerLookVector = [0, 0, -1];
        if (playerModel) {
            const hrp = (playerModel.PrimaryPart || playerModel.FindFirstChild("HumanoidRootPart"));
            if (hrp) {
                playerHrpPos = [hrp.Position.X, hrp.Position.Y, hrp.Position.Z];
                playerLookVector = [hrp.CFrame.LookVector.X, hrp.CFrame.LookVector.Y, hrp.CFrame.LookVector.Z];
            }
            const head = playerModel.FindFirstChild("Head");
            if (head) {
                playerHeadPos = [head.Position.X, head.Position.Y, head.Position.Z];
            }
        }
        // Default Camera Matrices based on cameraMode
        let eye = [0, 10, 20];
        let lookTarget = [0, 2, 0];
        const fov = workspace.CurrentCamera ? workspace.CurrentCamera.FieldOfView : 70;
        if (cameraMode === "first_person") {
            if (playerHeadPos) {
                eye = [
                    playerHeadPos[0] + playerLookVector[0] * 0.25,
                    playerHeadPos[1],
                    playerHeadPos[2] + playerLookVector[2] * 0.25
                ];
                lookTarget = [
                    eye[0] + playerLookVector[0] * 30,
                    eye[1] + playerLookVector[1] * 30,
                    eye[2] + playerLookVector[2] * 30
                ];
            }
            else {
                eye = [0, 4.5, 0];
                lookTarget = [0, 4.5, -30];
            }
        }
        else if (cameraMode === "third_person") {
            eye = [
                playerHrpPos[0] - playerLookVector[0] * 12,
                playerHrpPos[1] + 4.5,
                playerHrpPos[2] - playerLookVector[2] * 12
            ];
            lookTarget = [playerHrpPos[0], playerHrpPos[1] + 1.2, playerHrpPos[2]];
        }
        else if (cameraMode === "overhead") {
            eye = [playerHrpPos[0], playerHrpPos[1] + 48, playerHrpPos[2] + 36];
            lookTarget = [playerHrpPos[0], playerHrpPos[1], playerHrpPos[2]];
        }
        else if (cameraMode === "custom") {
            if (options.cameraPosition)
                eye = options.cameraPosition;
            if (options.cameraLookAt)
                lookTarget = options.cameraLookAt;
        }
        // Serialized scene parts
        const partsData = allParts.map(p => {
            const isPlayerPart = playerModel ? p.IsDescendantOf(playerModel) : false;
            const isHead = p.Name === "Head" && isPlayerPart;
            const isLeftArm = p.Name === "Left Arm" && isPlayerPart;
            const isRightArm = p.Name === "Right Arm" && isPlayerPart;
            const isLeftLeg = p.Name === "Left Leg" && isPlayerPart;
            const isRightLeg = p.Name === "Right Leg" && isPlayerPart;
            const isNeon = (p.Material === "Neon" || (p.Name && p.Name.toLowerCase().includes("laser")) || (p.Name && p.Name.toLowerCase().includes("neon")));
            return {
                name: p.Name,
                className: p.ClassName,
                position: [p.Position.X, p.Position.Y, p.Position.Z],
                size: [p.Size.X, p.Size.Y, p.Size.Z],
                cframe: [
                    p.CFrame.R00, p.CFrame.R01, p.CFrame.R02, 0,
                    p.CFrame.R10, p.CFrame.R11, p.CFrame.R12, 0,
                    p.CFrame.R20, p.CFrame.R21, p.CFrame.R22, 0,
                    p.Position.X, p.Position.Y, p.Position.Z, 1
                ],
                color: p.Color ? p.Color.toHex() : "a3a2a5",
                transparency: p.Transparency || 0,
                anchored: p.Anchored,
                isBaseplate: p.Name === "Baseplate",
                isSpawn: p.Name === "SpawnLocation",
                isHead,
                isLeftArm,
                isRightArm,
                isLeftLeg,
                isRightLeg,
                material: p.Material || "Plastic",
                isNeon
            };
        });
        const raycastsData = raycasts.map(r => ({
            origin: [r.origin.X, r.origin.Y, r.origin.Z],
            direction: [r.direction.X, r.direction.Y, r.direction.Z],
            hit: r.hit,
            hitPosition: r.result ? [r.result.Position.X, r.result.Position.Y, r.result.Position.Z] : null,
            hitPartName: r.result?.Instance?.Name ?? null,
            distance: r.result?.Distance ?? null
        }));
        const health = options.health ?? 100;
        const maxHealth = options.maxHealth ?? 100;
        const playerName = options.playerName || "Player1";
        const experienceTitle = options.experienceTitle || "Roblox Experience";
        const backpackTools = options.backpackTools || [];
        const equippedTool = options.equippedTool || null;
        const leaderstats = options.leaderstats || {};
        const sunDir = options.lighting ? [
            options.lighting.SunDirection.X,
            options.lighting.SunDirection.Y,
            options.lighting.SunDirection.Z
        ] : [0.577, 0.707, 0.408];
        const guiOverlayBase64 = options.guiOverlayBase64 || "";
        // Build self-contained HTML
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Roblox 3D Spatial Visualizer - Live Interactive</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: ${isInteractive ? "100vw" : "1920px"};
      height: ${isInteractive ? "100vh" : "1080px"};
      background: #000;
      color: #e1e4ea;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Consolas", monospace;
      overflow: hidden;
      position: relative;
      user-select: none;
    }
    #viewport-canvas {
      width: 100%;
      height: 100%;
      display: block;
    }

    /* Official Roblox CoreGui TopBar */
    #roblox-topbar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 36px;
      background: rgba(31, 31, 31, 0.90);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      z-index: 600;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .topbar-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .roblox-logo {
      display: flex;
      align-items: center;
      cursor: pointer;
    }
    .topbar-icon-btn {
      background: transparent;
      border: none;
      color: #d0d5dd;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .topbar-icon-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
    }
    .experience-title {
      font-size: 13px;
      font-weight: 600;
      color: #ffffff;
      opacity: 0.92;
      letter-spacing: 0.3px;
    }
    .topbar-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .health-container {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .health-bar-bg {
      width: 110px;
      height: 8px;
      background: rgba(45, 48, 55, 0.85);
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .health-bar-fill {
      height: 100%;
      transition: width 0.2s ease, background-color 0.2s ease;
      box-shadow: 0 0 6px rgba(0, 230, 118, 0.5);
    }

    /* Official Roblox Backpack Hotbar */
    #roblox-backpack {
      position: absolute;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 8px;
      z-index: 550;
      pointer-events: auto;
    }
    .backpack-slot {
      width: 58px;
      height: 58px;
      background: rgba(24, 26, 32, 0.88);
      border: 1.5px solid rgba(255, 255, 255, 0.14);
      border-radius: 8px;
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(10px);
      box-shadow: 0 6px 20px rgba(0,0,0,0.5);
      cursor: pointer;
      transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .backpack-slot:hover {
      border-color: rgba(255, 255, 255, 0.35);
      transform: translateY(-2px);
    }
    .backpack-slot.active {
      border-color: #5a8ee9;
      background: rgba(30, 44, 72, 0.94);
      box-shadow: 0 0 16px rgba(90, 142, 233, 0.6);
      transform: translateY(-3px);
    }
    .slot-key {
      position: absolute;
      top: 3px;
      left: 6px;
      font-size: 10px;
      font-weight: 700;
      color: #98a2b3;
    }
    .slot-icon {
      font-size: 18px;
      margin-top: 4px;
    }
    .slot-name {
      font-size: 9px;
      font-weight: 600;
      color: #ffffff;
      text-align: center;
      max-width: 52px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 2px;
    }

    /* Official Roblox Playerlist / Leaderboard */
    #roblox-leaderboard {
      position: absolute;
      top: 44px;
      right: 16px;
      min-width: 220px;
      background: rgba(22, 24, 30, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      z-index: 500;
      overflow: hidden;
      font-size: 12px;
    }
    .leaderboard-header {
      display: flex;
      justify-content: space-between;
      padding: 8px 12px;
      background: rgba(0, 0, 0, 0.3);
      font-size: 11px;
      font-weight: 700;
      color: #8c96ac;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .leaderboard-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      font-weight: 600;
      color: #ffffff;
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    }
    .player-info {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .player-avatar-badge {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #00e676;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 800;
      color: #000;
    }
    .stat-value {
      color: #00ffaa;
      font-weight: 700;
    }

    /* Damage Vignette */
    #damage-vignette {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 400;
      transition: opacity 0.3s ease;
      box-shadow: inset 0 0 100px rgba(255, 30, 30, 0.7);
    }

    #hud-overlay {
      position: absolute;
      top: 44px;
      left: 16px;
      background: rgba(14, 17, 26, 0.88);
      border: 1px solid #23293a;
      border-radius: 8px;
      padding: 14px 18px;
      backdrop-filter: blur(8px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      z-index: 100;
      font-size: 12px;
    }
    .hud-title {
      font-size: 14px;
      font-weight: 800;
      color: #00ffaa;
      margin-bottom: 6px;
      letter-spacing: 0.8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .hud-item {
      display: flex;
      gap: 14px;
      margin-top: 3px;
      color: #8c96ac;
    }
    .hud-val {
      color: #ffffff;
      font-weight: 600;
    }
    #top-controls {
      position: absolute;
      top: 44px;
      left: 50%;
      transform: translateX(-50%);
      display: ${isInteractive ? "flex" : "none"};
      flex-direction: column;
      align-items: center;
      gap: 6px;
      z-index: 1000;
    }
    .btn-row {
      display: flex;
      gap: 6px;
      background: rgba(14, 18, 28, 0.92);
      padding: 6px 12px;
      border-radius: 8px;
      border: 1px solid #2a344d;
      box-shadow: 0 6px 24px rgba(0,0,0,0.6);
      backdrop-filter: blur(10px);
    }
    .btn-row button {
      background: #1c2234;
      border: 1px solid #2e3954;
      color: #e1e4ea;
      padding: 5px 12px;
      border-radius: 5px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-row button:hover {
      background: #283452;
      border-color: #00ffaa;
      color: #00ffaa;
    }
    .btn-row button.active {
      background: #00aa66;
      border-color: #00ffaa;
      color: #ffffff;
    }
    .help-chip {
      background: rgba(10, 13, 20, 0.85);
      border: 1px solid #1f2738;
      color: #8c96ac;
      font-size: 10px;
      padding: 3px 12px;
      border-radius: 16px;
      letter-spacing: 0.4px;
    }
    #reticle {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 8px;
      height: 8px;
      transform: translate(-50%, -50%);
      border: 1.5px solid rgba(255, 255, 255, 0.7);
      border-radius: 50%;
      pointer-events: none;
      display: ${cameraMode === "first_person" ? "block" : "none"};
    }
  </style>
</head>
<body>
  <!-- Official Roblox CoreGui TopBar -->
  <div id="roblox-topbar">
    <div class="topbar-left">
      <div class="roblox-logo" title="Roblox Menu">
        <svg viewBox="0 0 32 32" width="22" height="22">
          <polygon points="6,2 30,8 26,30 2,24" fill="#d0d5dd" stroke="#98a2b3" stroke-width="1.5" />
          <polygon points="12,11 22,13 20,21 10,19" fill="#1f1f1f" />
        </svg>
      </div>
      <button class="topbar-icon-btn" title="Chat">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
        </svg>
      </button>
      <span class="experience-title">${experienceTitle}</span>
    </div>
    <div class="topbar-right">
      <div class="health-container" title="Health: ${health}/${maxHealth}">
        <div class="health-bar-bg">
          <div id="health-bar-fill" class="health-bar-fill" style="width: ${Math.max(0, Math.min(100, (health / maxHealth) * 100))}%; background: ${health < 25 ? '#ff3344' : '#00e676'};"></div>
        </div>
      </div>
      <button class="topbar-icon-btn" title="Leaderboard" onclick="toggleLeaderboard()">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
        </svg>
      </button>
      <button class="topbar-icon-btn" title="More Menu">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <circle cx="12" cy="5" r="2"/>
          <circle cx="12" cy="12" r="2"/>
          <circle cx="12" cy="19" r="2"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- Leaderboard Overlay (PlayerlistModule style) -->
  ${Object.keys(leaderstats).length > 0 ? `
  <div id="roblox-leaderboard">
    <div class="leaderboard-header">
      <span class="col-player">Player</span>
      ${Object.keys(leaderstats).map(k => `<span class="col-stat">${k}</span>`).join('')}
    </div>
    <div class="leaderboard-row">
      <div class="player-info">
        <div class="player-avatar-badge">${(playerName || "P")[0].toUpperCase()}</div>
        <span class="player-name">${playerName}</span>
      </div>
      ${Object.entries(leaderstats).map(([k, v]) => `<span class="stat-value" id="stat-${k}">${v}</span>`).join('')}
    </div>
  </div>
  ` : ''}

  <!-- Backpack Hotbar -->
  ${backpackTools.length > 0 ? `
  <div id="roblox-backpack">
    ${backpackTools.slice(0, 9).map((toolName, idx) => `
      <div class="backpack-slot ${toolName === equippedTool ? 'active' : ''}" id="slot-${idx + 1}" onclick="toggleTool('${toolName}', ${idx + 1})">
        <span class="slot-key">${idx + 1}</span>
        <div class="slot-icon">🗡️</div>
        <span class="slot-name" title="${toolName}">${toolName}</span>
      </div>
    `).join('')}
  </div>
  ` : ''}

  <!-- Damage Vignette -->
  <div id="damage-vignette" style="opacity: ${health < maxHealth ? (1 - health / maxHealth).toFixed(2) : '0'};"></div>

  <div id="top-controls">
    <div class="btn-row">
      <button id="btn-third_person" class="${cameraMode === 'third_person' ? 'active' : ''}" onclick="setCam('third_person')">3rd Person (3)</button>
      <button id="btn-first_person" class="${cameraMode === 'first_person' ? 'active' : ''}" onclick="setCam('first_person')">1st Person (1)</button>
      <button id="btn-overhead" class="${cameraMode === 'overhead' ? 'active' : ''}" onclick="setCam('overhead')">Overhead (O)</button>
      <button onclick="fireLiveRaycast()">Fire Raycast (F)</button>
      <button onclick="resetPlayer()">Reset Spawn</button>
      <button id="btn-console" onclick="toggleConsole()" style="background: #1c2538; border-color: #2e3e5c; color: #00ffaa;">💻 Console (F9)</button>
    </div>
    <div class="help-chip">WASD: Walk | Space: Jump | Shift: Sprint | 1-9: Equip Tool | Mouse: Orbit | F: Attack | F9: Console</div>
  </div>

  <canvas id="viewport-canvas" width="${isInteractive ? 1920 : 1920}" height="${isInteractive ? 1080 : 1080}"></canvas>
  <div id="reticle"></div>

  <!-- Roblox Developer Console Window (F9) -->
  <div id="dev-console-window" style="display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 900px; max-width: 95vw; height: 560px; max-height: 85vh; background: rgba(18, 22, 32, 0.96); border: 1.5px solid #2b354d; border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,0.85); z-index: 2000; overflow: hidden; flex-direction: column; backdrop-filter: blur(12px);">
    <div id="dev-console-titlebar" style="height: 38px; background: #141926; border-bottom: 1px solid #232d42; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; user-select: none;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 13px; font-weight: 800; color: #ffffff; letter-spacing: 0.5px;">💻 ROBLOX DEVELOPER CONSOLE</span>
        <span style="font-size: 10px; color: #00ffaa; background: #102b1f; border: 1px solid #1a4d36; padding: 2px 7px; border-radius: 4px; font-weight: 700;">LIVE ENGINE</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button onclick="clearConsoleLogs()" style="background: #1b2234; border: 1px solid #2c3854; color: #8c96ac; cursor: pointer; font-size: 11px; padding: 3px 8px; border-radius: 4px;">Clear</button>
        <button onclick="toggleConsole()" style="background: none; border: none; color: #8c96ac; cursor: pointer; font-size: 16px; padding: 2px 6px;">✕</button>
      </div>
    </div>
    <!-- Console Tabs -->
    <div style="height: 32px; background: #0f131d; border-bottom: 1px solid #1c2436; display: flex; align-items: center; padding: 0 10px; gap: 6px;">
      <button class="console-tab active" style="background: #1c2438; border: 1px solid #2b3956; color: #00ffaa; font-size: 11px; font-weight: 700; padding: 3px 12px; border-radius: 4px; cursor: pointer;">Log (Client)</button>
      <button class="console-tab" style="background: transparent; border: none; color: #6e7992; font-size: 11px; padding: 3px 12px; cursor: pointer;">Memory</button>
      <button class="console-tab" style="background: transparent; border: none; color: #6e7992; font-size: 11px; padding: 3px 12px; cursor: pointer;">Network</button>
      <button class="console-tab" style="background: transparent; border: none; color: #6e7992; font-size: 11px; padding: 3px 12px; cursor: pointer;">Scripts</button>
    </div>
    <!-- Output / Logs Log Area -->
    <div id="console-logs" style="flex: 1; position: relative; overflow-y: auto; background: #0a0d14; padding: 10px 14px; font-family: 'Consolas', 'Courier New', monospace; font-size: 12px; line-height: 1.6; display: flex; flex-direction: column; gap: 4px;">
      <div style="color: #6c7895;">-- Roblox Developer Console &amp; Luau Command Bar Online --</div>
      <div style="color: #6c7895;">-- Press F9 or ~ to toggle this console at any time --</div>
      <div style="color: #00ffaa;">[SYSTEM] Connected to LocalPlayer (UserId: 1, Name: "${playerName}")</div>
      <div style="color: #00ffaa;">[SYSTEM] 3D World loaded with ${partsData.length} active parts and physics simulation.</div>
      ${guiOverlayBase64 ? `<div style="margin-top: 10px; border: 1px solid #2b354d; border-radius: 6px; overflow: hidden;"><div style="background: #141926; padding: 4px 8px; font-size: 10px; color: #8c96ac;">ACTIVE GUI RENDER OVERLAY</div><img src="data:image/png;base64,${guiOverlayBase64}" style="width: 100%; max-height: 280px; object-fit: contain; background: #000;" /></div>` : ''}
    </div>
    <!-- Command Line Bar -->
    <div style="height: 48px; background: #111622; border-top: 1px solid #1f2738; display: flex; align-items: center; gap: 10px; padding: 0 14px;">
      <span style="color: #00ffaa; font-family: monospace; font-size: 13px; font-weight: bold;">&gt;</span>
      <input id="console-script-input" type="text" placeholder="Type Luau code to run (e.g. Instance.new('Part', workspace).Position = Vector3.new(0, 15, 0))" onkeydown="if(event.key==='Enter') executeConsoleLuau()" style="flex: 1; height: 32px; background: #080a0f; border: 1px solid #232d42; border-radius: 6px; padding: 0 10px; color: #fff; font-size: 12px; font-family: 'Consolas', monospace;" />
      <button onclick="executeConsoleLuau()" style="height: 32px; padding: 0 14px; background: #00aa66; border: 1px solid #00ffaa; border-radius: 6px; color: #fff; font-weight: 700; font-size: 12px; cursor: pointer;">▶ Run (Enter)</button>
    </div>
  </div>

  <!-- Floating Developer Console Icon (Bottom-Right, Rule B35) -->
  <div id="console-launcher-btn" onclick="toggleConsole()" style="position: absolute; bottom: 24px; right: 24px; width: 48px; height: 48px; background: #0f131d; border: 1.5px solid #2e3d5c; border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 8px 30px rgba(0,0,0,0.6); z-index: 1500; transition: all 0.15s ease;" title="Open Developer Console (F9 or ~)">
    <span style="font-size: 20px;">💻</span>
  </div>

  ${showHud ? `
  <div id="hud-overlay">
    <div class="hud-title">
      <span>ROBLOX 3D SPATIAL SIMULATION</span>
      <span style="font-size: 11px; background: #00aa66; color: #fff; padding: 2px 8px; border-radius: 4px;">ACTIVE</span>
    </div>
    <div class="hud-item">
      <span>CAMERA MODE:</span>
      <span id="hud-camera-mode" class="hud-val">${cameraMode.toUpperCase()}</span>
    </div>
    <div class="hud-item">
      <span>POSITION:</span>
      <span id="hud-player-pos" class="hud-val">(${playerHrpPos[0].toFixed(1)}, ${playerHrpPos[1].toFixed(1)}, ${playerHrpPos[2].toFixed(1)})</span>
    </div>
    <div class="hud-item">
      <span>PARTS IN SCENE:</span>
      <span class="hud-val">${partsData.length}</span>
    </div>
    <div class="hud-item">
      <span>RAYCAST QUERIES:</span>
      <span id="hud-ray-count" class="hud-val">${raycastsData.length} (${raycastsData.filter(r => r.hit).length} hits)</span>
    </div>
  </div>
  ` : ''}

  <script>
    const parts = ${JSON.stringify(partsData)};
    const raycasts = ${JSON.stringify(raycastsData)};
    let eye = ${JSON.stringify(eye)};
    let target = ${JSON.stringify(lookTarget)};
    const fov = ${fov};
    const sunDir = ${JSON.stringify(sunDir)};
    const staticWalkCycle = ${walkCycle};
    const isInteractive = ${isInteractive};

    const canvas = document.getElementById('viewport-canvas');
    if (isInteractive) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
      });
    }

    const gl = canvas.getContext('webgl', { antialias: true, alpha: false });

    if (!gl) {
      console.error("WebGL not supported");
    }

    // 1. Compile Shaders
    const vsSource = \`
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      attribute vec2 aTexCoord;

      uniform mat4 uModel;
      uniform mat4 uView;
      uniform mat4 uProj;

      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vTexCoord;

      void main() {
        vec4 worldPos = uModel * vec4(aPosition, 1.0);
        vWorldPos = worldPos.xyz;
        vNormal = mat3(uModel) * aNormal;
        vTexCoord = aTexCoord;
        gl_Position = uProj * uView * worldPos;
      }
    \`;

    const fsSource = \`
      precision mediump float;

      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vTexCoord;

      uniform vec4 uBaseColor;
      uniform vec3 uSunDir;
      uniform int uUseGrid;
      uniform int uIsSpawn;
      uniform int uIsFace;
      uniform int uIsNeon;

      void main() {
        vec4 col = uBaseColor;
        if (uIsNeon == 1) {
          gl_FragColor = vec4(col.rgb * 1.6, col.a);
          return;
        }

        vec3 norm = normalize(vNormal);
        float diff = max(dot(norm, normalize(uSunDir)), 0.0);
        vec3 ambient = vec3(0.45, 0.48, 0.52);
        vec3 sunLight = vec3(1.0, 0.98, 0.9) * diff * 0.75;
        vec3 light = ambient + sunLight;

        // Baseplate Grid
        if (uUseGrid == 1 && norm.y > 0.7) {
          vec2 grid = abs(fract(vWorldPos.xz / 4.0 - 0.5) - 0.5);
          float line = min(grid.x, grid.y);
          if (line < 0.04) {
            col.rgb *= 0.8;
          }
          // Stud dots
          vec2 stud = abs(fract(vWorldPos.xz / 2.0 - 0.5) - 0.5);
          if (length(stud) < 0.16) {
            col.rgb += vec3(0.08);
          }
        }

        // SpawnLocation Sunburst Decal
        if (uIsSpawn == 1 && norm.y > 0.7) {
          vec2 sp = vTexCoord - vec2(0.5, 0.5);
          float r = length(sp);
          float angle = atan(sp.y, sp.x);
          float rays = sin(angle * 8.0);
          if (r < 0.42 && r > 0.1) {
            if (rays > 0.0) col.rgb = vec3(0.9, 0.9, 0.95);
            else col.rgb = vec3(0.2, 0.2, 0.25);
          } else if (r <= 0.1) {
            col.rgb = vec3(0.95, 0.8, 0.1);
          }
        }

        // Roblox Face Decal (Smiley Face on Head)
        if (uIsFace == 1 && norm.z < -0.6) {
          vec2 uv = vTexCoord;
          float dEyeL = length(uv - vec2(0.35, 0.62));
          float dEyeR = length(uv - vec2(0.65, 0.62));
          float dSmile = abs(length(uv - vec2(0.5, 0.52)) - 0.22);
          if (dEyeL < 0.065 || dEyeR < 0.065 || (dSmile < 0.038 && uv.y < 0.45 && uv.x > 0.28 && uv.x < 0.72)) {
            col.rgb = vec3(0.08, 0.08, 0.08);
          }
        }

        // Depth Cueing Fog towards Horizon Sky
        float dist = length(vWorldPos - vec3(0.0, 5.0, 0.0));
        float fog = clamp((dist - 80.0) / 450.0, 0.0, 0.65);
        vec3 skyColor = vec3(0.58, 0.75, 0.94);

        gl_FragColor = vec4(mix(col.rgb * light, skyColor, fog), col.a);
      }
    \`;

    function createShader(gl, type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    // Cube Vertices with Normals and UVs (24 vertices, 6 faces)
    const cubeData = new Float32Array([
      // Front (norm: 0, 0, -1)
      -0.5, -0.5, -0.5,  0, 0, -1,  0, 0,
       0.5, -0.5, -0.5,  0, 0, -1,  1, 0,
       0.5,  0.5, -0.5,  0, 0, -1,  1, 1,
      -0.5,  0.5, -0.5,  0, 0, -1,  0, 1,
      // Back (norm: 0, 0, 1)
      -0.5, -0.5,  0.5,  0, 0,  1,  1, 0,
       0.5, -0.5,  0.5,  0, 0,  1,  0, 0,
       0.5,  0.5,  0.5,  0, 0,  1,  0, 1,
      -0.5,  0.5,  0.5,  0, 0,  1,  1, 1,
      // Top (norm: 0, 1, 0)
      -0.5,  0.5, -0.5,  0, 1,  0,  0, 1,
       0.5,  0.5, -0.5,  0, 1,  0,  1, 1,
       0.5,  0.5,  0.5,  0, 1,  0,  1, 0,
      -0.5,  0.5,  0.5,  0, 1,  0,  0, 0,
      // Bottom (norm: 0, -1, 0)
      -0.5, -0.5, -0.5,  0, -1, 0,  0, 0,
       0.5, -0.5, -0.5,  0, -1, 0,  1, 0,
       0.5, -0.5,  0.5,  0, -1, 0,  1, 1,
      -0.5, -0.5,  0.5,  0, -1, 0,  0, 1,
      // Right (norm: 1, 0, 0)
       0.5, -0.5, -0.5,  1, 0,  0,  0, 0,
       0.5,  0.5, -0.5,  1, 0,  0,  0, 1,
       0.5,  0.5,  0.5,  1, 0,  0,  1, 1,
       0.5, -0.5,  0.5,  1, 0,  0,  1, 0,
      // Left (norm: -1, 0, 0)
      -0.5, -0.5, -0.5, -1, 0,  0,  1, 0,
      -0.5,  0.5, -0.5, -1, 0,  0,  1, 1,
      -0.5,  0.5,  0.5, -1, 0,  0,  0, 1,
      -0.5, -0.5,  0.5, -1, 0,  0,  0, 0
    ]);

    const cubeIndices = new Uint16Array([
      0, 1, 2,   0, 2, 3,
      4, 6, 5,   4, 7, 6,
      8, 9, 10,  8, 10, 11,
      12, 14, 13, 12, 15, 14,
      16, 17, 18, 16, 18, 19,
      20, 22, 21, 20, 23, 22
    ]);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, cubeData, gl.STATIC_DRAW);

    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cubeIndices, gl.STATIC_DRAW);

    const FSIZE = Float32Array.BYTES_PER_ELEMENT;
    const aPos = gl.getAttribLocation(prog, 'aPosition');
    const aNorm = gl.getAttribLocation(prog, 'aNormal');
    const aTex = gl.getAttribLocation(prog, 'aTexCoord');

    const uProj = gl.getUniformLocation(prog, 'uProj');
    const uView = gl.getUniformLocation(prog, 'uView');
    const uModel = gl.getUniformLocation(prog, 'uModel');
    const uBaseColor = gl.getUniformLocation(prog, 'uBaseColor');
    const uSunDir = gl.getUniformLocation(prog, 'uSunDir');
    const uUseGrid = gl.getUniformLocation(prog, 'uUseGrid');
    const uIsSpawn = gl.getUniformLocation(prog, 'uIsSpawn');
    const uIsFace = gl.getUniformLocation(prog, 'uIsFace');
    const uIsNeon = gl.getUniformLocation(prog, 'uIsNeon');

    function mat4Create() {
      return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    }

    function mat4Multiply(out, a, b) {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
      out[0] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
      out[1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
      out[2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
      out[3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
      b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
      out[4] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
      out[5] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
      out[6] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
      out[7] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
      b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
      out[8] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
      out[9] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
      out[10] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
      out[11] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
      b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
      out[12] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
      out[13] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
      out[14] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
      out[15] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
      return out;
    }

    function mat4Perspective(out, fovRad, aspect, near, far) {
      const f = 1.0 / Math.tan(fovRad / 2);
      const nf = 1 / (near - far);
      out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
      out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
      out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
      out[12] = 0; out[13] = 0; out[14] = (2 * far * near) * nf; out[15] = 0;
      return out;
    }

    function mat4LookAt(out, eye, center, up) {
      let x0, x1, x2, y0, y1, y2, z0, z1, z2, len;
      let eyex = eye[0], eyey = eye[1], eyez = eye[2];
      let upx = up[0], upy = up[1], upz = up[2];
      let centerx = center[0], centery = center[1], centerz = center[2];

      z0 = eyex - centerx; z1 = eyey - centery; z2 = eyez - centerz;
      len = 1 / Math.hypot(z0, z1, z2);
      z0 *= len; z1 *= len; z2 *= len;

      x0 = upy * z2 - upz * z1;
      x1 = upz * z0 - upx * z2;
      x2 = upx * z1 - upy * z0;
      len = Math.hypot(x0, x1, x2);
      if (!len) { x0 = 0; x1 = 0; x2 = 0; }
      else { len = 1 / len; x0 *= len; x1 *= len; x2 *= len; }

      y0 = z1 * x2 - z2 * x1;
      y1 = z2 * x0 - z0 * x2;
      y2 = z0 * x1 - z1 * x0;
      len = Math.hypot(y0, y1, y2);
      if (!len) { y0 = 0; y1 = 0; y2 = 0; }
      else { len = 1 / len; y0 *= len; y1 *= len; y2 *= len; }

      out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
      out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
      out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
      out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
      out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
      out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
      out[15] = 1;
      return out;
    }

    function hexToRgb(hex) {
      if (hex.startsWith('#')) hex = hex.substring(1);
      const num = parseInt(hex, 16);
      return [(num >> 16) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
    }

    // Line Shader Program for Raycast Beams
    const lineVs = \`
      attribute vec3 aPosition;
      uniform mat4 uView;
      uniform mat4 uProj;
      void main() {
        gl_Position = uProj * uView * vec4(aPosition, 1.0);
      }
    \`;
    const lineFs = \`
      precision mediump float;
      uniform vec4 uLineColor;
      void main() {
        gl_FragColor = uLineColor;
      }
    \`;
    const lvs = createShader(gl, gl.VERTEX_SHADER, lineVs);
    const lfs = createShader(gl, gl.FRAGMENT_SHADER, lineFs);
    const lineProg = gl.createProgram();
    gl.attachShader(lineProg, lvs);
    gl.attachShader(lineProg, lfs);
    gl.linkProgram(lineProg);

    const luProj = gl.getUniformLocation(lineProg, 'uProj');
    const luView = gl.getUniformLocation(lineProg, 'uView');
    const luColor = gl.getUniformLocation(lineProg, 'uLineColor');

    function renderRaycasts(pMat, vMat) {
      if (!raycasts || raycasts.length === 0) return;
      gl.useProgram(lineProg);
      gl.uniformMatrix4fv(luProj, false, pMat);
      gl.uniformMatrix4fv(luView, false, vMat);

      for (const ray of raycasts) {
        const p1 = ray.origin;
        const p2 = ray.hit && ray.hitPosition ? ray.hitPosition : [
          ray.origin[0] + ray.direction[0],
          ray.origin[1] + ray.direction[1],
          ray.origin[2] + ray.direction[2]
        ];

        const lineVerts = new Float32Array([p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]]);
        const lineVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, lineVbo);
        gl.bufferData(gl.ARRAY_BUFFER, lineVerts, gl.STATIC_DRAW);

        const laPos = gl.getAttribLocation(lineProg, 'aPosition');
        gl.enableVertexAttribArray(laPos);
        gl.vertexAttribPointer(laPos, 3, gl.FLOAT, false, 0, 0);

        if (ray.hit) gl.uniform4f(luColor, 0.0, 1.0, 0.5, 1.0);
        else gl.uniform4f(luColor, 1.0, 0.2, 0.3, 1.0);
        gl.drawArrays(gl.LINES, 0, 2);
      }
    }

    function renderFrame(curEye, curTarget, curWalkCycle) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.58, 0.75, 0.94, 1.0);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const projMat = mat4Create();
      mat4Perspective(projMat, (fov * Math.PI) / 180, canvas.width / canvas.height, 0.5, 2000);

      const viewMat = mat4Create();
      mat4LookAt(viewMat, curEye, curTarget, [0, 1, 0]);

      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);

      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, FSIZE * 8, 0);

      gl.enableVertexAttribArray(aNorm);
      gl.vertexAttribPointer(aNorm, 3, gl.FLOAT, false, FSIZE * 8, FSIZE * 3);

      gl.enableVertexAttribArray(aTex);
      gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, FSIZE * 8, FSIZE * 6);

      gl.uniformMatrix4fv(uProj, false, projMat);
      gl.uniformMatrix4fv(uView, false, viewMat);
      gl.uniform3f(uSunDir, sunDir[0], sunDir[1], sunDir[2]);

      // Draw all parts
      for (const part of parts) {
        if (part.transparency >= 1) continue;

        const modelMat = mat4Create();
        const cf = part.cframe;
        for (let i = 0; i < 16; i++) modelMat[i] = cf[i];

        if (part.isLeftArm) {
          const swing = Math.sin(curWalkCycle) * 0.45;
          const rotMat = mat4Create();
          rotMat[5] = Math.cos(swing); rotMat[6] = Math.sin(swing);
          rotMat[9] = -Math.sin(swing); rotMat[10] = Math.cos(swing);
          mat4Multiply(modelMat, modelMat, rotMat);
        } else if (part.isRightArm) {
          const swing = -Math.sin(curWalkCycle) * 0.45;
          const rotMat = mat4Create();
          rotMat[5] = Math.cos(swing); rotMat[6] = Math.sin(swing);
          rotMat[9] = -Math.sin(swing); rotMat[10] = Math.cos(swing);
          mat4Multiply(modelMat, modelMat, rotMat);
        } else if (part.isLeftLeg) {
          const swing = -Math.sin(curWalkCycle) * 0.45;
          const rotMat = mat4Create();
          rotMat[5] = Math.cos(swing); rotMat[6] = Math.sin(swing);
          rotMat[9] = -Math.sin(swing); rotMat[10] = Math.cos(swing);
          mat4Multiply(modelMat, modelMat, rotMat);
        } else if (part.isRightLeg) {
          const swing = Math.sin(curWalkCycle) * 0.45;
          const rotMat = mat4Create();
          rotMat[5] = Math.cos(swing); rotMat[6] = Math.sin(swing);
          rotMat[9] = -Math.sin(swing); rotMat[10] = Math.cos(swing);
          mat4Multiply(modelMat, modelMat, rotMat);
        }

        modelMat[0] *= part.size[0];
        modelMat[1] *= part.size[0];
        modelMat[2] *= part.size[0];

        modelMat[4] *= part.size[1];
        modelMat[5] *= part.size[1];
        modelMat[6] *= part.size[1];

        modelMat[8] *= part.size[2];
        modelMat[9] *= part.size[2];
        modelMat[10] *= part.size[2];

        gl.uniformMatrix4fv(uModel, false, modelMat);

        const rgb = hexToRgb(part.color);
        gl.uniform4f(uBaseColor, rgb[0], rgb[1], rgb[2], 1.0 - part.transparency);
        gl.uniform1i(uUseGrid, part.isBaseplate ? 1 : 0);
        gl.uniform1i(uIsSpawn, part.isSpawn ? 1 : 0);
        gl.uniform1i(uIsFace, part.isHead ? 1 : 0);
        gl.uniform1i(uIsNeon, part.isNeon ? 1 : 0);

        gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
      }

      renderRaycasts(projMat, viewMat);
    }

    if (!isInteractive) {
      // Single-frame static render for headless screenshot capture
      renderFrame(eye, target, staticWalkCycle);
    } else {
      // Live 60 FPS Interactive Loop with WASD & Mouse controls
      let curCameraMode = "${cameraMode}";
      let pX = ${playerHrpPos[0]}, pY = ${playerHrpPos[1]}, pZ = ${playerHrpPos[2]};
      let vY = 0;
      let onGround = true;
      let animCycle = 0;
      let camYaw = 0;
      let camPitch = 0.22;
      let camDist = 14;
      let lastTime = performance.now();

      let audioCtx = null;
      function getAudioContext() {
        if (!audioCtx) {
          try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          } catch(e) {}
        }
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
        return audioCtx;
      }

      function playOofSound() {
        const ctx = getAudioContext();
        if (!ctx) return;
        try {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sawtooth';
          const now = ctx.currentTime;
          osc.frequency.setValueAtTime(520, now);
          osc.frequency.exponentialRampToValueAtTime(140, now + 0.32);
          gain.gain.setValueAtTime(0.3, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.32);
          osc.start(now);
          osc.stop(now + 0.35);
        } catch(e) {}
      }

      function playJumpSound() {
        const ctx = getAudioContext();
        if (!ctx) return;
        try {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sine';
          const now = ctx.currentTime;
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.exponentialRampToValueAtTime(480, now + 0.14);
          gain.gain.setValueAtTime(0.2, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
          osc.start(now);
          osc.stop(now + 0.16);
        } catch(e) {}
      }

      function playCoinSound() {
        const ctx = getAudioContext();
        if (!ctx) return;
        try {
          const now = ctx.currentTime;
          [988, 1318].forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.08);
            gain.gain.setValueAtTime(0.25, now + idx * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.08 + 0.2);
            osc.start(now + idx * 0.08);
            osc.stop(now + idx * 0.08 + 0.22);
          });
        } catch(e) {}
      }

      function playSwordSlashSound() {
        const ctx = getAudioContext();
        if (!ctx) return;
        try {
          const bufferSize = ctx.sampleRate * 0.2;
          const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
          const noise = ctx.createBufferSource();
          noise.buffer = buffer;
          const filter = ctx.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.setValueAtTime(1400, ctx.currentTime);
          filter.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.18);
          filter.Q.value = 3.0;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.35, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
          noise.connect(filter);
          filter.connect(gain);
          gain.connect(ctx.destination);
          noise.start();
        } catch(e) {}
      }

      let lastStepTime = 0;
      function playFootstepSound() {
        const now = performance.now();
        if (now - lastStepTime < 320) return;
        lastStepTime = now;
        const ctx = getAudioContext();
        if (!ctx) return;
        try {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'triangle';
          const t = ctx.currentTime;
          osc.frequency.setValueAtTime(80, t);
          osc.frequency.exponentialRampToValueAtTime(40, t + 0.08);
          gain.gain.setValueAtTime(0.12, t);
          gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
          osc.start(t);
          osc.stop(t + 0.09);
        } catch(e) {}
      }

      let curEquippedTool = ${JSON.stringify(equippedTool)};
      function toggleTool(toolName, slotIdx) {
        getAudioContext();
        if (curEquippedTool === toolName) {
          curEquippedTool = null;
        } else {
          curEquippedTool = toolName;
          playSwordSlashSound();
        }
        document.querySelectorAll('.backpack-slot').forEach(s => s.classList.remove('active'));
        if (curEquippedTool) {
          const slot = document.getElementById('slot-' + slotIdx);
          if (slot) slot.classList.add('active');
        }
      }
      window.toggleTool = toggleTool;

      function toggleLeaderboard() {
        const lb = document.getElementById('roblox-leaderboard');
        if (lb) {
          lb.style.display = lb.style.display === 'none' ? 'block' : 'none';
        }
      }
      window.toggleLeaderboard = toggleLeaderboard;

      const keys = {};
      window.addEventListener('keydown', (e) => {
        keys[e.key.toLowerCase()] = true;
        if (e.code === 'Space' || e.key === ' ') {
          e.preventDefault();
          if (onGround) {
            vY = 22;
            onGround = false;
            playJumpSound();
          }
        }
        if (e.key === '1') setCamera('first_person');
        if (e.key === '3') setCamera('third_person');
        if (e.key === 'o' || e.key === 'O') setCamera('overhead');
        if (e.key === 'f' || e.key === 'F') fireLiveRaycast();

        const num = parseInt(e.key);
        if (!isNaN(num) && num >= 1 && num <= 9) {
          const backpackList = ${JSON.stringify(backpackTools)};
          if (backpackList && backpackList[num - 1]) {
            toggleTool(backpackList[num - 1], num);
          }
        }
      });
      window.addEventListener('keyup', (e) => {
        keys[e.key.toLowerCase()] = false;
      });

      let isMouseDown = false;
      let lastMx = 0, lastMy = 0;
      canvas.addEventListener('mousedown', (e) => {
        isMouseDown = true;
        lastMx = e.clientX;
        lastMy = e.clientY;
        getAudioContext();
        if (curEquippedTool) {
          playSwordSlashSound();
        }
      });
      window.addEventListener('mouseup', () => { isMouseDown = false; });
      window.addEventListener('mousemove', (e) => {
        if (!isMouseDown) return;
        const dx = e.clientX - lastMx;
        const dy = e.clientY - lastMy;
        lastMx = e.clientX;
        lastMy = e.clientY;
        camYaw -= dx * 0.005;
        camPitch = Math.max(-0.25, Math.min(Math.PI / 2.2, camPitch + dy * 0.005));
      });
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        camDist = Math.max(1.0, Math.min(80.0, camDist + e.deltaY * 0.03));
      });

      function setCamera(mode) {
        curCameraMode = mode;
        document.querySelectorAll('.btn-row button').forEach(b => b.classList.remove('active'));
        const activeBtn = document.getElementById('btn-' + mode);
        if (activeBtn) activeBtn.classList.add('active');
        const reticle = document.getElementById('reticle');
        if (reticle) reticle.style.display = mode === 'first_person' ? 'block' : 'none';
        const hudMode = document.getElementById('hud-camera-mode');
        if (hudMode) hudMode.textContent = mode.toUpperCase();
      }
      window.setCam = setCamera;

      function resetPlayer() {
        pX = 0; pY = 3.0; pZ = 0; vY = 0; onGround = true;
      }
      window.resetPlayer = resetPlayer;

      function fireLiveRaycast() {
        playSwordSlashSound();
        const origin = [pX, pY + 1.2, pZ];
        const dir = [
          -Math.sin(camYaw) * 40,
          Math.sin(camPitch) * 40,
          -Math.cos(camYaw) * 40
        ];
        raycasts.push({ origin, direction: dir, hit: false, hitPosition: null });
        if (raycasts.length > 5) raycasts.shift();
      }
      window.fireLiveRaycast = fireLiveRaycast;

      function updateCharacter(dt) {
        let mx = 0, mz = 0;
        if (keys['w']) mz -= 1;
        if (keys['s']) mz += 1;
        if (keys['a']) mx -= 1;
        if (keys['d']) mx += 1;

        const len = Math.hypot(mx, mz);
        const isMoving = len > 0;
        const speed = keys['shift'] ? 28 : 16;

        if (isMoving) {
          if (onGround) playFootstepSound();
          mx /= len;
          mz /= len;
          const wx = mx * Math.cos(camYaw) - mz * Math.sin(camYaw);
          const wz = mx * Math.sin(camYaw) + mz * Math.cos(camYaw);
          pX += wx * speed * dt;
          pZ += wz * speed * dt;
          animCycle += speed * dt * 0.7;

          const facing = Math.atan2(wx, -wz);
          for (const p of parts) {
            if (p.isHead || p.isLeftArm || p.isRightArm || p.isLeftLeg || p.isRightLeg || p.name === 'Torso') {
              p.cframe[0] = Math.cos(facing); p.cframe[2] = Math.sin(facing);
              p.cframe[8] = -Math.sin(facing); p.cframe[10] = Math.cos(facing);
            }
          }
        }

        vY -= 55 * dt;
        pY += vY * dt;

        let groundY = 3.0;
        for (const p of parts) {
          if (p.name.startsWith('Platform') || p.name === 'SpawnLocation') {
            const top = p.position[1] + p.size[1] / 2 + 2.5;
            const hx = p.size[0] / 2 + 0.5;
            const hz = p.size[2] / 2 + 0.5;
            if (Math.abs(pX - p.position[0]) < hx && Math.abs(pZ - p.position[2]) < hz) {
              if (pY >= top - 1.5 && pY <= top + 2.5) {
                groundY = Math.max(groundY, top);
              }
            }
          }
        }

        if (pY <= groundY) {
          pY = groundY;
          vY = 0;
          onGround = true;
        } else {
          onGround = false;
        }

        for (const p of parts) {
          if (p.name === 'Torso') { p.cframe[12] = pX; p.cframe[13] = pY; p.cframe[14] = pZ; }
          else if (p.isHead) { p.cframe[12] = pX; p.cframe[13] = pY + 1.5; p.cframe[14] = pZ; }
          else if (p.isLeftArm) { p.cframe[12] = pX - 1.5; p.cframe[13] = pY; p.cframe[14] = pZ; }
          else if (p.isRightArm) { p.cframe[12] = pX + 1.5; p.cframe[13] = pY; p.cframe[14] = pZ; }
          else if (p.isLeftLeg) { p.cframe[12] = pX - 0.5; p.cframe[13] = pY - 2.0; p.cframe[14] = pZ; }
          else if (p.isRightLeg) { p.cframe[12] = pX + 0.5; p.cframe[13] = pY - 2.0; p.cframe[14] = pZ; }
        }

        const hudPos = document.getElementById('hud-player-pos');
        if (hudPos) hudPos.textContent = '(' + pX.toFixed(1) + ', ' + pY.toFixed(1) + ', ' + pZ.toFixed(1) + ')';
      }

      function loop(now) {
        const dt = Math.min(0.1, (now - lastTime) / 1000);
        lastTime = now;

        updateCharacter(dt);

        let curEye, curTarget;
        if (curCameraMode === 'first_person') {
          curEye = [pX, pY + 1.5, pZ];
          curTarget = [
            curEye[0] - Math.sin(camYaw) * Math.cos(camPitch) * 20,
            curEye[1] + Math.sin(camPitch) * 20,
            curEye[2] - Math.cos(camYaw) * Math.cos(camPitch) * 20
          ];
        } else if (curCameraMode === 'third_person') {
          const lx = -Math.sin(camYaw) * Math.cos(camPitch);
          const ly = Math.sin(camPitch);
          const lz = -Math.cos(camYaw) * Math.cos(camPitch);
          curEye = [
            pX - lx * camDist,
            pY + 1.2 - ly * camDist + 2.0,
            pZ - lz * camDist
          ];
          curTarget = [pX, pY + 1.2, pZ];
        } else if (curCameraMode === 'overhead') {
          curEye = [pX, pY + 45, pZ + 30];
          curTarget = [pX, pY, pZ];
        } else {
          curEye = eye;
          curTarget = target;
        }

        renderFrame(curEye, curTarget, animCycle);
        requestAnimationFrame(loop);
      }

      requestAnimationFrame(loop);
    }

    function toggleConsole() {
      const win = document.getElementById('dev-console-window');
      if (!win) return;
      const isVis = win.style.display === 'flex';
      win.style.display = isVis ? 'none' : 'flex';
      if (!isVis) {
        const input = document.getElementById('console-script-input');
        if (input) setTimeout(() => input.focus(), 50);
      }
    }

    function clearConsoleLogs() {
      const logs = document.getElementById('console-logs');
      if (logs) logs.innerHTML = '<div style="color: #6c7895;">-- Console cleared --</div>';
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F9' || (e.code === 'Backquote' && !e.shiftKey)) {
        e.preventDefault();
        toggleConsole();
      }
    });

    async function executeConsoleLuau() {
      const input = document.getElementById('console-script-input');
      if (!input || !input.value.trim()) return;
      const scriptText = input.value.trim();
      const logsDiv = document.getElementById('console-logs');

      if (logsDiv) {
        const cmdRow = document.createElement('div');
        cmdRow.style.color = '#e1e4ea';
        cmdRow.style.fontFamily = 'monospace';
        cmdRow.textContent = '> ' + scriptText;
        logsDiv.appendChild(cmdRow);
        logsDiv.scrollTop = logsDiv.scrollHeight;
      }

      try {
        const res = await fetch('/api/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ script: scriptText })
        });
        const data = await res.json();
        if (logsDiv) {
          if (data.logs && Array.isArray(data.logs)) {
            for (const logLine of data.logs) {
              const lRow = document.createElement('div');
              lRow.style.color = '#8bc34a';
              lRow.textContent = logLine;
              logsDiv.appendChild(lRow);
            }
          }
          if (data.success) {
            const row = document.createElement('div');
            row.style.color = '#00ffaa';
            row.textContent = '[OUTPUT] Script executed successfully.';
            logsDiv.appendChild(row);
            input.value = '';
          } else {
            const errRow = document.createElement('div');
            errRow.style.color = '#ff4455';
            errRow.textContent = '[ERROR] ' + (data.error || 'Execution failed');
            logsDiv.appendChild(errRow);
          }
          logsDiv.scrollTop = logsDiv.scrollHeight;
        }
      } catch (err) {
        if (logsDiv) {
          const errRow = document.createElement('div');
          errRow.style.color = '#ff4455';
          errRow.textContent = '[FETCH ERROR] ' + err.message;
          logsDiv.appendChild(errRow);
          logsDiv.scrollTop = logsDiv.scrollHeight;
        }
      }
    }
  </script>
</body>
</html>`;
    }
}
