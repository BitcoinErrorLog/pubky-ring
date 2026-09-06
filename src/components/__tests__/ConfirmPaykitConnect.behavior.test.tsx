/**
 * ConfirmPaykitConnect shows destination, deviceId, caps, and verification code.
 */

import React from 'react';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import pubkyReducer, { addPubky } from '../../store/slices/pubkysSlice';
import settingsReducer from '../../store/slices/settingsSlice';
import uiReducer from '../../store/slices/uiSlice';
import {
	nextRequestGeneration,
	resetRequestGenerationForTests,
} from '../../utils/authRequestGeneration';

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
	const Mock = ({ children, testID, onPress, disabled }: {
		children?: unknown;
		testID?: string;
		onPress?: () => void;
		disabled?: boolean;
	}) =>
		ReactLib.createElement(
			ReactNative.Pressable,
			{ testID, onPress, disabled },
			children,
		);
	return {
		ActionButton: Mock,
		ActionSheetContainer: ({ children }: { children?: unknown }) =>
			ReactLib.createElement(ReactNative.View, null, children),
		Folder: () => null,
		SessionText: ({ children, testID }: { children?: unknown; testID?: string }) =>
			ReactLib.createElement(ReactNative.Text, { testID }, children),
		Text: ({ children }: { children?: unknown }) =>
			ReactLib.createElement(ReactNative.Text, null, children),
		View: ({ children, testID }: { children?: unknown; testID?: string }) =>
			ReactLib.createElement(ReactNative.View, { testID }, children),
		SkiaGradient: ({ children }: { children?: unknown }) =>
			ReactLib.createElement(ReactNative.View, null, children),
		Globe: () => null,
	};
});

jest.mock('../PubkyCard.tsx', () => (): null => null);
jest.mock('../ModalIndicator.tsx', () => (): null => null);

