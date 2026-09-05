/**
 * Hypercolor web ring-callback channel id.
 *
 * Must stay byte-identical to hypercolor-web
 * `src/services/ringChannelId.ts`:
 *   ch = base64url_nopad(SHA-256("hypercolor-web/ring-callback/v1" || ephemeralPk_bytes))
 *
 * Decision: hash the raw 32-byte key (hex-decoded), not UTF-8 of the hex
 * string. The web side does hexToBytes(pair.publicKey) before SHA-256.
 * Verified against the live Hypercolor QR
 * (ephemeralPk c9aaad5b…b172 → ch 8eOwP5zDIW4PwXitMsHu3RdUDCF60o3DTwI-firPVT8).
 *
 * Decision: use @noble/hashes (already installed via bip39). Do not add a
 * package. RN has no Web Crypto / Node crypto in this tree.
 */

import { sha256 } from '@noble/hashes/sha256';
import { Buffer } from 'buffer';

export const RING_CALLBACK_CHANNEL_CONTEXT = 'hypercolor-web/ring-callback/v1';

export const hexToBytes = (hex: string): Uint8Array => {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
};

export const encodeBase64UrlNopad = (bytes: Uint8Array): string => {
	return Buffer.from(bytes)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(new RegExp('=+$'), '');
};

export const deriveRingCallbackChannelId = (ephemeralPkHex: string): string => {
	const prefix = new TextEncoder().encode(RING_CALLBACK_CHANNEL_CONTEXT);
	const pkBytes = hexToBytes(ephemeralPkHex);
	const input = new Uint8Array(prefix.length + pkBytes.length);
	input.set(prefix, 0);
	input.set(pkBytes, prefix.length);
	return encodeBase64UrlNopad(sha256(input));
};

/** First 6 chars of `ch`, grouped XXX-XXX for the confirmation sheet. */
export const formatRingVerificationCode = (channelId: string): string => {
	const chars = channelId.slice(0, 6);
	return `${chars.slice(0, 3)}-${chars.slice(3, 6)}`;
};
