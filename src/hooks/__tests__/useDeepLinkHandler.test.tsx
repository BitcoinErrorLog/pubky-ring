/**
 * useDeepLinkHandler must not restart on a pubkys slice identity change (H-3).
 */

import React from 'react';
import { act, create } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import pubkyReducer, { addPubky, setDeepLink, setSignedUp } from '../../store/slices/pubkysSlice';
import settingsReducer from '../../store/slices/settingsSlice';
import uiReducer from '../../store/slices/uiSlice';
import { InputAction } from '../../utils/inputParser';
import { processStoredDeepLink } from '../deepLinkProcessor';
import { useDeepLinkHandler } from '../useDeepLinkHandler';

jest.mock('../deepLinkProcessor', () => ({
	processStoredDeepLink: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/store-helpers', () => ({
	getStore: jest.fn(() => ({ pubky: { deepLink: '', pubkys: {} } })),
}));

jest.mock('../../utils/authRequestGeneration', () => {
	let generation = 0;
	return {
		nextRequestGeneration: (): number => {
			generation += 1;
			return generation;
		},
	};
});

const parsedDeepLink = JSON.stringify({
	action: InputAction.Auth,
	data: {
		action: InputAction.Auth,
		params: { relay: 'https://relay.example', secret: 'secret-a', caps: [] },
		rawUrl: 'pubkyauth:///?secret=secret-a',
	},
	source: 'deeplink',
	rawInput: 'pubkyauth:///?secret=secret-a',
});

const Probe = (): null => {
	useDeepLinkHandler(async (): Promise<void> => {}, async (): Promise<void> => {});
	return null;
};

const createTestStore = () => configureStore({
	reducer: {
		pubky: pubkyReducer,
		settings: settingsReducer,
		ui: uiReducer,
	},
});

describe('useDeepLinkHandler identity stability', () => {
	it('does not re-process when signedUpPubkys identity changes', async () => {
		const store = createTestStore();
		store.dispatch(addPubky({ pubky: 'pk:one' }));
		store.dispatch(addPubky({ pubky: 'pk:two' }));
		store.dispatch(setSignedUp({ pubky: 'pk:one', signedUp: true }));
		store.dispatch(setSignedUp({ pubky: 'pk:two', signedUp: true }));
		store.dispatch(setDeepLink(parsedDeepLink));

		let renderer: ReturnType<typeof create>;
		await act(async () => {
			renderer = create(
				<Provider store={store}>
					<Probe />
				</Provider>,
			);
		});

		expect(processStoredDeepLink).toHaveBeenCalledTimes(1);
		const firstCall = (processStoredDeepLink as jest.Mock).mock.calls[0][0];
		expect(firstCall.deepLink).toBe(parsedDeepLink);

		await act(async () => {
			store.dispatch(addPubky({ pubky: 'pk:three' }));
			renderer.update(
				<Provider store={store}>
					<Probe />
				</Provider>,
			);
		});

		expect(processStoredDeepLink).toHaveBeenCalledTimes(1);
	});
});
