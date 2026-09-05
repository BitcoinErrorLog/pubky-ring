/**
 * Native-contract tests: mock ONLY NativeModules.Pubky.auth with real
 * create_response_vector payloads. The real JS wrapper must run.
 */

import { ok } from '@synonymdev/result';
import { deriveRingCallbackChannelId } from '../../ringCallbackChannel';
import {
	paykitConnectCapSetsEqual,
} from '../../paykitConnectCaps';

const mockNativeAuth = jest.fn();

jest.mock('react-native', () => ({
	Linking: {
		openURL: jest.fn().mockResolvedValue(undefined),
		canOpenURL: jest.fn().mockResolvedValue(true),
	},
	Platform: {
		OS: 'ios',
		select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default,
	},
	Dimensions: { get: () => ({ width: 400, height: 800 }) },
	Share: { share: jest.fn() },
	NativeEventEmitter: class {
		addListener(): { remove: () => void } {
			return { remove: (): void => undefined };
		}
		removeAllListeners(): void {
			return undefined;
		}
	},
	NativeModules: {
		Pubky: {
			auth: (...args: unknown[]) => mockNativeAuth(...args),
			put: jest.fn().mockResolvedValue(['success', 'stored-url']),
		},
	},
}));

jest.mock('@synonymdev/react-native-pubky', () => {
	const actual = jest.requireActual(
		'../../../../node_modules/@synonymdev/react-native-pubky/lib/commonjs/index.js',
	);
	const { ok: mockOk } = jest.requireActual('@synonymdev/result');
	return {
		...actual,
		put: jest.fn().mockResolvedValue(mockOk(undefined)),
	};
});

jest.mock('../../pubky', () => {
	const actual = jest.requireActual('../../pubky');
	return {
		...actual,
		signInToHomeserver: jest.fn(),
		getPubkySecretKey: jest.fn(),
	};
});

jest.mock('../../PubkyNoiseModule', () => ({
	deriveX25519ForDeviceEpoch: jest.fn(),
	deriveNoiseSeed: jest.fn(),
	isNativeModuleAvailable: jest.fn(() => true),
	sealedBlobEncrypt: jest.fn(),
	sealedBlobEncryptWithContext: jest.fn(),
	ed25519PublicFromSecret: jest.fn(),
	x25519GenerateKeypair: jest.fn(),
	generateAppKeypair: jest.fn(),
	issueAppCert: jest.fn(),
	computeInboxKid: jest.fn(),
	sb2Encrypt: jest.fn(),
	sb2Sign: jest.fn(),
	sb2GenerateContextId: jest.fn(),
}));

jest.mock('../../e2eAutoApprove', () => ({
	isE2EAutoApproveEnabled: jest.fn(),
}));

jest.mock('../../constants', () => ({
	...jest.requireActual('../../constants'),
	AUTH_SHEET_DELAY: 0,
}));

jest.mock('../../helpers', () => {
	const actual = jest.requireActual('../../helpers');
	return {
		...actual,
		showToast: jest.fn(actual.showToast),
		sleep: jest.fn(() => Promise.resolve()),
	};
});

jest.mock('../../errorHandler', () => ({
	getErrorMessage: jest.fn((errValue, fallback) => errValue?.message || errValue || fallback),
}));

