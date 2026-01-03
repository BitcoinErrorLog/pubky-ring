/**
 * Jest setup file
 *
 * This file is run before each test file.
 * It sets up mocks for React Native modules and other dependencies.
 */

// Mock react-native-keychain
jest.mock('react-native-keychain', () => ({
	setGenericPassword: jest.fn().mockResolvedValue(true),
	getGenericPassword: jest.fn().mockResolvedValue({ password: 'mock' }),
	resetGenericPassword: jest.fn().mockResolvedValue(true),
	setInternetCredentials: jest.fn().mockResolvedValue(true),
	getInternetCredentials: jest.fn().mockResolvedValue({ password: 'mock' }),
	resetInternetCredentials: jest.fn().mockResolvedValue(true),
}));

// Mock react-native-mmkv
jest.mock('react-native-mmkv', () => ({
	MMKV: jest.fn().mockImplementation(() => ({
		set: jest.fn(),
		getString: jest.fn(),
		getNumber: jest.fn(),
		getBoolean: jest.fn(),
		delete: jest.fn(),
		contains: jest.fn(),
		clearAll: jest.fn(),
	})),
	createMMKV: jest.fn().mockImplementation(() => ({
		set: jest.fn(),
		getString: jest.fn(),
		getNumber: jest.fn(),
		getBoolean: jest.fn(),
		delete: jest.fn(),
		contains: jest.fn(),
		clearAll: jest.fn(),
	})),
}));

// Mock @react-native-async-storage/async-storage
jest.mock('@react-native-async-storage/async-storage', () =>
	require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock react-native-localize
jest.mock('react-native-localize', () => ({
	getLocales: jest.fn().mockReturnValue([{ languageCode: 'en', countryCode: 'US' }]),
}));

// Mock react-native-actions-sheet
jest.mock('react-native-actions-sheet', () => ({
	SheetManager: {
		show: jest.fn().mockResolvedValue(undefined),
		hide: jest.fn().mockResolvedValue(undefined),
		hideAll: jest.fn().mockResolvedValue(undefined),
	},
	registerSheet: jest.fn(),
	default: jest.fn(() => null),
}));

// Mock react-native-system-navigation-bar
jest.mock('react-native-system-navigation-bar', () => ({
	default: {
		navigationHide: jest.fn().mockResolvedValue(undefined),
		navigationShow: jest.fn().mockResolvedValue(undefined),
		setNavigationColor: jest.fn().mockResolvedValue(undefined),
	},
	navigationHide: jest.fn().mockResolvedValue(undefined),
	navigationShow: jest.fn().mockResolvedValue(undefined),
}));

// Mock react-native-toast-message
jest.mock('react-native-toast-message', () => ({
	default: {
		show: jest.fn(),
		hide: jest.fn(),
	},
	show: jest.fn(),
	hide: jest.fn(),
}));

// Mock @react-native-community/netinfo
jest.mock('@react-native-community/netinfo', () => ({
	fetch: jest.fn().mockResolvedValue({ isConnected: true }),
	addEventListener: jest.fn(() => jest.fn()),
}));

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => ({
	default: {
		Value: jest.fn(),
		event: jest.fn(),
		add: jest.fn(),
		eq: jest.fn(),
		set: jest.fn(),
		cond: jest.fn(),
		interpolate: jest.fn(),
		View: jest.fn(() => null),
		createAnimatedComponent: jest.fn((c) => c),
		Extrapolation: { CLAMP: 'clamp' },
	},
	useSharedValue: jest.fn(() => ({ value: 0 })),
	useAnimatedStyle: jest.fn(() => ({})),
	withTiming: jest.fn((v) => v),
	withSpring: jest.fn((v) => v),
	Easing: { linear: jest.fn() },
	Extrapolation: { CLAMP: 'clamp' },
}));

// Mock react-native-worklets
jest.mock('react-native-worklets', () => ({
	Worklets: {
		createRunInJsFn: jest.fn((fn) => fn),
	},
}));

// Mock crypto for generateRequestId
if (typeof global.crypto === 'undefined') {
	global.crypto = {
		getRandomValues: (arr) => {
			for (let i = 0; i < arr.length; i++) {
				arr[i] = Math.floor(Math.random() * 256);
			}
			return arr;
		},
	};
}

// Mock TextEncoder if not available
if (typeof global.TextEncoder === 'undefined') {
	global.TextEncoder = class TextEncoder {
		encode(str) {
			const buf = Buffer.from(str, 'utf-8');
			return new Uint8Array(buf);
		}
	};
}

// Silence console warnings in tests
global.console = {
	...console,
	warn: jest.fn(),
	error: jest.fn(),
	log: jest.fn(),
};
