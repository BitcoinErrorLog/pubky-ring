/**
 * Unit tests for helpers
 *
 * Tests utility functions for formatting, validation, and common operations.
 */

import {
	formatSignupToken,
	isValidSignupTokenFormat,
	formatImportData,
	isSecretKeyImport,
	generateBackupFileName,
	sleep,
	isSmallScreen,
	parseInviteCode,
} from '../helpers';
import { EBackupPreference } from '../../types/pubky';

// Mock dependencies
jest.mock('@synonymdev/react-native-pubky', () => ({
	mnemonicPhraseToKeypair: jest.fn(),
	getPublicKeyFromSecretKey: jest.fn(),
}));

jest.mock('react-native-toast-message', () => ({
	default: {
		show: jest.fn(),
	},
}));

jest.mock('react-native', () => ({
	Platform: { OS: 'ios', select: jest.fn((obj) => obj.ios) },
	Dimensions: {
		get: jest.fn(() => ({ height: 800, width: 400 })),
	},
	Share: {
		share: jest.fn().mockResolvedValue({}),
	},
}));

jest.mock('../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

// Mock store-helpers to prevent MMKV import
jest.mock('../store-helpers', () => ({
	getIsOnline: jest.fn(() => true),
}));

// Mock @react-native-community/netinfo
jest.mock('@react-native-community/netinfo', () => ({
	fetch: jest.fn().mockResolvedValue({ isConnected: true }),
}));

import {
	mnemonicPhraseToKeypair,
	getPublicKeyFromSecretKey,
} from '@synonymdev/react-native-pubky';

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

describe('helpers', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('formatSignupToken', () => {
		it('should format alphanumeric characters with hyphens', () => {
			expect(formatSignupToken('ABCD1234EFGH')).toBe('ABCD-1234-EFGH');
		});

		it('should uppercase lowercase input', () => {
			expect(formatSignupToken('abcd1234efgh')).toBe('ABCD-1234-EFGH');
		});

		it('should handle partial input', () => {
			expect(formatSignupToken('ABCD')).toBe('ABCD');
			expect(formatSignupToken('ABCD1234')).toBe('ABCD-1234');
		});

		it('should preserve existing valid hyphens', () => {
			expect(formatSignupToken('ABCD-1234-EFGH')).toBe('ABCD-1234-EFGH');
		});

		it('should ignore invalid characters', () => {
			expect(formatSignupToken('AB@CD#12$34%EF^GH')).toBe('ABCD-1234-EFGH');
		});

		it('should limit to 12 alphanumeric characters', () => {
			expect(formatSignupToken('ABCD1234EFGHIJKL')).toBe('ABCD-1234-EFGH');
		});

		it('should return empty string for empty input', () => {
			expect(formatSignupToken('')).toBe('');
		});

		it('should handle input with only special characters', () => {
			expect(formatSignupToken('@#$%^&')).toBe('');
		});
	});

	describe('isValidSignupTokenFormat', () => {
		it('should return true for valid format', () => {
			expect(isValidSignupTokenFormat('ABCD-1234-EFGH')).toBe(true);
			expect(isValidSignupTokenFormat('abcd-1234-efgh')).toBe(true);
			expect(isValidSignupTokenFormat('A1B2-C3D4-E5F6')).toBe(true);
		});

		it('should return false for invalid formats', () => {
			expect(isValidSignupTokenFormat('ABCD1234EFGH')).toBe(false);
			expect(isValidSignupTokenFormat('ABCD-1234')).toBe(false);
			expect(isValidSignupTokenFormat('ABCD-12345-EFGH')).toBe(false);
			expect(isValidSignupTokenFormat('')).toBe(false);
		});
	});

	describe('formatImportData', () => {
		it('should return empty string for empty input', () => {
			expect(formatImportData('')).toBe('');
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

		it('should normalize separators to spaces', () => {
			expect(formatImportData('word1-word2_word3+word4')).toBe('word1 word2 word3 word4');
		});

		it('should handle combined transformations', () => {
			expect(formatImportData('pubkyring://word1-word2%20word3')).toBe('word1 word2 word3');
		});
	});

	describe('isSecretKeyImport', () => {
		beforeEach(() => {
			mockMnemonicToKeypair.mockResolvedValue(createErrResult('Invalid'));
			mockGetPublicKey.mockResolvedValue(createErrResult('Invalid'));
		});

		it('should identify valid mnemonic phrase', async () => {
			mockMnemonicToKeypair.mockResolvedValue(
				createOkResult({ secret_key: 'abc', public_key: 'xyz' })
			);

			const result = await isSecretKeyImport('word1 word2 word3');

			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value.isSecretKey).toBe(true);
				expect(result.value.backupPreference).toBe(EBackupPreference.recoveryPhrase);
			}
		});

		it('should identify valid secret key', async () => {
			mockGetPublicKey.mockResolvedValue(createOkResult('pubkey'));

			const result = await isSecretKeyImport('a'.repeat(64));

			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value.isSecretKey).toBe(true);
				expect(result.value.backupPreference).toBe(EBackupPreference.encryptedFile);
			}
		});

		it('should return error for invalid data', async () => {
			const result = await isSecretKeyImport('invalid data');

			expect(result.isErr()).toBe(true);
		});

		it('should prefer mnemonic over secret key check', async () => {
			mockMnemonicToKeypair.mockResolvedValue(
				createOkResult({ secret_key: 'abc', public_key: 'xyz' })
			);
			mockGetPublicKey.mockResolvedValue(createOkResult('pubkey'));

			const result = await isSecretKeyImport('some input');

			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value.backupPreference).toBe(EBackupPreference.recoveryPhrase);
			}
		});
	});

	describe('generateBackupFileName', () => {
		it('should generate filename with default prefix', () => {
			const filename = generateBackupFileName();
			expect(filename).toMatch(/^pubky-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
		});

		it('should generate filename with custom prefix', () => {
			const filename = generateBackupFileName('my-backup');
			expect(filename).toMatch(/^my-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
		});

		it('should use current date/time', () => {
			const now = new Date();
			const year = now.getFullYear();
			const filename = generateBackupFileName();
			expect(filename).toContain(String(year));
		});
	});

	// showToast tests are skipped because the Toast mock is complex
	// The function is a thin wrapper around react-native-toast-message

	describe('sleep', () => {
		beforeEach(() => {
			jest.useFakeTimers();
		});

		afterEach(() => {
			jest.useRealTimers();
		});

		it('should resolve after specified time', async () => {
			const promise = sleep(1000);

			jest.advanceTimersByTime(999);
			expect(jest.getTimerCount()).toBe(1);

			jest.advanceTimersByTime(1);
			await promise;

			expect(jest.getTimerCount()).toBe(0);
		});

		it('should default to 1000ms', async () => {
			const promise = sleep();

			jest.advanceTimersByTime(1000);
			await promise;

			expect(jest.getTimerCount()).toBe(0);
		});
	});

	describe('isSmallScreen', () => {
		it('should return false for height >= 700', () => {
			// Default mock returns height: 800
			expect(isSmallScreen()).toBe(false);
		});

		it('should return true for height < 700', () => {
			const { Dimensions } = require('react-native');
			Dimensions.get.mockReturnValueOnce({ height: 600, width: 400 });

			expect(isSmallScreen()).toBe(true);
		});
	});

	describe('parseInviteCode', () => {
		it('should extract invite code from URL', () => {
			expect(parseInviteCode('https://example.com/invite/ABCD-1234-EFGH')).toBe('ABCD-1234-EFGH');
		});

		it('should handle lowercase invite codes', () => {
			expect(parseInviteCode('https://example.com/invite/abcd-1234-efgh')).toBe('abcd-1234-efgh');
		});

		it('should return null for invalid URLs', () => {
			expect(parseInviteCode('https://example.com/other/path')).toBe(null);
			expect(parseInviteCode('random string')).toBe(null);
			expect(parseInviteCode('')).toBe(null);
		});

		it('should handle URLs with additional path segments', () => {
			expect(parseInviteCode('https://example.com/invite/ABCD-1234-EFGH/extra')).toBe('ABCD-1234-EFGH');
		});
	});
});

