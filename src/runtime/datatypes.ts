/**
 * Roblox Core Datatypes & Vector/CFrame 3D Matrix Math
 */

export class Vector2 {
  public readonly X: number;
  public readonly Y: number;

  constructor(x: number = 0, y: number = 0) {
    this.X = x;
    this.Y = y;
  }

  public static readonly zero = new Vector2(0, 0);
  public static readonly one = new Vector2(1, 1);
  public static readonly xAxis = new Vector2(1, 0);
  public static readonly yAxis = new Vector2(0, 1);

  public static new(x: number = 0, y: number = 0): Vector2 {
    return new Vector2(x, y);
  }

  public get Magnitude(): number {
    return Math.sqrt(this.X * this.X + this.Y * this.Y);
  }

  public get Unit(): Vector2 {
    const mag = this.Magnitude;
    return mag === 0 ? Vector2.zero : new Vector2(this.X / mag, this.Y / mag);
  }

  public Dot(other: Vector2): number {
    return this.X * other.X + this.Y * other.Y;
  }

  public Lerp(other: Vector2, alpha: number): Vector2 {
    return new Vector2(
      this.X + (other.X - this.X) * alpha,
      this.Y + (other.Y - this.Y) * alpha
    );
  }

  public add(other: Vector2): Vector2 {
    return new Vector2(this.X + other.X, this.Y + other.Y);
  }

  public sub(other: Vector2): Vector2 {
    return new Vector2(this.X - other.X, this.Y - other.Y);
  }

  public mul(scalar: number | Vector2): Vector2 {
    if (typeof scalar === 'number') {
      return new Vector2(this.X * scalar, this.Y * scalar);
    }
    return new Vector2(this.X * scalar.X, this.Y * scalar.Y);
  }

  public div(scalar: number | Vector2): Vector2 {
    if (typeof scalar === 'number') {
      return new Vector2(this.X / scalar, this.Y / scalar);
    }
    return new Vector2(this.X / scalar.X, this.Y / scalar.Y);
  }

  public toString(): string {
    return `${this.X}, ${this.Y}`;
  }
}

export class Vector3 {
  public readonly X: number;
  public readonly Y: number;
  public readonly Z: number;

  constructor(x: number = 0, y: number = 0, z: number = 0) {
    this.X = x;
    this.Y = y;
    this.Z = z;
  }

  public static readonly zero = new Vector3(0, 0, 0);
  public static readonly one = new Vector3(1, 1, 1);
  public static readonly xAxis = new Vector3(1, 0, 0);
  public static readonly yAxis = new Vector3(0, 1, 0);
  public static readonly zAxis = new Vector3(0, 0, 1);

  public static new(x: number = 0, y: number = 0, z: number = 0): Vector3 {
    return new Vector3(x, y, z);
  }

  public static fromAxis(axis: Vector3): Vector3 {
    return axis.Unit;
  }

  public get Magnitude(): number {
    return Math.sqrt(this.X * this.X + this.Y * this.Y + this.Z * this.Z);
  }

  public get Unit(): Vector3 {
    const mag = this.Magnitude;
    return mag === 0 ? Vector3.zero : new Vector3(this.X / mag, this.Y / mag, this.Z / mag);
  }

  public Dot(other: Vector3): number {
    return this.X * other.X + this.Y * other.Y + this.Z * other.Z;
  }

  public Cross(other: Vector3): Vector3 {
    return new Vector3(
      this.Y * other.Z - this.Z * other.Y,
      this.Z * other.X - this.X * other.Z,
      this.X * other.Y - this.Y * other.X
    );
  }

  public Lerp(other: Vector3, alpha: number): Vector3 {
    return new Vector3(
      this.X + (other.X - this.X) * alpha,
      this.Y + (other.Y - this.Y) * alpha,
      this.Z + (other.Z - this.Z) * alpha
    );
  }

  public add(other: Vector3): Vector3 {
    return new Vector3(this.X + other.X, this.Y + other.Y, this.Z + other.Z);
  }

  public sub(other: Vector3): Vector3 {
    return new Vector3(this.X - other.X, this.Y - other.Y, this.Z - other.Z);
  }

  public mul(scalar: number | Vector3): Vector3 {
    if (typeof scalar === 'number') {
      return new Vector3(this.X * scalar, this.Y * scalar, this.Z * scalar);
    }
    return new Vector3(this.X * scalar.X, this.Y * scalar.Y, this.Z * scalar.Z);
  }

