/**
 * Roblox DataModel Hierarchy & Instance Engine
 * Implements full Instance lifecycle, RBXScriptSignal, Attributes, CollectionService tags,
 * and PropertyChanged signals.
 */

import { Vector2, Vector3, CFrame, UDim, UDim2, Color3, Rect } from './datatypes.js';

export type SignalCallback = (...args: any[]) => void;

export interface ConnectionRecord {
  id: string;
  signalName: string;
  instancePath: string;
  connectedAt: number;
  stack?: string;
  active: boolean;
}

export class RBXScriptConnection {
  public Connected: boolean = true;
  private readonly disconnectFn: () => void;
  public readonly id: string;
  public readonly signalName: string;
  public readonly instance: Instance;
  public readonly callback: SignalCallback;

  constructor(id: string, signalName: string, instance: Instance, callback: SignalCallback, disconnectFn: () => void) {
    this.id = id;
    this.signalName = signalName;
    this.instance = instance;
    this.callback = callback;
    this.disconnectFn = disconnectFn;
  }

  public Disconnect(): void {
    if (!this.Connected) return;
    this.Connected = false;
    this.disconnectFn();
  }

  // sUNC connection compatibility methods
  public Disable(): void {
    this.Connected = false;
  }

  public Enable(): void {
    this.Connected = true;
  }

  public Fire(...args: any[]): void {
    if (this.Connected) {
      this.callback(...args);
    }
  }
}

export class RBXScriptSignal {
  private listeners: Map<string, RBXScriptConnection> = new Map();
  public readonly Name: string;
  public readonly Owner: Instance;
  private nextId = 0;

  constructor(name: string, owner: Instance) {
    this.Name = name;
    this.Owner = owner;
  }

  public Connect(callback: SignalCallback): RBXScriptConnection {
    const id = `conn_${++this.nextId}_${Date.now()}`;
    const conn = new RBXScriptConnection(id, this.Name, this.Owner, callback, () => {
      this.listeners.delete(id);
    });
    this.listeners.set(id, conn);
    return conn;
  }

  public connect(callback: SignalCallback): RBXScriptConnection {
    return this.Connect(callback);
  }

  public Once(callback: SignalCallback): RBXScriptConnection {
    let conn: RBXScriptConnection;
    conn = this.Connect((...args) => {
      conn.Disconnect();
      callback(...args);
    });
    return conn;
  }

  public Wait(): Promise<any[]> {
    return new Promise((resolve) => {
      let conn: RBXScriptConnection;
      conn = this.Connect((...args) => {
        conn.Disconnect();
        resolve(args);
      });
    });
  }

  public lastError: any = null;

  public Fire(...args: any[]): void {
    this.lastError = null;
    for (const conn of Array.from(this.listeners.values())) {
      if (conn.Connected) {
        try {
          conn.callback(...args);
        } catch (err: any) {
          this.lastError = err;
          throw err;
        }
      }
    }
  }

  public GetConnections(): RBXScriptConnection[] {
    return Array.from(this.listeners.values());
  }

  public Clear(): void {
    for (const conn of this.listeners.values()) {
      conn.Connected = false;
    }
    this.listeners.clear();
  }
}

let instanceIdCounter = 0;

export class Instance {
  public readonly ClassName: string;
  public Name: string;
  public readonly UniqueId: string;
  private _parent: Instance | null = null;
  private _children: Instance[] = [];
  private _attributes: Map<string, any> = new Map();
  private _tags: Set<string> = new Set();
  private _destroyed = false;

  // Custom signals
  public readonly Changed: RBXScriptSignal;
  public readonly ChildAdded: RBXScriptSignal;
  public readonly ChildRemoved: RBXScriptSignal;
  public readonly DescendantAdded: RBXScriptSignal;
  public readonly DescendantRemoving: RBXScriptSignal;
  public readonly AncestryChanged: RBXScriptSignal;
  public readonly AttributeChanged: RBXScriptSignal;
  private propertySignals: Map<string, RBXScriptSignal> = new Map();

  // Common properties
  public Archivable: boolean = true;

