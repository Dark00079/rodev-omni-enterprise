/**
 * Roblox Core Datatypes & Vector/CFrame 3D Matrix Math
 */
export class Vector2 {
    X;
    Y;
    constructor(x = 0, y = 0) {
        this.X = x;
        this.Y = y;
    }
    static zero = new Vector2(0, 0);
    static one = new Vector2(1, 1);
    static xAxis = new Vector2(1, 0);
    static yAxis = new Vector2(0, 1);
    static new(x = 0, y = 0) {
        return new Vector2(x, y);
    }
    get Magnitude() {
        return Math.sqrt(this.X * this.X + this.Y * this.Y);
    }
    get Unit() {
        const mag = this.Magnitude;
        return mag === 0 ? Vector2.zero : new Vector2(this.X / mag, this.Y / mag);
    }
    Dot(other) {
        return this.X * other.X + this.Y * other.Y;
    }
    Lerp(other, alpha) {
        return new Vector2(this.X + (other.X - this.X) * alpha, this.Y + (other.Y - this.Y) * alpha);
    }
    add(other) {
        return new Vector2(this.X + other.X, this.Y + other.Y);
    }
    sub(other) {
        return new Vector2(this.X - other.X, this.Y - other.Y);
    }
    mul(scalar) {
        if (typeof scalar === 'number') {
            return new Vector2(this.X * scalar, this.Y * scalar);
        }
        return new Vector2(this.X * scalar.X, this.Y * scalar.Y);
    }
    div(scalar) {
        if (typeof scalar === 'number') {
            return new Vector2(this.X / scalar, this.Y / scalar);
        }
        return new Vector2(this.X / scalar.X, this.Y / scalar.Y);
    }
    toString() {
        return `${this.X}, ${this.Y}`;
    }
}
export class Vector3 {
    X;
    Y;
    Z;
    constructor(x = 0, y = 0, z = 0) {
        this.X = x;
        this.Y = y;
        this.Z = z;
    }
    static zero = new Vector3(0, 0, 0);
    static one = new Vector3(1, 1, 1);
    static xAxis = new Vector3(1, 0, 0);
    static yAxis = new Vector3(0, 1, 0);
    static zAxis = new Vector3(0, 0, 1);
    static new(x = 0, y = 0, z = 0) {
        return new Vector3(x, y, z);
    }
    static fromAxis(axis) {
        return axis.Unit;
    }
    get Magnitude() {
        return Math.sqrt(this.X * this.X + this.Y * this.Y + this.Z * this.Z);
    }
    get Unit() {
        const mag = this.Magnitude;
        return mag === 0 ? Vector3.zero : new Vector3(this.X / mag, this.Y / mag, this.Z / mag);
    }
    Dot(other) {
        return this.X * other.X + this.Y * other.Y + this.Z * other.Z;
    }
    Cross(other) {
        return new Vector3(this.Y * other.Z - this.Z * other.Y, this.Z * other.X - this.X * other.Z, this.X * other.Y - this.Y * other.X);
    }
    Lerp(other, alpha) {
        return new Vector3(this.X + (other.X - this.X) * alpha, this.Y + (other.Y - this.Y) * alpha, this.Z + (other.Z - this.Z) * alpha);
    }
    add(other) {
        return new Vector3(this.X + other.X, this.Y + other.Y, this.Z + other.Z);
    }
    sub(other) {
        return new Vector3(this.X - other.X, this.Y - other.Y, this.Z - other.Z);
    }
    mul(scalar) {
        if (typeof scalar === 'number') {
            return new Vector3(this.X * scalar, this.Y * scalar, this.Z * scalar);
        }
        return new Vector3(this.X * scalar.X, this.Y * scalar.Y, this.Z * scalar.Z);
    }
    div(scalar) {
        if (typeof scalar === 'number') {
            return new Vector3(this.X / scalar, this.Y / scalar, this.Z / scalar);
        }
        return new Vector3(this.X / scalar.X, this.Y / scalar.Y, this.Z / scalar.Z);
    }
    toString() {
        return `${this.X}, ${this.Y}, ${this.Z}`;
    }
}
export class CFrame {
    // 12 components: x, y, z, R00, R01, R02, R10, R11, R12, R20, R21, R22
    x;
    y;
    z;
    R00;
    R01;
    R02;
    R10;
    R11;
    R12;
    R20;
    R21;
    R22;
    constructor(x = 0, y = 0, z = 0, r00 = 1, r01 = 0, r02 = 0, r10 = 0, r11 = 1, r12 = 0, r20 = 0, r21 = 0, r22 = 1) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.R00 = r00;
        this.R01 = r01;
        this.R02 = r02;
        this.R10 = r10;
        this.R11 = r11;
        this.R12 = r12;
        this.R20 = r20;
        this.R21 = r21;
        this.R22 = r22;
    }
    static identity = new CFrame(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1);
    static new(...args) {
        if (args.length === 0)
            return CFrame.identity;
        if (args.length === 1 && args[0] instanceof Vector3) {
            return new CFrame(args[0].X, args[0].Y, args[0].Z);
        }
        if (args.length === 2 && args[0] instanceof Vector3 && args[1] instanceof Vector3) {
            return CFrame.lookAt(args[0], args[1]);
        }
        if (args.length === 3) {
            return new CFrame(args[0], args[1], args[2]);
        }
        if (args.length === 12) {
            return new CFrame(args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7], args[8], args[9], args[10], args[11]);
        }
        return CFrame.identity;
    }
    static lookAt(at, lookAt, customUp = Vector3.yAxis) {
        let forward = lookAt.sub(at);
        if (forward.Magnitude === 0) {
            forward = new Vector3(0, 0, -1);
        }
        else {
            forward = forward.Unit;
        }
        let right = forward.Cross(customUp);
        if (right.Magnitude === 0) {
            right = new Vector3(1, 0, 0);
        }
        else {
            right = right.Unit;
        }
        const up = right.Cross(forward).Unit;
        // In Roblox CFrame, forward is -LookVector:
        // column 0: right (R00, R10, R20)
        // column 1: up    (R01, R11, R21)
        // column 2: -forward (back) (R02, R12, R22)
        const back = forward.mul(-1);
        return new CFrame(at.X, at.Y, at.Z, right.X, up.X, back.X, right.Y, up.Y, back.Y, right.Z, up.Z, back.Z);
    }
    static Angles(rx, ry, rz) {
        return CFrame.fromEulerAnglesXYZ(rx, ry, rz);
    }
    static fromEulerAnglesXYZ(rx, ry, rz) {
        const cx = Math.cos(rx), sx = Math.sin(rx);
        const cy = Math.cos(ry), sy = Math.sin(ry);
        const cz = Math.cos(rz), sz = Math.sin(rz);
        return new CFrame(0, 0, 0, cy * cz, -cy * sz, sy, sx * sy * cz + cx * sz, -sx * sy * sz + cx * cz, -sx * cy, -cx * sy * cz + sx * sz, cx * sy * sz + sx * cz, cx * cy);
    }
    get Position() {
        return new Vector3(this.x, this.y, this.z);
    }
    get X() { return this.x; }
    get Y() { return this.y; }
    get Z() { return this.z; }
    get LookVector() {
        return new Vector3(-this.R02, -this.R12, -this.R22);
    }
    get RightVector() {
        return new Vector3(this.R00, this.R10, this.R20);
    }
    get UpVector() {
        return new Vector3(this.R01, this.R11, this.R21);
    }
    mul(other) {
        if (other instanceof Vector3) {
            return this.PointToWorldSpace(other);
        }
        // CFrame * CFrame matrix multiplication
        const a = this;
        const b = other;
        const x = a.x + a.R00 * b.x + a.R01 * b.y + a.R02 * b.z;
        const y = a.y + a.R10 * b.x + a.R11 * b.y + a.R12 * b.z;
        const z = a.z + a.R20 * b.x + a.R21 * b.y + a.R22 * b.z;
        const r00 = a.R00 * b.R00 + a.R01 * b.R10 + a.R02 * b.R20;
        const r01 = a.R00 * b.R01 + a.R01 * b.R11 + a.R02 * b.R21;
        const r02 = a.R00 * b.R02 + a.R01 * b.R12 + a.R02 * b.R22;
        const r10 = a.R10 * b.R00 + a.R11 * b.R10 + a.R12 * b.R20;
        const r11 = a.R10 * b.R01 + a.R11 * b.R11 + a.R12 * b.R21;
        const r12 = a.R10 * b.R02 + a.R11 * b.R12 + a.R12 * b.R22;
        const r20 = a.R20 * b.R00 + a.R21 * b.R10 + a.R22 * b.R20;
        const r21 = a.R20 * b.R01 + a.R21 * b.R11 + a.R22 * b.R21;
        const r22 = a.R20 * b.R02 + a.R21 * b.R12 + a.R22 * b.R22;
        return new CFrame(x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22);
    }
    add(v) {
        return new CFrame(this.x + v.X, this.y + v.Y, this.z + v.Z, this.R00, this.R01, this.R02, this.R10, this.R11, this.R12, this.R20, this.R21, this.R22);
    }
    sub(v) {
        return new CFrame(this.x - v.X, this.y - v.Y, this.z - v.Z, this.R00, this.R01, this.R02, this.R10, this.R11, this.R12, this.R20, this.R21, this.R22);
    }
    Inverse() {
        // Inverse of rigid transform:
        // R_inv = R^T
        // p_inv = -R^T * p
        const invR00 = this.R00, invR01 = this.R10, invR02 = this.R20;
        const invR10 = this.R01, invR11 = this.R11, invR12 = this.R21;
        const invR20 = this.R02, invR21 = this.R12, invR22 = this.R22;
        const px = -(invR00 * this.x + invR01 * this.y + invR02 * this.z);
        const py = -(invR10 * this.x + invR11 * this.y + invR12 * this.z);
        const pz = -(invR20 * this.x + invR21 * this.y + invR22 * this.z);
        return new CFrame(px, py, pz, invR00, invR01, invR02, invR10, invR11, invR12, invR20, invR21, invR22);
    }
    PointToWorldSpace(point) {
        return new Vector3(this.x + this.R00 * point.X + this.R01 * point.Y + this.R02 * point.Z, this.y + this.R10 * point.X + this.R11 * point.Y + this.R12 * point.Z, this.z + this.R20 * point.X + this.R21 * point.Y + this.R22 * point.Z);
    }
    PointToObjectSpace(point) {
        return this.Inverse().PointToWorldSpace(point);
    }
    VectorToWorldSpace(vector) {
        return new Vector3(this.R00 * vector.X + this.R01 * vector.Y + this.R02 * vector.Z, this.R10 * vector.X + this.R11 * vector.Y + this.R12 * vector.Z, this.R20 * vector.X + this.R21 * vector.Y + this.R22 * vector.Z);
    }
    VectorToObjectSpace(vector) {
        return this.Inverse().VectorToWorldSpace(vector);
    }
    ToWorldSpace(cf) {
        return this.mul(cf);
    }
    ToObjectSpace(cf) {
        return this.Inverse().mul(cf);
    }
    Lerp(goal, alpha) {
        const pos = this.Position.Lerp(goal.Position, alpha);
        // Simple matrix slerp/lerp with orthonormalization
        const r00 = this.R00 + (goal.R00 - this.R00) * alpha;
        const r01 = this.R01 + (goal.R01 - this.R01) * alpha;
        const r02 = this.R02 + (goal.R02 - this.R02) * alpha;
        const r10 = this.R10 + (goal.R10 - this.R10) * alpha;
        const r11 = this.R11 + (goal.R11 - this.R11) * alpha;
        const r12 = this.R12 + (goal.R12 - this.R12) * alpha;
        const r20 = this.R20 + (goal.R20 - this.R20) * alpha;
        const r21 = this.R21 + (goal.R21 - this.R21) * alpha;
        const r22 = this.R22 + (goal.R22 - this.R22) * alpha;
        return new CFrame(pos.X, pos.Y, pos.Z, r00, r01, r02, r10, r11, r12, r20, r21, r22);
    }
    components() {
        return [
            this.x, this.y, this.z,
            this.R00, this.R01, this.R02,
            this.R10, this.R11, this.R12,
            this.R20, this.R21, this.R22
        ];
    }
    toString() {
        return this.components().map(v => Number(v.toFixed(3))).join(", ");
    }
}
export class UDim {
    Scale;
    Offset;
    constructor(scale = 0, offset = 0) {
        this.Scale = scale;
        this.Offset = offset;
    }
    static new(scale = 0, offset = 0) {
        return new UDim(scale, offset);
    }
    add(other) {
        return new UDim(this.Scale + other.Scale, this.Offset + other.Offset);
    }
    sub(other) {
        return new UDim(this.Scale - other.Scale, this.Offset - other.Offset);
    }
    toString() {
        return `${this.Scale}, ${this.Offset}`;
    }
}
export class UDim2 {
    X;
    Y;
    constructor(xScaleOrX = 0, xOffsetOrY = 0, yScale = 0, yOffset = 0) {
        if (xScaleOrX instanceof UDim && xOffsetOrY instanceof UDim) {
            this.X = xScaleOrX;
            this.Y = xOffsetOrY;
        }
        else {
            this.X = new UDim(xScaleOrX, xOffsetOrY);
            this.Y = new UDim(yScale, yOffset);
        }
    }
    static new(xScale = 0, xOffset = 0, yScale = 0, yOffset = 0) {
        return new UDim2(xScale, xOffset, yScale, yOffset);
    }
    static fromScale(xScale, yScale) {
        return new UDim2(xScale, 0, yScale, 0);
    }
    static fromOffset(xOffset, yOffset) {
        return new UDim2(0, xOffset, 0, yOffset);
    }
    get Width() { return this.X; }
    get Height() { return this.Y; }
    Lerp(other, alpha) {
        return new UDim2(this.X.Scale + (other.X.Scale - this.X.Scale) * alpha, this.X.Offset + (other.X.Offset - this.X.Offset) * alpha, this.Y.Scale + (other.Y.Scale - this.Y.Scale) * alpha, this.Y.Offset + (other.Y.Offset - this.Y.Offset) * alpha);
    }
    add(other) {
        return new UDim2(this.X.add(other.X), this.Y.add(other.Y));
    }
    sub(other) {
        return new UDim2(this.X.sub(other.X), this.Y.sub(other.Y));
    }
    toString() {
        return `{${this.X.Scale}, ${this.X.Offset}}, {${this.Y.Scale}, ${this.Y.Offset}}`;
    }
}
export class Color3 {
    R;
    G;
    B;
    constructor(r = 0, g = 0, b = 0) {
        this.R = Math.max(0, Math.min(1, r));
        this.G = Math.max(0, Math.min(1, g));
        this.B = Math.max(0, Math.min(1, b));
    }
    static new(r = 0, g = 0, b = 0) {
        return new Color3(r, g, b);
    }
    static fromRGB(r = 0, g = 0, b = 0) {
        return new Color3(r / 255, g / 255, b / 255);
    }
    static fromHSV(h = 0, s = 0, v = 0) {
        let r = 0, g = 0, b = 0;
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const p = v * (1 - s);
        const q = v * (1 - f * s);
        const t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0:
                r = v;
                g = t;
                b = p;
                break;
            case 1:
                r = q;
                g = v;
                b = p;
                break;
            case 2:
                r = p;
                g = v;
                b = t;
                break;
            case 3:
                r = p;
                g = q;
                b = v;
                break;
            case 4:
                r = t;
                g = p;
                b = v;
                break;
            case 5:
                r = v;
                g = p;
                b = q;
                break;
        }
        return new Color3(r, g, b);
    }
    static fromHex(hex) {
        let clean = hex.replace("#", "");
        if (clean.length === 3) {
            clean = clean.split("").map(c => c + c).join("");
        }
        const num = parseInt(clean, 16);
        return Color3.fromRGB((num >> 16) & 255, (num >> 8) & 255, num & 255);
    }
    toHex() {
        const r = Math.round(this.R * 255).toString(16).padStart(2, '0');
        const g = Math.round(this.G * 255).toString(16).padStart(2, '0');
        const b = Math.round(this.B * 255).toString(16).padStart(2, '0');
        return `${r}${g}${b}`;
    }
    toRgbString() {
        return `rgb(${Math.round(this.R * 255)}, ${Math.round(this.G * 255)}, ${Math.round(this.B * 255)})`;
    }
    Lerp(other, alpha) {
        return new Color3(this.R + (other.R - this.R) * alpha, this.G + (other.G - this.G) * alpha, this.B + (other.B - this.B) * alpha);
    }
    toString() {
        return `${this.R}, ${this.G}, ${this.B}`;
    }
}
export class ColorSequenceKeypoint {
    Time;
    Value;
    constructor(time, value) {
        this.Time = time;
        this.Value = value;
    }
    static new(time, value) {
        return new ColorSequenceKeypoint(time, value);
    }
}
export class ColorSequence {
    Keypoints;
    constructor(...args) {
        if (args.length === 1 && Array.isArray(args[0])) {
            this.Keypoints = args[0];
        }
        else if (args.length === 1 && args[0] instanceof Color3) {
            this.Keypoints = [
                new ColorSequenceKeypoint(0, args[0]),
                new ColorSequenceKeypoint(1, args[0])
            ];
        }
        else if (args.length === 2 && args[0] instanceof Color3 && args[1] instanceof Color3) {
            this.Keypoints = [
                new ColorSequenceKeypoint(0, args[0]),
                new ColorSequenceKeypoint(1, args[1])
            ];
        }
        else {
            this.Keypoints = [];
        }
    }
    static new(...args) {
        return new ColorSequence(...args);
    }
}
export class NumberSequenceKeypoint {
    Time;
    Value;
    Envelope;
    constructor(time, value, envelope = 0) {
        this.Time = time;
        this.Value = value;
        this.Envelope = envelope;
    }
    static new(time, value, envelope = 0) {
        return new NumberSequenceKeypoint(time, value, envelope);
    }
}
export class NumberSequence {
    Keypoints;
    constructor(...args) {
        if (args.length === 1 && Array.isArray(args[0])) {
            this.Keypoints = args[0];
        }
        else if (args.length === 1 && typeof args[0] === 'number') {
            this.Keypoints = [
                new NumberSequenceKeypoint(0, args[0]),
                new NumberSequenceKeypoint(1, args[0])
            ];
        }
        else if (args.length === 2 && typeof args[0] === 'number' && typeof args[1] === 'number') {
            this.Keypoints = [
                new NumberSequenceKeypoint(0, args[0]),
                new NumberSequenceKeypoint(1, args[1])
            ];
        }
        else {
            this.Keypoints = [];
        }
    }
    static new(...args) {
        return new NumberSequence(...args);
    }
}
export class Ray {
    Origin;
    Direction;
    constructor(origin = Vector3.zero, direction = Vector3.zero) {
        this.Origin = origin;
        this.Direction = direction;
    }
    static new(origin, direction) {
        return new Ray(origin, direction);
    }
    get Unit() {
        return new Ray(this.Origin, this.Direction.Unit);
    }
    ClosestPoint(point) {
        const diff = point.sub(this.Origin);
        const dirUnit = this.Direction.Unit;
        const proj = diff.Dot(dirUnit);
        return this.Origin.add(dirUnit.mul(Math.max(0, proj)));
    }
}
export class RaycastParams {
    FilterDescendantsInstances = [];
    FilterType = 0; // 0 = Exclude, 1 = Include
    IgnoreWater = false;
    CollisionGroup = "Default";
    static new() {
        return new RaycastParams();
    }
}
export class RaycastResult {
    Instance;
    Position;
    Normal;
    Distance;
    Material;
    constructor(instance, position, normal, distance, material = "Plastic") {
        this.Instance = instance;
        this.Position = position;
        this.Normal = normal;
        this.Distance = distance;
        this.Material = material;
    }
}
export class OverlapParams {
    FilterDescendantsInstances = [];
    FilterType = 0;
    MaxParts = 0;
    CollisionGroup = "Default";
    static new() {
        return new OverlapParams();
    }
}
export class TweenInfo {
    Time;
    EasingStyle;
    EasingDirection;
    RepeatCount;
    Reverses;
    DelayTime;
    constructor(time = 1, easingStyle = "Quad", easingDirection = "Out", repeatCount = 0, reverses = false, delayTime = 0) {
        this.Time = time;
        this.EasingStyle = easingStyle;
        this.EasingDirection = easingDirection;
        this.RepeatCount = repeatCount;
        this.Reverses = reverses;
        this.DelayTime = delayTime;
    }
    static new(time = 1, easingStyle = "Quad", easingDirection = "Out", repeatCount = 0, reverses = false, delayTime = 0) {
        return new TweenInfo(time, easingStyle, easingDirection, repeatCount, reverses, delayTime);
    }
}
export class Rect {
    Min;
    Max;
    constructor(minXOrMin = 0, minYOrMax = 0, maxX = 0, maxY = 0) {
        if (minXOrMin instanceof Vector2 && minYOrMax instanceof Vector2) {
            this.Min = minXOrMin;
            this.Max = minYOrMax;
        }
        else {
            this.Min = new Vector2(minXOrMin, minYOrMax);
            this.Max = new Vector2(maxX, maxY);
        }
    }
    static new(minX = 0, minY = 0, maxX = 0, maxY = 0) {
        return new Rect(minX, minY, maxX, maxY);
    }
    get Width() { return this.Max.X - this.Min.X; }
    get Height() { return this.Max.Y - this.Min.Y; }
}
// Complete Roblox Enum Registry
export function createEnumItem(enumName, name, value) {
    return {
        Name: name,
        Value: value,
        EnumType: enumName,
        toString: () => `Enum.${enumName}.${name}`
    };
}
export function buildEnumDictionary() {
    const enumDefinitions = {
        RaycastFilterType: ["Exclude", "Include", "Blacklist", "Whitelist"],
        EasingStyle: ["Linear", "Sine", "Back", "Quad", "Quart", "Quint", "Bounce", "Elastic", "Exponential", "Circular", "Cubic"],
        EasingDirection: ["In", "Out", "InOut"],
        Font: [
            "Legacy", "Arial", "ArialBold", "SourceSans", "SourceSansBold", "SourceSansItalic",
            "SourceSansLight", "SourceSansSemibold", "Gotham", "GothamMedium", "GothamBold",
            "GothamBlack", "Ubuntu", "Roboto", "RobotoMono", "BuilderSans", "BuilderSansBold",
            "Montserrat", "Fondamento", "PressStart2P", "FredokaOne"
        ],
        Material: ["Plastic", "SmoothPlastic", "Neon", "Wood", "Metal", "DiamondPlate", "Glass", "ForceField", "Foil", "Grass", "Ice", "Brick", "Concrete"],
        UserInputType: [
            "MouseButton1", "MouseButton2", "MouseButton3", "MouseWheel", "MouseMove",
            "Touch", "Keyboard", "Focus", "Gamepad1", "None"
        ],
        KeyCode: [
            "Unknown", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N",
            "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
            "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
            "Space", "Return", "Backspace", "Tab", "Escape", "LeftShift", "RightShift",
            "LeftControl", "RightControl", "LeftAlt", "RightAlt"
        ],
        CoreGuiType: ["PlayerList", "Health", "Backpack", "Chat", "All", "EmotesMenu"],
        NormalId: ["Top", "Bottom", "Left", "Right", "Front", "Back"]
    };
    const Enum = {};
    for (const [enumName, items] of Object.entries(enumDefinitions)) {
        const enumGroup = {
            GetEnumItems: () => items.map((item, idx) => createEnumItem(enumName, item, idx))
        };
        items.forEach((item, idx) => {
            enumGroup[item] = createEnumItem(enumName, item, idx);
        });
        Enum[enumName] = enumGroup;
    }
    return Enum;
}
export const Enum = buildEnumDictionary();
