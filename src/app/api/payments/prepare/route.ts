import {
  Asset,
  Horizon,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { NextResponse } from "next/server";
import {
  formatXlm,
  getPaymentAmounts,
  isRecord,
  isValidPublicKey,
} from "@/lib/stellar-payment";
import { getPostRequest } from "@/lib/post-requests";
import { getTemplates } from "@/lib/templates";
import { getUsageMemoHash } from "@/lib/post-payment";
import { TESTNET_HORIZON_URL } from "@/lib/stellar-constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo debe ser JSON válido." }, { status: 400 });
  }

  if (
    !isRecord(payload) ||
    typeof payload.payerPublicKey !== "string" ||
    typeof payload.requestId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(payload.requestId) ||
    !isValidPublicKey(payload.payerPublicKey)
  ) {
    return NextResponse.json(
      { error: "La wallet de pago o la wallet del diseñador no es válida." },
      { status: 400 },
    );
  }

  try {
    const postRequest = await getPostRequest(payload.requestId);
    if (!postRequest) {
      return NextResponse.json(
        { error: "No se encontró la solicitud que quieres pagar." },
        { status: 404 },
      );
    }
    if (postRequest.status !== "pendiente") {
      return NextResponse.json(
        { error: "Esta solicitud ya fue pagada o entregada." },
        { status: 409 },
      );
    }
    const templates = await getTemplates();
    const template = templates.find(
      (candidate) => candidate.template_id === postRequest.templateId,
    );
    if (!template) {
      return NextResponse.json(
        { error: "La plantilla elegida ya no está disponible." },
        { status: 404 },
      );
    }

    const platformPublicKey = process.env.PLATFORM_PUBLIC_KEY?.trim() ?? "";
    if (
      !isValidPublicKey(platformPublicKey) ||
      platformPublicKey === template.designerPublicKey
    ) {
      return NextResponse.json(
        { error: "La wallet de plataforma no está configurada correctamente." },
        { status: 503 },
      );
    }

    const amounts = getPaymentAmounts();
    const server = new Horizon.Server(TESTNET_HORIZON_URL);
    const account = await server.loadAccount(payload.payerPublicKey);
    const baseFee = await server.fetchBaseFee();
    const transaction = new TransactionBuilder(account, {
      fee: String(baseFee * 2),
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: platformPublicKey,
          asset: Asset.native(),
          amount: formatXlm(amounts.platform),
        }),
      )
      .addOperation(
        Operation.payment({
          destination: template.designerPublicKey,
          asset: Asset.native(),
          amount: formatXlm(amounts.designer),
        }),
      )
      .addMemo(
        Memo.hash(
          Buffer.from(
            getUsageMemoHash(postRequest.templateId, postRequest.requestId),
            "hex",
          ),
        ),
      )
      .setTimeout(180)
      .build();

    return NextResponse.json({
      unsignedXdr: transaction.toXDR(),
      platformAmountXlm: formatXlm(amounts.platform),
      designerAmountXlm: formatXlm(amounts.designer),
      totalXlm: formatXlm(amounts.total),
      requestId: postRequest.requestId,
      memoHash: getUsageMemoHash(postRequest.templateId, postRequest.requestId),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo preparar la transacción.";
    return NextResponse.json(
      { error: `No se pudo preparar el pago en Testnet: ${message}` },
      { status: 502 },
    );
  }
}
