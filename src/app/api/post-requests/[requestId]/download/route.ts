import { NextResponse } from "next/server";
import { renderPostRequestPng } from "@/lib/post-rendering";
import { recordDelivery, getPostRequest } from "@/lib/post-requests";
import { verifyRequestPayment } from "@/lib/post-payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    return NextResponse.json(
      { error: "El ID de solicitud no es válido." },
      { status: 400 },
    );
  }

  try {
    const postRequest = await getPostRequest(requestId);
    if (!postRequest) {
      return NextResponse.json(
        { error: "No se encontró la solicitud." },
        { status: 404 },
      );
    }
    if (
      (postRequest.status !== "pagado" && postRequest.status !== "entregado") ||
      !postRequest.paymentHash
    ) {
      return NextResponse.json(
        { error: "El PNG se entrega solo después de verificar el pago en Horizon." },
        { status: 402 },
      );
    }

    try {
      await verifyRequestPayment(requestId, postRequest.paymentHash);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo verificar el pago.";
      const status =
        /horizon|request failed|network|timeout|fetch failed/i.test(message)
          ? 502
          : /no se encontró/i.test(message)
            ? 404
            : /pago|verificad/i.test(message)
              ? 402
              : 500;
      return NextResponse.json(
        { error: `El pago no pudo verificarse: ${message}` },
        { status },
      );
    }

    let png: Buffer;
    try {
      ({ png } = await renderPostRequestPng(requestId));
      await recordDelivery(requestId, postRequest.paymentHash);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error al procesar el PNG.";
      return NextResponse.json(
        { error: `El pago está verificado, pero no se pudo generar el PNG: ${message}` },
        { status: 500 },
      );
    }

    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="postmarca-${requestId}.png"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo entregar el PNG.";
    const status =
      /horizon|request failed|network|timeout|fetch failed/i.test(message)
        ? 502
        : /no se encontró/i.test(message)
          ? 404
          : 402;
    return NextResponse.json(
      { error: `No se pudo entregar el PNG: ${message}` },
      { status },
    );
  }
}
