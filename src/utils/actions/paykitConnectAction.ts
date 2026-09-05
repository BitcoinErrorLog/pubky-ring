/**
 * Paykit Connect Action Handler
 *
 * Combined action that provides everything Bitkit/Paykit needs in a single request:
 * - Homeserver session (pubky + session_secret + capabilities)
 * - Noise keypair for epoch 0 (and optionally epoch 1 for key rotation)
 * - Device ID used for derivation
 * - Noise seed for local epoch derivation (so Bitkit doesn't need to re-call Ring)
 * - InboxKey X25519 keypair for SB2 stored message delivery
 * - AppKey Ed25519 keypair + AppCert for delegated signing
 *
 * This eliminates the need for multiple Ring interactions and allows Bitkit
 * to operate independently after initial setup.
 *
 * SECURE HANDOFF PROTOCOL (SB2 Binary Wire Format):
 * 1. Bitkit sends: pubkyring://paykit-connect?deviceId=abc&callback=...&ephemeralPk=xyz
 * 2. Ring generates InboxKey, AppKey (with AppCert), and noise keypairs
 * 3. Ring encrypts handoff payload using SB2 format to Bitkit's ephemeral X25519 key
 * 4. Ring signs the SB2 envelope with owner's Ed25519 key for authenticity
 * 5. Ring stores encrypted envelope at /pub/paykit.app/v0/handoff/{request_id}
 * 6. Ring publishes KeyBinding at /pub/paykit.app/v0/keybinding (contains InboxKey, TransportKey, AppKey)
 * 7. Ring publishes Noise endpoint at /pub/paykit.app/v0/noise (for discoverability)
 * 8. Native custom-scheme callback: Ring opens bitkit://… / hypercolor://… with
 *    pubky + request_id + mode=secure_handoff + homeserver (same-device).
 *    First-party https callback: Ring NEVER opens a browser. It POSTs those
 *    four public locator fields to httprelay (HYPERCOLOR_HTTP_RELAY_BASE/hc-<ch>)
 *    so the page that is already polling that channel can continue on its own
 *    device. Ring cannot know which device served a web QR.
 * 9. Bitkit/Hypercolor fetches envelope from homeserver, decrypts with ephemeral secret key
 * 10. Bitkit extracts InboxKey, AppKey, noise_seed for local use
 *
 * SECURITY PROPERTIES:
 * - NO secrets in callback URL
 * - NO plaintext secrets on homeserver
 * - Envelope signed by owner for authenticity verification
 * - AppKey enables delegated signing without exposing root identity key
 *
 * LEGACY MODE REMOVED: ephemeralPk is now REQUIRED for security.
 * Requests without ephemeralPk will be rejected with an error.
 */

import { Result, ok, err } from '@synonymdev/result';
import { AppState, Linking } from 'react-native';
import {
	put as originalPut,
	list as originalList,
	get as originalGet,
	deleteFile as originalDeleteFile,
} from '@synonymdev/react-native-pubky';
import { InputAction, PaykitConnectParams } from '../inputParser';
import { ActionContext } from '../inputRouter';
import { signInToHomeserver, getPubkySecretKey, signAndPostAuthToken } from '../pubky';
import {
	showToast,
	hideToastIfKind,
	PAYKIT_CONNECT_RELAY_FAILURE_TOAST,
} from '../helpers';
import { getErrorMessage } from '../errorHandler';
import { getPubkyDataFromStore } from '../store-helpers';
import { DEFAULT_HOMESERVER } from '../constants';
import { parseQueryPairs } from '../queryParams';
import { Buffer } from 'buffer';
import i18n from '../../i18n';
import {
	deriveRingCallbackChannelId,
	formatRingVerificationCode,
} from '../ringCallbackChannel';
import { requestPaykitConnectConfirmation } from '../confirmPaykitConnect';
import {
	formatPaykitConnectDestination,
	parsePaykitConnectCaps,
	parsePubkyAuthUrlCaps,
	HYPERCOLOR_EXPECTED_CAPS,
	paykitConnectCapSetsEqual,
	serializePaykitConnectCaps,
} from '../paykitConnectCaps';
import {
	deriveX25519ForDeviceEpoch as nativeDeriveX25519,
	deriveNoiseSeed as nativeDeriveNoiseSeed,
	isNativeModuleAvailable,
	sealedBlobEncryptWithContext,
	ed25519PublicFromSecret,
	x25519GenerateKeypair,
	generateAppKeypair,
	issueAppCert,
	sb2Encrypt,
	sb2Sign,
	sb2GenerateContextId,
	computeInboxKid as nativeComputeInboxKid,
} from '../PubkyNoiseModule';

/**
 * Callbacks Ring is allowed to complete after paykit-connect.
 *
 * Custom schemes must stay aligned with AndroidManifest.xml <queries>
 * and ios/pubkyring/Info.plist LSApplicationQueriesSchemes. Those are
 * same-device by definition and still use Linking.openURL.
 *
 * Arbitrary `https` is still rejected: an attacker QR could otherwise
 * name an attacker URL as the handoff destination. The only https
 * exception is an exact-match allowlist of first-party Hypercolor web
 * endpoints (origin + pathname). Host is matched case-insensitively
 * with no port, userinfo, or trailing-dot tricks; pathname must be
 * exactly `/ring-callback` (no slash variants, `..`, or encodings);
 * fragments are rejected. Query is required (`ch`) and cannot change
 * origin or path. A queryless callback is rejected here and on-device
 * by React Native's URL parser (it appends `/`, so the path becomes
 * `/ring-callback/`); that reject is acceptable because Hypercolor
 * always sends `?ch=`.
 *
 * Allowed https callbacks are NOT opened. Ring posts the public locator
 * to httprelay itself (see completeHandoffCallback). The allowlist only
 * decides that this QR is a Hypercolor web handoff, not a custom-scheme
 * deep link. `ch` is then re-validated (base64url, ≤128) before any
 * network call so a crafted query cannot change the relay host or path.
 */
const ALLOWED_PAYKIT_CALLBACK_SCHEMES = new Set([
	'bitkit',
	'paykit',
	'atomicity',
	'hypercolor',
]);

const ALLOWED_HTTPS_CALLBACK_HOSTS = new Set([
	'hypercolor.app',
	'www.hypercolor.app',
]);
const ALLOWED_HTTPS_CALLBACK_PATHNAME = '/ring-callback';

