/**
 * Last-arrival-wins intake for Linking URLs.
 *
 * parseInput is async; a slower older parse must not overwrite a newer URL.
 * Identical in-flight / just-stored URLs are dropped so getInitialURL + the
 * url event do not process the same string twice.
 */

import { ParsedInput, InputSource } from './inputParser';

export type DeepLinkParseFn = (
	url: string,
	source: InputSource,
) => Promise<ParsedInput>;

export type DeepLinkIntake = {
	handleUrl: (url: string) => Promise<void>;
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
	let lastStoredUrl: string | null = null;

	return {
		handleUrl: async (url: string): Promise<void> => {
			if (!url) {
				return;
			}
			if (url === inFlightUrl || url === lastStoredUrl) {
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
				storeParsed(parsed);
			} finally {
				if (requestId === seq) {
					inFlightUrl = null;
				}
			}
		},
	};
};
