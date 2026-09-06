import { parseQueryPairs } from './queryParams';

/**
 * First-party https Hypercolor grant. Mirrors web RING_GRANT_CAPABILITIES
 * (`hypercolor-web` `src/types/link.ts`). Ring pins this set on the
 * https path and on combined `hypercolor://` (secret+relay) before the
 * confirmation sheet so a QR cannot impersonate Hypercolor with `/:rw`
 * (P2-1). Other custom-scheme callbacks stay unbounded.
 */
export const HYPERCOLOR_EXPECTED_CAPS = [
	'/pub/paykit/:rw',
	'/pub/hypercolor.app/v1/:rw',
] as const;

/**
 * Paykit-connect `caps` query → ConfirmAuth-shaped { path, permission }.
 *
 * Hypercolor sends `/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw`.
 * Decision: last `:([rw]+)` is the permission, matching ConfirmAuth's
 * `capability.permission.includes('r'|'w')` renderer. Anything else is
 * shown as a path with empty permission rather than dropped.
 */

export type PaykitConnectCapability = {
	path: string;
	permission: string;
};

export const parsePaykitConnectCaps = (caps: string[] | undefined): PaykitConnectCapability[] => {
	if (!caps || caps.length === 0) {
		return [];
	}
	return caps.map((raw) => {
		const match = raw.match(/^(.*):([rw]+)$/);
		if (match) {
			return { path: match[1], permission: match[2] };
		}
		return { path: raw, permission: '' };
	});
};

/** wr → rw (Rust capability order). Used for QR vs granted-set compare. */
export const normalizeCapabilityAction = (permission: string): string => {
	if (permission === 'wr') {
		return 'rw';
	}
	return permission;
};

export const canonicalizePaykitConnectCap = (raw: string): string => {
	const match = raw.match(/^(.*):([rw]+)$/);
	if (!match) {
		return raw;
	}
	return `${match[1]}:${normalizeCapabilityAction(match[2])}`;
};

export const serializePaykitConnectCaps = (caps: string[] | undefined): string => {
	if (!caps || caps.length === 0) {
		return '';
	}
	return caps.map(canonicalizePaykitConnectCap).join(',');
};

/**
 * Echo-parse a `pubkyauth:///` URL's `caps` query with the same first-`=`
 * pair decoder Ring uses for deeplink QRs (`parseQueryPairs`). Native
 * `parseAuthUrl` reads the same query; the Rust signer signs
 * `Capabilities::from(&url)`, so URL caps == token caps.
 */
export const parsePubkyAuthUrlCaps = (authUrl: string): string[] | null => {
	const trimmed = authUrl.trim();
	if (!trimmed.toLowerCase().startsWith('pubkyauth:')) {
		return null;
	}
	const queryStart = trimmed.indexOf('?');
	if (queryStart === -1) {
		return [];
	}
	const caps = parseQueryPairs(trimmed.slice(queryStart)).get('caps');
	if (caps === null || caps === '') {
		return [];
	}
	return caps.split(',').map((item) => item.trim()).filter(Boolean);
};

export const paykitConnectCapSetsEqual = (a: string[], b: string[]): boolean => {
	if (a.length !== b.length) {
		return false;
	}
	const left = new Set(a.map(canonicalizePaykitConnectCap));
	const right = new Set(b.map(canonicalizePaykitConnectCap));
	if (left.size !== right.size) {
		return false;
	}
	for (const item of left) {
		if (!right.has(item)) {
			return false;
		}
	}
	return true;
};

/** Design §3 scope annotation. Empty when the path is not a known grant. */
export const annotatePaykitConnectCap = (path: string): string => {
	if (path === '/pub/paykit/' || path === '/pub/paykit') {
		return 'DMs / Paykit';
	}
	if (path.startsWith('/pub/hypercolor.app/')) {
		return 'this site';
	}
	return '';
};

/**
 * Destination line for the confirmation sheet.
 * https → "hypercolor.app — web browser via Pubky HTTP relay"
 * custom scheme → "hypercolor:// app on this device"
 */
export const formatPaykitConnectDestination = (
	callback: string,
	isHttps: boolean,
	labels: { webBrowser: string; appOnDevice: string },
): string => {
	if (isHttps) {
		try {
			const host = new URL(callback.trim()).hostname.toLowerCase();
			if (host) {
				return `${host} — ${labels.webBrowser}`;
			}
		} catch {
			// Fall through to the raw-authority parse used by the allowlist.
		}
		const raw = callback.trim().match(/^https:\/\/([^/?#]+)/i);
		const host = (raw?.[1] ?? '').toLowerCase();
		return host ? `${host} — ${labels.webBrowser}` : callback;
	}
	const schemeMatch = callback.trim().match(/^([a-z][a-z0-9+.-]*):\/\//i);
	const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : 'app';
	return `${scheme}:// ${labels.appOnDevice}`;
};
