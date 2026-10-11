"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { TEMPLATE_SLOT_IDS } from "@/lib/template-ids";

interface Template {
  template_id: string;
  title: string;
  designerName: string;
  designerPublicKey: string;
  svgHash: string;
  createdAt: string;
  svg: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTemplate(value: unknown): value is Template {
  return (
    isRecord(value) &&
    typeof value.template_id === "string" &&
    typeof value.title === "string" &&
    typeof value.designerName === "string" &&
    typeof value.designerPublicKey === "string" &&
    typeof value.svgHash === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.svg === "string"
  );
}

async function parseTemplateResponse(response: Response): Promise<Template[]> {
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "No se pudo cargar la galería.";
    throw new Error(message);
  }
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.templates) ||
    !payload.templates.every(isTemplate)
  ) {
    throw new Error("El servidor devolvió una galería inválida.");
  }
  return payload.templates;
}

function parseUploadedTemplate(
  payload: unknown,
): { template: Template; detectedSlots: string[] } {
  if (
    isRecord(payload) &&
    isTemplate(payload.template) &&
    Array.isArray(payload.detectedSlots) &&
    payload.detectedSlots.every((slot) => typeof slot === "string")
  ) {
    return { template: payload.template, detectedSlots: payload.detectedSlots };
  }
  throw new Error("El servidor devolvió una plantilla inválida.");
}

export default function TemplateManager() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [designerName, setDesignerName] = useState("");
  const [designerPublicKey, setDesignerPublicKey] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [detectedSlots, setDetectedSlots] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refreshTemplates() {
    const response = await fetch("/api/templates");
    setTemplates(await parseTemplateResponse(response));
  }

  useEffect(() => {
    let active = true;
    fetch("/api/templates")
      .then(parseTemplateResponse)
      .then((loadedTemplates) => {
        if (active) setTemplates(loadedTemplates);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Error al cargar plantillas.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError("");
    setMessage("");
    setDetectedSlots([]);
    if (!file) {
      setError("Selecciona un archivo SVG.");
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.set("designerName", designerName);
      form.set("designerPublicKey", designerPublicKey);
      form.set("title", title);
      form.set("svg", file);

      const response = await fetch("/api/templates", {
        method: "POST",
        body: form,
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "No se pudo subir la plantilla.";
        throw new Error(message);
      }

      const uploaded = parseUploadedTemplate(payload);
      setDetectedSlots(uploaded.detectedSlots);
      setMessage(`Plantilla guardada. Hash SHA-256: ${uploaded.template.svgHash}`);
      setTitle("");
      setFile(null);
      formElement.reset();
      await refreshTemplates();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Error al subir el SVG.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6 px-6 pt-10">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-700">
          Diseñadores
        </p>
        <h2 className="text-2xl font-bold tracking-tight text-slate-950">
          Sube una plantilla SVG
        </h2>
        <p className="text-sm text-slate-600">
          El diseñador crea la plantilla SVG. Su wallet y el hash del SVG sanitizado quedan registrados junto a ella.
        </p>
      </header>

      <form
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        onSubmit={upload}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-800">
            Nombre del diseñador
            <input
              autoComplete="name"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              maxLength={80}
              onChange={(event) => setDesignerName(event.target.value)}
              required
              value={designerName}
            />
          </label>
          <label className="text-sm font-medium text-slate-800">
            Wallet pública Stellar (G...)
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
              maxLength={56}
              onChange={(event) => setDesignerPublicKey(event.target.value)}
              placeholder="G..."
              required
              value={designerPublicKey}
            />
          </label>
        </div>
        <label className="block text-sm font-medium text-slate-800">
          Título de la plantilla
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            required
            value={title}
          />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Archivo SVG (máximo 2 MB)
          <input
            accept=".svg,image/svg+xml"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
            type="file"
          />
        </label>

        <div className="rounded-xl bg-indigo-50 p-4">
          <p className="text-sm font-semibold text-indigo-950">
            Slots disponibles
          </p>
          <p className="mt-2 flex flex-wrap gap-2">
            {TEMPLATE_SLOT_IDS.map((id) => (
              <code
                className="rounded bg-white px-2 py-1 text-xs text-indigo-900"
                key={id}
              >
                {id}
              </code>
            ))}
          </p>
        </div>

        <button
          className="w-full rounded-lg bg-indigo-700 px-4 py-3 font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
          {busy ? "Validando y guardando…" : "Subir plantilla"}
        </button>
        {message && (
          <p aria-live="polite" className="break-all text-sm text-emerald-800">
            {message}
          </p>
        )}
        {detectedSlots.length > 0 && (
          <p aria-live="polite" className="text-sm text-slate-700">
            Slots detectados:{" "}
            {detectedSlots.map((slot) => (
              <code className="mr-2 rounded bg-slate-100 px-1" key={slot}>
                {slot}
              </code>
            ))}
          </p>
        )}
        {error && (
          <p
            aria-live="polite"
            className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800"
            role="alert"
          >
            {error}
          </p>
        )}
      </form>

      <div className="space-y-4">
        <div>
          <h3 className="text-xl font-bold text-slate-950">Galería</h3>
          <p className="text-sm text-slate-600">
            Previsualización de los SVG validados en el servidor.
          </p>
        </div>
        {templates.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">
            Aún no hay plantillas. Ejecuta <code>npm run seed:templates</code> o sube la primera.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {templates.map((template) => (
              <article
                className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                key={template.template_id}
              >
                <Image
                  alt={`Vista previa: ${template.title}`}
                  className="aspect-square w-full bg-slate-100 object-contain"
                  height={360}
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(template.svg)}`}
                  unoptimized
                  width={360}
                />
                <div className="space-y-1 p-4">
                  <h4 className="font-semibold text-slate-950">{template.title}</h4>
                  <p className="text-sm text-slate-600">
                    {template.designerName} · {template.designerPublicKey.slice(0, 8)}…
                  </p>
                  <p className="break-all font-mono text-[10px] text-slate-500">
                    ID: {template.template_id}
                  </p>
                  <p className="break-all font-mono text-[10px] text-slate-500">
                    SHA-256: {template.svgHash}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