// Mirrors Hypercolor web's DEFAULT_HTTP_RELAY (src/lib/http-relay.ts).
// Web polls `${DEFAULT_HTTP_RELAY}/hc-<ch>`; Ring must POST to the same
// host+path. Do not read this from the QR — only `ch` is attacker-chosen.
const HYPERCOLOR_HTTP_RELAY_BASE = 'https://httprelay.pubky.app/link';
const RELAY_CHANNEL_PREFIX = 'hc-';
// Web channel id is unpadded base64url of a SHA-256 digest (43 chars).
// Fail closed on anything else so `ch` cannot inject `/`, `?`, or host.
const RELAY_CHANNEL_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const RELAY_POST_TIMEOUT_MS = 30_000;
const HANDOFF_STORAGE_PREFIX = '/pub/paykit.app/v0/handoff/';
const HANDOFF_TTL_SECONDS = 5 * 60;
const HANDOFF_TTL_MS = HANDOFF_TTL_SECONDS * 1000;
const HANDOFF_SWEEP_LIMIT = 20;
const HANDOFF_DELETE_TIMEOUT_MS = 5_000;
const deferredHandoffDeletes = new Set<ReturnType<typeof setTimeout>>();

/**
 * Drop pending +5 min handoff DELETEs. The next connect's stale sweep
 * covers any blob that outlives this process.
 */
export const cancelDeferredHandoffDeletes = (): void => {
	for (const timer of deferredHandoffDeletes) {
		clearTimeout(timer);
	}
	deferredHandoffDeletes.clear();
};

const CALLBACK_SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i;

const parseCallbackScheme = (callback: string): string | null => {
	const match = callback.trim().match(CALLBACK_SCHEME_RE);
	if (!match) {
		return null;
	}
	return match[1].toLowerCase();
};

/**
 * First-party https callbacks only. Uses the platform URL parser, then
 * re-checks the raw authority and path so normalization cannot hide
 * port, userinfo, trailing-dot, `..`, or encoded-slash tricks.
 *
 * Protocol comparison is case-insensitive so Node's WHATWG URL and
 * React Native 0.83's regex URL accept the same Hypercolor shapes
 * (`https://…/ring-callback?ch=`). RN's constructor never throws, its
 * `port` regex matches a colon anywhere including the query, and it
 * appends `/` to a queryless URL — the raw-authority check and the
 * required `?` keep those parser quirks from changing the allowlist.
 */
export const isAllowedHttpsPaykitCallback = (callback: string): boolean => {
	const trimmed = callback.trim();
	if (trimmed.includes('#')) {
		return false;
	}
	// Hypercolor always sends `?ch=`. Rejecting a queryless callback
	// matches on-device RN behavior (trailing `/` → path mismatch).
	if (!trimmed.includes('?')) {
		return false;
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return false;
	}

	if (parsed.protocol.toLowerCase() !== 'https:') {
		return false;
	}
	if (parsed.username !== '' || parsed.password !== '') {
		return false;
	}
	if (parsed.hash !== '') {
		return false;
	}

	const rawParts = trimmed.match(/^https:\/\/([^/?#]+)([^?#]*)/i);
	if (!rawParts) {
		return false;
	}
	const rawAuthority = rawParts[1];
	const rawPath = rawParts[2];
	if (rawAuthority.includes('@') || rawAuthority.includes(':')) {
		return false;
	}
	if (rawAuthority.endsWith('.')) {
		return false;
	}
	// RN's port getter matches `:digits` in the query (`?ch=x:443`).
	// Only reject when the authority itself (already excluding `?`) has a port.
	if (parsed.port !== '' && rawAuthority.includes(':')) {
		return false;
	}

	const host = parsed.hostname.toLowerCase();
	const effectiveHost = host || rawAuthority.toLowerCase();
	if (effectiveHost.endsWith('.') || !ALLOWED_HTTPS_CALLBACK_HOSTS.has(effectiveHost)) {
		return false;
	}
	if (rawAuthority.toLowerCase() !== effectiveHost) {
		return false;
	}
	// RN's hostname/pathname regexes are scheme-case-sensitive; uppercase
	// `HTTPS:` yields hostname "" and pathname "/". Trust raw path then.
	if (
		parsed.pathname !== ALLOWED_HTTPS_CALLBACK_PATHNAME &&
		parsed.pathname !== '/'
	) {
		return false;
	}
	if (rawPath !== ALLOWED_HTTPS_CALLBACK_PATHNAME) {
		return false;
	}

	return true;
};

const ALLOWED_AUTH_RELAY_HOST = 'httprelay.pubky.app';

/**
 * Combined-grant `relay=` allowlist (R5). Fail closed: only the first-party
 * httprelay base used by pubkyauth. Attacker-chosen relay would receive the
 * AuthToken ciphertext and, knowing `secret` from the QR, could decrypt it
 * and POST /session. Scheme exactly https; no userinfo, port, trailing-dot,
 * query, or fragment. Path exactly `/link/` or `/link`.
 *
 * Custom-scheme paykit-connect must not carry `relay` at all (R7).
 */
export const assertAllowedAuthRelay = (relay: string): boolean => {
	const trimmed = relay.trim();
	if (trimmed.includes('#')) {
		return false;
	}
	if (trimmed.includes('?')) {
		return false;
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return false;
	}

	if (parsed.protocol.toLowerCase() !== 'https:') {
		return false;
	}
	if (parsed.username !== '' || parsed.password !== '') {
		return false;
	}
	if (parsed.hash !== '') {
		return false;
	}
	if (parsed.search !== '') {
		return false;
	}

	const rawParts = trimmed.match(/^https:\/\/([^/?#]+)([^?#]*)/i);
	if (!rawParts) {
		return false;
	}
	const rawAuthority = rawParts[1];
	const rawPath = rawParts[2];
	if (rawAuthority.includes('@') || rawAuthority.includes(':')) {
		return false;
	}
	if (rawAuthority.endsWith('.')) {
		return false;
	}
	if (parsed.port !== '' && rawAuthority.includes(':')) {
		return false;
	}

	const host = parsed.hostname.toLowerCase();
	const effectiveHost = host || rawAuthority.toLowerCase();
	if (effectiveHost.endsWith('.') || effectiveHost !== ALLOWED_AUTH_RELAY_HOST) {
		return false;
	}
	if (rawAuthority.toLowerCase() !== effectiveHost) {
		return false;
	}
	if (
		parsed.pathname !== '/link/' &&
		parsed.pathname !== '/link' &&
		parsed.pathname !== '/'
	) {
		return false;
	}
	if (rawPath !== '/link/' && rawPath !== '/link') {
		return false;
	}

	return true;
};

const PAYKIT_AUTH_SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

const isValidPaykitAuthSecret = (secret: string | undefined): boolean => {
	if (!secret) {
		return false;
	}
	if (!PAYKIT_AUTH_SECRET_RE.test(secret)) {
		return false;
	}
	try {
		const padded = secret.replace(/-/g, '+').replace(/_/g, '/');
		const padLen = (4 - (padded.length % 4)) % 4;
		const decoded = Buffer.from(padded + '='.repeat(padLen), 'base64');
		return decoded.length === 32;
	} catch {
		return false;
	}
};

const buildPubkyAuthUrl = (caps: string[], secret: string, relay: string): string => {
	const serializedCaps = serializePaykitConnectCaps(caps);
	const query = [
		`caps=${encodeURIComponent(serializedCaps)}`,
		`secret=${encodeURIComponent(secret)}`,
		`relay=${encodeURIComponent(relay)}`,
	].join('&');
	return `pubkyauth:///?${query}`;
};

const grantedCapsFromAuthResult = (value: string[]): string[] => {
	if (value.length === 0) {
		return [];
	}
	if (value.length === 1) {
		const only = value[0];
		if (only === 'success' || only === 'ok' || only === '') {
			return [];
		}
		if (only.includes(',')) {
			return only.split(',').map((item) => item.trim()).filter(Boolean);
		}
	}
	return value;
};

const isAllowedPaykitCallback = (callback: string | undefined): boolean => {
	if (!callback) {
		return false;
	}
	const scheme = parseCallbackScheme(callback);
	if (scheme === null) {
		return false;
	}
	if (ALLOWED_PAYKIT_CALLBACK_SCHEMES.has(scheme)) {
		return true;
	}
	if (scheme === 'https') {
		return isAllowedHttpsPaykitCallback(callback);
	}
	return false;
};

const rejectInvalidCallback = (): Result<string> => {
	showToast({
		type: 'error',
		title: i18n.t('common.error'),
		description: i18n.t('session.invalidCallback'),
	});
	return err(i18n.t('session.invalidCallback'));
};

const rejectStaleHypercolorQr = (): Result<string> => {
	showToast({
		type: 'error',
		title: i18n.t('common.error'),
		description: i18n.t('session.paykitConnectStaleQr'),
	});
	return err(i18n.t('session.paykitConnectStaleQr'));
};

const withBoundedTimeout = async <T>(work: Promise<T>, timeoutMs: number): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
			}),
		]);
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	}
};

