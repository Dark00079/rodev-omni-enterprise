/**
 * Roblox DataModel Hierarchy & Instance Engine
 * Implements full Instance lifecycle, RBXScriptSignal, Attributes, CollectionService tags,
 * and PropertyChanged signals.
 */
import { Vector2, Vector3, CFrame, UDim, UDim2, Color3 } from './datatypes.js';
export class RBXScriptConnection {
    Connected = true;
    disconnectFn;
    id;
    signalName;
    instance;
    callback;
    constructor(id, signalName, instance, callback, disconnectFn) {
        this.id = id;
        this.signalName = signalName;
        this.instance = instance;
        this.callback = callback;
        this.disconnectFn = disconnectFn;
    }
    Disconnect() {
        if (!this.Connected)
            return;
        this.Connected = false;
        this.disconnectFn();
    }
    // sUNC connection compatibility methods
    Disable() {
        this.Connected = false;
    }
    Enable() {
        this.Connected = true;
    }
    Fire(...args) {
        if (this.Connected) {
            this.callback(...args);
        }
    }
}
export class RBXScriptSignal {
    listeners = new Map();
    Name;
    Owner;
    nextId = 0;
    constructor(name, owner) {
        this.Name = name;
        this.Owner = owner;
    }
    Connect(callback) {
        const id = `conn_${++this.nextId}_${Date.now()}`;
        const conn = new RBXScriptConnection(id, this.Name, this.Owner, callback, () => {
            this.listeners.delete(id);
        });
        this.listeners.set(id, conn);
        return conn;
    }
    connect(callback) {
        return this.Connect(callback);
    }
    Once(callback) {
        let conn;
        conn = this.Connect((...args) => {
            conn.Disconnect();
            callback(...args);
        });
        return conn;
    }
    Wait() {
        return new Promise((resolve) => {
            let conn;
            conn = this.Connect((...args) => {
                conn.Disconnect();
                resolve(args);
            });
        });
    }
    lastError = null;
    Fire(...args) {
        this.lastError = null;
        for (const conn of Array.from(this.listeners.values())) {
            if (conn.Connected) {
                try {
                    conn.callback(...args);
                }
                catch (err) {
                    this.lastError = err;
                    throw err;
                }
            }
        }
    }
    GetConnections() {
        return Array.from(this.listeners.values());
    }
    Clear() {
        for (const conn of this.listeners.values()) {
            conn.Connected = false;
        }
        this.listeners.clear();
    }
}
let instanceIdCounter = 0;
export class Instance {
    ClassName;
    Name;
    UniqueId;
    _parent = null;
    _children = [];
    _attributes = new Map();
    _tags = new Set();
    _destroyed = false;
    // Custom signals
    Changed;
    ChildAdded;
    ChildRemoved;
    DescendantAdded;
    DescendantRemoving;
    AncestryChanged;
    AttributeChanged;
    propertySignals = new Map();
    // Common properties
    Archivable = true;
    constructor(className) {
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
    get Parent() {
        return this._parent;
    }
    set Parent(newParent) {
        if (this._destroyed) {
            throw new Error(`The Parent of ${this.Name} cannot be set to ${newParent?.Name ?? 'nil'} because it was destroyed.`);
        }
        if (this._parent === newParent)
            return;
        const oldParent = this._parent;
        if (oldParent) {
            const idx = oldParent._children.indexOf(this);
            if (idx !== -1) {
                oldParent._children.splice(idx, 1);
                oldParent.ChildRemoved.Fire(this);
                let curr = oldParent;
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
            let curr = newParent;
            while (curr) {
                curr.DescendantAdded.Fire(this);
                curr = curr.Parent;
            }
        }
        this.AncestryChanged.Fire(this, newParent);
        this.firePropertyChanged("Parent");
    }
    GetPropertyChangedSignal(property) {
        let sig = this.propertySignals.get(property);
        if (!sig) {
            sig = new RBXScriptSignal(`PropertyChanged_${property}`, this);
            this.propertySignals.set(property, sig);
        }
        return sig;
    }
    firePropertyChanged(property) {
        this.Changed.Fire(property);
        const sig = this.propertySignals.get(property);
        if (sig)
            sig.Fire(this[property]);
    }
    IsA(className) {
        if (this.ClassName === className)
            return true;
        if (className === "Instance")
            return true;
        if (className === "BasePart" && ["Part", "MeshPart", "WedgePart", "TrussPart", "SpawnLocation"].includes(this.ClassName))
            return true;
        if (className === "GuiObject" && ["Frame", "ScrollingFrame", "TextLabel", "TextButton", "TextBox", "ImageLabel", "ImageButton", "CanvasGroup"].includes(this.ClassName))
            return true;
        if (className === "GuiBase2d" && ["ScreenGui", "SurfaceGui", "BillboardGui", "Frame", "ScrollingFrame", "TextLabel", "TextButton", "TextBox", "ImageLabel", "ImageButton"].includes(this.ClassName))
            return true;
        if (className === "LayerCollector" && ["ScreenGui", "SurfaceGui", "BillboardGui"].includes(this.ClassName))
            return true;
        if (className === "ValueBase" && this.ClassName.endsWith("Value"))
            return true;
        return false;
    }
    IsDescendantOf(ancestor) {
        let curr = this.Parent;
        while (curr) {
            if (curr === ancestor)
                return true;
            curr = curr.Parent;
        }
        return false;
    }
    GetChildren() {
        return [...this._children];
    }
    GetDescendants() {
        const res = [];
        const traverse = (inst) => {
            for (const child of inst._children) {
                res.push(child);
                traverse(child);
            }
        };
        traverse(this);
        return res;
    }
    FindFirstChild(name, recursive = false) {
        for (const child of this._children) {
            if (child.Name === name)
                return child;
        }
        if (recursive) {
            for (const child of this._children) {
                const found = child.FindFirstChild(name, true);
                if (found)
                    return found;
            }
        }
        return null;
    }
    FindFirstChildOfClass(className) {
        for (const child of this._children) {
            if (child.ClassName === className)
                return child;
        }
        return null;
    }
    FindFirstChildWhichIsA(className) {
        for (const child of this._children) {
            if (child.IsA(className))
                return child;
        }
        return null;
    }
    WaitForChild(name, timeout = 5) {
        const existing = this.FindFirstChild(name);
        if (existing)
            return Promise.resolve(existing);
        return new Promise((resolve) => {
            let conn;
            let timer = null;
            conn = this.ChildAdded.Connect((child) => {
                if (child.Name === name) {
                    if (timer)
                        clearTimeout(timer);
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
    ClearAllChildren() {
        const children = [...this._children];
        for (const child of children) {
            child.Destroy();
        }
    }
    Destroy() {
        if (this._destroyed)
            return;
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
    Clone() {
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
                    clone[key] = this[key];
                }
                catch { }
            }
        }
        for (const child of this._children) {
            const childClone = child.Clone();
            childClone.Parent = clone;
        }
        return clone;
    }
    // Attributes
    SetAttribute(attribute, value) {
        this._attributes.set(attribute, value);
        this.AttributeChanged.Fire(attribute);
    }
    GetAttribute(attribute) {
        return this._attributes.has(attribute) ? this._attributes.get(attribute) : null;
    }
    GetAttributes() {
        const res = {};
        for (const [k, v] of this._attributes.entries()) {
            res[k] = v;
        }
        return res;
    }
    // CollectionService Tags
    AddTag(tag) {
        this._tags.add(tag);
    }
    RemoveTag(tag) {
        this._tags.delete(tag);
    }
    HasTag(tag) {
        return this._tags.has(tag);
    }
    GetTags() {
        return Array.from(this._tags);
    }
    get FullPath() {
        const names = [this.Name];
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
    Size = new Vector3(4, 1.2, 2);
    CFrame = CFrame.identity;
    Color = Color3.fromRGB(163, 162, 165);
    Transparency = 0;
    Reflectance = 0;
    Material = "Plastic";
    Anchored = true;
    CanCollide = true;
    CanTouch = true;
    CanQuery = true;
    CastShadow = true;
    Mass = 10;
    Touched;
    TouchEnded;
    constructor(className = "Part") {
        super(className);
        this.Touched = new RBXScriptSignal("Touched", this);
        this.TouchEnded = new RBXScriptSignal("TouchEnded", this);
    }
    get Position() {
        return this.CFrame.Position;
    }
    set Position(pos) {
        this.CFrame = new CFrame(pos.X, pos.Y, pos.Z, this.CFrame.R00, this.CFrame.R01, this.CFrame.R02, this.CFrame.R10, this.CFrame.R11, this.CFrame.R12, this.CFrame.R20, this.CFrame.R21, this.CFrame.R22);
        this.firePropertyChanged("Position");
        this.firePropertyChanged("CFrame");
    }
    get Orientation() {
        return new Vector3(0, 0, 0); // Simplified Euler
    }
    set Orientation(rot) {
        const cf = CFrame.fromEulerAnglesXYZ(rot.X * Math.PI / 180, rot.Y * Math.PI / 180, rot.Z * Math.PI / 180);
        this.CFrame = new CFrame(this.Position.X, this.Position.Y, this.Position.Z).mul(cf);
        this.firePropertyChanged("Orientation");
        this.firePropertyChanged("CFrame");
    }
}
// Model
export class Model extends Instance {
    PrimaryPart = null;
    constructor() {
        super("Model");
    }
    GetPivot() {
        if (this.PrimaryPart)
            return this.PrimaryPart.CFrame;
        const parts = this.GetDescendants().filter(d => d.IsA("BasePart"));
        if (parts.length > 0)
            return parts[0].CFrame;
        return CFrame.identity;
    }
    PivotTo(targetCFrame) {
        const currentPivot = this.GetPivot();
        const delta = targetCFrame.mul(currentPivot.Inverse());
        const parts = this.GetDescendants().filter(d => d.IsA("BasePart"));
        for (const part of parts) {
            part.CFrame = delta.mul(part.CFrame);
        }
    }
    GetBoundingBox() {
        const parts = this.GetDescendants().filter(d => d.IsA("BasePart"));
        if (parts.length === 0)
            return [CFrame.identity, Vector3.zero];
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
    Health = 100;
    MaxHealth = 100;
    WalkSpeed = 16;
    JumpPower = 50;
    JumpHeight = 7.2;
    HipHeight = 2.0;
    RigType = "R6";
    MoveDirection = Vector3.zero;
    FloorMaterial = "Plastic";
    DisplayName = "Player";
    TargetPoint = Vector3.zero;
    Died;
    Running;
    Jumping;
    MoveToFinished;
    constructor() {
        super("Humanoid");
        this.Died = new RBXScriptSignal("Died", this);
        this.Running = new RBXScriptSignal("Running", this);
        this.Jumping = new RBXScriptSignal("Jumping", this);
        this.MoveToFinished = new RBXScriptSignal("MoveToFinished", this);
    }
    MoveTo(targetLocation) {
        this.TargetPoint = targetLocation;
        const parent = this.Parent;
        if (parent && parent.PrimaryPart) {
            const delta = targetLocation.sub(parent.PrimaryPart.Position);
            const horizontal = new Vector3(delta.X, 0, delta.Z);
            if (horizontal.Magnitude > 0.001) {
                this.MoveDirection = horizontal.Unit;
            }
        }
        this.MoveToFinished.Fire(true);
    }
    TakeDamage(amount) {
        this.Health = Math.max(0, this.Health - amount);
        if (this.Health === 0) {
            this.Died.Fire();
        }
    }
}
// Motor6D Joint
export class Motor6D extends Instance {
    Part0 = null;
    Part1 = null;
    C0 = CFrame.identity;
    C1 = CFrame.identity;
    Transform = CFrame.identity;
    CurrentAngle = 0;
    DesiredAngle = 0;
    MaxVelocity = 0.1;
    constructor() {
        super("Motor6D");
    }
}
// GuiObject and 2D UI elements
export class GuiObject extends Instance {
    Position = UDim2.fromScale(0, 0);
    Size = UDim2.fromOffset(100, 100);
    AnchorPoint = Vector2.zero;
    BackgroundColor3 = Color3.fromRGB(255, 255, 255);
    BackgroundTransparency = 0;
    BorderColor3 = Color3.fromRGB(27, 42, 53);
    BorderSizePixel = 0;
    ClipsDescendants = false;
    Visible = true;
    ZIndex = 1;
    LayoutOrder = 0;
    Rotation = 0;
    Active = false;
    AutomaticSize = "None"; // None, X, Y, XY
    // UI Event Signals
    InputBegan;
    InputEnded;
    MouseEnter;
    MouseLeave;
    MouseButton1Click;
    MouseButton1Down;
    MouseButton1Up;
    MouseButton2Click;
    Activated;
    constructor(className) {
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
    Enabled = true;
    DisplayOrder = 0;
    ResetOnSpawn = true;
    IgnoreGuiInset = false;
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
    CanvasSize = UDim2.fromScale(0, 0);
    CanvasPosition = Vector2.zero;
    ScrollBarThickness = 6;
    ScrollBarImageColor3 = Color3.fromRGB(255, 255, 255);
    ScrollBarImageTransparency = 0;
    ScrollingDirection = "XY";
    AutomaticCanvasSize = "None";
    constructor() {
        super("ScrollingFrame");
    }
}
export class TextLabel extends GuiObject {
    Text = "Label";
    TextColor3 = Color3.fromRGB(0, 0, 0);
    TextTransparency = 0;
    TextSize = 14;
    Font = "SourceSans";
    TextXAlignment = "Center"; // Left, Center, Right
    TextYAlignment = "Center"; // Top, Center, Bottom
    TextWrapped = false;
    TextScaled = false;
    RichText = false;
    TextTruncate = "None";
    constructor(className = "TextLabel") {
        super(className);
    }
}
export class TextButton extends TextLabel {
    AutoButtonColor = true;
    Selected = false;
    constructor() {
        super("TextButton");
        this.Active = true;
    }
}
export class TextBox extends TextLabel {
    ClearTextOnFocus = true;
    MultiLine = false;
    PlaceholderText = "";
    PlaceholderColor3 = Color3.fromRGB(178, 178, 178);
    FocusLost;
    Focused;
    constructor() {
        super("TextBox");
        this.Active = true;
        this.FocusLost = new RBXScriptSignal("FocusLost", this);
        this.Focused = new RBXScriptSignal("Focused", this);
    }
}
export class ImageLabel extends GuiObject {
    Image = "";
    ImageColor3 = Color3.fromRGB(255, 255, 255);
    ImageTransparency = 0;
    ScaleType = "Stretch"; // Stretch, Slice, Tile, Fit, Crop
    ImageRectOffset = Vector2.zero;
    ImageRectSize = Vector2.zero;
    constructor(className = "ImageLabel") {
        super(className);
    }
}
export class ImageButton extends ImageLabel {
    AutoButtonColor = true;
    Selected = false;
    constructor() {
        super("ImageButton");
        this.Active = true;
    }
}
// UI Modifiers
export class UICorner extends Instance {
    CornerRadius = UDim.new(0, 8);
    constructor() { super("UICorner"); }
}
export class UIStroke extends Instance {
    Color = Color3.fromRGB(0, 0, 0);
    Transparency = 0;
    Thickness = 1;
    ApplyStrokeMode = "Contextual"; // Contextual, Border
    constructor() { super("UIStroke"); }
}
export class UIPadding extends Instance {
    PaddingTop = UDim.new(0, 0);
    PaddingBottom = UDim.new(0, 0);
    PaddingLeft = UDim.new(0, 0);
    PaddingRight = UDim.new(0, 0);
    constructor() { super("UIPadding"); }
}
export class UIListLayout extends Instance {
    FillDirection = "Vertical"; // Vertical, Horizontal
    HorizontalAlignment = "Left"; // Left, Center, Right
    VerticalAlignment = "Top"; // Top, Center, Bottom
    SortOrder = "LayoutOrder"; // LayoutOrder, Name
    Padding = UDim.new(0, 0);
    constructor() { super("UIListLayout"); }
}
export class UIGridLayout extends Instance {
    CellSize = UDim2.fromOffset(100, 100);
    CellPadding = UDim2.fromOffset(5, 5);
    FillDirection = "Horizontal";
    HorizontalAlignment = "Left";
    VerticalAlignment = "Top";
    SortOrder = "LayoutOrder";
    constructor() { super("UIGridLayout"); }
}
export class UIGradient extends Instance {
    Color = null;
    Transparency = null;
    Rotation = 0;
    Offset = Vector2.zero;
    constructor() { super("UIGradient"); }
}
export class UIAspectRatioConstraint extends Instance {
    AspectRatio = 1;
    AspectType = "FitWithinMaxSize";
    DominantAxis = "Width";
    constructor() { super("UIAspectRatioConstraint"); }
}
export class UISizeConstraint extends Instance {
    MinSize = Vector2.zero;
    MaxSize = new Vector2(Infinity, Infinity);
    constructor() { super("UISizeConstraint"); }
}
// Networking Instances
export class RemoteEvent extends Instance {
    OnServerEvent;
    OnClientEvent;
    constructor() {
        super("RemoteEvent");
        this.OnServerEvent = new RBXScriptSignal("OnServerEvent", this);
        this.OnClientEvent = new RBXScriptSignal("OnClientEvent", this);
    }
    FireServer(...args) {
        // Dispatches to OnServerEvent (with mock player argument first)
        const mockPlayer = { Name: "Player1", UserId: 12345678 };
        this.OnServerEvent.Fire(mockPlayer, ...args);
    }
    FireClient(player, ...args) {
        this.OnClientEvent.Fire(...args);
    }
    FireAllClients(...args) {
        this.OnClientEvent.Fire(...args);
    }
}
export class RemoteFunction extends Instance {
    OnServerInvoke = null;
    OnClientInvoke = null;
    constructor() {
        super("RemoteFunction");
    }
    InvokeServer(...args) {
        if (this.OnServerInvoke) {
            const mockPlayer = { Name: "Player1", UserId: 12345678 };
            return this.OnServerInvoke(mockPlayer, ...args);
        }
        return null;
    }
    InvokeClient(player, ...args) {
        if (this.OnClientInvoke) {
            return this.OnClientInvoke(...args);
        }
        return null;
    }
}
export class BindableEvent extends Instance {
    Event;
    constructor() {
        super("BindableEvent");
        this.Event = new RBXScriptSignal("Event", this);
    }
    Fire(...args) {
        this.Event.Fire(...args);
    }
}
export class Tool extends Instance {
    RequiresHandle = true;
    CanBeDropped = true;
    ToolTip = "";
    Enabled = true;
    Grip = CFrame.identity;
    GripPos = Vector3.zero;
    Equipped;
    Unequipped;
    Activated;
    Deactivated;
    constructor() {
        super("Tool");
        this.Equipped = new RBXScriptSignal("Equipped", this);
        this.Unequipped = new RBXScriptSignal("Unequipped", this);
        this.Activated = new RBXScriptSignal("Activated", this);
        this.Deactivated = new RBXScriptSignal("Deactivated", this);
    }
    Activate() {
        if (this.Enabled) {
            this.Activated.Fire();
        }
    }
    Deactivate() {
        this.Deactivated.Fire();
    }
}
export class ClickDetector extends Instance {
    MaxActivationDistance = 32;
    CursorIcon = "";
    MouseClick;
    MouseHoverEnter;
    MouseHoverLeave;
    constructor() {
        super("ClickDetector");
        this.MouseClick = new RBXScriptSignal("MouseClick", this);
        this.MouseHoverEnter = new RBXScriptSignal("MouseHoverEnter", this);
        this.MouseHoverLeave = new RBXScriptSignal("MouseHoverLeave", this);
    }
}
export class ProximityPrompt extends Instance {
    ActionText = "Interact";
    ObjectText = "";
    KeyboardKeyCode = "E";
    HoldDuration = 0;
    MaxActivationDistance = 10;
    RequiresLineOfSight = false;
    Enabled = true;
    Triggered;
    PromptButtonHoldBegan;
    PromptButtonHoldEnded;
    constructor() {
        super("ProximityPrompt");
        this.Triggered = new RBXScriptSignal("Triggered", this);
        this.PromptButtonHoldBegan = new RBXScriptSignal("PromptButtonHoldBegan", this);
        this.PromptButtonHoldEnded = new RBXScriptSignal("PromptButtonHoldEnded", this);
    }
}
export class BillboardGui extends Instance {
    Adornee = null;
    Size = new UDim2(0, 100, 0, 40);
    StudsOffset = new Vector3(0, 2, 0);
    AlwaysOnTop = false;
    ExtentsOffset = new Vector3(0, 0, 0);
    Enabled = true;
    ClipsDescendants = false;
    constructor() {
        super("BillboardGui");
    }
}
export class Sound extends Instance {
    SoundId = "";
    Volume = 0.5;
    PlaybackSpeed = 1.0;
    Playing = false;
    Looped = false;
    TimeLength = 2.0;
    Ended;
    Played;
    constructor() {
        super("Sound");
        this.Ended = new RBXScriptSignal("Ended", this);
        this.Played = new RBXScriptSignal("Played", this);
    }
    Play() {
        this.Playing = true;
        this.Played.Fire();
    }
    Stop() {
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
    static classMap = {
        Instance: class extends Instance {
            constructor() { super("Instance"); }
        },
        Folder: class extends Instance {
            constructor() { super("Folder"); }
        },
        Model: Model,
        Humanoid: Humanoid,
        Motor6D: Motor6D,
        Part: BasePart,
        MeshPart: class extends BasePart {
            constructor() { super("MeshPart"); }
        },
        WedgePart: class extends BasePart {
            constructor() { super("WedgePart"); }
        },
        TrussPart: class extends BasePart {
            constructor() { super("TrussPart"); }
        },
        SpawnLocation: class extends BasePart {
            constructor() { super("SpawnLocation"); }
        },
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
        StringValue: class extends Instance {
            Value = "";
            constructor() { super("StringValue"); }
        },
        IntValue: class extends Instance {
            Value = 0;
            constructor() { super("IntValue"); }
        },
        NumberValue: class extends Instance {
            Value = 0;
            constructor() { super("NumberValue"); }
        },
        BoolValue: class extends Instance {
            Value = false;
            constructor() { super("BoolValue"); }
        },
        ObjectValue: class extends Instance {
            Value = null;
            constructor() { super("ObjectValue"); }
        },
        CFrameValue: class extends Instance {
            Value = CFrame.identity;
            constructor() { super("CFrameValue"); }
        },
        Vector3Value: class extends Instance {
            Value = Vector3.zero;
            constructor() { super("Vector3Value"); }
        },
        Color3Value: class extends Instance {
            Value = Color3.fromRGB(0, 0, 0);
            constructor() { super("Color3Value"); }
        },
    };
    static registerClass(className, ctor) {
        this.classMap[className] = ctor;
    }
    static new(className, parent) {
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
