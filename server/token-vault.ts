import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must contain at least 32 characters.");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptAccessToken(token: string): string {
  if (!process.env.TOKEN_ENCRYPTION_KEY && process.env.NODE_ENV !== "production") return token;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptAccessToken(stored: string): string {
  if (!stored.startsWith("v1:")) {
    if (process.env.NODE_ENV !== "production") return stored;
    throw new Error("A legacy bank token needs secure migration before use.");
  }
  const parts = stored.split(":");
  if (parts.length !== 4) throw new Error("Invalid encrypted bank token.");
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid encrypted bank token.");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
}

export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "production") return;
  if (!env.APP_PIN || env.APP_PIN.length < 20 || /^\d+$/.test(env.APP_PIN)) {
    throw new Error("APP_PIN must be a unique password of at least 20 characters, not a numeric PIN.");
  }
  if (env.PLAID_CLIENT_ID && env.PLAID_SECRET && (!env.TOKEN_ENCRYPTION_KEY || env.TOKEN_ENCRYPTION_KEY.length < 32)) {
    throw new Error("Set a separately generated TOKEN_ENCRYPTION_KEY of at least 32 characters before enabling banks.");
  }
  if (env.PLAID_ENV && !["production", "sandbox"].includes(env.PLAID_ENV)) {
    throw new Error("PLAID_ENV must be production or sandbox.");
  }
}