  constructor(className: string) {
    this.ClassName = className;
    this.Name = className;
    this.UniqueId = `inst_${++instanceIdCounter}`;

    this.Changed = new RBXScriptSignal("Changed", this);
    this.ChildAdded = new RBXScriptSignal("ChildAdded", this);
    this.ChildRemoved = new RBXScriptSignal("ChildRemoved", this);
    this.DescendantAdded = new RBXScriptSignal("DescendantAdded", this);
    this.DescendantRemoving = new RBXScriptSignal("DescendantRemoving", this);
    this.AncestryChanged = new RBXScriptSignal("AncestryChanged", this);
    this.AttributeChanged = new RBXScriptSignal("AttributeChanged", this);
  }

  public get Parent(): Instance | null {
    return this._parent;
  }

  public set Parent(newParent: Instance | null) {
    if (this._destroyed) {
      throw new Error(`The Parent of ${this.Name} cannot be set to ${newParent?.Name ?? 'nil'} because it was destroyed.`);
    }
    if (this._parent === newParent) return;

    const oldParent = this._parent;
    if (oldParent) {
      const idx = oldParent._children.indexOf(this);
      if (idx !== -1) {
        oldParent._children.splice(idx, 1);
        oldParent.ChildRemoved.Fire(this);
        let curr: Instance | null = oldParent;
        while (curr) {
          curr.DescendantRemoving.Fire(this);
          curr = curr.Parent;
        }
      }
    }

    this._parent = newParent;
    if (newParent) {
      newParent._children.push(this);
      newParent.ChildAdded.Fire(this);
      let curr: Instance | null = newParent;
      while (curr) {
        curr.DescendantAdded.Fire(this);
        curr = curr.Parent;
      }
    }

    this.AncestryChanged.Fire(this, newParent);
    this.firePropertyChanged("Parent");
  }

  public GetPropertyChangedSignal(property: string): RBXScriptSignal {
    let sig = this.propertySignals.get(property);
    if (!sig) {
      sig = new RBXScriptSignal(`PropertyChanged_${property}`, this);
      this.propertySignals.set(property, sig);
    }
    return sig;
  }

  public firePropertyChanged(property: string): void {
    this.Changed.Fire(property);
    const sig = this.propertySignals.get(property);
    if (sig) sig.Fire((this as any)[property]);
  }

  public IsA(className: string): boolean {
    if (this.ClassName === className) return true;
    if (className === "Instance") return true;
    if (className === "BasePart" && ["Part", "MeshPart", "WedgePart", "TrussPart", "SpawnLocation"].includes(this.ClassName)) return true;
    if (className === "GuiObject" && ["Frame", "ScrollingFrame", "TextLabel", "TextButton", "TextBox", "ImageLabel", "ImageButton", "CanvasGroup"].includes(this.ClassName)) return true;
    if (className === "GuiBase2d" && ["ScreenGui", "SurfaceGui", "BillboardGui", "Frame", "ScrollingFrame", "TextLabel", "TextButton", "TextBox", "ImageLabel", "ImageButton"].includes(this.ClassName)) return true;
    if (className === "LayerCollector" && ["ScreenGui", "SurfaceGui", "BillboardGui"].includes(this.ClassName)) return true;
    if (className === "ValueBase" && this.ClassName.endsWith("Value")) return true;
    return false;
  }

  public IsDescendantOf(ancestor: Instance): boolean {
    let curr = this.Parent;
    while (curr) {
      if (curr === ancestor) return true;
      curr = curr.Parent;
    }
    return false;
  }

  public GetChildren(): Instance[] {
    return [...this._children];
  }

  public GetDescendants(): Instance[] {
    const res: Instance[] = [];
    const traverse = (inst: Instance) => {
      for (const child of inst._children) {
        res.push(child);
        traverse(child);
      }
    };
    traverse(this);
    return res;
  }

  public FindFirstChild(name: string, recursive: boolean = false): Instance | null {
    for (const child of this._children) {
      if (child.Name === name) return child;
    }
    if (recursive) {
      for (const child of this._children) {
        const found = child.FindFirstChild(name, true);
        if (found) return found;
      }
    }
    return null;
  }

  public FindFirstChildOfClass(className: string): Instance | null {
    for (const child of this._children) {
      if (child.ClassName === className) return child;
    }
    return null;
  }

  public FindFirstChildWhichIsA(className: string): Instance | null {
    for (const child of this._children) {
      if (child.IsA(className)) return child;
    }
    return null;
  }

