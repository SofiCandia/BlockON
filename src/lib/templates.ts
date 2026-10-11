import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { TEMPLATE_SLOT_IDS } from "@/lib/template-ids";
import { getDetectedSlots } from "@/lib/svg-slots.mjs";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MAX_SVG_BYTES = 2 * 1024 * 1024;
const TEMPLATE_SLOTS = new Set<string>(TEMPLATE_SLOT_IDS);
const COLOR_SLOT_IDS = new Set([
  "slot-bg",
  "slot-color-primary",
  "slot-color-secondary",
  "slot-color-accent",
  "slot-color-text",
]);
const COLOR_SLOT_ROLES = new Map([
  ["slot-bg", "background"],
  ["slot-color-primary", "primary"],
  ["slot-color-secondary", "secondary"],
  ["slot-color-accent", "accent"],
  ["slot-color-text", "text"],
]);
const TEXT_SLOT_IDS = new Set([
  "slot-title",
  "slot-slogan",
  "slot-price",
  "slot-occasion",
  "slot-extra",
]);
const IMAGE_SLOT_IDS = new Set(["slot-logo", "slot-image"]);

export interface TemplateRecord {
  template_id: string;
  title: string;
  designerName: string;
  designerPublicKey: string;
  svgHash: string;
  createdAt: string;
  svg: string;
}

function isTemplateRecord(value: unknown): value is TemplateRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "template_id" in value &&
    typeof value.template_id === "string" &&
    "title" in value &&
    typeof value.title === "string" &&
    "designerName" in value &&
    typeof value.designerName === "string" &&
    "designerPublicKey" in value &&
    typeof value.designerPublicKey === "string" &&
    "svgHash" in value &&
    typeof value.svgHash === "string" &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "svg" in value &&
    typeof value.svg === "string"
  );
}

