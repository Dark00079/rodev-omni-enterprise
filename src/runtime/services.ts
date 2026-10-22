/**
 * Roblox Core Services & 3D Spatial Query Engine
 * Workspace raycasting, TweenService keyframe stepping, UserInputService,
 * DataStoreService with fault injection, Players, and CoreGui.
 */

import { Vector2, Vector3, CFrame, RaycastParams, RaycastResult, OverlapParams, TweenInfo, Rect, Enum, Color3 } from './datatypes.js';
import { Instance, BasePart, Model, Humanoid, Motor6D, Tool, ClickDetector, ProximityPrompt, BillboardGui, Sound, Backpack, RBXScriptSignal, RBXScriptConnection } from './instanceEngine.js';

export interface RaycastDebugRecord {
  origin: Vector3;
  direction: Vector3;
  hit: boolean;
  result: RaycastResult | null;
  timestamp: number;
}

export class Camera extends Instance {
  public CFrame: CFrame = new CFrame(0, 10, 20).mul(CFrame.Angles(-0.3, 0, 0));
  public FieldOfView: number = 70;
  public ViewportSize: Vector2 = new Vector2(1920, 1080);

  constructor() {
    super("Camera");
  }

  public WorldToViewportPoint(worldPoint: Vector3): [Vector3, boolean] {
    const objectPoint = this.CFrame.PointToObjectSpace(worldPoint);
    // Camera looks down -Z
    const isVisible = objectPoint.Z < 0;
    const aspect = this.ViewportSize.X / this.ViewportSize.Y;
    const fovRad = (this.FieldOfView * Math.PI) / 180;
    const tanHalfFov = Math.tan(fovRad / 2);

    const screenX = (objectPoint.X / (-objectPoint.Z * tanHalfFov * aspect) + 1) * 0.5 * this.ViewportSize.X;
    const screenY = (1 - objectPoint.Y / (-objectPoint.Z * tanHalfFov)) * 0.5 * this.ViewportSize.Y;

    return [new Vector3(screenX, screenY, -objectPoint.Z), isVisible];
  }

  public WorldToScreenPoint(worldPoint: Vector3): [Vector3, boolean] {
    return this.WorldToViewportPoint(worldPoint);
  }
}

export class WorkspaceService extends Instance {
  public CurrentCamera: Camera;
  public Gravity: number = 196.2;
  public raycastHistory: RaycastDebugRecord[] = [];

  constructor() {
    super("Workspace");
    this.CurrentCamera = new Camera();
    this.CurrentCamera.Parent = this;
  }

  /**
   * Physics Collision & Touched Signal Stepper
   * Evaluates AABB overlaps between character limbs and CanTouch parts (kill bricks, checkpoints, coins)
   */
  public stepPhysics(dt: number = 0.1): { touchedEventsCount: number; events: any[] } {
    const events: any[] = [];
    const allParts = this.GetDescendants().filter(d => d.IsA("BasePart")) as BasePart[];
    const touchingParts = allParts.filter(p => p.CanTouch);

    // Find characters
    const playersService = this.Parent?.FindFirstChild("Players") as PlayersService | null;
    const players = playersService ? playersService.GetPlayers() : [];

    for (const player of players) {
      const char = player.Character;
      if (!char) continue;
      const hrp = char.PrimaryPart || (char.FindFirstChild("HumanoidRootPart") as BasePart | null);
      if (!hrp) continue;

      const pPos = hrp.Position;
      const pRadius = 1.5;

      for (const part of touchingParts) {
        if (part.IsDescendantOf(char)) continue; // ignore self parts
        const partPos = part.Position;
        const halfSize = part.Size.mul(0.5);

        const minX = partPos.X - halfSize.X - pRadius;
        const maxX = partPos.X + halfSize.X + pRadius;
        const minY = partPos.Y - halfSize.Y - pRadius;
        const maxY = partPos.Y + halfSize.Y + pRadius;
        const minZ = partPos.Z - halfSize.Z - pRadius;
        const maxZ = partPos.Z + halfSize.Z + pRadius;

        if (
          pPos.X >= minX && pPos.X <= maxX &&
          pPos.Y >= minY && pPos.Y <= maxY &&
          pPos.Z >= minZ && pPos.Z <= maxZ
        ) {
          part.Touched.Fire(hrp);
          hrp.Touched.Fire(part);
          events.push({
            type: "Touched",
            part: part.Name,
            characterPart: hrp.Name,
            timestamp: Date.now()
          });
        }
      }
    }

    return { touchedEventsCount: events.length, events };
  }

