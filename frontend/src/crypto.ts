/**
 * W↔W end-to-end encryption — client crypto helpers.
 *
 * Uses TweetNaCl's `nacl.box` (X25519 + XSalsa20-Poly1305).
 * - Private key never leaves the device. Stored in expo-secure-store on
 *   native (OS keychain) and AsyncStorage on web (best we can do without
 *   crypto.subtle persistence).
 * - Public key is uploaded to the backend on first sign-in.
 *
 * Threat model: protects message contents end-to-end. Server can see who
 * messaged whom and when (metadata), but never plaintext. Does NOT provide
 * forward secrecy in v1 — a future Double-Ratchet hardening pass will.
 */
import { Platform } from "react-native";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";

const SECRET_KEY_NAME = "w_e2ee_secret_v1";
const PUBLIC_KEY_NAME = "w_e2ee_public_v1";

const { decodeBase64, encodeBase64, decodeUTF8, encodeUTF8 } = naclUtil;

// In-memory cache so we don't hit secure storage on every send
let memSecret: Uint8Array | null = null;
let memPublicB64: string | null = null;

// ---------- storage abstraction -----------------------------------------

async function storeSet(key: string, value: string) {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(key, value);
  } else {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  }
}

async function storeGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return AsyncStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function storeDel(key: string) {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}

// ---------- key lifecycle ------------------------------------------------

export async function ensureKeyPair(): Promise<{ publicKey: string }> {
  // Try memory
  if (memSecret && memPublicB64) return { publicKey: memPublicB64 };
  // Try persistent storage
  const [secretB64, publicB64] = await Promise.all([
    storeGet(SECRET_KEY_NAME),
    storeGet(PUBLIC_KEY_NAME),
  ]);
  if (secretB64 && publicB64) {
    memSecret = decodeBase64(secretB64);
    memPublicB64 = publicB64;
    return { publicKey: publicB64 };
  }
  // Generate fresh
  const pair = nacl.box.keyPair();
  const newSecretB64 = encodeBase64(pair.secretKey);
  const newPublicB64 = encodeBase64(pair.publicKey);
  await storeSet(SECRET_KEY_NAME, newSecretB64);
  await storeSet(PUBLIC_KEY_NAME, newPublicB64);
  memSecret = pair.secretKey;
  memPublicB64 = newPublicB64;
  return { publicKey: newPublicB64 };
}

/** Wipe the device key material — used on sign-out. */
export async function clearKeyPair() {
  memSecret = null;
  memPublicB64 = null;
  await storeDel(SECRET_KEY_NAME);
  await storeDel(PUBLIC_KEY_NAME);
}

/**
 * Generate (if needed) and publish the current user's public key to the
 * server. Idempotent — safe to call on every login.
 */
export async function ensureKeyPublished(): Promise<string | null> {
  try {
    const { publicKey } = await ensureKeyPair();
    await api("/keys/publish", {
      method: "POST",
      body: JSON.stringify({ public_key: publicKey, algo: "nacl.box.v1" }),
    });
    return publicKey;
  } catch (e) {
    console.warn("ensureKeyPublished failed", e);
    return null;
  }
}

// ---------- encrypt / decrypt -------------------------------------------

export async function encryptForPeer(plaintext: string, peerPublicKeyB64: string) {
  await ensureKeyPair();
  if (!memSecret) throw new Error("Missing local secret key.");
  const peerPub = decodeBase64(peerPublicKeyB64);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const cipher = nacl.box(decodeUTF8(plaintext), nonce, peerPub, memSecret);
  return {
    ciphertext: encodeBase64(cipher),
    nonce: encodeBase64(nonce),
    algo: "nacl.box.v1",
  };
}

export async function decryptFromPeer(
  ciphertextB64: string,
  nonceB64: string,
  peerPublicKeyB64: string,
): Promise<string | null> {
  await ensureKeyPair();
  if (!memSecret) return null;
  const peerPub = decodeBase64(peerPublicKeyB64);
  const opened = nacl.box.open(decodeBase64(ciphertextB64), decodeBase64(nonceB64), peerPub, memSecret);
  if (!opened) return null;
  return encodeUTF8(opened);
}

// ---------- peer key cache ----------------------------------------------

const peerCache = new Map<string, string | null>();

export async function getPeerPublicKey(userId: string): Promise<string | null> {
  if (peerCache.has(userId)) return peerCache.get(userId) ?? null;
  try {
    const res = await api<{ public_key: string }>(`/keys/peer/${userId}`);
    const pk = res?.public_key || null;
    peerCache.set(userId, pk);
    return pk;
  } catch {
    peerCache.set(userId, null);
    return null;
  }
}

/**
 * Build a short, human-comparable "safety code" from two public keys.
 * Both peers see the same 8-group number; reading it aloud or comparing in
 * person is the standard way to detect MITM.
 */
export function safetyCode(myPubB64: string, peerPubB64: string): string {
  const sorted = [myPubB64, peerPubB64].sort().join("|");
  const bytes = decodeUTF8(sorted);
  const hash = nacl.hash(bytes); // SHA-512, 64 bytes
  let out = "";
  for (let i = 0; i < 20; i++) {
    out += hash[i].toString(10).padStart(3, "0");
    if ((i + 1) % 5 === 0 && i < 19) out += " ";
  }
  return out;
}
