/**
 * Input-handler failures must log a bounded code, never raw content.
 */

import React, { useEffect } from 'react';
import { act, create } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import pubkyReducer from '../../store/slices/pubkysSlice';
import settingsReducer from '../../store/slices/settingsSlice';
import uiReducer from '../../store/slices/uiSlice';
import { parseInput } from '../../utils/inputParser';
import { AUTH_ERROR_LOG_PREFIX } from '../../utils/authError';
import { useInputHandler } from '../useInputHandler';

jest.mock('../../utils/inputParser', () => {
	const actual = jest.requireActual('../../utils/inputParser');
	return {
		...actual,
		parseInput: jest.fn(),
	};
});

jest.mock('../../utils/inputRouter', () => ({
	actionRequiresPubky: jest.fn(() => false),
	actionRequiresNetwork: jest.fn(() => false),
	shouldCloseCameraBeforeRouting: jest.fn(() => true),
}));

jest.mock('../../utils/store-helpers', () => ({
	getIsOnline: jest.fn(() => true),
	getStore: jest.fn(() => ({ pubky: { pubkys: {} } })),
}));

jest.mock('../../utils/clipboard', () => ({
	readFromClipboard: jest.fn(),
}));

jest.mock('../../utils/helpers', () => ({
	showToast: jest.fn(),
	checkNetworkConnection: jest.fn(),
}));

jest.mock('../../utils/actions/migrateAction', () => ({
	handleMigrationScannerClose: jest.fn(),
	resetMigrateAccumulator: jest.fn(),
}));

jest.mock('../../utils/e2eAutoApprove', () => ({
	isE2EAutoApproveEnabled: jest.fn(() => false),
}));

jest.mock('../inputHandlerUtils', () => ({
	routeInputWithContext: jest.fn(),
	showPubkySelectionSheet: jest.fn(),
	handleNoPubkysAvailable: jest.fn(),
}));

jest.mock('../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

type HandleInput = (data: string, source: 'scan' | 'clipboard' | 'deeplink') => Promise<void>;

const Probe = ({ onReady }: { onReady: (handleInput: HandleInput) => void }): null => {
	const { handleInput } = useInputHandler();
	useEffect(() => {
		onReady(handleInput);
	}, [handleInput, onReady]);
	return null;
};

describe('useInputHandler error logging', () => {
	it('logs only a bounded code when processing throws', async () => {
		(parseInput as jest.Mock).mockRejectedValue(
			new Error('native failed pubkyauth:///?secret=abc123'),
		);

		const store = configureStore({
			reducer: {
				pubky: pubkyReducer,
				settings: settingsReducer,
				ui: uiReducer,
			},
		});

		let handleInput: HandleInput | undefined;
		await act(async () => {
			create(
				<Provider store={store}>
					<Probe onReady={(fn): void => {
						handleInput = fn;
					}} />
				</Provider>,
			);
		});

		const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		await act(async () => {
			await handleInput?.('pubkyauth:///?secret=abc123', 'scan');
		});

		const logged = errorSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
		expect(logged).toContain(`${AUTH_ERROR_LOG_PREFIX}input`);
		expect(logged).not.toContain('abc123');
		expect(logged).not.toContain('pubkyauth://');
		errorSpy.mockRestore();
	});
});
