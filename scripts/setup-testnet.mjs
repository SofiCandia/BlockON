import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org/";
const ROOT = process.cwd();
const LOCAL_ENV_PATH = join(ROOT, ".env.local");
const SETUP_ENV_PATH = join(ROOT, ".env.setup.local");
const DESIGNER_NAMES = ["Diseñadora Demo Uno", "Diseñador Demo Dos"];

async function readOptionalFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^(['"])(.*)\1$/, "$2")]),
  );
}

function setEnvValue(source, key, value) {
  const line = `${key}=${value}`;
  const keyPattern = new RegExp(`^${key}=.*$`, "m");
  if (keyPattern.test(source)) return source.replace(keyPattern, line);
  return `${source.trimEnd()}${source.trim() ? "\n" : ""}${line}\n`;
}

function removeEnvValue(source, key) {
  const keyPattern = new RegExp(`^[\\t ]*${key}\\s*=.*(?:\\r?\\n|$)`, "m");
  return source.replace(keyPattern, "");
}

async function loadDesigners(directory) {
  const path = join(directory, "designers.json");
  const existing = await readOptionalFile(path);
  if (existing) {
    const designers = JSON.parse(existing);
    if (
      !Array.isArray(designers) ||
      designers.length !== DESIGNER_NAMES.length ||
      designers.some(
        (designer) =>
          typeof designer.name !== "string" ||
          typeof designer.publicKey !== "string" ||
          Keypair.fromPublicKey(designer.publicKey).publicKey() !==
            designer.publicKey,
      )
    ) {
      throw new Error(`${path} no contiene las dos wallets de demo esperadas.`);
    }
    return designers;
  }

  const designers = DESIGNER_NAMES.map((name) => ({
    name,
    publicKey: Keypair.random().publicKey(),
  }));
  await writeFile(path, `${JSON.stringify(designers, null, 2)}\n`, "utf8");
  return designers;
}

async function getAccount(publicKey) {
  const response = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Horizon devolvió ${response.status} al consultar ${publicKey}: ${await response.text()}`,
    );
  }
  return response.json();
}

async function ensureFunded(label, publicKey) {
  const account = await getAccount(publicKey);
  if (account) {
    console.log(`${label}: cuenta ya activa en Testnet (${publicKey}).`);
    return;
  }

  const response = await fetch(
    `${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`,
  );
  if (!response.ok) {
    throw new Error(
      `Friendbot no pudo fondear ${label} (${response.status}): ${await response.text()}`,
    );
  }

  const fundedAccount = await getAccount(publicKey);
  if (!fundedAccount) {
    throw new Error(`Horizon no encontró ${label} después del fondeo.`);
  }
  console.log(`${label}: fondeada con Friendbot (${publicKey}).`);
}

async function main() {
  const localEnv = await readOptionalFile(LOCAL_ENV_PATH);
  const setupEnv = await readOptionalFile(SETUP_ENV_PATH);
  const localConfigured = parseEnv(localEnv);
  const setupConfigured = parseEnv(setupEnv);
  const secret =
    process.env.PLATFORM_SECRET_KEY ||
    setupConfigured.PLATFORM_SECRET_KEY ||
    localConfigured.PLATFORM_SECRET_KEY;
  const platformKeypair = secret
    ? Keypair.fromSecret(secret)
    : Keypair.random();
  const platformPublicKey = platformKeypair.publicKey();
  const dataDirectory = join(ROOT, "storage");

  await mkdir(dataDirectory, { recursive: true });
  await writeFile(
    SETUP_ENV_PATH,
    setEnvValue(setupEnv, "PLATFORM_SECRET_KEY", platformKeypair.secret()),
    { encoding: "utf8", mode: 0o600 },
  );
  const safeLocalEnv = removeEnvValue(localEnv, "PLATFORM_SECRET_KEY");
  await writeFile(
    LOCAL_ENV_PATH,
    setEnvValue(safeLocalEnv, "PLATFORM_PUBLIC_KEY", platformPublicKey),
    { encoding: "utf8", mode: 0o600 },
  );

  const designers = await loadDesigners(dataDirectory);
  await ensureFunded("Cuenta de plataforma", platformPublicKey);
  for (const designer of designers) {
    await ensureFunded(designer.name, designer.publicKey);
  }

  console.log(`Red: Stellar Testnet (${HORIZON_URL})`);
  console.log(`Wallet de plataforma: ${platformPublicKey}`);
  console.log(`Wallets de diseñadores: ${join(dataDirectory, "designers.json")}`);
  console.log("La clave secreta de la plataforma está en .env.setup.local (solo setup).");
}

main().catch((error) => {
  console.error(`Error preparando Stellar Testnet: ${error.message}`);
  process.exitCode = 1;
});
