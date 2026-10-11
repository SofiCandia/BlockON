import { createHash } from "node:crypto";
import { Horizon } from "@stellar/stellar-sdk";
import {
  formatXlm,
  getPaymentAmounts,
} from "@/lib/stellar-payment";
import {
  getPostRequest,
  type StoredPostRequest,
} from "@/lib/post-requests";
import { getTemplates } from "@/lib/templates";
import { TESTNET_HORIZON_URL } from "@/lib/stellar-constants";

export function getUsageMemoHash(templateId: string, requestId: string): string {
  return createHash("sha256")
    .update(`${templateId}:${requestId}`, "utf8")
    .digest("hex");
}

export async function verifyRequestPayment(
  requestId: string,
  transactionHash: string,
  payerPublicKey?: string,
): Promise<{
  request: StoredPostRequest;
  hash: string;
  payerPublicKey: string;
  platformAmountXlm: string;
  designerAmountXlm: string;
  totalXlm: string;
}> {
  const postRequest = await getPostRequest(requestId);
  if (!postRequest) {
    throw new Error("No se encontró la solicitud de post.");
  }
  if (postRequest.status === "pendiente" && postRequest.paymentHash) {
    throw new Error("La solicitud tiene un pago inconsistente; contacta soporte.");
  }
  if (
    postRequest.status !== "pendiente" &&
    postRequest.paymentHash !== transactionHash
  ) {
    throw new Error("La solicitud ya tiene registrado otro pago.");
  }

  const templates = await getTemplates();
  const template = templates.find(
    (candidate) => candidate.template_id === postRequest.templateId,
  );
  if (!template) {
    throw new Error("La plantilla de esta solicitud ya no está disponible.");
  }

  const platformPublicKey = process.env.PLATFORM_PUBLIC_KEY?.trim() ?? "";
  const amounts = getPaymentAmounts();
  const expectedMemo = getUsageMemoHash(postRequest.templateId, requestId);
  const server = new Horizon.Server(TESTNET_HORIZON_URL);
  const transaction = await server
    .transactions()
    .transaction(transactionHash)
    .call();

  if (!transaction.successful) {
    throw new Error("La transacción Stellar no fue exitosa.");
  }
  if (payerPublicKey && transaction.source_account !== payerPublicKey) {
    throw new Error("La transacción no pertenece a la wallet conectada.");
  }
  if (
    transaction.memo_type !== "hash" ||
    transaction.memo !== Buffer.from(expectedMemo, "hex").toString("base64")
  ) {
    throw new Error("El memo hash de la transacción no corresponde a esta solicitud.");
  }

  const operations = await server
    .operations()
    .forTransaction(transactionHash)
    .call();
  const platformAmountXlm = formatXlm(amounts.platform);
  const designerAmountXlm = formatXlm(amounts.designer);
  const payments = operations.records.filter(
    (operation) => operation.type === "payment",
  );
  const validPayments =
    operations.records.length === 2 &&
    payments.length === 2 &&
    payments.some(
      (operation) =>
        operation.asset_type === "native" &&
        operation.from === transaction.source_account &&
        operation.to === platformPublicKey &&
        operation.amount === platformAmountXlm,
    ) &&
    payments.some(
      (operation) =>
        operation.asset_type === "native" &&
        operation.from === transaction.source_account &&
        operation.to === template.designerPublicKey &&
        operation.amount === designerAmountXlm,
    );
  if (!validPayments) {
    throw new Error(
      "El pago no contiene exactamente las dos operaciones y montos 65/35 esperados.",
    );
  }

  return {
    request: postRequest,
    hash: transaction.hash,
    payerPublicKey: transaction.source_account,
    platformAmountXlm,
    designerAmountXlm,
    totalXlm: formatXlm(amounts.total),
  };
}