  public div(scalar: number | Vector3): Vector3 {
    if (typeof scalar === 'number') {
      return new Vector3(this.X / scalar, this.Y / scalar, this.Z / scalar);
    }
    return new Vector3(this.X / scalar.X, this.Y / scalar.Y, this.Z / scalar.Z);
  }

  public toString(): string {
    return `${this.X}, ${this.Y}, ${this.Z}`;
  }
}

export class CFrame {
  // 12 components: x, y, z, R00, R01, R02, R10, R11, R12, R20, R21, R22
  public readonly x: number;
  public readonly y: number;
  public readonly z: number;
  public readonly R00: number; public readonly R01: number; public readonly R02: number;
  public readonly R10: number; public readonly R11: number; public readonly R12: number;
  public readonly R20: number; public readonly R21: number; public readonly R22: number;

  constructor(
    x = 0, y = 0, z = 0,
    r00 = 1, r01 = 0, r02 = 0,
    r10 = 0, r11 = 1, r12 = 0,
    r20 = 0, r21 = 0, r22 = 1
  ) {
    this.x = x; this.y = y; this.z = z;
    this.R00 = r00; this.R01 = r01; this.R02 = r02;
    this.R10 = r10; this.R11 = r11; this.R12 = r12;
    this.R20 = r20; this.R21 = r21; this.R22 = r22;
  }

  public static readonly identity = new CFrame(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1);

