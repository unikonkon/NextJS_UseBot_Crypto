import { createPublicKey, verify as cryptoVerify } from "node:crypto";

// SPKI DER prefix สำหรับ Ed25519 public key (RFC 8410) — ตามด้วย raw 32 ไบต์
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function publicKeyFromHex(hex: string) {
  const raw = Buffer.from(hex, "hex");
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

// ตรวจลายเซ็น Ed25519 ของ Discord interaction (header x-signature-ed25519 / -timestamp)
// คืน false เสมอถ้าข้อมูลไม่ครบ → fail closed
export function verifyDiscordRequest(
  rawBody: string,
  signatureHex: string | null,
  timestamp: string | null,
  publicKeyHex: string | undefined,
): boolean {
  if (!signatureHex || !timestamp || !publicKeyHex) return false;
  try {
    const key = publicKeyFromHex(publicKeyHex);
    const message = Buffer.from(timestamp + rawBody, "utf8");
    const signature = Buffer.from(signatureHex, "hex");
    return cryptoVerify(null, message, key, signature);
  } catch {
    return false;
  }
}
