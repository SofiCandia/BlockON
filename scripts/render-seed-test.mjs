import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { personalizeSvg } from "../src/lib/svg-slots.mjs";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = join(root, "data", "seed-templates", "cafe.svg");
const outputDirectory = join(root, "test-output");
const outputPath = join(outputDirectory, "postmarca-seed-test.png");
const logoPath = join(outputDirectory, "postmarca-test-logo.png");
const palette = ["#243B53", "#D64550", "#F0B429", "#F5F0E8"];

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const logoSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="120">' +
      '<rect width="280" height="120" rx="24" fill="#243B53"/>' +
      '<text x="140" y="76" text-anchor="middle" font-size="38" ' +
      'font-family="Arial" font-weight="bold" fill="#FFFFFF">MARCA</text>' +
      "</svg>",
  );
  const logoPng = await sharp(logoSvg).png().toBuffer();
  await sharp(logoPng).toFile(logoPath);

  const source = await readFile(templatePath, "utf8");
  const personalizedSvg = Buffer.from(personalizeSvg({
    sourceSvg: source,
    palette,
    text: {
      title: "PANADERIA DEL BARRIO",
      slogan: "Hecho fresco cada mañana",
      price: "$4.50",
      occasion: "OFERTA DE PRUEBA",
      extra: "Pan artesanal y cafe",
    },
    logoDataUri: `data:image/png;base64,${logoPng.toString("base64")}`,
  }));
  await sharp(personalizedSvg).png().toFile(outputPath);
  const metadata = await sharp(outputPath).metadata();
  if (metadata.format !== "png" || !metadata.width || !metadata.height) {
    throw new Error("La salida generada no es un PNG válido.");
  }

  console.log(`PNG de prueba: ${outputPath}`);
  console.log(`Logo de prueba: ${logoPath}`);
  console.log(`Dimensiones: ${metadata.width} x ${metadata.height}`);
  console.log(`Paleta aplicada: ${palette.join(", ")}`);
}

main().catch((error) => {
  console.error(
    `No se pudo generar el PNG seed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
