/**
 * Deep-link query parser that splits each pair on the first `=` only.
 *
 * parseInput's whole-string decodeURIComponent loop (up to 3 passes) turns
 * a callback's `%3F` / `%3D` into literal `?` / `=` before this runs.
 * React Native 0.83's URLSearchParams then does `pair.split('=')` and keeps
 * only the first two segments, so `callback=https://host/path?ch=ID` becomes
 * callback=`https://host/path?ch` and the channel id is lost.
 *
 * Duplicate keys: first occurrence wins. An encoded `&key=evil` inside a
 * value can become a real pair after the pre-decode; first-wins then keeps
 * an earlier legitimate key and ignores the injected later one.
 */

export type QueryParamReader = {
	get(name: string): string | null;
};

const decodeQueryComponent = (part: string): string => {
	try {
		return decodeURIComponent(part);
	} catch {
		return part;
	}
};

export const parseQueryPairs = (queryString: string): QueryParamReader => {
	const map = new Map<string, string>();
	const stripped = queryString.startsWith('?') ? queryString.slice(1) : queryString;
	if (stripped) {
		for (const pair of stripped.split('&')) {
			if (!pair) {
				continue;
			}
			const eq = pair.indexOf('=');
			const rawKey = eq === -1 ? pair : pair.slice(0, eq);
			const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
			const key = decodeQueryComponent(rawKey.replace(/\+/g, ' '));
			const value = decodeQueryComponent(rawValue.replace(/\+/g, ' '));
			if (!map.has(key)) {
				map.set(key, value);
			}
		}
	}

	return {
		get(name: string): string | null {
			return map.has(name) ? map.get(name)! : null;
		},
	};
};
