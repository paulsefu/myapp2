import { normalizeVaultData, type VaultData } from "./objectives";

const KDF_ITERATIONS = 600_000;
const WRAP_AAD = new TextEncoder().encode("obiective-vault-key-v1").buffer as ArrayBuffer;
const DATA_AAD = new TextEncoder().encode("obiective-vault-data-v1").buffer as ArrayBuffer;

export type VaultEnvelope = {
  version: 1;
  kdf: {
    name: "PBKDF2-SHA256";
    iterations: number;
    salt: string;
  };
  keyWrap: {
    algorithm: "AES-256-GCM";
    iv: string;
    ciphertext: string;
  };
  data: {
    algorithm: "AES-256-GCM";
    iv: string;
    ciphertext: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type CreatedVault = {
  envelope: VaultEnvelope;
  masterKey: CryptoKey;
  recoveryCode: string;
};

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function bytesToBase64Url(value: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < value.length; index += 1) {
    binary += String.fromCharCode(value[index]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveWrappingKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const passwordMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations,
    },
    passwordMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function importMasterKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (rawKey.byteLength !== 32) {
    throw new Error("Cheia de recuperare nu este validă.");
  }

  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rawKey),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptPayload(
  masterKey: CryptoKey,
  data: VaultData,
): Promise<VaultEnvelope["data"]> {
  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: DATA_AAD,
      tagLength: 128,
    },
    masterKey,
    toArrayBuffer(plaintext),
  );

  return {
    algorithm: "AES-256-GCM",
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}

async function decryptPayload(
  envelope: VaultEnvelope,
  masterKey: CryptoKey,
): Promise<VaultData> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64UrlToBytes(envelope.data.iv)),
      additionalData: DATA_AAD,
      tagLength: 128,
    },
    masterKey,
    toArrayBuffer(base64UrlToBytes(envelope.data.ciphertext)),
  );

  return normalizeVaultData(
    JSON.parse(new TextDecoder().decode(plaintext)) as unknown,
  );
}

export async function createVault(
  initialData: VaultData,
  passphrase: string,
): Promise<CreatedVault> {
  const salt = randomBytes(16);
  const wrapIv = randomBytes(12);
  const rawMasterKey = randomBytes(32);
  const masterKey = await importMasterKey(rawMasterKey);
  const wrappingKey = await deriveWrappingKey(
    passphrase,
    salt,
    KDF_ITERATIONS,
  );
  const wrappedKey = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(wrapIv),
      additionalData: WRAP_AAD,
      tagLength: 128,
    },
    wrappingKey,
    toArrayBuffer(rawMasterKey),
  );
  const now = new Date().toISOString();

  const envelope: VaultEnvelope = {
    version: 1,
    kdf: {
      name: "PBKDF2-SHA256",
      iterations: KDF_ITERATIONS,
      salt: bytesToBase64Url(salt),
    },
    keyWrap: {
      algorithm: "AES-256-GCM",
      iv: bytesToBase64Url(wrapIv),
      ciphertext: bytesToBase64Url(new Uint8Array(wrappedKey)),
    },
    data: await encryptPayload(masterKey, initialData),
    createdAt: now,
    updatedAt: now,
  };

  return {
    envelope,
    masterKey,
    recoveryCode: `OBV1.${bytesToBase64Url(rawMasterKey)}`,
  };
}

export async function unlockVaultWithPassphrase(
  envelope: VaultEnvelope,
  passphrase: string,
): Promise<{ data: VaultData; masterKey: CryptoKey }> {
  assertVaultEnvelope(envelope);
  const wrappingKey = await deriveWrappingKey(
    passphrase,
    base64UrlToBytes(envelope.kdf.salt),
    envelope.kdf.iterations,
  );
  const rawMasterKey = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64UrlToBytes(envelope.keyWrap.iv)),
      additionalData: WRAP_AAD,
      tagLength: 128,
    },
    wrappingKey,
    toArrayBuffer(base64UrlToBytes(envelope.keyWrap.ciphertext)),
  );
  const masterKey = await importMasterKey(new Uint8Array(rawMasterKey));
  const data = await decryptPayload(envelope, masterKey);
  return { data, masterKey };
}

export async function unlockVaultWithRecoveryCode(
  envelope: VaultEnvelope,
  recoveryCode: string,
): Promise<{ data: VaultData; masterKey: CryptoKey }> {
  assertVaultEnvelope(envelope);
  const normalized = recoveryCode.trim().replace(/\s/g, "");
  if (!normalized.startsWith("OBV1.")) {
    throw new Error("Cheia de recuperare nu este validă.");
  }
  const rawKey = base64UrlToBytes(normalized.slice(5));
  const masterKey = await importMasterKey(rawKey);
  const data = await decryptPayload(envelope, masterKey);
  return { data, masterKey };
}

export async function encryptUpdatedVault(
  envelope: VaultEnvelope,
  masterKey: CryptoKey,
  data: VaultData,
): Promise<VaultEnvelope> {
  assertVaultEnvelope(envelope);
  return {
    ...envelope,
    data: await encryptPayload(masterKey, data),
    updatedAt: new Date().toISOString(),
  };
}

export function assertVaultEnvelope(value: unknown): asserts value is VaultEnvelope {
  if (!value || typeof value !== "object") {
    throw new Error("Seiful criptat nu este valid.");
  }
  const envelope = value as Partial<VaultEnvelope>;
  if (
    envelope.version !== 1 ||
    envelope.kdf?.name !== "PBKDF2-SHA256" ||
    envelope.keyWrap?.algorithm !== "AES-256-GCM" ||
    envelope.data?.algorithm !== "AES-256-GCM" ||
    typeof envelope.kdf.salt !== "string" ||
    typeof envelope.kdf.iterations !== "number" ||
    typeof envelope.keyWrap.iv !== "string" ||
    typeof envelope.keyWrap.ciphertext !== "string" ||
    typeof envelope.data.iv !== "string" ||
    typeof envelope.data.ciphertext !== "string"
  ) {
    throw new Error("Seiful criptat nu este valid.");
  }
}
