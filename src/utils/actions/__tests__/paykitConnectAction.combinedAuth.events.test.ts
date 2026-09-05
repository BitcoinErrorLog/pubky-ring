/**
 * Event-faithful combined https grant: one ConfirmPaykitConnect sheet,
 * zero ConfirmAuth, auth POST then locator POST.
 */

import { err, ok } from '@synonymdev/result';
import { deriveRingCallbackChannelId } from '../../ringCallbackChannel';

type SheetHandler = (...args: unknown[]) => void;

type ShowOptions = {
	payload: {
		onDecision: (approved: boolean) => void;
	};
	onClose: () => void;
};

type FaithfulSheetManager = {
	show: (id: string, options?: ShowOptions) => Promise<unknown>;
	hide: (id: string) => Promise<unknown>;
	hideAll: jest.Mock;
	getActiveSheets: (id: string) => Array<{ id: string; context: string }>;
	shows: string[];
	lastOptions: ShowOptions | null;
	reset: () => void;
};

jest.mock('react-native-actions-sheet', () => {
	class EventManager {
		private _registry = new Map<SheetHandler, { name: string }>();

		subscribe(name: string, handler: SheetHandler): { unsubscribe: () => boolean } {
			this._registry.set(handler, { name });
			return { unsubscribe: (): boolean => this._registry.delete(handler) };
		}

		publish(name: string, ...args: unknown[]): void {
			this._registry.forEach((props, handler) => {
				if (props.name === name) {
					handler(...args);
				}
			});
		}
	}

	const actionSheetEventManager = new EventManager();
	const renderedSheetIds: string[] = [];
	const SheetManager: FaithfulSheetManager = {
		shows: [],
		lastOptions: null,
		hideAll: jest.fn(),
		reset(): void {
			renderedSheetIds.length = 0;
			this.lastOptions = null;
			this.shows = [];
		},
		getActiveSheets(id: string): Array<{ id: string; context: string }> {
			return renderedSheetIds
				.filter((key) => key.startsWith(`${id}:`))
				.map((key) => {
					const [sheetId, context] = key.split(':');
					return { id: sheetId, context };
				});
		},
		show(id: string, options?: ShowOptions): Promise<unknown> {
			this.shows.push(id);
			this.lastOptions = options ?? null;
			return new Promise((resolve) => {
				const handler = (data?: unknown, context = 'global'): void => {
					if (context !== 'global') {
						return;
					}
					options?.onClose?.();
					sub.unsubscribe();
					resolve(data);
				};
				const sub = actionSheetEventManager.subscribe(`onclose_${id}`, handler);
				const key = `${id}:global`;
				if (!renderedSheetIds.includes(key)) {
					renderedSheetIds.push(key);
				}
			});
		},
		hide(id: string): Promise<unknown> {
			return new Promise((resolve) => {
				const hideHandler = (data?: unknown, context = 'global'): void => {
					if (context !== 'global') {
						return;
					}
					sub.unsubscribe();
					resolve(data);
				};
				const sub = actionSheetEventManager.subscribe(`onclose_${id}`, hideHandler);
				const key = `${id}:global`;
				const idx = renderedSheetIds.indexOf(key);
				if (idx > -1) {
					renderedSheetIds.splice(idx, 1);
				}
				actionSheetEventManager.publish(`onclose_${id}`, undefined, 'global');
			});
		},
	};

	return {
		SheetManager,
		registerSheet: jest.fn(),
		default: jest.fn(() => null),
	};
});

jest.mock('react-native', () => ({
	Linking: {
		openURL: jest.fn().mockResolvedValue(undefined),
		canOpenURL: jest.fn().mockResolvedValue(true),
	},
	NativeModules: {
		Pubky: {
			put: jest.fn().mockResolvedValue(['success', 'stored-url']),
		},
	},
}));

jest.mock('@synonymdev/react-native-pubky', () => ({
	put: jest.fn().mockResolvedValue({
		isOk: () => true,
		isErr: () => false,
		value: undefined,
	}),
}));

jest.mock('../../pubky', () => ({
	signInToHomeserver: jest.fn(),
	getPubkySecretKey: jest.fn(),
	signAndPostAuthToken: jest.fn(),
}));

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

