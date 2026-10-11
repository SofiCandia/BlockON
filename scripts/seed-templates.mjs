import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDetectedSlots } from "../src/lib/svg-slots.mjs";

const ROOT = process.cwd();
const STORAGE = join(ROOT, "storage");
const SEED_TEMPLATES = [
  {
    id: "seed-cafe-001",
    title: "Promo café",
    file: "cafe.svg",
    designerIndex: 0,
  },
  {
    id: "seed-evento-002",
    title: "Música en vivo",
    file: "evento.svg",
    designerIndex: 1,
  },
  {
    id: "seed-cuidado-003",
    title: "Ritual botánico",
    file: "cuidado.svg",
    designerIndex: 0,
  },
];
const REQUIRED_COLOR_SLOTS = new Set([
  "slot-bg",
  "slot-color-primary",
  "slot-color-secondary",
  "slot-color-accent",
  "slot-color-text",
]);

async function readOptionalFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function main() {
  const designersContents = await readOptionalFile(
    join(STORAGE, "designers.json"),
  );
  if (!designersContents) {
    throw new Error("Ejecuta npm run testnet:setup antes de seed:templates.");
  }

  const designers = JSON.parse(designersContents);
  if (!Array.isArray(designers) || designers.length !== 2) {
    throw new Error("storage/designers.json no contiene las dos wallets de demo.");
  }

  const templatesPath = join(STORAGE, "templates.json");
  const templatesContents = await readOptionalFile(templatesPath);
  const templates = templatesContents ? JSON.parse(templatesContents) : [];
  if (!Array.isArray(templates)) {
    throw new Error("storage/templates.json debe contener un arreglo JSON.");
  }

  let added = 0;
  let updated = 0;
  for (const seed of SEED_TEMPLATES) {
    const designer = designers[seed.designerIndex];
    if (
      !designer ||
      typeof designer.name !== "string" ||
      typeof designer.publicKey !== "string"
    ) {
      throw new Error(`No hay wallet válida para ${seed.title}.`);
    }

    const svg = await readFile(
      join(ROOT, "data", "seed-templates", seed.file),
      "utf8",
    );
    const slots = getDetectedSlots(svg);
    if (
      !slots.includes("slot-title") ||
      !slots.some((slot) => REQUIRED_COLOR_SLOTS.has(slot))
    ) {
      throw new Error(`${seed.file} debe incluir slot-title y al menos un slot de color.`);
    }

    const svgHash = createHash("sha256").update(svg, "utf8").digest("hex");
    const existingIndex = templates.findIndex(
      (template) => template.template_id === seed.id,
    );
    if (existingIndex >= 0) {
      if (templates[existingIndex].svgHash !== svgHash) {
        templates[existingIndex] = {
          ...templates[existingIndex],
          title: seed.title,
          svgHash,
          svg,
        };
        updated += 1;
      }
      continue;
    }

    templates.push({
      template_id: seed.id,
      title: seed.title,
      designerName: designer.name,
      designerPublicKey: designer.publicKey,
      svgHash,
      createdAt: new Date().toISOString(),
      svg,
    });
    added++;
  }

  await mkdir(STORAGE, { recursive: true });
  await writeFile(templatesPath, `${JSON.stringify(templates, null, 2)}\n`, {
    encoding: "utf8",
  });
  console.log(
    `Plantillas seed añadidas: ${added}; actualizadas: ${updated}. Total disponible: ${templates.length}.`,
  );
}

main().catch((error) => {
  console.error(`Error cargando plantillas seed: ${error.message}`);
  process.exitCode = 1;
});
