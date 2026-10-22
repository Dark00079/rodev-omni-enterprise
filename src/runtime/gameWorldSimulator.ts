/**
 * GameWorldSimulator
 * Orchestrates full-lifecycle Roblox games, embodied player action dispatch,
 * sensory feedback perception, and pre-built genre world architectures.
 */

import { ExecutorSandbox } from './executorSandbox.js';
import { Vector3, Color3, CFrame, UDim2, RaycastParams } from './datatypes.js';
import {
  BasePart,
  Model,
  Humanoid,
  Tool,
  ClickDetector,
  ProximityPrompt,
  BillboardGui,
  Sound,
  InstanceEngine,
  Instance
} from './instanceEngine.js';
import { Workspace3dRenderer, Workspace3dRenderOptions } from '../renderer/workspace3dRenderer.js';
import { PlaywrightEngine } from '../renderer/playwrightEngine.js';

export interface RobloxGameSpec {
  title: string;
  genre?: "obby" | "sword_arena" | "tycoon" | "custom";
  description?: string;
  map?: {
    parts?: Array<{
      name: string;
      className?: string;
      size?: [number, number, number];
      position?: [number, number, number];
      color?: string; // hex string e.g. "ff0000"
      material?: string;
      transparency?: number;
      anchored?: boolean;
      canCollide?: boolean;
      canTouch?: boolean;
      touchedScript?: string;
    }>;
    spawns?: Array<{
      name?: string;
      position?: [number, number, number];
      size?: [number, number, number];
    }>;
  };
  serverScripts?: Array<{ name: string; code: string }>;
  clientScripts?: Array<{ name: string; code: string }>;
  tools?: Array<{
    name: string;
    tooltip?: string;
    handleSize?: [number, number, number];
    handleColor?: string;
    onActivatedScript?: string;
  }>;
  lighting?: {
    clockTime?: number;
    brightness?: number;
    ambient?: string;
    fogEnd?: number;
  };
}

export interface PlayerAction {
  type?: "move" | "jump" | "sprint" | "equipTool" | "unequipTool" | "activateTool" | "triggerPrompt" | "clickObject" | "chat" | "captureScreenshot";
  move?: [number, number, number]; // destination [x, y, z]
  targetPosition?: [number, number, number];
  direction?: [number, number, number];
  moveDir?: [number, number];      // [dx, dz] direction
  jump?: boolean;
  sprint?: boolean;
  equipTool?: string | number;     // tool name or slot number 1..9
  toolName?: string;
  unequipTool?: boolean;
  activateTool?: boolean;
  triggerPrompt?: string;          // prompt name or target object name
  promptObject?: string;
  clickObject?: string;            // target part or ClickDetector name
  clickTarget?: string;
  chat?: string;
  message?: string;
  stepDuration?: number;           // seconds to step physics (default: 0.5)
  duration?: number;
  cameraMode?: "third_person" | "first_person" | "overhead" | "custom";
  cameraPosition?: [number, number, number];
  cameraLookAt?: [number, number, number];
  captureScreenshot?: boolean;
  outputPath?: string;
}

export interface PlayerSensoryObservation {
  success: boolean;
  player: {
    name: string;
    position: [number, number, number];
    health: number;
    maxHealth: number;
    isAlive: boolean;
    walkSpeed: number;
    equippedTool: string | null;
    backpack: string[];
    leaderstats: Record<string, string | number>;
  };
  nearbyInteractables: Array<{
    name: string;
    type: "ProximityPrompt" | "ClickDetector" | "Tool" | "Hazard" | "Part";
    distance: number;
    promptText?: string;
    key?: string;
  }>;
  recentEvents: Array<{
    event: string;
    details: any;
    timestamp: number;
  }>;
  chatLog: Array<{ sender: string; message: string; timestamp: number }>;
  logs: {
    server: string[];
    client: string[];
  };
  screenshotPath?: string;
  base64Png?: string;
}

