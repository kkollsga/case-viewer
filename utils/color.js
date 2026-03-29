// utils/color.js — Consistent colour palette logic
// Three-tier palette: light (level 1), medium (level 2), vibrant (level 3+)

export const PALETTES = {
  // Light/subtle colours for level 1 (outermost)
  light: [
    '#DBEAFE', '#FEE2E2', '#D1FAE5', '#FEF3C7', '#EDE9FE', '#CFFAFE',
    '#FFE4E6', '#ECFCCB', '#CCFBF1', '#FED7AA', '#F3E8FF', '#E0F2FE',
  ],
  // Medium colours for level 2
  medium: [
    '#93C5FD', '#FCA5A5', '#86EFAC', '#FCD34D', '#C4B5FD', '#67E8F9',
    '#FDA4AF', '#BEF264', '#5EEAD4', '#FDBA74', '#D8B4FE', '#7DD3FC',
  ],
  // Vibrant colours for level 3+ (innermost/deepest)
  vibrant: [
    '#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#0891B2',
    '#E11D48', '#65A30D', '#0D9488', '#EA580C', '#8B5CF6', '#0284C7',
  ],
};

/**
 * Create a faint (lightened) version of a hex color by mixing towards white.
 * amount: 0 = original, 1 = pure white. Default 0.88.
 */
export function faintColor(hex, amount = 0.88) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
}

/**
 * Convert hex colour to HSL [h 0-360, s 0-100, l 0-100].
 */
export function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s * 100, l * 100];
}

/**
 * Convert HSL [h 0-360, s 0-100, l 0-100] to hex colour.
 */
export function hslToHex(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return '#' + [r, g, b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

/**
 * Derive a sub-level colour from a parent colour.
 * Keeps the parent's hue & saturation; varies lightness based on
 * the child's own hue value: red (0°) → lightest, crimson (~360°) → darkest.
 * Darkest matches parent lightness; lightest is +50 HSL-L points above that.
 */
export function deriveSubLevelColor(parentHex, childHex) {
  const [pH, pS, pL] = hexToHsl(parentHex);
  const [cH] = hexToHsl(childHex);
  const offset = 50 * (1 - cH / 360);
  return hslToHex(pH, pS, Math.min(pL + offset, 97));
}

export const THEME = {
  white: '#FFFFFF',
  totalCircle: '#F9FAFB',
  totalBorder: '#374151',
  defaultStroke: '#E5E7EB',
  fallback: '#F3F4F6',
  textDark: '#111827',
  textLight: '#FFFFFF',
};

// Persistent colour assignments — survives across renders within a session
const colorMap = new Map();
const colorUsageByLayer = new Map();
const colorIndexByLayer = new Map();

/**
 * Get a deterministic hash for a string (for colour consistency).
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

/**
 * Get the palette for a given depth level (1-indexed).
 */
export function getPalette(depth) {
  if (depth <= 1) return PALETTES.light;
  if (depth === 2) return PALETTES.medium;
  return PALETTES.vibrant;
}

/**
 * Get a colour for a node in the circle packing, based on depth and name.
 * Ensures consistent colours across re-renders.
 */
export function getNodeColor(name, depth) {
  const colorKey = `depth${depth}_${name}`;
  if (colorMap.has(colorKey)) return colorMap.get(colorKey);

  const palette = getPalette(depth);
  const layerKey = `layer_${depth}`;

  if (!colorUsageByLayer.has(layerKey)) {
    colorUsageByLayer.set(layerKey, new Set());
    colorIndexByLayer.set(layerKey, 0);
  }

  const usedColors = colorUsageByLayer.get(layerKey);
  let colorIndex = colorIndexByLayer.get(layerKey);
  let color;

  if (usedColors.size >= palette.length) {
    // All colours used — hash for consistency
    colorIndex = Math.abs(hashString(name)) % palette.length;
    color = palette[colorIndex];
  } else {
    while (usedColors.has(palette[colorIndex % palette.length])) {
      colorIndex++;
    }
    color = palette[colorIndex % palette.length];
    usedColors.add(color);
    colorIndexByLayer.set(layerKey, (colorIndex + 1) % palette.length);
  }

  colorMap.set(colorKey, color);
  return color;
}

/**
 * Get a colour for a group in the cross-plot (uses vibrant palette).
 */
export function getColorForGroup(groupName) {
  const colorKey = `depth1_${groupName}`;
  if (colorMap.has(colorKey)) return colorMap.get(colorKey);

  // Use vibrant palette for cross-plot groups
  const palette = PALETTES.vibrant;
  const layerKey = 'layer_1';

  if (!colorUsageByLayer.has(layerKey)) {
    colorUsageByLayer.set(layerKey, new Set());
    colorIndexByLayer.set(layerKey, 0);
  }

  const usedColors = colorUsageByLayer.get(layerKey);
  let colorIndex = colorIndexByLayer.get(layerKey);
  let color;

  if (usedColors.size >= palette.length) {
    colorIndex = Math.abs(hashString(groupName)) % palette.length;
    color = palette[colorIndex];
  } else {
    while (usedColors.has(palette[colorIndex % palette.length])) {
      colorIndex++;
    }
    color = palette[colorIndex % palette.length];
    usedColors.add(color);
    colorIndexByLayer.set(layerKey, (colorIndex + 1) % palette.length);
  }

  colorMap.set(colorKey, color);
  return color;
}

/**
 * Get a deterministic colour for a case name (cross-plot multi-case).
 */
export function getColorForCase(caseName) {
  const palette = PALETTES.vibrant;
  return palette[Math.abs(hashString(caseName)) % palette.length];
}

/**
 * Reset all colour assignments (call when switching fields).
 */
export function resetColorAssignments() {
  colorMap.clear();
  colorUsageByLayer.clear();
  colorIndexByLayer.clear();
}

/**
 * Get node opacity based on depth.
 */
export function getNodeOpacity(depth, maxDepth) {
  if (depth === 0) return 0.05; // Root
  if (depth === maxDepth) return 1;
  return 0.4 + (depth / maxDepth) * 0.6;
}

/**
 * Get label text colour based on node depth.
 */
export function getLabelTextColor(depth) {
  return depth >= 3 ? THEME.textLight : THEME.textDark;
}

/**
 * Truncate text to fit within a given width (approximate).
 */
export function truncateTextToFit(text, maxWidth, fontSize) {
  const charWidth = fontSize * 0.6;
  const maxChars = Math.floor(maxWidth / charWidth);
  if (text.length <= maxChars) return text;
  return text.substring(0, Math.max(0, maxChars - 1)) + '…';
}
