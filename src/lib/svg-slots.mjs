import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const COLOR_ROLES = new Map([
  ["slot-bg", "background"],
  ["slot-color-primary", "primary"],
  ["slot-color-secondary", "secondary"],
  ["slot-color-accent", "accent"],
  ["slot-color-text", "text"],
]);
const TEXT_IDS = new Set([
  "slot-title",
  "slot-slogan",
  "slot-price",
  "slot-occasion",
  "slot-extra",
]);
const TEXT_SLOTS = new Map([
  ["slot-title", "title"],
  ["slot-slogan", "slogan"],
  ["slot-price", "price"],
  ["slot-occasion", "occasion"],
  ["slot-extra", "extra"],
]);
const IMAGE_SLOTS = new Map([
  ["slot-logo", "logo"],
  ["slot-image", "image"],
]);

function parseSvg(source) {
  const errors = [];
  const document = new DOMParser({
    onError(level, message) {
      if (level !== "warning") errors.push(message);
    },
  }).parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (errors.length > 0 || !root || root.localName?.toLowerCase() !== "svg") {
    throw new Error("No se pudo parsear el SVG con slots.");
  }
  return { document, root };
}

function allElements(document) {
  return Array.from(document.getElementsByTagName("*"));
}

function isNamedSlot(element) {
  const id = element.getAttribute("id");
  return (
    typeof id === "string" &&
    id.startsWith("slot-") &&
    element.getAttribute("data-slot") === id.slice("slot-".length)
  );
}

export function getDetectedSlots(source) {
  const { document } = parseSvg(source);
  return allElements(document)
    .filter(isNamedSlot)
    .map((element) => element.getAttribute("id"));
}

function findSlot(document, id) {
  return allElements(document).find(
    (element) => element.getAttribute("id") === id && isNamedSlot(element),
  ) ?? null;
}

function parseColor(value) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) return null;
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function linearize(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color) {
  const [red, green, blue] = parseColor(color);
  return (
    0.2126 * linearize(red) +
    0.7152 * linearize(green) +
    0.0722 * linearize(blue)
  );
}

