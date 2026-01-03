/**
 * Unit tests for inputRouter
 *
 * Tests the input routing logic that dispatches parsed input to action handlers.
 */

import { routeInput, actionRequiresPubky, actionRequiresNetwork, ActionContext } from '../inputRouter';
import { InputAction, ParsedInput } from '../inputParser';

// Mock all action handlers
jest.mock('../actions/authAction', () => ({
	handleAuthAction: jest.fn(),
}));
jest.mock('../actions/importAction', () => ({
	handleImportAction: jest.fn(),
}));
jest.mock('../actions/signupAction', () => ({
	handleSignupAction: jest.fn(),
}));
jest.mock('../actions/inviteAction', () => ({
	handleInviteAction: jest.fn(),
}));
jest.mock('../actions/profileAction', () => ({
	handleProfileAction: jest.fn(),
}));
jest.mock('../actions/followsAction', () => ({
	handleFollowsAction: jest.fn(),
}));
jest.mock('../actions/paykitConnectAction', () => ({
	handlePaykitConnectAction: jest.fn(),
}));
jest.mock('../actions/signMessageAction', () => ({
	handleSignMessageAction: jest.fn(),
}));
jest.mock('../errorHandler', () => ({
	getErrorMessage: jest.fn((err, fallback) => err?.message || err || fallback),
}));
jest.mock('../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

import { handleAuthAction } from '../actions/authAction';
import { handleImportAction } from '../actions/importAction';
import { handleSignupAction } from '../actions/signupAction';
import { handleInviteAction } from '../actions/inviteAction';
import { handleProfileAction } from '../actions/profileAction';
import { handleFollowsAction } from '../actions/followsAction';
import { handlePaykitConnectAction } from '../actions/paykitConnectAction';
import { handleSignMessageAction } from '../actions/signMessageAction';

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

describe('inputRouter', () => {
	const mockDispatch = jest.fn();
	const mockContext: ActionContext = {
		dispatch: mockDispatch,
		pubky: 'test-pubky',
		isDeeplink: true,
	};

	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('routeInput', () => {
		it('should route auth action to handleAuthAction', async () => {
			(handleAuthAction as jest.Mock).mockResolvedValue(createOkResult('success'));

			const parsed: ParsedInput = {
				action: InputAction.Auth,
				data: {
					action: InputAction.Auth,
					params: { relay: 'test', secret: 'test', caps: [] },
					rawUrl: 'pubkyauth://test',
				},
				source: 'deeplink',
				rawInput: 'pubkyauth://test',
			};

			const result = await routeInput(parsed, mockContext);

			expect(handleAuthAction).toHaveBeenCalled();
			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value.action).toBe(InputAction.Auth);
			}
		});

		it('should route import action to handleImportAction', async () => {
			(handleImportAction as jest.Mock).mockResolvedValue(createOkResult('imported-pubky'));

			const parsed: ParsedInput = {
				action: InputAction.Import,
				data: {
					action: InputAction.Import,
					params: { data: 'mnemonic words', backupPreference: 1 },
				},
				source: 'clipboard',
				rawInput: 'mnemonic words',
			};

			const result = await routeInput(parsed, mockContext);

			expect(handleImportAction).toHaveBeenCalled();
			expect(result.isOk()).toBe(true);
		});

		it('should route signup action to handleSignupAction', async () => {
			(handleSignupAction as jest.Mock).mockResolvedValue(createOkResult('new-pubky'));

			const parsed: ParsedInput = {
				action: InputAction.Signup,
				data: {
					action: InputAction.Signup,
					params: {
						homeserver: 'https://home.example.com',
						inviteCode: 'ABCD-1234-EFGH',
						relay: 'https://relay.example.com',
						secret: 'secret',
						caps: [],
					},
				},
				source: 'deeplink',
				rawInput: 'pubkyring://signup?...',
			};

			const result = await routeInput(parsed, mockContext);

			expect(handleSignupAction).toHaveBeenCalled();
			expect(result.isOk()).toBe(true);
		});

		it('should route invite action to handleInviteAction', async () => {
			(handleInviteAction as jest.Mock).mockResolvedValue(createOkResult('new-pubky'));

			const parsed: ParsedInput = {
				action: InputAction.Invite,
				data: {
					action: InputAction.Invite,
					params: { inviteCode: 'ABCD-1234-EFGH' },
				},
				source: 'scan',
				rawInput: 'ABCD-1234-EFGH',
			};

			const result = await routeInput(parsed, mockContext);

			expect(handleInviteAction).toHaveBeenCalled();
			expect(result.isOk()).toBe(true);
		});

		it('should route get-profile action to handleProfileAction', async () => {
			(handleProfileAction as jest.Mock).mockResolvedValue(createOkResult('pubkey'));

			const parsed: ParsedInput = {
				action: InputAction.GetProfile,
				data: {
					action: InputAction.GetProfile,
					params: { pubkey: 'abc123', callback: 'bitkit://profile' },
				},
				source: 'deeplink',
				rawInput: 'pubkyring://get-profile?...',
			};

			const result = await routeInput(parsed, mockContext);

			expect(handleProfileAction).toHaveBeenCalled();
			expect(result.isOk()).toBe(true);
		});

		it('should route get-follows action to handleFollowsAction', async () => {
			(handleFollowsAction as jest.Mock).mockResolvedValue(createOkResult('pubky'));

			const parsed: ParsedInput = {
				action: InputAction.GetFollows,
				data: {
					action: InputAction.GetFollows,
					params: { callback: 'bitkit://follows' },
				},
				source: 'deeplink',
				rawInput: 'pubkyring://get-follows?...',
			};

			const result = await routeInput(parsed, mockContext);

			expect(handleFollowsAction).toHaveBeenCalled();
			expect(result.isOk()).toBe(true);
		});

		it('should route paykit-connect action to handlePaykitConnectAction', async () => {
			(handlePaykitConnectAction as jest.Mock).mockResolvedValue(createOkResult('pubky'));

			const parsed: ParsedInput = {
				action: InputAction.PaykitConnect,
				data: {
					action: InputAction.PaykitConnect,
					params: { deviceId: 'device', callback: 'bitkit://paykit' },
				},
				source: 'deeplink',
				rawInput: 'pubkyring://paykit-connect?...',
			};

			const result = await routeInput(parsed, mockContext);

			expect(handlePaykitConnectAction).toHaveBeenCalled();
			expect(result.isOk()).toBe(true);
		});

		it('should route sign-message action to handleSignMessageAction', async () => {
			(handleSignMessageAction as jest.Mock).mockResolvedValue(createOkResult('signature'));

			const parsed: ParsedInput = {
				action: InputAction.SignMessage,
				data: {
					action: InputAction.SignMessage,
					params: { message: 'Hello', callback: 'bitkit://signature' },
				},
				source: 'deeplink',
				rawInput: 'pubkyring://sign-message?...',
			};

			const result = await routeInput(parsed, mockContext);

			expect(handleSignMessageAction).toHaveBeenCalled();
			expect(result.isOk()).toBe(true);
		});

		it('should return error for unknown action', async () => {
			const parsed: ParsedInput = {
				action: InputAction.Unknown,
				data: {
					action: InputAction.Unknown,
					params: { rawData: 'garbage' },
				},
				source: 'clipboard',
				rawInput: 'garbage',
			};

			const result = await routeInput(parsed, mockContext);

			expect(result.isErr()).toBe(true);
		});

		it('should set isDeeplink based on source when not provided', async () => {
			(handleAuthAction as jest.Mock).mockResolvedValue(createOkResult('success'));

			const parsed: ParsedInput = {
				action: InputAction.Auth,
				data: {
					action: InputAction.Auth,
					params: { relay: 'test', secret: 'test', caps: [] },
					rawUrl: 'pubkyauth://test',
				},
				source: 'deeplink',
				rawInput: 'pubkyauth://test',
			};

			// Don't provide isDeeplink in context
			const contextWithoutDeeplink: ActionContext = {
				dispatch: mockDispatch,
				pubky: 'test-pubky',
			};

			await routeInput(parsed, contextWithoutDeeplink);

			expect(handleAuthAction).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ isDeeplink: true })
			);
		});

		it('should handle handler exceptions gracefully', async () => {
			(handleAuthAction as jest.Mock).mockRejectedValue(new Error('Handler crashed'));

			const parsed: ParsedInput = {
				action: InputAction.Auth,
				data: {
					action: InputAction.Auth,
					params: { relay: 'test', secret: 'test', caps: [] },
					rawUrl: 'pubkyauth://test',
				},
				source: 'deeplink',
				rawInput: 'pubkyauth://test',
			};

			const result = await routeInput(parsed, mockContext);

			expect(result.isErr()).toBe(true);
		});
	});

	describe('actionRequiresPubky', () => {
		it('should return true for actions that require pubky', () => {
			expect(actionRequiresPubky(InputAction.Auth)).toBe(true);
			expect(actionRequiresPubky(InputAction.GetFollows)).toBe(true);
			expect(actionRequiresPubky(InputAction.PaykitConnect)).toBe(true);
			expect(actionRequiresPubky(InputAction.SignMessage)).toBe(true);
		});

		it('should return false for actions that do not require pubky', () => {
			expect(actionRequiresPubky(InputAction.Import)).toBe(false);
			expect(actionRequiresPubky(InputAction.Signup)).toBe(false);
			expect(actionRequiresPubky(InputAction.Invite)).toBe(false);
			expect(actionRequiresPubky(InputAction.GetProfile)).toBe(false);
			expect(actionRequiresPubky(InputAction.Unknown)).toBe(false);
		});
	});

	describe('actionRequiresNetwork', () => {
		it('should return true for actions that require network', () => {
			expect(actionRequiresNetwork(InputAction.Auth)).toBe(true);
			expect(actionRequiresNetwork(InputAction.Signup)).toBe(true);
			expect(actionRequiresNetwork(InputAction.Invite)).toBe(true);
			expect(actionRequiresNetwork(InputAction.GetProfile)).toBe(true);
			expect(actionRequiresNetwork(InputAction.GetFollows)).toBe(true);
			expect(actionRequiresNetwork(InputAction.PaykitConnect)).toBe(true);
		});

		it('should return false for actions that do not require network', () => {
			expect(actionRequiresNetwork(InputAction.Import)).toBe(false);
			expect(actionRequiresNetwork(InputAction.SignMessage)).toBe(false);
			expect(actionRequiresNetwork(InputAction.Unknown)).toBe(false);
		});
	});
});
