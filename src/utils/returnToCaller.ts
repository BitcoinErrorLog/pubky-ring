/**
 * Return Ring to the previous Android task after an external pubkyauth grant.
 *
 * Security:
 * - Never reads a callback query from the pubkyauth URI.
 * - Never calls Linking.openURL / http(s) / custom schemes with auth material.
 * - Caller identity is not taken from Intent extras or referrer (spoofable).
 * - Android ACTION_VIEW + FLAG_ACTIVITY_NEW_TASK does not set getCallingPackage().
 *   The only safe deterministic action is to background Ring's own task so the
 *   OS reveals the previously-foreground task.
 * - iOS has no equivalent without an allowlisted callback URL; this is a no-op.
 */

import { NativeModules, Platform } from 'react-native';

type AuthReturnNative = {
	moveTaskToBack: () => Promise<boolean>;
};

const getNative = (): AuthReturnNative | undefined => {
	const native = NativeModules.PubkyAuthReturn as AuthReturnNative | undefined;
	if (!native || typeof native.moveTaskToBack !== 'function') {
		return undefined;
	}
	return native;
};

/**
 * External pubkyauth (another app opened Ring) on Android should return after
 * a successful grant. In-app scan/clipboard and iOS stay in Ring.
 */
export const shouldReturnToPreviousApp = (
	isDeeplink: boolean | undefined,
	os: typeof Platform.OS = Platform.OS,
): boolean => {
	return os === 'android' && isDeeplink === true;
};

/** Bounded wait so a dropped native UI runnable cannot hang callers. */
export const NATIVE_RETURN_TIMEOUT_MS = 2000;

/**
 * Background Ring's Android task. Does not finish the activity so a later
 * ACTION_VIEW can be delivered via onNewIntent on the singleTask MainActivity.
 * Never rejects; a hung native call resolves false after the timeout.
 */
export const moveTaskToBackground = async (
	native: AuthReturnNative | undefined = getNative(),
	os: typeof Platform.OS = Platform.OS,
): Promise<boolean> => {
	if (os !== 'android') {
		return false;
	}
	if (!native) {
		return false;
	}
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeout = new Promise<boolean>((resolve) => {
			timeoutId = setTimeout(() => {
				resolve(false);
			}, NATIVE_RETURN_TIMEOUT_MS);
		});
		const moved = await Promise.race([
			native.moveTaskToBack(),
			timeout,
		]);
		return moved === true;
	} catch {
		return false;
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
	}
};

/**
 * After a successful pubkyauth, background Ring when the launch was an
 * external Android deeplink. Denial and errors must not call this.
 */
export const returnToPreviousAppIfNeeded = async (
	isDeeplink: boolean | undefined,
	os: typeof Platform.OS = Platform.OS,
	native: AuthReturnNative | undefined = getNative(),
): Promise<void> => {
	if (!shouldReturnToPreviousApp(isDeeplink, os)) {
		return;
	}
	await moveTaskToBackground(native, os);
};