jest.mock('react-i18next', () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

jest.mock('../../utils/clipboard', () => ({
	copyToClipboard: jest.fn(),
}));

import ConfirmPaykitConnect from '../ConfirmPaykitConnect';

const findByTestId = (root: ReactTestInstance, testID: string): ReactTestInstance => {
	return root.find((node) => node.props.testID === testID);
};

const collectText = (node: ReactTestInstance): string => {
	const parts: string[] = [];
	const walk = (current: ReactTestInstance): void => {
		if (typeof current === 'string') {
			parts.push(current);
			return;
		}
		if (typeof current.props?.children === 'string') {
			parts.push(current.props.children);
		}
		current.children.forEach((child) => {
			if (typeof child === 'string') {
				parts.push(child);
			} else if (child) {
				walk(child as ReactTestInstance);
			}
		});
	};
	walk(node);
	return parts.join(' ');
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

describe('ConfirmPaykitConnect render behavior', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		resetRequestGenerationForTests();
	});

	it('renders destination, deviceId, verification code, warning, and caps', async () => {
		const current = nextRequestGeneration();
		const onDecision = jest.fn();
		const store = createStore();
		let renderer: ReturnType<typeof create>;
		await act(async () => {
			renderer = create(
				<Provider store={store}>
					<ConfirmPaykitConnect
						payload={{
							pubky: 'pk:current',
							destination: 'hypercolor.app — web browser',
							deviceId: 'hypercolor-web-1',
							capabilities: [{ path: '/pub/paykit/', permission: 'rw' }],
							verificationCode: '8eO-wP5',
							requestGeneration: current,
							onDecision,
							includesWebSession: true,
						}}
					/>
				</Provider>,
			);
		});

		const text = collectText(renderer!.root);
		expect(text).toContain('hypercolor.app — web browser');
		expect(text).toContain('hypercolor-web-1');
		expect(text).toContain('8eO-wP5');
		expect(text).toContain('session.paykitConnectSessionLine');
		expect(text).toContain('/pub/paykit/');
		expect(text).toContain('DMs / Paykit');
		expect(findByTestId(renderer!.root, 'ConfirmPaykitConnectDestination')).toBeTruthy();
		expect(findByTestId(renderer!.root, 'ConfirmPaykitConnectDeviceId')).toBeTruthy();
		expect(findByTestId(renderer!.root, 'ConfirmPaykitConnectVerification')).toBeTruthy();
	});

	it('renders the Hypercolor mobile combined session line', async () => {
		const current = nextRequestGeneration();
		const store = createStore();
		let renderer: ReturnType<typeof create>;
		await act(async () => {
			renderer = create(
				<Provider store={store}>
					<ConfirmPaykitConnect
						payload={{
							pubky: 'pk:current',
							destination: 'hypercolor:// app on this device',
							deviceId: 'hypercolor-19c8e5a3c00',
							capabilities: [
								{ path: '/pub/paykit/', permission: 'rw' },
								{ path: '/pub/hypercolor.app/v1/', permission: 'rw' },
							],
							verificationCode: '8eO-wP5',
							requestGeneration: current,
							includesHypercolorMobileSession: true,
						}}
					/>
				</Provider>,
			);
		});

		const text = collectText(renderer!.root);
		expect(text).toContain('session.paykitConnectMobileTitle');
		expect(text).toContain('session.paykitConnectMobileSessionLine');
		expect(text).toContain('session.paykitConnectVerificationMobile');
		expect(text).toContain('/pub/paykit/');
		expect(text).toContain('/pub/hypercolor.app/v1/');
	});

	it('Approve calls onDecision(true) only for the current generation', async () => {
		const current = nextRequestGeneration();
		const onDecision = jest.fn();
		const store = createStore();
		let renderer: ReturnType<typeof create>;
		await act(async () => {
			renderer = create(
				<Provider store={store}>
					<ConfirmPaykitConnect
						payload={{
							pubky: 'pk:current',
							destination: 'bitkit:// app on this device',
							deviceId: 'device123',
							capabilities: [],
							verificationCode: 'rdp-GLf',
							requestGeneration: current,
							onDecision,
						}}
					/>
				</Provider>,
			);
		});

		await act(async () => {
			findByTestId(renderer!.root, 'ConfirmPaykitConnectApproveButton').props.onPress();
		});
		expect(onDecision).toHaveBeenCalledWith(true);
	});

	it('does not Approve when the request generation is stale', async () => {
		const stale = nextRequestGeneration();
		nextRequestGeneration();
		const onDecision = jest.fn();
		const store = createStore();
		let renderer: ReturnType<typeof create>;
		await act(async () => {
			renderer = create(
				<Provider store={store}>
					<ConfirmPaykitConnect
						payload={{
							pubky: 'pk:current',
							destination: 'hypercolor.app — web browser',
							deviceId: 'device123',
							capabilities: [],
							verificationCode: '8eO-wP5',
							requestGeneration: stale,
							onDecision,
						}}
					/>
				</Provider>,
			);
		});

		await act(async () => {
			findByTestId(renderer!.root, 'ConfirmPaykitConnectApproveButton').props.onPress();
		});
		expect(onDecision).not.toHaveBeenCalled();
	});

	it('Deny calls onDecision(false)', async () => {
		const current = nextRequestGeneration();
		const onDecision = jest.fn();
		const store = createStore();
		let renderer: ReturnType<typeof create>;
		await act(async () => {
			renderer = create(
				<Provider store={store}>
					<ConfirmPaykitConnect
						payload={{
							pubky: 'pk:current',
							destination: 'hypercolor:// app on this device',
							deviceId: 'device123',
							capabilities: [],
							verificationCode: '8eO-wP5',
							requestGeneration: current,
							onDecision,
						}}
					/>
				</Provider>,
			);
		});

		await act(async () => {
			findByTestId(renderer!.root, 'ConfirmPaykitConnectDenyButton').props.onPress();
		});
		expect(onDecision).toHaveBeenCalledWith(false);
	});
});
