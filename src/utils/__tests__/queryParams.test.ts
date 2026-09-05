/**
 * Query pair parser vs React Native 0.83 URLSearchParams.
 *
 * RN 0.83 (`node_modules/react-native/Libraries/Blob/URLSearchParams.js`
 * constructor, lines 27–40) does `const [key, value] = pair.split('=')`,
 * which drops every `=` after the first. This file pins that regression
 * and asserts parseQueryPairs keeps the rest of the value.
 */

import { parseQueryPairs } from '../queryParams';

const HYPERCOLOR_QUERY =
	'deviceId=hypercolor-web-1a070b03cdc&callback=https://hypercolor.app/ring-callback?ch=8eOwP5zDIW4PwXitMsHu3RdUDCF60o3DTwI-firPVT8&ephemeralPk=c9aaad5b10794814e6ca4a5a18ea2aebb0467c83fd45515ab1634910e6a0b172&caps=/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw';

const EXPECTED_CALLBACK =
	'https://hypercolor.app/ring-callback?ch=8eOwP5zDIW4PwXitMsHu3RdUDCF60o3DTwI-firPVT8';

const PAYKIT_CONNECT_MATRIX: Array<{ name: string; query: string; expectedCallback: string | null }> = [
	{
		name: 'hypercolor https callback with ch=',
		query: HYPERCOLOR_QUERY,
		expectedCallback: EXPECTED_CALLBACK,
	},
	{
		name: 'mobile callback with = inside the value',
		query: 'deviceId=d1&callback=hypercolor://paykit-connect-callback?foo=bar&ephemeralPk=aa',
		expectedCallback: 'hypercolor://paykit-connect-callback?foo=bar',
	},
	{
		name: 'leading ? stripped',
		query: '?deviceId=d1&callback=bitkit://paykit-setup',
		expectedCallback: 'bitkit://paykit-setup',
	},
];

/**
 * Exact split used by RN 0.83 URLSearchParams string constructor.
 * Copied from react-native/Libraries/Blob/URLSearchParams.js lines 29–40
 * because the Flow class cannot be required under plain Node, and Jest's
 * RN preset still may not instantiate it without NativeBlobModule.
 */
class ReactNativeUrlSearchParamsOracle {
	_searchParams: Map<string, string[]> = new Map();

	constructor(params: string) {
		params
			.replace(/^\?/, '')
			.split('&')
			.forEach((pair) => {
				if (!pair) {
					return;
				}
				const [key, value] = pair
					.split('=')
					.map((part) => decodeURIComponent(part.replace(/\+/g, ' ')));
				this.append(key, value);
			});
	}

	append(key: string, value: string): void {
		if (!this._searchParams.has(key)) {
			this._searchParams.set(key, [value]);
		} else {
			this._searchParams.get(key)?.push(value);
		}
	}

	get(name: string): string | null {
		const values = this._searchParams.get(name);
		return values ? values[0] : null;
	}
}

describe('parseQueryPairs vs RN Libraries/Blob/URLSearchParams (live import)', () => {
	it('imports RN URLSearchParams when Jest can transform it, else documents the oracle', () => {
		let RnURLSearchParams: (new (params: string) => { get(name: string): string | null }) | undefined;
		try {
			jest.isolateModules(() => {
				const loaded = require('react-native/Libraries/Blob/URLSearchParams');
				RnURLSearchParams = loaded.URLSearchParams || loaded.default || loaded;
			});
		} catch {
			RnURLSearchParams = undefined;
		}

		const ours = parseQueryPairs(HYPERCOLOR_QUERY);
		expect(ours.get('callback')).toBe(EXPECTED_CALLBACK);

		if (RnURLSearchParams) {
			const rn = new RnURLSearchParams(HYPERCOLOR_QUERY);
			expect(rn.get('callback')).toBe('https://hypercolor.app/ring-callback?ch');
		} else {
			const rn = new ReactNativeUrlSearchParamsOracle(HYPERCOLOR_QUERY);
			expect(rn.get('callback')).toBe('https://hypercolor.app/ring-callback?ch');
		}
	});
});

describe('parseQueryPairs', () => {
	describe('paykit-connect matrix vs RN URLSearchParams oracle', () => {
		it.each(PAYKIT_CONNECT_MATRIX)(
			'preserves callback for $name while RN truncates values with extra =',
			({ query, expectedCallback }) => {
				const ours = parseQueryPairs(query);
				const rn = new ReactNativeUrlSearchParamsOracle(query);

				expect(ours.get('callback')).toBe(expectedCallback);

				if (expectedCallback?.includes('=')) {
					expect(rn.get('callback')).not.toBe(expectedCallback);
					expect(rn.get('callback')).toBe(expectedCallback.split('=')[0]);
				}
			}
		);

		it('documents that RN drops the Hypercolor channel id', () => {
			const ours = parseQueryPairs(HYPERCOLOR_QUERY);
			const rn = new ReactNativeUrlSearchParamsOracle(HYPERCOLOR_QUERY);

			expect(ours.get('callback')).toBe(EXPECTED_CALLBACK);
			expect(ours.get('callback')).toContain(
				'ch=8eOwP5zDIW4PwXitMsHu3RdUDCF60o3DTwI-firPVT8'
			);
			// RN: pair.split('=') → ['callback', 'https://hypercolor.app/ring-callback?ch', '8eOw...']
			// destructure keeps only the first two segments.
			expect(rn.get('callback')).toBe('https://hypercolor.app/ring-callback?ch');
		});
	});

	it('keeps the first occurrence for duplicate keys', () => {
		const params = parseQueryPairs('ephemeralPk=GOOD&callback=x&ephemeralPk=evil');
		expect(params.get('ephemeralPk')).toBe('GOOD');
	});

	it('replaces + with space then decodes', () => {
		const params = parseQueryPairs('message=hello+world%21');
		expect(params.get('message')).toBe('hello world!');
	});

	it('keeps raw text when percent-decoding fails', () => {
		const params = parseQueryPairs('callback=https://host/%E0%A4%A');
		expect(params.get('callback')).toBe('https://host/%E0%A4%A');
	});

	it('treats a key with no = as an empty value', () => {
		const params = parseQueryPairs('flag&callback=bitkit://x');
		expect(params.get('flag')).toBe('');
		expect(params.get('callback')).toBe('bitkit://x');
	});

	it('treats an = only pair as empty key and empty value', () => {
		const params = parseQueryPairs('=&callback=bitkit://x');
		expect(params.get('')).toBe('');
		expect(params.get('callback')).toBe('bitkit://x');
	});

	it('returns null for a missing key', () => {
		expect(parseQueryPairs('deviceId=d1').get('callback')).toBeNull();
		expect(parseQueryPairs('').get('callback')).toBeNull();
	});
});
