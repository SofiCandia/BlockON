import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { getTemplates } from "@/lib/templates";
import {
  getPostRequests,
  isBrandStyle,
  savePostRequest,
  type StoredPostRequest,
} from "@/lib/post-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_INPUT_PIXELS = 16_000_000;

export async function GET() {
  try {
    const [requests, templates] = await Promise.all([
      getPostRequests(),
      getTemplates(),
    ]);
    return NextResponse.json({
      requests: requests.map((postRequest) => {
        const template = templates.find(
          (candidate) => candidate.template_id === postRequest.templateId,
        );
        return {
          requestId: postRequest.requestId,
          templateId: postRequest.templateId,
          templateTitle: template?.title ?? "Plantilla no disponible",
          designerName: template?.designerName ?? "Diseñador desconocido",
          status: postRequest.status,
          paymentHash: postRequest.paymentHash ?? null,
          createdAt: postRequest.createdAt,
        };
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudieron leer las solicitudes.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function normalizeImage(file: File): Promise<Buffer> {
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("Cada imagen debe pesar entre 1 byte y 5 MB.");
  }

  const pipeline = sharp(Buffer.from(await file.arrayBuffer()), {
    limitInputPixels: MAX_INPUT_PIXELS,
  });
  const metadata = await pipeline.metadata();
  if (!["png", "jpeg", "webp"].includes(metadata.format ?? "")) {
    throw new Error("Solo se aceptan imágenes PNG, JPEG o WebP.");
  }

  return pipeline
    .rotate()
    .resize({
      width: 2048,
      height: 2048,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "El formulario de marca y post no es válido." },
      { status: 400 },
    );
  }

  const title = field(form, "postTitle");
  const slogan = field(form, "slogan");
  const price = field(form, "price");
  const occasion = field(form, "occasion");
  const extra = field(form, "extra");
  const templateId = field(form, "templateId");
  const style = field(form, "style");
  const logo = form.get("logo");
  const colors = form.getAll("palette");
  const palette = colors
    .filter((color): color is string => typeof color === "string")
    .map((color) => color.trim().toUpperCase());
  const moodboardEntries = form.getAll("moodboard");
  const moodboard = moodboardEntries.filter(
    (file): file is File => file instanceof File && file.size > 0,
  );

  if (
    title.length < 1 ||
    title.length > 100 ||
    slogan.length > 160 ||
    price.length < 1 ||
    price.length > 40 ||
    occasion.length < 1 ||
    occasion.length > 80 ||
    extra.length < 1 ||
    extra.length > 100
  ) {
    return NextResponse.json(
      { error: "Revisa los campos del post y sus límites de longitud." },
      { status: 400 },
    );
  }
  if (
    !isBrandStyle(style) ||
    palette.length !== colors.length ||
    palette.length < 1 ||
    palette.length > 4 ||
    !palette.every((color) => /^#[0-9A-F]{6}$/.test(color))
  ) {
    return NextResponse.json(
      { error: "Elige un estilo válido y entre 1 y 4 colores HEX." },
      { status: 400 },
    );
  }
  if (!(logo instanceof File)) {
    return NextResponse.json(
      { error: "Selecciona el logo de la marca." },
      { status: 400 },
    );
  }
  if (moodboardEntries.some((file) => !(file instanceof File)) || moodboard.length > 3) {
    return NextResponse.json(
      { error: "El moodboard admite hasta 3 imágenes." },
      { status: 400 },
    );
  }
  const totalImageBytes =
    logo.size + moodboard.reduce((total, file) => total + file.size, 0);
  if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "El logo y el moodboard no pueden superar 12 MB en total." },
      { status: 413 },
    );
  }

  let normalizedImages: Buffer[];
  try {
    normalizedImages = await Promise.all([
      normalizeImage(logo),
      ...moodboard.map(normalizeImage),
    ]);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo validar una imagen.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const templates = await getTemplates();
    if (!templates.some((template) => template.template_id === templateId)) {
      return NextResponse.json(
        { error: "Selecciona una plantilla de la galería." },
        { status: 400 },
      );
    }

    const [logoPng, ...moodboardPngs] = normalizedImages;
    const requestId = randomUUID();
    const assetDirectory = join(
      process.cwd(),
      "storage",
      "brand-assets",
      requestId,
    );
    await mkdir(assetDirectory, { recursive: true });
    await writeFile(join(assetDirectory, "logo.png"), logoPng);
    const moodboardPaths: string[] = [];
    for (const [index, image] of moodboardPngs.entries()) {
      const filename = `moodboard-${index + 1}.png`;
      await writeFile(join(assetDirectory, filename), image);
      moodboardPaths.push(`brand-assets/${requestId}/${filename}`);
    }

    const postRequest: StoredPostRequest = {
      requestId,
      templateId,
      createdAt: new Date().toISOString(),
      status: "pendiente",
      brand: {
        logoPath: `brand-assets/${requestId}/logo.png`,
        palette,
        moodboardPaths,
        style,
      },
      post: { title, slogan, price, occasion, extra },
    };
    await savePostRequest(postRequest);

    return NextResponse.json(
      {
        requestId,
        templateId,
        createdAt: postRequest.createdAt,
        message: "Identidad de marca y post guardados.",
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo guardar el post.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
