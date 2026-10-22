/**
 * Roblox GUI to Pixel-Accurate HTML5/CSS3 + Canvas Translator
 * Translates ScreenGui, GuiObjects, UI Modifiers (UICorner, UIStroke, UIPadding, UIListLayout),
 * and 2D Drawing objects into responsive DOM layouts.
 */

import { Instance, GuiObject, BasePart } from '../runtime/instanceEngine.js';
import { DrawingObject } from '../runtime/executorSandbox.js';
import { Color3, UDim, UDim2, Vector2 } from '../runtime/datatypes.js';

export interface DevicePreset {
  name: string;
  width: number;
  height: number;
  safeAreaInset?: { top: number; right: number; bottom: number; left: number };
}

export const DEVICE_PRESETS: Record<string, DevicePreset> = {
  desktop_1080p: { name: "Desktop (1080p)", width: 1920, height: 1080 },
  mobile_landscape: {
    name: "Mobile Landscape (iPhone/Android)",
    width: 844,
    height: 390,
    safeAreaInset: { top: 0, right: 47, bottom: 21, left: 47 }
  },
  tablet: { name: "Tablet (iPad)", width: 1024, height: 768 },
  console_1080p: { name: "Console (1080p TV)", width: 1920, height: 1080 }
};

export class GuiDomTranslator {
  public static translateToHtml(
    rootInstances: Instance[],
    drawings: DrawingObject[] = [],
    presetName: string = "desktop_1080p"
  ): string {
    const preset = DEVICE_PRESETS[presetName] || DEVICE_PRESETS.desktop_1080p;

    let elementsHtml = "";
    for (const root of rootInstances) {
      if (root.IsA("ScreenGui")) {
        const screenGui = root as any;
        if (!screenGui.Enabled) continue;
        for (const child of screenGui.GetChildren()) {
          if (child.IsA("GuiObject")) {
            elementsHtml += this.translateGuiObject(child as GuiObject);
          }
        }
      } else if (root.IsA("GuiObject")) {
        elementsHtml += this.translateGuiObject(root as GuiObject);
      }
    }

    const drawingCommands = this.generateDrawingCanvasScript(drawings);

    const safeInset = preset.safeAreaInset || { top: 0, right: 0, bottom: 0, left: 0 };

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>RoDev Omni Enterprise GUI Viewport</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
      -webkit-font-smoothing: antialiased;
    }
    body, html {
      width: ${preset.width}px;
      height: ${preset.height}px;
      overflow: hidden;
      background: #0e0e12;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    #viewport-container {
      position: relative;
      width: ${preset.width}px;
      height: ${preset.height}px;
      overflow: hidden;
      padding-top: ${safeInset.top}px;
      padding-right: ${safeInset.right}px;
      padding-bottom: ${safeInset.bottom}px;
      padding-left: ${safeInset.left}px;
    }
    .roblox-gui-object {
      position: absolute;
      box-sizing: border-box;
      display: flex;
    }
    #drawing-canvas {
      position: absolute;
      top: 0;
      left: 0;
      width: ${preset.width}px;
      height: ${preset.height}px;
      pointer-events: none;
      z-index: 999999;
    }
  </style>
</head>
<body>
  <div id="viewport-container">
    ${elementsHtml}
    <canvas id="drawing-canvas" width="${preset.width}" height="${preset.height}"></canvas>
  </div>
  <script>
    window.__ROBLOX_PRESET__ = ${JSON.stringify(preset)};
    ${drawingCommands}
  </script>
