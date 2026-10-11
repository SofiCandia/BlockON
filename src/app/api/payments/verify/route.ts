import { NextResponse } from "next/server";
import { recordVerifiedPayment } from "@/lib/post-requests";
import { verifyRequestPayment } from "@/lib/post-payment";
import { recordTemplateUse } from "@/lib/template-uses";
import { isRecord, isValidPublicKey } from "@/lib/stellar-payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "El cuerpo debe ser JSON válido." },
      { status: 400 },
    );
  }

  if (
    !isRecord(payload) ||
    typeof payload.requestId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(payload.requestId) ||
    typeof payload.hash !== "string" ||
    !/^[0-9a-f]{64}$/i.test(payload.hash) ||
    typeof payload.payerPublicKey !== "string" ||
    !isValidPublicKey(payload.payerPublicKey)
  ) {
    return NextResponse.json(
      { error: "ID de solicitud, hash de transacción o wallet no válido." },
      { status: 400 },
    );
  }

  try {
    const verified = await verifyRequestPayment(
      payload.requestId,
      payload.hash,
      payload.payerPublicKey,
    );
    await recordVerifiedPayment(payload.requestId, verified.hash);
    await recordTemplateUse({
      template_id: verified.request.templateId,
      transactionHash: verified.hash,
      request_id: payload.requestId,
    });

    return NextResponse.json({
      verified: true,
      requestId: payload.requestId,
      hash: verified.hash,
      platformAmountXlm: verified.platformAmountXlm,
      designerAmountXlm: verified.designerAmountXlm,
      totalXlm: verified.totalXlm,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo verificar el pago.";
    const status =
      /horizon|request failed|network|timeout|fetch failed/i.test(message)
        ? 502
        : /no se encontró/i.test(message)
          ? 404
          : /ya fue utilizada|ya tiene registrado/i.test(message)
            ? 409
            : 402;
    return NextResponse.json(
      { error: `No se pudo verificar el pago: ${message}` },
      { status },
    );
  }
}
