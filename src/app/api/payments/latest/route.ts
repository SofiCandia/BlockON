import { NextResponse } from "next/server";
import { verifyRequestPayment } from "@/lib/post-payment";
import { getTemplateUses } from "@/lib/template-uses";
import { getTemplates } from "@/lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [uses, templates] = await Promise.all([
      getTemplateUses(),
      getTemplates(),
    ]);
    const latestUse = [...uses].sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    )[0];
    if (!latestUse) {
      return NextResponse.json({ payment: null });
    }

    const verified = await verifyRequestPayment(
      latestUse.request_id,
      latestUse.transactionHash,
    );
    const template = templates.find(
      (candidate) => candidate.template_id === latestUse.template_id,
    );
    if (!template || verified.request.templateId !== latestUse.template_id) {
      throw new Error("El último registro de uso no corresponde a su plantilla.");
    }

    return NextResponse.json({
      payment: {
        verified: true,
        requestId: latestUse.request_id,
        templateId: latestUse.template_id,
        templateTitle: template.title,
        hash: verified.hash,
        createdAt: latestUse.createdAt,
        platformAmountXlm: verified.platformAmountXlm,
        designerAmountXlm: verified.designerAmountXlm,
        totalXlm: verified.totalXlm,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo cargar el último pago.";
    const status =
      /horizon|request failed|network|timeout|fetch failed/i.test(message)
        ? 502
        : 500;
    return NextResponse.json(
      { error: `No se pudo verificar el último pago: ${message}` },
      { status },
    );
  }
}