const handoffBlobUrl = (pubky: string, requestId: string): string =>
	`pubky://${pubky}${HANDOFF_STORAGE_PREFIX}${requestId}`;

const isScopedHandoffUrl = (pubky: string, url: string): boolean => {
	const prefix = `pubky://${pubky}${HANDOFF_STORAGE_PREFIX}`;
	if (!url.startsWith(prefix)) {
		return false;
	}
	const rest = url.slice(prefix.length);
	return rest.length > 0 && !rest.includes('/') && !rest.includes('?');
};

const normalizeListedHandoffUrl = (pubky: string, listed: string): string | null => {
	const trimmed = listed.trim();
	if (isScopedHandoffUrl(pubky, trimmed)) {
		return trimmed;
	}
	const prefix = HANDOFF_STORAGE_PREFIX;
	if (trimmed.startsWith(prefix)) {
		const requestId = trimmed.slice(prefix.length);
		const url = handoffBlobUrl(pubky, requestId);
		return isScopedHandoffUrl(pubky, url) ? url : null;
	}
	return null;
};

const deleteHandoffBlobBestEffort = async (
	url: string,
	secretKey: string,
): Promise<void> => {
	try {
		await withBoundedTimeout(originalDeleteFile(url, secretKey), HANDOFF_DELETE_TIMEOUT_MS);
	} catch {
		console.warn('[PaykitConnectAction] Handoff blob delete failed');
	}
};

const scheduleDeferredHandoffDelete = (url: string, secretKey: string): void => {
	const timer = setTimeout(() => {
		deferredHandoffDeletes.delete(timer);
		// Only if Ring is still foreground. Process death is covered by
		// the next-connect sweep; a backgrounded app skips the network
		// call rather than racing a suspended fetch.
		if (AppState.currentState !== 'active') {
			return;
		}
		deleteHandoffBlobBestEffort(url, secretKey).catch(() => undefined);
	}, HANDOFF_TTL_MS);
	deferredHandoffDeletes.add(timer);
};

const readHandoffCreatedAt = async (url: string): Promise<number | null> => {
	try {
		const result = await withBoundedTimeout(originalGet(url), HANDOFF_DELETE_TIMEOUT_MS);
		if (result.isErr()) {
			return null;
		}
		const body = result.value;
		const parsed: unknown = typeof body === 'string' ? JSON.parse(body) : body;
		if (
			parsed &&
			typeof parsed === 'object' &&
			'created_at' in parsed &&
			typeof (parsed as { created_at: unknown }).created_at === 'number'
		) {
			return (parsed as { created_at: number }).created_at;
		}
		// Legacy wrappers have no plaintext age; treat as stale (P2-2).
		return 0;
	} catch {
		return null;
	}
};

const sweepStaleHandoffBlobs = async (pubky: string, secretKey: string): Promise<void> => {
	try {
		const listed = await withBoundedTimeout(
			originalList(`pubky://${pubky}${HANDOFF_STORAGE_PREFIX}`),
			HANDOFF_DELETE_TIMEOUT_MS,
		);
		if (listed.isErr()) {
			return;
		}
		const urls = (listed.value ?? [])
			.map((item) => normalizeListedHandoffUrl(pubky, item))
			.filter((item): item is string => item !== null)
			.slice(0, HANDOFF_SWEEP_LIMIT);
		const nowSeconds = Math.floor(Date.now() / 1000);
		for (const url of urls) {
			const createdAt = await readHandoffCreatedAt(url);
			if (createdAt === null) {
				continue;
			}
			if (nowSeconds - createdAt < HANDOFF_TTL_SECONDS) {
				continue;
			}
			await deleteHandoffBlobBestEffort(url, secretKey);
		}
	} catch {
		console.warn('[PaykitConnectAction] Handoff blob sweep failed');
	}
};

/**
 * Wrapper for put() that properly captures native errors
 * Uses the react-native-pubky library's put function which handles
 * cross-platform native module access correctly.
 */
const put = async (url: string, content: object, secretKey: string): Promise<Result<string[]>> => {
	try {
		const result = await originalPut(url, content, secretKey);
		if (result.isErr()) {
			const errorMsg = typeof result.error === 'string' 
				? result.error 
				: result.error instanceof Error 
					? result.error.message 
					: JSON.stringify(result.error);
			console.error('[put wrapper] Error:', errorMsg);
			return err(errorMsg);
		}
		return ok(result.value);
	} catch (e: unknown) {
		let message = 'Unknown native error';
		if (e instanceof Error) {
			message = e.message || e.name || 'Error (no message)';
		} else if (typeof e === 'string') {
			message = e;
		} else if (e && typeof e === 'object') {
			message = (e as Record<string, unknown>).message as string || 
			          (e as Record<string, unknown>).error as string || 
			          JSON.stringify(e);
		}
		console.error('[put wrapper] Native error:', message);
		return err(message);
	}
};

