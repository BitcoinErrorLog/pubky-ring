/**
 * Interleaved deeplink processor tests (Kimi B1).
 *
 * Picker A must not clear a newer deeplink B when B's hide closes A.
 */

import { SheetManager } from 'react-native-actions-sheet';
import { InputAction, ParsedInput } from '../../utils/inputParser';
import { clearDeepLinkIfMatch } from '../../store/slices/pubkysSlice';
import { routeInput } from '../../utils/inputRouter';
import { resetPickerSessionForTests } from '../inputHandlerUtils';
import {
	HIDE_SHEET_TIMEOUT_MS,
	nextRequestGeneration,
	resetRequestGenerationForTests,
} from '../../utils/authRequestGeneration';
import { processStoredDeepLink } from '../deepLinkProcessor';

const sleepResolvers: Array<() => void> = [];

jest.mock('../../utils/helpers', () => ({
	sleep: jest.fn(() => new Promise<void>((resolve) => {
		sleepResolvers.push(resolve);
	})),
	showToast: jest.fn(),
}));

jest.mock('../../utils/inputRouter', () => ({
	routeInput: jest.fn().mockResolvedValue({
		isOk: () => true,
		isErr: () => false,
		value: 'ok',
	}),
	actionRequiresPubky: jest.fn(() => true),
}));

jest.mock('../../utils/e2eAutoApprove', () => ({
	isE2EAutoApproveEnabled: jest.fn(() => false),
}));

jest.mock('../../utils/clipboard', () => ({
	copyToClipboard: jest.fn(),
}));

jest.mock('../../utils/errorHandler', () => ({
	getErrorMessage: jest.fn((err, fallback) => err?.message || err || fallback),
}));

jest.mock('../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

jest.mock('../../utils/store-helpers', () => ({
	getStore: jest.fn(() => ({ pubky: { deepLink: '', pubkys: {} } })),
}));

type ShowOptions = {
	payload: {
		onSelect: (pubky: string) => void;
	};
	onClose: () => void;
};

const makeParsed = (secret: string): ParsedInput => ({
	action: InputAction.Auth,
	data: {
		action: InputAction.Auth,
		params: { relay: 'https://relay.example', secret, caps: ['/pub:rw'] },
		rawUrl: `pubkyauth:///?secret=${secret}`,
	},
	source: 'deeplink',
	rawInput: `pubkyauth:///?secret=${secret}`,
});

const parsedA = makeParsed('secret-a');
const parsedB = makeParsed('secret-b');

const flushMicrotasks = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};

const flushHides = async (): Promise<void> => {
	await flushMicrotasks();
	jest.advanceTimersByTime(HIDE_SHEET_TIMEOUT_MS);
	await flushMicrotasks();
	jest.advanceTimersByTime(HIDE_SHEET_TIMEOUT_MS);
	await flushMicrotasks();
};

const flushSleep = async (): Promise<void> => {
	const resolve = sleepResolvers.shift();
	resolve?.();
	await flushMicrotasks();
};

const waitForPicker = async (): Promise<void> => {
	await flushHides();
	await flushSleep();
};