export class GameWorldSimulator {
  private static instance: GameWorldSimulator | null = null;
  public sandbox: ExecutorSandbox;
  public title: string = "Roblox Experience";
  public genre: string = "custom";
  public chatHistory: Array<{ sender: string; message: string; timestamp: number }> = [];
  public recentEvents: Array<{ event: string; details: any; timestamp: number }> = [];
  public spawnPoint: Vector3 = new Vector3(0, 3, 0);

  constructor() {
    this.sandbox = new ExecutorSandbox();
  }

  public static getInstance(): GameWorldSimulator {
    if (!this.instance) {
      this.instance = new GameWorldSimulator();
    }
    return this.instance;
  }

  /**
   * Resets and scaffolds a complete Roblox game from specification
   */
  public async createGame(spec: RobloxGameSpec): Promise<{
    success: boolean;
    title: string;
    genre: string;
    partsCount: number;
    toolsCount: number;
    sensoryObservation: PlayerSensoryObservation;
    logs: string[];
  }> {
    this.sandbox.reset();
    this.chatHistory = [];
    this.recentEvents = [];
    this.title = spec.title || "Roblox Experience";
    this.genre = spec.genre || "custom";
    this.spawnPoint = new Vector3(0, 3, 0);

    const workspace = this.sandbox.game.Workspace;
    const players = this.sandbox.game.Players;
    const localPlayer = players.LocalPlayer;

    // Clean up previous game state in workspace and local player
    if (localPlayer.equippedTool) {
      localPlayer.unequipTool();
    }
    localPlayer.equippedTool = null;
    workspace.ClearAllChildren();
    localPlayer.Backpack.ClearAllChildren();
    localPlayer.PlayerGui.ClearAllChildren();
    const oldLs = localPlayer.FindFirstChild("leaderstats");
    if (oldLs) oldLs.Destroy();

    // 1. Scaffold Map based on Genre or Custom Spec
    if (spec.genre === "obby") {
      this.scaffoldObbyTemplate();
    } else if (spec.genre === "sword_arena") {
      this.scaffoldSwordArenaTemplate();
    } else if (spec.genre === "tycoon") {
      this.scaffoldTycoonTemplate();
    } else {
      // Standard Baseplate
      Workspace3dRenderer.populateTemplate(workspace, "baseplate");
    }

    // 2. Custom Map Ingestion
    if (spec.map?.parts) {
      for (const p of spec.map.parts) {
        const part = InstanceEngine.new(p.className || "Part", workspace) as BasePart;
        part.Name = p.name;
        if (p.size) part.Size = new Vector3(p.size[0], p.size[1], p.size[2]);
        if (p.position) part.Position = new Vector3(p.position[0], p.position[1], p.position[2]);
        if (p.color) part.Color = Color3.fromHex(p.color);
        if (p.material) part.Material = p.material;
        if (p.transparency !== undefined) part.Transparency = p.transparency;
        if (p.anchored !== undefined) part.Anchored = p.anchored;
        if (p.canCollide !== undefined) part.CanCollide = p.canCollide;
        if (p.canTouch !== undefined) part.CanTouch = p.canTouch;

        if (p.touchedScript) {
          part.Touched.Connect((hit: any) => {
            this.sandbox.execute(`
              local hit = ...
              ${p.touchedScript}
            `);
          });
        }
      }
    }

    // 3. Custom Tools Ingestion
    if (spec.tools) {
      for (const t of spec.tools) {
        const tool = new Tool();
        tool.Name = t.name;
        tool.ToolTip = t.tooltip || "";

        const handle = new BasePart("Part");
        handle.Name = "Handle";
        const hs = t.handleSize || [1, 3, 1];
        handle.Size = new Vector3(hs[0], hs[1], hs[2]);
        if (t.handleColor) handle.Color = Color3.fromHex(t.handleColor);
        handle.Parent = tool;

        if (t.onActivatedScript) {
          tool.Activated.Connect(() => {
            this.sandbox.execute(t.onActivatedScript!);
          });
        }

        // Place into StarterPack and LocalPlayer Backpack
        tool.Parent = this.sandbox.game.StarterPack;
        const toolClone = new Tool();
        toolClone.Name = t.name;
        toolClone.ToolTip = t.tooltip || "";
        const handleClone = new BasePart("Part");
        handleClone.Name = "Handle";
        handleClone.Size = handle.Size;
        handleClone.Color = handle.Color;
        handleClone.Parent = toolClone;
        if (t.onActivatedScript) {
          toolClone.Activated.Connect(() => {
            this.sandbox.execute(t.onActivatedScript!);
          });
        }
        toolClone.Parent = localPlayer.Backpack;
      }
    }

    // 4. Server Scripts Execution
    let logs: string[] = [];
    if (spec.serverScripts) {
      for (const s of spec.serverScripts) {
        const scriptObj = InstanceEngine.new("Script", this.sandbox.game.ServerScriptService);
        scriptObj.Name = s.name;
        const res = this.sandbox.execute(s.code);
        logs = logs.concat(res.logs);
      }
    }

    // 5. Client Scripts Execution
    if (spec.clientScripts) {
      for (const cs of spec.clientScripts) {
        const clientScriptObj = InstanceEngine.new("LocalScript", this.sandbox.game.StarterPlayer.FindFirstChild("StarterPlayerScripts") || this.sandbox.game.StarterPlayer);
        clientScriptObj.Name = cs.name;
        const res = this.sandbox.execute(cs.code);
        logs = logs.concat(res.logs);
      }
    }

    // 6. Spawn Character
    const character = localPlayer.spawnMockCharacter("R6", this.spawnPoint);
    character.Parent = workspace;

    // Attach death respawn handler
    const humanoid = character.FindFirstChild("Humanoid") as Humanoid | null;
    if (humanoid) {
      humanoid.Died.Connect(() => {
        this.recentEvents.push({
          event: "Died",
          details: { message: "Player died, respawning at spawn point" },
          timestamp: Date.now()
        });
        // Respawn cleanly
        if (localPlayer.Character) {
          const respawnHrp = localPlayer.Character.PrimaryPart;
          if (respawnHrp) respawnHrp.Position = this.spawnPoint;
          const h = localPlayer.Character.FindFirstChild("Humanoid") as Humanoid | null;
          if (h) h.Health = h.MaxHealth;
        }
      });
    }

    const parts = workspace.GetDescendants().filter(d => d.IsA("BasePart"));
    const tools = localPlayer.Backpack.GetChildren().filter(d => d.IsA("Tool"));
    const sensoryObservation = await this.getSensoryObservation();

    return {
      success: true,
      title: this.title,
      genre: this.genre,
      partsCount: parts.length,
      toolsCount: tools.length,
      sensoryObservation,
      logs
    };
  }

