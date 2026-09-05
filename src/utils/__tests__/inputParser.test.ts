/**
 * Unit tests for inputParser
 *
 * Tests the unified input parser that handles deeplinks, QR codes, and clipboard content.
 */

import {
	parseInput,
	formatImportData,
	InputAction,
	isAuthAction,
	isImportAction,
	isSignupAction,
	isInviteAction,
	isGetProfileAction,
	isGetFollowsAction,
	isPaykitConnectAction,
	isSignMessageAction,
	isUnknownAction,
} from '../inputParser';
import { isAllowedHttpsPaykitCallback } from '../actions/paykitConnectAction';
import { EBackupPreference } from '../../types/pubky';

const HYPERCOLOR_WEB_LOGIN_QR =
	'pubkyring://paykit-connect?deviceId=hypercolor-web-1a070b03cdc&callback=https%3A%2F%2Fhypercolor.app%2Fring-callback%3Fch%3D8eOwP5zDIW4PwXitMsHu3RdUDCF60o3DTwI-firPVT8&ephemeralPk=c9aaad5b10794814e6ca4a5a18ea2aebb0467c83fd45515ab1634910e6a0b172&caps=%2Fpub%2Fpaykit%2F%3Arw%2C%2Fpub%2Fhypercolor.app%2Fv1%2F%3Arw';

const HYPERCOLOR_CALLBACK =
	'https://hypercolor.app/ring-callback?ch=8eOwP5zDIW4PwXitMsHu3RdUDCF60o3DTwI-firPVT8';

const HYPERCOLOR_EPHEMERAL_PK =
	'c9aaad5b10794814e6ca4a5a18ea2aebb0467c83fd45515ab1634910e6a0b172';

// Mock the pubky SDK
jest.mock('@synonymdev/react-native-pubky', () => ({
	parseAuthUrl: jest.fn(),
	mnemonicPhraseToKeypair: jest.fn(),
	getPublicKeyFromSecretKey: jest.fn(),
}));

import {
	parseAuthUrl,
	mnemonicPhraseToKeypair,
	getPublicKeyFromSecretKey,
} from '@synonymdev/react-native-pubky';

const mockParseAuthUrl = parseAuthUrl as jest.MockedFunction<typeof parseAuthUrl>;
const mockMnemonicToKeypair = mnemonicPhraseToKeypair as jest.MockedFunction<typeof mnemonicPhraseToKeypair>;
const mockGetPublicKey = getPublicKeyFromSecretKey as jest.MockedFunction<typeof getPublicKeyFromSecretKey>;

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