export function sanitizeSvg(source: string): string {
  if (Buffer.byteLength(source, "utf8") > MAX_SVG_BYTES) {
    throw new Error("El SVG supera el límite de 2 MB.");
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new Error("El SVG no puede declarar DOCTYPE ni entidades XML.");
  }

  const parseErrors: string[] = [];
  const document = new DOMParser({
    onError(level, message) {
      if (level !== "warning") parseErrors.push(message);
    },
  }).parseFromString(source, "image/svg+xml");
  if (parseErrors.length > 0) {
    throw new Error(`El archivo no es XML/SVG válido: ${parseErrors[0]}`);
  }

  const root = document.documentElement;
  if (!root || root.localName?.toLowerCase() !== "svg") {
    throw new Error("El documento debe tener un elemento raíz <svg>.");
  }
  const namespace = root.getAttribute("xmlns");
  if (namespace && namespace !== SVG_NAMESPACE) {
    throw new Error("El elemento raíz no pertenece al namespace SVG.");
  }
  root.setAttribute("xmlns", SVG_NAMESPACE);

  const elements = [root, ...Array.from(root.getElementsByTagName("*"))];
  for (const element of elements) {
    const elementName = (element.localName ?? element.tagName).toLowerCase();
    if (elementName === "script" || elementName === "foreignobject") {
      element.parentNode?.removeChild(element);
      continue;
    }

    if (
      elementName === "style" &&
      /@import|url\s*\(|expression\s*\(|javascript\s*:/i.test(
        element.textContent ?? "",
      )
    ) {
      element.parentNode?.removeChild(element);
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase();
      if (
        /^on/i.test(attribute.name) ||
        ((attributeName === "href" || attributeName.endsWith(":href")) &&
          !attribute.value.trim().startsWith("#") &&
          !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(
            attribute.value.trim(),
          )) ||
        (attributeName === "style" &&
          /url\s*\(|expression\s*\(|javascript\s*:/i.test(attribute.value))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  const sanitizedSvg = new XMLSerializer().serializeToString(root);
  const detectedSlots = getDetectedSlots(sanitizedSvg).filter((slot) =>
    TEMPLATE_SLOTS.has(slot),
  );
  const namedElements = [
    root,
    ...Array.from(root.getElementsByTagName("*")),
  ].filter((element) =>
    detectedSlots.includes(element.getAttribute("id") ?? ""),
  );
  for (const element of namedElements) {
    const id = element.getAttribute("id");
    if (!id) continue;
    const elementName = (element.localName ?? element.tagName).toLowerCase();
    if (
      COLOR_SLOT_ROLES.has(id) &&
      element.getAttribute("data-color-role") !== COLOR_SLOT_ROLES.get(id)
    ) {
      throw new Error(
        `El slot ${id} debe declarar su data-color-role correspondiente.`,
      );
    }
    if (TEXT_SLOT_IDS.has(id) && elementName !== "text") {
      throw new Error(`El slot ${id} debe ser un elemento <text>.`);
    }
    if (IMAGE_SLOT_IDS.has(id) && elementName !== "image") {
      throw new Error(`El slot ${id} debe ser un elemento <image>.`);
    }
    const dimensions =
      TEXT_SLOT_IDS.has(id)
        ? ["data-width", "data-height"]
        : IMAGE_SLOT_IDS.has(id)
          ? ["width", "height"]
          : [];
    const hasPosition = ["x", "y"].every((attribute) => {
      const value = Number(element.getAttribute(attribute));
      return element.hasAttribute(attribute) && Number.isFinite(value);
    });
    const hasDimensions = dimensions.every((attribute) => {
      const value = Number(element.getAttribute(attribute));
      return element.hasAttribute(attribute) && Number.isFinite(value) && value > 0;
    });
    const fontSize = Number(
      element.getAttribute("data-font-size") ?? element.getAttribute("font-size"),
    );
    if (
      (TEXT_SLOT_IDS.has(id) || IMAGE_SLOT_IDS.has(id)) &&
      (!hasPosition ||
        !hasDimensions ||
        (TEXT_SLOT_IDS.has(id) && (!Number.isFinite(fontSize) || fontSize <= 0)))
    ) {
      throw new Error(
        `El slot ${id} debe definir una posición y un rectángulo útil válidos.`,
      );
    }
    if (element.hasAttribute("data-margin")) {
      const margin = Number(element.getAttribute("data-margin"));
      if (!Number.isFinite(margin) || margin < 0) {
        throw new Error(`El slot ${id} debe tener un data-margin no negativo.`);
      }
    }
  }
  if (!detectedSlots.includes("slot-title")) {
    throw new Error("La plantilla debe incluir el slot slot-title.");
  }
  if (!detectedSlots.some((slot) => COLOR_SLOT_IDS.has(slot))) {
    throw new Error(
      "La plantilla debe incluir al menos un slot de color (slot-bg o slot-color-*).",
    );
  }
  return sanitizedSvg;
}

function getTemplatesFile(): string {
  return join(process.cwd(), "storage", "templates.json");
}

export async function getTemplates(): Promise<TemplateRecord[]> {
  let contents: string;
  try {
    contents = await readFile(getTemplatesFile(), "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  const parsed: unknown = JSON.parse(contents);
  if (!Array.isArray(parsed) || !parsed.every(isTemplateRecord)) {
    throw new Error("El archivo local de plantillas tiene un formato inválido.");
  }
  return parsed;
}

export async function saveTemplate(input: {
  title: string;
  designerName: string;
  designerPublicKey: string;
  svg: string;
}): Promise<TemplateRecord> {
  const templates = await getTemplates();
  const template: TemplateRecord = {
    template_id: randomUUID(),
    title: input.title,
    designerName: input.designerName,
    designerPublicKey: input.designerPublicKey,
    svgHash: createHash("sha256").update(input.svg, "utf8").digest("hex"),
    createdAt: new Date().toISOString(),
    svg: input.svg,
  };

  await mkdir(join(process.cwd(), "storage"), { recursive: true });
  templates.push(template);
  await writeFile(getTemplatesFile(), `${JSON.stringify(templates, null, 2)}\n`, {
    encoding: "utf8",
  });
  return template;
}