  /**
   * Authentic 3D Ray-OBB Intersection (Slab Method in Part Local Space)
   */
  public Raycast(origin: Vector3, direction: Vector3, params?: RaycastParams): RaycastResult | null {
    if (direction.Magnitude === 0) return null;

    const allParts = this.GetDescendants().filter(d => d.IsA("BasePart")) as BasePart[];
    let closestDist = Infinity;
    let closestResult: RaycastResult | null = null;

    const filterInstances = params?.FilterDescendantsInstances || [];
    const isExclude = params?.FilterType === 0 || params?.FilterType === "Exclude" || !params?.FilterType;

    for (const part of allParts) {
      if (!part.CanQuery) continue;

      // Filter check
      let inFilter = false;
      for (const filterRoot of filterInstances) {
        if (part === filterRoot || part.IsDescendantOf(filterRoot)) {
          inFilter = true;
          break;
        }
      }

      if (isExclude && inFilter) continue;
      if (!isExclude && !inFilter) continue;

      // Transform ray into part's local coordinate space
      const invCf = part.CFrame.Inverse();
      const localOrigin = invCf.PointToWorldSpace(origin);
      const localDir = invCf.VectorToWorldSpace(direction);

      const halfSize = part.Size.mul(0.5);
      const hit = this.intersectRayAABB(localOrigin, localDir, halfSize.mul(-1), halfSize);

      if (hit && hit.t >= 0 && hit.t <= 1) {
        const hitDistance = direction.mul(hit.t).Magnitude;
        if (hitDistance < closestDist) {
          closestDist = hitDistance;
          const worldHitPos = origin.add(direction.mul(hit.t));
          const worldNormal = part.CFrame.VectorToWorldSpace(hit.normal).Unit;
          closestResult = new RaycastResult(part, worldHitPos, worldNormal, hitDistance, part.Material);
        }
      }
    }

    // Record in debug log for 3D visualizer
    this.raycastHistory.push({
      origin,
      direction,
      hit: closestResult !== null,
      result: closestResult,
      timestamp: Date.now()
    });

    return closestResult;
  }

  private intersectRayAABB(
    ro: Vector3,
    rd: Vector3,
    boxMin: Vector3,
    boxMax: Vector3
  ): { t: number; normal: Vector3 } | null {
    let tmin = -Infinity;
    let tmax = Infinity;
    let normal = Vector3.zero;

    const axes: Array<[number, number, number, Vector3]> = [
      [ro.X, rd.X, boxMin.X, new Vector3(-1, 0, 0)],
      [ro.Y, rd.Y, boxMin.Y, new Vector3(0, -1, 0)],
      [ro.Z, rd.Z, boxMin.Z, new Vector3(0, 0, -1)],
    ];
    const maxAxes = [boxMax.X, boxMax.Y, boxMax.Z];

    for (let i = 0; i < 3; i++) {
      const [pos, dir, minVal, negNormal] = axes[i];
      const maxVal = maxAxes[i];

      if (Math.abs(dir) < 1e-8) {
        if (pos < minVal || pos > maxVal) return null;
      } else {
        let t1 = (minVal - pos) / dir;
        let t2 = (maxVal - pos) / dir;
        let n1 = negNormal;
        let n2 = negNormal.mul(-1);

        if (t1 > t2) {
          [t1, t2] = [t2, t1];
          [n1, n2] = [n2, n1];
        }

        if (t1 > tmin) {
          tmin = t1;
          normal = n1;
        }
        if (t2 < tmax) {
          tmax = t2;
        }

        if (tmin > tmax || tmax < 0) return null;
      }
    }

    return { t: tmin, normal };
  }

