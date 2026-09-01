/**
 * Last-arrival-wins intake for Linking URLs.
 *
 * parseInput is async; a slower older parse must not overwrite a newer URL.
 * Identical URLs are dropped only while a parse is in flight or inside a
 * short window after store — enough for overlapping getInitialURL + url
 * delivery. acknowledgeDeepLinkConsumed() (or the window expiring) allows
 * a legitimate identical retry after deny/cancel.
 */

import { ParsedInput, InputSource } from './inputParser';

export const DEEPLINK_DEDUPE_WINDOW_MS = 500;

export type DeepLinkParseFn = (
	url: string,
	source: InputSource,
) => Promise<ParsedInput>;

export type DeepLinkIntake = {
	handleUrl: (url: string) => Promise<void>;
};

let lastStoredUrl: string | null = null;
let lastStoredAt = 0;

const isWithinDedupeWindow = (url: string, now: number): boolean => {
	return lastStoredUrl === url && now - lastStoredAt < DEEPLINK_DEDUPE_WINDOW_MS;
};

export const acknowledgeDeepLinkConsumed = (): void => {
	lastStoredUrl = null;
	lastStoredAt = 0;
};

export const resetDeepLinkIntakeForTests = (): void => {
	acknowledgeDeepLinkConsumed();
};

export const createDeepLinkIntake = ({
	parseInput,
	storeParsed,
}: {
	parseInput: DeepLinkParseFn;
	storeParsed: (parsed: ParsedInput) => void;
}): DeepLinkIntake => {
	let seq = 0;
	let inFlightUrl: string | null = null;

	return {
		handleUrl: async (url: string): Promise<void> => {
			if (!url) {
				return;
			}
			const now = Date.now();
			if (url === inFlightUrl || isWithinDedupeWindow(url, now)) {
				return;
			}

			const requestId = ++seq;
			inFlightUrl = url;
			try {
				const parsed = await parseInput(url, 'deeplink');
				if (requestId !== seq) {
					return;
				}
				lastStoredUrl = url;
				lastStoredAt = Date.now();
				storeParsed(parsed);
			} finally {
				if (requestId === seq) {
					inFlightUrl = null;
				}
			}
		},
	};
};
