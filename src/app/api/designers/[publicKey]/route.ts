import { NextResponse } from "next/server";
import { formatXlm, isValidPublicKey, parseXlm } from "@/lib/stellar-payment";
import { verifyRequestPayment } from "@/lib/post-payment";
import { getTemplates } from "@/lib/templates";
import { getTemplateUses } from "@/lib/template-uses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ publicKey: string }> },
) {
  const { publicKey } = await context.params;
  if (!isValidPublicKey(publicKey)) {
    return NextResponse.json(
      { error: "La wallet del diseñador no es válida." },
      { status: 400 },
    );
  }

  try {
    const [templates, uses] = await Promise.all([
      getTemplates(),
      getTemplateUses(),
    ]);
    const designerTemplates = templates.filter(
      (template) => template.designerPublicKey === publicKey,
    );
    let totalEarned = BigInt(0);
    const useCounts = new Map<string, number>();
    const earningsByTemplate = new Map<string, bigint>();

    for (const use of uses) {
      const template = designerTemplates.find(
        (candidate) => candidate.template_id === use.template_id,
      );
      if (!template) continue;

      const verified = await verifyRequestPayment(
        use.request_id,
        use.transactionHash,
      );
      if (verified.request.templateId !== use.template_id) {
        throw new Error(
          `El registro de uso ${use.request_id} no corresponde a su plantilla.`,
        );
      }
      const earned = parseXlm(verified.designerAmountXlm);
      totalEarned += earned;
      earningsByTemplate.set(
        use.template_id,
        (earningsByTemplate.get(use.template_id) ?? BigInt(0)) + earned,
      );
      useCounts.set(
        use.template_id,
        (useCounts.get(use.template_id) ?? 0) + 1,
      );
    }

    return NextResponse.json({
      designerPublicKey: publicKey,
      templates: designerTemplates.map((template) => ({
        template_id: template.template_id,
        title: template.title,
        svgHash: template.svgHash,
        createdAt: template.createdAt,
        usageCount: useCounts.get(template.template_id) ?? 0,
        earnedXlm: formatXlm(
          earningsByTemplate.get(template.template_id) ?? BigInt(0),
        ),
      })),
      totalUses: Array.from(useCounts.values()).reduce(
        (total, count) => total + count,
        0,
      ),
      totalEarnedXlm: formatXlm(totalEarned),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo cargar el panel.";
    const status =
      /horizon|request failed|network|timeout|fetch failed/i.test(message)
        ? 502
        : 500;
    return NextResponse.json(
      { error: `No se pudo verificar el panel del diseñador: ${message}` },
      { status },
    );
  }
}
