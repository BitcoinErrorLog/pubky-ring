/**
 * Last-arrival-wins deeplink intake (Kimi H2).
 */

import { InputAction, ParsedInput } from '../inputParser';
import { createDeepLinkIntake } from '../deepLinkIntake';

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

	it('dedupes an identical URL that was just stored', async () => {
		const parseInput = jest.fn(async (url: string) => makeParsed(url));
		const storeParsed = jest.fn();
		const intake = createDeepLinkIntake({ parseInput, storeParsed });

		await intake.handleUrl('pubkyauth:///?secret=same');
		await intake.handleUrl('pubkyauth:///?secret=same');

		expect(parseInput).toHaveBeenCalledTimes(1);
		expect(storeParsed).toHaveBeenCalledTimes(1);
	});
});