type PaykitConnectActionData = {
	action: InputAction.PaykitConnect;
	params: PaykitConnectParams;
};

/**
 * Generate a cryptographically random request ID (256 bits as hex)
 * Uses the pubky-noise native module's X25519 keypair generation
 * which internally uses the platform's secure random generator.
 */
const generateRequestId = async (): Promise<string> => {
	// Generate an ephemeral X25519 keypair - the secret key is 32 random bytes
	// This leverages the native module's secure random generation
	// Uses the statically imported x25519GenerateKeypair from PubkyNoiseModule
	const keypair = await x25519GenerateKeypair();
	// Use the secret key as our random request ID (it's 32 cryptographically random bytes)
	return keypair.secretKey;
};

/**
 * Check if a string is a valid hex string
 */
const isHexString = (str: string): boolean => {
	return /^[0-9a-fA-F]+$/.test(str) && str.length % 2 === 0;
};

/**
 * Convert a regular string to hex
 */
const stringToHex = (str: string): string => {
	return Array.from(new TextEncoder().encode(str))
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');
};

/**
 * Derives X25519 keypair using pubky-noise KDF via native module
 */
const deriveX25519Keypair = async (
	ed25519SecretKey: string,
	deviceId: string,
	epoch: number
): Promise<{ publicKey: string; secretKey: string }> => {
	if (!isNativeModuleAvailable()) {
		throw new Error(
			'PubkyNoiseModule native module is not available. ' +
				'Ensure the native libraries are properly linked.'
		);
	}

	const deviceIdHex = isHexString(deviceId) ? deviceId : stringToHex(deviceId);
	const keypair = await nativeDeriveX25519(ed25519SecretKey, deviceIdHex, epoch);

	return {
		secretKey: keypair.secretKey,
		publicKey: keypair.publicKey,
	};
};

/**
 * Handoff payload structure (encrypted before storing on homeserver)
 * Version 3 adds AppKey for delegated signing (PUBKY_UNIFIED_KEY_DELEGATION_SPEC)
 */
interface HandoffPayload {
	version: number;
	pubky: string;
	session_secret?: string;
	capabilities?: string[];
	device_id: string;
	noise_keypairs: {
		epoch: number;
		public_key: string;
		secret_key: string;
	}[];
	/** Noise seed for local epoch derivation (so Bitkit doesn't need to re-call Ring) */
	noise_seed: string;
	/** InboxKey X25519 keypair for stored message delivery (SB2) */
	inbox_keypair: {
		public_key: string;
		secret_key: string;
	};
	/** AppKey for delegated Ed25519 signing (PUBKY_UNIFIED_KEY_DELEGATION_SPEC) */
	app_key?: {
		/** Delegated Ed25519 secret key for signing */
		ed25519_sk: string;
		/** Delegated Ed25519 public key */
		ed25519_pk: string;
		/** AppCert identifier (16 bytes hex) */
		cert_id: string;
		/** AppCert body (hex-encoded CBOR) */
		cert_body: string;
		/** AppCert signature (hex-encoded) */
		cert_sig: string;
	};
	created_at: number;
	expires_at: number;
}

/**
 * Derive noise_seed from Ed25519 secret key using HKDF via native module.
 *
 * Uses HKDF-SHA256 with domain separation:
 * - salt: "paykit-noise-seed-v1"
 * - ikm: Ed25519 secret key
 * - info: device_id
 *
 * This produces a 32-byte seed for local epoch key derivation.
 * The seed is domain-separated and cannot be used for signing.
 */
const deriveNoiseSeed = async (
	ed25519SecretHex: string,
	deviceId: string
): Promise<string> => {
	if (!isNativeModuleAvailable()) {
		throw new Error(
			'PubkyNoiseModule native module is not available. ' +
			'Ensure the native libraries are properly linked.'
		);
	}
	const deviceIdHex = isHexString(deviceId) ? deviceId : stringToHex(deviceId);
	return nativeDeriveNoiseSeed(ed25519SecretHex, deviceIdHex);
};

/**
 * Handles paykit-connect action - signs in and derives noise keys
 * REQUIRES ephemeralPk for secure handoff (legacy mode removed)
 */