</body>
</html>`;
  }

  private static translateGuiObject(obj: GuiObject): string {
    if (!obj.Visible) return "";

    const children = obj.GetChildren();
    let innerHtml = "";

    // Check modifiers
    let cornerRadius = 0;
    let strokeBorder = "";
    let paddingCss = "";
    let layoutCss = "";

    for (const child of children) {
      if (child.ClassName === "UICorner") {
        const corner = child as any;
        cornerRadius = corner.CornerRadius.Offset || 8;
      } else if (child.ClassName === "UIStroke") {
        const stroke = child as any;
        const col = stroke.Color ? stroke.Color.toRgbString() : "rgb(0,0,0)";
        const th = stroke.Thickness || 1;
        strokeBorder = `border: ${th}px solid ${col};`;
      } else if (child.ClassName === "UIPadding") {
        const pad = child as any;
        paddingCss = `padding: ${pad.PaddingTop.Offset}px ${pad.PaddingRight.Offset}px ${pad.PaddingBottom.Offset}px ${pad.PaddingLeft.Offset}px;`;
      } else if (child.ClassName === "UIListLayout") {
        const layout = child as any;
        const dir = layout.FillDirection === "Horizontal" ? "row" : "column";
        const gap = layout.Padding ? layout.Padding.Offset : 0;
        layoutCss = `display: flex; flex-direction: ${dir}; gap: ${gap}px;`;
      } else if (child.IsA("GuiObject")) {
        innerHtml += this.translateGuiObject(child as GuiObject);
      }
    }

    const pos = obj.Position;
    const size = obj.Size;
    const anchor = obj.AnchorPoint || Vector2.zero;

    const leftCalc = `calc(${pos.X.Scale * 100}% + ${pos.X.Offset}px)`;
    const topCalc = `calc(${pos.Y.Scale * 100}% + ${pos.Y.Offset}px)`;
    const widthCalc = `calc(${size.X.Scale * 100}% + ${size.X.Offset}px)`;
    const heightCalc = `calc(${size.Y.Scale * 100}% + ${size.Y.Offset}px)`;

    let transform = `translate(-${anchor.X * 100}%, -${anchor.Y * 100}%)`;
    if (obj.Rotation && obj.Rotation !== 0) {
      transform += ` rotate(${obj.Rotation}deg)`;
    }

    const bgAlpha = Math.max(0, 1 - (obj.BackgroundTransparency ?? 0));
    const bgCol = obj.BackgroundColor3 ? obj.BackgroundColor3 : Color3.fromRGB(255, 255, 255);
    const bgColorCss = `rgba(${Math.round(bgCol.R * 255)}, ${Math.round(bgCol.G * 255)}, ${Math.round(bgCol.B * 255)}, ${bgAlpha})`;

    let style = [
      `left: ${leftCalc}`,
      `top: ${topCalc}`,
      `width: ${widthCalc}`,
      `height: ${heightCalc}`,
      `transform: ${transform}`,
      `background-color: ${bgColorCss}`,
      `z-index: ${obj.ZIndex || 1}`,
      obj.ClipsDescendants ? "overflow: hidden;" : "",
      cornerRadius > 0 ? `border-radius: ${cornerRadius}px;` : "",
      strokeBorder,
      paddingCss,
      layoutCss
    ].filter(Boolean).join("; ");

    // Specific class handling
    let content = "";
    let dataAttrs = `data-path="${obj.FullPath}" data-class="${obj.ClassName}"`;

    if (obj.IsA("TextLabel") || obj.IsA("TextButton") || obj.IsA("TextBox")) {
      const txtObj = obj as any;
      const textCol = txtObj.TextColor3 ? txtObj.TextColor3.toRgbString() : "rgb(255,255,255)";
      const fontSize = txtObj.TextSize || 14;
      const font = this.resolveFontFamily(txtObj.Font);

      let alignX = "center";
      if (txtObj.TextXAlignment === "Left" || txtObj.TextXAlignment === 0) alignX = "flex-start";
      if (txtObj.TextXAlignment === "Right" || txtObj.TextXAlignment === 2) alignX = "flex-end";

      let alignY = "center";
      if (txtObj.TextYAlignment === "Top" || txtObj.TextYAlignment === 0) alignY = "flex-start";
      if (txtObj.TextYAlignment === "Bottom" || txtObj.TextYAlignment === 2) alignY = "flex-end";

      style += `; color: ${textCol}; font-size: ${fontSize}px; font-family: ${font}; justify-content: ${alignX}; align-items: ${alignY};`;
      if (txtObj.TextWrapped) style += "; word-break: break-word;";

      const displayText = txtObj.Text ?? (obj.IsA("TextBox") ? txtObj.PlaceholderText : "");
      content = `<span>${this.escapeHtml(displayText)}</span>`;
    }

    if (obj.IsA("ImageLabel") || obj.IsA("ImageButton")) {
      const imgObj = obj as any;
      if (imgObj.Image) {
        style += `; background-image: url('${imgObj.Image}'); background-size: cover; background-position: center;`;
      }
    }

    return `<div id="${obj.UniqueId}" class="roblox-gui-object ${obj.ClassName.toLowerCase()}" ${dataAttrs} style="${style}">${content}${innerHtml}</div>`;
  }

  private static resolveFontFamily(font: any): string {
    const fontStr = typeof font === 'string' ? font : font?.Name || "SourceSans";
    if (fontStr.includes("Mono")) return '"Cascadia Mono", Consolas, monospace';
    if (fontStr.includes("Gotham") || fontStr.includes("BuilderSans")) return 'system-ui, -apple-system, sans-serif';
    return '"Segoe UI", -apple-system, sans-serif';
  }

  private static escapeHtml(str: string): string {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private static generateDrawingCanvasScript(drawings: DrawingObject[]): string {
    const commands: string[] = [
      "const canvas = document.getElementById('drawing-canvas');",
      "const ctx = canvas.getContext('2d');"
    ];

    for (const draw of drawings) {
      if (draw.removed || !draw.properties.Visible) continue;
      const p = draw.properties;
      const col = p.Color ? p.Color.toRgbString() : "rgb(255,255,255)";
      const alpha = p.Transparency ?? 1;

      commands.push(`ctx.globalAlpha = ${alpha};`);
      commands.push(`ctx.strokeStyle = '${col}';`);
      commands.push(`ctx.fillStyle = '${col}';`);
      commands.push(`ctx.lineWidth = ${p.Thickness || 1};`);

      if (draw.type === "Circle") {
        commands.push("ctx.beginPath();");
        commands.push(`ctx.arc(${p.Position?.X || 0}, ${p.Position?.Y || 0}, ${p.Radius || 10}, 0, Math.PI * 2);`);
        if (p.Filled) commands.push("ctx.fill();");
        else commands.push("ctx.stroke();");
      } else if (draw.type === "Line") {
        commands.push("ctx.beginPath();");
        commands.push(`ctx.moveTo(${p.From?.X || 0}, ${p.From?.Y || 0});`);
        commands.push(`ctx.lineTo(${p.To?.X || 0}, ${p.To?.Y || 0});`);
        commands.push("ctx.stroke();");
      } else if (draw.type === "Square") {
        const x = p.Position?.X || 0;
        const y = p.Position?.Y || 0;
        const w = p.Size?.X || 50;
        const h = p.Size?.Y || 50;
        if (p.Filled) commands.push(`ctx.fillRect(${x}, ${y}, ${w}, ${h});`);
        else commands.push(`ctx.strokeRect(${x}, ${y}, ${w}, ${h});`);
      } else if (draw.type === "Text") {
        commands.push(`ctx.font = '${p.Size || 16}px "Segoe UI", sans-serif';`);
        commands.push(`ctx.fillText(${JSON.stringify(p.Text || "")}, ${p.Position?.X || 0}, ${p.Position?.Y || 0});`);
      }
    }

    return commands.join("\n");
  }
}