jest.mock('../../helpers', () => ({
	showToast: jest.fn(),
	hideToast: jest.fn(),
	hideToastIfKind: jest.fn(),
	PAYKIT_CONNECT_RELAY_FAILURE_TOAST: 'paykit-connect-relay-failed',
	sleep: jest.fn(() => Promise.resolve()),
}));

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

import { SheetManager } from 'react-native-actions-sheet';
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
import { put } from '@synonymdev/react-native-pubky';
import {
	resetRequestGenerationForTests,
} from '../../authRequestGeneration';

const AUTH_SECRET = 'ERERERERERERERERERERERERERERERERERERERERERE';
const AUTH_RELAY = 'https://httprelay.pubky.app/link/';
const GRANT_CAPS = ['/pub/paykit/:rw', '/pub/hypercolor.app/v1/:rw'];
const AUTH_CHANNEL_URL =
	'https://httprelay.pubky.app/link/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const mockFetch = jest.fn();
const originalFetch = global.fetch;
const faithful = SheetManager as unknown as FaithfulSheetManager;

const flushShow = async (): Promise<ShowOptions> => {
	for (let i = 0; i < 12; i += 1) {
		await Promise.resolve();
		if (faithful.lastOptions) {
			return faithful.lastOptions;
		}
	}
	throw new Error('SheetManager.show never captured options');
};

describe('combined https grant event-faithful', () => {
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
		resetRequestGenerationForTests();
		faithful.reset();
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
		(signAndPostAuthToken as jest.Mock).mockImplementation(async ({ authUrl }: { authUrl: string }) => {
			expect(authUrl.startsWith('pubkyauth:///?')).toBe(true);
			try {
				const response = await fetch(AUTH_CHANNEL_URL, {
					method: 'POST',
					body: 'ciphertext',
					redirect: 'error',
				});
				if (response.status < 200 || response.status >= 300) {
					return err('auth failed');
				}
				return ok([]);
			} catch {
				return err('auth failed');
			}
		});
	});

	afterAll(() => {
		global.fetch = originalFetch;
	});

	it('shows exactly one confirm-paykit-connect and zero confirm-auth; Approve posts auth then locator', async () => {
		const pending = handlePaykitConnectAction(data, context);
		const options = await flushShow();
		expect(faithful.shows).toEqual(['confirm-paykit-connect']);
		expect(faithful.shows).not.toContain('confirm-auth');
		options.payload.onDecision(true);
		await pending;

		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(mockFetch.mock.calls[0][0]).toBe(AUTH_CHANNEL_URL);
		expect(mockFetch.mock.calls[0][1]).toEqual(expect.objectContaining({
			method: 'POST',
			redirect: 'error',
		}));
		expect(mockFetch.mock.calls[1][0]).toBe(locatorUrl);
		expect(mockFetch.mock.calls[1][1]).toEqual(expect.objectContaining({
			method: 'POST',
			redirect: 'error',
		}));
	});

	it('Deny posts nothing', async () => {
		const pending = handlePaykitConnectAction(data, context);
		const options = await flushShow();
		options.payload.onDecision(false);
		await pending;

		expect(signAndPostAuthToken).not.toHaveBeenCalled();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('auth POST non-2xx posts zero locator', async () => {
		mockFetch.mockResolvedValueOnce({ ok: false, status: 500, type: 'basic' });
		const pending = handlePaykitConnectAction(data, context);
		const options = await flushShow();
		options.payload.onDecision(true);
		const result = await pending;

		expect(result.isErr()).toBe(true);
		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(mockFetch.mock.calls[0][0]).toBe(AUTH_CHANNEL_URL);
	});

	it('caps mismatch posts zero locator', async () => {
		(signAndPostAuthToken as jest.Mock).mockResolvedValue(ok(['/pub/paykit/:rw']));
		const pending = handlePaykitConnectAction(data, context);
		const options = await flushShow();
		options.payload.onDecision(true);
		const result = await pending;

		expect(result.isErr()).toBe(true);
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('3xx on auth POST is a failure and skips locator', async () => {
		mockFetch.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
		const pending = handlePaykitConnectAction(data, context);
		const options = await flushShow();
		options.payload.onDecision(true);
		const result = await pending;

		expect(result.isErr()).toBe(true);
		expect(mockFetch.mock.calls.every((call) => call[0] !== locatorUrl)).toBe(true);
	});
});
