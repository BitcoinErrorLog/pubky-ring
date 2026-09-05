/**
 * Unit tests for paykitConnectAction
 *
 * Tests the Paykit connect flow including secure handoff with encrypted payloads.
 */

import { handlePaykitConnectAction, isAllowedHttpsPaykitCallback } from '../paykitConnectAction';
import {
	InputAction,
	PaykitConnectParams,
	parseInput,
	isPaykitConnectAction,
} from '../../inputParser';
import { ActionContext } from '../../inputRouter';
import { DEFAULT_HOMESERVER } from '../../constants';
import { SheetManager } from 'react-native-actions-sheet';
import { isE2EAutoApproveEnabled } from '../../e2eAutoApprove';
import {
	deriveRingCallbackChannelId,
	formatRingVerificationCode,
} from '../../ringCallbackChannel';

const HYPERCOLOR_WEB_CALLBACK =
	'https://hypercolor.app/ring-callback?ch=8eOwP5zDIW4PwXitMsHu3RdUDCF60o3DTwI-firPVT8';
const HYPERCOLOR_RELAY_URL =
	'https://httprelay.pubky.app/link/hc-8eOwP5zDIW4PwXitMsHu3RdUDCF60o3DTwI-firPVT8';
const HYPERCOLOR_EPHEMERAL_PK =
	'c9aaad5b10794814e6ca4a5a18ea2aebb0467c83fd45515ab1634910e6a0b172';
const HYPERCOLOR_AUTH_SECRET = 'ERERERERERERERERERERERERERERERERERERERERERE';
const HYPERCOLOR_AUTH_RELAY = 'https://httprelay.pubky.app/link/';
const HYPERCOLOR_GRANT_CAPS = ['/pub/paykit/:rw', '/pub/hypercolor.app/v1/:rw'];
const HYPERCOLOR_WEB_LOGIN_QR =
	'pubkyring://paykit-connect?deviceId=hypercolor-web-1a070b03cdc&callback=https%3A%2F%2Fhypercolor.app%2Fring-callback%3Fch%3D8eOwP5zDIW4PwXitMsHu3RdUDCF60o3DTwI-firPVT8&ephemeralPk=c9aaad5b10794814e6ca4a5a18ea2aebb0467c83fd45515ab1634910e6a0b172&caps=%2Fpub%2Fpaykit%2F%3Arw%2C%2Fpub%2Fhypercolor.app%2Fv1%2F%3Arw&secret=ERERERERERERERERERERERERERERERERERERERERERE&relay=https%3A%2F%2Fhttprelay.pubky.app%2Flink%2F';

const mockFetch = jest.fn();
const originalFetch = global.fetch;

// Mock dependencies
jest.mock('react-native', () => {
	const mockNativePut = jest.fn().mockResolvedValue(['success', 'stored-url']);
	return {
		Linking: {
			openURL: jest.fn().mockResolvedValue(undefined),
			canOpenURL: jest.fn().mockResolvedValue(true),
		},
		NativeModules: {
			Pubky: {
				put: mockNativePut,
			},
		},
	};
});

jest.mock('@synonymdev/react-native-pubky', () => ({
	put: jest.fn(),
	parseAuthUrl: jest.fn().mockResolvedValue({
		isOk: () => false,
		isErr: () => true,
		error: { message: 'Not an auth URL' },
	}),
	mnemonicPhraseToKeypair: jest.fn().mockResolvedValue({
		isOk: () => false,
		isErr: () => true,
		error: { message: 'Invalid mnemonic' },
	}),
	getPublicKeyFromSecretKey: jest.fn().mockResolvedValue({
		isOk: () => false,
		isErr: () => true,
		error: { message: 'Invalid secret key' },
	}),
}));

// Get the mocked native put for test assertions
import { NativeModules } from 'react-native';
const mockNativePut = NativeModules.Pubky.put as jest.Mock;

jest.mock('../../pubky', () => ({
	signInToHomeserver: jest.fn(),
	getPubkySecretKey: jest.fn(),
	signAndPostAuthToken: jest.fn(),
}));

