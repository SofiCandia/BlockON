"use client";

import { useEffect, useState } from "react";

interface DesignerOption {
  name: string;
  publicKey: string;
}

interface DesignerTemplate {
  template_id: string;
  title: string;
  svgHash: string;
  usageCount: number;
  earnedXlm: string;
}

interface DesignerSummary {
  designerPublicKey: string;
  templates: DesignerTemplate[];
  totalUses: number;
  totalEarnedXlm: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDesignerOptions(value: unknown): DesignerOption[] {
  if (
    !isRecord(value) ||
    !Array.isArray(value.templates) ||
    !value.templates.every(
      (template) =>
        isRecord(template) &&
        typeof template.designerName === "string" &&
        typeof template.designerPublicKey === "string",
    )
  ) {
    throw new Error("La respuesta de la galería de diseñadores no es válida.");
  }
  const unique = new Map<string, DesignerOption>();
  for (const template of value.templates) {
    if (
      !isRecord(template) ||
      typeof template.designerPublicKey !== "string" ||
      typeof template.designerName !== "string"
    ) {
      continue;
    }
    const publicKey = template.designerPublicKey;
    if (!unique.has(publicKey)) {
      unique.set(publicKey, {
        name: template.designerName,
        publicKey,
      });
    }
  }
  return Array.from(unique.values());
}

function parseSummary(value: unknown): DesignerSummary {
  if (
    !isRecord(value) ||
    typeof value.designerPublicKey !== "string" ||
    typeof value.totalUses !== "number" ||
    typeof value.totalEarnedXlm !== "string" ||
    !Array.isArray(value.templates) ||
    !value.templates.every(
      (template) =>
        isRecord(template) &&
        typeof template.template_id === "string" &&
        typeof template.title === "string" &&
        typeof template.svgHash === "string" &&
        typeof template.usageCount === "number" &&
        typeof template.earnedXlm === "string",
    )
  ) {
    throw new Error("El servidor devolvió un panel de diseñador inválido.");
  }
  return {
    designerPublicKey: value.designerPublicKey,
    totalUses: value.totalUses,
    totalEarnedXlm: value.totalEarnedXlm,
    templates: value.templates.map((template) => {
      if (
        !isRecord(template) ||
        typeof template.template_id !== "string" ||
        typeof template.title !== "string" ||
        typeof template.svgHash !== "string" ||
        typeof template.usageCount !== "number" ||
        typeof template.earnedXlm !== "string"
      ) {
        throw new Error("El servidor devolvió una plantilla de diseñador inválida.");
      }
      return {
        template_id: template.template_id,
        title: template.title,
        svgHash: template.svgHash,
        usageCount: template.usageCount,
        earnedXlm: template.earnedXlm,
      };
    }),
  };
}

async function readJson(response: Response): Promise<unknown> {
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "No se pudo cargar el panel del diseñador.";
    throw new Error(message);
  }
  return payload;
}

export default function DesignerDashboard() {
  const [designers, setDesigners] = useState<DesignerOption[]>([]);
  const [selectedPublicKey, setSelectedPublicKey] = useState("");
  const [summary, setSummary] = useState<DesignerSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/templates", { cache: "no-store" })
      .then(readJson)
      .then(parseDesignerOptions)
      .then((options) => {
        if (!active) return;
        setDesigners(options);
        setBusy(options.length > 0);
        setSelectedPublicKey(options[0]?.publicKey ?? "");
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "No se pudieron cargar los diseñadores.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedPublicKey) return;
    let active = true;
    fetch(`/api/designers/${encodeURIComponent(selectedPublicKey)}`, {
      cache: "no-store",
    })
      .then(readJson)
      .then(parseSummary)
      .then((result) => {
        if (active) setSummary(result);
      })
      .catch((reason: unknown) => {
        if (active) {
          setSummary(null);
          setError(
            reason instanceof Error
              ? reason.message
              : "No se pudo cargar el panel del diseñador.",
          );
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [selectedPublicKey]);

  return (
    <section className="mx-auto w-full max-w-3xl space-y-4 px-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-700">
          Diseñadores
        </p>
        <h2 className="text-2xl font-bold tracking-tight text-slate-950">
          Panel del diseñador
        </h2>
      </header>

      {designers.length > 0 && (
        <label className="block text-sm font-medium text-slate-800">
          Diseñador
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            onChange={(event) => {
              setBusy(true);
              setSummary(null);
              setError("");
              setSelectedPublicKey(event.target.value);
            }}
            value={selectedPublicKey}
          >
            {designers.map((designer) => (
              <option key={designer.publicKey} value={designer.publicKey}>
                {designer.name} · {designer.publicKey.slice(0, 8)}…
              </option>
            ))}
          </select>
        </label>
      )}

      {busy && <p className="text-sm text-slate-600">Verificando usos en Horizon…</p>}
      {error && (
        <p aria-live="polite" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800" role="alert">
          {error}
        </p>
      )}
      {!busy && !error && designers.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
          Aún no hay plantillas de diseñadores.
        </p>
      )}
      {!busy && summary && (
        <>
          <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-600">Usos verificados</dt>
              <dd className="font-semibold text-slate-950">{summary.totalUses}</dd>
            </div>
            <div>
              <dt className="text-slate-600">Ganado · 35%</dt>
              <dd className="font-semibold text-slate-950">
                {summary.totalEarnedXlm} XLM
              </dd>
            </div>
          </dl>
          {summary.templates.length === 0 ? (
            <p className="text-sm text-slate-600">Este diseñador aún no tiene plantillas.</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
              {summary.templates.map((template) => (
                <li className="flex items-center justify-between gap-4 p-4" key={template.template_id}>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-950">{template.title}</p>
                    <p className="text-xs text-slate-600">
                      {template.usageCount} usos · {template.earnedXlm} XLM
                    </p>
                    <p className="truncate font-mono text-[10px] text-slate-500">
                      SHA-256: {template.svgHash}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
