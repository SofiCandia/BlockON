import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface TemplateUseRecord {
  template_id: string;
  transactionHash: string;
  request_id: string;
  createdAt: string;
}

function isTemplateUseRecord(value: unknown): value is TemplateUseRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "template_id" in value &&
    typeof value.template_id === "string" &&
    "transactionHash" in value &&
    typeof value.transactionHash === "string" &&
    /^[0-9a-f]{64}$/i.test(value.transactionHash) &&
    "request_id" in value &&
    typeof value.request_id === "string" &&
    "createdAt" in value &&
    typeof value.createdAt === "string"
  );
}

function usesFile(): string {
  return join(process.cwd(), "storage", "template-uses.json");
}

export async function getTemplateUses(): Promise<TemplateUseRecord[]> {
  let contents: string;
  try {
    contents = await readFile(usesFile(), "utf8");
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
  if (!Array.isArray(parsed) || !parsed.every(isTemplateUseRecord)) {
    throw new Error("El registro local de usos tiene un formato inválido.");
  }
  return parsed;
}

let writeQueue: Promise<void> = Promise.resolve();

export async function recordTemplateUse(
  input: Omit<TemplateUseRecord, "createdAt">,
): Promise<TemplateUseRecord> {
  const update = writeQueue.then(async () => {
    const uses = await getTemplateUses();
    const transactionUse = uses.find(
      (use) => use.transactionHash === input.transactionHash,
    );
    if (transactionUse) {
      if (
        transactionUse.request_id !== input.request_id ||
        transactionUse.template_id !== input.template_id
      ) {
        throw new Error("Esta transacción ya está registrada para otro uso.");
      }
      return transactionUse;
    }
    if (uses.some((use) => use.request_id === input.request_id)) {
      throw new Error("Esta solicitud ya tiene un uso registrado.");
    }

    const use: TemplateUseRecord = {
      ...input,
      createdAt: new Date().toISOString(),
    };
    await writeUses([...uses, use]);
    return use;
  });
  writeQueue = update.then(
    () => undefined,
    () => undefined,
  );
  return update;
}

async function writeUses(uses: TemplateUseRecord[]): Promise<void> {
  const directory = join(process.cwd(), "storage");
  await mkdir(directory, { recursive: true });
  const path = usesFile();
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(uses, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}
