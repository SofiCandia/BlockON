"use client";

import {
  getNetwork,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
import {
  Horizon,
  Networks,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { useCallback, useEffect, useState } from "react";
import {
  TESTNET_HORIZON_URL,
  TESTNET_NETWORK_PASSPHRASE,
} from "@/lib/stellar-constants";

interface PaymentConfig {
  platformPublicKey: string;
  priceXlm: string;
}

interface PostRequestOption {
  requestId: string;
  templateId: string;
  templateTitle: string;
  designerName: string;
  status: "pendiente" | "pagado" | "entregado";
}

interface PaymentReceipt {
  verified: true;
  requestId: string;
  hash: string;
  platformAmountXlm: string;
  designerAmountXlm: string;
  totalXlm: string;
  templateTitle?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPaymentConfig(value: unknown): value is PaymentConfig {
  return (
    isRecord(value) &&
    typeof value.platformPublicKey === "string" &&
    typeof value.priceXlm === "string"
  );
}

function isPreparation(
  value: unknown,
): value is { unsignedXdr: string } {
  return isRecord(value) && typeof value.unsignedXdr === "string";
}

function isPostRequestList(
  value: unknown,
): value is { requests: PostRequestOption[] } {
  return (
    isRecord(value) &&
    Array.isArray(value.requests) &&
    value.requests.every(
      (request) =>
        isRecord(request) &&
        typeof request.requestId === "string" &&
        typeof request.templateId === "string" &&
        typeof request.templateTitle === "string" &&
        typeof request.designerName === "string" &&
        (request.status === "pendiente" ||
          request.status === "pagado" ||
          request.status === "entregado"),
    )
  );
}

function isPaymentReceipt(value: unknown): value is PaymentReceipt {
  return (
    isRecord(value) &&
    value.verified === true &&
    typeof value.requestId === "string" &&
    typeof value.hash === "string" &&
    typeof value.platformAmountXlm === "string" &&
    typeof value.designerAmountXlm === "string" &&
    typeof value.totalXlm === "string"
  );
}

function isLatestPayment(
  value: unknown,
): value is { payment: PaymentReceipt | null } {
  return (
    isRecord(value) &&
    (value.payment === null || isPaymentReceipt(value.payment))
  );
}

async function readJson<T>(
  response: Response,
  isExpected: (value: unknown) => value is T,
): Promise<T> {
  const data: unknown = await response.json();
  if (!response.ok) {
    const message =
      isRecord(data) && typeof data.error === "string"
        ? data.error
        : "La solicitud no pudo completarse.";
    throw new Error(message);
  }
  if (!isExpected(data)) {
    throw new Error("El servidor devolvió una respuesta inválida.");
  }
  return data;
}

function userFacingError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Ocurrió un error inesperado.";
  if (/insufficient|underfunded|tx_insufficient_balance|op_underfunded/i.test(message)) {
    return "Saldo insuficiente en tu wallet de Testnet para el pago y la comisión.";
  }
  if (/rejected|denied|cancel/i.test(message)) {
    return "Cancelaste la solicitud de firma en Freighter.";
  }
  return message;
}

export default function PaymentDemo() {
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [postRequests, setPostRequests] = useState<PostRequestOption[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [wallet, setWallet] = useState("");
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [latestPayment, setLatestPayment] = useState<PaymentReceipt | null>(null);
  const [latestPaymentMessage, setLatestPaymentMessage] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshPostRequests = useCallback(async (preferredRequestId?: string) => {
    const response = await fetch("/api/post-requests", { cache: "no-store" });
    const payload: unknown = await response.json();
    if (!response.ok || !isPostRequestList(payload)) {
      const error =
        isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : "No se pudieron cargar las solicitudes.";
      throw new Error(error);
    }
    const pendingRequests = payload.requests.filter(
      (postRequest) => postRequest.status === "pendiente",
    );
    setPostRequests(pendingRequests);
    if (
      preferredRequestId &&
      pendingRequests.some((postRequest) => postRequest.requestId === preferredRequestId)
    ) {
      setSelectedRequestId(preferredRequestId);
    } else if (
      !pendingRequests.some(
        (postRequest) => postRequest.requestId === selectedRequestId,
      )
    ) {
      setSelectedRequestId(pendingRequests[0]?.requestId ?? "");
    }
  }, [selectedRequestId]);

  const refreshLatestPayment = useCallback(async () => {
    const response = await fetch("/api/payments/latest", { cache: "no-store" });
    const payload: unknown = await response.json();
    if (!response.ok || !isLatestPayment(payload)) {
      const error =
        isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : "No se pudo cargar el último pago verificado.";
      throw new Error(error);
    }
    setLatestPayment(payload.payment);
    setLatestPaymentMessage("");
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/payments/config");
        const result = await readJson(response, isPaymentConfig);
        if (active) setConfig(result);
      } catch (error) {
        if (active) setMessage(userFacingError(error));
      }
      try {
        await refreshPostRequests();
      } catch (error) {
        if (active) setMessage(userFacingError(error));
      }
      try {
        await refreshLatestPayment();
      } catch (error) {
        if (active) {
          setLatestPaymentMessage(userFacingError(error));
        }
      }
    }
    void load();
    const onRequestCreated = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: string }>).detail;
      refreshPostRequests(detail?.requestId).catch((error: unknown) =>
        {
          if (active) setMessage(userFacingError(error));
        },
      );
    };
    window.addEventListener("postmarca:request-created", onRequestCreated);
    return () => {
      active = false;
      window.removeEventListener("postmarca:request-created", onRequestCreated);
    };
  }, [refreshLatestPayment, refreshPostRequests]);

  async function pay() {
    setBusy(true);
    setMessage("");
    setReceipt(null);
    try {
      if (!selectedRequestId) {
        throw new Error("Primero crea una solicitud pendiente de post.");
      }

      const connection = await isConnected();
      if (connection.error) throw new Error(connection.error.message);
      if (!connection.isConnected) {
        throw new Error("Freighter no está instalado. Instálalo y vuelve a intentarlo.");
      }

      const access = await requestAccess();
      if (access.error) throw new Error(access.error.message);

      const network = await getNetwork();
      if (network.error) throw new Error(network.error.message);
      if (
        network.network !== "TESTNET" ||
        network.networkPassphrase !== TESTNET_NETWORK_PASSPHRASE
      ) {
        throw new Error("Cambia Freighter a Stellar Testnet antes de pagar.");
      }
      setWallet(access.address);

      const preparation = await readJson(
        await fetch("/api/payments/prepare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payerPublicKey: access.address,
            requestId: selectedRequestId,
          }),
        }),
        isPreparation,
      );

      const signature = await signTransaction(preparation.unsignedXdr, {
        networkPassphrase: Networks.TESTNET,
        address: access.address,
      });
      if (signature.error) throw new Error(signature.error.message);
      if (signature.signerAddress !== access.address) {
        throw new Error("Freighter firmó con una cuenta distinta a la conectada.");
      }

      const server = new Horizon.Server(TESTNET_HORIZON_URL);
      const transaction = TransactionBuilder.fromXDR(
        signature.signedTxXdr,
        Networks.TESTNET,
      );
      let submitted;
      try {
        submitted = await server.submitTransaction(transaction);
      } catch (error) {
        throw new Error(userFacingError(error));
      }

      const verified = await readJson(
        await fetch("/api/payments/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hash: submitted.hash,
            payerPublicKey: access.address,
            requestId: selectedRequestId,
          }),
        }),
        isPaymentReceipt,
      );
      setReceipt(verified);
      setLatestPayment(verified);
      await refreshPostRequests();
    } catch (error) {
      setMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-4">
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-700">
          PostMarca · prueba de pago
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">
          Paga una plantilla en Stellar Testnet
        </h1>
        <p className="max-w-2xl text-slate-600">
          Freighter firma una transacción clásica con dos pagos en XLM. Horizon
          verifica el hash y cada operación antes de confirmar el resultado.
        </p>
      </header>

      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {config ? (
          <>
            <div>
              <label
                className="mb-2 block text-sm font-medium text-slate-800"
                htmlFor="post-request"
              >
                Solicitud de post pendiente
              </label>
              <select
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
                id="post-request"
                onChange={(event) => setSelectedRequestId(event.target.value)}
                value={selectedRequestId}
              >
                {postRequests.map((postRequest) => (
                  <option key={postRequest.requestId} value={postRequest.requestId}>
                    {postRequest.templateTitle} · {postRequest.designerName} ·{" "}
                    {postRequest.requestId.slice(0, 8)}
                  </option>
                ))}
              </select>
              {postRequests.length === 0 && (
                <p className="mt-2 text-xs text-amber-800">
                  Guarda primero una identidad y un post; aparecerán aquí para pagar.
                </p>
              )}
              <button
                className="mt-2 text-xs font-semibold text-indigo-700 underline"
                onClick={() =>
                  refreshPostRequests().catch((error: unknown) =>
                    setMessage(userFacingError(error)),
                  )
                }
                type="button"
              >
                Actualizar solicitudes
              </button>
            </div>

            <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Precio por post</dt>
                <dd className="font-semibold text-slate-900">{config.priceXlm} XLM</dd>
              </div>
              <div>
                <dt className="text-slate-500">Reparto</dt>
                <dd className="font-semibold text-slate-900">65% plataforma · 35% diseñador</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Red</dt>
                <dd className="font-semibold text-slate-900">Stellar Testnet</dd>
              </div>
            </dl>

            <button
              className="w-full rounded-lg bg-indigo-700 px-4 py-3 font-semibold text-white transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy || !selectedRequestId}
              onClick={pay}
              type="button"
            >
              {busy ? "Firmando y verificando…" : "Conectar Freighter y pagar"}
            </button>
            {wallet && (
              <p className="break-all text-xs text-slate-500">
                Wallet conectada: {wallet}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-600">
            Cargando configuración de Testnet…
          </p>
        )}

        {message && (
          <p
            aria-live="polite"
            className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800"
            role="alert"
          >
            {message}
          </p>
        )}
      </section>

      {(receipt ?? latestPayment) && (
        <section className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
          <div>
            <p className="text-sm font-semibold text-emerald-800">
              Último pago verificado en Horizon
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">
              {(receipt ?? latestPayment)?.totalXlm} XLM distribuidos
            </h2>
            {(receipt ?? latestPayment)?.templateTitle && (
              <p className="text-sm text-slate-700">
                Plantilla: {(receipt ?? latestPayment)?.templateTitle}
              </p>
            )}
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-600">Plataforma · 65%</dt>
              <dd className="font-semibold text-slate-950">
                {(receipt ?? latestPayment)?.platformAmountXlm} XLM
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">Diseñador · 35%</dt>
              <dd className="font-semibold text-slate-950">
                {(receipt ?? latestPayment)?.designerAmountXlm} XLM
              </dd>
            </div>
          </dl>
          <p className="break-all text-xs text-slate-700">
            Hash: {(receipt ?? latestPayment)?.hash}
          </p>
          <a
            className="inline-flex font-semibold text-indigo-800 underline"
            href={`https://stellar.expert/explorer/testnet/tx/${(receipt ?? latestPayment)?.hash}`}
            rel="noreferrer"
            target="_blank"
          >
            Ver en explorador Testnet
          </a>
          <a
            className="ml-4 inline-flex font-semibold text-indigo-800 underline"
            href={`/api/post-requests/${(receipt ?? latestPayment)?.requestId}/download`}
          >
            Descargar PNG personalizado
          </a>
        </section>
      )}
      {!receipt && !latestPayment && (
        <p className="mx-auto w-full max-w-3xl px-6 text-sm text-slate-600">
          {latestPaymentMessage || "Aún no hay pagos verificados."}
        </p>
      )}
    </section>
  );
}
