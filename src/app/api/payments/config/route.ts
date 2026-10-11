import { NextResponse } from "next/server";
import {
  formatXlm,
  getDemoDesigners,
  getPaymentAmounts,
  isValidPublicKey,
} from "@/lib/stellar-payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const platformPublicKey = process.env.PLATFORM_PUBLIC_KEY?.trim() ?? "";
    if (!isValidPublicKey(platformPublicKey)) {
      return NextResponse.json(
        { error: "Ejecuta npm run testnet:setup para configurar la plataforma." },
        { status: 503 },
      );
    }

    const amounts = getPaymentAmounts();
    const designers = await getDemoDesigners();
    return NextResponse.json({
      platformPublicKey,
      priceXlm: formatXlm(amounts.total),
      designers,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo cargar la configuración.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
