module.exports = {
	preset: 'react-native',
	setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
	moduleNameMapper: {
		'^@synonymdev/react-native-pubky$': '<rootDir>/__mocks__/@synonymdev/react-native-pubky.ts',
	},
	// Transform ESM modules that Jest can't handle natively
	transformIgnorePatterns: [
		'node_modules/(?!(react-native|@react-native|react-native-actions-sheet|react-native-toast-message|react-native-system-navigation-bar|react-native-gesture-handler|react-native-reanimated|react-native-worklets|@react-native-community|@react-navigation|lucide-react-native|react-native-svg|@shopify|bip39)/)',
	],
	// Use node test environment for unit tests
	testEnvironment: 'node',
	// Ignore E2E tests in Jest unit test runs
	testPathIgnorePatterns: [
		'/node_modules/',
		'/e2e/',
	],
	// Test match pattern - only test __tests__ directories
	testMatch: [
		'**/src/**/__tests__/**/*.test.{ts,tsx}',
	],
	// Clear mocks between tests
	clearMocks: true,
	// Collect coverage from src
	collectCoverageFrom: [
		'src/**/*.{ts,tsx}',
		'!src/**/*.d.ts',
		'!src/**/index.ts',
	],
};
