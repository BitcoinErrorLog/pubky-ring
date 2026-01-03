/**
 * Unit tests for importAction
 *
 * Tests import of recovery phrases and secret keys.
 */

import { InputAction, ImportParams } from '../../inputParser';
import { ActionContext } from '../../inputRouter';
import { EBackupPreference } from '../../../types/pubky';

// Mock dependencies before imports
jest.mock('react-native', () => ({
	Platform: { OS: 'ios' },
}));

jest.mock('react-native-actions-sheet', () => ({
	SheetManager: {
		show: jest.fn().mockResolvedValue(undefined),
		hide: jest.fn().mockResolvedValue(undefined),
	},
}));

jest.mock('@synonymdev/react-native-pubky', () => ({
	mnemonicPhraseToKeypair: jest.fn(),
}));

jest.mock('../../pubky', () => ({
	importPubky: jest.fn(),
}));

jest.mock('../../helpers', () => ({
	showToast: jest.fn(),
}));

jest.mock('../../errorHandler', () => ({
	getErrorMessage: jest.fn((err, fallback) => err?.message || err || fallback),
}));

jest.mock('../../sheetHelpers', () => ({
	showImportSuccessSheet: jest.fn(),
	showEditPubkySheet: jest.fn(),
}));

jest.mock('../../store-helpers', () => ({
	getStore: jest.fn(() => ({ pubkys: { byId: {} } })),
}));

jest.mock('../../../store/selectors/pubkySelectors', () => ({
	getPubkyKeys: jest.fn(() => []),
}));

jest.mock('../../constants', () => ({
	SHEET_ANIMATION_DELAY: 0,
	SHEET_TRANSITION_DELAY: 0,
}));

jest.mock('../../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

import { SheetManager } from 'react-native-actions-sheet';
import { mnemonicPhraseToKeypair } from '@synonymdev/react-native-pubky';
import { importPubky } from '../../pubky';
import { showToast } from '../../helpers';
import { showImportSuccessSheet, showEditPubkySheet } from '../../sheetHelpers';
import { getPubkyKeys } from '../../../store/selectors/pubkySelectors';
import { handleImportAction } from '../importAction';

type ImportActionData = {
	action: InputAction.Import;
	params: ImportParams;
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

describe('importAction', () => {
	const mockDispatch = jest.fn();
	const mockContext: ActionContext = {
		dispatch: mockDispatch,
		isDeeplink: false,
	};

	const createActionData = (
		data: string,
		backupPreference: EBackupPreference = EBackupPreference.recoveryPhrase
	): ImportActionData => ({
		action: InputAction.Import,
		params: { data, backupPreference },
	});

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		(importPubky as jest.Mock).mockResolvedValue(createOkResult('imported-pubky'));
		(getPubkyKeys as jest.Mock).mockReturnValue([]);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	describe('recovery phrase import', () => {
		it('should convert mnemonic to secret key and import', async () => {
			(mnemonicPhraseToKeypair as jest.Mock).mockResolvedValue(
				createOkResult({ secret_key: 'derived-secret-key', public_key: 'pubkey' })
			);
			const data = createActionData('word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12');

			const resultPromise = handleImportAction(data, mockContext);
			await jest.runAllTimersAsync();
			const result = await resultPromise;

			expect(mnemonicPhraseToKeypair).toHaveBeenCalled();
			expect(importPubky).toHaveBeenCalledWith({
				secretKey: 'derived-secret-key',
				dispatch: mockDispatch,
				mnemonic: expect.any(String),
			});
			expect(result.isOk()).toBe(true);
		});

		it('should lowercase mnemonic before conversion', async () => {
			(mnemonicPhraseToKeypair as jest.Mock).mockResolvedValue(
				createOkResult({ secret_key: 'key', public_key: 'pubkey' })
			);
			const data = createActionData('WORD1 WORD2', EBackupPreference.recoveryPhrase);

			const resultPromise = handleImportAction(data, mockContext);
			await jest.runAllTimersAsync();
			await resultPromise;

			expect(mnemonicPhraseToKeypair).toHaveBeenCalledWith('word1 word2');
		});

		it('should show error for invalid mnemonic', async () => {
			(mnemonicPhraseToKeypair as jest.Mock).mockResolvedValue(
				createErrResult('Invalid mnemonic')
			);
			const data = createActionData('invalid mnemonic');

			const result = await handleImportAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
				})
			);
		});
	});

	describe('secret key import', () => {
		it('should import secret key directly', async () => {
			const secretKey = 'a'.repeat(64);
			const data = createActionData(secretKey, EBackupPreference.encryptedFile);

			const resultPromise = handleImportAction(data, mockContext);
			await jest.runAllTimersAsync();
			const result = await resultPromise;

			expect(mnemonicPhraseToKeypair).not.toHaveBeenCalled();
			expect(importPubky).toHaveBeenCalledWith({
				secretKey,
				dispatch: mockDispatch,
				mnemonic: '',
			});
			expect(result.isOk()).toBe(true);
		});
	});

	describe('error handling', () => {
		it('should handle import failure', async () => {
			(importPubky as jest.Mock).mockResolvedValue(
				createErrResult('Import failed')
			);
			const data = createActionData('test-data', EBackupPreference.encryptedFile);

			const result = await handleImportAction(data, mockContext);

			expect(result.isErr()).toBe(true);
			expect(showToast).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'error' })
			);
		});

		it('should handle unexpected exceptions', async () => {
			(importPubky as jest.Mock).mockRejectedValue(new Error('Unexpected error'));
			const data = createActionData('test-data', EBackupPreference.encryptedFile);

			const result = await handleImportAction(data, mockContext);

			expect(result.isErr()).toBe(true);
		});

		it('should close camera sheet on iOS before import', async () => {
			const data = createActionData('test-data', EBackupPreference.encryptedFile);

			const resultPromise = handleImportAction(data, mockContext);
			await jest.runAllTimersAsync();
			await resultPromise;

			expect(SheetManager.hide).toHaveBeenCalledWith('camera');
		});
	});

	describe('success handling', () => {
		it('should return imported pubky on success', async () => {
			const data = createActionData('test-data', EBackupPreference.encryptedFile);

			const resultPromise = handleImportAction(data, mockContext);
			await jest.runAllTimersAsync();
			const result = await resultPromise;

			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value).toBe('imported-pubky');
			}
		});
	});
});