  public WaitForChild(name: string, timeout: number = 5): Promise<Instance | null> {
    const existing = this.FindFirstChild(name);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve) => {
      let conn: RBXScriptConnection;
      let timer: NodeJS.Timeout | null = null;

      conn = this.ChildAdded.Connect((child: Instance) => {
        if (child.Name === name) {
          if (timer) clearTimeout(timer);
          conn.Disconnect();
          resolve(child);
        }
      });

      if (timeout > 0) {
        timer = setTimeout(() => {
          conn.Disconnect();
          resolve(null);
        }, timeout * 1000);
      }
    });
  }

  public ClearAllChildren(): void {
    const children = [...this._children];
    for (const child of children) {
      child.Destroy();
    }
  }

  public Destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    // Disconnect all signals
    this.Changed.Clear();
    this.ChildAdded.Clear();
    this.ChildRemoved.Clear();
    this.DescendantAdded.Clear();
    this.DescendantRemoving.Clear();
    this.AncestryChanged.Clear();
    this.AttributeChanged.Clear();
    for (const sig of this.propertySignals.values()) {
      sig.Clear();
    }
    this.propertySignals.clear();

    // Destroy children recursively
    this.ClearAllChildren();

    // Remove from parent
    if (this._parent) {
      const idx = this._parent._children.indexOf(this);
      if (idx !== -1) {
        this._parent._children.splice(idx, 1);
        this._parent.ChildRemoved.Fire(this);
      }
      this._parent = null;
    }
  }

  public Clone(): Instance {
    const clone = InstanceEngine.new(this.ClassName);
    clone.Name = this.Name;
    for (const [key, val] of this._attributes.entries()) {
      clone.SetAttribute(key, val);
    }
    for (const tag of this._tags) {
      clone.AddTag(tag);
    }
    // Copy public properties
    for (const key of Object.keys(this)) {
      if (!['_parent', '_children', '_attributes', '_tags', '_destroyed', 'Changed', 'ChildAdded', 'ChildRemoved', 'DescendantAdded', 'DescendantRemoving', 'AncestryChanged', 'AttributeChanged', 'propertySignals', 'UniqueId'].includes(key)) {
        try {
          (clone as any)[key] = (this as any)[key];
        } catch {}
      }
    }
    for (const child of this._children) {
      const childClone = child.Clone();
      childClone.Parent = clone;
    }
    return clone;
  }

  // Attributes
  public SetAttribute(attribute: string, value: any): void {
    this._attributes.set(attribute, value);
    this.AttributeChanged.Fire(attribute);
  }

  public GetAttribute(attribute: string): any {
    return this._attributes.has(attribute) ? this._attributes.get(attribute) : null;
  }

  public GetAttributes(): Record<string, any> {
    const res: Record<string, any> = {};
    for (const [k, v] of this._attributes.entries()) {
      res[k] = v;
    }
    return res;
  }

  // CollectionService Tags
  public AddTag(tag: string): void {
    this._tags.add(tag);
  }

  public RemoveTag(tag: string): void {
    this._tags.delete(tag);
  }

  public HasTag(tag: string): boolean {
    return this._tags.has(tag);
  }

  public GetTags(): string[] {
    return Array.from(this._tags);
  }

  public get FullPath(): string {
    const names: string[] = [this.Name];
    let curr = this.Parent;
    while (curr) {
      names.unshift(curr.Name);
      curr = curr.Parent;
    }
    return names.join(".");
  }
}

// 3D BasePart
export class BasePart extends Instance {
  public Size: Vector3 = new Vector3(4, 1.2, 2);
  public CFrame: CFrame = CFrame.identity;
  public Color: Color3 = Color3.fromRGB(163, 162, 165);
  public Transparency: number = 0;
  public Reflectance: number = 0;
  public Material: any = "Plastic";
  public Anchored: boolean = true;
  public CanCollide: boolean = true;
  public CanTouch: boolean = true;
  public CanQuery: boolean = true;
  public CastShadow: boolean = true;
  public Mass: number = 10;
  public readonly Touched: RBXScriptSignal;
  public readonly TouchEnded: RBXScriptSignal;