  /**
   * Dispatches embodied player actions, steps physics/collisions, and returns sensory observation
   */
  public async interact(action: PlayerAction): Promise<PlayerSensoryObservation> {
    const workspace = this.sandbox.game.Workspace;
    const player = this.sandbox.game.Players.LocalPlayer;
    const character = player.Character;
    const duration = action.stepDuration ?? action.duration ?? 0.5;

    // Normalize action parameters
    const chatMsg = action.chat || action.message;
    const targetPrompt = action.triggerPrompt || action.promptObject;
    const targetClick = action.clickObject || action.clickTarget;
    const targetTool = action.equipTool !== undefined ? action.equipTool : (action.type === "equipTool" ? action.toolName : undefined);
    const shouldUnequip = action.unequipTool || action.type === "unequipTool";
    const shouldActivate = action.activateTool || action.type === "activateTool";
    const isJump = action.jump || action.type === "jump";
    const isSprint = action.sprint || action.type === "sprint";
    const moveTarget = action.move || action.targetPosition;
    const shouldCaptureScreenshot = action.captureScreenshot || action.type === "captureScreenshot";

    // 1. Chat
    if (chatMsg) {
      this.chatHistory.push({
        sender: player.Name,
        message: chatMsg,
        timestamp: Date.now()
      });
    }

    // 2. Tool Actions
    if (targetTool !== undefined) {
      const ok = player.equipTool(targetTool);
      if (ok) {
        this.recentEvents.push({
          event: "ToolEquipped",
          details: { tool: player.equippedTool?.Name },
          timestamp: Date.now()
        });
      }
    }

    if (shouldUnequip) {
      const ok = player.unequipTool();
      if (ok) {
        this.recentEvents.push({
          event: "ToolUnequipped",
          details: {},
          timestamp: Date.now()
        });
      }
    }

    if (shouldActivate) {
      const ok = player.activateTool();
      if (ok) {
        this.recentEvents.push({
          event: "ToolActivated",
          details: { tool: player.equippedTool?.Name },
          timestamp: Date.now()
        });
      }
    }

    // 3. ProximityPrompt Interaction
    if (targetPrompt) {
      const prompts = workspace.GetDescendants().filter(d => d.IsA("ProximityPrompt")) as ProximityPrompt[];
      const prompt = prompts.find(p =>
        p.Name.toLowerCase() === targetPrompt!.toLowerCase() ||
        p.Parent?.Name.toLowerCase() === targetPrompt!.toLowerCase() ||
        p.ActionText.toLowerCase().includes(targetPrompt!.toLowerCase())
      );
      if (prompt && prompt.Enabled) {
        prompt.Triggered.Fire(player);
        this.recentEvents.push({
          event: "PromptTriggered",
          details: { promptName: prompt.Name, actionText: prompt.ActionText, parent: prompt.Parent?.Name },
          timestamp: Date.now()
        });
      }
    }

    // 4. ClickDetector Interaction
    if (targetClick) {
      const detectors = workspace.GetDescendants().filter(d => d.IsA("ClickDetector")) as ClickDetector[];
      const det = detectors.find(d =>
        d.Name.toLowerCase() === targetClick!.toLowerCase() ||
        d.Parent?.Name.toLowerCase() === targetClick!.toLowerCase()
      );
      if (det) {
        det.MouseClick.Fire(player);
        this.recentEvents.push({
          event: "ClickDetectorClicked",
          details: { parent: det.Parent?.Name },
          timestamp: Date.now()
        });
      }
    }

    // 5. Character Movement Simulation
    let walkCycle = 0;
    if (character) {
      const movement = {
        moveTo: moveTarget,
        jump: isJump,
        speed: isSprint ? 28 : (character.FindFirstChild("Humanoid") as Humanoid)?.WalkSpeed ?? 16
      };
      walkCycle = Workspace3dRenderer.stepPlayerMovement(character, movement, duration);
    }

    // 6. Physics Step & Collision Touched Dispatch
    const physResult = workspace.stepPhysics(duration);
    for (const evt of physResult.events) {
      this.recentEvents.push({
        event: evt.type,
        details: evt,
        timestamp: evt.timestamp
      });
    }

    // 7. Visual Screenshot Generation (Optional)
    let screenshotPath: string | undefined;
    let base64Png: string | undefined;

    if (shouldCaptureScreenshot) {
      const renderOptions: Workspace3dRenderOptions = {
        cameraMode: action.cameraMode || "third_person",
        cameraPosition: action.cameraPosition,
        cameraLookAt: action.cameraLookAt,
        lighting: this.sandbox.game.Lighting,
        playerModel: character,
        walkCycle,
        template: this.genre === "custom" ? "baseplate" : this.genre
      };
      const html = Workspace3dRenderer.generateHtml(workspace, renderOptions);
      const renderRes = await PlaywrightEngine.renderAndDiagnose(html, "desktop_1080p", action.outputPath);
      screenshotPath = renderRes.outputPath;
      base64Png = renderRes.base64Png;
    }

    return this.getSensoryObservation(screenshotPath, base64Png);
  }

