/**
 * Render-level ConfirmAuth grant and return-to-caller gating (H-3).
 */

import React from 'react';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ok } from '@synonymdev/result';
import pubkyReducer, { addPubky } from '../../store/slices/pubkysSlice';
import settingsReducer from '../../store/slices/settingsSlice';
import uiReducer from '../../store/slices/uiSlice';
import {
	nextRequestGeneration,
	resetRequestGenerationForTests,
} from '../../utils/authRequestGeneration';
import { performAuth } from '../../utils/pubky';
import { moveTaskToBackground } from '../../utils/returnToCaller';

jest.mock('react-native-reanimated', () => ({
	useSharedValue: jest.fn(() => ({ value: 0 })),
	useAnimatedStyle: jest.fn(() => ({})),
	withTiming: jest.fn((value) => value),
	withSequence: jest.fn((...values) => values[values.length - 1]),
	withSpring: jest.fn((value) => value),
}));

jest.mock('../../utils/pubky', () => ({
	performAuth: jest.fn(),
	truncatePubky: jest.fn((value: string) => value),
}));

jest.mock('../../utils/returnToCaller', () => ({
	moveTaskToBackground: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../utils/helpers.ts', () => ({
	showToast: jest.fn(),
	getToastStyle: jest.fn(() => ({})),
	isSmallScreen: jest.fn(() => false),
}));

jest.mock('../../theme/toastConfig.tsx', () => ({
	toastConfig: jest.fn(() => ({})),
}));

jest.mock('react-native-toast-message', () => ({
	__esModule: true,
	default: (): null => null,
}));

jest.mock('../../theme/components', () => {
	const ReactLib = require('react');
	const ReactNative = require('react-native');
	const Mock = ({ children, testID, onPressIn, disabled }: {
		children?: unknown;
		testID?: string;
		onPressIn?: () => void;
		disabled?: boolean;
	}) =>
		ReactLib.createElement(
			ReactNative.Pressable,
			{ testID, onPress: disabled ? undefined : onPressIn, disabled },
			children,
		);
	return {
		ActionButton: Mock,
		ActionSheetContainer: ({ children }: { children?: unknown }) =>
			ReactLib.createElement(ReactNative.View, null, children),
		AnimatedView: ({ children }: { children?: unknown }) =>
			ReactLib.createElement(ReactNative.View, null, children),
		Folder: () => null,
		SessionText: ({ children }: { children?: unknown }) =>
			ReactLib.createElement(ReactNative.Text, null, children),
		Text: ({ children }: { children?: unknown }) =>
			ReactLib.createElement(ReactNative.Text, null, children),
		View: ({ children }: { children?: unknown }) =>
			ReactLib.createElement(ReactNative.View, null, children),
		SkiaGradient: ({ children }: { children?: unknown }) =>
			ReactLib.createElement(ReactNative.View, null, children),
		Globe: () => null,
		CircleCheck: () => null,
	};
});

jest.mock('../PubkyCard.tsx', () => (): null => null);
jest.mock('../ModalIndicator.tsx', () => (): null => null);
jest.mock('../ProgressBar.tsx', () => (): null => null);

