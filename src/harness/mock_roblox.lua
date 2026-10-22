-- A strict mock of the Roblox client runtime for headless testing under Lua 5.3.
--
-- * Unknown classes, properties, events and enum items raise errors, like Roblox.
-- * Property writes are type-checked.
-- * A layout engine computes AbsolutePosition/AbsoluteSize, UIListLayout content
--   size, ScrollingFrame canvases and TextBounds (UIPadding, UIListLayout,
--   AutomaticSize, UIScale, UISizeConstraint, measured/wrapped text).
-- * TweenService implements easing, delay, repeat and reverse, Pause/Play.
-- * MOCK.Export() serializes the GUI for the PNG renderer.

MOCK = { now = 0, errors = {}, warnings = {}, deferred = {}, delayed = {}, waiting = {}, tweens = {}, frame = 0 }

local function record(kind, message)
    table.insert(MOCK.errors, kind .. ": " .. tostring(message))
end

-- Luau standard library additions --------------------------------------------
math.clamp = function(x, lo, hi)
    assert(type(x) == "number", "math.clamp: number expected, got " .. type(x))
    assert(lo <= hi, "math.clamp: max must be >= min")
    if x < lo then return lo elseif x > hi then return hi end
    return x
end
math.round = function(x) return math.floor(x + 0.5) end
math.sign = function(x) return x > 0 and 1 or (x < 0 and -1 or 0) end
math.atan2 = function(y, x) return math.atan(y, x) end
math.pow = function(a, b) return a ^ b end
table.find = function(t, value) for i, v in ipairs(t) do if v == value then return i end end return nil end
table.clear = function(t) for k in pairs(t) do t[k] = nil end end
table.clone = function(t) local c = {} for k, v in pairs(t) do c[k] = v end return c end
string.split = function(s, sep)
    local out = {}
    for part in string.gmatch(s, "([^" .. (sep or ",") .. "]+)") do table.insert(out, part) end
    return out
end
function warn(...)
    local parts = {}
    for i = 1, select("#", ...) do parts[i] = tostring(select(i, ...)) end
    table.insert(MOCK.warnings, table.concat(parts, " "))
end
os.clock = function() return MOCK.now end
tick = function() return MOCK.now end
time = function() return MOCK.now end
-- Luau generalized iteration (used by transpiled reference code).
function __iter(value, ...)
    if type(value) == "table" and not (getmetatable(value) and getmetatable(value).__call) then
        return next, value, nil
    end
    return value, ...
end

function typeof(value)
    local mt = getmetatable(value)
    if type(value) == "table" and mt and mt.__type then return mt.__type end
    return type(value)
end

local function datatype(name)
    local mt = { __type = name }
    mt.__index = mt
    return mt
end

-- UDim / UDim2 -----------------------------------------------------------------
local UDimMT = datatype("UDim")
UDim = {}
function UDim.new(s, o) return setmetatable({ Scale = s or 0, Offset = o or 0 }, UDimMT) end
UDimMT.__eq = function(a, b) return a.Scale == b.Scale and a.Offset == b.Offset end
UDimMT.__add = function(a, b) return UDim.new(a.Scale + b.Scale, a.Offset + b.Offset) end

local UDim2MT = datatype("UDim2")
UDim2 = {}
function UDim2.new(xs, xo, ys, yo)
    for _, v in ipairs({ xs or 0, xo or 0, ys or 0, yo or 0 }) do
        assert(type(v) == "number", "UDim2.new expects numbers")
    end
    local u = setmetatable({ X = UDim.new(xs, xo), Y = UDim.new(ys, yo) }, UDim2MT)
    rawset(u, "Width", u.X)
    rawset(u, "Height", u.Y)
    return u
end
function UDim2.fromOffset(x, y) return UDim2.new(0, x or 0, 0, y or 0) end
function UDim2.fromScale(x, y) return UDim2.new(x or 0, 0, y or 0, 0) end
UDim2MT.__eq = function(a, b) return a.X == b.X and a.Y == b.Y end
UDim2MT.__add = function(a, b) return UDim2.new(a.X.Scale + b.X.Scale, a.X.Offset + b.X.Offset, a.Y.Scale + b.Y.Scale, a.Y.Offset + b.Y.Offset) end
UDim2MT.__sub = function(a, b) return UDim2.new(a.X.Scale - b.X.Scale, a.X.Offset - b.X.Offset, a.Y.Scale - b.Y.Scale, a.Y.Offset - b.Y.Offset) end
UDim2MT.__tostring = function(u) return string.format("{%g, %g}, {%g, %g}", u.X.Scale, u.X.Offset, u.Y.Scale, u.Y.Offset) end

-- Vector2 / Vector3 ---------------------------------------------------------------
local Vector2MT = { __type = "Vector2" }
Vector2 = {}
function Vector2.new(x, y)
    assert(type(x or 0) == "number" and type(y or 0) == "number", "Vector2.new expects numbers")
    return setmetatable({ X = x or 0, Y = y or 0 }, Vector2MT)
end
Vector2MT.__index = function(v, key)
    if key == "Magnitude" then return math.sqrt(v.X * v.X + v.Y * v.Y) end
    if key == "Unit" then local m = math.sqrt(v.X * v.X + v.Y * v.Y) return Vector2.new(v.X / m, v.Y / m) end
    if key == "Lerp" then return function(a, b, t) return Vector2.new(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t) end end
    error(tostring(key) .. " is not a valid member of Vector2", 2)
end
Vector2MT.__add = function(a, b) return Vector2.new(a.X + b.X, a.Y + b.Y) end
Vector2MT.__sub = function(a, b) return Vector2.new(a.X - b.X, a.Y - b.Y) end
Vector2MT.__mul = function(a, b)
    if type(a) == "number" then return Vector2.new(a * b.X, a * b.Y) end
    if type(b) == "number" then return Vector2.new(a.X * b, a.Y * b) end
    return Vector2.new(a.X * b.X, a.Y * b.Y)
end
Vector2MT.__div = function(a, b)
    if type(b) == "number" then return Vector2.new(a.X / b, a.Y / b) end
    return Vector2.new(a.X / b.X, a.Y / b.Y)
end
Vector2MT.__unm = function(a) return Vector2.new(-a.X, -a.Y) end
Vector2MT.__eq = function(a, b) return a.X == b.X and a.Y == b.Y end
Vector2MT.__tostring = function(v) return v.X .. ", " .. v.Y end
Vector2.zero = Vector2.new(0, 0)
Vector2.one = Vector2.new(1, 1)

local Vector3MT = { __type = "Vector3" }
Vector3MT.__index = function(v, key)
    if key == "Magnitude" then return math.sqrt(v.X * v.X + v.Y * v.Y + v.Z * v.Z) end
    error(tostring(key) .. " is not a valid member of Vector3", 2)
end
Vector3MT.__add = function(a, b) return Vector3.new(a.X + b.X, a.Y + b.Y, a.Z + b.Z) end
Vector3MT.__sub = function(a, b) return Vector3.new(a.X - b.X, a.Y - b.Y, a.Z - b.Z) end
Vector3 = {}
function Vector3.new(x, y, z) return setmetatable({ X = x or 0, Y = y or 0, Z = z or 0 }, Vector3MT) end
Vector3.zero = Vector3.new(0, 0, 0)
CFrame = { new = function() return setmetatable({}, datatype("CFrame")) end }

-- Color3 ----------------------------------------------------------------------------
local Color3MT = { __type = "Color3" }
Color3 = {}
local function hexByte(n) return string.format("%02x", math.floor(math.clamp(n, 0, 1) * 255 + 0.5)) end
local Color3Methods = {
    Lerp = function(a, b, t)
        assert(typeof(b) == "Color3", "Color3:Lerp expects a Color3")
        return Color3.new(a.R + (b.R - a.R) * t, a.G + (b.G - a.G) * t, a.B + (b.B - a.B) * t)
    end,
    ToHex = function(c) return hexByte(c.R) .. hexByte(c.G) .. hexByte(c.B) end,
    ToHSV = function(c)
        local r, g, b = c.R, c.G, c.B
        local max, min = math.max(r, g, b), math.min(r, g, b)
        local h, s, v = 0, 0, max
        local d = max - min
        if max > 0 then s = d / max end
        if d > 0 then
            if max == r then h = (g - b) / d % 6
            elseif max == g then h = (b - r) / d + 2
            else h = (r - g) / d + 4 end
            h = h / 6
        end
        return h, s, v
    end,
}
Color3MT.__index = function(c, key)
    if Color3Methods[key] then return Color3Methods[key] end
    error(tostring(key) .. " is not a valid member of Color3", 2)
end
Color3MT.__eq = function(a, b) return math.abs(a.R - b.R) < 1e-6 and math.abs(a.G - b.G) < 1e-6 and math.abs(a.B - b.B) < 1e-6 end
Color3MT.__tostring = function(c) return string.format("%g, %g, %g", c.R, c.G, c.B) end
function Color3.new(r, g, b)
    for _, v in ipairs({ r or 0, g or 0, b or 0 }) do assert(type(v) == "number", "Color3.new expects numbers") end
    return setmetatable({ R = r or 0, G = g or 0, B = b or 0 }, Color3MT)
end
function Color3.fromRGB(r, g, b) return Color3.new((r or 0) / 255, (g or 0) / 255, (b or 0) / 255) end
function Color3.fromHSV(h, s, v)
    assert(type(h) == "number" and type(s) == "number" and type(v) == "number", "Color3.fromHSV expects numbers")
    local i = math.floor(h * 6)
    local f = h * 6 - i
    local p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    i = i % 6
    if i == 0 then return Color3.new(v, t, p) elseif i == 1 then return Color3.new(q, v, p)
    elseif i == 2 then return Color3.new(p, v, t) elseif i == 3 then return Color3.new(p, q, v)
    elseif i == 4 then return Color3.new(t, p, v) end
    return Color3.new(v, p, q)
