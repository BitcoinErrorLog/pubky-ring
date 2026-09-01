/**
 * ConfirmAuth authorize gate.
 *
 * A leftover confirmation sheet must not call performAuth after a newer
 * request has taken ownership.
 */

import { Result } from '@synonymdev/result';
import { shouldAuthorizeRequest } from './authRequestGeneration';

export const runConfirmAuthGrant = async (
	requestGeneration: number | undefined,
	authorize: () => Promise<Result<string>>,
): Promise<Result<string> | 'stale'> => {
	if (!shouldAuthorizeRequest(requestGeneration)) {
		return 'stale';
	}
	return authorize();
};
