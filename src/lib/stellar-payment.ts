import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";

const STROOPS_PER_XLM = BigInt("10000000");

export interface DemoDesigner {
  name: string;
  publicKey: string;
}

function isDemoDesigner(value: unknown): value is DemoDesigner {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.publicKey === "string" &&
    isValidPublicKey(value.publicKey)
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidPublicKey(value: string): boolean {
  try {
    return Keypair.fromPublicKey(value).publicKey() === value;
  } catch {
    return false;
  }
}

export function parseXlm(value: string): bigint {
  if (!/^(0|[1-9]\d*)(?:\.\d{1,7})?$/.test(value)) {
    throw new Error("El monto debe ser decimal y tener hasta 7 decimales.");
  }

  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(fraction.padEnd(7, "0"));
}

export function formatXlm(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const fraction = (stroops % STROOPS_PER_XLM).toString().padStart(7, "0");
  return `${whole}.${fraction}`;
}

export function getPaymentAmounts() {
  const configuredPrice = process.env.PRICE_XLM?.trim();
  if (!configuredPrice) {
    throw new Error(
      "Configura PRICE_XLM en .env.local para habilitar los pagos.",
    );
  }

  const total = parseXlm(configuredPrice);
  if (total <= BigInt(0)) {
    throw new Error("PRICE_XLM debe ser mayor que cero.");
  }

  const platform = (total * BigInt(65)) / BigInt(100);
  // If one stroop remains after the split, it is assigned to the designer.
  const designer = total - platform;
  if (platform === BigInt(0) || designer === BigInt(0)) {
    throw new Error("PRICE_XLM es demasiado pequeño para repartirlo.");
  }

  return { total, platform, designer };
}

export function getDataDirectory(): string {
  return join(process.cwd(), "storage");
}

export async function getDemoDesigners(): Promise<DemoDesigner[]> {
  const path = join(getDataDirectory(), "designers.json");
  const designers: unknown = JSON.parse(await readFile(path, "utf8"));
  if (
    !Array.isArray(designers) ||
    designers.length !== 2 ||
    !designers.every(isDemoDesigner)
  ) {
    throw new Error("No se encontraron las dos wallets de demo válidas.");
  }

  return designers;
}