  constructor(className: string = "Part") {
    super(className);
    this.Touched = new RBXScriptSignal("Touched", this);
    this.TouchEnded = new RBXScriptSignal("TouchEnded", this);
  }

  public get Position(): Vector3 {
    return this.CFrame.Position;
  }

  public set Position(pos: Vector3) {
    this.CFrame = new CFrame(
      pos.X, pos.Y, pos.Z,
      this.CFrame.R00, this.CFrame.R01, this.CFrame.R02,
      this.CFrame.R10, this.CFrame.R11, this.CFrame.R12,
      this.CFrame.R20, this.CFrame.R21, this.CFrame.R22
    );
    this.firePropertyChanged("Position");
    this.firePropertyChanged("CFrame");
  }

  public get Orientation(): Vector3 {
    return new Vector3(0, 0, 0); // Simplified Euler
  }

  public set Orientation(rot: Vector3) {
    const cf = CFrame.fromEulerAnglesXYZ(
      rot.X * Math.PI / 180,
      rot.Y * Math.PI / 180,
      rot.Z * Math.PI / 180
    );
    this.CFrame = new CFrame(this.Position.X, this.Position.Y, this.Position.Z).mul(cf);
    this.firePropertyChanged("Orientation");
    this.firePropertyChanged("CFrame");
  }
}

// Model
export class Model extends Instance {
  public PrimaryPart: BasePart | null = null;

  constructor() {
    super("Model");
  }

  public GetPivot(): CFrame {
    if (this.PrimaryPart) return this.PrimaryPart.CFrame;
    const parts = this.GetDescendants().filter(d => d.IsA("BasePart")) as BasePart[];
    if (parts.length > 0) return parts[0].CFrame;
    return CFrame.identity;
  }

  public PivotTo(targetCFrame: CFrame): void {
    const currentPivot = this.GetPivot();
    const delta = targetCFrame.mul(currentPivot.Inverse());
    const parts = this.GetDescendants().filter(d => d.IsA("BasePart")) as BasePart[];
    for (const part of parts) {
      part.CFrame = delta.mul(part.CFrame);
    }
  }

  public GetBoundingBox(): [CFrame, Vector3] {
    const parts = this.GetDescendants().filter(d => d.IsA("BasePart")) as BasePart[];
    if (parts.length === 0) return [CFrame.identity, Vector3.zero];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const p of parts) {
      const pos = p.Position;
      const hs = p.Size.mul(0.5);
      minX = Math.min(minX, pos.X - hs.X);
      minY = Math.min(minY, pos.Y - hs.Y);
      minZ = Math.min(minZ, pos.Z - hs.Z);
      maxX = Math.max(maxX, pos.X + hs.X);
      maxY = Math.max(maxY, pos.Y + hs.Y);
      maxZ = Math.max(maxZ, pos.Z + hs.Z);
    }
    const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    const size = new Vector3(maxX - minX, maxY - minY, maxZ - minZ);
    return [new CFrame(center.X, center.Y, center.Z), size];
  }
}

// Humanoid
export class Humanoid extends Instance {
  public Health: number = 100;
  public MaxHealth: number = 100;
  public WalkSpeed: number = 16;
  public JumpPower: number = 50;
  public JumpHeight: number = 7.2;
  public HipHeight: number = 2.0;
  public RigType: string = "R6";
  public MoveDirection: Vector3 = Vector3.zero;
  public FloorMaterial: string = "Plastic";
  public DisplayName: string = "Player";
  public TargetPoint: Vector3 = Vector3.zero;

  public readonly Died: RBXScriptSignal;
  public readonly Running: RBXScriptSignal;
  public readonly Jumping: RBXScriptSignal;
  public readonly MoveToFinished: RBXScriptSignal;

  constructor() {
    super("Humanoid");
    this.Died = new RBXScriptSignal("Died", this);
    this.Running = new RBXScriptSignal("Running", this);
    this.Jumping = new RBXScriptSignal("Jumping", this);
    this.MoveToFinished = new RBXScriptSignal("MoveToFinished", this);
  }