jest.mock('react-i18next', () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

import ConfirmAuth from '../ConfirmAuth';

const findByTestId = (root: ReactTestInstance, testID: string): ReactTestInstance => {
	return root.find((node) => node.props.testID === testID);
};

const createStore = () => {
	const store = configureStore({
		reducer: {
			pubky: pubkyReducer,
			settings: settingsReducer,
			ui: uiReducer,
		},
	});
	store.dispatch(addPubky({ pubky: 'pk:current' }));
	return store;
};

const authDetails = {
	relay: 'https://relay.example',
	secret: 'secret',
	capabilities: [{ path: '/pub', permission: 'rw' }],
};

describe('ConfirmAuth render behavior', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		resetRequestGenerationForTests();
		(performAuth as jest.Mock).mockResolvedValue(ok('success'));
		const { SheetManager } = require('react-native-actions-sheet');
		(SheetManager.hide as jest.Mock).mockResolvedValue(undefined);
	});

	it('does not authorize when the request generation is stale', async () => {
		const stale = nextRequestGeneration();
		nextRequestGeneration();
		const store = createStore();
		let renderer: ReturnType<typeof create>;
		await act(async () => {
			renderer = create(
				<Provider store={store}>
					<ConfirmAuth
						payload={{
							pubky: 'pk:current',
							authUrl: 'pubkyauth:///?secret=stale',
							authDetails,
							onComplete: jest.fn(),
							returnToCaller: true,
							requestGeneration: stale,
						}}
					/>
				</Provider>,
			);
		});

		await act(async () => {
			const button = findByTestId(renderer!.root, 'ConfirmAuthAuthorizeButton');
			(button.props.onPressIn ?? button.props.onPress)();
		});

		expect(performAuth).not.toHaveBeenCalled();
		expect(moveTaskToBackground).not.toHaveBeenCalled();
	});

	it('backgrounds Ring only after a successful current grant with returnToCaller', async () => {
		const current = nextRequestGeneration();
		const store = createStore();
		let renderer: ReturnType<typeof create>;
		await act(async () => {
			renderer = create(
				<Provider store={store}>
					<ConfirmAuth
						payload={{
							pubky: 'pk:current',
							authUrl: 'pubkyauth:///?secret=current',
							authDetails,
							onComplete: jest.fn(),
							returnToCaller: true,
							requestGeneration: current,
						}}
					/>
				</Provider>,
			);
		});

		await act(async () => {
			const button = findByTestId(renderer!.root, 'ConfirmAuthAuthorizeButton');
			(button.props.onPressIn ?? button.props.onPress)();
		});

		expect(performAuth).toHaveBeenCalledWith(expect.objectContaining({
			pubky: 'pk:current',
			authUrl: 'pubkyauth:///?secret=current',
		}));
		expect(moveTaskToBackground).toHaveBeenCalledTimes(1);
	});

	it('does not background Ring after a successful in-app grant', async () => {
		const current = nextRequestGeneration();
		const store = createStore();
		let renderer: ReturnType<typeof create>;
		await act(async () => {
			renderer = create(
				<Provider store={store}>
					<ConfirmAuth
						payload={{
							pubky: 'pk:current',
							authUrl: 'pubkyauth:///?secret=current',
							authDetails,
							onComplete: jest.fn(),
							returnToCaller: false,
							requestGeneration: current,
						}}
					/>
				</Provider>,
			);
		});

		await act(async () => {
			const button = findByTestId(renderer!.root, 'ConfirmAuthAuthorizeButton');
			(button.props.onPressIn ?? button.props.onPress)();
		});

		expect(performAuth).toHaveBeenCalled();
		expect(moveTaskToBackground).not.toHaveBeenCalled();
	});

	it('does not background when a newer request arrives during confirm hide', async () => {
		const { SheetManager } = require('react-native-actions-sheet');
		let resolveHide: (() => void) | undefined;
		const hideDeferred = new Promise<void>((resolve) => {
			resolveHide = resolve;
		});
		(SheetManager.hide as jest.Mock).mockImplementation((id: string) => {
			if (id === 'confirm-auth') {
				return hideDeferred;
			}
			return Promise.resolve();
		});

		const current = nextRequestGeneration();
		const store = createStore();
		let renderer: ReturnType<typeof create>;
		await act(async () => {
			renderer = create(
				<Provider store={store}>
					<ConfirmAuth
						payload={{
							pubky: 'pk:current',
							authUrl: 'pubkyauth:///?secret=current',
							authDetails,
							onComplete: jest.fn(),
							returnToCaller: true,
							requestGeneration: current,
						}}
					/>
				</Provider>,
			);
		});

		await act(async () => {
			const button = findByTestId(renderer!.root, 'ConfirmAuthAuthorizeButton');
			(button.props.onPressIn ?? button.props.onPress)();
		});

		expect(performAuth).toHaveBeenCalled();
		expect(moveTaskToBackground).not.toHaveBeenCalled();

		nextRequestGeneration();

		await act(async () => {
			resolveHide?.();
			await hideDeferred;
		});

		expect(moveTaskToBackground).not.toHaveBeenCalled();
	});
});

