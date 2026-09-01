/**
 * Compare-and-clear for stored deeplinks.
 *
 * A stale owner must not wipe a newer request. Clear only when the
 * caller still owns the generation and the stored value is still theirs.
 */

import { Dispatch } from 'redux';
import { clearDeepLinkIfMatch } from '../store/slices/pubkysSlice';
import { getDeepLink } from '../store/selectors/pubkySelectors';
import { getStore } from './store-helpers';
import { isCurrentRequest } from './authRequestGeneration';
import { acknowledgeDeepLinkConsumed } from './deepLinkIntake';

export type DeepLinkOwnership = {
	generation: number;
	ownedDeepLink: string;
	getStoredDeepLink?: () => string;
};

export const readStoredDeepLink = (): string => {
	return getDeepLink(getStore());
};

export const tryClearOwnedDeepLink = (
	dispatch: Dispatch,
	ownership: DeepLinkOwnership,
): boolean => {
	if (!isCurrentRequest(ownership.generation)) {
		return false;
	}
	const stored = ownership.getStoredDeepLink
		? ownership.getStoredDeepLink()
		: readStoredDeepLink();
	if (stored !== ownership.ownedDeepLink) {
		return false;
	}
	dispatch(clearDeepLinkIfMatch(ownership.ownedDeepLink));
	acknowledgeDeepLinkConsumed();
	return true;
};