  public GetPartBoundsInBox(cframe: CFrame, size: Vector3, params?: OverlapParams): BasePart[] {
    const halfSize = size.mul(0.5);
    const boxMin = cframe.Position.sub(halfSize);
    const boxMax = cframe.Position.add(halfSize);

    const allParts = this.GetDescendants().filter(d => d.IsA("BasePart")) as BasePart[];
    return allParts.filter(p => {
      const pos = p.Position;
      return (
        pos.X >= boxMin.X && pos.X <= boxMax.X &&
        pos.Y >= boxMin.Y && pos.Y <= boxMax.Y &&
        pos.Z >= boxMin.Z && pos.Z <= boxMax.Z
      );
    });
  }

  public GetPartBoundsInRadius(position: Vector3, radius: number, params?: OverlapParams): BasePart[] {
    const allParts = this.GetDescendants().filter(d => d.IsA("BasePart")) as BasePart[];
    return allParts.filter(p => p.Position.sub(position).Magnitude <= radius);
  }
}

export class Tween {
  public Instance: Instance;
  public TweenInfo: TweenInfo;
  public PropertyGoals: Record<string, any>;
  public InitialProperties: Record<string, any> = {};
  public PlaybackState: string = "Begin";
  public readonly Completed: RBXScriptSignal;

  constructor(instance: Instance, tweenInfo: TweenInfo, propertyGoals: Record<string, any>) {
    this.Instance = instance;
    this.TweenInfo = tweenInfo;
    this.PropertyGoals = propertyGoals;
    this.Completed = new RBXScriptSignal("Completed", instance);

    for (const prop of Object.keys(propertyGoals)) {
      this.InitialProperties[prop] = (instance as any)[prop];
    }
  }

  public Play(): void {
    this.PlaybackState = "Playing";
    // Complete automatically or allow manual keyframe stepping
  }

  public Pause(): void {
    this.PlaybackState = "Paused";
  }

  public Cancel(): void {
    this.PlaybackState = "Cancelled";
  }

  /**
   * Step interpolation to specific progress alpha (0.0 to 1.0)
   */
  public stepTo(alpha: number): void {
    alpha = Math.max(0, Math.min(1, alpha));
    for (const [prop, goalVal] of Object.entries(this.PropertyGoals)) {
      const initVal = this.InitialProperties[prop];
      if (initVal && typeof initVal.Lerp === 'function') {
        (this.Instance as any)[prop] = initVal.Lerp(goalVal, alpha);
      } else if (typeof initVal === 'number' && typeof goalVal === 'number') {
        (this.Instance as any)[prop] = initVal + (goalVal - initVal) * alpha;
      } else if (alpha >= 1) {
        (this.Instance as any)[prop] = goalVal;
      }
      this.Instance.firePropertyChanged(prop);
    }
    if (alpha >= 1) {
      this.PlaybackState = "Completed";
      this.Completed.Fire(Enum.PlaybackState?.Completed ?? 0);
    }
  }
}

export class TweenService extends Instance {
  private activeTweens: Tween[] = [];

  constructor() {
    super("TweenService");
  }

  public Create(instance: Instance, tweenInfo: TweenInfo, propertyGoals: Record<string, any>): Tween {
    const tween = new Tween(instance, tweenInfo, propertyGoals);
    this.activeTweens.push(tween);
    return tween;
  }

  public getActiveTweens(): Tween[] {
    return this.activeTweens;
  }
}

export class UserInputService extends Instance {
  public MouseBehavior: any = "Default";
  public readonly InputBegan: RBXScriptSignal;
  public readonly InputEnded: RBXScriptSignal;
  public readonly InputChanged: RBXScriptSignal;
  private mousePos: Vector2 = new Vector2(0, 0);
  private pressedKeys: Set<string> = new Set();

  constructor() {
    super("UserInputService");
    this.InputBegan = new RBXScriptSignal("InputBegan", this);
    this.InputEnded = new RBXScriptSignal("InputEnded", this);
    this.InputChanged = new RBXScriptSignal("InputChanged", this);
  }

  public GetMouseLocation(): Vector2 {
    return this.mousePos;
  }

  public setMouseLocation(x: number, y: number): void {
    this.mousePos = new Vector2(x, y);
  }

  public IsKeyDown(keyCode: any): boolean {
    const keyName = typeof keyCode === 'string' ? keyCode : keyCode?.Name || String(keyCode);
    return this.pressedKeys.has(keyName);
  }

