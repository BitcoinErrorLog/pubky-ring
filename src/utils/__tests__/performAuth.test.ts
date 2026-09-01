/**
 * performAuth must not log or return raw native auth errors (Kimi H4).
 */

import { err, ok } from '@synonymdev/result';
import { AUTH_ERROR_LOG_PREFIX } from '../authError';

jest.mock('@synonymdev/react-native-pubky', () => ({
	auth: jest.fn(),
	signUp: jest.fn(),
	signIn: jest.fn(),
	signOut: jest.fn(),
	getPublicKeyFromSecretKey: jest.fn(),
	getSignupToken: jest.fn(),
	republishHomeserver: jest.fn(),
	getHomeserver: jest.fn(),
	get: jest.fn(),
	generateMnemonicPhraseAndKeypair: jest.fn(),
	mnemonicPhraseToKeypair: jest.fn(),
}));

jest.mock('../keychain', () => ({
	getKeychainValue: jest.fn(),
	setKeychainValue: jest.fn(),
	resetKeychainValue: jest.fn(),
	getAllKeychainKeys: jest.fn(),
}));

jest.mock('../store-helpers', () => ({
	getPubkyDataFromStore: jest.fn(),
}));

jest.mock('../helpers', () => ({
	showToast: jest.fn(),
}));

jest.mock('../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

import { auth } from '@synonymdev/react-native-pubky';
import { getKeychainValue } from '../keychain';
import { getPubkyDataFromStore } from '../store-helpers';
import { performAuth } from '../pubky';

const LEAKY = 'native fail https://relay.example/pubkyauth?secret=abc123';

describe('performAuth', () => {
	const dispatch = jest.fn();

	beforeEach(() => {
		jest.clearAllMocks();
		(getKeychainValue as jest.Mock).mockResolvedValue(
			ok(JSON.stringify({ secretKey: 'sk', mnemonic: '' })),
		);
		(getPubkyDataFromStore as jest.Mock).mockReturnValue({
			signedUp: true,
			homeserver: 'hs',
		});
	});

	it('returns a sanitized message and logs only an allowlisted code', async () => {
		const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		(auth as jest.Mock).mockRejectedValue(new Error(LEAKY));

		const result = await performAuth({
			pubky: 'pk:test',
			authUrl: 'pubkyauth:///?secret=abc123',
			dispatch,
		});

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error.message).toBe('errors.authorizationFailed');
			expect(result.error.message).not.toContain('relay.example');
			expect(result.error.message).not.toContain('abc123');
		}

		const logged = errorSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
		expect(logged).toContain(`${AUTH_ERROR_LOG_PREFIX}failed`);
		expect(logged).not.toContain('relay.example');
		expect(logged).not.toContain(LEAKY);
		errorSpy.mockRestore();
	});

	it('does not log the native error object when auth returns Err', async () => {
		const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		(auth as jest.Mock)
			.mockResolvedValueOnce(err({ message: LEAKY }))
			.mockResolvedValueOnce(err({ message: LEAKY }));
		const { signIn } = require('@synonymdev/react-native-pubky');
		(signIn as jest.Mock).mockResolvedValue(ok({}));

		const result = await performAuth({
			pubky: 'pk:test',
			authUrl: 'pubkyauth:///?secret=abc123',
			dispatch,
		});

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error.message).toBe('errors.failedToProcessAuth');
			expect(result.error.message).not.toContain('relay.example');
		}
		const logged = errorSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
		expect(logged).toContain(`${AUTH_ERROR_LOG_PREFIX}process`);
		expect(logged).not.toContain(LEAKY);
		errorSpy.mockRestore();
	});
});