export const handlePaykitConnectAction = async (
	data: PaykitConnectActionData,
	context: ActionContext
): Promise<Result<string>> => {
	const { pubky, dispatch } = context;
	const { deviceId, callback, includeEpoch1 = true, ephemeralPk, secret, relay } = data.params;

	hideToastIfKind(PAYKIT_CONNECT_RELAY_FAILURE_TOAST);

	// Paykit connect requires a pubky
	if (!pubky) {
		showToast({
			type: 'error',
			title: i18n.t('pubky.noSelection'),
			description: i18n.t('pubky.selectToProcess'),
		});
		return err('No pubky provided for Paykit connect');
	}

	if (!isAllowedPaykitCallback(callback)) {
		return rejectInvalidCallback();
	}

	// SECURITY: ephemeralPk is REQUIRED for secure handoff.
	// Legacy mode (keys in the callback URL) has been removed. That also
	// means an https callback can never carry secrets — even if one were
	// presented, this reject fires before any relay post or openURL.
	if (!ephemeralPk) {
		showToast({
			type: 'error',
			title: 'Update Required',
			description: 'Please update Bitkit to the latest version for secure setup',
		});
		return err('ephemeralPk is required for secure handoff. Legacy mode is no longer supported.');
	}

	// Validate ephemeralPk format (should be 64 hex chars = 32 bytes)
	if (!/^[0-9a-fA-F]{64}$/.test(ephemeralPk)) {
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: 'Invalid ephemeral public key format',
		});
		return err('ephemeralPk must be a 64-character hex string (32 bytes)');
	}

	const derivedChannelId = deriveRingCallbackChannelId(ephemeralPk);
	// Decision: bind relay `ch` to the encryption key before any UI or
	// network. A swapped QR with an attacker `ch` and the victim's
	// ephemeralPk (or vice versa) must not reach the sheet.
	if (isAllowedHttpsPaykitCallback(callback)) {
		const callbackCh = extractRelayChannelId(callback);
		if (callbackCh === null || callbackCh !== derivedChannelId) {
			return rejectInvalidCallback();
		}
	}

	const isHttpsCallback = isAllowedHttpsPaykitCallback(callback);
	// R7: secret+relay required iff https Hypercolor callback. Custom schemes
	// (bitkit://, hypercolor://, …) must not carry them — reject, do not ignore.
	// Missing secret/relay on https is the stale-web-tab case (P4-4), not a
	// generic invalid callback.
	if (isHttpsCallback) {
		if (!isValidPaykitAuthSecret(secret) || !relay || !assertAllowedAuthRelay(relay)) {
			return rejectStaleHypercolorQr();
		}
		// Pin the first-party grant at intake, before the sheet and before
		// any sign-in. Safer than waiting for postPubkyAuthThenLocator, and
		// the sheet never presents attacker `/:rw` as Hypercolor.
		if (!paykitConnectCapSetsEqual(data.params.caps ?? [], [...HYPERCOLOR_EXPECTED_CAPS])) {
			return rejectCapsMismatch();
		}
	} else if (secret || relay) {
		return rejectInvalidCallback();
	}

	const confirmation = await requestPaykitConnectConfirmation({
		pubky,
		destination: formatPaykitConnectDestination(
			callback,
			isHttpsCallback,
			{
				webBrowser: i18n.t('session.webBrowser'),
				appOnDevice: i18n.t('session.appOnThisDevice'),
			},
		),
		deviceId,
		capabilities: parsePaykitConnectCaps(data.params.caps),
		verificationCode: formatRingVerificationCode(derivedChannelId),
		includesWebSession: isHttpsCallback,
	});
	if (confirmation === 'superseded') {
		return ok('superseded');
	}
	if (confirmation === 'denied') {
		showToast({
			type: 'info',
			title: i18n.t('session.paykitConnectDenied'),
			description: i18n.t('session.paykitConnectDenied'),
		});
		return err(i18n.t('session.paykitConnectDenied'));
	}

	try {
		// Step 1: Sign in to homeserver
		console.log('[PaykitConnectAction] Step 1: Signing in to homeserver for pubky:', pubky?.substring(0, 16));
		const signInResult = await signInToHomeserver({
			pubky,
			dispatch,
		});

		if (signInResult.isErr()) {
			console.error('[PaykitConnectAction] Sign-in FAILED:', signInResult.error);
			const errorMessage = getErrorMessage(signInResult.error, i18n.t('errors.signInFailed'));
			showToast({
				type: 'error',
				title: i18n.t('session.signInFailed'),
				description: errorMessage,
			});
			return err(errorMessage);
		}

		const sessionInfo = signInResult.value;
		console.log('[PaykitConnectAction] Sign-in SUCCESS. Session pubky:', sessionInfo.pubky?.substring(0, 16));

		// Step 2: Get Ed25519 secret key for noise key derivation
		const secretKeyResult = await getPubkySecretKey(pubky);
		if (secretKeyResult.isErr()) {
			const errorMessage = getErrorMessage(secretKeyResult.error, i18n.t('errors.failedToGetSecretKey'));
			showToast({
				type: 'error',
				title: i18n.t('errors.failedToGetSecretKey'),
				description: errorMessage,
			});
			return err(errorMessage);
		}

		const { secretKey: ed25519SecretKey } = secretKeyResult.value;

		// Step 3: Derive noise keypairs for epoch 0 (and optionally epoch 1)
		const keypair0 = await deriveX25519Keypair(ed25519SecretKey, deviceId, 0);

		let keypair1: { publicKey: string; secretKey: string } | null = null;
		if (includeEpoch1) {
			keypair1 = await deriveX25519Keypair(ed25519SecretKey, deviceId, 1);
		}

		// Step 4: Derive noise_seed for local epoch derivation
		const noiseSeed = await deriveNoiseSeed(ed25519SecretKey, deviceId);

		// Use secure handoff with encrypted payload
		// Payload is encrypted to Bitkit's ephemeral X25519 public key
		// Only the encrypted envelope is stored on homeserver
		return await handleSecureHandoff({
			pubky,
			sessionInfo,
			deviceId,
			keypair0,
			keypair1,
			noiseSeed,
			callback,
			ed25519SecretKey,
			ephemeralPk,
			caps: data.params.caps,
			secret,
			relay,
			isHttpsCallback,
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error('[PaykitConnectAction] Error:', errorMessage);
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: errorMessage,
		});
		return err(errorMessage);
	}
};

/**
 * Secure handoff: Encrypt and store payload on homeserver, return only request_id
 *
 * Uses SB2 Binary Wire Format for encryption (PUBKY_CRYPTO_SPEC v2.5 Section 7.2):
 * 1. Generates InboxKey (X25519) for stored message delivery
 * 2. Generates AppKey (Ed25519) + AppCert for delegated signing
 * 3. Encrypts payload to Bitkit's ephemeral X25519 key using SB2
 * 4. Signs envelope with owner's Ed25519 key
 * 5. Stores as {"sb2": base64} at /pub/paykit.app/v0/handoff/{request_id}
 * 6. Publishes KeyBinding with InboxKey, TransportKey, AppKey for discoverability
 * 7. Publishes Noise endpoint for encrypted messaging
 */