  public simulateKeyDown(keyName: string): void {
    this.pressedKeys.add(keyName);
    this.InputBegan.Fire({ KeyCode: { Name: keyName }, UserInputType: { Name: "Keyboard" } }, false);
  }

  public simulateKeyUp(keyName: string): void {
    this.pressedKeys.delete(keyName);
    this.InputEnded.Fire({ KeyCode: { Name: keyName }, UserInputType: { Name: "Keyboard" } }, false);
  }
}

export class RunService extends Instance {
  public readonly Heartbeat: RBXScriptSignal;
  public readonly RenderStepped: RBXScriptSignal;
  public readonly Stepped: RBXScriptSignal;

  constructor() {
    super("RunService");
    this.Heartbeat = new RBXScriptSignal("Heartbeat", this);
    this.RenderStepped = new RBXScriptSignal("RenderStepped", this);
    this.Stepped = new RBXScriptSignal("Stepped", this);
  }

  public IsClient(): boolean { return true; }
  public IsServer(): boolean { return false; }
  public IsStudio(): boolean { return false; }
}

export class LightingService extends Instance {
  public ClockTime: number = 14.0;
  public TimeOfDay: string = "14:00:00";
  public Brightness: number = 2.0;
  public Ambient: Color3 = Color3.fromRGB(70, 70, 70);
  public OutdoorAmbient: Color3 = Color3.fromRGB(128, 128, 128);
  public FogEnd: number = 100000;
  public FogStart: number = 0;
  public FogColor: Color3 = Color3.fromRGB(192, 192, 192);
  public ShadowSoftness: number = 0.5;
  public GlobalShadows: boolean = true;

  constructor() {
    super("Lighting");
  }

  public get SunDirection(): Vector3 {
    const angle = ((this.ClockTime - 6) / 12) * Math.PI;
    const y = Math.sin(angle);
    const x = Math.cos(angle);
    return new Vector3(x, Math.max(0.05, y), 0.3).Unit;
  }
}

export class Player extends Instance {
  public UserId: number = 10000001;
  public Character: Model | null = null;
  public Backpack: Backpack;
  public PlayerGui: Instance;
  public readonly CharacterAdded: RBXScriptSignal;
  public readonly CharacterRemoving: RBXScriptSignal;
  public equippedTool: Tool | null = null;

  constructor(name: string = "LocalPlayer") {
    super("Player");
    this.Name = name;
    this.Backpack = new Backpack();
    this.Backpack.Parent = this;
    this.PlayerGui = new Instance("PlayerGui");
    this.PlayerGui.Parent = this;
    this.CharacterAdded = new RBXScriptSignal("CharacterAdded", this);
    this.CharacterRemoving = new RBXScriptSignal("CharacterRemoving", this);
  }

  public get leaderstats(): Instance | null {
    return this.FindFirstChild("leaderstats");
  }

  public equipTool(toolIdentifier: Tool | string | number): boolean {
    let toolToEquip: Tool | null = null;
    const backpackTools = this.Backpack.GetChildren().filter(c => c.IsA("Tool")) as Tool[];

    if (typeof toolIdentifier === 'number') {
      const idx = toolIdentifier - 1;
      if (idx >= 0 && idx < backpackTools.length) {
        toolToEquip = backpackTools[idx];
      }
    } else if (typeof toolIdentifier === 'string') {
      toolToEquip = backpackTools.find(t => t.Name.toLowerCase() === toolIdentifier.toLowerCase()) || null;
    } else if (toolIdentifier instanceof Tool) {
      toolToEquip = toolIdentifier;
    }

    if (!toolToEquip || !this.Character) return false;

    // Unequip currently equipped tool if any
    if (this.equippedTool) {
      this.unequipTool();
    }

    // Move to character
    toolToEquip.Parent = this.Character;
    this.equippedTool = toolToEquip;

    // Attach RightGrip Motor6D to Right Arm
    const rightArm = this.Character.FindFirstChild("Right Arm") as BasePart | null;
    const handle = toolToEquip.FindFirstChild("Handle") as BasePart | null;
    if (rightArm && handle) {
      const grip = new Motor6D();
      grip.Name = "RightGrip";
      grip.Part0 = rightArm;
      grip.Part1 = handle;
      grip.Parent = rightArm;
    }

    toolToEquip.Equipped.Fire();
    return true;
  }

