import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const BRAND_STYLES = [
  "minimalista",
  "colorido",
  "elegante",
  "juvenil",
] as const;

export type BrandStyle = (typeof BRAND_STYLES)[number];

export interface StoredPostRequest {
  requestId: string;
  templateId: string;
  createdAt: string;
  status: "pendiente" | "pagado" | "entregado";
  paymentHash?: string;
  paidAt?: string;
  deliveredAt?: string;
  brand: {
    logoPath: string;
    palette: string[];
    moodboardPaths: string[];
    style: BrandStyle;
  };
  post: {
    title: string;
    slogan: string;
    price: string;
    occasion: string;
    extra: string;
  };
}

function isStoredPostRequest(value: unknown): value is StoredPostRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "requestId" in value &&
    typeof value.requestId === "string" &&
    "templateId" in value &&
    typeof value.templateId === "string" &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "status" in value &&
    (value.status === "pendiente" ||
      value.status === "pagado" ||
      value.status === "entregado") &&
    (!("paymentHash" in value) || typeof value.paymentHash === "string") &&
    (!("paidAt" in value) || typeof value.paidAt === "string") &&
    (!("deliveredAt" in value) || typeof value.deliveredAt === "string") &&
    "brand" in value &&
    typeof value.brand === "object" &&
    value.brand !== null &&
    "logoPath" in value.brand &&
    typeof value.brand.logoPath === "string" &&
    "palette" in value.brand &&
    Array.isArray(value.brand.palette) &&
    value.brand.palette.every((color) => typeof color === "string") &&
    "moodboardPaths" in value.brand &&
    Array.isArray(value.brand.moodboardPaths) &&
    value.brand.moodboardPaths.every((path) => typeof path === "string") &&
    "style" in value.brand &&
    typeof value.brand.style === "string" &&
    isBrandStyle(value.brand.style) &&
    "post" in value &&
    typeof value.post === "object" &&
    value.post !== null &&
    "title" in value.post &&
    typeof value.post.title === "string" &&
    "slogan" in value.post &&
    typeof value.post.slogan === "string" &&
    "price" in value.post &&
    typeof value.post.price === "string" &&
    "occasion" in value.post &&
    typeof value.post.occasion === "string" &&
    "extra" in value.post &&
    typeof value.post.extra === "string"
  );
}

function requestsFile(): string {
  return join(process.cwd(), "storage", "post-requests.json");
}

export async function getPostRequests(): Promise<StoredPostRequest[]> {
  let contents: string;
  try {
    contents = await readFile(requestsFile(), "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  const parsed: unknown = JSON.parse(contents);
  if (!Array.isArray(parsed) || !parsed.every(isStoredPostRequest)) {
    throw new Error("El archivo local de solicitudes tiene un formato inválido.");
  }
  return parsed;
}

export async function savePostRequest(
  postRequest: StoredPostRequest,
): Promise<void> {
  const existing = await getPostRequests();
  if (existing.some((request) => request.requestId === postRequest.requestId)) {
    throw new Error("Ya existe una solicitud con ese identificador.");
  }
  await mkdir(join(process.cwd(), "storage"), { recursive: true });
  await writePostRequests([...existing, postRequest]);
}

export async function getPostRequest(
  requestId: string,
): Promise<StoredPostRequest | undefined> {
  return (await getPostRequests()).find(
    (postRequest) => postRequest.requestId === requestId,
  );
}

let writeQueue: Promise<void> = Promise.resolve();

export async function recordVerifiedPayment(
  requestId: string,
  paymentHash: string,
): Promise<StoredPostRequest> {
  const update = writeQueue.then(async () => {
    const requests = await getPostRequests();
    const postRequest = requests.find(
      (candidate) => candidate.requestId === requestId,
    );
    if (!postRequest) {
      throw new Error("No se encontró la solicitud asociada al pago.");
    }
    const hashOwner = requests.find(
      (candidate) =>
        candidate.paymentHash === paymentHash &&
        candidate.requestId !== requestId,
    );
    if (hashOwner) {
      throw new Error("Esta transacción ya fue utilizada para otra solicitud.");
    }
    if (postRequest.paymentHash && postRequest.paymentHash !== paymentHash) {
      throw new Error("La solicitud ya tiene otro pago registrado.");
    }
    if (
      postRequest.status === "entregado" &&
      postRequest.paymentHash === paymentHash
    ) {
      return postRequest;
    }
    if (postRequest.status !== "pendiente" && !postRequest.paymentHash) {
      throw new Error("La solicitud no está pendiente de pago.");
    }

    postRequest.paymentHash = paymentHash;
    postRequest.paidAt ??= new Date().toISOString();
    postRequest.status = "pagado";
    await writePostRequests(requests);
    return postRequest;
  });
  writeQueue = update.then(
    () => undefined,
    () => undefined,
  );
  return update;
}

export async function recordDelivery(
  requestId: string,
  paymentHash: string,
): Promise<StoredPostRequest> {
  const update = writeQueue.then(async () => {
    const requests = await getPostRequests();
    const postRequest = requests.find(
      (candidate) => candidate.requestId === requestId,
    );
    if (
      !postRequest ||
      postRequest.paymentHash !== paymentHash ||
      (postRequest.status !== "pagado" && postRequest.status !== "entregado")
    ) {
      throw new Error("La solicitud no tiene un pago verificado para entregar.");
    }
    postRequest.status = "entregado";
    postRequest.deliveredAt ??= new Date().toISOString();
    await writePostRequests(requests);
    return postRequest;
  });
  writeQueue = update.then(
    () => undefined,
    () => undefined,
  );
  return update;
}

async function writePostRequests(requests: StoredPostRequest[]): Promise<void> {
  await mkdir(join(process.cwd(), "storage"), { recursive: true });
  const path = requestsFile();
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(requests, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export function isBrandStyle(value: string): value is BrandStyle {
  return BRAND_STYLES.some((style) => style === value);
}