const handleSecureHandoff = async ({
	pubky,
	sessionInfo,
	deviceId,
	keypair0,
	keypair1,
	noiseSeed,
	callback,
	ed25519SecretKey,
	ephemeralPk,
	caps,
	secret,
	relay,
	isHttpsCallback,
}: {
	pubky: string;
	sessionInfo: { pubky: string; session_secret: string; capabilities: string[] };
	deviceId: string;
	keypair0: { publicKey: string; secretKey: string };
	keypair1: { publicKey: string; secretKey: string } | null;
	noiseSeed: string;
	callback: string;
	ed25519SecretKey: string;
	ephemeralPk: string;
	caps?: string[];
	secret?: string;
	relay?: string;
	isHttpsCallback: boolean;
}): Promise<Result<string>> => {
	// Generate random request ID (256 bits)
	const requestId = await generateRequestId();
	await sweepStaleHandoffBlobs(pubky, ed25519SecretKey);

	// Derive owner peerid (Ed25519 public key) from secret key for spec-compliant AAD
	let ownerPeeridHex: string;
	try {
		ownerPeeridHex = await ed25519PublicFromSecret(ed25519SecretKey);
	} catch (e) {
		const errorMessage = e instanceof Error ? e.message : 'Failed to derive owner peerid';
		console.error('[PaykitConnectAction] Failed to derive owner peerid:', errorMessage);
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: 'Failed to derive owner identity',
		});
		return err(errorMessage);
	}

	// Generate InboxKey for stored message delivery (SB2)
	let inboxKeypair: { secretKey: string; publicKey: string };
	try {
		inboxKeypair = await x25519GenerateKeypair();
		console.log('[PaykitConnectAction] Generated InboxKey:', inboxKeypair.publicKey.substring(0, 16) + '...');
	} catch (e) {
		const errorMessage = e instanceof Error ? e.message : 'Failed to generate InboxKey';
		console.error('[PaykitConnectAction] InboxKey generation failed:', errorMessage);
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: 'Failed to generate inbox key',
		});
		return err(errorMessage);
	}

	// Generate AppKey for delegated signing (PUBKY_UNIFIED_KEY_DELEGATION_SPEC)
	let appKey: HandoffPayload['app_key'];
	try {
		// Generate Ed25519 keypair for the app
		const appKeypair = await generateAppKeypair();
		
		// Issue an AppCert signed by the root identity
		const certResult = await issueAppCert(
			ed25519SecretKey,
			'paykit',
			appKeypair.publicKey,
			keypair0.publicKey, // TransportKey
			inboxKeypair.publicKey, // InboxKey
			isHexString(deviceId) ? deviceId : stringToHex(deviceId),
			['paykit:*'], // Full Paykit scope
			null, // No expiry for now
		);

		appKey = {
			ed25519_sk: appKeypair.secretKey,
			ed25519_pk: appKeypair.publicKey,
			cert_id: certResult.certIdHex,
			cert_body: certResult.certBodyHex,
			cert_sig: certResult.sigHex,
		};
		console.log('[PaykitConnectAction] Issued AppCert with ID:', certResult.certIdHex.substring(0, 16) + '...');
	} catch (e) {
		const errorMessage = e instanceof Error ? e.message : 'Failed to generate AppKey';
		console.error('[PaykitConnectAction] AppKey generation failed:', errorMessage);
		// AppKey is optional, continue without it
		console.warn('[PaykitConnectAction] Continuing without AppKey');
	}

	// Build handoff payload
	const noiseKeypairs = [{ epoch: 0, public_key: keypair0.publicKey, secret_key: keypair0.secretKey }];
	if (keypair1) {
		noiseKeypairs.push({ epoch: 1, public_key: keypair1.publicKey, secret_key: keypair1.secretKey });
	}

	// Use Unix seconds per PUBKY_CRYPTO_SPEC
	const nowSeconds = Math.floor(Date.now() / 1000);
	const payload: HandoffPayload = {
		version: 3, // Version 3 includes InboxKey and AppKey
		pubky: sessionInfo.pubky,
		...(isHttpsCallback
			? {}
			: {
				session_secret: sessionInfo.session_secret,
				capabilities: sessionInfo.capabilities,
			}),
		device_id: deviceId,
		noise_keypairs: noiseKeypairs,
		noise_seed: noiseSeed,
		inbox_keypair: {
			public_key: inboxKeypair.publicKey,
			secret_key: inboxKeypair.secretKey,
		},
		app_key: appKey,
		created_at: nowSeconds,
		expires_at: nowSeconds + 5 * 60, // 5 minute expiry (in seconds)
	};

	// Generate a context ID for the handoff SB2 envelope
	const contextIdHex = await sb2GenerateContextId();
	
	// Encrypt payload using SB2 Binary Wire Format (PUBKY_CRYPTO_SPEC v2.5 Section 7.2)
	// This uses the recipient's ephemeral InboxKey (ephemeralPk) for ECDH
	const storagePath = `/pub/paykit.app/v0/handoff/${requestId}`;
	const payloadJson = JSON.stringify(payload);
	const payloadHex = stringToHex(payloadJson);

	let encryptedEnvelopeBase64: string;
	try {
		// Encrypt with SB2 binary format (PUBKY_CRYPTO_SPEC v2.5 Section 7.2)
		// Note: For handoff, we set recipientPeerid to ownerPeerid because:
		// - The handoff is from Ring to Bitkit, both operating on the same identity
		// - The actual encryption key is ephemeralPk (Bitkit's session key)
		// - Bitkit verifies it owns the ephemeral key, not the recipientPeerid
		encryptedEnvelopeBase64 = await sb2Encrypt(
			ephemeralPk,    // recipientInboxPkHex - Bitkit's ephemeral X25519 public key
			payloadHex,     // plaintextHex
			contextIdHex,   // contextIdHex (32 bytes random)
			`handoff-${requestId}`, // msgId (idempotency key)
			'handoff',      // purpose
			ownerPeeridHex, // ownerPeeridHex - identity that owns the homeserver storage
			ownerPeeridHex, // senderPeeridHex - Ring sends on behalf of owner
			ownerPeeridHex, // recipientPeeridHex - same identity (Ring-to-Bitkit on same account)
			storagePath,    // canonicalPath - path binding for AAD
			nowSeconds,     // createdAt
			nowSeconds + 5 * 60, // expiresAt (5 minutes)
			null,           // certIdHex (no delegated signing for handoff itself)
		);

		// Sign the envelope with the owner's Ed25519 key
		encryptedEnvelopeBase64 = await sb2Sign(
			encryptedEnvelopeBase64,
			ed25519SecretKey,
			ownerPeeridHex,
			storagePath,
		);
		console.log('[PaykitConnectAction] Created SB2 envelope, base64 length:', encryptedEnvelopeBase64.length);
	} catch (encryptError) {
		const errorMessage = encryptError instanceof Error ? encryptError.message : 'Encryption failed';
		console.error('[PaykitConnectAction] SB2 encryption error:', errorMessage);
		// Fallback to JSON format for backward compatibility
		console.warn('[PaykitConnectAction] Falling back to JSON sealed blob format');
		try {
			const jsonEnvelope = await sealedBlobEncryptWithContext(
				ephemeralPk,
				payloadHex,
				ownerPeeridHex,
				storagePath,
				'handoff',
			);
			// Store JSON envelope directly (not base64)
			const handoffPath = `pubky://${pubky}/pub/paykit.app/v0/handoff/${requestId}`;
			const envelopeObj = JSON.parse(jsonEnvelope);
			const putResult = await put(handoffPath, envelopeObj, ed25519SecretKey);
			if (putResult.isErr()) {
				throw new Error(`PUT failed: ${putResult.error}`);
			}
			// Continue with callback (skip SB2 storage below)
			return await completeHandoffCallback(pubky, sessionInfo, requestId, keypair0, deviceId, nowSeconds, callback, ed25519SecretKey, caps, secret, relay);
		} catch (fallbackError) {
			const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : 'Fallback failed';
			showToast({
				type: 'error',
				title: i18n.t('common.error'),
				description: 'Failed to encrypt handoff payload',
			});
			return err(fallbackMsg);
		}
	}

	// Store SB2 envelope at /pub/paykit.app/v0/handoff/{request_id}
	// The content is stored as a JSON object with { sb2: <base64> } wrapper
	// This allows the homeserver to store binary data as JSON
	const handoffPath = `pubky://${pubky}/pub/paykit.app/v0/handoff/${requestId}`;
	const sb2Wrapper = { sb2: encryptedEnvelopeBase64, created_at: nowSeconds };
	console.log(
		'[PaykitConnectAction] Storing SB2 handoff, requestId:',
		requestId.substring(0, 8)
	);
	const putResult = await put(handoffPath, sb2Wrapper, ed25519SecretKey);
	if (putResult.isErr()) {
		// Extract all possible error info - handle various error formats
		const errorObj = putResult.error;
		let errorDetails = '';
		if (typeof errorObj === 'string') {
			// String error message
			errorDetails = errorObj;
		} else if (errorObj instanceof Error) {
			// Native Error object - message property is non-enumerable
			errorDetails = errorObj.message || errorObj.name || 'Unknown Error';
		} else if (errorObj && typeof errorObj === 'object') {
			// Object - try to extract message property first
			const msg = (errorObj as Record<string, unknown>).message || 
			            (errorObj as Record<string, unknown>).error ||
			            (errorObj as Record<string, unknown>).description;
			if (msg && typeof msg === 'string') {
				errorDetails = msg;
			} else {
				// Fallback to JSON stringify
				errorDetails = JSON.stringify(errorObj);
			}
		}
		console.error('[PaykitConnectAction] PUT failed. Error type:', typeof errorObj, 'Details:', errorDetails);
		// Show detailed error in toast for debugging
		const errorMessage = errorDetails || 'Failed to store handoff payload (unknown error)';
		showToast({
			type: 'error',
			title: 'PUT Failed',
			description: errorMessage.substring(0, 200),
		});
		return err(errorMessage);
	}

	// Publish KeyBinding at /pub/paykit.app/v0/keybinding
	// Contains InboxKey for stored delivery and TransportKey for Noise sessions
	const keybindingPath = `pubky://${pubky}/pub/paykit.app/v0/keybinding`;
	const keybinding = {
		inbox_keys: [{
			inbox_kid: await computeInboxKid(inboxKeypair.publicKey),
			x25519_pub: inboxKeypair.publicKey,
		}],
		transport_keys: [{
			x25519_pub: keypair0.publicKey,
		}],
		app_keys: appKey ? [{
			cert_id: appKey.cert_id,
			ed25519_pub: appKey.ed25519_pk,
		}] : [],
	};
	
	const keybindingResult = await put(keybindingPath, keybinding, ed25519SecretKey);
	if (keybindingResult.isErr()) {
		console.warn(
			'[PaykitConnectAction] Failed to publish KeyBinding:',
			getErrorMessage(keybindingResult.error, 'Unknown error')
		);
		// Continue anyway - Bitkit can publish this later
	} else {
		console.log('[PaykitConnectAction] Published KeyBinding at:', keybindingPath);
	}

	// Publish Noise endpoint for discoverability by other Paykit clients
	// This enables encrypted subscription proposals and payment requests
	// The host/port are placeholders - Bitkit will update when starting its Noise server
	// Schema must match PaykitMobile FFI NoiseEndpointData: { host, port, pubkey, metadata? }
	const noiseEndpointPath = `pubky://${pubky}/pub/paykit.app/v0/noise`;
	const noiseEndpoint = {
		host: 'pending',
		port: 0,
		pubkey: keypair0.publicKey,
		metadata: JSON.stringify({
			provisioned_by: 'ring-handoff',
			device_id: deviceId,
			created_at: nowSeconds,
		}),
	};

	const noiseResult = await put(noiseEndpointPath, noiseEndpoint, ed25519SecretKey);
	if (noiseResult.isErr()) {
		// Log but don't fail - the handoff payload is already stored
		// Bitkit can retry publishing the Noise endpoint later
		console.warn(
			'[PaykitConnectAction] Failed to publish Noise endpoint:',
			getErrorMessage(noiseResult.error, 'Unknown error')
		);
	}

	return await completeHandoffCallback(pubky, sessionInfo, requestId, keypair0, deviceId, nowSeconds, callback, ed25519SecretKey, caps, secret, relay);
};

