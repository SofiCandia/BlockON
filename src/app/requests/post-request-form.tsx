"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

interface Template {
  template_id: string;
  title: string;
  designerName: string;
  designerPublicKey: string;
  svgHash: string;
  createdAt: string;
  svg: string;
}

interface SavedRequest {
  requestId: string;
  templateId: string;
  createdAt: string;
  message: string;
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

function isSavedRequest(value: unknown): value is SavedRequest {
  return (
    isRecord(value) &&
    typeof value.requestId === "string" &&
    typeof value.templateId === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.message === "string"
  );
}

async function loadTemplates(response: Response): Promise<Template[]> {
  const payload: unknown = await response.json();
  if (
    !response.ok ||
    !isRecord(payload) ||
    !Array.isArray(payload.templates) ||
    !payload.templates.every(isTemplate)
  ) {
    const error =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "No se pudieron cargar las plantillas.";
    throw new Error(error);
  }
  return payload.templates;
}

export default function PostRequestForm() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [palette, setPalette] = useState(["#4338CA"]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedRequest, setSavedRequest] = useState<SavedRequest | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/templates")
      .then(loadTemplates)
      .then((loaded) => {
        if (active) {
          setTemplates(loaded);
          setSelectedTemplate(loaded[0]?.template_id ?? "");
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "No se pudieron cargar las plantillas.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSavedRequest(null);
    setBusy(true);
    try {
      const formData = new FormData(event.currentTarget);
      formData.set("templateId", selectedTemplate);
      formData.delete("palette");
      palette.forEach((color) => formData.append("palette", color));

      const response = await fetch("/api/post-requests", {
        method: "POST",
        body: formData,
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "No se pudo guardar la solicitud.";
        throw new Error(message);
      }
      if (!isSavedRequest(payload)) {
        throw new Error("El servidor devolvió una solicitud inválida.");
      }
      setSavedRequest(payload);
      window.dispatchEvent(
        new CustomEvent("postmarca:request-created", {
          detail: { requestId: payload.requestId },
        }),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo guardar la identidad y el post.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6 px-6">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-700">
          Emprendedores
        </p>
        <h2 className="text-2xl font-bold tracking-tight text-slate-950">
          Identidad de marca y contenido
        </h2>
        <p className="text-sm text-slate-600">
          El logo y las fotos se guardan localmente como PNG; se admiten imágenes
          PNG, JPEG o WebP. El sistema aplicará automáticamente los colores,
          textos y logo sobre la plantilla seleccionada.
        </p>
      </header>

      <form
        className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        onSubmit={submit}
      >
        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-slate-950">
            Marca
          </legend>
          <label className="block text-sm font-medium text-slate-800">
            Logo (PNG, JPEG o WebP; máximo 5 MB)
            <input
              accept="image/png,image/jpeg,image/webp"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              name="logo"
              required
              type="file"
            />
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-slate-800">
                Paleta de colores (1 a 4)
              </p>
              <button
                className="text-sm font-semibold text-indigo-700 disabled:text-slate-400"
                disabled={palette.length >= 4}
                onClick={() => setPalette([...palette, "#000000"])}
                type="button"
              >
                Añadir color
              </button>
            </div>
            <div className="flex flex-wrap gap-3">
              {palette.map((color, index) => (
                <div className="flex items-center gap-2" key={index}>
                  <input
                    aria-label={`Color ${index + 1}`}
                    className="h-10 w-14 cursor-pointer rounded border border-slate-300"
                    name="palette"
                    onChange={(event) =>
                      setPalette(
                        palette.map((current, colorIndex) =>
                          colorIndex === index ? event.target.value : current,
                        ),
                      )
                    }
                    required
                    type="color"
                    value={color}
                  />
                  <span className="font-mono text-xs">{color}</span>
                  {palette.length > 1 && (
                    <button
                      aria-label={`Quitar color ${index + 1}`}
                      className="text-sm text-rose-700"
                      onClick={() =>
                        setPalette(palette.filter((_, colorIndex) => colorIndex !== index))
                      }
                      type="button"
                    >
                      Quitar
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <label className="block text-sm font-medium text-slate-800">
            Moodboard o fotos (opcional, hasta 3; máximo 5 MB cada una)
            <input
              accept="image/png,image/jpeg,image/webp"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              multiple
              name="moodboard"
              type="file"
            />
          </label>

          <label className="block text-sm font-medium text-slate-800">
            Estilo
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              defaultValue="minimalista"
              name="style"
            >
              <option value="minimalista">Minimalista</option>
              <option value="colorido">Colorido</option>
              <option value="elegante">Elegante</option>
              <option value="juvenil">Juvenil</option>
            </select>
          </label>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold text-slate-950">
            Post
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-800">
              Título
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                maxLength={100}
                name="postTitle"
                required
              />
            </label>
            <label className="text-sm font-medium text-slate-800">
              Precio
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                maxLength={40}
                name="price"
                placeholder="$10.00"
                required
              />
            </label>
          </div>
          <label className="block text-sm font-medium text-slate-800">
            Slogan
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              maxLength={160}
              name="slogan"
              required
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-800">
              Ocasión
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                maxLength={80}
                name="occasion"
                required
              />
            </label>
            <label className="text-sm font-medium text-slate-800">
              Elemento adicional
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                maxLength={100}
                name="extra"
                required
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-lg font-semibold text-slate-950">
            Elige una plantilla
          </legend>
          {templates.length === 0 ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Cargando plantillas o galería vacía. Primero sube o carga una plantilla.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {templates.map((template) => (
                <label
                  className={`cursor-pointer overflow-hidden rounded-xl border p-2 ${
                    selectedTemplate === template.template_id
                      ? "border-indigo-600 ring-2 ring-indigo-200"
                      : "border-slate-200"
                  }`}
                  key={template.template_id}
                >
                  <input
                    checked={selectedTemplate === template.template_id}
                    className="sr-only"
                    name="templateId"
                    onChange={() => setSelectedTemplate(template.template_id)}
                    required
                    type="radio"
                    value={template.template_id}
                  />
                  <Image
                    alt={`Plantilla: ${template.title}`}
                    className="aspect-square w-full rounded-lg bg-slate-100 object-contain"
                    height={220}
                    src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(template.svg)}`}
                    unoptimized
                    width={220}
                  />
                  <span className="mt-2 block text-sm font-semibold text-slate-900">
                    {template.title}
                  </span>
                  <span className="block text-xs text-slate-600">
                    {template.designerName}
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <button
          className="w-full rounded-lg bg-indigo-700 px-4 py-3 font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || templates.length === 0}
          type="submit"
        >
          {busy ? "Guardando solicitud…" : "Guardar identidad y post"}
        </button>

        {error && (
          <p
            aria-live="polite"
            className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800"
            role="alert"
          >
            {error}
          </p>
        )}
        {savedRequest && (
          <p
            aria-live="polite"
            className="break-all rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"
          >
            {savedRequest.message} ID de solicitud: {savedRequest.requestId}
          </p>
        )}
      </form>
    </section>
  );
}
