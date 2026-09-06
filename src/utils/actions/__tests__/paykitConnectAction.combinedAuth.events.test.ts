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
		includesWebSession?: boolean;
		includesHypercolorMobileSession?: boolean;
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
	AppState: {
		currentState: 'active',
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
	list: jest.fn().mockResolvedValue({
		isOk: () => true,
		isErr: () => false,
		value: [],
	}),
	get: jest.fn().mockResolvedValue({
		isOk: () => false,
		isErr: () => true,
		error: 'not found',
	}),
	deleteFile: jest.fn().mockResolvedValue({
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
import { Linking } from 'react-native';
import {
	cancelDeferredHandoffDeletes,
	handlePaykitConnectAction,
	normalizeListedHandoffUrl,
} from '../paykitConnectAction';
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
import { put, list, get, deleteFile } from '@synonymdev/react-native-pubky';
import {
	resetRequestGenerationForTests,
} from '../../authRequestGeneration';
import { showToast } from '../../helpers';

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
			deviceId: 'hypercolor-web-1a070b03cdc',
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
		(list as jest.Mock).mockResolvedValue(ok([]));
		(get as jest.Mock).mockResolvedValue(err('not found'));
		(deleteFile as jest.Mock).mockResolvedValue(ok(undefined));
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

	afterEach(() => {
		cancelDeferredHandoffDeletes();
		jest.clearAllTimers();
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

	const decodeSb2Payload = (): Record<string, unknown> => {
		const plaintextHex = (sb2Encrypt as jest.Mock).mock.calls[0][1] as string;
		return JSON.parse(Buffer.from(plaintextHex, 'hex').toString('utf8'));
	};

	it('omits session_secret and capabilities from the https SB2 handoff payload', async () => {
		const pending = handlePaykitConnectAction(data, context);
		const options = await flushShow();
		options.payload.onDecision(true);
		await pending;

		const payload = decodeSb2Payload();
		expect(payload).not.toHaveProperty('session_secret');
		expect(payload).not.toHaveProperty('capabilities');
		expect(payload.pubky).toBe('test-pubky-z32');
	});

	it('includes session_secret and capabilities for bitkit:// custom-scheme handoff', async () => {
		const pending = handlePaykitConnectAction({
			action: InputAction.PaykitConnect,
			params: {
				deviceId: 'device123',
				callback: 'bitkit://paykit-setup',
				ephemeralPk,
			},
		}, context);
		const options = await flushShow();
		options.payload.onDecision(true);
		const result = await pending;

		expect(result.isOk()).toBe(true);
		expect(Linking.openURL).toHaveBeenCalled();
		const payload = decodeSb2Payload();
		expect(payload.session_secret).toBe('session-secret-123');
		expect(payload.capabilities).toEqual(['/pub:rw']);
	});

	it('rejects https /:rw caps at intake before the sheet or sign-in', async () => {
		const pending = handlePaykitConnectAction({
			...data,
			params: {
				...data.params,
				caps: ['/:rw'],
			},
		}, context);
		const result = await pending;

		expect(result.isErr()).toBe(true);
		expect(faithful.shows).toEqual([]);
		expect(signInToHomeserver).not.toHaveBeenCalled();
		expect(signAndPostAuthToken).not.toHaveBeenCalled();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('does not delete the requestId blob immediately after a 2xx locator POST; defers +5 min', async () => {
		jest.useFakeTimers();
		try {
			const pending = handlePaykitConnectAction(data, context);
			const options = await flushShow();
			options.payload.onDecision(true);
			await pending;

			const handoffUrl =
				`pubky://test-pubky-z32/pub/paykit.app/v0/handoff/${'i'.repeat(64)}`;
			expect(deleteFile).not.toHaveBeenCalledWith(handoffUrl, 'b'.repeat(64));

			await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
			expect(deleteFile).toHaveBeenCalledWith(handoffUrl, 'b'.repeat(64));
		} finally {
			cancelDeferredHandoffDeletes();
			jest.useRealTimers();
		}
	});

	it('deletes the requestId-scoped handoff blob when auth POST fails', async () => {
		mockFetch.mockResolvedValueOnce({ ok: false, status: 500, type: 'basic' });
		const pending = handlePaykitConnectAction(data, context);
		const options = await flushShow();
		options.payload.onDecision(true);
		await pending;

		const handoffUrl =
			`pubky://test-pubky-z32/pub/paykit.app/v0/handoff/${'i'.repeat(64)}`;
		expect(deleteFile).toHaveBeenCalledWith(handoffUrl, 'b'.repeat(64));
		expect(mockFetch.mock.calls.every((call) => call[0] !== locatorUrl)).toBe(true);
	});

	it('sweeps stale /pub/paykit.app/v0/handoff/ entries and does not delete other paths', async () => {
		const staleUrl = `pubky://test-pubky-z32/pub/paykit.app/v0/handoff/${'a'.repeat(64)}`;
		const otherFlowUrl = `pubky://test-pubky-z32/pub/paykit.app/v0/handoff/${'b'.repeat(64)}`;
		const keybindingUrl = 'pubky://test-pubky-z32/pub/paykit.app/v0/keybinding';
		const otherIdentityUrl = 'pubky://other-pubky/pub/paykit.app/v0/handoff/x';
		(list as jest.Mock).mockResolvedValue(ok([
			staleUrl,
			otherFlowUrl,
			keybindingUrl,
			otherIdentityUrl,
		]));
		(get as jest.Mock).mockImplementation(async (url: string) => {
			if (url === staleUrl) {
				return ok(JSON.stringify({
					sb2: 'x',
					created_at: Math.floor(Date.now() / 1000) - 6 * 60,
				}));
			}
			if (url === otherFlowUrl) {
				return ok(JSON.stringify({
					sb2: 'x',
					created_at: Math.floor(Date.now() / 1000) - 30,
				}));
			}
			return err('not found');
		});

		const pending = handlePaykitConnectAction(data, context);
		const options = await flushShow();
		options.payload.onDecision(true);
		await pending;
		await Promise.resolve();
		await Promise.resolve();

		const deleted = (deleteFile as jest.Mock).mock.calls.map((call) => call[0]);
		expect(deleted).toContain(staleUrl);
		expect(deleted).not.toContain(keybindingUrl);
		expect(deleted).not.toContain(otherIdentityUrl);
		expect(deleted).not.toContain(otherFlowUrl);
	});

	it('sweeps future-dated created_at handoff blobs', async () => {
		const futureUrl = `pubky://test-pubky-z32/pub/paykit.app/v0/handoff/${'c'.repeat(64)}`;
		(list as jest.Mock).mockResolvedValue(ok([futureUrl]));
		(get as jest.Mock).mockResolvedValue(ok(JSON.stringify({
			sb2: 'x',
			created_at: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
		})));

		const pending = handlePaykitConnectAction(data, context);
		const options = await flushShow();
		options.payload.onDecision(true);
		await pending;
		await Promise.resolve();
		await Promise.resolve();

		expect((deleteFile as jest.Mock).mock.calls.map((call) => call[0])).toContain(futureUrl);
	});

	it('rejects a non-hypercolor-web deviceId on https before the sheet or sign-in', async () => {
		const pending = handlePaykitConnectAction({
			...data,
			params: {
				...data.params,
				deviceId: 'bitkit-phone-deadbeef',
			},
		}, context);
		const result = await pending;

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(String(result.error)).toContain('paykitConnectMalformedRequest');
		}
		expect(faithful.shows).toEqual([]);
		expect(signInToHomeserver).not.toHaveBeenCalled();
		expect(signAndPostAuthToken).not.toHaveBeenCalled();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('accepts a bitkit:// deviceId that would be invalid on https', async () => {
		const pending = handlePaykitConnectAction({
			action: InputAction.PaykitConnect,
			params: {
				deviceId: 'bitkit-phone-deadbeef',
				callback: 'bitkit://paykit-setup',
				ephemeralPk,
			},
		}, context);
		const options = await flushShow();
		options.payload.onDecision(true);
		const result = await pending;

		expect(result.isOk()).toBe(true);
		expect(Linking.openURL).toHaveBeenCalled();
	});

	it('omits device_id from public noise endpoint metadata', async () => {
		const pending = handlePaykitConnectAction(data, context);
		const options = await flushShow();
		options.payload.onDecision(true);
		await pending;

		const noisePut = (put as jest.Mock).mock.calls.find((call) =>
			String(call[0]).endsWith('/pub/paykit.app/v0/noise')
		);
		expect(noisePut).toBeDefined();
		const metadata = JSON.parse(noisePut[1].metadata);
		expect(metadata).not.toHaveProperty('device_id');
		expect(metadata.provisioned_by).toBe('ring-handoff');
	});

	it('normalizeListedHandoffUrl rejects traversal and non-hex segments', () => {
		const pubky = 'alice';
		const prefix = '/pub/paykit.app/v0/handoff/';
		expect(normalizeListedHandoffUrl(pubky, `pubky://${pubky}${prefix}..`)).toBeNull();
		expect(normalizeListedHandoffUrl(pubky, `${prefix}.`)).toBeNull();
		expect(normalizeListedHandoffUrl(pubky, `${prefix}%2e%2e%2fkeybinding`)).toBeNull();
		expect(normalizeListedHandoffUrl(pubky, `${prefix}x#frag`)).toBeNull();
		expect(normalizeListedHandoffUrl(pubky, `${prefix}x%3Fa=b`)).toBeNull();
		const okId = 'ab'.repeat(32);
		expect(normalizeListedHandoffUrl(pubky, `pubky://${pubky}${prefix}${okId}`))
			.toBe(`pubky://${pubky}${prefix}${okId}`);
	});

	it('cancels deferred deletes so the timer does not fire', async () => {
		jest.useFakeTimers();
		try {
			const pending = handlePaykitConnectAction(data, context);
			const options = await flushShow();
			options.payload.onDecision(true);
			await pending;
			const handoffUrl =
				`pubky://test-pubky-z32/pub/paykit.app/v0/handoff/${'i'.repeat(64)}`;
			cancelDeferredHandoffDeletes('test-pubky-z32');
			await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
			expect(deleteFile).not.toHaveBeenCalledWith(handoffUrl, 'b'.repeat(64));
		} finally {
			cancelDeferredHandoffDeletes();
			jest.useRealTimers();
		}
	});

	it('does not cancel another identity\'s deferred delete', async () => {
		jest.useFakeTimers();
		try {
			const pending = handlePaykitConnectAction(data, context);
			const options = await flushShow();
			options.payload.onDecision(true);
			await pending;
			const handoffUrl =
				`pubky://test-pubky-z32/pub/paykit.app/v0/handoff/${'i'.repeat(64)}`;
			cancelDeferredHandoffDeletes('other-pubky');
			await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
			expect(deleteFile).toHaveBeenCalledWith(handoffUrl, 'b'.repeat(64));
		} finally {
			cancelDeferredHandoffDeletes();
			jest.useRealTimers();
		}
	});

	it('deletes this requestId when locator POST returns non-2xx', async () => {
		mockFetch
			.mockResolvedValueOnce({ ok: true, status: 200, type: 'basic' })
			.mockResolvedValueOnce({ ok: false, status: 500, type: 'basic' });
		const pending = handlePaykitConnectAction(data, context);
		const options = await flushShow();
		options.payload.onDecision(true);
		await pending;

		const handoffUrl =
			`pubky://test-pubky-z32/pub/paykit.app/v0/handoff/${'i'.repeat(64)}`;
		expect(deleteFile).toHaveBeenCalledWith(handoffUrl, 'b'.repeat(64));
		expect(deleteFile.mock.calls.filter((call) => call[0] === handoffUrl)).toHaveLength(1);
	});

	it('deletes this requestId when locator POST throws', async () => {
		mockFetch
			.mockResolvedValueOnce({ ok: true, status: 200, type: 'basic' })
			.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		const pending = handlePaykitConnectAction(data, context);
		const options = await flushShow();
		options.payload.onDecision(true);
		await pending;

		const handoffUrl =
			`pubky://test-pubky-z32/pub/paykit.app/v0/handoff/${'i'.repeat(64)}`;
		expect(deleteFile).toHaveBeenCalledWith(handoffUrl, 'b'.repeat(64));
		expect(deleteFile.mock.calls.filter((call) => call[0] === handoffUrl)).toHaveLength(1);
	});

	it('deletes this requestId when granted caps mismatch after PUT', async () => {
		(signAndPostAuthToken as jest.Mock).mockResolvedValue(ok(['/pub/paykit/:rw']));
		const pending = handlePaykitConnectAction(data, context);
		const options = await flushShow();
		options.payload.onDecision(true);
		await pending;

		const handoffUrl =
			`pubky://test-pubky-z32/pub/paykit.app/v0/handoff/${'i'.repeat(64)}`;
		expect(deleteFile).toHaveBeenCalledWith(handoffUrl, 'b'.repeat(64));
		expect(deleteFile.mock.calls.filter((call) => call[0] === handoffUrl)).toHaveLength(1);
	});

	it('schedules a deferred delete of this requestId after bitkit:// openURL', async () => {
		jest.useFakeTimers();
		try {
			const pending = handlePaykitConnectAction({
				action: InputAction.PaykitConnect,
				params: {
					deviceId: 'device123',
					callback: 'bitkit://paykit-setup',
					ephemeralPk,
				},
			}, context);
			const options = await flushShow();
			options.payload.onDecision(true);
			await pending;

			const handoffUrl =
				`pubky://test-pubky-z32/pub/paykit.app/v0/handoff/${'i'.repeat(64)}`;
			expect(Linking.openURL).toHaveBeenCalled();
			expect(deleteFile).not.toHaveBeenCalledWith(handoffUrl, 'b'.repeat(64));
			await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
			expect(deleteFile).toHaveBeenCalledWith(handoffUrl, 'b'.repeat(64));
			expect(deleteFile.mock.calls.filter((call) => call[0] === handoffUrl)).toHaveLength(1);
		} finally {
			cancelDeferredHandoffDeletes();
			jest.useRealTimers();
		}
	});

	it('shows relay-reject toast only after the select-pubky picker has closed', async () => {
		const order: string[] = [];
		(showToast as jest.Mock).mockImplementation(() => {
			order.push('toast');
		});
		const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

		faithful.show('select-pubky', {
			payload: { onDecision: (): void => {} },
			onClose: (): void => {
				order.push('picker-closed');
			},
		});

		const result = await handlePaykitConnectAction({
			...data,
			params: {
				...data.params,
				relay: 'https://evil.example/inbox',
			},
		}, context);

		expect(result.isErr()).toBe(true);
		expect(String(result.error)).toContain('session.paykitConnectRelayRejected');
		expect(faithful.shows.filter((id) => id === 'confirm-paykit-connect')).toEqual([]);
		expect(order).toEqual(['picker-closed', 'toast']);
		expect(warnSpy).toHaveBeenCalledWith('[PaykitConnect] rejected gate=relay');
		warnSpy.mockRestore();
	});

	const mobileDeviceId = 'hypercolor-19c8e5a3c00';
	const mobileCallback = 'hypercolor://ring-callback';
	const mobileCombined = {
		action: InputAction.PaykitConnect as const,
		params: {
			deviceId: mobileDeviceId,
			callback: mobileCallback,
			ephemeralPk,
			caps: GRANT_CAPS,
			secret: AUTH_SECRET,
			relay: AUTH_RELAY,
		},
	};

	it('hypercolor:// with secret/relay: one sheet, auth POST then openURL, no session_secret', async () => {
		const pending = handlePaykitConnectAction(mobileCombined, context);
		const options = await flushShow();
		expect(faithful.shows).toEqual(['confirm-paykit-connect']);
		expect(faithful.shows).not.toContain('confirm-auth');
		expect(options.payload).toEqual(expect.objectContaining({
			includesHypercolorMobileSession: true,
			includesWebSession: false,
		}));
		options.payload.onDecision(true);
		const result = await pending;

		expect(result.isOk()).toBe(true);
		expect(signAndPostAuthToken).toHaveBeenCalled();
		expect(mockFetch.mock.calls[0][0]).toBe(AUTH_CHANNEL_URL);
		expect(mockFetch.mock.calls.every((call) => !String(call[0]).includes('/hc-'))).toBe(true);
		expect(Linking.openURL).toHaveBeenCalled();
		const payload = decodeSb2Payload();
		expect(payload).not.toHaveProperty('session_secret');
		expect(payload).not.toHaveProperty('capabilities');
	});

	it('hypercolor:// without secret keeps legacy session_secret and openURL', async () => {
		const pending = handlePaykitConnectAction({
			action: InputAction.PaykitConnect,
			params: {
				deviceId: mobileDeviceId,
				callback: mobileCallback,
				ephemeralPk,
			},
		}, context);
		const options = await flushShow();
		options.payload.onDecision(true);
		const result = await pending;

		expect(result.isOk()).toBe(true);
		expect(signAndPostAuthToken).not.toHaveBeenCalled();
		expect(Linking.openURL).toHaveBeenCalled();
		const payload = decodeSb2Payload();
		expect(payload.session_secret).toBe('session-secret-123');
		expect(payload.capabilities).toEqual(['/pub:rw']);
	});

	it('bitkit:// with secret/relay is rejected before the sheet', async () => {
		const pending = handlePaykitConnectAction({
			action: InputAction.PaykitConnect,
			params: {
				deviceId: 'device123',
				callback: 'bitkit://paykit-setup',
				ephemeralPk,
				secret: AUTH_SECRET,
				relay: AUTH_RELAY,
			},
		}, context);
		const result = await pending;

		expect(result.isErr()).toBe(true);
		expect(faithful.shows).toEqual([]);
		expect(signAndPostAuthToken).not.toHaveBeenCalled();
		expect(Linking.openURL).not.toHaveBeenCalled();
	});

	it('hypercolor:// combined auth POST fail: no openURL and deletes the handoff blob', async () => {
		mockFetch.mockResolvedValueOnce({ ok: false, status: 500, type: 'basic' });
		const pending = handlePaykitConnectAction(mobileCombined, context);
		const options = await flushShow();
		options.payload.onDecision(true);
		const result = await pending;

		expect(result.isErr()).toBe(true);
		expect(Linking.openURL).not.toHaveBeenCalled();
		const handoffUrl =
			`pubky://test-pubky-z32/pub/paykit.app/v0/handoff/${'i'.repeat(64)}`;
		expect(deleteFile).toHaveBeenCalledWith(handoffUrl, 'b'.repeat(64));
	});

	it('rejects hypercolor:// combined /:rw caps at intake before the sheet', async () => {
		const pending = handlePaykitConnectAction({
			...mobileCombined,
			params: {
				...mobileCombined.params,
				caps: ['/:rw'],
			},
		}, context);
		const result = await pending;

		expect(result.isErr()).toBe(true);
		expect(faithful.shows).toEqual([]);
		expect(signInToHomeserver).not.toHaveBeenCalled();
		expect(signAndPostAuthToken).not.toHaveBeenCalled();
		expect(Linking.openURL).not.toHaveBeenCalled();
	});

	it('rejects a non-mobile deviceId on combined hypercolor:// before the sheet', async () => {
		const pending = handlePaykitConnectAction({
			...mobileCombined,
			params: {
				...mobileCombined.params,
				deviceId: 'hypercolor-web-1a070b03cdc',
			},
		}, context);
		const result = await pending;

		expect(result.isErr()).toBe(true);
		expect(faithful.shows).toEqual([]);
		expect(signInToHomeserver).not.toHaveBeenCalled();
	});
});

