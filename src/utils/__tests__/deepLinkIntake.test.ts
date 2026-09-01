/**
 * Last-arrival-wins deeplink intake (H-1).
 */

import { InputAction, ParsedInput } from '../inputParser';
import {
	acknowledgeDeepLinkConsumed,
	createDeepLinkIntake,
	DEEPLINK_DEDUPE_WINDOW_MS,
	resetDeepLinkIntakeForTests,
} from '../deepLinkIntake';

const makeParsed = (url: string): ParsedInput => ({
	action: InputAction.Auth,
	data: {
		action: InputAction.Auth,
		params: { relay: 'https://relay.example', secret: url, caps: [] },
		rawUrl: url,
	},
	source: 'deeplink',
	rawInput: url,
});

describe('createDeepLinkIntake', () => {
	beforeEach(() => {
		jest.useFakeTimers();
		jest.setSystemTime(0);
		resetDeepLinkIntakeForTests();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('stores B when A resolves last', async () => {
		let resolveA: ((parsed: ParsedInput) => void) | undefined;
		let resolveB: ((parsed: ParsedInput) => void) | undefined;
		const parseInput = jest.fn((url: string) => {
			if (url === 'url-a') {
				return new Promise<ParsedInput>((resolve) => {
					resolveA = resolve;
				});
			}
			return new Promise<ParsedInput>((resolve) => {
				resolveB = resolve;
			});
		});
		const storeParsed = jest.fn();
		const intake = createDeepLinkIntake({ parseInput, storeParsed });

		const doneA = intake.handleUrl('url-a');
		const doneB = intake.handleUrl('url-b');

		resolveA?.(makeParsed('url-a'));
		await doneA;
		expect(storeParsed).not.toHaveBeenCalled();

		resolveB?.(makeParsed('url-b'));
		await doneB;

		expect(storeParsed).toHaveBeenCalledTimes(1);
		expect(storeParsed).toHaveBeenCalledWith(makeParsed('url-b'));
		expect(parseInput).toHaveBeenCalledTimes(2);
	});

	it('does not route a stale request after a newer URL arrives', async () => {
		const stored: string[] = [];
		let resolveA: ((parsed: ParsedInput) => void) | undefined;
		const parseInput = jest.fn((url: string) => {
			if (url === 'url-a') {
				return new Promise<ParsedInput>((resolve) => {
					resolveA = resolve;
				});
			}
			return Promise.resolve(makeParsed(url));
		});
		const intake = createDeepLinkIntake({
			parseInput,
			storeParsed: (parsed) => {
				stored.push(parsed.rawInput);
			},
		});

		const doneA = intake.handleUrl('url-a');
		await intake.handleUrl('url-b');
		resolveA?.(makeParsed('url-a'));
		await doneA;

		expect(stored).toEqual(['url-b']);
	});

	it('dedupes an identical URL that arrives while the first parse is in flight', async () => {
		let resolveFirst: ((parsed: ParsedInput) => void) | undefined;
		const parseInput = jest.fn(() => new Promise<ParsedInput>((resolve) => {
			resolveFirst = resolve;
		}));
		const storeParsed = jest.fn();
		const intake = createDeepLinkIntake({ parseInput, storeParsed });

		const first = intake.handleUrl('pubkyauth:///?secret=same');
		const second = intake.handleUrl('pubkyauth:///?secret=same');
		resolveFirst?.(makeParsed('pubkyauth:///?secret=same'));
		await Promise.all([first, second]);

		expect(parseInput).toHaveBeenCalledTimes(1);
		expect(storeParsed).toHaveBeenCalledTimes(1);
	});

	it('drops an immediate duplicate after store (overlapping getInitialURL/url)', async () => {
		const parseInput = jest.fn(async (url: string) => makeParsed(url));
		const storeParsed = jest.fn();
		const intake = createDeepLinkIntake({ parseInput, storeParsed });

		await intake.handleUrl('pubkyauth:///?secret=same');
		await intake.handleUrl('pubkyauth:///?secret=same');

		expect(parseInput).toHaveBeenCalledTimes(1);
		expect(storeParsed).toHaveBeenCalledTimes(1);
	});

	it('accepts an identical retry after the dedupe window expires', async () => {
		const parseInput = jest.fn(async (url: string) => makeParsed(url));
		const storeParsed = jest.fn();
		const intake = createDeepLinkIntake({ parseInput, storeParsed });

		await intake.handleUrl('pubkyauth:///?secret=same');
		jest.setSystemTime(DEEPLINK_DEDUPE_WINDOW_MS + 1);
		await intake.handleUrl('pubkyauth:///?secret=same');

		expect(parseInput).toHaveBeenCalledTimes(2);
		expect(storeParsed).toHaveBeenCalledTimes(2);
	});

	it('accepts an identical retry immediately after consumption acknowledgement', async () => {
		const parseInput = jest.fn(async (url: string) => makeParsed(url));
		const storeParsed = jest.fn();
		const intake = createDeepLinkIntake({ parseInput, storeParsed });

		await intake.handleUrl('pubkyauth:///?secret=same');
		acknowledgeDeepLinkConsumed();
		await intake.handleUrl('pubkyauth:///?secret=same');

		expect(parseInput).toHaveBeenCalledTimes(2);
		expect(storeParsed).toHaveBeenCalledTimes(2);
	});
});
