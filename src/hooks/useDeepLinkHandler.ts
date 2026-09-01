/**
 * useDeepLinkHandler Hook
 *
 * Handles deeplinks from Redux state using the unified input system.
 * This hook watches the deepLink Redux state and routes parsed inputs to handlers.
 */

import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
	getAllPubkys,
	getDeepLink,
	getSignedUpPubkys,
} from '../store/selectors/pubkySelectors';
import { nextRequestGeneration } from '../utils/authRequestGeneration';
import { processStoredDeepLink } from './deepLinkProcessor';
import { PubkyCallbacks } from './inputHandlerUtils';

/**
 * Hook for handling deeplinks using the unified input system
 *
 * @param createPubky - Callback to create a new pubky (for when no pubkys exist)
 * @param importPubky - Callback to import a pubky (for when no pubkys exist)
 */
export const useDeepLinkHandler = (
	createPubky: () => Promise<void>,
	importPubky: (mnemonic?: string) => Promise<any>,
): void => {
	const dispatch = useDispatch();
	const deepLink = useSelector(getDeepLink);
	const signedUpPubkys = useSelector(getSignedUpPubkys);
	const allPubkys = useSelector(getAllPubkys);

	const signedUpPubkysRef = useRef(signedUpPubkys);
	const allPubkysRef = useRef(allPubkys);
	const createPubkyRef = useRef(createPubky);
	const importPubkyRef = useRef(importPubky);
	signedUpPubkysRef.current = signedUpPubkys;
	allPubkysRef.current = allPubkys;
	createPubkyRef.current = createPubky;
	importPubkyRef.current = importPubky;

	useEffect(() => {
		if (!deepLink) {
			return;
		}

		const generation = nextRequestGeneration();
		const callbacks: PubkyCallbacks = {
			createPubky: createPubkyRef.current,
			importPubky: importPubkyRef.current,
		};

		processStoredDeepLink({
			deepLink,
			generation,
			dispatch,
			signedUpPubkys: signedUpPubkysRef.current,
			allPubkys: allPubkysRef.current,
			callbacks,
		});
		// signedUpPubkys identity changes must not restart an open picker.
		 
	}, [deepLink, dispatch]);
};
