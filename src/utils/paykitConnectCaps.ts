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

/**
 * Destination line for the confirmation sheet.
 * https → "hypercolor.app — web browser"
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
