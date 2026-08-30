/**
 * Open a pubkyauth / pubkyring deep link into the app under test.
 *
 * Hypercolor P6: pass `startAuthFlow().authorizationUrl` as-is
 * (typically `pubkyauth:///?caps=...&secret=...&relay=...`).
 *
 * Shell equivalent on a booted iOS Simulator:
 *   xcrun simctl openurl booted "$AUTHORIZATION_URL"
 */
export async function openDeepLink(url: string): Promise<void> {
	if (driver.isIOS) {
		const bundleId = process.env.IOS_BUNDLE_ID || 'app.pubkyring';
		await driver.execute('mobile: deepLink', { url, bundleId });
		return;
	}

	await driver.execute('mobile: deepLink', {
		url,
		package: process.env.APP_PACKAGE || 'to.pubky.ring',
	});
}
