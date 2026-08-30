/**
 * Debug / simulator-only auto-approve for pubkyauth capability requests.
 *
 * `__DEV__` is true in Metro Debug builds (`yarn ios`, Xcode Debug → Simulator).
 * Release / TestFlight / App Store compiles this to false.
 *
 * Lets Hypercolor P6 open a `pubkyauth://` URL via `xcrun simctl openurl`
 * without a human tapping the pubky picker or Authorize.
 */
export const isE2EAutoApproveEnabled = (): boolean => {
	return __DEV__;
};