  public unequipTool(): boolean {
    if (!this.equippedTool) return false;
    const tool = this.equippedTool;
    this.equippedTool = null;
    if (this.Character) {
      const rightArm = this.Character.FindFirstChild("Right Arm") as BasePart | null;
      if (rightArm) {
        const grip = rightArm.FindFirstChild("RightGrip");
        if (grip) grip.Destroy();
      }
    }
    if (!(tool as any)._destroyed && this.Backpack && !(this.Backpack as any)._destroyed) {
      tool.Parent = this.Backpack;
      tool.Unequipped.Fire();
    }
    return true;
  }

  public activateTool(): boolean {
    if (!this.equippedTool) return false;
    this.equippedTool.Activate();
    return true;
  }

  public spawnMockCharacter(rigType: "R6" | "R15" = "R6", basePosition: Vector3 = new Vector3(0, 3, 0)): Model {
    const model = new Model();
    model.Name = this.Name;

    const humanoid = new Humanoid();
    humanoid.RigType = rigType;
    humanoid.Parent = model;

    const hrp = new BasePart("Part");
    hrp.Name = "HumanoidRootPart";
    hrp.Size = new Vector3(2, 2, 1);
    hrp.Position = basePosition;
    hrp.Transparency = 1;
    hrp.CanCollide = false;
    hrp.Parent = model;
    model.PrimaryPart = hrp;

    const torso = new BasePart("Part");
    torso.Name = "Torso";
    torso.Size = new Vector3(2, 2, 1);
    torso.Position = basePosition;
    torso.Color = Color3.fromRGB(13, 105, 172); // Classic Roblox Bright Blue
    torso.Parent = model;

    const head = new BasePart("Part");
    head.Name = "Head";
    head.Size = new Vector3(1.25, 1.25, 1.25);
    head.Position = new Vector3(basePosition.X, basePosition.Y + 1.5, basePosition.Z);
    head.Color = Color3.fromRGB(245, 205, 47); // Classic Roblox Bright Yellow
    head.Parent = model;

    const leftArm = new BasePart("Part");
    leftArm.Name = "Left Arm";
    leftArm.Size = new Vector3(1, 2, 1);
    leftArm.Position = new Vector3(basePosition.X - 1.5, basePosition.Y, basePosition.Z);
    leftArm.Color = Color3.fromRGB(245, 205, 47);
    leftArm.Parent = model;

    const rightArm = new BasePart("Part");
    rightArm.Name = "Right Arm";
    rightArm.Size = new Vector3(1, 2, 1);
    rightArm.Position = new Vector3(basePosition.X + 1.5, basePosition.Y, basePosition.Z);
    rightArm.Color = Color3.fromRGB(245, 205, 47);
    rightArm.Parent = model;

    const leftLeg = new BasePart("Part");
    leftLeg.Name = "Left Leg";
    leftLeg.Size = new Vector3(1, 2, 1);
    leftLeg.Position = new Vector3(basePosition.X - 0.5, basePosition.Y - 2, basePosition.Z);
    leftLeg.Color = Color3.fromRGB(164, 189, 71); // Classic Br. yellowish green
    leftLeg.Parent = model;

    const rightLeg = new BasePart("Part");
    rightLeg.Name = "Right Leg";
    rightLeg.Size = new Vector3(1, 2, 1);
    rightLeg.Position = new Vector3(basePosition.X + 0.5, basePosition.Y - 2, basePosition.Z);
    rightLeg.Color = Color3.fromRGB(164, 189, 71);
    rightLeg.Parent = model;

    // Attach Motor6D joints
    const rootJoint = new Motor6D();
    rootJoint.Name = "RootJoint";
    rootJoint.Part0 = hrp;
    rootJoint.Part1 = torso;
    rootJoint.Parent = hrp;

    const neck = new Motor6D();
    neck.Name = "Neck";
    neck.Part0 = torso;
    neck.Part1 = head;
    neck.Parent = torso;

    const leftShoulder = new Motor6D();
    leftShoulder.Name = "Left Shoulder";
    leftShoulder.Part0 = torso;
    leftShoulder.Part1 = leftArm;
    leftShoulder.Parent = torso;

    const rightShoulder = new Motor6D();
    rightShoulder.Name = "Right Shoulder";
    rightShoulder.Part0 = torso;
    rightShoulder.Part1 = rightArm;
    rightShoulder.Parent = torso;

    const leftHip = new Motor6D();
    leftHip.Name = "Left Hip";
    leftHip.Part0 = torso;
    leftHip.Part1 = leftLeg;
    leftHip.Parent = torso;

    const rightHip = new Motor6D();
    rightHip.Name = "Right Hip";
    rightHip.Part0 = torso;
    rightHip.Part1 = rightLeg;
    rightHip.Parent = torso;

    this.Character = model;
    this.CharacterAdded.Fire(model);
    return model;
  }
}