  /**
   * Formulates complete structured sensory perception of the player in the world
   */
  public async getSensoryObservation(
    optionsOrPath?: string | { captureScreenshot?: boolean; cameraMode?: any; outputPath?: string },
    base64Png?: string
  ): Promise<PlayerSensoryObservation> {
    let screenshotPath: string | undefined = typeof optionsOrPath === "string" ? optionsOrPath : undefined;
    let b64: string | undefined = base64Png;

    if (typeof optionsOrPath === "object" && optionsOrPath.captureScreenshot) {
      const workspace = this.sandbox.game.Workspace;
      const character = this.sandbox.game.Players.LocalPlayer.Character;
      const renderOptions: Workspace3dRenderOptions = {
        cameraMode: optionsOrPath.cameraMode || "third_person",
        lighting: this.sandbox.game.Lighting,
        playerModel: character,
        template: this.genre === "custom" ? "baseplate" : this.genre
      };
      const html = Workspace3dRenderer.generateHtml(workspace, renderOptions);
      const renderRes = await PlaywrightEngine.renderAndDiagnose(html, "desktop_1080p", optionsOrPath.outputPath);
      screenshotPath = renderRes.outputPath;
      b64 = renderRes.base64Png;
    }

    const player = this.sandbox.game.Players.LocalPlayer;
    const char = player.Character;
    const hrp = char?.PrimaryPart || (char?.FindFirstChild("HumanoidRootPart") as BasePart | null);
    const humanoid = char?.FindFirstChild("Humanoid") as Humanoid | null;

    const pos = hrp ? hrp.Position : this.spawnPoint;
    const health = humanoid ? humanoid.Health : 100;
    const maxHealth = humanoid ? humanoid.MaxHealth : 100;

    // Leaderstats extraction
    const leaderstatsMap: Record<string, string | number> = {};
    const ls = player.leaderstats;
    if (ls) {
      for (const child of ls.GetChildren()) {
        if ("Value" in (child as any)) {
          leaderstatsMap[child.Name] = (child as any).Value;
        }
      }
    }

    // Backpack tools & inventory
    const backpackTools = player.Backpack.GetChildren().filter(c => c.IsA("Tool")).map(t => t.Name);
    if (player.equippedTool && !backpackTools.includes(player.equippedTool.Name)) {
      backpackTools.push(player.equippedTool.Name);
    }

    // Nearby interactables within 40 studs
    const workspace = this.sandbox.game.Workspace;
    const nearby: Array<{
      name: string;
      type: "ProximityPrompt" | "ClickDetector" | "Tool" | "Hazard" | "Part";
      distance: number;
      promptText?: string;
      key?: string;
    }> = [];

    for (const inst of workspace.GetDescendants()) {
      if (inst.IsA("ProximityPrompt")) {
        const prompt = inst as ProximityPrompt;
        const parentPart = prompt.Parent as BasePart | null;
        if (parentPart && parentPart.Position) {
          const dist = pos.sub(parentPart.Position).Magnitude;
          if (dist <= 40) {
            nearby.push({
              name: prompt.Parent?.Name || prompt.Name,
              type: "ProximityPrompt",
              distance: Math.round(dist * 10) / 10,
              promptText: prompt.ActionText + (prompt.ObjectText ? ` ${prompt.ObjectText}` : ""),
              key: prompt.KeyboardKeyCode
            });
          }
        }
      } else if (inst.IsA("ClickDetector")) {
        const det = inst as ClickDetector;
        const parentPart = det.Parent as BasePart | null;
        if (parentPart && parentPart.Position) {
          const dist = pos.sub(parentPart.Position).Magnitude;
          if (dist <= 40) {
            nearby.push({
              name: det.Parent?.Name || det.Name,
              type: "ClickDetector",
              distance: Math.round(dist * 10) / 10
            });
          }
        }
      } else if (inst.IsA("BasePart")) {
        const p = inst as BasePart;
        if (p.Name.toLowerCase().includes("kill") || p.Name.toLowerCase().includes("lava")) {
          const dist = pos.sub(p.Position).Magnitude;
          if (dist <= 40) {
            nearby.push({
              name: p.Name,
              type: "Hazard",
              distance: Math.round(dist * 10) / 10
            });
          }
        }
      }
    }

    nearby.sort((a, b) => a.distance - b.distance);

    return {
      success: true,
      player: {
        name: player.Name,
        position: [Math.round(pos.X * 10) / 10, Math.round(pos.Y * 10) / 10, Math.round(pos.Z * 10) / 10],
        health,
        maxHealth,
        isAlive: health > 0,
        walkSpeed: humanoid ? humanoid.WalkSpeed : 16,
        equippedTool: player.equippedTool?.Name ?? null,
        backpack: backpackTools,
        leaderstats: leaderstatsMap
      },
      nearbyInteractables: nearby,
      recentEvents: [...this.recentEvents],
      chatLog: [...this.chatHistory],
      logs: {
        server: [],
        client: []
      },
      screenshotPath,
      base64Png: b64
    };
  }