  public MoveTo(targetLocation: Vector3): void {
    this.TargetPoint = targetLocation;
    const parent = this.Parent as Model | null;
    if (parent && parent.PrimaryPart) {
      const delta = targetLocation.sub(parent.PrimaryPart.Position);
      const horizontal = new Vector3(delta.X, 0, delta.Z);
      if (horizontal.Magnitude > 0.001) {
        this.MoveDirection = horizontal.Unit;
      }
    }
    this.MoveToFinished.Fire(true);
  }

  public TakeDamage(amount: number): void {
    this.Health = Math.max(0, this.Health - amount);
    if (this.Health === 0) {
      this.Died.Fire();
    }
  }
}

// Motor6D Joint
export class Motor6D extends Instance {
  public Part0: BasePart | null = null;
  public Part1: BasePart | null = null;
  public C0: CFrame = CFrame.identity;
  public C1: CFrame = CFrame.identity;
  public Transform: CFrame = CFrame.identity;
  public CurrentAngle: number = 0;
  public DesiredAngle: number = 0;
  public MaxVelocity: number = 0.1;

  constructor() {
    super("Motor6D");
  }
}

// GuiObject and 2D UI elements
export class GuiObject extends Instance {
  public Position: UDim2 = UDim2.fromScale(0, 0);
  public Size: UDim2 = UDim2.fromOffset(100, 100);
  public AnchorPoint: Vector2 = Vector2.zero;
  public BackgroundColor3: Color3 = Color3.fromRGB(255, 255, 255);
  public BackgroundTransparency: number = 0;
  public BorderColor3: Color3 = Color3.fromRGB(27, 42, 53);
  public BorderSizePixel: number = 0;
  public ClipsDescendants: boolean = false;
  public Visible: boolean = true;
  public ZIndex: number = 1;
  public LayoutOrder: number = 0;
  public Rotation: number = 0;
  public Active: boolean = false;
  public AutomaticSize: any = "None"; // None, X, Y, XY

  // UI Event Signals
  public readonly InputBegan: RBXScriptSignal;
  public readonly InputEnded: RBXScriptSignal;
  public readonly MouseEnter: RBXScriptSignal;
  public readonly MouseLeave: RBXScriptSignal;
  public readonly MouseButton1Click: RBXScriptSignal;
  public readonly MouseButton1Down: RBXScriptSignal;
  public readonly MouseButton1Up: RBXScriptSignal;
  public readonly MouseButton2Click: RBXScriptSignal;
  public readonly Activated: RBXScriptSignal;

  constructor(className: string) {
    super(className);
    this.InputBegan = new RBXScriptSignal("InputBegan", this);
    this.InputEnded = new RBXScriptSignal("InputEnded", this);
    this.MouseEnter = new RBXScriptSignal("MouseEnter", this);
    this.MouseLeave = new RBXScriptSignal("MouseLeave", this);
    this.MouseButton1Click = new RBXScriptSignal("MouseButton1Click", this);
    this.MouseButton1Down = new RBXScriptSignal("MouseButton1Down", this);
    this.MouseButton1Up = new RBXScriptSignal("MouseButton1Up", this);
    this.MouseButton2Click = new RBXScriptSignal("MouseButton2Click", this);
    this.Activated = new RBXScriptSignal("Activated", this);
  }
}

export class ScreenGui extends Instance {
  public Enabled: boolean = true;
  public DisplayOrder: number = 0;
  public ResetOnSpawn: boolean = true;
  public IgnoreGuiInset: boolean = false;

  constructor() {
    super("ScreenGui");
  }
}

export class Frame extends GuiObject {
  constructor() {
    super("Frame");
  }
}

export class ScrollingFrame extends GuiObject {
  public CanvasSize: UDim2 = UDim2.fromScale(0, 0);
  public CanvasPosition: Vector2 = Vector2.zero;
  public ScrollBarThickness: number = 6;
  public ScrollBarImageColor3: Color3 = Color3.fromRGB(255, 255, 255);
  public ScrollBarImageTransparency: number = 0;
  public ScrollingDirection: any = "XY";
  public AutomaticCanvasSize: any = "None";

  constructor() {
    super("ScrollingFrame");
  }
}

export class TextLabel extends GuiObject {
  public Text: string = "Label";
  public TextColor3: Color3 = Color3.fromRGB(0, 0, 0);
  public TextTransparency: number = 0;
  public TextSize: number = 14;
  public Font: any = "SourceSans";
  public TextXAlignment: any = "Center"; // Left, Center, Right
  public TextYAlignment: any = "Center"; // Top, Center, Bottom
  public TextWrapped: boolean = false;
  public TextScaled: boolean = false;
  public RichText: boolean = false;
  public TextTruncate: any = "None";

