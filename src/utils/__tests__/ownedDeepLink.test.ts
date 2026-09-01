/**
 * Ownership-aware deeplink clearing (H-2).
 */

import { InputAction, ParsedInput } from '../inputParser';
import { clearDeepLinkIfMatch } from '../../store/slices/pubkysSlice';
import {
	nextRequestGeneration,
	resetRequestGenerationForTests,
} from '../authRequestGeneration';
import { routeInput } from '../inputRouter';
import { routeInputWithContext } from '../../hooks/inputHandlerUtils';
import { resetDeepLinkIntakeForTests } from '../deepLinkIntake';

jest.mock('../helpers', () => ({
	sleep: jest.fn().mockResolvedValue(undefined),
	showToast: jest.fn(),
}));

jest.mock('../inputRouter', () => ({
	routeInput: jest.fn().mockResolvedValue({
		isOk: () => true,
		isErr: () => false,
		value: 'ok',
	}),
	actionRequiresPubky: jest.fn(() => true),
}));

jest.mock('../clipboard', () => ({
	copyToClipboard: jest.fn(),
}));

jest.mock('../errorHandler', () => ({
	getErrorMessage: jest.fn((err, fallback) => err?.message || err || fallback),
}));

jest.mock('../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

jest.mock('../store-helpers', () => ({
	getStore: jest.fn(() => ({ pubky: { deepLink: '', pubkys: {} } })),
}));

const makeParsed = (secret: string): ParsedInput => ({
	action: InputAction.Auth,
	data: {
		action: InputAction.Auth,
		params: { relay: 'https://relay.example', secret, caps: [] },
		rawUrl: `pubkyauth:///?secret=${secret}`,
	},
	source: 'deeplink',
	rawInput: `pubkyauth:///?secret=${secret}`,
});

describe('routeInputWithContext ownership', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		resetRequestGenerationForTests();
		resetDeepLinkIntakeForTests();
	});

	it('does not let picker A clear newly stored B', async () => {
		const parsedA = makeParsed('secret-a');
		const parsedB = makeParsed('secret-b');
		const ownedA = JSON.stringify(parsedA);
		let stored = JSON.stringify(parsedB);
		const genA = nextRequestGeneration();
		const dispatch = jest.fn((action) => {
			if (action.type === clearDeepLinkIfMatch(ownedA).type && action.payload === stored) {
				stored = '';
			}
		});

		await routeInputWithContext(
			parsedA,
			'pk:one',
			'deeplink',
			dispatch,
			{
				generation: genA,
				ownedDeepLink: ownedA,
				getStoredDeepLink: (): string => stored,
			},
		);

		expect(stored).toBe(JSON.stringify(parsedB));
		expect(dispatch).not.toHaveBeenCalledWith(clearDeepLinkIfMatch(ownedA));
		expect(routeInput).not.toHaveBeenCalled();
	});

	it('clears and routes only when generation is current and stored still matches', async () => {
		const parsedA = makeParsed('secret-a');
		const ownedA = JSON.stringify(parsedA);
		let stored = ownedA;
		const genA = nextRequestGeneration();
		const dispatch = jest.fn((action) => {
			if (
				action.type === clearDeepLinkIfMatch(ownedA).type
				&& action.payload === stored
			) {
				stored = '';
			}
		});

		await routeInputWithContext(
			parsedA,
			'pk:one',
			'deeplink',
			dispatch,
			{
				generation: genA,
				ownedDeepLink: ownedA,
				getStoredDeepLink: (): string => stored,
			},
		);

		expect(stored).toBe('');
		expect(routeInput).toHaveBeenCalledWith(
			parsedA,
			expect.objectContaining({ pubky: 'pk:one', isDeeplink: true }),
		);
	});

	it('does not route a stale generation even if the stored value still matches', async () => {
		const parsedA = makeParsed('secret-a');
		const ownedA = JSON.stringify(parsedA);
		const stale = nextRequestGeneration();
		nextRequestGeneration();
		const dispatch = jest.fn();

		await routeInputWithContext(
			parsedA,
			'pk:one',
			'deeplink',
			dispatch,
			{
				generation: stale,
				ownedDeepLink: ownedA,
				getStoredDeepLink: (): string => ownedA,
			},
		);

		expect(routeInput).not.toHaveBeenCalled();
		expect(dispatch).not.toHaveBeenCalled();
	});
});