  // -------------------------------------------------------------
  // PRE-BUILT ROBLOX GENRE TEMPLATES
  // -------------------------------------------------------------

  private scaffoldObbyTemplate(): void {
    const workspace = this.sandbox.game.Workspace;
    const player = this.sandbox.game.Players.LocalPlayer;

    // Leaderstats: Stage
    const ls = InstanceEngine.new("Folder", player);
    ls.Name = "leaderstats";
    const stageVal = InstanceEngine.new("IntValue", ls) as any;
    stageVal.Name = "Stage";
    stageVal.Value = 1;

    // Baseplate
    Workspace3dRenderer.populateTemplate(workspace, "baseplate");

    // Stage 1 Start Platform
    const stage1 = InstanceEngine.new("Part", workspace) as BasePart;
    stage1.Name = "Stage1_Platform";
    stage1.Size = new Vector3(14, 1, 14);
    stage1.Position = new Vector3(0, 1, 0);
    stage1.Color = Color3.fromRGB(80, 80, 85);
    stage1.Anchored = true;

    // Floating Jump Pads
    const pad1 = InstanceEngine.new("Part", workspace) as BasePart;
    pad1.Name = "JumpPad_Cyan";
    pad1.Size = new Vector3(5, 1, 5);
    pad1.Position = new Vector3(0, 3, -12);
    pad1.Color = Color3.fromRGB(0, 190, 255);
    pad1.Anchored = true;

    const pad2 = InstanceEngine.new("Part", workspace) as BasePart;
    pad2.Name = "JumpPad_Yellow";
    pad2.Size = new Vector3(5, 1, 5);
    pad2.Position = new Vector3(6, 5, -22);
    pad2.Color = Color3.fromRGB(255, 210, 0);
    pad2.Anchored = true;

    // Red Neon Kill Brick
    const killBrick = InstanceEngine.new("Part", workspace) as BasePart;
    killBrick.Name = "KillBrick_Laser";
    killBrick.Size = new Vector3(14, 1.5, 2);
    killBrick.Position = new Vector3(0, 4.5, -17);
    killBrick.Color = Color3.fromRGB(255, 20, 20);
    killBrick.Material = "Neon";
    killBrick.Anchored = true;
    killBrick.CanTouch = true;
    killBrick.Touched.Connect((hit: any) => {
      if (hit && hit.Parent) {
        const h = hit.Parent.FindFirstChild("Humanoid") as Humanoid | null;
        if (h) h.TakeDamage(100);
      }
    });

    const pad3 = InstanceEngine.new("Part", workspace) as BasePart;
    pad3.Name = "JumpPad_Green";
    pad3.Size = new Vector3(5, 1, 5);
    pad3.Position = new Vector3(0, 7, -32);
    pad3.Color = Color3.fromRGB(50, 220, 100);
    pad3.Anchored = true;

    // Stage 2 Checkpoint Platform
    const checkpoint2 = InstanceEngine.new("Part", workspace) as BasePart;
    checkpoint2.Name = "Checkpoint_Stage2";
    checkpoint2.Size = new Vector3(12, 1, 12);
    checkpoint2.Position = new Vector3(0, 9, -46);
    checkpoint2.Color = Color3.fromRGB(240, 200, 30);
    checkpoint2.Anchored = true;
    checkpoint2.CanTouch = true;
    checkpoint2.Touched.Connect((hit: any) => {
      if (hit && hit.Parent) {
        const p = this.sandbox.game.Players.GetPlayerFromCharacter(hit.Parent);
        if (p && p.leaderstats) {
          const st = p.leaderstats.FindFirstChild("Stage") as any;
          if (st && st.Value < 2) {
            st.Value = 2;
            this.recentEvents.push({
              event: "StageCompleted",
              details: { stage: 2, player: p.Name },
              timestamp: Date.now()
            });
          }
        }
      }
    });
  }