  constructor(className = "TextLabel") {
    super(className);
  }
}

export class TextButton extends TextLabel {
  public AutoButtonColor: boolean = true;
  public Selected: boolean = false;

  constructor() {
    super("TextButton");
    this.Active = true;
  }
}

export class TextBox extends TextLabel {
  public ClearTextOnFocus: boolean = true;
  public MultiLine: boolean = false;
  public PlaceholderText: string = "";
  public PlaceholderColor3: Color3 = Color3.fromRGB(178, 178, 178);
  public readonly FocusLost: RBXScriptSignal;
  public readonly Focused: RBXScriptSignal;

  constructor() {
    super("TextBox");
    this.Active = true;
    this.FocusLost = new RBXScriptSignal("FocusLost", this);
    this.Focused = new RBXScriptSignal("Focused", this);
  }
}

export class ImageLabel extends GuiObject {
  public Image: string = "";
  public ImageColor3: Color3 = Color3.fromRGB(255, 255, 255);
  public ImageTransparency: number = 0;
  public ScaleType: any = "Stretch"; // Stretch, Slice, Tile, Fit, Crop
  public ImageRectOffset: Vector2 = Vector2.zero;
  public ImageRectSize: Vector2 = Vector2.zero;

  constructor(className = "ImageLabel") {
    super(className);
  }
}

export class ImageButton extends ImageLabel {
  public AutoButtonColor: boolean = true;
  public Selected: boolean = false;

  constructor() {
    super("ImageButton");
    this.Active = true;
  }
}

// UI Modifiers
export class UICorner extends Instance {
  public CornerRadius: UDim = UDim.new(0, 8);
  constructor() { super("UICorner"); }
}

export class UIStroke extends Instance {
  public Color: Color3 = Color3.fromRGB(0, 0, 0);
  public Transparency: number = 0;
  public Thickness: number = 1;
  public ApplyStrokeMode: any = "Contextual"; // Contextual, Border
  constructor() { super("UIStroke"); }
}

export class UIPadding extends Instance {
  public PaddingTop: UDim = UDim.new(0, 0);
  public PaddingBottom: UDim = UDim.new(0, 0);
  public PaddingLeft: UDim = UDim.new(0, 0);
  public PaddingRight: UDim = UDim.new(0, 0);
  constructor() { super("UIPadding"); }
}

export class UIListLayout extends Instance {
  public FillDirection: any = "Vertical"; // Vertical, Horizontal
  public HorizontalAlignment: any = "Left"; // Left, Center, Right
  public VerticalAlignment: any = "Top"; // Top, Center, Bottom
  public SortOrder: any = "LayoutOrder"; // LayoutOrder, Name
  public Padding: UDim = UDim.new(0, 0);
  constructor() { super("UIListLayout"); }
}

export class UIGridLayout extends Instance {
  public CellSize: UDim2 = UDim2.fromOffset(100, 100);
  public CellPadding: UDim2 = UDim2.fromOffset(5, 5);
  public FillDirection: any = "Horizontal";
  public HorizontalAlignment: any = "Left";
  public VerticalAlignment: any = "Top";
  public SortOrder: any = "LayoutOrder";
  constructor() { super("UIGridLayout"); }
}

export class UIGradient extends Instance {
  public Color: any = null;
  public Transparency: any = null;
  public Rotation: number = 0;
  public Offset: Vector2 = Vector2.zero;
  constructor() { super("UIGradient"); }
}

export class UIAspectRatioConstraint extends Instance {
  public AspectRatio: number = 1;
  public AspectType: any = "FitWithinMaxSize";
  public DominantAxis: any = "Width";
  constructor() { super("UIAspectRatioConstraint"); }
}

export class UISizeConstraint extends Instance {
  public MinSize: Vector2 = Vector2.zero;
  public MaxSize: Vector2 = new Vector2(Infinity, Infinity);
  constructor() { super("UISizeConstraint"); }
}

// Networking Instances
export class RemoteEvent extends Instance {
  public readonly OnServerEvent: RBXScriptSignal;
  public readonly OnClientEvent: RBXScriptSignal;