end
function Color3.fromHex(hex)
    hex = string.gsub(hex, "#", "")
    assert(#hex == 6 and not string.find(hex, "[^%x]"), "Unable to convert characters to hex value")
    return Color3.fromRGB(tonumber(hex:sub(1, 2), 16), tonumber(hex:sub(3, 4), 16), tonumber(hex:sub(5, 6), 16))
end

-- Sequences ---------------------------------------------------------------------------
local CSKMT, CSMT, NSKMT, NSMT = datatype("ColorSequenceKeypoint"), datatype("ColorSequence"), datatype("NumberSequenceKeypoint"), datatype("NumberSequence")
ColorSequenceKeypoint = { new = function(t, c)
    assert(type(t) == "number" and typeof(c) == "Color3", "ColorSequenceKeypoint.new(number, Color3) expected")
    return setmetatable({ Time = t, Value = c }, CSKMT)
end }
NumberSequenceKeypoint = { new = function(t, v, e)
    assert(type(t) == "number" and type(v) == "number", "NumberSequenceKeypoint.new(number, number) expected")
    return setmetatable({ Time = t, Value = v, Envelope = e or 0 }, NSKMT)
end }
local function checkKeypoints(list, kind)
    assert(#list >= 2, kind .. " requires at least 2 keypoints")
    assert(list[1].Time == 0, kind .. " must start at time 0")
    assert(list[#list].Time == 1, kind .. " must end at time 1")
    for i = 2, #list do assert(list[i].Time >= list[i - 1].Time, kind .. " keypoints must be ordered") end
end
ColorSequence = { new = function(a, b)
    local list
    if typeof(a) == "Color3" then
        list = { ColorSequenceKeypoint.new(0, a), ColorSequenceKeypoint.new(1, b or a) }
    else
        assert(type(a) == "table", "ColorSequence.new: invalid arguments")
        list = a
        for _, k in ipairs(list) do assert(typeof(k) == "ColorSequenceKeypoint", "ColorSequence.new expects keypoints") end
    end
    checkKeypoints(list, "ColorSequence")
    return setmetatable({ Keypoints = list }, CSMT)
end }
NumberSequence = { new = function(a, b)
    local list
    if type(a) == "number" then
        list = { NumberSequenceKeypoint.new(0, a), NumberSequenceKeypoint.new(1, b or a) }
    else
        assert(type(a) == "table", "NumberSequence.new: invalid arguments")
        list = a
        for _, k in ipairs(list) do assert(typeof(k) == "NumberSequenceKeypoint", "NumberSequence.new expects keypoints") end
    end
    checkKeypoints(list, "NumberSequence")
    return setmetatable({ Keypoints = list }, NSMT)
end }

-- Enums -------------------------------------------------------------------------------
local ENUMS = {
    EasingStyle = { "Linear", "Sine", "Back", "Quad", "Quart", "Quint", "Bounce", "Elastic", "Exponential", "Circular", "Cubic" },
    EasingDirection = { "In", "Out", "InOut" },
    Font = { "Legacy", "Arial", "SourceSans", "Gotham", "GothamMedium", "GothamBold", "GothamBlack", "GothamSemibold", "Code", "RobotoMono", "BuilderSans", "BuilderSansMedium", "BuilderSansBold", "BuilderSansExtraBold", "Unknown" },
    FontWeight = { "Thin", "ExtraLight", "Light", "Regular", "Medium", "SemiBold", "Bold", "ExtraBold", "Heavy" },
    FontStyle = { "Normal", "Italic" },
    TextXAlignment = { "Left", "Center", "Right" },
    TextYAlignment = { "Top", "Center", "Bottom" },
    TextTruncate = { "None", "AtEnd", "SplitWord" },
    AutomaticSize = { "None", "X", "Y", "XY" },
    FillDirection = { "Horizontal", "Vertical" },
    HorizontalAlignment = { "Center", "Left", "Right" },
    VerticalAlignment = { "Center", "Top", "Bottom" },
    SortOrder = { "Name", "Custom", "LayoutOrder" },
    ScrollingDirection = { "X", "Y", "XY" },
    ScrollBarInset = { "None", "ScrollBar", "Always" },
    ApplyStrokeMode = { "Contextual", "Border" },
    ZIndexBehavior = { "Global", "Sibling" },
    ScaleType = { "Stretch", "Slice", "Tile", "Fit", "Crop" },
    UserInputType = { "MouseButton1", "MouseButton2", "MouseButton3", "MouseWheel", "MouseMovement", "Touch", "Keyboard", "Focus", "Accelerometer", "Gyro", "Gamepad1", "TextInput", "InputMethod", "None" },
    UserInputState = { "Begin", "Change", "End", "Cancel", "None" },
    PlaybackState = { "Begin", "Delayed", "Playing", "Paused", "Completed", "Cancelled" },
    UIFlexMode = { "None", "Grow", "Shrink", "Fill", "Custom" },
    HumanoidStateType = { "Jumping", "Running", "Freefall", "Dead" },
    KeyCode = { "Unknown", "Backspace", "Tab", "Return", "Escape", "Space", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
        "Up", "Down", "Left", "Right", "LeftShift", "RightShift", "LeftControl", "RightControl", "LeftAlt", "RightAlt", "LeftSuper", "RightSuper",
        "CapsLock", "Minus", "Equals", "LeftBracket", "RightBracket", "Semicolon", "Quote", "Comma", "Period", "Slash", "BackSlash", "Backquote",
        "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
        "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
        "KeypadZero", "KeypadOne", "KeypadTwo", "KeypadThree", "KeypadFour", "KeypadFive", "KeypadSix", "KeypadSeven", "KeypadEight", "KeypadNine" },
}
for c = string.byte("A"), string.byte("Z") do table.insert(ENUMS.KeyCode, string.char(c)) end

local EnumItemMT = { __type = "EnumItem" }
EnumItemMT.__index = function(item, key) error(tostring(key) .. " is not a valid member of EnumItem", 2) end
EnumItemMT.__tostring = function(item) return "Enum." .. tostring(item.EnumType) .. "." .. item.Name end
local EnumMT = { __type = "Enum" }
EnumMT.__index = function(enum, key) error(tostring(key) .. " is not a valid member of \"Enum." .. rawget(enum, "__name") .. "\"", 2) end
EnumMT.__tostring = function(enum) return rawget(enum, "__name") end
Enum = setmetatable({}, { __index = function(_, key) error(tostring(key) .. " is not a valid member of Enum", 2) end })
for name, items in pairs(ENUMS) do
    local enum = setmetatable({ __name = name }, EnumMT)
    for index, itemName in ipairs(items) do
        rawset(enum, itemName, setmetatable({ Name = itemName, Value = index - 1, EnumType = enum }, EnumItemMT))
    end
    rawset(Enum, name, enum)
end

local TweenInfoMT = datatype("TweenInfo")
TweenInfo = { new = function(time, style, direction, repeatCount, reverses, delayTime)
    assert(type(time or 1) == "number", "TweenInfo time must be a number")
    if style ~= nil then assert(typeof(style) == "EnumItem" and style.EnumType == Enum.EasingStyle, "TweenInfo: invalid EasingStyle") end
    if direction ~= nil then assert(typeof(direction) == "EnumItem" and direction.EnumType == Enum.EasingDirection, "TweenInfo: invalid EasingDirection") end
    return setmetatable({
        Time = time or 1, EasingStyle = style or Enum.EasingStyle.Quad, EasingDirection = direction or Enum.EasingDirection.Out,
        RepeatCount = repeatCount or 0, Reverses = reverses == true, DelayTime = delayTime or 0,
    }, TweenInfoMT)
end }

local FontMT = datatype("Font")
local LEGACY_WEIGHT = {
    Gotham = "Regular", GothamMedium = "Medium", GothamSemibold = "SemiBold", GothamBold = "Bold", GothamBlack = "Heavy",
    BuilderSans = "Regular", BuilderSansMedium = "Medium", BuilderSansBold = "Bold", BuilderSansExtraBold = "ExtraBold",
    Code = "Regular", RobotoMono = "Regular", SourceSans = "Regular", Arial = "Regular", Legacy = "Regular", Unknown = "Regular",
}
Font = {
    new = function(family, weight, style)
        assert(type(family) == "string", "Font.new expects a family string")
        if weight ~= nil then assert(typeof(weight) == "EnumItem" and weight.EnumType == Enum.FontWeight, "Font.new: invalid weight") end
        return setmetatable({ Family = family, Weight = weight or Enum.FontWeight.Regular, Style = style or Enum.FontStyle.Normal }, FontMT)
    end,
    fromEnum = function(item)
        assert(typeof(item) == "EnumItem" and item.EnumType == Enum.Font, "Font.fromEnum expects an Enum.Font")
        local family = string.gsub(item.Name, "Medium$", "")
        family = string.gsub(family, "Bold$", "")
        family = string.gsub(family, "ExtraBold$", "")
        family = string.gsub(family, "Semibold$", "")
        family = string.gsub(family, "Black$", "")
        return Font.new("rbxasset://fonts/families/" .. family .. ".json", Enum.FontWeight[LEGACY_WEIGHT[item.Name] or "Regular"])
    end,
}

-- Signals and scheduling --------------------------------------------------------------------
local function runThread(thread, ...)
    local ok, err = coroutine.resume(thread, ...)
    if not ok then
        record("ThreadError", debug.traceback(thread, tostring(err)))
    end
end

local function spawnFunction(fn, ...)
    local thread = coroutine.create(fn)
    runThread(thread, ...)
    return thread
end

local SignalMT = { __type = "RBXScriptSignal" }
SignalMT.__index = SignalMT
local ConnectionMT = { __type = "RBXScriptConnection" }
ConnectionMT.__index = ConnectionMT
function ConnectionMT:Disconnect()
    self.Connected = false
    local handlers = self.Handlers
    for i, h in ipairs(handlers) do if h.Connection == self then table.remove(handlers, i) break end end
end
function MOCK.Signal(name)
    return setmetatable({ Name = name, Handlers = {} }, SignalMT)
end
function SignalMT:Connect(fn)
    assert(type(fn) == "function", "Attempt to connect failed: Passed value is not a function")
    local connection = setmetatable({ Connected = true, Handlers = self.Handlers }, ConnectionMT)
    table.insert(self.Handlers, { Fn = fn, Connection = connection })
    return connection
end
function SignalMT:Once(fn)
    local connection
    connection = self:Connect(function(...) connection:Disconnect() fn(...) end)
    return connection
end
function SignalMT:Wait()
    local thread = coroutine.running()
    assert(coroutine.isyieldable(), "Signal:Wait() called outside a coroutine")
    local connection
    connection = self:Connect(function(...) connection:Disconnect() runThread(thread, ...) end)
    return coroutine.yield()
end
function SignalMT:Fire(...)
    local copy = {}
    for i, h in ipairs(self.Handlers) do copy[i] = h end
    for _, h in ipairs(copy) do
        if h.Connection.Connected then
            spawnFunction(h.Fn, ...)
        end
    end
end
function SignalMT:DisconnectAll()
    for _, h in ipairs(self.Handlers) do h.Connection.Connected = false end
    for i = #self.Handlers, 1, -1 do self.Handlers[i] = nil end
end

task = {}
function task.spawn(fn, ...)
    if type(fn) == "thread" then runThread(fn, ...) return fn end
    return spawnFunction(fn, ...)
end
function task.defer(fn, ...)
    table.insert(MOCK.deferred, { Fn = fn, Args = table.pack(...) })
end
function task.delay(time, fn, ...)
    table.insert(MOCK.delayed, { At = MOCK.now + (time or 0), Fn = fn, Args = table.pack(...) })
end
function task.wait(time)
    assert(coroutine.isyieldable(), "task.wait() called outside a coroutine (would yield the main thread)")
    local start = MOCK.now
    table.insert(MOCK.waiting, { At = MOCK.now + (time or 0), Thread = coroutine.running() })
    coroutine.yield()
    return MOCK.now - start
end
function task.cancel() end
wait = task.wait

-- Instances ---------------------------------------------------------------------------
local function enumType(name) return "Enum:" .. name end
local BASE = {
    Instance = { props = { Name = "string", Parent = "Instance?", Archivable = "boolean" },
        events = { "Changed", "ChildAdded", "ChildRemoved", "DescendantAdded", "DescendantRemoving", "Destroying", "AncestryChanged", "AttributeChanged" } },
    GuiBase2d = { inherits = "Instance", props = { AbsolutePosition = "ro", AbsoluteSize = "ro", AbsoluteRotation = "ro" } },
    GuiObject = { inherits = "GuiBase2d", props = {
        Active = "boolean", AnchorPoint = "Vector2", AutomaticSize = enumType("AutomaticSize"), BackgroundColor3 = "Color3",
        BackgroundTransparency = "number", BorderColor3 = "Color3", BorderSizePixel = "number", ClipsDescendants = "boolean",
        LayoutOrder = "number", Position = "UDim2", Rotation = "number", Selectable = "boolean", Size = "UDim2",
        Visible = "boolean", ZIndex = "number", Interactable = "boolean" },
        events = { "MouseEnter", "MouseLeave", "MouseMoved", "InputBegan", "InputChanged", "InputEnded", "SelectionGained", "SelectionLost" } },
    Frame = { inherits = "GuiObject", props = {} },
    CanvasGroup = { inherits = "GuiObject", props = { GroupColor3 = "Color3", GroupTransparency = "number" } },
    ScrollingFrame = { inherits = "GuiObject", props = {
        AutomaticCanvasSize = enumType("AutomaticSize"), CanvasPosition = "Vector2", CanvasSize = "UDim2",
        ScrollBarImageColor3 = "Color3", ScrollBarImageTransparency = "number", ScrollBarThickness = "number",
        ScrollingDirection = enumType("ScrollingDirection"), ScrollingEnabled = "boolean", VerticalScrollBarInset = enumType("ScrollBarInset"),
        ElasticBehavior = "any", AbsoluteCanvasSize = "ro", AbsoluteWindowSize = "ro" } },
    TextObject = { inherits = "GuiObject", props = {
        Font = enumType("Font"), FontFace = "Font", LineHeight = "number", RichText = "boolean", Text = "string",
        TextBounds = "ro", TextColor3 = "Color3", TextScaled = "boolean", TextSize = "number", TextStrokeColor3 = "Color3",
        TextStrokeTransparency = "number", TextTransparency = "number", TextTruncate = enumType("TextTruncate"),
        TextWrapped = "boolean", TextXAlignment = enumType("TextXAlignment"), TextYAlignment = enumType("TextYAlignment"),
        ContentText = "ro", MaxVisibleGraphemes = "number" } },
    TextLabel = { inherits = "TextObject", props = {} },
    TextButton = { inherits = "TextObject", props = { AutoButtonColor = "boolean", Modal = "boolean", Selected = "boolean" },
        events = { "Activated", "MouseButton1Click", "MouseButton1Down", "MouseButton1Up", "MouseButton2Click" } },
    TextBox = { inherits = "TextObject", props = { ClearTextOnFocus = "boolean", MultiLine = "boolean", PlaceholderColor3 = "Color3",
        PlaceholderText = "string", TextEditable = "boolean", CursorPosition = "number", SelectionStart = "number", ShowNativeInput = "boolean" },
        events = { "Focused", "FocusLost" } },
    ImageObject = { inherits = "GuiObject", props = { Image = "string", ImageColor3 = "Color3", ImageTransparency = "number",
        ScaleType = enumType("ScaleType") } },
    ImageLabel = { inherits = "ImageObject", props = {} },
    ImageButton = { inherits = "ImageObject", props = { AutoButtonColor = "boolean" },
        events = { "Activated", "MouseButton1Click", "MouseButton1Down", "MouseButton1Up" } },
    ScreenGui = { inherits = "Instance", props = { DisplayOrder = "number", Enabled = "boolean", IgnoreGuiInset = "boolean",
        ResetOnSpawn = "boolean", ZIndexBehavior = enumType("ZIndexBehavior"), AbsoluteSize = "ro", AbsolutePosition = "ro" } },
    UICorner = { inherits = "Instance", props = { CornerRadius = "UDim" } },
    UIStroke = { inherits = "Instance", props = { ApplyStrokeMode = enumType("ApplyStrokeMode"), Color = "Color3", Thickness = "number",
        Transparency = "number", Enabled = "boolean" } },
    UIGradient = { inherits = "Instance", props = { Color = "ColorSequence", Offset = "Vector2", Rotation = "number",
        Transparency = "NumberSequence", Enabled = "boolean" } },
    UIPadding = { inherits = "Instance", props = { PaddingTop = "UDim", PaddingBottom = "UDim", PaddingLeft = "UDim", PaddingRight = "UDim" } },
    UIListLayout = { inherits = "Instance", props = { FillDirection = enumType("FillDirection"), HorizontalAlignment = enumType("HorizontalAlignment"),
        VerticalAlignment = enumType("VerticalAlignment"), Padding = "UDim", SortOrder = enumType("SortOrder"), Wraps = "boolean", AbsoluteContentSize = "ro" } },
    UIScale = { inherits = "Instance", props = { Scale = "number" } },
    UISizeConstraint = { inherits = "Instance", props = { MinSize = "Vector2", MaxSize = "Vector2" } },
    UITextSizeConstraint = { inherits = "Instance", props = { MinTextSize = "number", MaxTextSize = "number" } },
    UIFlexItem = { inherits = "Instance", props = { FlexMode = enumType("UIFlexMode"), GrowRatio = "number", ShrinkRatio = "number" } },
    BlurEffect = { inherits = "Instance", props = { Size = "number", Enabled = "boolean" } },
    NumberValue = { inherits = "Instance", props = { Value = "number" } },
    Folder = { inherits = "Instance", props = {} },
    Lighting = { inherits = "Instance", props = { ClockTime = "number", Brightness = "number" }, service = true },
    CoreGui = { inherits = "Instance", props = {}, service = true },
    PlayerGui = { inherits = "Instance", props = {}, service = true },
}

local chainCache = {}
local function classChain(className)
    local chain = chainCache[className]
    if chain then return chain end
    chain = {}
    local current = className
    while current do
        table.insert(chain, current)
        current = BASE[current].inherits
    end
    chainCache[className] = chain
    return chain
end

local propTypeCache = {}
local function propType(className, prop)
    local cache = propTypeCache[className]
    if not cache then cache = {} propTypeCache[className] = cache end
    local t = cache[prop]
    if t == nil then
        t = false
        for _, name in ipairs(classChain(className)) do
            local found = BASE[name].props[prop]
            if found then t = found break end
        end
        cache[prop] = t
    end
    return t or nil
end

local function hasEvent(className, event)
    for _, name in ipairs(classChain(className)) do
        for _, e in ipairs(BASE[name].events or {}) do if e == event then return true end end
    end
    return false
end

local DEFAULTS = {
    string = "", number = 0, boolean = false, Vector2 = Vector2.new(0, 0), UDim2 = UDim2.new(0, 0, 0, 0),
    UDim = UDim.new(0, 0), Color3 = Color3.new(1, 1, 1),
}

local INSTANCE = {}
local InstanceMT = { __type = "Instance" }
local GUI_CLASSES = { Frame = true, CanvasGroup = true, ScrollingFrame = true, TextLabel = true, TextButton = true, TextBox = true, ImageLabel = true, ImageButton = true }
local TEXT_CLASSES = { TextLabel = true, TextButton = true, TextBox = true }

local isACache = {}
local function isA(object, class)
    local key = object.__class .. ":" .. class
    local cached = isACache[key]
    if cached ~= nil then return cached end
    local result = false
    for _, name in ipairs(classChain(object.__class)) do
        if name == class then result = true break end
    end
    if class == "GuiButton" then result = object.__class == "TextButton" or object.__class == "ImageButton" end
    if class == "LayerCollector" then result = object.__class == "ScreenGui" end
    isACache[key] = result
    return result
end

local function propertySignal(object, prop)
    object.__propSignals[prop] = object.__propSignals[prop] or MOCK.Signal(prop)
    return object.__propSignals[prop]
end

local function valuesEqual(a, b)
    if typeof(a) ~= typeof(b) then return false end
    return a == b
end

local function checkType(className, prop, expected, value)
    if expected == "ro" then error(prop .. " is read-only on " .. className, 4) end
    if expected == "any" then return end
    if expected == "Instance?" then
        if value ~= nil and typeof(value) ~= "Instance" then error("Parent must be an Instance", 4) end
        return
    end
    local actual = typeof(value)
    if string.sub(expected, 1, 5) == "Enum:" then
        local enumName = string.sub(expected, 6)
        if actual ~= "EnumItem" or tostring(value.EnumType) ~= enumName then
            error(string.format("Unable to assign property %s. EnumItem of type %s expected, got %s", prop, enumName, actual == "EnumItem" and tostring(value) or actual), 4)
        end
        return
    end
    if actual ~= expected then
        error(string.format("Unable to assign property %s on %s. %s expected, got %s", prop, className, expected, actual), 4)
    end
end

-- Layout engine -----------------------------------------------------------------------
local Layout = { dirty = true, runs = 0 }
MOCK.Layout = Layout
local absRects, memo, listContent, scrollInfo, rootOffset = {}, {}, {}, {}, {}
local LINE_HEIGHT = 1.0
local measureCache = {}

local function measureText(text, size, weight, mono, maxWidth)
    local key = text .. "\1" .. size .. "\1" .. weight .. (mono and "m" or "s") .. "\1" .. (maxWidth or -1)
    local hit = measureCache[key]
    if hit then return hit[1], hit[2] end
    local w, h
    if __measure then
        w, h = __measure(text, size, weight, mono and 1 or 0, maxWidth or -1)
    else
        local lines = 1
        for _ in string.gmatch(text, "\n") do lines = lines + 1 end
        w = math.min(#text * size * 0.5, maxWidth or math.huge)
        h = lines * size * LINE_HEIGHT
    end
    measureCache[key] = { w, h }
    return w, h
end

local function fontOf(props)
    local face = props.FontFace
    if face then
        local family = face.Family or ""
        return face.Weight and face.Weight.Name or "Regular", (string.find(family, "Mono") or string.find(family, "Code")) ~= nil
    end
    local f = props.Font
    local name = f and f.Name or "Legacy"
    return LEGACY_WEIGHT[name] or "Regular", name == "Code" or name == "RobotoMono"
end

local function plainText(text)
    text = string.gsub(text, "<[^>]->", "")
    text = string.gsub(text, "&lt;", "<")
    text = string.gsub(text, "&gt;", ">")
    text = string.gsub(text, "&quot;", "\"")
    text = string.gsub(text, "&apos;", "'")
    text = string.gsub(text, "&amp;", "&")
    return text
end

local function shownText(props, class)
    local text = props.Text or ""
    if text == "" and class == "TextBox" then text = props.PlaceholderText or "" end
    if props.RichText then text = plainText(text) end
    return text
end

local function textBounds(object, maxWidth)
    local props = object.__props
    local text = shownText(props, object.__class)
    if text == "" then return 0, 0 end
    local weight, mono = fontOf(props)
    return measureText(text, props.TextSize or 14, weight, mono, props.TextWrapped and maxWidth or nil)
end

local function child(object, class)
    for _, c in ipairs(object.__children) do
        if c.__class == class then return c end
    end
    return nil
end

local function scaleOf(object)
    local s = child(object, "UIScale")
    return s and (s.__props.Scale or 1) or 1
end

local function paddingOf(object, w, h)
    local p = child(object, "UIPadding")
    if not p then return 0, 0, 0, 0 end
    local pp = p.__props
    local function u(v, ref) return v and (v.Scale * ref + v.Offset) or 0 end
    return u(pp.PaddingLeft, w), u(pp.PaddingRight, w), u(pp.PaddingTop, h), u(pp.PaddingBottom, h)
end

local function autoAxes(props)
    local a = props.AutomaticSize
    local name = a and a.Name or "None"
    return name == "X" or name == "XY", name == "Y" or name == "XY"
end

local function ordered(object)
    local items = {}
    for i, c in ipairs(object.__children) do
        if GUI_CLASSES[c.__class] then
            items[#items + 1] = { c, c.__props.LayoutOrder or 0, i }
        end
    end
    table.sort(items, function(a, b)
        if a[2] ~= b[2] then return a[2] < b[2] end
        return a[3] < b[3]
    end)
    return items
end

local measure

local function childrenExtent(object, cw, ch)
    local list = child(object, "UIListLayout")
    if list then
        local lp = list.__props
        local vertical = not (lp.FillDirection and lp.FillDirection.Name == "Horizontal")
        local gapU = lp.Padding
        local gap = gapU and (gapU.Scale * (vertical and ch or cw) + gapU.Offset) or 0
        local total, cross, count = 0, 0, 0
        for _, item in ipairs(ordered(object)) do
            local c = item[1]
            if c.__props.Visible ~= false then
                local w, h = measure(c, cw, ch)
                local s = scaleOf(c)
                w, h = w * s, h * s
                count = count + 1
                if vertical then
                    total = total + h
                    cross = math.max(cross, w)
                else
                    total = total + w
                    cross = math.max(cross, h)
                end
            end
        end
        if count > 1 then total = total + gap * (count - 1) end
        if vertical then return cross, total end
        return total, cross
    end
    local ew, eh = 0, 0
    for _, c in ipairs(object.__children) do
        if GUI_CLASSES[c.__class] and c.__props.Visible ~= false then
            local cp = c.__props
            local w, h = measure(c, cw, ch)
            local s = scaleOf(c)
            w, h = w * s, h * s
            local pos = cp.Position or DEFAULTS.UDim2
            local ap = cp.AnchorPoint or DEFAULTS.Vector2
            local x = pos.X.Scale * cw + pos.X.Offset - ap.X * w
            local y = pos.Y.Scale * ch + pos.Y.Offset - ap.Y * h
            ew = math.max(ew, x + w)
            eh = math.max(eh, y + h)
        end
    end
    return ew, eh
end

function measure(object, pw, ph)
    local props = object.__props
    local size = props.Size or DEFAULTS.UDim2
    -- The parent size only matters through scale components, so normalize
    -- the memo key; otherwise nested auto-sized frames re-measure exponentially.
    local kw = size.X.Scale ~= 0 and pw or -1
    local kh = size.Y.Scale ~= 0 and ph or -1
    local cached = memo[object]
    if cached and cached[1] == kw and cached[2] == kh then return cached[3], cached[4] end
    local w = size.X.Scale * pw + size.X.Offset
    local h = size.Y.Scale * ph + size.Y.Offset
    local ax, ay = autoAxes(props)
    if ax or ay then
        local pl, pr, pt, pb = paddingOf(object, w, h)
        local cw, ch = math.max(0, w - pl - pr), math.max(0, h - pt - pb)
        local contentW, contentH = 0, 0
        if TEXT_CLASSES[object.__class] then
            contentW, contentH = textBounds(object, (not ax) and cw or nil)
        end
        local ew, eh = childrenExtent(object, cw, ch)
        contentW, contentH = math.max(contentW, ew), math.max(contentH, eh)
        if ax then w = math.max(w, contentW + pl + pr) end
        if ay then h = math.max(h, contentH + pt + pb) end
    end
    local constraint = child(object, "UISizeConstraint")
    if constraint then
        local cp = constraint.__props
        local minS, maxS = cp.MinSize or Vector2.new(0, 0), cp.MaxSize or Vector2.new(math.huge, math.huge)
        w = math.clamp(w, minS.X, math.max(minS.X, maxS.X))
        h = math.clamp(h, minS.Y, math.max(minS.Y, maxS.Y))
    end
    memo[object] = { kw, kh, w, h }
    return w, h
end

local arrange

local function arrangeChildren(object, x, y, w, h, k)
    local props = object.__props
    local lw, lh = w / k, h / k
    local pl, pr, pt, pb = paddingOf(object, lw, lh)
    local cx, cy = x + pl * k, y + pt * k
    local cw, ch = math.max(0, lw - pl - pr), math.max(0, lh - pt - pb)
    if object.__class == "ScrollingFrame" then
        local cs = props.CanvasSize or DEFAULTS.UDim2
        local canvasW = math.max(cs.X.Scale * lw + cs.X.Offset, lw)
        local canvasH = math.max(cs.Y.Scale * lh + cs.Y.Offset, lh)
        local auto = props.AutomaticCanvasSize
        local an = auto and auto.Name or "None"
        if an ~= "None" then
            local ew, eh = childrenExtent(object, canvasW - pl - pr, canvasH - pt - pb)
            if an == "Y" or an == "XY" then canvasH = math.max(canvasH, eh + pt + pb) end
            if an == "X" or an == "XY" then canvasW = math.max(canvasW, ew + pl + pr) end
        end
        local pos = props.CanvasPosition or DEFAULTS.Vector2
        local px = math.clamp(pos.X, 0, math.max(0, canvasW - lw))
        local py = math.clamp(pos.Y, 0, math.max(0, canvasH - lh))
        if px ~= pos.X or py ~= pos.Y then props.CanvasPosition = Vector2.new(px, py) end
        scrollInfo[object] = { canvasW, canvasH, lw, lh, px, py }
        cx, cy = x + (pl - px) * k, y + (pt - py) * k
        cw, ch = math.max(0, canvasW - pl - pr), math.max(0, canvasH - pt - pb)
    end
    local list = child(object, "UIListLayout")
    if list then
        local lp = list.__props
        local vertical = not (lp.FillDirection and lp.FillDirection.Name == "Horizontal")
        local gapU = lp.Padding
        local gap = gapU and (gapU.Scale * (vertical and ch or cw) + gapU.Offset) or 0
        local ha = lp.HorizontalAlignment and lp.HorizontalAlignment.Name or "Left"
        local va = lp.VerticalAlignment and lp.VerticalAlignment.Name or "Top"
        local items = ordered(object)
        local sizes, total, cross, count = {}, 0, 0, 0
        for _, item in ipairs(items) do
            local c = item[1]
            local cwid, chei = measure(c, cw, ch)
            local s = scaleOf(c)
            sizes[c] = { cwid * s, chei * s, s }
            if c.__props.Visible ~= false then
                count = count + 1
                if vertical then
                    total = total + chei * s
                    cross = math.max(cross, cwid * s)
                else
                    total = total + cwid * s
                    cross = math.max(cross, chei * s)
                end
            end
        end
        if count > 1 then total = total + gap * (count - 1) end
        listContent[list] = vertical and { cross * k, total * k } or { total * k, cross * k }
        local cursor
        if vertical then
            cursor = (va == "Center") and (ch - total) / 2 or ((va == "Bottom") and (ch - total) or 0)
        else
            cursor = (ha == "Center") and (cw - total) / 2 or ((ha == "Right") and (cw - total) or 0)
        end
        for _, item in ipairs(items) do
            local c = item[1]
            local sz = sizes[c]
            local lx, ly
            if vertical then
                lx = (ha == "Center") and (cw - sz[1]) / 2 or ((ha == "Right") and (cw - sz[1]) or 0)
                ly = cursor
            else
                lx = cursor
                ly = (va == "Center") and (ch - sz[2]) / 2 or ((va == "Bottom") and (ch - sz[2]) or 0)
            end
            if c.__props.Visible ~= false then
                cursor = cursor + (vertical and sz[2] or sz[1]) + gap
            end
            arrange(c, cx + lx * k, cy + ly * k, sz[1] * k, sz[2] * k, k * sz[3])
        end
        return
    end
    for _, c in ipairs(object.__children) do
        if GUI_CLASSES[c.__class] then
            local cp = c.__props
            local wv, hv = measure(c, cw, ch)
            local s = scaleOf(c)
            local pos = cp.Position or DEFAULTS.UDim2
            local ap = cp.AnchorPoint or DEFAULTS.Vector2
            local lx = pos.X.Scale * cw + pos.X.Offset
            local ly = pos.Y.Scale * ch + pos.Y.Offset
            local W, H = wv * s, hv * s
            arrange(c, cx + (lx - ap.X * W) * k, cy + (ly - ap.Y * H) * k, W * k, H * k, k * s)
        end
    end
end

function arrange(object, x, y, w, h, k)
    absRects[object] = { x, y, w, h, k }
    arrangeChildren(object, x, y, w, h, k)
end

local screenRoots = {}
function Layout.Run()
    absRects, memo, listContent, scrollInfo = {}, {}, {}, {}
    local viewport = workspace.CurrentCamera.ViewportSize
    screenRoots = {}
    for _, container in ipairs({ MOCK.HUI, MOCK.CoreGui, MOCK.PlayerGui }) do
        for _, gui in ipairs(container.__children) do
            if gui.__class == "ScreenGui" and gui.__props.Enabled ~= false then
                local inset = gui.__props.IgnoreGuiInset and 0 or 36
                rootOffset[gui] = inset
                local W, H = viewport.X, viewport.Y - inset
                absRects[gui] = { 0, 0, W, H, 1 }
                arrangeChildren(gui, 0, 0, W, H, 1)
                table.insert(screenRoots, gui)
            end
        end
    end
    Layout.dirty = false
    Layout.runs = Layout.runs + 1
end

local function ensureLayout()
    if Layout.dirty then Layout.Run() end
end

local function absoluteRead(object, key)
    ensureLayout()
    local r = absRects[object]
    if key == "AbsolutePosition" then return r and Vector2.new(r[1], r[2]) or Vector2.new(0, 0) end
    if key == "AbsoluteSize" then return r and Vector2.new(r[3], r[4]) or Vector2.new(0, 0) end
    if key == "AbsoluteRotation" then return 0 end
    if key == "AbsoluteContentSize" then
        local c = listContent[object]
        return c and Vector2.new(c[1], c[2]) or Vector2.new(0, 0)
    end
    if key == "AbsoluteCanvasSize" or key == "AbsoluteWindowSize" then
        local s = scrollInfo[object]
        local k = r and r[5] or 1
        if not s then return Vector2.new(0, 0) end
        if key == "AbsoluteCanvasSize" then return Vector2.new(s[1] * k, s[2] * k) end
        return Vector2.new(s[3] * k, s[4] * k)
    end
    if key == "TextBounds" then
        if not r then return Vector2.new(0, 0) end
        local k = r[5]
        local lw = r[3] / k
        local pl, pr = paddingOf(object, lw, r[4] / k)
        local tw, th = textBounds(object, lw - pl - pr)
        return Vector2.new(tw * k, th * k)
    end
    return nil
end

local ABSOLUTE = { AbsolutePosition = true, AbsoluteSize = true, AbsoluteRotation = true, AbsoluteContentSize = true,
    AbsoluteCanvasSize = true, AbsoluteWindowSize = true, TextBounds = true }
local absWatch = setmetatable({}, { __mode = "k" })

-- Instance core -------------------------------------------------------------------------
local function setParent(object, parent)
    local old = object.__props.Parent
    if old == parent then return end
    if parent then
        local p = parent
        while p do
            if p == object then error("Attempt to set parent of " .. object.__props.Name .. " to a descendant", 3) end
            p = p.__props.Parent
        end
    end
    if rawget(object, "__destroyed") then error("The Parent property of " .. object.__props.Name .. " is locked", 3) end
    if old then
        for i, c in ipairs(old.__children) do if c == object then table.remove(old.__children, i) break end end
    end
    object.__props.Parent = parent
    Layout.dirty = true
    if parent then
        table.insert(parent.__children, object)
        if parent.__events.ChildAdded then parent.__events.ChildAdded:Fire(object) end
        local ancestor = parent
        while ancestor do
            if ancestor.__events.DescendantAdded then ancestor.__events.DescendantAdded:Fire(object) end
            ancestor = ancestor.__props.Parent
        end
    end
    if object.__propSignals.Parent then object.__propSignals.Parent:Fire() end
    if object.__events.AncestryChanged then object.__events.AncestryChanged:Fire(object, parent) end
end

function INSTANCE.GetChildren(self) local c = {} for i, v in ipairs(self.__children) do c[i] = v end return c end
function INSTANCE.GetDescendants(self)
    local out = {}
    local function walk(o) for _, c in ipairs(o.__children) do out[#out + 1] = c walk(c) end end
    walk(self)
    return out
end
function INSTANCE.FindFirstChild(self, name, recursive)
    for _, c in ipairs(self.__children) do if c.__props.Name == name then return c end end
    if recursive then for _, c in ipairs(self.__children) do local f = INSTANCE.FindFirstChild(c, name, true) if f then return f end end end
    return nil
end
function INSTANCE.FindFirstChildOfClass(self, class) for _, c in ipairs(self.__children) do if c.__class == class then return c end end return nil end
function INSTANCE.FindFirstChildWhichIsA(self, class) for _, c in ipairs(self.__children) do if isA(c, class) then return c end end return nil end
function INSTANCE.FindFirstAncestor(self, name) local p = self.__props.Parent while p do if p.__props.Name == name then return p end p = p.__props.Parent end return nil end
function INSTANCE.FindFirstAncestorOfClass(self, class) local p = self.__props.Parent while p do if p.__class == class then return p end p = p.__props.Parent end return nil end
function INSTANCE.FindFirstAncestorWhichIsA(self, class) local p = self.__props.Parent while p do if isA(p, class) then return p end p = p.__props.Parent end return nil end
function INSTANCE.WaitForChild(self, name) return INSTANCE.FindFirstChild(self, name) or error("WaitForChild would yield forever: " .. name) end
function INSTANCE.IsA(self, class) return isA(self, class) end
function INSTANCE.IsDescendantOf(self, other) local p = self.__props.Parent while p do if p == other then return true end p = p.__props.Parent end return false end
function INSTANCE.IsAncestorOf(self, other) return INSTANCE.IsDescendantOf(other, self) end
function INSTANCE.GetPropertyChangedSignal(self, prop)
    if not propType(self.__class, prop) then error(prop .. " is not a valid property name.", 2) end
    if ABSOLUTE[prop] then
        absWatch[self] = absWatch[self] or {}
        absWatch[self][prop] = absWatch[self][prop] or false
    end
    return propertySignal(self, prop)
end
function INSTANCE.GetAttribute(self, name) return self.__attributes[name] end
function INSTANCE.SetAttribute(self, name, value) self.__attributes[name] = value end
function INSTANCE.GetFullName(self) local parts = {} local p = self while p do table.insert(parts, 1, p.__props.Name) p = p.__props.Parent end return table.concat(parts, ".") end
function INSTANCE.ClearAllChildren(self) for _, c in ipairs(INSTANCE.GetChildren(self)) do c:Destroy() end end
function INSTANCE.Destroy(self)
    if rawget(self, "__destroyed") then return end
    if MOCK.focused == self then MOCK.focused = nil end
    if self.__events.Destroying then self.__events.Destroying:Fire() end
    for _, c in ipairs(INSTANCE.GetChildren(self)) do INSTANCE.Destroy(c) end
    if self.__props.Parent then setParent(self, nil) end
    rawset(self, "__destroyed", true)
    for _, signal in pairs(self.__events) do signal:DisconnectAll() end
    for _, signal in pairs(self.__propSignals) do signal:DisconnectAll() end
    MOCK.destroyedCount = (MOCK.destroyedCount or 0) + 1
end
function INSTANCE.CaptureFocus(self)
    if self.__class ~= "TextBox" then error("CaptureFocus is not a valid member of " .. self.__class, 2) end
    if MOCK.focused and MOCK.focused ~= self then MOCK.focused:ReleaseFocus(false) end
    MOCK.focused = self
    self.__events.Focused = self.__events.Focused or MOCK.Signal("Focused")
    self.__events.Focused:Fire()
end
function INSTANCE.ReleaseFocus(self, enter)
    if MOCK.focused == self then
        MOCK.focused = nil
        self.__events.FocusLost = self.__events.FocusLost or MOCK.Signal("FocusLost")
        self.__events.FocusLost:Fire(enter == true)
    end
end
function INSTANCE.IsFocused(self) return MOCK.focused == self end

InstanceMT.__index = function(object, key)
    local props = rawget(object, "__props")
    local class = rawget(object, "__class")
    local t = propType(class, key)
    if t then
        if ABSOLUTE[key] then return absoluteRead(object, key) end
        if key == "ContentText" then return plainText(props.Text or "") end
        local value = props[key]
        if value == nil then
            if key == "Name" then return class end
            if string.sub(t, 1, 5) == "Enum:" then return nil end
            return DEFAULTS[t]
        end
        return value
    end
    if key == "ClassName" then return class end
    if INSTANCE[key] then return INSTANCE[key] end
    if hasEvent(class, key) then
        local events = rawget(object, "__events")
        events[key] = events[key] or MOCK.Signal(key)
        return events[key]
    end
    local c = INSTANCE.FindFirstChild(object, key)
    if c then return c end
    error(tostring(key) .. " is not a valid member of " .. class .. " \"" .. tostring(props.Name or class) .. "\"", 2)
end

local LAYOUT_PROPS = {
    Size = true, Position = true, AnchorPoint = true, Visible = true,
    AutomaticSize = true, AutomaticCanvasSize = true, CanvasSize = true, CanvasPosition = true,
    Text = true, TextSize = true, FontFace = true, Font = true, TextWrapped = true, RichText = true, PlaceholderText = true,
    PaddingLeft = true, PaddingRight = true, PaddingTop = true, PaddingBottom = true,
    FillDirection = true, HorizontalAlignment = true, VerticalAlignment = true, SortOrder = true, Padding = true, LayoutOrder = true,
    Scale = true, MinSize = true, MaxSize = true,
}

InstanceMT.__newindex = function(object, key, value)
    local class = rawget(object, "__class")
    local t = propType(class, key)
    if not t then error(tostring(key) .. " is not a valid member of " .. class, 2) end
    checkType(class, key, t, value)
    if key == "Parent" then setParent(object, value) return end
    if key == "Text" or key == "Name" or key == "PlaceholderText" or key == "Image" then value = tostring(value) end
    local props = rawget(object, "__props")
    local old = props[key]
    if old ~= nil and valuesEqual(old, value) then return end
    props[key] = value
    if LAYOUT_PROPS[key] then Layout.dirty = true end
    if key == "FontFace" then props.Font = Enum.Font.Unknown end
    local signals = rawget(object, "__propSignals")
    if signals[key] then signals[key]:Fire() end
    local events = rawget(object, "__events")
    if events.Changed then
        if class == "NumberValue" then events.Changed:Fire(value) else events.Changed:Fire(key) end
    end
end
InstanceMT.__tostring = function(object) return rawget(object, "__props").Name or rawget(object, "__class") end

MOCK.instanceCount = 0
function MOCK.NewInstance(className, name)
    if not BASE[className] or className == "GuiObject" or className == "GuiBase2d" or className == "TextObject" or className == "ImageObject" then
        error("Unable to create an Instance of type \"" .. tostring(className) .. "\"", 3)
    end
    MOCK.instanceCount = MOCK.instanceCount + 1
    local object = setmetatable({ __class = className, __props = { Name = name or className }, __children = {}, __events = {},
        __propSignals = {}, __attributes = {} }, InstanceMT)
    if GUI_CLASSES[className] then
        object.__props.Visible = true
        object.__props.BackgroundTransparency = 0
        object.__props.BackgroundColor3 = Color3.fromRGB(163, 162, 165)
        object.__props.ZIndex = 1
        object.__props.Size = UDim2.new(0, 100, 0, 100)
        object.__props.BorderSizePixel = 1
    end
    if className == "UIScale" then object.__props.Scale = 1 end
    if className == "UIStroke" then object.__props.Thickness = 1 object.__props.Color = Color3.new(0, 0, 0) end
    if className == "ScrollingFrame" then object.__props.ScrollBarThickness = 12 object.__props.ScrollingEnabled = true end
    if TEXT_CLASSES[className] then
        object.__props.TextSize = 14
        object.__props.Font = Enum.Font.Legacy
        object.__props.TextColor3 = Color3.new(0, 0, 0)
        object.__props.Text = className == "TextBox" and "" or className
    end
    if className == "ScreenGui" then object.__props.ZIndexBehavior = Enum.ZIndexBehavior.Sibling object.__props.Enabled = true end
    return object
end
Instance = { new = function(className, parent)
    local object = MOCK.NewInstance(className)
    if parent then object.Parent = parent end
    return object
end }

-- Tweening (with easing) ----------------------------------------------------------------
local TWEENABLE = { number = true, UDim2 = true, UDim = true, Vector2 = true, Color3 = true }
local function lerp(a, b, t)
    local kind = typeof(a)
    if kind == "number" then return a + (b - a) * t end
    if kind == "UDim2" then return UDim2.new(lerp(a.X.Scale, b.X.Scale, t), lerp(a.X.Offset, b.X.Offset, t), lerp(a.Y.Scale, b.Y.Scale, t), lerp(a.Y.Offset, b.Y.Offset, t)) end
    if kind == "UDim" then return UDim.new(lerp(a.Scale, b.Scale, t), lerp(a.Offset, b.Offset, t)) end
    if kind == "Vector2" then return Vector2.new(lerp(a.X, b.X, t), lerp(a.Y, b.Y, t)) end
    if kind == "Color3" then return Color3.new(lerp(a.R, b.R, t), lerp(a.G, b.G, t), lerp(a.B, b.B, t)) end
    return t >= 1 and b or a
end

local EASE_IN = {
    Linear = function(t) return t end,
    Sine = function(t) return 1 - math.cos(t * math.pi / 2) end,
    Quad = function(t) return t * t end,
    Cubic = function(t) return t * t * t end,
    Quart = function(t) return t ^ 4 end,
    Quint = function(t) return t ^ 5 end,
    Exponential = function(t) return t == 0 and 0 or 2 ^ (10 * t - 10) end,
    Circular = function(t) return 1 - math.sqrt(1 - t * t) end,
    Back = function(t) local s = 1.70158 return t * t * ((s + 1) * t - s) end,
    Elastic = function(t) if t == 0 or t == 1 then return t end return -(2 ^ (10 * t - 10)) * math.sin((t * 10 - 10.75) * (2 * math.pi) / 3) end,
    Bounce = function(t)
        local function out(x)
            if x < 1 / 2.75 then return 7.5625 * x * x
            elseif x < 2 / 2.75 then x = x - 1.5 / 2.75 return 7.5625 * x * x + 0.75
            elseif x < 2.5 / 2.75 then x = x - 2.25 / 2.75 return 7.5625 * x * x + 0.9375 end
            x = x - 2.625 / 2.75 return 7.5625 * x * x + 0.984375
        end
        return 1 - out(1 - t)
    end,
}
local function ease(style, direction, t)
    local f = EASE_IN[style.Name] or EASE_IN.Quad
    local d = direction.Name
    if d == "In" then return f(t) end
    if d == "Out" then return 1 - f(1 - t) end
    if t < 0.5 then return f(t * 2) / 2 end
    return 1 - f((1 - t) * 2) / 2
end

local TweenMT = { __type = "Instance" }
TweenMT.__index = TweenMT
function TweenMT:Play()
    if self.PlaybackState == Enum.PlaybackState.Paused and self.From then
        self.Start = MOCK.now - (self.PausedElapsed or 0)
    else
        self.Start = MOCK.now
        self.From = nil
    end
    self.PlaybackState = Enum.PlaybackState.Playing
    -- A newer tween of the same property takes over (Roblox cancels the older one's control).
    for other in pairs(MOCK.tweens) do
        if other.Instance == self.Instance and other ~= self then
            for prop in pairs(self.Goals) do other.Goals[prop] = nil end
        end
    end
    MOCK.tweens[self] = true
end
function TweenMT:Cancel()
    if MOCK.tweens[self] or self.PlaybackState == Enum.PlaybackState.Paused then
        MOCK.tweens[self] = nil
        self.PlaybackState = Enum.PlaybackState.Cancelled
        self.Completed:Fire(Enum.PlaybackState.Cancelled)
    end
end
function TweenMT:Pause()
    if MOCK.tweens[self] then
        MOCK.tweens[self] = nil
        self.PausedElapsed = MOCK.now - self.Start
        self.PlaybackState = Enum.PlaybackState.Paused
    end
end
function TweenMT:Destroy() self:Cancel() end

local TweenService = {
    Create = function(_, object, info, goals)
        assert(typeof(object) == "Instance", "TweenService:Create: Instance expected")
        assert(typeof(info) == "TweenInfo", "TweenService:Create: TweenInfo expected, got " .. typeof(info))
        for prop, value in pairs(goals) do
            local t = propType(object.__class, prop)
            if not t then error("TweenService:Create property named '" .. tostring(prop) .. "' cannot be tweened due to type mismatch (property does not exist on " .. object.__class .. ")", 2) end
            if not TWEENABLE[typeof(value)] then error("TweenService:Create: property '" .. prop .. "' is not tweenable (" .. typeof(value) .. ")", 2) end
            checkType(object.__class, prop, t, value)
        end
        local copy = {}
        for k, v in pairs(goals) do copy[k] = v end
        return setmetatable({ Instance = object, Info = info, Goals = copy, Completed = MOCK.Signal("Completed"), PlaybackState = Enum.PlaybackState.Begin }, TweenMT)
    end,
}

local function stepTweens()
    local done = {}
    for tween in pairs(MOCK.tweens) do
        local info = tween.Info
        local elapsed = MOCK.now - tween.Start - info.DelayTime
        if elapsed >= 0 then
            if not tween.From then
                tween.From = {}
                for prop in pairs(tween.Goals) do tween.From[prop] = tween.Instance[prop] end
            end
            local duration = math.max(info.Time, 1e-6)
            local cycle = info.Reverses and duration * 2 or duration
            local finished = false
            local local_t
            if info.RepeatCount < 0 then
                local_t = elapsed % cycle
            else
                local total = cycle * (info.RepeatCount + 1)
                if elapsed >= total then
                    finished = true
                    local_t = info.Reverses and 0 or duration
                else
                    local_t = elapsed % cycle
                end
            end
            local alpha
            if info.Reverses and local_t > duration then
                alpha = 1 - (local_t - duration) / duration
            else
                alpha = math.min(1, local_t / duration)
            end
            if finished then alpha = info.Reverses and 0 or 1 end
            if info.Time <= 0 then alpha = 1 finished = true end
            local eased = ease(info.EasingStyle, info.EasingDirection, alpha)
            if not rawget(tween.Instance, "__destroyed") then
                for prop, goal in pairs(tween.Goals) do
                    local from = tween.From[prop]
                    if from == nil then from = goal end
                    tween.Instance[prop] = (alpha >= 1 and not info.Reverses) and goal or lerp(from, goal, eased)
                end
            end
            if finished then table.insert(done, tween) end
        end
    end
    for _, tween in ipairs(done) do
        MOCK.tweens[tween] = nil
        tween.PlaybackState = Enum.PlaybackState.Completed
        tween.Completed:Fire(Enum.PlaybackState.Completed)
    end
end

-- Services --------------------------------------------------------------------------------
MOCK.inset = 0 -- GUI space (full-screen / IgnoreGuiInset alignment)
MOCK.pointer = Vector2.new(400, 300)
MOCK.keysDown = {}
local UserInputService = {
    TouchEnabled = false, KeyboardEnabled = true, MouseEnabled = true, GamepadEnabled = false,
    InputBegan = MOCK.Signal("InputBegan"), InputChanged = MOCK.Signal("InputChanged"), InputEnded = MOCK.Signal("InputEnded"),
    JumpRequest = MOCK.Signal("JumpRequest"),
    GetMouseLocation = function() return Vector2.new(MOCK.pointer.X, MOCK.pointer.Y + MOCK.inset) end,
    IsKeyDown = function(_, key) return MOCK.keysDown[key] == true end,
    GetFocusedTextBox = function() return MOCK.focused end,
    GetLastInputType = function() return Enum.UserInputType.MouseMovement end,
}
local RunService = {
    RenderStepped = MOCK.Signal("RenderStepped"), Heartbeat = MOCK.Signal("Heartbeat"), Stepped = MOCK.Signal("Stepped"),
    IsStudio = function() return false end,
}
local GuiService = { GetGuiInset = function() return Vector2.new(0, MOCK.inset), Vector2.new(0, 0) end }
local TextService = {
    GetTextSize = function(_, text, size, font, bounds)
        assert(type(text) == "string", "GetTextSize: string expected")
        assert(typeof(font) == "EnumItem" and font.EnumType == Enum.Font, "GetTextSize: Enum.Font expected")
        local maxWidth = bounds and bounds.X or nil
        local w, h = measureText(text, size, LEGACY_WEIGHT[font.Name] or "Regular", font.Name == "Code" or font.Name == "RobotoMono", maxWidth)
        return Vector2.new(w, h)
    end,
}

local function jsonEncode(value)
    local kind = type(value)
    if kind == "nil" then return "null" end
    if kind == "boolean" then return value and "true" or "false" end
    if kind == "number" then
        if value ~= value or value == math.huge or value == -math.huge then return "null" end
        return string.format("%.14g", value)
    end
    if kind == "string" then return '"' .. value:gsub('[%c"\\]', function(c) return string.format("\\u%04x", c:byte()) end) .. '"' end
    if kind == "table" then
        if getmetatable(value) then error("JSONEncode: cannot encode " .. typeof(value)) end
        local n = #value
        local isArray = n > 0 or next(value) == nil
        if isArray then
            for k in pairs(value) do if type(k) ~= "number" then isArray = false break end end
        end
        local parts = {}
        if isArray then
            for i = 1, n do parts[i] = jsonEncode(value[i]) end
            return "[" .. table.concat(parts, ",") .. "]"
        end
        for k, v in pairs(value) do table.insert(parts, jsonEncode(tostring(k)) .. ":" .. jsonEncode(v)) end
        return "{" .. table.concat(parts, ",") .. "}"
    end
    error("JSONEncode: cannot encode " .. kind)
end
MOCK.JSONEncode = jsonEncode

local function jsonDecode(text)
    local pos = 1
    local function ws() pos = text:find("[^%s]", pos) or #text + 1 end
    local value
    local function str()
        local out = {}
        pos = pos + 1
        while true do
            local c = text:sub(pos, pos)
            if c == '"' then pos = pos + 1 break end
            if c == "" then error("JSONDecode: unterminated string") end
            if c == "\\" then
                local n = text:sub(pos + 1, pos + 1)
                if n == "u" then table.insert(out, utf8.char(tonumber(text:sub(pos + 2, pos + 5), 16))) pos = pos + 6
                else table.insert(out, ({ n = "\n", t = "\t", r = "\r", b = "\b", f = "\f" })[n] or n) pos = pos + 2 end
            else table.insert(out, c) pos = pos + 1 end
        end
        return table.concat(out)
    end
    function value()
        ws()
        local c = text:sub(pos, pos)
        if c == "{" then
            local obj = {}
            pos = pos + 1 ws()
            if text:sub(pos, pos) == "}" then pos = pos + 1 return obj end
            while true do
                ws() local k = str() ws() pos = pos + 1
                obj[k] = value() ws()
                local d = text:sub(pos, pos) pos = pos + 1
                if d == "}" then return obj end
            end
        elseif c == "[" then
            local arr = {}
            pos = pos + 1 ws()
            if text:sub(pos, pos) == "]" then pos = pos + 1 return arr end
            while true do
                table.insert(arr, value()) ws()
                local d = text:sub(pos, pos) pos = pos + 1
                if d == "]" then return arr end
            end
        elseif c == '"' then return str()
        elseif text:sub(pos, pos + 3) == "true" then pos = pos + 4 return true
        elseif text:sub(pos, pos + 4) == "false" then pos = pos + 5 return false
        elseif text:sub(pos, pos + 3) == "null" then pos = pos + 4 return nil
        end
        local num = text:match("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
        assert(num and #num > 0, "JSONDecode: invalid JSON at " .. pos)
        pos = pos + #num
        return tonumber(num)
    end
    return value()
end

local guid = 0
local HttpService = {
    GenerateGUID = function() guid = guid + 1 return string.format("%08X-0000-0000-0000-000000000000", guid) end,
    JSONEncode = function(_, v) return jsonEncode(v) end,
    JSONDecode = function(_, s) return jsonDecode(s) end,
}

local Lighting = MOCK.NewInstance("Lighting", "Lighting")
MOCK.CoreGui = MOCK.NewInstance("CoreGui", "CoreGui")
MOCK.PlayerGui = MOCK.NewInstance("PlayerGui", "PlayerGui")
local LocalPlayer = {
    Name = "tester", DisplayName = "Tester", UserId = 1, Character = nil,
    CharacterAdded = MOCK.Signal("CharacterAdded"),
    WaitForChild = function(_, name) if name == "PlayerGui" then return MOCK.PlayerGui end error("no child " .. name) end,
    FindFirstChildOfClass = function() return nil end,
}
local Players = { LocalPlayer = LocalPlayer, PlayerAdded = MOCK.Signal("PlayerAdded"), GetPlayers = function() return { LocalPlayer } end }

local services = { Players = Players, TweenService = TweenService, UserInputService = UserInputService, RunService = RunService,
    HttpService = HttpService, TextService = TextService, GuiService = GuiService, Lighting = Lighting, CoreGui = MOCK.CoreGui }
game = {
    PlaceId = 1234, GameId = 5678, JobId = "job",
    GetService = function(_, name) return services[name] or error("'" .. tostring(name) .. "' is not a valid Service name") end,
    FindService = function(_, name) return services[name] end,
}
local cameraSignals = {}
workspace = { CurrentCamera = {
    ViewportSize = Vector2.new(1280, 720),
    FieldOfView = 70,
    GetPropertyChangedSignal = function(_, prop) cameraSignals[prop] = cameraSignals[prop] or MOCK.Signal(prop) return cameraSignals[prop] end,
} }
function MOCK.SetViewport(w, h)
    workspace.CurrentCamera.ViewportSize = Vector2.new(w, h)
    Layout.dirty = true
    if cameraSignals.ViewportSize then cameraSignals.ViewportSize:Fire() end
    for _, gui in ipairs(screenRoots) do
        if gui.__propSignals.AbsoluteSize then gui.__propSignals.AbsoluteSize:Fire() end
    end
end

-- Executor environment ---------------------------------------------------------------------
MOCK.files = {}
MOCK.folders = {}
MOCK.HUI = MOCK.NewInstance("Folder", "HiddenUI")
MOCK.genv = {}
function getgenv() return MOCK.genv end
function gethui() return MOCK.HUI end
function identifyexecutor() return "MockExec", "1.0" end
function writefile(path, data) assert(type(data) == "string", "writefile expects a string") MOCK.files[path] = data end
function readfile(path) return MOCK.files[path] or error("file not found: " .. path) end
function isfile(path) return MOCK.files[path] ~= nil end
function isfolder(path) return MOCK.folders[path] == true end
function makefolder(path) MOCK.folders[path] = true end
function delfile(path) MOCK.files[path] = nil end
function listfiles(path)
    local out = {}
    for file in pairs(MOCK.files) do
        if file:sub(1, #path + 1) == path .. "/" and not file:sub(#path + 2):find("/") then table.insert(out, file) end
    end
    table.sort(out)
    return out
end
function setclipboard(text) MOCK.clipboard = text end

-- Driving the simulation --------------------------------------------------------------------
function MOCK.Flush()
    local guard = 0
    while #MOCK.deferred > 0 do
        guard = guard + 1
        if guard > 1000 then record("Scheduler", "task.defer loop did not settle") break end
        local batch = MOCK.deferred
        MOCK.deferred = {}
        for _, job in ipairs(batch) do task.spawn(job.Fn, table.unpack(job.Args, 1, job.Args.n)) end
    end
end

-- Fires GetPropertyChangedSignal for watched Absolute* properties whose value
-- changed, emulating the per-frame layout pass.
local function emitAbsoluteChanges()
    if not Layout.dirty then return end
    local any = false
    for object in pairs(absWatch) do
        if object.__class ~= "ScreenGui" then any = true break end
    end
    if not any then return end
    Layout.Run()
    for object, props in pairs(absWatch) do
        if object.__class == "ScreenGui" then
            -- Changes only with the viewport (see MOCK.SetViewport).
        elseif rawget(object, "__destroyed") then
            absWatch[object] = nil
        else
            for prop, last in pairs(props) do
                local value = absoluteRead(object, prop)
                if last == false or not valuesEqual(last, value) then
                    props[prop] = value
                    if last ~= false and object.__propSignals[prop] then object.__propSignals[prop]:Fire() end
                end
            end
        end
    end
end

function MOCK.Step(dt)
    dt = dt or 1 / 60
    MOCK.now = MOCK.now + dt
    MOCK.frame = MOCK.frame + 1
    RunService.Stepped:Fire(MOCK.now, dt)
    RunService.RenderStepped:Fire(dt)
    stepTweens()
    RunService.Heartbeat:Fire(dt)
    local due = {}
    for i = #MOCK.delayed, 1, -1 do
        if MOCK.delayed[i].At <= MOCK.now then table.insert(due, 1, table.remove(MOCK.delayed, i)) end
    end
    for _, job in ipairs(due) do task.spawn(job.Fn, table.unpack(job.Args, 1, job.Args.n)) end
    local wake = {}
    for i = #MOCK.waiting, 1, -1 do
        if MOCK.waiting[i].At <= MOCK.now then table.insert(wake, 1, table.remove(MOCK.waiting, i)) end
    end
    for _, entry in ipairs(wake) do runThread(entry.Thread) end
    MOCK.Flush()
    if MOCK.frame % 30 == 0 then emitAbsoluteChanges() end
end

function MOCK.Run(seconds)
    local steps = math.ceil((seconds or 0.5) * 60)
    for _ = 1, steps do MOCK.Step(1 / 60) end
end

-- Input objects: positions are in GUI space (InputObject.Position excludes the inset).
function MOCK.Input(kind, fields)
    local input = { UserInputType = Enum.UserInputType[kind], KeyCode = Enum.KeyCode.Unknown,
        Position = Vector3.new(MOCK.pointer.X, MOCK.pointer.Y, 0), Delta = Vector3.zero,
        UserInputState = Enum.UserInputState.Begin, Changed = MOCK.Signal("Changed") }
    for k, v in pairs(fields or {}) do input[k] = v end
    return input
end

function MOCK.Fire(object, event, ...)
    local signal = object[event]
    signal:Fire(...)
    MOCK.Flush()
end

function MOCK.Click(object)
    MOCK.Fire(object, "MouseEnter")
    local press = MOCK.Input("MouseButton1")
    MOCK.Fire(object, "InputBegan", press)
    MOCK.Fire(object, "MouseButton1Down")
    MOCK.Fire(object, "MouseButton1Up")
    MOCK.Fire(object, "Activated", press)
    MOCK.Fire(object, "InputEnded", MOCK.Input("MouseButton1", { UserInputState = Enum.UserInputState.End }))
end

function MOCK.MoveTo(x, y)
    MOCK.pointer = Vector2.new(x, y)
    UserInputService.InputChanged:Fire(MOCK.Input("MouseMovement"), false)
    MOCK.Flush()
end

function MOCK.Key(name, down)
    local key = Enum.KeyCode[name]
    local input = MOCK.Input("Keyboard", { KeyCode = key })
    if down ~= false then
        MOCK.keysDown[key] = true
        UserInputService.InputBegan:Fire(input, MOCK.focused ~= nil)
    end
    if down ~= true then
        MOCK.keysDown[key] = nil
        input.UserInputState = Enum.UserInputState.End
        UserInputService.InputEnded:Fire(input, false)
    end
    MOCK.Flush()
end

function MOCK.Find(root, name)
    for _, d in ipairs(root:GetDescendants()) do if d.Name == name then return d end end
    return nil
end

function MOCK.FindAll(root, name)
    local out = {}
    for _, d in ipairs(root:GetDescendants()) do if d.Name == name then table.insert(out, d) end end
    return out
end

function MOCK.Center(object)
    local p, s = object.AbsolutePosition, object.AbsoluteSize
    return p.X + s.X / 2, p.Y + s.Y / 2
end

-- Export for the renderer ------------------------------------------------------------------------
local function colorArray(c) return c and { c.R, c.G, c.B } or nil end
local function gradientSpec(g)
    if not g or g.__props.Enabled == false then return nil end
    local gp = g.__props
    local spec = { rot = gp.Rotation or 0, off = { (gp.Offset or Vector2.zero).X, (gp.Offset or Vector2.zero).Y } }
    if gp.Color then
        spec.color = {}
        for _, k in ipairs(gp.Color.Keypoints) do table.insert(spec.color, { k.Time, k.Value.R, k.Value.G, k.Value.B }) end
    end
    if gp.Transparency then
        spec.trans = {}
        for _, k in ipairs(gp.Transparency.Keypoints) do table.insert(spec.trans, { k.Time, k.Value }) end
    end
    return spec
end

local function exportNode(object, screenOffset)
    local r = absRects[object]
    if not r then return nil end
    local p = object.__props
    local class = object.__class
    local node = { c = class, n = p.Name, r = { r[1], r[2] + screenOffset, r[3], r[4] }, k = r[5],
        v = p.Visible ~= false, z = p.ZIndex or 1, rot = p.Rotation or 0,
        bg = colorArray(p.BackgroundColor3), bt = p.BackgroundTransparency or 0,
        clip = (p.ClipsDescendants == true) or class == "ScrollingFrame" or class == "CanvasGroup" }
    if class == "CanvasGroup" then node.group = p.GroupTransparency or 0 end
    local strokes, kids = {}, {}
    for _, c in ipairs(object.__children) do
        local cc = c.__class
        if cc == "UICorner" then
            local cr = c.__props.CornerRadius or DEFAULTS.UDim
            node.cr = { cr.Scale, cr.Offset }
        elseif cc == "UIStroke" then
            local sp = c.__props
            if sp.Enabled ~= false then
                table.insert(strokes, { c = colorArray(sp.Color), t = sp.Transparency or 0, th = sp.Thickness or 1,
                    g = gradientSpec(child(c, "UIGradient")), mode = sp.ApplyStrokeMode and sp.ApplyStrokeMode.Name or "Contextual" })
            end
        elseif cc == "UIGradient" then
            node.grad = gradientSpec(c)
        elseif GUI_CLASSES[cc] then
            local kid = exportNode(c, screenOffset)
            if kid then table.insert(kids, kid) end
        end
    end
    if #strokes > 0 then node.strokes = strokes end
    if #kids > 0 then node.kids = kids end
    if TEXT_CLASSES[class] then
        local weight, mono = fontOf(p)
        local pl, pr, pt, pb = paddingOf(object, r[3] / r[5], r[4] / r[5])
        node.text = { s = p.Text or "", rich = p.RichText == true, col = colorArray(p.TextColor3), t = p.TextTransparency or 0,
            size = p.TextSize or 14, w = weight, mono = mono,
            xa = p.TextXAlignment and p.TextXAlignment.Name or "Center", ya = p.TextYAlignment and p.TextYAlignment.Name or "Center",
            wrap = p.TextWrapped == true, trunc = p.TextTruncate and p.TextTruncate.Name or "None",
            pad = { pl, pr, pt, pb } }
        if class == "TextBox" then
            node.text.ph = p.PlaceholderText or ""
            node.text.phc = colorArray(p.PlaceholderColor3 or Color3.fromRGB(178, 178, 178))
        end
        if class == "TextButton" and p.AutoButtonColor ~= false then node.autoButton = true end
    end
    if class == "ImageLabel" or class == "ImageButton" then
        node.img = { s = p.Image or "", col = colorArray(p.ImageColor3 or Color3.new(1, 1, 1)), t = p.ImageTransparency or 0 }
    end
    if class == "ScrollingFrame" then
        local s = scrollInfo[object]
        if s then
            node.scroll = { s[1], s[2], s[3], s[4], s[5], s[6], p.ScrollBarThickness or 12,
                colorArray(p.ScrollBarImageColor3 or Color3.new(0, 0, 0)), p.ScrollBarImageTransparency or 0 }
        end
    end
    return node
end

function MOCK.Export()
    Layout.Run()
    local roots = {}
    for _, gui in ipairs(screenRoots) do
        local offset = rootOffset[gui] or 0
        local kids = {}
        for _, c in ipairs(gui.__children) do
            if GUI_CLASSES[c.__class] then
                local node = exportNode(c, offset)
                if node then table.insert(kids, node) end
            end
        end
        table.insert(roots, { name = gui.__props.Name, order = gui.__props.DisplayOrder or 0, kids = kids })
    end
    local viewport = workspace.CurrentCamera.ViewportSize
    return jsonEncode({ viewport = { viewport.X, viewport.Y }, inset = MOCK.inset, roots = roots })
end

MOCK.Services = services