  private scaffoldSwordArenaTemplate(): void {
    const workspace = this.sandbox.game.Workspace;
    const player = this.sandbox.game.Players.LocalPlayer;

    // Leaderstats: Kills
    const ls = InstanceEngine.new("Folder", player);
    ls.Name = "leaderstats";
    const killsVal = InstanceEngine.new("IntValue", ls) as any;
    killsVal.Name = "Kills";
    killsVal.Value = 0;

    // Arena Floor
    Workspace3dRenderer.populateTemplate(workspace, "baseplate");

    // Classic Sword in StarterPack & Backpack
    const sword = new Tool();
    sword.Name = "ClassicSword";
    sword.ToolTip = "Slash enemies for 35 DMG";

    const handle = new BasePart("Part");
    handle.Name = "Handle";
    handle.Size = new Vector3(1, 3.5, 0.4);
    handle.Color = Color3.fromRGB(180, 190, 205);
    handle.Material = "Metal";
    handle.Parent = sword;

    sword.Activated.Connect(() => {
      // Raycast forward from character
      if (!player.Character) return;
      const hrp = player.Character.PrimaryPart;
      if (!hrp) return;
      const lookDir = hrp.CFrame.LookVector;
      const params = new RaycastParams();
      params.FilterDescendantsInstances = [player.Character];
      params.FilterType = "Exclude";
      const hit = workspace.Raycast(hrp.Position, lookDir.mul(12), params);
      if (hit && hit.Instance) {
        const victimChar = hit.Instance.Parent as Model | null;
        if (victimChar && victimChar !== player.Character) {
          const victimHum = victimChar.FindFirstChild("Humanoid") as Humanoid | null;
          if (victimHum) {
            victimHum.TakeDamage(35);
            this.recentEvents.push({
              event: "DamageDealt",
              details: { target: victimChar.Name, damage: 35, remainingHealth: victimHum.Health },
              timestamp: Date.now()
            });
            if (victimHum.Health === 0) {
              killsVal.Value += 1;
              this.recentEvents.push({
                event: "KillScored",
                details: { target: victimChar.Name, totalKills: killsVal.Value },
                timestamp: Date.now()
              });
            }
          }
        }
      }
    });

    sword.Parent = player.Backpack;

    // Training Dummy NPC
    const dummy = new Model();
    dummy.Name = "TrainingDummy";

    const dummyHum = new Humanoid();
    dummyHum.DisplayName = "Training Dummy";
    dummyHum.Parent = dummy;

    const dHrp = new BasePart("Part");
    dHrp.Name = "HumanoidRootPart";
    dHrp.Size = new Vector3(2, 2, 1);
    dHrp.Position = new Vector3(0, 3, -6);
    dHrp.Transparency = 1;
    dHrp.Anchored = true;
    dHrp.Parent = dummy;
    dummy.PrimaryPart = dHrp;

    const dTorso = new BasePart("Part");
    dTorso.Name = "Torso";
    dTorso.Size = new Vector3(2, 2, 1);
    dTorso.Position = new Vector3(0, 3, -6);
    dTorso.Color = Color3.fromRGB(170, 40, 40);
    dTorso.Anchored = true;
    dTorso.Parent = dummy;

    const dHead = new BasePart("Part");
    dHead.Name = "Head";
    dHead.Size = new Vector3(1.25, 1.25, 1.25);
    dHead.Position = new Vector3(0, 4.5, -6);
    dHead.Color = Color3.fromRGB(245, 205, 47);
    dHead.Anchored = true;
    dHead.Parent = dummy;

    dummy.Parent = workspace;
  }