/**
 * Compute inbox_kid from inbox public key (SHA256 first 16 bytes)
 */
const computeInboxKid = async (inboxPkHex: string): Promise<string> => {
	return nativeComputeInboxKid(inboxPkHex);
};

/**
 * `ch` from the QR query. parseQueryPairs (first `=` only) — never
 * URLSearchParams / URL.search, which RN 0.83 truncates on embedded `=`.
 * Charset is the web's unpadded base64url channel digest; empty, oversize,
 * or any other character fails closed before fetch.
 */
const extractRelayChannelId = (callback: string): string | null => {
	const queryStart = callback.indexOf('?');
	if (queryStart === -1) {
		return null;
	}
	const ch = parseQueryPairs(callback.slice(queryStart)).get('ch');
	if (ch === null || !RELAY_CHANNEL_ID_RE.test(ch)) {
		return null;
	}
	return ch;
};

const rejectRelayPostFailed = (chPrefix: string, status: string | number): Result<string> => {
	// Log only ch prefix + status. Never the locator body or full ch.
	console.log('[PaykitConnectAction] Relay POST ch prefix:', chPrefix, 'status:', status);
	showToast({
		type: 'error',
		title: i18n.t('common.error'),
		description: i18n.t('session.webHandoffRelayFailed'),
		kind: PAYKIT_CONNECT_RELAY_FAILURE_TOAST,
	});
	return err('Relay post failed');
};

const rejectAuthPostFailed = (): Result<string> => {
	showToast({
		type: 'error',
		title: i18n.t('common.error'),
		description: i18n.t('session.paykitConnectAuthFailed'),
	});
	return err(i18n.t('session.paykitConnectAuthFailed'));
};

const rejectCapsMismatch = (): Result<string> => {
	showToast({
		type: 'error',
		title: i18n.t('common.error'),
		description: i18n.t('session.paykitConnectCapsMismatch'),
	});
	return err(i18n.t('session.paykitConnectCapsMismatch'));
};

/**
 * POST the public locator to httprelay. Body field names match
 * Hypercolor publishHandoffParamsToRelay / validateHandoffPublicParams:
 * pubky, request_id, mode, homeserver. No secrets.
 * Combined https grant uses mode "secure_handoff+pubkyauth" (R6/design).
 * Linking.openURL is never called on this path — not even as fallback.
 */