jest.mock('../../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

jest.mock('../../store-helpers', () => ({
	getPubkyDataFromStore: jest.fn(() => ({ homeserver: 'homeserver-z32' })),
}));

jest.mock('react-native-actions-sheet', () => ({
	SheetManager: {
		show: jest.fn((_id: string, options?: { payload?: { onDecision?: (approved: boolean) => void } }) => {
			options?.payload?.onDecision?.(true);
			return Promise.resolve();
		}),
		hide: jest.fn().mockResolvedValue(undefined),
		hideAll: jest.fn().mockResolvedValue(undefined),
		getActiveSheets: jest.fn(() => []),
	},
	registerSheet: jest.fn(),
	default: jest.fn(() => null),
}));

import { handlePaykitConnectAction } from '../paykitConnectAction';
import { InputAction } from '../../inputParser';
import { signInToHomeserver, getPubkySecretKey, signAndPostAuthToken } from '../../pubky';
import {
	deriveX25519ForDeviceEpoch,
	deriveNoiseSeed,
	ed25519PublicFromSecret,
	x25519GenerateKeypair,
	generateAppKeypair,
	issueAppCert,
	computeInboxKid,
	sb2Encrypt,
	sb2Sign,
	sb2GenerateContextId,
} from '../../PubkyNoiseModule';
import { isE2EAutoApproveEnabled } from '../../e2eAutoApprove';
import { put, auth as wrapperAuth } from '@synonymdev/react-native-pubky';
import { showToast } from '../../helpers';

const AUTH_SECRET = 'ERERERERERERERERERERERERERERERERERERERERERE';
const AUTH_RELAY = 'https://httprelay.pubky.app/link/';
const GRANT_CAPS = ['/pub/paykit/:rw', '/pub/hypercolor.app/v1/:rw'];

const mockFetch = jest.fn();
const originalFetch = global.fetch;

/** aba255e: split wrapper string, then treat unknown tokens as granted caps. */
const aba255eGrantedCapsFromAuthResult = (value: string[]): string[] => {
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

describe('native auth contract (real JS wrapper)', () => {
	const ephemeralPk = 'a'.repeat(64);
	const callback = `https://hypercolor.app/ring-callback?ch=${deriveRingCallbackChannelId(ephemeralPk)}`;
	const locatorUrl =
		`https://httprelay.pubky.app/link/hc-${deriveRingCallbackChannelId(ephemeralPk)}`;

	const data = {
		action: InputAction.PaykitConnect as const,
		params: {
			deviceId: 'device123',
			callback,
			ephemeralPk,
			caps: GRANT_CAPS,
			secret: AUTH_SECRET,
			relay: AUTH_RELAY,
		},
	};

	const context = {
		dispatch: jest.fn(),
		pubky: 'test-pubky-z32',
		isDeeplink: true,
	};

	beforeEach(() => {
		jest.clearAllMocks();
		(isE2EAutoApproveEnabled as jest.Mock).mockReturnValue(false);
		mockFetch.mockReset();
		global.fetch = mockFetch as unknown as typeof fetch;
		mockFetch.mockResolvedValue({ ok: true, status: 200, type: 'basic' });
		(signInToHomeserver as jest.Mock).mockResolvedValue(ok({
			pubky: 'test-pubky-z32',
			session_secret: 'session-secret-123',
			capabilities: ['/pub:rw'],
		}));
		(getPubkySecretKey as jest.Mock).mockResolvedValue(ok({
			secretKey: 'b'.repeat(64),
			mnemonic: 'test',
		}));
		(deriveX25519ForDeviceEpoch as jest.Mock).mockResolvedValue({
			publicKey: 'c'.repeat(64),
			secretKey: 'd'.repeat(64),
		});
		(deriveNoiseSeed as jest.Mock).mockResolvedValue('e'.repeat(64));
		(ed25519PublicFromSecret as jest.Mock).mockResolvedValue('1'.repeat(64));
		(x25519GenerateKeypair as jest.Mock).mockResolvedValue({
			publicKey: 'h'.repeat(64),
			secretKey: 'i'.repeat(64),
		});
		(generateAppKeypair as jest.Mock).mockResolvedValue({
			publicKey: 'j'.repeat(64),
			secretKey: 'k'.repeat(64),
		});
		(issueAppCert as jest.Mock).mockResolvedValue({
			certIdHex: 'l'.repeat(32),
			certBodyHex: 'm'.repeat(128),
			sigHex: 'n'.repeat(128),
		});
		(computeInboxKid as jest.Mock).mockResolvedValue('o'.repeat(32));
		(sb2GenerateContextId as jest.Mock).mockResolvedValue('p'.repeat(64));
		(sb2Encrypt as jest.Mock).mockResolvedValue('base64encodedSb2Envelope');
		(sb2Sign as jest.Mock).mockResolvedValue('signedBase64Envelope');
		(put as jest.Mock).mockResolvedValue(ok(undefined));
		mockNativeAuth.mockResolvedValue(['false', 'Authorization success']);
	});

	afterAll(() => {
		global.fetch = originalFetch;
	});

	it('F1 aba255e logic rejects the real success payload (would skip locator)', () => {
		const wrapperString = 'Authorization success';
		const split = wrapperString.split(',').map((item) => item.trim()).filter(Boolean);
		const granted = aba255eGrantedCapsFromAuthResult(split);
		expect(granted).toEqual(['Authorization success']);
		expect(paykitConnectCapSetsEqual(granted, GRANT_CAPS)).toBe(false);
	});

	it('wrapper returns ok(string) for both native vectors (res[0] is not error)', async () => {
		mockNativeAuth.mockResolvedValueOnce(['false', 'Authorization success']);
		const success = await wrapperAuth('pubkyauth:///?caps=x', 'sk');
		expect(success.isOk()).toBe(true);
		if (success.isOk()) {
			expect(success.value).toBe('Authorization success');
		}

		mockNativeAuth.mockResolvedValueOnce(['true', 'Authorization failure: relay unreachable']);
		const failure = await wrapperAuth('pubkyauth:///?caps=x', 'sk');
		expect(failure.isOk()).toBe(true);
		if (failure.isOk()) {
			expect(failure.value).toBe('Authorization failure: relay unreachable');
		}
	});

	it('success vector: signAndPostAuthToken is ok([]) then locator POST', async () => {
		const result = await handlePaykitConnectAction(data, context);

		expect(result.isOk()).toBe(true);
		expect(mockNativeAuth).toHaveBeenCalled();
		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(mockFetch.mock.calls[0][0]).toBe(locatorUrl);
	});

	it('regression: real success string must still POST locator (not parse success|ok as caps)', async () => {
		mockNativeAuth.mockResolvedValue(['false', 'Authorization success']);
		const mapped = await signAndPostAuthToken({
			authUrl: 'pubkyauth:///?caps=' + encodeURIComponent(GRANT_CAPS.join(',')),
			secretKey: 'sk',
		});
		expect(mapped.isOk()).toBe(true);
		if (mapped.isOk()) {
			expect(mapped.value).toEqual([]);
			expect(mapped.value).not.toContain('Authorization success');
			expect(mapped.value).not.toContain('success');
		}

		const result = await handlePaykitConnectAction(data, context);
		expect(result.isOk()).toBe(true);
		expect(mockFetch.mock.calls.some((call) => call[0] === locatorUrl)).toBe(true);
	});

	it('failure vector: zero locator POSTs and auth-failed toast', async () => {
		mockNativeAuth.mockResolvedValue(['true', 'Authorization failure: relay unreachable']);

		const result = await handlePaykitConnectAction(data, context);

		expect(result.isErr()).toBe(true);
		expect(mockFetch).not.toHaveBeenCalled();
		expect(showToast).toHaveBeenCalledWith(
			expect.objectContaining({
				description: 'session.paykitConnectAuthFailed',
			}),
		);
	});
});