  constructor() {
    super("RemoteEvent");
    this.OnServerEvent = new RBXScriptSignal("OnServerEvent", this);
    this.OnClientEvent = new RBXScriptSignal("OnClientEvent", this);
  }

  public FireServer(...args: any[]): void {
    // Dispatches to OnServerEvent (with mock player argument first)
    const mockPlayer = { Name: "Player1", UserId: 12345678 };
    this.OnServerEvent.Fire(mockPlayer, ...args);
  }

  public FireClient(player: any, ...args: any[]): void {
    this.OnClientEvent.Fire(...args);
  }

  public FireAllClients(...args: any[]): void {
    this.OnClientEvent.Fire(...args);
  }
}

export class RemoteFunction extends Instance {
  public OnServerInvoke: ((player: any, ...args: any[]) => any) | null = null;
  public OnClientInvoke: ((...args: any[]) => any) | null = null;

  constructor() {
    super("RemoteFunction");
  }

  public InvokeServer(...args: any[]): any {
    if (this.OnServerInvoke) {
      const mockPlayer = { Name: "Player1", UserId: 12345678 };
      return this.OnServerInvoke(mockPlayer, ...args);
    }
    return null;
  }

  public InvokeClient(player: any, ...args: any[]): any {
    if (this.OnClientInvoke) {
      return this.OnClientInvoke(...args);
    }
    return null;
  }
}

export class BindableEvent extends Instance {
  public readonly Event: RBXScriptSignal;

  constructor() {
    super("BindableEvent");
    this.Event = new RBXScriptSignal("Event", this);
  }

  public Fire(...args: any[]): void {
    this.Event.Fire(...args);
  }
}

export class Tool extends Instance {
  public RequiresHandle: boolean = true;
  public CanBeDropped: boolean = true;
  public ToolTip: string = "";
  public Enabled: boolean = true;
  public Grip: CFrame = CFrame.identity;
  public GripPos: Vector3 = Vector3.zero;

  public readonly Equipped: RBXScriptSignal;
  public readonly Unequipped: RBXScriptSignal;
  public readonly Activated: RBXScriptSignal;
  public readonly Deactivated: RBXScriptSignal;

  constructor() {
    super("Tool");
    this.Equipped = new RBXScriptSignal("Equipped", this);
    this.Unequipped = new RBXScriptSignal("Unequipped", this);
    this.Activated = new RBXScriptSignal("Activated", this);
    this.Deactivated = new RBXScriptSignal("Deactivated", this);
  }

  public Activate(): void {
    if (this.Enabled) {
      this.Activated.Fire();
    }
  }

  public Deactivate(): void {
    this.Deactivated.Fire();
  }
}

export class ClickDetector extends Instance {
  public MaxActivationDistance: number = 32;
  public CursorIcon: string = "";

  public readonly MouseClick: RBXScriptSignal;
  public readonly MouseHoverEnter: RBXScriptSignal;
  public readonly MouseHoverLeave: RBXScriptSignal;

  constructor() {
    super("ClickDetector");
    this.MouseClick = new RBXScriptSignal("MouseClick", this);
    this.MouseHoverEnter = new RBXScriptSignal("MouseHoverEnter", this);
    this.MouseHoverLeave = new RBXScriptSignal("MouseHoverLeave", this);
  }
}

export class ProximityPrompt extends Instance {
  public ActionText: string = "Interact";
  public ObjectText: string = "";
  public KeyboardKeyCode: string = "E";
  public HoldDuration: number = 0;
  public MaxActivationDistance: number = 10;
  public RequiresLineOfSight: boolean = false;
  public Enabled: boolean = true;

  public readonly Triggered: RBXScriptSignal;
  public readonly PromptButtonHoldBegan: RBXScriptSignal;
  public readonly PromptButtonHoldEnded: RBXScriptSignal;

  constructor() {
    super("ProximityPrompt");
    this.Triggered = new RBXScriptSignal("Triggered", this);
    this.PromptButtonHoldBegan = new RBXScriptSignal("PromptButtonHoldBegan", this);
    this.PromptButtonHoldEnded = new RBXScriptSignal("PromptButtonHoldEnded", this);
  }
}