describe('inputParser', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		// Default: auth URL parsing fails (not an auth URL)
		mockParseAuthUrl.mockResolvedValue(createErrResult('Not an auth URL'));
		// Default: mnemonic validation fails
		mockMnemonicToKeypair.mockResolvedValue(createErrResult('Invalid mnemonic'));
		// Default: secret key validation fails
		mockGetPublicKey.mockResolvedValue(createErrResult('Invalid secret key'));
	});

	describe('formatImportData', () => {
		it('should return empty string for empty input', () => {
			expect(formatImportData('')).toBe('');
			expect(formatImportData(null as unknown as string)).toBe('');
		});

		it('should trim whitespace', () => {
			expect(formatImportData('  hello  ')).toBe('hello');
		});

		it('should decode URL encoding', () => {
			expect(formatImportData('hello%20world')).toBe('hello world');
		});

		it('should remove pubkyring:// prefix', () => {
			expect(formatImportData('pubkyring://somedata')).toBe('somedata');
		});

		it('should normalize word separators to spaces', () => {
			expect(formatImportData('word1-word2_word3+word4')).toBe('word1 word2 word3 word4');
		});
	});

	describe('parseInput - Unknown input', () => {
		it('should return Unknown for null/undefined input', async () => {
			const result = await parseInput(null as unknown as string, 'deeplink');
			expect(result.action).toBe(InputAction.Unknown);
		});

		it('should return Unknown for empty string', async () => {
			const result = await parseInput('', 'deeplink');
			expect(result.action).toBe(InputAction.Unknown);
		});

		it('should return Unknown for unrecognized input', async () => {
			const result = await parseInput('random garbage', 'clipboard');
			expect(result.action).toBe(InputAction.Unknown);
			expect(result.source).toBe('clipboard');
		});
	});

	describe('parseInput - Auth URLs', () => {
		it('should parse valid pubkyauth URL', async () => {
			mockParseAuthUrl.mockResolvedValue(
				createOkResult({
					relay: 'https://relay.example.com',
					secret: 'abc123',
					capabilities: [{ path: '/pub', permission: 'rw' }],
				})
			);

			const result = await parseInput('pubkyauth:///relay=test&secret=abc', 'deeplink');

			expect(result.action).toBe(InputAction.Auth);
			expect(isAuthAction(result.data)).toBe(true);
			if (isAuthAction(result.data)) {
				expect(result.data.params.relay).toBe('https://relay.example.com');
				expect(result.data.params.secret).toBe('abc123');
			}
		});

		it('should handle pubkyring://signin?... format', async () => {
			mockParseAuthUrl.mockResolvedValue(
				createOkResult({
					relay: 'https://relay.example.com',
					secret: 'secret123',
					capabilities: [],
				})
			);

			const result = await parseInput(
				'pubkyring://signin?relay=https://relay.example.com&secret=secret123&caps=',
				'deeplink'
			);

			expect(result.action).toBe(InputAction.Auth);
		});

		it('should handle wrapped pubkyring://pubkyauth URL', async () => {
			mockParseAuthUrl.mockResolvedValue(
				createOkResult({
					relay: 'https://relay.example.com',
					secret: 'secret123',
					capabilities: [],
				})
			);

			const result = await parseInput(
				'pubkyring://pubkyauth:///relay=test&secret=abc',
				'deeplink'
			);

			expect(result.action).toBe(InputAction.Auth);
		});

		it('does not treat a callback query as auth action data', async () => {
			mockParseAuthUrl.mockResolvedValue(
				createOkResult({
					relay: 'https://relay.example.com',
					secret: 'secret123',
					capabilities: [],
				})
			);

			const result = await parseInput(
				'pubkyauth:///?relay=https://relay.example.com&secret=secret123&callback=https://evil.example',
				'deeplink'
			);

			expect(result.action).toBe(InputAction.Auth);
			expect(isAuthAction(result.data)).toBe(true);
			if (isAuthAction(result.data)) {
				expect(result.data.params).not.toHaveProperty('callback');
				expect(Object.keys(result.data.params).sort()).toEqual(['caps', 'relay', 'secret']);
			}
		});
	});

	describe('parseInput - Signup deeplinks', () => {
		it('should parse signup deeplink with all params', async () => {
			const url = 'pubkyring://signup?hs=https%3A%2F%2Fhome.example.com&st=ABCD-1234-EFGH&relay=https%3A%2F%2Frelay.example.com&secret=mysecret&caps=/pub:rw';

			const result = await parseInput(url, 'deeplink');

			expect(result.action).toBe(InputAction.Signup);
			expect(isSignupAction(result.data)).toBe(true);
			if (isSignupAction(result.data)) {
				expect(result.data.params.homeserver).toBe('https://home.example.com');
				expect(result.data.params.inviteCode).toBe('ABCD-1234-EFGH');
				expect(result.data.params.relay).toBe('https://relay.example.com');
				expect(result.data.params.secret).toBe('mysecret');
				expect(result.data.params.caps).toContain('/pub:rw');
			}
		});

		it('should reject signup without homeserver', async () => {
			const url = 'pubkyring://signup?st=ABCD-1234-EFGH&relay=test&secret=test';

			const result = await parseInput(url, 'deeplink');

			// Should fall through to Unknown because homeserver is required
			expect(result.action).toBe(InputAction.Unknown);
		});
	});

	// Note: Session and DeriveKeypair actions are deprecated and removed from the router
	// They are still parsed by inputParser but not handled by any action handler

	describe('parseInput - Get Profile deeplinks', () => {
		it('should parse get-profile deeplink', async () => {
			const url = 'pubkyring://get-profile?pubkey=abc123&callback=bitkit://profile';

			const result = await parseInput(url, 'deeplink');

			expect(result.action).toBe(InputAction.GetProfile);
			expect(isGetProfileAction(result.data)).toBe(true);
			if (isGetProfileAction(result.data)) {
				expect(result.data.params.pubkey).toBe('abc123');
				expect(result.data.params.callback).toBe('bitkit://profile');
			}
		});

		it('should parse get-profile with app namespace', async () => {
			const url = 'pubkyring://get-profile?pubkey=abc123&callback=bitkit://profile&app=custom.app';

			const result = await parseInput(url, 'deeplink');

			expect(result.action).toBe(InputAction.GetProfile);
			if (isGetProfileAction(result.data)) {
				expect(result.data.params.app).toBe('custom.app');
			}
		});
	});

	describe('parseInput - Get Follows deeplinks', () => {
		it('should parse get-follows deeplink', async () => {
			const url = 'pubkyring://get-follows?callback=bitkit://follows';

			const result = await parseInput(url, 'deeplink');

			expect(result.action).toBe(InputAction.GetFollows);
			expect(isGetFollowsAction(result.data)).toBe(true);
			if (isGetFollowsAction(result.data)) {
				expect(result.data.params.callback).toBe('bitkit://follows');
			}
		});
	});

	describe('parseInput - Paykit Connect deeplinks', () => {
		it('should parse paykit-connect deeplink', async () => {
			const url = 'pubkyring://paykit-connect?deviceId=device123&callback=bitkit://paykit-setup';

			const result = await parseInput(url, 'deeplink');

			expect(result.action).toBe(InputAction.PaykitConnect);
			expect(isPaykitConnectAction(result.data)).toBe(true);
			if (isPaykitConnectAction(result.data)) {
				expect(result.data.params.deviceId).toBe('device123');
				expect(result.data.params.callback).toBe('bitkit://paykit-setup');
				expect(result.data.params.includeEpoch1).toBe(true); // default
			}
		});

		it('should parse paykit-connect with ephemeralPk', async () => {
			const ephemeralPk = 'a'.repeat(64);
			const url = `pubkyring://paykit-connect?deviceId=device123&callback=bitkit://paykit-setup&ephemeralPk=${ephemeralPk}`;

			const result = await parseInput(url, 'deeplink');

			expect(result.action).toBe(InputAction.PaykitConnect);
			if (isPaykitConnectAction(result.data)) {
				expect(result.data.params.ephemeralPk).toBe(ephemeralPk);
			}
		});

		it('should parse paykit-connect with includeEpoch1=false', async () => {
			const url = 'pubkyring://paykit-connect?deviceId=device123&callback=bitkit://paykit-setup&includeEpoch1=false';

			const result = await parseInput(url, 'deeplink');

			if (isPaykitConnectAction(result.data)) {
				expect(result.data.params.includeEpoch1).toBe(false);
			}
		});

		it('keeps Hypercolor https callback ch= after whole-string pre-decode', async () => {
			const result = await parseInput(HYPERCOLOR_WEB_LOGIN_QR, 'scan');

			expect(result.action).toBe(InputAction.PaykitConnect);
			expect(isPaykitConnectAction(result.data)).toBe(true);
			if (isPaykitConnectAction(result.data)) {
				expect(result.data.params.callback).toBe(HYPERCOLOR_CALLBACK);
				expect(result.data.params.deviceId).toBe('hypercolor-web-1a070b03cdc');
				expect(result.data.params.ephemeralPk).toBe(HYPERCOLOR_EPHEMERAL_PK);
				expect(result.data.params.caps).toEqual([
					'/pub/paykit/:rw',
					'/pub/hypercolor.app/v1/:rw',
				]);
				expect(isAllowedHttpsPaykitCallback(result.data.params.callback)).toBe(true);
			}
		});

		it('keeps = inside a hypercolor:// mobile callback', async () => {
			const url =
				'pubkyring://paykit-connect?deviceId=d1&callback=hypercolor%3A%2F%2Fpaykit-connect-callback%3Ffoo%3Dbar&ephemeralPk=' +
				HYPERCOLOR_EPHEMERAL_PK;

			const result = await parseInput(url, 'scan');

			expect(isPaykitConnectAction(result.data)).toBe(true);
			if (isPaykitConnectAction(result.data)) {
				expect(result.data.params.callback).toBe(
					'hypercolor://paykit-connect-callback?foo=bar'
				);
			}
		});

		it('returns unknown when paykit-connect callback is missing', async () => {
			const url = `pubkyring://paykit-connect?deviceId=d1&ephemeralPk=${HYPERCOLOR_EPHEMERAL_PK}`;

			const result = await parseInput(url, 'scan');

			expect(result.action).toBe(InputAction.Unknown);
		});

		it('does not let an encoded &ephemeralPk=evil inside callback override the outer key', async () => {
			// ephemeralPk is placed before callback so first-occurrence wins after
			// the pre-decode turns `%26ephemeralPk%3Devil` into a sibling pair.
			// That later pair is ignored. Safe because first-wins keeps the
			// earlier legitimate key; an injected pair cannot override it.
			const url =
				`pubkyring://paykit-connect?deviceId=d1&ephemeralPk=${HYPERCOLOR_EPHEMERAL_PK}` +
				'&callback=hypercolor%3A%2F%2Fpaykit-connect-callback%3Ffoo%3Dbar%26ephemeralPk%3Devil';

			const result = await parseInput(url, 'scan');

			expect(isPaykitConnectAction(result.data)).toBe(true);
			if (isPaykitConnectAction(result.data)) {
				expect(result.data.params.ephemeralPk).toBe(HYPERCOLOR_EPHEMERAL_PK);
				expect(result.data.params.callback).toBe(
					'hypercolor://paykit-connect-callback?foo=bar'
				);
			}
		});
	});

	describe('parseInput - Sign Message deeplinks', () => {
		it('should parse sign-message deeplink', async () => {
			const url = 'pubkyring://sign-message?message=Hello%20World&callback=bitkit://signature';

			const result = await parseInput(url, 'deeplink');

			expect(result.action).toBe(InputAction.SignMessage);
			expect(isSignMessageAction(result.data)).toBe(true);
			if (isSignMessageAction(result.data)) {
				expect(result.data.params.message).toBe('Hello World');
				expect(result.data.params.callback).toBe('bitkit://signature');
			}
		});

		it('should reject sign-message without message', async () => {
			const url = 'pubkyring://sign-message?callback=bitkit://signature';

			const result = await parseInput(url, 'deeplink');

			expect(result.action).toBe(InputAction.Unknown);
		});
	});

	describe('parseInput - Invite codes', () => {
		it('should parse invite code from URL', async () => {
			const url = 'https://example.com/invite/ABCD-1234-EFGH';

			const result = await parseInput(url, 'scan');

			expect(result.action).toBe(InputAction.Invite);
			expect(isInviteAction(result.data)).toBe(true);
			if (isInviteAction(result.data)) {
				expect(result.data.params.inviteCode).toBe('ABCD-1234-EFGH');
			}
		});

		it('should parse standalone invite code', async () => {
			const code = 'ABCD-1234-EFGH';

			const result = await parseInput(code, 'clipboard');

			expect(result.action).toBe(InputAction.Invite);
			if (isInviteAction(result.data)) {
				expect(result.data.params.inviteCode).toBe(code);
			}
		});

		it('should handle case-insensitive invite codes', async () => {
			const code = 'abcd-1234-efgh';

			const result = await parseInput(code, 'clipboard');

			expect(result.action).toBe(InputAction.Invite);
		});
	});

	describe('parseInput - Import (mnemonic/secret key)', () => {
		it('should parse valid mnemonic phrase', async () => {
			const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
			mockMnemonicToKeypair.mockResolvedValue(
				createOkResult({ secret_key: 'abc', public_key: 'xyz' })
			);

			const result = await parseInput(mnemonic, 'clipboard');

			expect(result.action).toBe(InputAction.Import);
			expect(isImportAction(result.data)).toBe(true);
			if (isImportAction(result.data)) {
				expect(result.data.params.backupPreference).toBe(EBackupPreference.recoveryPhrase);
			}
		});

		it('should parse valid secret key', async () => {
			const secretKey = 'a'.repeat(64);
			mockGetPublicKey.mockResolvedValue(createOkResult('pubkey123'));

			const result = await parseInput(secretKey, 'clipboard');

			expect(result.action).toBe(InputAction.Import);
			if (isImportAction(result.data)) {
				expect(result.data.params.backupPreference).toBe(EBackupPreference.encryptedFile);
			}
		});
	});

	describe('type guards', () => {
		it('isAuthAction should correctly identify auth actions', () => {
			expect(isAuthAction({ action: InputAction.Auth, params: {} as any, rawUrl: '' })).toBe(true);
			expect(isAuthAction({ action: InputAction.Import, params: {} as any })).toBe(false);
		});

		it('isUnknownAction should correctly identify unknown actions', () => {
			expect(isUnknownAction({ action: InputAction.Unknown, params: { rawData: '' } })).toBe(true);
			expect(isUnknownAction({ action: InputAction.Auth, params: {} as any, rawUrl: '' })).toBe(false);
		});
	});
});