  public static new(...args: any[]): CFrame {
    if (args.length === 0) return CFrame.identity;
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
      return new CFrame(
        args[0], args[1], args[2],
        args[3], args[4], args[5],
        args[6], args[7], args[8],
        args[9], args[10], args[11]
      );
    }
    return CFrame.identity;
  }

  public static lookAt(at: Vector3, lookAt: Vector3, customUp: Vector3 = Vector3.yAxis): CFrame {
    let forward = lookAt.sub(at);
    if (forward.Magnitude === 0) {
      forward = new Vector3(0, 0, -1);
    } else {
      forward = forward.Unit;
    }

    let right = forward.Cross(customUp);
    if (right.Magnitude === 0) {
      right = new Vector3(1, 0, 0);
    } else {
      right = right.Unit;
    }

    const up = right.Cross(forward).Unit;
    // In Roblox CFrame, forward is -LookVector:
    // column 0: right (R00, R10, R20)
    // column 1: up    (R01, R11, R21)
    // column 2: -forward (back) (R02, R12, R22)
    const back = forward.mul(-1);

    return new CFrame(
      at.X, at.Y, at.Z,
      right.X, up.X, back.X,
      right.Y, up.Y, back.Y,
      right.Z, up.Z, back.Z
    );
  }

  public static Angles(rx: number, ry: number, rz: number): CFrame {
    return CFrame.fromEulerAnglesXYZ(rx, ry, rz);
  }

  public static fromEulerAnglesXYZ(rx: number, ry: number, rz: number): CFrame {
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);

    return new CFrame(
      0, 0, 0,
      cy * cz, -cy * sz, sy,
      sx * sy * cz + cx * sz, -sx * sy * sz + cx * cz, -sx * cy,
      -cx * sy * cz + sx * sz, cx * sy * sz + sx * cz, cx * cy
    );
  }

  public get Position(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  public get X(): number { return this.x; }
  public get Y(): number { return this.y; }
  public get Z(): number { return this.z; }

  public get LookVector(): Vector3 {
    return new Vector3(-this.R02, -this.R12, -this.R22);
  }

  public get RightVector(): Vector3 {
    return new Vector3(this.R00, this.R10, this.R20);
  }

  public get UpVector(): Vector3 {
    return new Vector3(this.R01, this.R11, this.R21);
  }

  public mul(other: CFrame | Vector3): any {
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

  public add(v: Vector3): CFrame {
    return new CFrame(
      this.x + v.X, this.y + v.Y, this.z + v.Z,
      this.R00, this.R01, this.R02,
      this.R10, this.R11, this.R12,
      this.R20, this.R21, this.R22
    );
  }

  public sub(v: Vector3): CFrame {
    return new CFrame(
      this.x - v.X, this.y - v.Y, this.z - v.Z,
      this.R00, this.R01, this.R02,
      this.R10, this.R11, this.R12,
      this.R20, this.R21, this.R22
    );
  }

  public Inverse(): CFrame {
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

  public PointToWorldSpace(point: Vector3): Vector3 {
    return new Vector3(
      this.x + this.R00 * point.X + this.R01 * point.Y + this.R02 * point.Z,
      this.y + this.R10 * point.X + this.R11 * point.Y + this.R12 * point.Z,
      this.z + this.R20 * point.X + this.R21 * point.Y + this.R22 * point.Z
    );
  }

  public PointToObjectSpace(point: Vector3): Vector3 {
    return this.Inverse().PointToWorldSpace(point);
  }

  public VectorToWorldSpace(vector: Vector3): Vector3 {
    return new Vector3(
      this.R00 * vector.X + this.R01 * vector.Y + this.R02 * vector.Z,
      this.R10 * vector.X + this.R11 * vector.Y + this.R12 * vector.Z,
      this.R20 * vector.X + this.R21 * vector.Y + this.R22 * vector.Z
    );
  }

  public VectorToObjectSpace(vector: Vector3): Vector3 {
    return this.Inverse().VectorToWorldSpace(vector);
  }

  public ToWorldSpace(cf: CFrame): CFrame {
    return this.mul(cf);
  }

  public ToObjectSpace(cf: CFrame): CFrame {
    return this.Inverse().mul(cf);
  }

  public Lerp(goal: CFrame, alpha: number): CFrame {
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

  public components(): number[] {
    return [
      this.x, this.y, this.z,
      this.R00, this.R01, this.R02,
      this.R10, this.R11, this.R12,
      this.R20, this.R21, this.R22
    ];
  }

  public toString(): string {
    return this.components().map(v => Number(v.toFixed(3))).join(", ");
  }
}

export class UDim {
  public readonly Scale: number;
  public readonly Offset: number;

  constructor(scale = 0, offset = 0) {
    this.Scale = scale;
    this.Offset = offset;
  }

  public static new(scale = 0, offset = 0): UDim {
    return new UDim(scale, offset);
  }

  public add(other: UDim): UDim {
    return new UDim(this.Scale + other.Scale, this.Offset + other.Offset);
  }

  public sub(other: UDim): UDim {
    return new UDim(this.Scale - other.Scale, this.Offset - other.Offset);
  }

  public toString(): string {
    return `${this.Scale}, ${this.Offset}`;
  }
}

export class UDim2 {
  public readonly X: UDim;
  public readonly Y: UDim;

  constructor(xScaleOrX: number | UDim = 0, xOffsetOrY: number | UDim = 0, yScale = 0, yOffset = 0) {
    if (xScaleOrX instanceof UDim && xOffsetOrY instanceof UDim) {
      this.X = xScaleOrX;
      this.Y = xOffsetOrY;
    } else {
      this.X = new UDim(xScaleOrX as number, xOffsetOrY as number);
      this.Y = new UDim(yScale, yOffset);
    }
  }

  public static new(xScale = 0, xOffset = 0, yScale = 0, yOffset = 0): UDim2 {
    return new UDim2(xScale, xOffset, yScale, yOffset);
  }

  public static fromScale(xScale: number, yScale: number): UDim2 {
    return new UDim2(xScale, 0, yScale, 0);
  }

  public static fromOffset(xOffset: number, yOffset: number): UDim2 {
    return new UDim2(0, xOffset, 0, yOffset);
  }

  public get Width(): UDim { return this.X; }
  public get Height(): UDim { return this.Y; }

  public Lerp(other: UDim2, alpha: number): UDim2 {
    return new UDim2(
      this.X.Scale + (other.X.Scale - this.X.Scale) * alpha,
      this.X.Offset + (other.X.Offset - this.X.Offset) * alpha,
      this.Y.Scale + (other.Y.Scale - this.Y.Scale) * alpha,
      this.Y.Offset + (other.Y.Offset - this.Y.Offset) * alpha
    );
  }

  public add(other: UDim2): UDim2 {
    return new UDim2(this.X.add(other.X), this.Y.add(other.Y));
  }

  public sub(other: UDim2): UDim2 {
    return new UDim2(this.X.sub(other.X), this.Y.sub(other.Y));
  }

  public toString(): string {
    return `{${this.X.Scale}, ${this.X.Offset}}, {${this.Y.Scale}, ${this.Y.Offset}}`;
  }
}

export class Color3 {
  public readonly R: number;
  public readonly G: number;
  public readonly B: number;

  constructor(r = 0, g = 0, b = 0) {
    this.R = Math.max(0, Math.min(1, r));
    this.G = Math.max(0, Math.min(1, g));
    this.B = Math.max(0, Math.min(1, b));
  }

  public static new(r = 0, g = 0, b = 0): Color3 {
    return new Color3(r, g, b);
  }

  public static fromRGB(r = 0, g = 0, b = 0): Color3 {
    return new Color3(r / 255, g / 255, b / 255);
  }

  public static fromHSV(h = 0, s = 0, v = 0): Color3 {
    let r = 0, g = 0, b = 0;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return new Color3(r, g, b);
  }

  public static fromHex(hex: string): Color3 {
    let clean = hex.replace("#", "");
    if (clean.length === 3) {
      clean = clean.split("").map(c => c + c).join("");
    }
    const num = parseInt(clean, 16);
    return Color3.fromRGB((num >> 16) & 255, (num >> 8) & 255, num & 255);
  }

  public toHex(): string {
    const r = Math.round(this.R * 255).toString(16).padStart(2, '0');
    const g = Math.round(this.G * 255).toString(16).padStart(2, '0');
    const b = Math.round(this.B * 255).toString(16).padStart(2, '0');
    return `${r}${g}${b}`;
  }

  public toRgbString(): string {
    return `rgb(${Math.round(this.R * 255)}, ${Math.round(this.G * 255)}, ${Math.round(this.B * 255)})`;
  }

  public Lerp(other: Color3, alpha: number): Color3 {
    return new Color3(
      this.R + (other.R - this.R) * alpha,
      this.G + (other.G - this.G) * alpha,
      this.B + (other.B - this.B) * alpha
    );
  }

  public toString(): string {
    return `${this.R}, ${this.G}, ${this.B}`;
  }
}

export class ColorSequenceKeypoint {
  public readonly Time: number;
  public readonly Value: Color3;

  constructor(time: number, value: Color3) {
    this.Time = time;
    this.Value = value;
  }

  public static new(time: number, value: Color3): ColorSequenceKeypoint {
    return new ColorSequenceKeypoint(time, value);
  }
}

export class ColorSequence {
  public readonly Keypoints: ColorSequenceKeypoint[];

  constructor(...args: any[]) {
    if (args.length === 1 && Array.isArray(args[0])) {
      this.Keypoints = args[0];
    } else if (args.length === 1 && args[0] instanceof Color3) {
      this.Keypoints = [
        new ColorSequenceKeypoint(0, args[0]),
        new ColorSequenceKeypoint(1, args[0])
      ];
    } else if (args.length === 2 && args[0] instanceof Color3 && args[1] instanceof Color3) {
      this.Keypoints = [
        new ColorSequenceKeypoint(0, args[0]),
        new ColorSequenceKeypoint(1, args[1])
      ];
    } else {
      this.Keypoints = [];
    }
  }

  public static new(...args: any[]): ColorSequence {
    return new ColorSequence(...args);
  }
}

export class NumberSequenceKeypoint {
  public readonly Time: number;
  public readonly Value: number;
  public readonly Envelope: number;

  constructor(time: number, value: number, envelope = 0) {
    this.Time = time;
    this.Value = value;
    this.Envelope = envelope;
  }

  public static new(time: number, value: number, envelope = 0): NumberSequenceKeypoint {
    return new NumberSequenceKeypoint(time, value, envelope);
  }
}

export class NumberSequence {
  public readonly Keypoints: NumberSequenceKeypoint[];

  constructor(...args: any[]) {
    if (args.length === 1 && Array.isArray(args[0])) {
      this.Keypoints = args[0];
    } else if (args.length === 1 && typeof args[0] === 'number') {
      this.Keypoints = [
        new NumberSequenceKeypoint(0, args[0]),
        new NumberSequenceKeypoint(1, args[0])
      ];
    } else if (args.length === 2 && typeof args[0] === 'number' && typeof args[1] === 'number') {
      this.Keypoints = [
        new NumberSequenceKeypoint(0, args[0]),
        new NumberSequenceKeypoint(1, args[1])
      ];
    } else {
      this.Keypoints = [];
    }
  }

  public static new(...args: any[]): NumberSequence {
    return new NumberSequence(...args);
  }
}

export class Ray {
  public readonly Origin: Vector3;
  public readonly Direction: Vector3;

  constructor(origin: Vector3 = Vector3.zero, direction: Vector3 = Vector3.zero) {
    this.Origin = origin;
    this.Direction = direction;
  }

  public static new(origin: Vector3, direction: Vector3): Ray {
    return new Ray(origin, direction);
  }

  public get Unit(): Ray {
    return new Ray(this.Origin, this.Direction.Unit);
  }

  public ClosestPoint(point: Vector3): Vector3 {
    const diff = point.sub(this.Origin);
    const dirUnit = this.Direction.Unit;
    const proj = diff.Dot(dirUnit);
    return this.Origin.add(dirUnit.mul(Math.max(0, proj)));
  }
}

export class RaycastParams {
  public FilterDescendantsInstances: any[] = [];
  public FilterType: any = 0; // 0 = Exclude, 1 = Include
  public IgnoreWater: boolean = false;
  public CollisionGroup: string = "Default";

  public static new(): RaycastParams {
    return new RaycastParams();
  }
}

export class RaycastResult {
  public readonly Instance: any;
  public readonly Position: Vector3;
  public readonly Normal: Vector3;
  public readonly Distance: number;
  public readonly Material: any;

  constructor(instance: any, position: Vector3, normal: Vector3, distance: number, material: any = "Plastic") {
    this.Instance = instance;
    this.Position = position;
    this.Normal = normal;
    this.Distance = distance;
    this.Material = material;
  }
}

export class OverlapParams {
  public FilterDescendantsInstances: any[] = [];
  public FilterType: any = 0;
  public MaxParts: number = 0;
  public CollisionGroup: string = "Default";

  public static new(): OverlapParams {
    return new OverlapParams();
  }
}

export class TweenInfo {
  public readonly Time: number;
  public readonly EasingStyle: any;
  public readonly EasingDirection: any;
  public readonly RepeatCount: number;
  public readonly Reverses: boolean;
  public readonly DelayTime: number;

  constructor(
    time = 1,
    easingStyle: any = "Quad",
    easingDirection: any = "Out",
    repeatCount = 0,
    reverses = false,
    delayTime = 0
  ) {
    this.Time = time;
    this.EasingStyle = easingStyle;
    this.EasingDirection = easingDirection;
    this.RepeatCount = repeatCount;
    this.Reverses = reverses;
    this.DelayTime = delayTime;
  }

  public static new(
    time = 1,
    easingStyle: any = "Quad",
    easingDirection: any = "Out",
    repeatCount = 0,
    reverses = false,
    delayTime = 0
  ): TweenInfo {
    return new TweenInfo(time, easingStyle, easingDirection, repeatCount, reverses, delayTime);
  }
}

export class Rect {
  public readonly Min: Vector2;
  public readonly Max: Vector2;

  constructor(minXOrMin: number | Vector2 = 0, minYOrMax: number | Vector2 = 0, maxX = 0, maxY = 0) {
    if (minXOrMin instanceof Vector2 && minYOrMax instanceof Vector2) {
      this.Min = minXOrMin;
      this.Max = minYOrMax;
    } else {
      this.Min = new Vector2(minXOrMin as number, minYOrMax as number);
      this.Max = new Vector2(maxX, maxY);
    }
  }

  public static new(minX = 0, minY = 0, maxX = 0, maxY = 0): Rect {
    return new Rect(minX, minY, maxX, maxY);
  }

  public get Width(): number { return this.Max.X - this.Min.X; }
  public get Height(): number { return this.Max.Y - this.Min.Y; }
}

// Complete Roblox Enum Registry
export function createEnumItem(enumName: string, name: string, value: number) {
  return {
    Name: name,
    Value: value,
    EnumType: enumName,
    toString: () => `Enum.${enumName}.${name}`
  };
}

export function buildEnumDictionary() {
  const enumDefinitions: Record<string, string[]> = {
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

  const Enum: Record<string, any> = {};

  for (const [enumName, items] of Object.entries(enumDefinitions)) {
    const enumGroup: Record<string, any> = {
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
