/**
 * App-level intake wrapper. parseInput rejections must not become
 * unhandled promise rejections or leak the raw URL / native error.
 */

import { DeepLinkIntake } from './deepLinkIntake';
import { logAuthError } from './authError';

export const acceptDeepLinkUrl = async (
	intake: DeepLinkIntake,
	url: string,
): Promise<void> => {
	try {
		await intake.handleUrl(url);
	} catch {
		logAuthError('intake');
	}
};