const publishHttpsHandoffToRelay = async ({
	pubky,
	requestId,
	homeserver,
	callback,
	mode,
	ed25519SecretKey,
}: {
	pubky: string;
	requestId: string;
	homeserver: string;
	callback: string;
	mode: 'secure_handoff' | 'secure_handoff+pubkyauth';
	ed25519SecretKey: string;
}): Promise<Result<string>> => {
	const ch = extractRelayChannelId(callback);
	if (ch === null) {
		return rejectInvalidCallback();
	}

	const chPrefix = ch.substring(0, 8);
	const relayUrl = `${HYPERCOLOR_HTTP_RELAY_BASE}/${RELAY_CHANNEL_PREFIX}${ch}`;
	const body = JSON.stringify({
		pubky,
		request_id: requestId,
		mode,
		homeserver,
	});

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), RELAY_POST_TIMEOUT_MS);
	try {
		const response = await fetch(relayUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body,
			signal: controller.signal,
			redirect: 'error',
		});
		if (response.status < 200 || response.status >= 300) {
			return rejectRelayPostFailed(chPrefix, response.status);
		}
		console.log('[PaykitConnectAction] Relay POST ch prefix:', chPrefix, 'status:', response.status);
		// Do not DELETE now: the web learns requestId from this locator
		// then GETs the blob (404 retries). Immediate delete races login.
		// This requestId is removed at expires_at if Ring is still alive.
		scheduleDeferredHandoffDelete(
			handoffBlobUrl(pubky, requestId),
			ed25519SecretKey,
		);
		showToast({
			type: 'success',
			title: i18n.t('session.success'),
			description: i18n.t('session.webHandoffApproved'),
		});
		return ok(pubky);
	} catch {
		return rejectRelayPostFailed(chPrefix, 'error');
	} finally {
		clearTimeout(timeoutId);
	}
};

const postPubkyAuthThenLocator = async ({
	pubky,
	requestId,
	homeserver,
	callback,
	ed25519SecretKey,
	caps,
	secret,
	relay,
}: {
	pubky: string;
	requestId: string;
	homeserver: string;
	callback: string;
	ed25519SecretKey: string;
	caps: string[] | undefined;
	secret: string;
	relay: string;
}): Promise<Result<string>> => {
	if (!assertAllowedAuthRelay(relay) || !isValidPaykitAuthSecret(secret)) {
		return rejectInvalidCallback();
	}

	const qrCaps = (caps ?? []).slice();
	if (!paykitConnectCapSetsEqual(qrCaps, [...HYPERCOLOR_EXPECTED_CAPS])) {
		return rejectCapsMismatch();
	}
	const authUrl = buildPubkyAuthUrl(qrCaps, secret, relay);
	// Native signer signs Capabilities::from(&url), so URL caps == token caps.
	const echoedCaps = parsePubkyAuthUrlCaps(authUrl);
	if (echoedCaps === null || !paykitConnectCapSetsEqual(echoedCaps, qrCaps)) {
		return rejectCapsMismatch();
	}
	const urlCaps = serializePaykitConnectCaps(qrCaps).split(',').filter(Boolean);
	if (!paykitConnectCapSetsEqual(urlCaps, qrCaps)) {
		return rejectCapsMismatch();
	}

	const authRes = await signAndPostAuthToken({
		authUrl,
		secretKey: ed25519SecretKey,
	});
	if (authRes.isErr()) {
		await deleteHandoffBlobBestEffort(handoffBlobUrl(pubky, requestId), ed25519SecretKey);
		return rejectAuthPostFailed();
	}

	const granted = grantedCapsFromAuthResult(authRes.value);
	// Native auth() does not return granted caps (success → []). Skip that
	// compare when unknown; URL vs sheet self-check above remains.
	if (granted.length > 0 && !paykitConnectCapSetsEqual(granted, qrCaps)) {
		return rejectCapsMismatch();
	}

	return await publishHttpsHandoffToRelay({
		pubky,
		requestId,
		homeserver,
		callback,
		mode: 'secure_handoff+pubkyauth',
		ed25519SecretKey,
	});
};

/**
 * Complete the handoff: https → auth POST then locator POST (never open a browser);
 * custom scheme → Linking.openURL (same-device). Combined secret/relay are
 * https-only (R7).
 */
const completeHandoffCallback = async (
	pubky: string,
	sessionInfo: { pubky: string; session_secret: string; capabilities: string[] },
	requestId: string,
	keypair0: { publicKey: string; secretKey: string },
	deviceId: string,
	nowSeconds: number,
	callback: string,
	ed25519SecretKey: string,
	caps: string[] | undefined,
	secret: string | undefined,
	relay: string | undefined,
): Promise<Result<string>> => {
	if (!isAllowedPaykitCallback(callback)) {
		return rejectInvalidCallback();
	}

	const pubkyData = getPubkyDataFromStore(sessionInfo.pubky);
	const homeserverPubkey = pubkyData?.homeserver || DEFAULT_HOMESERVER;

	// Web QR: Ring cannot tell which device served the page. Post the
	// locator to the channel the page is already polling. Never openURL.
	if (isAllowedHttpsPaykitCallback(callback)) {
		if (!secret || !relay) {
			return rejectStaleHypercolorQr();
		}
		return await postPubkyAuthThenLocator({
			pubky: sessionInfo.pubky,
			requestId,
			homeserver: homeserverPubkey,
			callback,
			ed25519SecretKey,
			caps,
			secret,
			relay,
		});
	}

	const callbackScheme = parseCallbackScheme(callback) ?? 'unknown';
	const requestIdPrefix = requestId.substring(0, 8);

	// Custom-scheme: same-device. Homeserver is needed for iOS which
	// doesn't have pkarr resolution.
	const callbackParams: Record<string, string> = {
		pubky: sessionInfo.pubky,
		request_id: requestId,
		mode: 'secure_handoff',
		homeserver: homeserverPubkey,
	};

	const callbackUrl = buildCallbackUrl(callback, callbackParams);
	console.log(
		'[PaykitConnectAction] Callback URL scheme:',
		callbackScheme,
		'requestId:',
		requestIdPrefix
	);
	console.log('[PaykitConnectAction] Callback params: requestId prefix', requestIdPrefix);

	const canOpen = await Linking.canOpenURL(callbackUrl);
	if (!canOpen) {
		showToast({
			type: 'error',
			title: i18n.t('common.error'),
			description: i18n.t('session.cannotOpenCallback'),
		});
		return err('Cannot open callback URL');
	}

	await Linking.openURL(callbackUrl);

	showToast({
		type: 'success',
		title: 'Paykit Connected',
		description: 'Secure handoff initiated',
	});

	return ok(pubky);
};

/**
 * Builds the callback URL with parameters as query string
 */
const buildCallbackUrl = (
	baseCallback: string,
	params: Record<string, string>
): string => {
	const separator = baseCallback.includes('?') ? '&' : '?';
	const queryParams = new URLSearchParams(params).toString();
	return `${baseCallback}${separator}${queryParams}`;
};
