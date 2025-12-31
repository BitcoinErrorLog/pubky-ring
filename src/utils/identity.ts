/**
 * Identity utilities for accessing the active pubky identity.
 *
 * Provides a way to get the currently selected identity's secret key
 * and public key for signing operations.
 */

import { getStore } from './store-helpers';
import { getPubkyKeys } from '../store/selectors/pubkySelectors';
import { getPubkySecretKey } from './pubky';

export interface StoredIdentity {
	secretKey: string;
	publicKeyZ32: string;
}

/**
 * Get the currently stored identity (first pubky) with its secret key.
 *
 * Returns null if no pubky is configured or secret key cannot be retrieved.
 */
export const getStoredIdentity = async (): Promise<StoredIdentity | null> => {
	const state = getStore();
	const pubkyKeys = getPubkyKeys(state);

	if (pubkyKeys.length === 0) {
		console.log('No pubkys configured');
		return null;
	}

	// Use the first pubky as the active identity
	const activePubky = pubkyKeys[0];

	const secretKeyResult = await getPubkySecretKey(activePubky);
	if (secretKeyResult.isErr()) {
		console.error('Failed to get secret key for identity:', secretKeyResult.error);
		return null;
	}

	return {
		secretKey: secretKeyResult.value.secretKey,
		publicKeyZ32: activePubky,
	};
};

