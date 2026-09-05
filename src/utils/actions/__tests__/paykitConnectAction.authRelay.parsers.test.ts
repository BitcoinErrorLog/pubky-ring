/**
 * Accept/reject matrix for assertAllowedAuthRelay under both
 * Node's WHATWG URL (Jest default) and React Native 0.83's regex URL.
 */

import { assertAllowedAuthRelay } from '../paykitConnectAction';

const ACCEPTED_AUTH_RELAYS = [
	'https://httprelay.pubky.app/link/',
	'https://httprelay.pubky.app/link',
	'HTTPS://HTTPRELAY.PUBKY.APP/link/',
	'HTTPS://httprelay.pubky.app/link',
] as const;

const REJECTED_AUTH_RELAYS = [
	'https://httprelay.pubky.app.evil.com/link/',
	'https://evil@httprelay.pubky.app/link/',
	'https://httprelay.pubky.app:443/link/',
	'https://httprelay.pubky.app/link/../x',
	'http://httprelay.pubky.app/link/',
	'https://httprelay.pubky.app/link/?q=1',
	'https://httprelay.pubky.app/link/#frag',
	'https://httprelay.pubky.app/link?x=1',
	'https://evil.com/link/',
	'https://httprelay.pubky.app./link/',
	'https://user:pass@httprelay.pubky.app/link/',
	'https://httprelay.pubky.app/link/extra',
] as const;

const MATRIX = [
	...ACCEPTED_AUTH_RELAYS.map((url) => ({ url, allowed: true })),
	...REJECTED_AUTH_RELAYS.map((url) => ({ url, allowed: false })),
];

const evaluateMatrix = (): Array<{ url: string; allowed: boolean; actual: boolean }> =>
	MATRIX.map(({ url, allowed }) => ({
		url,
		allowed,
		actual: assertAllowedAuthRelay(url),
	}));

describe('assertAllowedAuthRelay (Node WHATWG URL)', () => {
	it.each([...ACCEPTED_AUTH_RELAYS])('accepts %s', (relay) => {
		expect(assertAllowedAuthRelay(relay)).toBe(true);
	});

	it.each([...REJECTED_AUTH_RELAYS])('rejects %s', (relay) => {
		expect(assertAllowedAuthRelay(relay)).toBe(false);
	});
});

describe('assertAllowedAuthRelay (React Native URL)', () => {
	const originalURL = global.URL;

	beforeAll(() => {
		jest.isolateModules(() => {
			jest.doMock(
				require.resolve('react-native/Libraries/Blob/NativeBlobModule'),
				() => ({
					__esModule: true,
					default: null,
				})
			);
			const { URL: ReactNativeURL } = require('react-native/Libraries/Blob/URL');
			global.URL = ReactNativeURL;
		});
	});

	afterAll(() => {
		global.URL = originalURL;
	});

	it.each([...ACCEPTED_AUTH_RELAYS])('accepts %s', (relay) => {
		expect(assertAllowedAuthRelay(relay)).toBe(true);
	});

	it.each([...REJECTED_AUTH_RELAYS])('rejects %s', (relay) => {
		expect(assertAllowedAuthRelay(relay)).toBe(false);
	});
});

describe('auth relay parser agreement', () => {
	it('Node URL and RN URL agree on every matrix case', () => {
		const nodeResults = evaluateMatrix();

		const originalURL = global.URL;
		let rnResults: ReturnType<typeof evaluateMatrix>;
		try {
			jest.isolateModules(() => {
				jest.doMock(
					require.resolve('react-native/Libraries/Blob/NativeBlobModule'),
					() => ({
						__esModule: true,
						default: null,
					})
				);
				const { URL: ReactNativeURL } = require('react-native/Libraries/Blob/URL');
				global.URL = ReactNativeURL;
			});
			rnResults = evaluateMatrix();
		} finally {
			global.URL = originalURL;
		}

		expect(nodeResults).toHaveLength(MATRIX.length);
		expect(rnResults).toHaveLength(MATRIX.length);
		for (let i = 0; i < MATRIX.length; i += 1) {
			expect({
				url: MATRIX[i].url,
				node: nodeResults[i].actual,
				rn: rnResults[i].actual,
			}).toEqual({
				url: MATRIX[i].url,
				node: MATRIX[i].allowed,
				rn: MATRIX[i].allowed,
			});
		}
	});
});
