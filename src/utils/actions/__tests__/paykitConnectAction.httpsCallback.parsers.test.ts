/**
 * Accept/reject matrix for isAllowedHttpsPaykitCallback under both
 * Node's WHATWG URL (Jest default) and React Native 0.83's regex URL.
 * The two parsers must agree on every case.
 */

import { isAllowedHttpsPaykitCallback } from '../paykitConnectAction';

const ACCEPTED_HTTPS_CALLBACKS = [
	'https://hypercolor.app/ring-callback?ch=abc',
	'https://www.hypercolor.app/ring-callback?ch=abc',
	'HTTPS://hypercolor.app/ring-callback?ch=abc',
	'https://hypercolor.app/ring-callback?ch=x:443',
] as const;

const REJECTED_HTTPS_CALLBACKS = [
	'https://hypercolor.app/ring-callback',
	'https://www.hypercolor.app/ring-callback',
	'http://hypercolor.app/ring-callback',
	'https://hypercolor.app.evil.com/ring-callback',
	'https://evil.com/ring-callback',
	'https://hypercolor.app:8443/ring-callback',
	'https://user@hypercolor.app/ring-callback',
	'https://hypercolor.app/ring-callback/../x',
	'https://hypercolor.app/ring-callback#frag',
	'https://hypercolor.app/RING-CALLBACK',
	'https://hypercolor.app/ring-callback%2F..',
	'https://hypercolor.app:443/ring-callback',
	'https://hypercolor.app/ring-callback/../ring-callback',
	'https://hypercolor.app./ring-callback',
	'https://hypercolor.app/ring-callback/',
	'HTTPS://evil.com/ring-callback',
	'https://xn--hyprcolor-n7a.app/ring-callback',
] as const;

const MATRIX = [
	...ACCEPTED_HTTPS_CALLBACKS.map((url) => ({ url, allowed: true })),
	...REJECTED_HTTPS_CALLBACKS.map((url) => ({ url, allowed: false })),
];

const evaluateMatrix = (): Array<{ url: string; allowed: boolean; actual: boolean }> =>
	MATRIX.map(({ url, allowed }) => ({
		url,
		allowed,
		actual: isAllowedHttpsPaykitCallback(url),
	}));

describe('isAllowedHttpsPaykitCallback (Node WHATWG URL)', () => {
	it.each([...ACCEPTED_HTTPS_CALLBACKS])('accepts %s', (callback) => {
		expect(isAllowedHttpsPaykitCallback(callback)).toBe(true);
	});

	it.each([...REJECTED_HTTPS_CALLBACKS])('rejects %s', (callback) => {
		expect(isAllowedHttpsPaykitCallback(callback)).toBe(false);
	});
});

describe('isAllowedHttpsPaykitCallback (React Native URL)', () => {
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

	it.each([...ACCEPTED_HTTPS_CALLBACKS])('accepts %s', (callback) => {
		expect(isAllowedHttpsPaykitCallback(callback)).toBe(true);
	});

	it.each([...REJECTED_HTTPS_CALLBACKS])('rejects %s', (callback) => {
		expect(isAllowedHttpsPaykitCallback(callback)).toBe(false);
	});
});

describe('https callback parser agreement', () => {
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