describe('processStoredDeepLink interleaving', () => {
	const dispatch = jest.fn();
	const signedUpPubkys = { 'pk:one': {}, 'pk:two': {} };
	let openPickers: ShowOptions[];

	beforeEach(() => {
		jest.useFakeTimers();
		jest.clearAllMocks();
		sleepResolvers.length = 0;
		openPickers = [];
		resetRequestGenerationForTests();
		resetPickerSessionForTests();
		(routeInput as jest.Mock).mockResolvedValue({
			isOk: () => true,
			isErr: () => false,
			value: 'ok',
		});
		(SheetManager.hide as jest.Mock).mockImplementation((id: string) => {
			if (id === 'select-pubky' && openPickers.length > 0) {
				const closing = openPickers.pop();
				closing?.onClose();
			}
			return Promise.resolve();
		});
		(SheetManager.getActiveSheets as jest.Mock).mockImplementation((id: string) => {
			if (id === 'select-pubky' && openPickers.length > 0) {
				return [{ id, context: 'global' }];
			}
			return [];
		});
		(SheetManager.hideAll as jest.Mock).mockResolvedValue(undefined);
		(SheetManager.show as jest.Mock).mockImplementation((_id: string, options: ShowOptions) => {
			openPickers.push(options);
			return Promise.resolve();
		});
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('keeps deeplink B current after A onClose and routes B', async () => {
		let stored = JSON.stringify(parsedA);
		const getStoredDeepLink = (): string => stored;
		const genA = nextRequestGeneration();
		const processA = processStoredDeepLink({
			deepLink: JSON.stringify(parsedA),
			generation: genA,
			dispatch,
			signedUpPubkys,
			allPubkys: signedUpPubkys,
			callbacks: {},
			getStoredDeepLink,
		});
		await waitForPicker();
		expect(openPickers).toHaveLength(1);

		stored = JSON.stringify(parsedB);
		const genB = nextRequestGeneration();
		const processB = processStoredDeepLink({
			deepLink: JSON.stringify(parsedB),
			generation: genB,
			dispatch,
			signedUpPubkys,
			allPubkys: signedUpPubkys,
			callbacks: {},
			getStoredDeepLink,
		});
		await flushMicrotasks();

		expect(dispatch).not.toHaveBeenCalledWith(
			clearDeepLinkIfMatch(JSON.stringify(parsedB)),
		);

		await waitForPicker();
		expect(openPickers).toHaveLength(1);

		openPickers[0].payload.onSelect('pk:two');
		await processB;
		await processA;

		expect(routeInput).toHaveBeenCalledTimes(1);
		expect(routeInput).toHaveBeenCalledWith(
			parsedB,
			expect.objectContaining({
				pubky: 'pk:two',
				isDeeplink: true,
			}),
		);
		expect(dispatch).toHaveBeenCalledWith(
			clearDeepLinkIfMatch(JSON.stringify(parsedB)),
		);
	});

	it('does not show picker A when B arrives during the delay', async () => {
		let stored = JSON.stringify(parsedA);
		const getStoredDeepLink = (): string => stored;
		const genA = nextRequestGeneration();
		const processA = processStoredDeepLink({
			deepLink: JSON.stringify(parsedA),
			generation: genA,
			dispatch,
			signedUpPubkys,
			allPubkys: signedUpPubkys,
			callbacks: {},
			getStoredDeepLink,
		});
		await flushMicrotasks();
		expect(SheetManager.show).not.toHaveBeenCalled();

		stored = JSON.stringify(parsedB);
		const genB = nextRequestGeneration();
		const processB = processStoredDeepLink({
			deepLink: JSON.stringify(parsedB),
			generation: genB,
			dispatch,
			signedUpPubkys,
			allPubkys: signedUpPubkys,
			callbacks: {},
			getStoredDeepLink,
		});
		await flushMicrotasks();

		await flushHides();
		await flushSleep();
		await flushSleep();
		expect(SheetManager.show).toHaveBeenCalledTimes(1);

		openPickers[0].payload.onSelect('pk:one');
		await processB;
		await processA;

		expect(routeInput).toHaveBeenCalledTimes(1);
		expect(routeInput).toHaveBeenCalledWith(
			parsedB,
			expect.objectContaining({ pubky: 'pk:one' }),
		);
	});

	it('does not restart or strand the picker when the pubkys slice identity changes', async () => {
		const stored = JSON.stringify(parsedA);
		const genA = nextRequestGeneration();
		const processA = processStoredDeepLink({
			deepLink: JSON.stringify(parsedA),
			generation: genA,
			dispatch,
			signedUpPubkys,
			allPubkys: signedUpPubkys,
			callbacks: {},
			getStoredDeepLink: (): string => stored,
		});
		await waitForPicker();
		expect(openPickers).toHaveLength(1);

		const signedUpPubkysNext = { ...signedUpPubkys };
		expect(signedUpPubkysNext).not.toBe(signedUpPubkys);
		expect(Object.keys(signedUpPubkysNext)).toEqual(Object.keys(signedUpPubkys));

		openPickers[0].payload.onSelect('pk:one');
		await processA;

		expect(routeInput).toHaveBeenCalledTimes(1);
		expect(routeInput).toHaveBeenCalledWith(
			parsedA,
			expect.objectContaining({ pubky: 'pk:one' }),
		);
		expect(SheetManager.show).toHaveBeenCalledTimes(1);
		expect(dispatch).toHaveBeenCalledWith(
			clearDeepLinkIfMatch(JSON.stringify(parsedA)),
		);
	});

	it('shows picker when SheetManager.hide never settles', async () => {
		(SheetManager.getActiveSheets as jest.Mock).mockImplementation((id: string) => [
			{ id, context: 'global' },
		]);
		(SheetManager.hide as jest.Mock).mockReturnValue(new Promise(() => undefined));
		const stored = JSON.stringify(parsedA);
		const genA = nextRequestGeneration();
		const processA = processStoredDeepLink({
			deepLink: stored,
			generation: genA,
			dispatch,
			signedUpPubkys,
			allPubkys: signedUpPubkys,
			callbacks: {},
			getStoredDeepLink: (): string => stored,
		});
		await flushMicrotasks();
		expect(openPickers).toHaveLength(0);

		await flushHides();
		await flushSleep();
		expect(openPickers).toHaveLength(1);

		openPickers[0].payload.onSelect('pk:one');
		await flushHides();
		await processA;
		expect(routeInput).toHaveBeenCalledTimes(1);
	});
});