export class BillboardGui extends Instance {
  public Adornee: Instance | null = null;
  public Size: UDim2 = new UDim2(0, 100, 0, 40);
  public StudsOffset: Vector3 = new Vector3(0, 2, 0);
  public AlwaysOnTop: boolean = false;
  public ExtentsOffset: Vector3 = new Vector3(0, 0, 0);
  public Enabled: boolean = true;
  public ClipsDescendants: boolean = false;

  constructor() {
    super("BillboardGui");
  }
}

export class Sound extends Instance {
  public SoundId: string = "";
  public Volume: number = 0.5;
  public PlaybackSpeed: number = 1.0;
  public Playing: boolean = false;
  public Looped: boolean = false;
  public TimeLength: number = 2.0;

  public readonly Ended: RBXScriptSignal;
  public readonly Played: RBXScriptSignal;

  constructor() {
    super("Sound");
    this.Ended = new RBXScriptSignal("Ended", this);
    this.Played = new RBXScriptSignal("Played", this);
  }

  public Play(): void {
    this.Playing = true;
    this.Played.Fire();
  }

  public Stop(): void {
    this.Playing = false;
    this.Ended.Fire();
  }
}

export class Backpack extends Instance {
  constructor() {
    super("Backpack");
  }
}

// Factory Registry
export class InstanceEngine {
  private static classMap: Record<string, new () => Instance> = {
    Instance: class extends Instance { constructor() { super("Instance"); } },
    Folder: class extends Instance { constructor() { super("Folder"); } },
    Model: Model,
    Humanoid: Humanoid,
    Motor6D: Motor6D,
    Part: BasePart,
    MeshPart: class extends BasePart { constructor() { super("MeshPart"); } },
    WedgePart: class extends BasePart { constructor() { super("WedgePart"); } },
    TrussPart: class extends BasePart { constructor() { super("TrussPart"); } },
    SpawnLocation: class extends BasePart { constructor() { super("SpawnLocation"); } },
    Tool: Tool,
    ClickDetector: ClickDetector,
    ProximityPrompt: ProximityPrompt,
    BillboardGui: BillboardGui,
    Sound: Sound,
    Backpack: Backpack,
    ScreenGui: ScreenGui,
    Frame: Frame,
    ScrollingFrame: ScrollingFrame,
    TextLabel: TextLabel,
    TextButton: TextButton,
    TextBox: TextBox,
    ImageLabel: ImageLabel,
    ImageButton: ImageButton,
    UICorner: UICorner,
    UIStroke: UIStroke,
    UIPadding: UIPadding,
    UIListLayout: UIListLayout,
    UIGridLayout: UIGridLayout,
    UIGradient: UIGradient,
    UIAspectRatioConstraint: UIAspectRatioConstraint,
    UISizeConstraint: UISizeConstraint,
    RemoteEvent: RemoteEvent,
    RemoteFunction: RemoteFunction,
    BindableEvent: BindableEvent,
    // Values
    StringValue: class extends Instance { public Value: string = ""; constructor() { super("StringValue"); } },
    IntValue: class extends Instance { public Value: number = 0; constructor() { super("IntValue"); } },
    NumberValue: class extends Instance { public Value: number = 0; constructor() { super("NumberValue"); } },
    BoolValue: class extends Instance { public Value: boolean = false; constructor() { super("BoolValue"); } },
    ObjectValue: class extends Instance { public Value: Instance | null = null; constructor() { super("ObjectValue"); } },
    CFrameValue: class extends Instance { public Value: CFrame = CFrame.identity; constructor() { super("CFrameValue"); } },
    Vector3Value: class extends Instance { public Value: Vector3 = Vector3.zero; constructor() { super("Vector3Value"); } },
    Color3Value: class extends Instance { public Value: Color3 = Color3.fromRGB(0, 0, 0); constructor() { super("Color3Value"); } },
  };

  public static registerClass(className: string, ctor: new () => Instance) {
    this.classMap[className] = ctor;
  }

  public static new(className: string, parent?: Instance): Instance {
    const Ctor = this.classMap[className] || class extends Instance {
      constructor() { super(className); }
    };
    const inst = new Ctor();
    if (parent) {
      inst.Parent = parent;
    }
    return inst;
  }
}