export class PlayersService extends Instance {
  public LocalPlayer: Player;
  private players: Player[] = [];
  public readonly PlayerAdded: RBXScriptSignal;
  public readonly PlayerRemoving: RBXScriptSignal;

  constructor() {
    super("Players");
    this.LocalPlayer = new Player("LocalPlayer");
    this.players.push(this.LocalPlayer);
    this.LocalPlayer.Parent = this;
    this.PlayerAdded = new RBXScriptSignal("PlayerAdded", this);
    this.PlayerRemoving = new RBXScriptSignal("PlayerRemoving", this);
  }

  public GetPlayers(): Player[] {
    return [...this.players];
  }

  public GetPlayerFromCharacter(char: Instance): Player | null {
    return this.players.find(p => p.Character === char) || null;
  }

  public getPlayerFromCharacter(char: Instance): Player | null {
    return this.GetPlayerFromCharacter(char);
  }
}

export class HttpService extends Instance {
  constructor() {
    super("HttpService");
  }

  public JSONEncode(input: any): string {
    return JSON.stringify(input);
  }

  public JSONDecode(jsonStr: string): any {
    return JSON.parse(jsonStr);
  }

  public GenerateGUID(wrapInCurlyBraces: boolean = true): string {
    const guid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    return wrapInCurlyBraces ? `{${guid}}` : guid;
  }

  public async GetAsync(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
    return await res.text();
  }

  public async PostAsync(url: string, data: string): Promise<string> {
    const res = await fetch(url, { method: "POST", body: data });
    if (!res.ok) throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
    return await res.text();
  }
}

export class GlobalDataStore {
  public readonly name: string;
  private storage: Map<string, any> = new Map();
  public faultMode: 'none' | 'timeout' | 'throttle_429' | 'corrupt' = 'none';

  constructor(name: string) {
    this.name = name;
  }

  public async GetAsync(key: string): Promise<any> {
    if (this.faultMode === 'timeout') throw new Error("DataStore request timed out (504)");
    if (this.faultMode === 'throttle_429') throw new Error("DataStore rate limit exceeded (429)");
    if (this.faultMode === 'corrupt') return "INVALID_JSON_CORRUPT{[[";
    return this.storage.has(key) ? this.storage.get(key) : null;
  }

  public async SetAsync(key: string, value: any): Promise<void> {
    if (this.faultMode === 'throttle_429') throw new Error("DataStore rate limit exceeded (429)");
    this.storage.set(key, value);
  }

  public async UpdateAsync(key: string, transformFn: (oldVal: any) => any): Promise<any> {
    const oldVal = await this.GetAsync(key);
    const newVal = transformFn(oldVal);
    await this.SetAsync(key, newVal);
    return newVal;
  }

  public async RemoveAsync(key: string): Promise<any> {
    const val = await this.GetAsync(key);
    this.storage.delete(key);
    return val;
  }

  public clear(): void {
    this.storage.clear();
  }
}

export class DataStoreService extends Instance {
  private stores: Map<string, GlobalDataStore> = new Map();
  public globalFault: 'none' | 'timeout' | 'throttle_429' | 'corrupt' = 'none';

  constructor() {
    super("DataStoreService");
  }

  public GetDataStore(name: string): GlobalDataStore {
    let store = this.stores.get(name);
    if (!store) {
      store = new GlobalDataStore(name);
      store.faultMode = this.globalFault;
      this.stores.set(name, store);
    }
    return store;
  }

  public setFaultMode(fault: 'none' | 'timeout' | 'throttle_429' | 'corrupt'): void {
    this.globalFault = fault;
    for (const store of this.stores.values()) {
      store.faultMode = fault;
    }
  }
}

