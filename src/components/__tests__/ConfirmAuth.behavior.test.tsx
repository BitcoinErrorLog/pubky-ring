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
	const Mock = ({ children, testID, onPress, onPressIn, disabled }: {
		children?: unknown;
		testID?: string;
		onPress?: () => void;
		onPressIn?: () => void;
		disabled?: boolean;
	}) =>
		ReactLib.createElement(
			ReactNative.Pressable,
			{ testID, onPress, onPressIn, disabled },
			children,
		);
	return {
		ActionButton: Mock,
		ActionSheetContainer: ({ children }: { children?: unknown }) => {
			return ReactLib.createElement(ReactNative.View, null, children);
		},
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
type MockProgressBarMount = { onComplete?: () => void; unmounted: boolean };

const mockProgressBarMounts: MockProgressBarMount[] = [];

// Records mount/unmount instead of running the real 60s timer, so the suite can
// assert that a new request remounts the timer rather than reusing an elapsed one.
jest.mock('../ProgressBar.tsx', () => {
	const ReactLib = require('react');
	return ({ onComplete }: { onComplete?: () => void }): null => {
		ReactLib.useEffect(() => {
			const mount: MockProgressBarMount = { onComplete, unmounted: false };
			mockProgressBarMounts.push(mount);
			return (): void => {
				mount.unmounted = true;
			};
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, []);
		return null;
	};
});

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
		mockProgressBarMounts.length = 0;
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
			button.props.onPress();
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
			button.props.onPress();
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
			button.props.onPress();
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
			button.props.onPress();
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

	// ProgressBar is mocked out, so this covers mounting only and says nothing
	// about the real 60s auth timer.
	it('does not hide or grant on mount without interaction', async () => {
		jest.useFakeTimers();
		try {
			const current = nextRequestGeneration();
			const store = createStore();
			const { SheetManager } = require('react-native-actions-sheet');
			await act(async () => {
				create(
					<Provider store={store}>
						<ConfirmAuth
							payload={{
								pubky: 'pk:current',
								authUrl: 'pubkyauth:///?secret=current',
								authDetails,
								onComplete: jest.fn(),
								requestGeneration: current,
							}}
						/>
					</Provider>,
				);
			});
			await act(async () => {
				jest.advanceTimersByTime(1000);
			});
			expect(SheetManager.hide).not.toHaveBeenCalled();
			expect(performAuth).not.toHaveBeenCalled();
		} finally {
			jest.useRealTimers();
		}
	});

	it('does not close or grant from onPressIn alone', async () => {
		const current = nextRequestGeneration();
		const store = createStore();
		const { SheetManager } = require('react-native-actions-sheet');
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
							requestGeneration: current,
						}}
					/>
				</Provider>,
			);
		});

		await act(async () => {
			const deny = findByTestId(renderer!.root, 'ConfirmAuthDenyButton');
			const authorize = findByTestId(renderer!.root, 'ConfirmAuthAuthorizeButton');
			deny.props.onPressIn?.();
			authorize.props.onPressIn?.();
		});
		expect(SheetManager.hide).not.toHaveBeenCalled();
		expect(performAuth).not.toHaveBeenCalled();
	});

	it('closes on Deny onPress', async () => {
		const current = nextRequestGeneration();
		const store = createStore();
		const { SheetManager } = require('react-native-actions-sheet');
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
							requestGeneration: current,
						}}
					/>
				</Provider>,
			);
		});

		await act(async () => {
			findByTestId(renderer!.root, 'ConfirmAuthDenyButton').props.onPress();
		});
		expect(SheetManager.hide).toHaveBeenCalledWith('confirm-auth');
		expect(performAuth).not.toHaveBeenCalled();
	});

	it('remounts the auth timer for a new request so a stale timer cannot close it', async () => {
		const first = nextRequestGeneration();
		const store = createStore();
		const { SheetManager } = require('react-native-actions-sheet');
		const renderPayload = (requestGeneration: number): React.ReactElement => (
			<Provider store={store}>
				<ConfirmAuth
					payload={{
						pubky: 'pk:current',
						authUrl: 'pubkyauth:///?secret=current',
						authDetails,
						onComplete: jest.fn(),
						requestGeneration,
					}}
				/>
			</Provider>
		);

		let renderer: ReturnType<typeof create>;
		await act(async () => {
			renderer = create(renderPayload(first));
		});
		expect(mockProgressBarMounts).toHaveLength(1);
		expect(mockProgressBarMounts[0].unmounted).toBe(false);

		const second = nextRequestGeneration();
		await act(async () => {
			renderer!.update(renderPayload(second));
		});

		// The superseded request's timer is torn down and a fresh one starts,
		// rather than the new request inheriting an already-elapsed timer.
		expect(mockProgressBarMounts).toHaveLength(2);
		expect(mockProgressBarMounts[0].unmounted).toBe(true);
		expect(mockProgressBarMounts[1].unmounted).toBe(false);

		// The superseded timer is torn down before it can complete, so it can
		// never close or grant the request that replaced it.
		expect(SheetManager.hide).not.toHaveBeenCalled();
		expect(performAuth).not.toHaveBeenCalled();
		expect(moveTaskToBackground).not.toHaveBeenCalled();

		// Only the live timer is still wired to the sheet.
		await act(async () => {
			mockProgressBarMounts[1].onComplete?.();
		});
		expect(SheetManager.hide).toHaveBeenCalledWith('confirm-auth');
	});
});

