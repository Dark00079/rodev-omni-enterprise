const { createCanvas, Image, loadImage } = require("@napi-rs/canvas");
const fs = require("fs");
const path = require("path");

const imageCache = new Map();

function findWorkspaceRoot(startPath) {
  if (process.env.WORKSPACE_ROOT && fs.existsSync(process.env.WORKSPACE_ROOT)) {
    return path.resolve(process.env.WORKSPACE_ROOT);
  }
  if (process.env.ROBLOX_WORKSPACE && fs.existsSync(process.env.ROBLOX_WORKSPACE)) {
    return path.resolve(process.env.ROBLOX_WORKSPACE);
  }
  const origins = [startPath, process.cwd(), __dirname].filter(Boolean);
  for (const origin of origins) {
    try {
      let current = fs.statSync(origin).isDirectory() ? path.resolve(origin) : path.dirname(path.resolve(origin));
      for (let i = 0; i < 12; i++) {
        if (
          fs.existsSync(path.join(current, 'Public', 'Icons')) ||
          fs.existsSync(path.join(current, 'Icons')) ||
          fs.existsSync(path.join(current, '.git'))
        ) {
          if (path.basename(current) === 'rodev-omni-enterprise') {
            const parent = path.dirname(current);
            if (fs.existsSync(path.join(parent, 'Public', 'Icons')) || fs.existsSync(path.join(parent, '.git'))) {
              return parent;
            }
          }
          return current;
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
    } catch {}
  }
  return process.cwd();
}

function resolveImagePath(s, rootDir) {
  if (!s || typeof s !== 'string') return null;
  const clean = s.replace(/^rbxasset:\/\//, '').replace(/^customasset:\/\//, '').replace(/^getcustomasset:\/\//, '');
  const root = rootDir || findWorkspaceRoot();
  const baseName = path.basename(clean);
  const baseNoExt = path.basename(clean, path.extname(clean));

  const candidates = [
    clean,
    path.resolve(clean),
    path.resolve(root, clean),
    path.resolve(process.cwd(), clean),
    path.resolve(root, 'Public/Icons', baseName),
    path.resolve(root, 'Public/Icons', baseNoExt + '.png'),
    path.resolve(root, 'Icons', baseName),
    path.resolve(root, 'Icons', baseNoExt + '.png'),
    path.resolve(root, 'Public', clean),
    path.resolve(root, 'assets', baseName),
    path.resolve(root, 'assets', baseNoExt + '.png'),
    path.resolve(process.cwd(), 'Public/Icons', baseName),
    path.resolve(process.cwd(), 'Icons', baseName)
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        if (fs.statSync(c).isFile()) return c;
      } catch {}
    }
  }
  return null;
}

async function preloadImages(tree, rootDir) {
  const filePaths = new Set();
  function walk(node) {
    if (node.img && node.img.s) {
      const disk = resolveImagePath(node.img.s, rootDir);
      if (disk) filePaths.add(disk);
    }
    if (node.kids) node.kids.forEach(walk);
  }
  if (tree.roots) {
    tree.roots.forEach(r => (r.kids || []).forEach(walk));
  }
  await Promise.all(
    Array.from(filePaths).map(async (fp) => {
      if (!imageCache.has(fp)) {
        try {
          const img = await loadImage(fp);
          imageCache.set(fp, img);
        } catch {}
      }
    })
  );
}

function loadCachedImage(imagePath) {
  if (!imagePath) return null;
  return imageCache.get(imagePath) || null;
}

// Roblox normalizes fonts so one line of text is ~TextSize tall; the glyph
// em is a little smaller than that.
const EM = 0.9;
const LINE = 1.0;
const SANS = '"Segoe UI"';
const MONO = '"Cascadia Mono", Consolas';
const WEIGHTS = { Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Heavy: 900 };

const measureCanvas = createCanvas(8, 8).getContext("2d");
function fontString(size, weight, mono, italic) {
  return `${italic ? "italic " : ""}${WEIGHTS[weight] || 400} ${Math.max(1, size * EM)}px ${mono ? MONO : SANS}`;
}
function textWidth(text, size, weight, mono) {
  measureCanvas.font = fontString(size, weight, mono);
  return measureCanvas.measureText(text).width;
}

// Greedy word wrap; words longer than the line are broken by characters.
function wrap(text, size, weight, mono, maxWidth) {
  const out = [];
  for (const paragraph of String(text).split("\n")) {
    if (maxWidth == null || maxWidth < 0) { out.push(paragraph); continue; }
    const words = paragraph.split(" ");
    let line = "";
    for (const word of words) {
      const candidate = line === "" ? word : line + " " + word;
      if (textWidth(candidate, size, weight, mono) <= maxWidth + 0.01 || line === "") {
        if (line === "" && textWidth(word, size, weight, mono) > maxWidth) {
          let chunk = "";
          for (const ch of word) {
            if (textWidth(chunk + ch, size, weight, mono) > maxWidth && chunk !== "") { out.push(chunk); chunk = ch; }
            else chunk += ch;
          }
          line = chunk;
        } else line = candidate;
      } else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

function measure(text, size, weight, mono, maxWidth) {
  const lines = wrap(text, size, weight, mono, maxWidth >= 0 ? maxWidth : null);
  let w = 0;
  for (const l of lines) w = Math.max(w, textWidth(l, size, weight, mono));
  return [Math.ceil(w), lines.length * size * LINE];
}

// Rich text: <font color="#hex">, <b>, <i>, <u> and entities -> styled characters.
function parseRich(source, baseColor) {
  const chars = [];
  const stack = [{ color: baseColor, bold: false, italic: false }];
  const re = /<\/?(font|b|i|u|stroke)[^>]*>|&(lt|gt|amp|quot|apos);|[\s\S]/g;
  const entities = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  let m;
  while ((m = re.exec(source))) {
    const token = m[0];
    const top = stack[stack.length - 1];
    if (token.startsWith("</")) { if (stack.length > 1) stack.pop(); continue; }
    if (m[1]) {
      const next = { ...top };
      if (m[1] === "b") next.bold = true;
      if (m[1] === "i") next.italic = true;
      const color = /color\s*=\s*["']#?([0-9a-fA-F]{6})["']/.exec(token);
      if (m[1] === "font" && color) {
        const hex = color[1];
        next.color = [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255];
      }
      stack.push(next);
      continue;
    }
    chars.push({ ch: m[2] ? entities[m[2]] : token, ...top });
  }
  return chars;
}

const rgba = (c, a) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${Math.max(0, Math.min(1, a))})`;

function radiusOf(node) {
  if (!node.cr) return 0;
  const [, , w, h] = node.r;
  const r = node.cr[0] * Math.min(w, h) + node.cr[1] * node.k;
  return Math.max(0, Math.min(r, Math.min(w, h) / 2));
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function sample(stops, t, fallback) {
  if (!stops || stops.length === 0) return fallback;
  if (t <= stops[0][0]) return stops[0].slice(1);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i];
      const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
      return a.slice(1).map((v, j) => v + (b[j + 1] - v) * f);
    }
  }
  return stops[stops.length - 1].slice(1);
}

// UIGradient: colors multiply the base color; transparency multiplies alpha.
function paintStyle(ctx, x, y, w, h, spec, base, alpha) {
  if (!spec) return rgba(base, alpha);
  const rot = ((spec.rot || 0) * Math.PI) / 180;
  const dx = Math.cos(rot), dy = Math.sin(rot);
  const half = Math.max(1, (Math.abs(w * dx) + Math.abs(h * dy)) / 2);
  const cx = x + w / 2 + spec.off[0] * w, cy = y + h / 2 + spec.off[1] * h;
  const g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  const times = new Set([0, 1]);
  (spec.color || []).forEach((s) => times.add(s[0]));
  (spec.trans || []).forEach((s) => times.add(s[0]));
  [...times].sort((a, b) => a - b).forEach((t) => {
    const c = sample(spec.color, t, [1, 1, 1]);
    const tr = sample(spec.trans, t, [0])[0];
    g.addColorStop(Math.max(0, Math.min(1, t)), rgba([base[0] * c[0], base[1] * c[1], base[2] * c[2]], alpha * (1 - tr)));
  });
  return g;
}

function textLines(node) {
  const t = node.text;
  const [x, y, w, h] = node.r;
  const k = node.k;
  const pad = t.pad || [0, 0, 0, 0];
  const box = { x: x + pad[0] * k, y: y + pad[2] * k, w: w - (pad[0] + pad[1]) * k, h: h - (pad[2] + pad[3]) * k };
  let source = t.s;
  let color = t.col || [0, 0, 0];
  let placeholder = false;
  if (node.c === "TextBox" && source === "") { source = t.ph || ""; color = t.phc || [0.7, 0.7, 0.7]; placeholder = true; }
  const rich = t.rich && !placeholder;
  const chars = rich ? parseRich(source, color) : null;
  const plain = rich ? chars.map((c) => c.ch).join("") : source;
  const size = t.size * k;
  const lines = t.wrap ? wrap(plain, size, t.w, t.mono, box.w) : plain.split("\n");
  return { box, plain, chars, lines, size, color, rich };
}

function paintText(ctx, node, alpha) {
  const t = node.text;
  const info = textLines(node);
  if (!info.plain) return;
  const a = alpha * (1 - (t.t || 0));
  if (a <= 0.003) return;
  const { box, lines, size } = info;
  const lh = size * LINE;
  const block = lines.length * lh;
  let y0 = box.y;
  if (t.ya === "Center") y0 = box.y + (box.h - block) / 2;
  else if (t.ya === "Bottom") y0 = box.y + box.h - block;
  ctx.textBaseline = "middle";
  let cursor = 0;
  lines.forEach((rawLine, i) => {
    let line = rawLine;
    if (t.trunc !== "None" && textWidth(line, size, t.w, t.mono) > box.w + 0.5) {
      while (line.length > 0 && textWidth(line + "…", size, t.w, t.mono) > box.w) line = line.slice(0, -1);
      line += "…";
    }
    const lw = textWidth(line, size, t.w, t.mono);
    let x0 = box.x;
    if (t.xa === "Center") x0 = box.x + (box.w - lw) / 2;
    else if (t.xa === "Right") x0 = box.x + box.w - lw;
    const yc = y0 + i * lh + lh / 2;
    if (info.rich) {
      let x = x0;
      for (let j = 0; j < rawLine.length && cursor + j < info.chars.length; j++) {
        const c = info.chars[cursor + j];
        ctx.font = fontString(size, c.bold ? "Bold" : t.w, t.mono, c.italic);
        ctx.fillStyle = paintStyle(ctx, node.r[0], node.r[1], node.r[2], node.r[3], node.grad, c.color, a);
        ctx.fillText(c.ch, x, yc);
        x += ctx.measureText(c.ch).width;
      }
      cursor += rawLine.length + 1;
    } else {
      ctx.font = fontString(size, t.w, t.mono);
      ctx.fillStyle = paintStyle(ctx, node.r[0], node.r[1], node.r[2], node.r[3], node.grad, info.color, a);
      ctx.fillText(line, x0, yc);
    }
  });
}

function paintNode(ctx, node, alpha) {
  if (!node.v) return;
  const [x, y, w, h] = node.r;
  ctx.save();
  if (node.rot) {
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((node.rot * Math.PI) / 180);
    ctx.translate(-(x + w / 2), -(y + h / 2));
  }
  const groupAlpha = alpha * (node.group != null ? 1 - node.group : 1);
  const r = radiusOf(node);
  const bgAlpha = groupAlpha * (1 - node.bt);
  if (bgAlpha > 0.002 && node.bg && w > 0 && h > 0) {
    ctx.fillStyle = paintStyle(ctx, x, y, w, h, node.grad, node.bg, bgAlpha);
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
  }
  if (node.img && node.img.s) {
    const ia = groupAlpha * (1 - node.img.t);
    if (ia > 0.002 && w > 0 && h > 0) {
      const diskPath = resolveImagePath(node.img.s);
      const img = diskPath ? loadCachedImage(diskPath) : null;
      if (img) {
        ctx.save();
        ctx.globalAlpha = ia;
        const col = node.img.col;
        const needsTint = col && (col[0] < 0.98 || col[1] < 0.98 || col[2] < 0.98);
        if (needsTint) {
          const off = createCanvas(img.width, img.height);
          const octx = off.getContext('2d');
          octx.drawImage(img, 0, 0);
          octx.globalCompositeOperation = 'source-in';
          octx.fillStyle = rgba(col, 1);
          octx.fillRect(0, 0, img.width, img.height);
          ctx.drawImage(off, x, y, w, h);
        } else {
          ctx.drawImage(img, x, y, w, h);
        }
        ctx.restore();
      } else {
        ctx.fillStyle = rgba([0.35, 0.37, 0.45], ia * 0.9);
        roundRect(ctx, x, y, w, h, r);
        ctx.fill();
      }
    }
  }
  for (const s of node.strokes || []) {
    if (node.text && s.mode !== "Border") continue;
    const sa = groupAlpha * (1 - s.t);
    if (sa <= 0.002 || w <= 0 || h <= 0) continue;
    const th = s.th * node.k;
    ctx.lineWidth = th;
    ctx.strokeStyle = paintStyle(ctx, x, y, w, h, s.g, s.c || [0, 0, 0], sa);
    roundRect(ctx, x - th / 2, y - th / 2, w + th, h + th, r + th / 2);
    ctx.stroke();
  }
  if (node.text) paintText(ctx, node, groupAlpha);
  if (node.kids) {
    ctx.save();
    if (node.clip) {
      if (node.c === "CanvasGroup" && r > 0) roundRect(ctx, x, y, w, h, r);
      else { ctx.beginPath(); ctx.rect(x, y, w, h); }
      ctx.clip();
    }
    const kids = node.kids.map((kid, i) => [kid, i]).sort((a, b) => a[0].z - b[0].z || a[1] - b[1]);
    for (const [kid] of kids) paintNode(ctx, kid, groupAlpha);
    ctx.restore();
  }
  if (node.scroll) {
    const [cw, ch, ww, wh, , py, thick, color, tr] = node.scroll;
    if (ch > wh + 0.5 && thick > 0 && tr < 1) {
      const k = node.k;
      const thumb = Math.max(18 * k, (wh / ch) * h);
      const ty = y + (py / Math.max(1, ch - wh)) * (h - thumb);
      ctx.fillStyle = rgba(color, groupAlpha * (1 - tr));
      roundRect(ctx, x + w - thick * k, ty, thick * k, thumb, (thick * k) / 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

async function render(tree, options = {}) {
  await preloadImages(tree, options.rootDir);
  const [vw, vh] = tree.viewport;
  const scale = options.scale || 1;
  const crop = options.crop || [0, 0, vw, vh];
  const canvas = createCanvas(Math.round(crop[2] * scale), Math.round(crop[3] * scale));
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.translate(-crop[0], -crop[1]);
  // A neutral "game world" backdrop so translucent UI reads correctly.
  const bg = ctx.createLinearGradient(0, 0, vw, vh);
  bg.addColorStop(0, "#5b6b7d");
  bg.addColorStop(1, "#2e3a46");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, vw, vh);
  ctx.fillStyle = "rgba(20,24,30,0.55)";
  ctx.fillRect(0, 0, vw, tree.inset);
  const roots = [...tree.roots].sort((a, b) => a.order - b.order);
  for (const root of roots) {
    const kids = root.kids.map((kid, i) => [kid, i]).sort((a, b) => a[0].z - b[0].z || a[1] - b[1]);
    for (const [kid] of kids) paintNode(ctx, kid, 1);
  }
  return canvas.toBuffer("image/png");
}

// ---------------------------------------------------------------------------
// Audit: clipped/overflowing text and text colliding with sibling controls.
function audit(tree) {
  const issues = [];
  const intersects = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
  function walk(node, path, clips, alpha) {
    if (!node.v) return;
    const a = alpha * (node.group != null ? 1 - node.group : 1);
    const here = path + "/" + node.n;
    const [x, y, w, h] = node.r;
    if (node.text && a > 0.05 && w > 0 && h > 0) {
      const info = textLines(node);
      const t = node.text;
      if (info.plain && (1 - (t.t || 0)) * a > 0.05) {
        const { box, lines, size } = info;
        const widths = lines.map((l) => textWidth(l, size, t.w, t.mono));
        const textW = Math.max(...widths);
        const textH = lines.length * size * LINE;
        if (!t.wrap && t.trunc === "None" && textW > box.w + 1.5) issues.push({ kind: "overflow-x", path: here, text: info.plain.slice(0, 60), by: +(textW - box.w).toFixed(1) });
        if (textH > box.h + 1.5) issues.push({ kind: "overflow-y", path: here, text: info.plain.slice(0, 60), by: +(textH - box.h).toFixed(1) });
        if (t.trunc !== "None" && textW > box.w + 1) issues.push({ kind: "truncated", path: here, text: info.plain.slice(0, 60) });
        let ex = box.x;
        const drawnW = Math.min(textW, box.w);
        if (t.xa === "Center") ex = box.x + (box.w - drawnW) / 2;
        else if (t.xa === "Right") ex = box.x + box.w - drawnW;
        let ey = box.y;
        const drawnH = Math.min(textH, Math.max(textH, 0));
        if (t.ya === "Center") ey = box.y + (box.h - drawnH) / 2;
        else if (t.ya === "Bottom") ey = box.y + box.h - drawnH;
        const ext = { x: ex, y: ey, w: drawnW, h: drawnH };
        for (const clip of clips) {
          if (!intersects(ext, clip)) continue;
          const inside = ext.x >= clip.x - 1 && ext.y >= clip.y - 1 && ext.x + ext.w <= clip.x + clip.w + 1 && ext.y + ext.h <= clip.y + clip.h + 1;
          if (!inside && !clip.scroll) issues.push({ kind: "clipped", path: here, text: info.plain.slice(0, 60), by: clip.name });
        }
      }
    }
    if (!node.kids) return;
    // Content inside a ScrollingFrame is expected to be cut at the viewport,
    // including by the containers that bound the scroll frame.
    const isScroll = node.c === "ScrollingFrame";
    const base = isScroll ? clips.map((c) => ({ ...c, scroll: true })) : clips;
    const nextClips = node.clip ? base.concat([{ x, y, w, h, name: node.n, scroll: isScroll }]) : base;
    // Text that collides with a visible sibling control (e.g. a title running under a switch).
    for (const kid of node.kids) {
      if (!kid.v || !kid.text || !kid.text.s || kid.r[2] <= 0) continue;
      const ka = a * (1 - (kid.text.t || 0));
      if (ka < 0.05) continue;
      const info = textLines(kid);
      const textW = Math.max(...info.lines.map((l) => textWidth(l, info.size, kid.text.w, kid.text.mono)));
      let ex = info.box.x;
      const drawnW = Math.min(textW, info.box.w);
      if (kid.text.xa === "Center") ex = info.box.x + (info.box.w - drawnW) / 2;
      else if (kid.text.xa === "Right") ex = info.box.x + info.box.w - drawnW;
      const ext = { x: ex, y: info.box.y, w: drawnW, h: info.box.h };
      for (const other of node.kids) {
        if (other === kid || !other.v || other.r[2] <= 0 || other.r[3] <= 0) continue;
        const opaque = other.bt < 0.9 || (other.strokes || []).some((s) => s.t < 0.9) || other.text;
        if (!opaque || (other.group != null && other.group > 0.95)) continue;
        const rect = { x: other.r[0], y: other.r[1], w: other.r[2], h: other.r[3] };
        if (other.z >= kid.z && intersects(ext, rect) && !(rect.x <= ext.x && rect.y <= ext.y && rect.x + rect.w >= ext.x + ext.w && rect.y + rect.h >= ext.y + ext.h)) {
          issues.push({ kind: "overlap", path: here + "/" + kid.n, text: info.plain.slice(0, 40), by: other.n });
        }
      }
    }
    for (const kid of node.kids) walk(kid, here, nextClips, a);
  }
  for (const root of tree.roots) for (const kid of root.kids) walk(kid, root.name, [], 1);
  return issues;
}

module.exports = { render, audit, measure };
