import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import sharp from "sharp";
import {
  getPostRequests,
  type StoredPostRequest,
} from "@/lib/post-requests";
import { getTemplates, sanitizeSvg } from "@/lib/templates";
import { personalizeSvg } from "@/lib/svg-slots.mjs";
const MAX_PNG_PIXELS = 16_000_000;
const MAX_PNG_DIMENSION = 4096;

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9A-F]{6}$/i.test(value);
}

function getAssetPath(
  postRequest: StoredPostRequest,
  assetPath: string,
): string {
  const storageDirectory = resolve(process.cwd(), "storage");
  const resolvedPath = resolve(storageDirectory, assetPath);
  const relativePath = relative(storageDirectory, resolvedPath);
  if (
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error("La ruta de imagen está fuera del almacenamiento permitido.");
  }
  return resolvedPath;
}

export async function renderPostRequestPng(requestId: string): Promise<{
  png: Buffer;
  svg: string;
  templateId: string;
}> {
  const [requests, templates] = await Promise.all([
    getPostRequests(),
    getTemplates(),
  ]);
  const postRequest = requests.find(
    (candidate) => candidate.requestId === requestId,
  );
  if (!postRequest) {
    throw new Error("No se encontró la solicitud de post.");
  }

  const template = templates.find(
    (candidate) => candidate.template_id === postRequest.templateId,
  );
  if (!template) {
    throw new Error("La plantilla de la solicitud ya no está disponible.");
  }
  if (
    postRequest.brand.palette.length < 1 ||
    postRequest.brand.palette.length > 4 ||
    !postRequest.brand.palette.every(isHexColor)
  ) {
    throw new Error("La paleta guardada no contiene de 1 a 4 colores HEX válidos.");
  }

  const sanitizedSvg = sanitizeSvg(template.svg);
  const logoPng = await readFile(
    getAssetPath(postRequest, postRequest.brand.logoPath),
  );
  const imagePath = postRequest.brand.moodboardPaths[0];
  const imagePng = imagePath
    ? await readFile(getAssetPath(postRequest, imagePath))
    : undefined;
  const personalizedSvg = personalizeSvg({
    sourceSvg: sanitizedSvg,
    palette: postRequest.brand.palette,
    text: postRequest.post,
    logoDataUri: `data:image/png;base64,${logoPng.toString("base64")}`,
    ...(imagePng
      ? { imageDataUri: `data:image/png;base64,${imagePng.toString("base64")}` }
      : {}),
  });

  const image = sharp(Buffer.from(personalizedSvg), {
    limitInputPixels: MAX_PNG_PIXELS,
  });
  const metadata = await image.metadata();
  if (
    metadata.width &&
    metadata.height &&
    (metadata.width > MAX_PNG_DIMENSION ||
      metadata.height > MAX_PNG_DIMENSION ||
      metadata.width * metadata.height > MAX_PNG_PIXELS)
  ) {
    throw new Error("Las dimensiones del SVG superan el límite de exportación.");
  }

  const png = await image.png().toBuffer();
  return { png, svg: personalizedSvg, templateId: template.template_id };
}
