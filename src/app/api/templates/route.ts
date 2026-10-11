import { NextResponse } from "next/server";
import { isValidPublicKey } from "@/lib/stellar-payment";
import { getTemplates, sanitizeSvg, saveTemplate } from "@/lib/templates";
import { getDetectedSlots } from "@/lib/svg-slots.mjs";
import { TEMPLATE_SLOT_IDS } from "@/lib/template-ids";

const SUPPORTED_TEMPLATE_SLOTS = new Set<string>(TEMPLATE_SLOT_IDS);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const templates = await getTemplates();
    return NextResponse.json({ templates });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo leer la galería.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "El formulario multipart no es válido." },
      { status: 400 },
    );
  }

  const designerName = form.get("designerName");
  const designerPublicKey = form.get("designerPublicKey");
  const title = form.get("title");
  const file = form.get("svg");
  if (
    typeof designerName !== "string" ||
    typeof designerPublicKey !== "string" ||
    typeof title !== "string" ||
    !(file instanceof File)
  ) {
    return NextResponse.json(
      { error: "Completa todos los campos y selecciona un archivo SVG." },
      { status: 400 },
    );
  }

  const normalizedName = designerName.trim();
  const normalizedTitle = title.trim();
  if (normalizedName.length < 2 || normalizedName.length > 80) {
    return NextResponse.json(
      { error: "El nombre debe tener entre 2 y 80 caracteres." },
      { status: 400 },
    );
  }
  if (normalizedTitle.length < 2 || normalizedTitle.length > 120) {
    return NextResponse.json(
      { error: "El título debe tener entre 2 y 120 caracteres." },
      { status: 400 },
    );
  }
  if (!isValidPublicKey(designerPublicKey.trim())) {
    return NextResponse.json(
      { error: "La wallet debe ser una dirección pública Stellar válida (G...)."},
      { status: 400 },
    );
  }
  if (!file.name.toLowerCase().endsWith(".svg")) {
    return NextResponse.json(
      { error: "El archivo debe tener extensión .svg." },
      { status: 400 },
    );
  }
  if (file.size === 0 || file.size > 2 * 1024 * 1024) {
    return NextResponse.json(
      { error: "El SVG debe pesar entre 1 byte y 2 MB." },
      { status: 413 },
    );
  }

  let svg: string;
  try {
    svg = sanitizeSvg(await file.text());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "El SVG no pudo validarse.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const template = await saveTemplate({
      title: normalizedTitle,
      designerName: normalizedName,
      designerPublicKey: designerPublicKey.trim(),
      svg,
    });
    return NextResponse.json(
      {
        template,
        detectedSlots: getDetectedSlots(svg).filter((slot) =>
          SUPPORTED_TEMPLATE_SLOTS.has(slot),
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo guardar la plantilla.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
