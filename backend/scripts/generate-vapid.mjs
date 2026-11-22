import { webcrypto } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const { privateKey } = await webcrypto.subtle.generateKey(
	{ name: "ECDSA", namedCurve: "P-256" },
	true,
	["sign", "verify"],
);
const jwk = await webcrypto.subtle.exportKey("jwk", privateKey);
if (!jwk.d || !jwk.x || !jwk.y) {
	throw new Error("Generated VAPID key pair is incomplete.");
}

const publicKey = Buffer.from(
	Uint8Array.from([4, ...Buffer.from(jwk.x, "base64url"), ...Buffer.from(jwk.y, "base64url")]),
).toString("base64url");
const varsPath = resolve(import.meta.dirname, "..", ".dev.vars");
const existing = existsSync(varsPath) ? readFileSync(varsPath, "utf8") : "";
if (/^VAPID_PRIVATE_KEY=/m.test(existing)) {
	throw new Error("VAPID_PRIVATE_KEY already exists in backend/.dev.vars.");
}
appendFileSync(
	varsPath,
	`${existing && !existing.endsWith("\n") ? "\n" : ""}VAPID_PRIVATE_KEY=${jwk.d}\n`,
	{ mode: 0o600 },
);
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log("Private key saved in backend/.dev.vars (gitignored).");
