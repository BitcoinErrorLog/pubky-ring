/**
 * Unit tests for paykitConnectAction
 *
 * Tests the Paykit connect flow including secure handoff with encrypted payloads.
 */

import { handlePaykitConnectAction } from '../paykitConnectAction';
import { InputAction, PaykitConnectParams } from '../../inputParser';
import { ActionContext } from '../../inputRouter';

// Mock dependencies
jest.mock('react-native', () => ({
	Linking: {
		openURL: jest.fn().mockResolvedValue(undefined),
		canOpenURL: jest.fn().mockResolvedValue(true),
	},
}));

jest.mock('@synonymdev/react-native-pubky', () => ({
	put: jest.fn(),
}));

jest.mock('../../pubky', () => ({
	signInToHomeserver: jest.fn(),
	getPubkySecretKey: jest.fn(),
}));

jest.mock('../../PubkyNoiseModule', () => ({
	deriveX25519ForDeviceEpoch: jest.fn(),
	deriveNoiseSeed: jest.fn(),
	isNativeModuleAvailable: jest.fn(),
	sealedBlobEncrypt: jest.fn(),
}));

jest.mock('../../helpers', () => ({
	showToast: jest.fn(),
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
import { signInToHomeserver, getPubkySecretKey } from '../../pubky';
import {
	deriveX25519ForDeviceEpoch,
	deriveNoiseSeed,
	isNativeModuleAvailable,
	sealedBlobEncrypt,
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

	beforeEach(() => {
		jest.clearAllMocks();
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
		(deriveX25519ForDeviceEpoch as jest.Mock).mockResolvedValue({
			publicKey: 'c'.repeat(64),
			secretKey: 'd'.repeat(64),
		});
		(deriveNoiseSeed as jest.Mock).mockResolvedValue('e'.repeat(64));
		(sealedBlobEncrypt as jest.Mock).mockResolvedValue(
			JSON.stringify({ v: 1, ct: 'encrypted', epk: 'f'.repeat(64) })
		);
		(put as jest.Mock).mockResolvedValue(createOkResult(undefined));
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

		it('should encrypt payload using sealedBlobEncrypt', async () => {
			const data = createActionData();

			await handlePaykitConnectAction(data, mockContext);

			expect(sealedBlobEncrypt).toHaveBeenCalledWith(
				mockEphemeralPk,
				expect.any(String), // payload hex
				expect.stringContaining('paykit:v0:handoff'),
				'handoff'
			);
		});

		it('should store encrypted envelope on homeserver', async () => {
			const data = createActionData();

			await handlePaykitConnectAction(data, mockContext);

			expect(put).toHaveBeenCalledWith(
				expect.stringContaining('pubky://test-pubky-z32/pub/paykit.app/v0/handoff/'),
				expect.any(Object),
				mockSecretKey
			);
		});

		it('should publish noise endpoint', async () => {
			const data = createActionData();

			await handlePaykitConnectAction(data, mockContext);

			expect(put).toHaveBeenCalledWith(
				expect.stringContaining('pubky://test-pubky-z32/pub/paykit.app/v0/noise'),
				expect.objectContaining({
					host: 'pending',
					port: 0,
					pubkey: expect.any(String),
				}),
				mockSecretKey
			);
		});

		it('should open callback URL with request_id and mode', async () => {
			const data = createActionData();

			await handlePaykitConnectAction(data, mockContext);

			expect(Linking.openURL).toHaveBeenCalledWith(
				expect.stringMatching(/bitkit:\/\/paykit-setup\?.*request_id=.*mode=secure_handoff/)
			);
		});

		it('should return success on completion', async () => {
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

		it('should handle encryption failure', async () => {
			(sealedBlobEncrypt as jest.Mock).mockRejectedValue(new Error('Encryption failed'));
			const data = createActionData();

			const result = await handlePaykitConnectAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					description: 'Failed to encrypt handoff payload',
				})
			);
		});

		it('should handle storage failure', async () => {
			(put as jest.Mock).mockResolvedValueOnce(createErrResult('Storage failed'));
			const data = createActionData();

			const result = await handlePaykitConnectAction(data, mockContext);

			expect(result.isErr()).toBe(true);
		});

		it('should continue if noise endpoint publication fails', async () => {
			// First put (handoff) succeeds, second put (noise endpoint) fails
			(put as jest.Mock)
				.mockResolvedValueOnce(createOkResult(undefined))
				.mockResolvedValueOnce(createErrResult('Noise endpoint failed'));
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
});