export function calculateContrastRatio(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function ensureTextContrast(color, background) {
  if (calculateContrastRatio(color, background) >= 4.5) return color;
  const black = "#000000";
  const white = "#FFFFFF";
  return calculateContrastRatio(black, background) >=
    calculateContrastRatio(white, background)
    ? black
    : white;
}

function finiteAttribute(element, name) {
  const rawValue = element.getAttribute(name);
  if (rawValue === null || rawValue.trim() === "") return null;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function positiveSlotSize(element, name) {
  const value = finiteAttribute(element, name);
  return value !== null && value > 0 ? value : null;
}

function slotMargin(element) {
  const value = finiteAttribute(element, "data-margin");
  return value !== null && value > 0 ? value : 0;
}

function paletteColors(palette) {
  const colors = palette.map((color) => color.toUpperCase());
  const primary = colors[0];
  const secondary = colors[1] ?? primary;
  const background = colors[2] ?? primary;
  const text = colors[3] ?? primary;
  return {
    primary,
    secondary,
    accent: colors[2] ?? secondary,
    background,
    text: ensureTextContrast(text, background),
  };
}

function applyColors(document, root, colors) {
  for (const [id, role] of COLOR_ROLES) {
    const slot = findSlot(document, id);
    if (slot) setFill(slot, colors[role]);
  }

  for (const [id] of TEXT_SLOTS) {
    const slot = findSlot(document, id);
    if (slot) {
      setFill(slot, ensureTextContrast(colors.text, colors.background));
    }
  }
  if (root.namespaceURI !== SVG_NAMESPACE) {
    throw new Error("El SVG personalizado no tiene el namespace requerido.");
  }
}

function setFill(element, color) {
  element.setAttribute("fill", color);
  const declarations = (element.getAttribute("style") ?? "")
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(
      (declaration) =>
        declaration && !/^fill\s*:/i.test(declaration),
    );
  declarations.push(`fill: ${color} !important`);
  element.setAttribute("style", declarations.join("; "));
}

function estimateTextWidth(text, fontSize) {
  return Array.from(text).reduce((width, character) => {
    if (/\s/.test(character)) return width + fontSize * 0.3;
    if (/[ilI.,'`:;!|]/.test(character)) return width + fontSize * 0.28;
    if (/[MW@#%&]/.test(character)) return width + fontSize * 0.85;
    return width + fontSize * 0.56;
  }, 0);
}

function splitLongWord(word, maxWidth, fontSize) {
  const parts = [];
  let part = "";
  for (const character of Array.from(word)) {
    if (part && estimateTextWidth(part + character, fontSize) > maxWidth) {
      parts.push(part);
      part = character;
    } else {
      part += character;
    }
  }
  if (part) parts.push(part);
  return parts;
}

function wrapText(value, maxWidth, fontSize) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines = [];
  let line = "";
  for (const word of words) {
    const candidates =
      estimateTextWidth(word, fontSize) > maxWidth
        ? splitLongWord(word, maxWidth, fontSize)
        : [word];
    for (const candidate of candidates) {
      const combined = line ? `${line} ${candidate}` : candidate;
      if (line && estimateTextWidth(combined, fontSize) > maxWidth) {
        lines.push(line);
        line = candidate;
      } else {
        line = combined;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitText(element, value, backgroundColor) {
  if (!TEXT_IDS.has(element.getAttribute("id"))) return;
  const width = positiveSlotSize(element, "data-width");
  const height = positiveSlotSize(element, "data-height");
  const x = finiteAttribute(element, "x");
  const y = finiteAttribute(element, "y");
  if (width === null || height === null || x === null || y === null) return;

  const margin = slotMargin(element);
  const availableWidth = Math.max(1, width - margin * 2);
  const availableHeight = Math.max(1, height - margin * 2);
  const baseSize =
    positiveSlotSize(element, "data-font-size") ??
    positiveSlotSize(element, "font-size") ??
    24;
  const text = String(value ?? "");
  let fontSize = baseSize;
  let lines = wrapText(text, availableWidth, fontSize);
  let lineHeight = fontSize * 1.2;

  while (fontSize > 1 && lines.length * lineHeight > availableHeight) {
    fontSize = Math.max(1, fontSize - Math.max(0.5, baseSize / 24));
    lines = wrapText(text, availableWidth, fontSize);
    lineHeight = fontSize * 1.2;
  }

  while (element.firstChild) element.removeChild(element.firstChild);
  element.setAttribute("font-size", String(Number(fontSize.toFixed(2))));
  element.setAttribute("x", String(x + margin));
  element.setAttribute("y", String(y + margin));
  element.setAttribute("dominant-baseline", "hanging");
  setFill(element, ensureTextContrast(
    element.getAttribute("fill") || "#000000",
    backgroundColor,
  ));

  for (const [index, line] of lines.entries()) {
    const tspan = element.ownerDocument.createElementNS(SVG_NAMESPACE, "tspan");
    tspan.setAttribute("x", String(x + margin));
    tspan.setAttribute("dy", index === 0 ? "0" : String(lineHeight));
    if (estimateTextWidth(line, fontSize) > availableWidth) {
      tspan.setAttribute("textLength", String(availableWidth));
      tspan.setAttribute("lengthAdjust", "spacingAndGlyphs");
    }
    tspan.textContent = line;
    element.appendChild(tspan);
  }
}

function setImageSource(element, dataUri) {
  if (!dataUri || element.localName?.toLowerCase() !== "image") return;
  const x = finiteAttribute(element, "x");
  const y = finiteAttribute(element, "y");
  const width = positiveSlotSize(element, "width");
  const height = positiveSlotSize(element, "height");
  if (x === null || y === null || width === null || height === null) return;

  const margin = Math.min(slotMargin(element), width / 2, height / 2);
  element.setAttribute("x", String(x + margin));
  element.setAttribute("y", String(y + margin));
  element.setAttribute("width", String(width - margin * 2));
  element.setAttribute("height", String(height - margin * 2));
  element.setAttribute("preserveAspectRatio", "xMidYMid meet");
  element.setAttribute("href", dataUri);
  element.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", dataUri);
}

export function personalizeSvg({
  sourceSvg,
  palette,
  text,
  logoDataUri,
  imageDataUri,
}) {
  const { document, root } = parseSvg(sourceSvg);
  const colors = paletteColors(palette);
  applyColors(document, root, colors);

  for (const [id, field] of TEXT_SLOTS) {
    const slot = findSlot(document, id);
    if (slot) fitText(slot, text[field] ?? "", colors.background);
  }
  for (const [id, field] of IMAGE_SLOTS) {
    const slot = findSlot(document, id);
    if (slot) setImageSource(slot, field === "logo" ? logoDataUri : imageDataUri);
  }

  return new XMLSerializer().serializeToString(root);
}