  private scaffoldTycoonTemplate(): void {
    const workspace = this.sandbox.game.Workspace;
    const player = this.sandbox.game.Players.LocalPlayer;

    // Leaderstats: Coins
    const ls = InstanceEngine.new("Folder", player);
    ls.Name = "leaderstats";
    const coinsVal = InstanceEngine.new("IntValue", ls) as any;
    coinsVal.Name = "Coins";
    coinsVal.Value = 0;

    Workspace3dRenderer.populateTemplate(workspace, "baseplate");

    // Conveyor Pad
    const conveyor = InstanceEngine.new("Part", workspace) as BasePart;
    conveyor.Name = "Conveyor";
    conveyor.Size = new Vector3(6, 1, 24);
    conveyor.Position = new Vector3(-8, 1, -12);
    conveyor.Color = Color3.fromRGB(40, 40, 45);
    conveyor.Anchored = true;

    // Collector Pad (collects coins on step)
    const collector = InstanceEngine.new("Part", workspace) as BasePart;
    collector.Name = "CoinCollector_Pad";
    collector.Size = new Vector3(8, 0.8, 8);
    collector.Position = new Vector3(-8, 1.2, 2);
    collector.Color = Color3.fromRGB(0, 200, 100);
    collector.Material = "Neon";
    collector.Anchored = true;
    collector.CanTouch = true;
    let coinDebounce = false;
    collector.Touched.Connect((hit: any) => {
      if (coinDebounce) return;
      coinDebounce = true;
      coinsVal.Value += 15;
      this.recentEvents.push({
        event: "CoinsCollected",
        details: { amount: 15, total: coinsVal.Value },
        timestamp: Date.now()
      });
      setTimeout(() => {
        coinDebounce = false;
      }, 1500);
    });

    // ProximityPrompt Shop Button
    const shopBtn = InstanceEngine.new("Part", workspace) as BasePart;
    shopBtn.Name = "ShopButton_SpeedCoil";
    shopBtn.Size = new Vector3(5, 1, 5);
    shopBtn.Position = new Vector3(8, 1, -8);
    shopBtn.Color = Color3.fromRGB(0, 150, 255);
    shopBtn.Anchored = true;

    const prompt = new ProximityPrompt();
    prompt.Name = "BuySpeedCoil_Prompt";
    prompt.ActionText = "Buy Speed Coil";
    prompt.ObjectText = "(10 Coins)";
    prompt.KeyboardKeyCode = "E";
    prompt.HoldDuration = 0.2;
    prompt.Parent = shopBtn;

    prompt.Triggered.Connect((p: any) => {
      if (coinsVal.Value >= 10) {
        coinsVal.Value -= 10;
        const coil = new Tool();
        coil.Name = "SpeedCoil";
        coil.ToolTip = "Gives 32 WalkSpeed";
        const h = new BasePart("Part");
        h.Name = "Handle";
        h.Size = new Vector3(1, 2, 1);
        h.Color = Color3.fromRGB(0, 220, 255);
        h.Parent = coil;
        coil.Equipped.Connect(() => {
          const char = p.Character;
          if (char) {
            const hum = char.FindFirstChild("Humanoid") as Humanoid | null;
            if (hum) hum.WalkSpeed = 32;
          }
        });
        coil.Unequipped.Connect(() => {
          const char = p.Character;
          if (char) {
            const hum = char.FindFirstChild("Humanoid") as Humanoid | null;
            if (hum) hum.WalkSpeed = 16;
          }
        });
        coil.Parent = p.Backpack;
        p.equipTool(coil);
        this.recentEvents.push({
          event: "ItemPurchased",
          details: { item: "SpeedCoil", price: 10, remainingCoins: coinsVal.Value },
          timestamp: Date.now()
        });
      }
    });
  }
}
