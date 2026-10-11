import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import sharp from "sharp";
import {
  calculateContrastRatio,
  getDetectedSlots,
  personalizeSvg,
} from "../src/lib/svg-slots.mjs";

function template({ includeImageSlot = true } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" width="200" height="120">
    <rect id="slot-bg" data-slot="bg" data-color-role="background" width="200" height="120" fill="#FFFFFF"/>
    <rect id="slot-color-primary" data-slot="color-primary" data-color-role="primary" width="10" height="10" fill="#000000"/>
    <text id="slot-title" data-slot="title" x="10" y="5" data-width="120" data-height="52" data-font-size="30" fill="#FFFFFE">original</text>
    <image id="slot-logo" data-slot="logo" x="10" y="65" width="60" height="40" data-margin="2"/>
    ${includeImageSlot ? '<image id="slot-image" data-slot="image" x="100" y="65" width="80" height="40"/>' : ""}
  </svg>`;
}

function solidPng(width, height, color) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color,
    },
  }).png().toBuffer();
}

function renderSvg(svg) {
  return sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function pixelAt(image, x, y) {
  const offset = (y * image.info.width + x) * image.info.channels;
  return [...image.data.subarray(offset, offset + 3)];
}

function isRed(pixel) {
  return pixel[0] > 220 && pixel[1] < 50 && pixel[2] < 50;
}

function getElement(svg, id) {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  return Array.from(document.getElementsByTagName("*")).find(
    (element) => element.getAttribute("id") === id,
  );
}

function personalized({ sourceSvg, logoDataUri, imageDataUri }) {
  return personalizeSvg({
    sourceSvg,
    palette: ["#3050A0", "#E06030", "#FFFFFF", "#FFFFFE"],
    text: {
      title: "Un titulo deliberadamente muy largo para comprobar el ajuste automatico",
      slogan: "Un slogan",
      price: "$12.50",
      occasion: "Oferta",
      extra: "Detalle",
    },
    logoDataUri,
    imageDataUri,
  });
}

test("ajusta texto largo con varias líneas y reduce el tamaño de letra", async () => {
  const svg = personalized({
    sourceSvg: template(),
    logoDataUri: "",
  });
  const title = getElement(svg, "slot-title");
  const lines = Array.from(title.getElementsByTagName("tspan"));

  assert.ok(lines.length > 1);
  assert.ok(Number(title.getAttribute("font-size")) < 30);
  assert.equal(lines.map((line) => line.textContent).join(" ").includes("automatico"), true);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const rendered = await sharp(png).metadata();
  assert.equal(rendered.format, "png");
});

test("contiene un logo cuadrado en su slot sin deformarlo", async () => {
  const logo = await solidPng(20, 20, "#ff0000");
  const svg = personalized({
    sourceSvg: template({ includeImageSlot: false }),
    logoDataUri: `data:image/png;base64,${logo.toString("base64")}`,
  });
  const slot = getElement(svg, "slot-logo");
  const rendered = await renderSvg(svg);

  assert.equal(slot.getAttribute("preserveAspectRatio"), "xMidYMid meet");
  assert.equal(slot.getAttribute("width"), "56");
  assert.equal(slot.getAttribute("height"), "36");
  assert.equal(isRed(pixelAt(rendered, 40, 85)), true);
  assert.equal(isRed(pixelAt(rendered, 12, 85)), false);
  assert.equal(getElement(svg, "slot-image"), undefined);
});

test("contiene un logo apaisado en su slot sin deformarlo", async () => {
  const logo = await solidPng(40, 20, "#ff0000");
  const svg = personalized({
    sourceSvg: template({ includeImageSlot: false }),
    logoDataUri: `data:image/png;base64,${logo.toString("base64")}`,
  });
  const rendered = await renderSvg(svg);

  assert.equal(isRed(pixelAt(rendered, 40, 69)), false);
  assert.equal(isRed(pixelAt(rendered, 40, 80)), true);
  assert.equal(isRed(pixelAt(rendered, 40, 100)), false);
});

test("reemplaza texto de bajo contraste por negro o blanco accesible", () => {
  const svg = personalized({
    sourceSvg: template(),
    logoDataUri: "",
  });
  const title = getElement(svg, "slot-title");
  const fill = title.getAttribute("fill");

  assert.ok(["#000000", "#FFFFFF"].includes(fill));
  assert.ok(calculateContrastRatio(fill, "#FFFFFF") >= 4.5);
  assert.equal(getElement(svg, "slot-color-primary").getAttribute("fill"), "#3050A0");
});

test("renderiza sin slot de imagen y detecta los slots presentes", async () => {
  const sourceSvg = template({ includeImageSlot: false });
  const slots = getDetectedSlots(sourceSvg);
  const svg = personalized({
    sourceSvg,
    logoDataUri: "",
    imageDataUri: "data:image/png;base64,AA==",
  });

  assert.equal(slots.includes("slot-image"), false);
  assert.equal(slots.includes("slot-title"), true);
  assert.equal(getElement(svg, "slot-image"), undefined);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  assert.equal((await sharp(png).metadata()).format, "png");
});

test("las tres plantillas semilla cumplen el contrato mínimo de slots", async () => {
  const directory = fileURLToPath(
    new URL("../data/seed-templates/", import.meta.url),
  );
  for (const filename of ["cafe.svg", "evento.svg", "cuidado.svg"]) {
    const sourceSvg = await readFile(
      join(directory, filename),
      "utf8",
    );
    const slots = getDetectedSlots(sourceSvg);
    assert.ok(slots.includes("slot-title"), `${filename} debe tener slot-title`);
    assert.ok(
      slots.some((slot) =>
        [
          "slot-bg",
          "slot-color-primary",
          "slot-color-secondary",
          "slot-color-accent",
          "slot-color-text",
        ].includes(slot),
      ),
      `${filename} debe tener al menos un slot de color`,
    );
  }
});