export class CoreGuiService extends Instance {
  constructor() {
    super("CoreGui");
  }
}

// Master Roblox DataModel Root (`game`)
export class DataModel extends Instance {
  public readonly Workspace: WorkspaceService;
  public readonly Players: PlayersService;
  public readonly CoreGui: CoreGuiService;
  public readonly TweenService: TweenService;
  public readonly UserInputService: UserInputService;
  public readonly RunService: RunService;
  public readonly HttpService: HttpService;
  public readonly DataStoreService: DataStoreService;
  public readonly ReplicatedStorage: Instance;
  public readonly ServerScriptService: Instance;
  public readonly StarterPack: Instance;
  public readonly StarterGui: Instance;
  public readonly StarterPlayer: Instance;
  public readonly SoundService: Instance;
  public readonly ProximityPromptService: Instance;
  public readonly Lighting: LightingService;

  private serviceMap: Map<string, Instance> = new Map();

  constructor() {
    super("DataModel");
    this.Name = "game";

    this.Workspace = new WorkspaceService();
    this.Workspace.Parent = this;
    this.serviceMap.set("Workspace", this.Workspace);

    this.Players = new PlayersService();
    this.Players.Parent = this;
    this.serviceMap.set("Players", this.Players);

    this.CoreGui = new CoreGuiService();
    this.CoreGui.Parent = this;
    this.serviceMap.set("CoreGui", this.CoreGui);

    this.TweenService = new TweenService();
    this.TweenService.Parent = this;
    this.serviceMap.set("TweenService", this.TweenService);

    this.UserInputService = new UserInputService();
    this.UserInputService.Parent = this;
    this.serviceMap.set("UserInputService", this.UserInputService);

    this.RunService = new RunService();
    this.RunService.Parent = this;
    this.serviceMap.set("RunService", this.RunService);

    this.HttpService = new HttpService();
    this.HttpService.Parent = this;
    this.serviceMap.set("HttpService", this.HttpService);

    this.DataStoreService = new DataStoreService();
    this.DataStoreService.Parent = this;
    this.serviceMap.set("DataStoreService", this.DataStoreService);

    this.ReplicatedStorage = new Instance("ReplicatedStorage");
    this.ReplicatedStorage.Parent = this;
    this.serviceMap.set("ReplicatedStorage", this.ReplicatedStorage);

    this.ServerScriptService = new Instance("ServerScriptService");
    this.ServerScriptService.Parent = this;
    this.serviceMap.set("ServerScriptService", this.ServerScriptService);

    this.StarterPack = new Instance("StarterPack");
    this.StarterPack.Parent = this;
    this.serviceMap.set("StarterPack", this.StarterPack);

    this.StarterGui = new Instance("StarterGui");
    this.StarterGui.Parent = this;
    this.serviceMap.set("StarterGui", this.StarterGui);

    this.StarterPlayer = new Instance("StarterPlayer");
    this.StarterPlayer.Parent = this;
    const starterPlayerScripts = new Instance("StarterPlayerScripts");
    starterPlayerScripts.Parent = this.StarterPlayer;
    const starterCharScripts = new Instance("StarterCharacterScripts");
    starterCharScripts.Parent = this.StarterPlayer;
    this.serviceMap.set("StarterPlayer", this.StarterPlayer);

    this.SoundService = new Instance("SoundService");
    this.SoundService.Parent = this;
    this.serviceMap.set("SoundService", this.SoundService);

    this.ProximityPromptService = new Instance("ProximityPromptService");
    this.ProximityPromptService.Parent = this;
    this.serviceMap.set("ProximityPromptService", this.ProximityPromptService);

    this.Lighting = new LightingService();
    this.Lighting.Parent = this;
    this.serviceMap.set("Lighting", this.Lighting);
  }

  public GetService(serviceName: string): Instance {
    const s = this.serviceMap.get(serviceName);
    if (s) return s;
    // create generic service if missing
    const generic = new Instance(serviceName);
    generic.Parent = this;
    this.serviceMap.set(serviceName, generic);
    return generic;
  }

  public FindService(serviceName: string): Instance | null {
    return this.serviceMap.get(serviceName) || null;
  }
}