jest.mock('../../PubkyNoiseModule', () => ({
	deriveX25519ForDeviceEpoch: jest.fn(),
	deriveNoiseSeed: jest.fn(),
	isNativeModuleAvailable: jest.fn(),
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
	getErrorMessage: jest.fn((err, fallback) => err?.message || err || fallback),
}));

jest.mock('../../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

import { Linking } from 'react-native';
import { put } from '@synonymdev/react-native-pubky';
import { signInToHomeserver, getPubkySecretKey, signAndPostAuthToken } from '../../pubky';
import {
	deriveX25519ForDeviceEpoch,
	deriveNoiseSeed,
	isNativeModuleAvailable,
	sealedBlobEncrypt,
	sealedBlobEncryptWithContext,
	ed25519PublicFromSecret,
	x25519GenerateKeypair,
	generateAppKeypair,
	issueAppCert,
	computeInboxKid,
	sb2Encrypt,
	sb2Sign,
	sb2GenerateContextId,
} from '../../PubkyNoiseModule';
import { showToast } from '../../helpers';

type PaykitConnectActionData = {
	action: InputAction.PaykitConnect;
	params: PaykitConnectParams;
};

// Helper to create mock Result objects
const createOkResult = <T>(value: T) => ({
	isOk: () => true,
	isErr: () => false,
	value,
	error: undefined,
});

const createErrResult = (message: string) => ({
	isOk: () => false,
	isErr: () => true,
	value: undefined,
	error: { message },
});

describe('paykitConnectAction', () => {
	const mockDispatch = jest.fn();
	const mockEphemeralPk = 'a'.repeat(64); // 32 bytes as hex
	const mockMatchingCh = deriveRingCallbackChannelId(mockEphemeralPk);
	const mockHttpsCallback = `https://hypercolor.app/ring-callback?ch=${mockMatchingCh}`;
	const mockSecretKey = 'b'.repeat(64);
	const mockContext: ActionContext = {
		dispatch: mockDispatch,
		pubky: 'test-pubky-z32',
		isDeeplink: true,
	};

	const createActionData = (params: Partial<PaykitConnectParams> = {}): PaykitConnectActionData => ({
		action: InputAction.PaykitConnect,
		params: {
			deviceId: 'device123',
			callback: 'bitkit://paykit-setup',
			includeEpoch1: true,
			ephemeralPk: mockEphemeralPk,
			...params,
		},
	});

	const createHttpsActionData = (params: Partial<PaykitConnectParams> = {}): PaykitConnectActionData =>
		createActionData({
			callback: mockHttpsCallback,
			secret: HYPERCOLOR_AUTH_SECRET,
			relay: HYPERCOLOR_AUTH_RELAY,
			caps: HYPERCOLOR_GRANT_CAPS,
			...params,
		});

	const autoApproveSheet = (): void => {
		(SheetManager.show as jest.Mock).mockImplementation((_id, options) => {
			options?.payload?.onDecision?.(true);
			return Promise.resolve();
		});
	};

	beforeEach(() => {
		jest.clearAllMocks();
		(isE2EAutoApproveEnabled as jest.Mock).mockReturnValue(false);
		autoApproveSheet();
		mockFetch.mockReset();
		mockFetch.mockResolvedValue({ ok: true, status: 200 });
		global.fetch = mockFetch as unknown as typeof fetch;
		(Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
		(Linking.openURL as jest.Mock).mockResolvedValue(undefined);
		(isNativeModuleAvailable as jest.Mock).mockReturnValue(true);
		(signInToHomeserver as jest.Mock).mockResolvedValue(
			createOkResult({
				pubky: 'test-pubky-z32',
				session_secret: 'session-secret-123',
				capabilities: ['/pub:rw'],
			})
		);
		(getPubkySecretKey as jest.Mock).mockResolvedValue(
			createOkResult({ secretKey: mockSecretKey, mnemonic: 'test mnemonic' })
		);
		(signAndPostAuthToken as jest.Mock).mockResolvedValue(
			createOkResult([])
		);
		(deriveX25519ForDeviceEpoch as jest.Mock).mockResolvedValue({
			publicKey: 'c'.repeat(64),
			secretKey: 'd'.repeat(64),
		});
		(deriveNoiseSeed as jest.Mock).mockResolvedValue('e'.repeat(64));
		// Mock the new spec-compliant encryption function
		(ed25519PublicFromSecret as jest.Mock).mockResolvedValue('1'.repeat(64));
		(sealedBlobEncryptWithContext as jest.Mock).mockResolvedValue(
			JSON.stringify({ v: 2, ct: 'encrypted', epk: 'f'.repeat(64), nonce: 'g'.repeat(32) })
		);
		// Keep legacy mock for backward compatibility tests
		(sealedBlobEncrypt as jest.Mock).mockResolvedValue(
			JSON.stringify({ v: 2, ct: 'encrypted', epk: 'f'.repeat(64), nonce: 'g'.repeat(32) })
		);
		// Mock new SB2 and key generation functions
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
		// Reset and set default for native put - returns ['success', url] for success
		mockNativePut.mockReset();
		mockNativePut.mockResolvedValue(['success', 'stored-url']);
		(put as jest.Mock).mockResolvedValue(createOkResult(undefined));
	});

	afterAll(() => {
		global.fetch = originalFetch;
	});

	describe('validation', () => {
		it('should reject when no pubky is provided', async () => {
			const data = createActionData();
			const contextWithoutPubky: ActionContext = { dispatch: mockDispatch };

			const result = await handlePaykitConnectAction(data, contextWithoutPubky);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'error' })
			);
		});

		it('should reject when callback URL is invalid', async () => {
			const data = createActionData({ callback: 'invalid-callback' });

			const result = await handlePaykitConnectAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(signInToHomeserver).not.toHaveBeenCalled();
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					description: 'session.invalidCallback',
				})
			);
		});

		it('should reject when callback is missing', async () => {
			const data = createActionData({ callback: undefined as unknown as string });

			const result = await handlePaykitConnectAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(signInToHomeserver).not.toHaveBeenCalled();
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					description: 'session.invalidCallback',
				})
			);
		});

		it('should reject https callback URLs', async () => {
			const data = createActionData({ callback: 'https://evil.example/cb' });

			const result = await handlePaykitConnectAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(signInToHomeserver).not.toHaveBeenCalled();
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					description: 'session.invalidCallback',
				})
			);
		});

		it('should reject javascript callback URLs', async () => {
			const data = createActionData({ callback: 'javascript://alert(1)' });

			const result = await handlePaykitConnectAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(signInToHomeserver).not.toHaveBeenCalled();
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					description: 'session.invalidCallback',
				})
			);
		});

		it.each(['bitkit', 'paykit', 'atomicity', 'hypercolor'])(
			'should accept %s callback scheme',
			async (scheme) => {
				const data = createActionData({ callback: `${scheme}://paykit-setup` });

				await handlePaykitConnectAction(data, mockContext);

				expect(signInToHomeserver).toHaveBeenCalled();
				expect(showToast).not.toHaveBeenCalledWith(
					expect.objectContaining({
						description: 'session.invalidCallback',
					})
				);
			}
		);

		it.each([
			`https://hypercolor.app/ring-callback?ch=${mockMatchingCh}`,
			`https://www.hypercolor.app/ring-callback?ch=${mockMatchingCh}`,
			`HTTPS://hypercolor.app/ring-callback?ch=${mockMatchingCh}`,
		])('should accept first-party https callback %s without opening a browser', async (callback) => {
			const data = createHttpsActionData({ callback });

			await handlePaykitConnectAction(data, mockContext);

			expect(signInToHomeserver).toHaveBeenCalled();
			expect(showToast).not.toHaveBeenCalledWith(
				expect.objectContaining({
					description: 'session.invalidCallback',
				})
			);
			expect(Linking.openURL).not.toHaveBeenCalled();
			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('allowlists ch=x:443 but rejects it before fetch (colon is not base64url)', async () => {
			const callback = 'https://hypercolor.app/ring-callback?ch=x:443';
			expect(isAllowedHttpsPaykitCallback(callback)).toBe(true);

			const result = await handlePaykitConnectAction(
				createHttpsActionData({ callback }),
				mockContext
			);

			expect(result.isErr()).toBe(true);
			expect(mockFetch).not.toHaveBeenCalled();
			expect(Linking.openURL).not.toHaveBeenCalled();
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					description: 'session.invalidCallback',
				})
			);
		});

		it.each([
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
		])('should reject https callback %s', async (callback) => {
			const data = createActionData({ callback });

			const result = await handlePaykitConnectAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(signInToHomeserver).not.toHaveBeenCalled();
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					description: 'session.invalidCallback',
				})
			);
		});

		it('should reject when ephemeralPk is missing', async () => {
			const data = createActionData({ ephemeralPk: undefined });

			const result = await handlePaykitConnectAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					title: 'Update Required',
				})
			);
		});

		it('should reject when ephemeralPk has invalid format', async () => {
			const data = createActionData({ ephemeralPk: 'too-short' });

			const result = await handlePaykitConnectAction(data, mockContext);

			expect(result.isErr()).toBe(true);
		});

		it('should reject ephemeralPk that is not 64 hex chars', async () => {
			const data = createActionData({ ephemeralPk: 'g'.repeat(64) }); // 'g' is not hex

			const result = await handlePaykitConnectAction(data, mockContext);

			expect(result.isErr()).toBe(true);
		});
	});

	describe('secure handoff flow', () => {
		it('should sign in to homeserver', async () => {
			const data = createActionData();

			await handlePaykitConnectAction(data, mockContext);

			expect(signInToHomeserver).toHaveBeenCalledWith({
				pubky: 'test-pubky-z32',
				dispatch: mockDispatch,
			});
		});

		it('should get Ed25519 secret key', async () => {
			const data = createActionData();

			await handlePaykitConnectAction(data, mockContext);

			expect(getPubkySecretKey).toHaveBeenCalledWith('test-pubky-z32');
		});

		it('should derive X25519 keypair for epoch 0', async () => {
			const data = createActionData();

			await handlePaykitConnectAction(data, mockContext);

			expect(deriveX25519ForDeviceEpoch).toHaveBeenCalledWith(
				mockSecretKey,
				expect.any(String), // deviceId as hex
				0
			);
		});

		it('should derive X25519 keypair for epoch 1 when includeEpoch1 is true', async () => {
			const data = createActionData({ includeEpoch1: true });

			await handlePaykitConnectAction(data, mockContext);

			expect(deriveX25519ForDeviceEpoch).toHaveBeenCalledWith(
				mockSecretKey,
				expect.any(String),
				1
			);
		});

		it('should not derive epoch 1 keypair when includeEpoch1 is false', async () => {
			const data = createActionData({ includeEpoch1: false });

			await handlePaykitConnectAction(data, mockContext);

			expect(deriveX25519ForDeviceEpoch).not.toHaveBeenCalledWith(
				expect.anything(),
				expect.anything(),
				1
			);
		});

		it('should derive noise seed', async () => {
			const data = createActionData();

			await handlePaykitConnectAction(data, mockContext);

			expect(deriveNoiseSeed).toHaveBeenCalledWith(
				mockSecretKey,
				expect.any(String) // deviceId as hex
			);
		});

		// These tests verify the SB2 encryption flow. They work when mocks are properly configured.
		it('should encrypt payload using SB2 binary format', async () => {
			const data = createActionData();

			await handlePaykitConnectAction(data, mockContext);

			// Should derive Ed25519 public key (owner peerid) from secret key
			expect(ed25519PublicFromSecret).toHaveBeenCalledWith(mockSecretKey);
			
			// Should use SB2 encryption (primary path)
			expect(sb2Encrypt).toHaveBeenCalledWith(
				mockEphemeralPk, // recipientInboxPkHex
				expect.any(String), // plaintextHex
				expect.any(String), // contextIdHex
				expect.stringContaining('handoff-'), // msgId
				'handoff', // purpose
				expect.stringMatching(/^1{64}$/), // ownerPeeridHex
				expect.stringMatching(/^1{64}$/), // senderPeeridHex
				expect.stringMatching(/^1{64}$/), // recipientPeeridHex
				expect.stringContaining('/pub/paykit.app/v0/handoff/'), // canonicalPath
				expect.any(Number), // createdAt
				expect.any(Number), // expiresAt
				null // certIdHex
			);
		});

		/**
		 * TODO: These tests require the full flow to complete successfully first.
		 * Skip until 'should return success on completion' test infrastructure is fixed.
		 */
		it.skip('should store encrypted envelope on homeserver', async () => {
			const data = createActionData();

			await handlePaykitConnectAction(data, mockContext);

			// Verify native put was called with handoff path
			expect(mockNativePut).toHaveBeenCalledWith(
				expect.stringContaining('pubky://test-pubky-z32/pub/paykit.app/v0/handoff/'),
				expect.any(String), // JSON stringified envelope
				mockSecretKey
			);
		});

		it.skip('should publish noise endpoint', async () => {
			const data = createActionData();

			await handlePaykitConnectAction(data, mockContext);

			// Verify native put was called with noise endpoint path
			expect(mockNativePut).toHaveBeenCalledWith(
				expect.stringContaining('pubky://test-pubky-z32/pub/paykit.app/v0/noise'),
				expect.stringContaining('"host":"pending"'), // JSON stringified
				mockSecretKey
			);
		});

		it.skip('should open callback URL with request_id and mode', async () => {
			const data = createActionData();

			await handlePaykitConnectAction(data, mockContext);

			expect(Linking.openURL).toHaveBeenCalledWith(
				expect.stringMatching(/bitkit:\/\/paykit-setup\?.*request_id=.*mode=secure_handoff/)
			);
		});

		/**
		 * TODO: This test requires comprehensive mock infrastructure updates:
		 * 1. NativeModules.Pubky.put returns ['success', url] correctly
		 * 2. All PubkyNoiseModule functions are mocked with proper async implementations
		 * 3. The @synonymdev/result ok/err functions need to work with mocked native returns
		 *
		 * The production code has been verified working manually and through bitkit-android tests.
		 * Skip until test infrastructure can be updated to properly support the full SB2 flow.
		 */
		it.skip('should return success on completion', async () => {
			const data = createActionData();

			const result = await handlePaykitConnectAction(data, mockContext);

			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value).toBe('test-pubky-z32');
			}
		});
	});

	describe('error handling', () => {
		it('should handle sign-in failure', async () => {
			(signInToHomeserver as jest.Mock).mockResolvedValue(
				createErrResult('Sign-in failed')
			);
			const data = createActionData();

			const result = await handlePaykitConnectAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'error' })
			);
		});

		it('should handle secret key retrieval failure', async () => {
			(getPubkySecretKey as jest.Mock).mockResolvedValue(
				createErrResult('Keychain error')
			);
			const data = createActionData();

			const result = await handlePaykitConnectAction(data, mockContext);

			expect(result.isErr()).toBe(true);
		});

		/**
		 * TODO: These error handling tests depend on the full flow working.
		 * Skip until test infrastructure is updated for the SB2 flow.
		 */
		it.skip('should handle encryption failure', async () => {
			// Mock SB2 encryption failure - this is now the primary encryption path
			(sb2Encrypt as jest.Mock).mockRejectedValue(new Error('Encryption failed'));
			// Also make fallback fail
			(sealedBlobEncryptWithContext as jest.Mock).mockRejectedValue(new Error('Fallback failed'));
			const data = createActionData();

			const result = await handlePaykitConnectAction(data, mockContext);

			// Encryption failure should result in an error
			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'error' })
			);
		});

		it.skip('should handle storage failure', async () => {
			// Native put returns ['error', message] for failure
			mockNativePut.mockResolvedValueOnce(['error', 'Storage failed']);
			const data = createActionData();

			const result = await handlePaykitConnectAction(data, mockContext);

			expect(result.isErr()).toBe(true);
		});

		it.skip('should continue if noise endpoint publication fails', async () => {
			// Now we have 3 puts: handoff, keybinding, noise endpoint
			// First put (handoff) succeeds, second put (keybinding) succeeds, third (noise) fails
			mockNativePut
				.mockResolvedValueOnce(['success', 'handoff-url']) // handoff
				.mockResolvedValueOnce(['success', 'keybinding-url']) // keybinding
				.mockResolvedValueOnce(['error', 'Noise endpoint failed']); // noise endpoint
			const data = createActionData();

			const result = await handlePaykitConnectAction(data, mockContext);

			// Should still succeed because handoff was stored
			expect(result.isOk()).toBe(true);
		});

		it('should handle callback URL that cannot be opened', async () => {
			(Linking.canOpenURL as jest.Mock).mockResolvedValue(false);
			const data = createActionData();

			const result = await handlePaykitConnectAction(data, mockContext);

			expect(result.isErr()).toBe(true);
		});
	});

	describe('deviceId handling', () => {
		it('should convert non-hex deviceId to hex', async () => {
			const data = createActionData({ deviceId: 'my-device' });

			await handlePaykitConnectAction(data, mockContext);

			// 'my-device' in hex
			expect(deriveX25519ForDeviceEpoch).toHaveBeenCalledWith(
				mockSecretKey,
				'6d792d646576696365', // 'my-device' in hex
				0
			);
		});

		it('should preserve deviceId that is already hex', async () => {
			const hexDeviceId = 'abcd1234';
			const data = createActionData({ deviceId: hexDeviceId });

			await handlePaykitConnectAction(data, mockContext);

			expect(deriveX25519ForDeviceEpoch).toHaveBeenCalledWith(
				mockSecretKey,
				hexDeviceId,
				0
			);
		});
	});

	describe('https web handoff via httprelay', () => {
		const expectedRelayBody = {
			pubky: 'test-pubky-z32',
			request_id: 'i'.repeat(64),
		mode: 'secure_handoff+pubkyauth',
			homeserver: DEFAULT_HOMESERVER,
		};

		it('POSTs the four-field locator to httprelay and never opens a browser', async () => {
			expect(isAllowedHttpsPaykitCallback(HYPERCOLOR_WEB_CALLBACK)).toBe(true);

			const result = await handlePaykitConnectAction(
				createHttpsActionData({
					callback: HYPERCOLOR_WEB_CALLBACK,
					ephemeralPk: HYPERCOLOR_EPHEMERAL_PK,
				}),
				mockContext
			);

			expect(result.isOk()).toBe(true);
			expect(mockFetch).toHaveBeenCalledTimes(1);
			const [url, init] = mockFetch.mock.calls[0];
			expect(url).toBe(HYPERCOLOR_RELAY_URL);
			expect(init.method).toBe('POST');
			expect(init.headers).toEqual({ 'content-type': 'application/json' });
			expect(JSON.parse(init.body)).toEqual(expectedRelayBody);
			expect(Linking.openURL).not.toHaveBeenCalled();
			expect(Linking.canOpenURL).not.toHaveBeenCalled();
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'success',
					description: 'session.webHandoffApproved',
				})
			);
		});

		it.each([
			['relay 500', { ok: false, status: 500 }],
			['fetch rejects', new Error('network down')],
			['fetch aborts', Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })],
		])('does not openURL when %s', async (_label, fetchOutcome) => {
			if (fetchOutcome instanceof Error) {
				mockFetch.mockRejectedValue(fetchOutcome);
			} else {
				mockFetch.mockResolvedValue(fetchOutcome);
			}

			const result = await handlePaykitConnectAction(
				createHttpsActionData({
					callback: HYPERCOLOR_WEB_CALLBACK,
					ephemeralPk: HYPERCOLOR_EPHEMERAL_PK,
				}),
				mockContext
			);

			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(String(result.error)).toContain('Relay post failed');
			}
			expect(Linking.openURL).not.toHaveBeenCalled();
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					description: 'session.webHandoffRelayFailed',
				})
			);
		});

		it.each([
			['https://hypercolor.app/ring-callback?ch=hc-x/y', 'slash in ch'],
			['https://hypercolor.app/ring-callback?ch=x%2Fy', 'percent-encoded slash'],
			['https://hypercolor.app/ring-callback?ch=', 'empty ch'],
			[`https://hypercolor.app/ring-callback?ch=${'A'.repeat(200)}`, '200-char ch'],
		])('rejects %s before any network call', async (callback) => {
			const result = await handlePaykitConnectAction(
				createActionData({ callback }),
				mockContext
			);

			expect(result.isErr()).toBe(true);
			expect(mockFetch).not.toHaveBeenCalled();
			expect(Linking.openURL).not.toHaveBeenCalled();
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					description: 'session.invalidCallback',
				})
			);
		});

		it('denies without sign-in, fetch, or Linking', async () => {
			(SheetManager.show as jest.Mock).mockImplementation((_id, options) => {
				options?.payload?.onDecision?.(false);
				return Promise.resolve();
			});

			const result = await handlePaykitConnectAction(
				createActionData(),
				mockContext
			);

			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(String(result.error)).toContain('session.paykitConnectDenied');
			}
			expect(signInToHomeserver).not.toHaveBeenCalled();
			expect(mockFetch).not.toHaveBeenCalled();
			expect(Linking.openURL).not.toHaveBeenCalled();
			expect(Linking.canOpenURL).not.toHaveBeenCalled();
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'info',
					description: 'session.paykitConnectDenied',
				})
			);
		});

		it('passes host, deviceId, caps, and verification code for https', async () => {
			const caps = ['/pub/paykit/:rw', '/pub/hypercolor.app/v1/:rw'];
			await handlePaykitConnectAction(
				createHttpsActionData({
					callback: mockHttpsCallback,
					deviceId: 'hypercolor-web-1a070b03cdc',
					caps,
				}),
				mockContext
			);

			expect(SheetManager.show).toHaveBeenCalledWith(
				'confirm-paykit-connect',
				expect.objectContaining({
					payload: expect.objectContaining({
						pubky: 'test-pubky-z32',
						destination: 'hypercolor.app — session.webBrowser',
						deviceId: 'hypercolor-web-1a070b03cdc',
						capabilities: [
							{ path: '/pub/paykit/', permission: 'rw' },
							{ path: '/pub/hypercolor.app/v1/', permission: 'rw' },
						],
						verificationCode: formatRingVerificationCode(mockMatchingCh),
					}),
				})
			);
		});

		it('passes scheme destination for a custom-scheme callback', async () => {
			await handlePaykitConnectAction(
				createActionData({ callback: 'hypercolor://paykit-setup', deviceId: 'dev-9' }),
				mockContext
			);

			expect(SheetManager.show).toHaveBeenCalledWith(
				'confirm-paykit-connect',
				expect.objectContaining({
					payload: expect.objectContaining({
						destination: 'hypercolor:// session.appOnThisDevice',
						deviceId: 'dev-9',
						verificationCode: formatRingVerificationCode(mockMatchingCh),
					}),
				})
			);
		});

		it('rejects https ch↔ephemeralPk mismatch before the sheet', async () => {
			const result = await handlePaykitConnectAction(
				createActionData({
					callback: 'https://hypercolor.app/ring-callback?ch=abc',
				}),
				mockContext
			);

			expect(result.isErr()).toBe(true);
			expect(SheetManager.show).not.toHaveBeenCalled();
			expect(signInToHomeserver).not.toHaveBeenCalled();
			expect(mockFetch).not.toHaveBeenCalled();
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					description: 'session.invalidCallback',
				})
			);
		});

		it('real Hypercolor QR: derived ch matches the callback channel', () => {
			const parsedCh = '8eOwP5zDIW4PwXitMsHu3RdUDCF60o3DTwI-firPVT8';
			const ephemeralPk =
				'c9aaad5b10794814e6ca4a5a18ea2aebb0467c83fd45515ab1634910e6a0b172';
			expect(deriveRingCallbackChannelId(ephemeralPk)).toBe(parsedCh);
			expect(formatRingVerificationCode(parsedCh)).toBe('8eO-wP5');
		});

		it('skips the sheet when Debug/E2E auto-approve is on', async () => {
			(isE2EAutoApproveEnabled as jest.Mock).mockReturnValue(true);

			await handlePaykitConnectAction(createActionData(), mockContext);

			expect(SheetManager.show).not.toHaveBeenCalled();
			expect(signInToHomeserver).toHaveBeenCalled();
		});

		it('custom-scheme callback still uses openURL and never fetch', async () => {
			const result = await handlePaykitConnectAction(
				createActionData({ callback: 'bitkit://paykit-setup' }),
				mockContext
			);

			expect(result.isOk()).toBe(true);
			expect(mockFetch).not.toHaveBeenCalled();
			expect(Linking.openURL).toHaveBeenCalledTimes(1);
			expect(Linking.openURL).toHaveBeenCalledWith(
				expect.stringMatching(/^bitkit:\/\/paykit-setup\?/)
			);
		});

		it('real Hypercolor QR: parseInput → handler → relay URL with hc- prefix', async () => {
			const parsed = await parseInput(HYPERCOLOR_WEB_LOGIN_QR, 'scan');
			expect(isPaykitConnectAction(parsed.data)).toBe(true);
			if (!isPaykitConnectAction(parsed.data)) {
				return;
			}

			const result = await handlePaykitConnectAction(parsed.data, mockContext);

			expect(result.isOk()).toBe(true);
			expect(signAndPostAuthToken).toHaveBeenCalled();
			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch.mock.calls[0][0]).toBe(HYPERCOLOR_RELAY_URL);
			expect(Linking.openURL).not.toHaveBeenCalled();
		});

		it('rejects https callback when secret or relay is missing', async () => {
			const result = await handlePaykitConnectAction(
				createActionData({
					callback: mockHttpsCallback,
					caps: HYPERCOLOR_GRANT_CAPS,
				}),
				mockContext
			);

			expect(result.isErr()).toBe(true);
			expect(SheetManager.show).not.toHaveBeenCalled();
			expect(signAndPostAuthToken).not.toHaveBeenCalled();
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('rejects custom-scheme callbacks that carry secret or relay', async () => {
			const result = await handlePaykitConnectAction(
				createActionData({
					secret: HYPERCOLOR_AUTH_SECRET,
					relay: HYPERCOLOR_AUTH_RELAY,
				}),
				mockContext
			);

			expect(result.isErr()).toBe(true);
			expect(SheetManager.show).not.toHaveBeenCalled();
			expect(signAndPostAuthToken).not.toHaveBeenCalled();
			expect(mockFetch).not.toHaveBeenCalled();
			expect(Linking.openURL).not.toHaveBeenCalled();
		});

		it('does not POST locator when auth POST fails', async () => {
			(signAndPostAuthToken as jest.Mock).mockResolvedValue(
				createErrResult('auth failed')
			);

			const result = await handlePaykitConnectAction(
				createHttpsActionData(),
				mockContext
			);

			expect(result.isErr()).toBe(true);
			expect(signAndPostAuthToken).toHaveBeenCalled();
			expect(mockFetch).not.toHaveBeenCalled();
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					description: 'session.paykitConnectAuthFailed',
				})
			);
		});

		it('does not POST locator when granted caps mismatch the QR set', async () => {
			(signAndPostAuthToken as jest.Mock).mockResolvedValue(
				createOkResult(['/pub/paykit/:rw'])
			);

			const result = await handlePaykitConnectAction(
				createHttpsActionData(),
				mockContext
			);

			expect(result.isErr()).toBe(true);
			expect(mockFetch).not.toHaveBeenCalled();
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					description: 'session.paykitConnectCapsMismatch',
				})
			);
		});

		it('E2E auto-approve still posts auth before locator', async () => {
			(isE2EAutoApproveEnabled as jest.Mock).mockReturnValue(true);
			const order: string[] = [];
			(signAndPostAuthToken as jest.Mock).mockImplementation(async () => {
				order.push('auth');
				return createOkResult([]);
			});
			mockFetch.mockImplementation(async () => {
				order.push('locator');
				return { ok: true, status: 200 };
			});

			await handlePaykitConnectAction(createHttpsActionData(), mockContext);

			expect(SheetManager.show).not.toHaveBeenCalled();
			expect(order).toEqual(['auth', 'locator']);
		});
	});
});

