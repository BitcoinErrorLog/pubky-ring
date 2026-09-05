import fs from 'fs';
import path from 'path';
import {
	cancelDeferredHandoffDeletes,
	trackDeferredHandoffDelete,
	untrackDeferredHandoffDelete,
	unrefTimerIfPossible,
} from '../handoffDeleteTimers';

describe('handoffDeleteTimers', () => {
	afterEach(() => {
		cancelDeferredHandoffDeletes();
		jest.clearAllTimers();
	});

	it('unrefTimerIfPossible is a no-op for numeric ids and unrefs Node timeouts', () => {
		expect(() => unrefTimerIfPossible(123 as unknown as ReturnType<typeof setTimeout>)).not.toThrow();
		const timer = setTimeout(() => undefined, 60_000);
		unrefTimerIfPossible(timer);
		clearTimeout(timer);
	});

	it('cancelDeferredHandoffDeletes clears tracked timers before they fire', () => {
		jest.useFakeTimers();
		try {
			const fn = jest.fn();
			let entry: { timer: ReturnType<typeof setTimeout>; pubky: string };
			entry = {
				pubky: 'alice',
				timer: setTimeout(() => {
					untrackDeferredHandoffDelete(entry);
					fn();
				}, 5 * 60 * 1000),
			};
			trackDeferredHandoffDelete(entry);
			cancelDeferredHandoffDeletes();
			jest.advanceTimersByTime(5 * 60 * 1000);
			expect(fn).not.toHaveBeenCalled();
		} finally {
			jest.useRealTimers();
		}
	});
});

describe('F-C call sites', () => {
	it('SettingsScreen wipe cancels deferred deletes before wipeKeychain', () => {
		const src = fs.readFileSync(
			path.join(__dirname, '../../screens/SettingsScreen.tsx'),
			'utf8',
		);
		const cancelAt = src.indexOf('cancelDeferredHandoffDeletes()');
		const wipeAt = src.indexOf('wipeKeychain()');
		expect(cancelAt).toBeGreaterThan(-1);
		expect(wipeAt).toBeGreaterThan(cancelAt);
	});

	it('deletePubky and signOutOfHomeserver cancel that pubky\'s deferred deletes', () => {
		const src = fs.readFileSync(
			path.join(__dirname, '../pubky.ts'),
			'utf8',
		);
		expect(src).toMatch(/export const deletePubky[\s\S]*?cancelDeferredHandoffDeletes\(pubky\)/);
		expect(src).toMatch(/export const signOutOfHomeserver[\s\S]*?cancelDeferredHandoffDeletes\(pubky\)/);
	});
});
