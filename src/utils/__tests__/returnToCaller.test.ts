/**
 * Unit tests for returning to the previous Android task after pubkyauth.
 *
 * These assert the policy: never open a callback URL, only background Ring
 * after a successful external Android deeplink grant.
 */

import {
	shouldReturnToPreviousApp,
	moveTaskToBackground,
	returnToPreviousAppIfNeeded,
	NATIVE_RETURN_TIMEOUT_MS,
} from '../returnToCaller';
import fs from 'fs';
import path from 'path';

describe('returnToCaller', () => {
	it('does not import Linking or open URLs', () => {
		const source = fs.readFileSync(
			path.join(__dirname, '../returnToCaller.ts'),
			'utf8',
		);
		const imports = source
			.split('\n')
			.filter(line => line.startsWith('import'))
			.join('\n');
		expect(imports).not.toMatch(/Linking/);
		expect(source).not.toMatch(/callback=/);
	});

	it('uses the RN 0.83 Activity API and never inspects or launches a URI', () => {
		const native = fs.readFileSync(
			path.join(
				__dirname,
				'../../../android/app/src/main/java/to/pubkyring/PubkyAuthReturnModule.kt',
			),
			'utf8',
		);
		expect(native).toMatch(/reactApplicationContext\.getCurrentActivity\(\)/);
		expect(native).toMatch(/moveTaskToBack\(true\)/);
		expect(native).toMatch(/runOnUiThread/);
		expect(native).toMatch(/resolveOnce\(false\)/);
		expect(native).toMatch(/isFinishing/);
		expect(native).toMatch(/isDestroyed/);
		expect(native).not.toMatch(/getIntent\(/);
		expect(native).not.toMatch(/startActivity\(/);
		expect(native).not.toMatch(/Intent\(/);
		expect(native).not.toMatch(/Linking/);
		expect(native).not.toMatch(/console\./);
		expect(native).not.toMatch(/promise\.reject/);
	});
	describe('shouldReturnToPreviousApp', () => {
		it('returns true only for Android external deeplink launches', () => {
			expect(shouldReturnToPreviousApp(true, 'android')).toBe(true);
		});

		it('returns false for in-app scan/clipboard on Android', () => {
			expect(shouldReturnToPreviousApp(false, 'android')).toBe(false);
			expect(shouldReturnToPreviousApp(undefined, 'android')).toBe(false);
		});

		it('returns false on iOS even for deeplinks', () => {
			expect(shouldReturnToPreviousApp(true, 'ios')).toBe(false);
		});
	});

	describe('moveTaskToBackground', () => {
		it('calls the native task-back API on Android', async () => {
			const moveTaskToBack = jest.fn().mockResolvedValue(true);
			const moved = await moveTaskToBackground({ moveTaskToBack }, 'android');
			expect(moveTaskToBack).toHaveBeenCalledTimes(1);
			expect(moved).toBe(true);
		});

		it('does not call native on iOS', async () => {
			const moveTaskToBack = jest.fn().mockResolvedValue(true);
			const moved = await moveTaskToBackground({ moveTaskToBack }, 'ios');
			expect(moveTaskToBack).not.toHaveBeenCalled();
			expect(moved).toBe(false);
		});

		it('returns false when native is missing', async () => {
			const moved = await moveTaskToBackground(undefined, 'android');
			expect(moved).toBe(false);
		});

		it('returns false when native throws', async () => {
			const moveTaskToBack = jest.fn().mockRejectedValue(new Error('fail'));
			const moved = await moveTaskToBackground({ moveTaskToBack }, 'android');
			expect(moved).toBe(false);
		});

		it('resolves false when native never settles', async () => {
			jest.useFakeTimers();
			let resolveNative: ((value: boolean) => void) | undefined;
			const moveTaskToBack = jest.fn(() => new Promise<boolean>((resolve) => {
				resolveNative = resolve;
			}));
			const pending = moveTaskToBackground({ moveTaskToBack }, 'android');
			await jest.advanceTimersByTimeAsync(NATIVE_RETURN_TIMEOUT_MS);
			await expect(pending).resolves.toBe(false);
			resolveNative?.(false);
			jest.useRealTimers();
		});

		it('ignores late native resolution after the timeout', async () => {
			jest.useFakeTimers();
			let resolveNative: ((value: boolean) => void) | undefined;
			const moveTaskToBack = jest.fn(() => new Promise<boolean>((resolve) => {
				resolveNative = resolve;
			}));
			const pending = moveTaskToBackground({ moveTaskToBack }, 'android');
			await jest.advanceTimersByTimeAsync(NATIVE_RETURN_TIMEOUT_MS);
			await expect(pending).resolves.toBe(false);
			resolveNative?.(true);
			await expect(pending).resolves.toBe(false);
			jest.useRealTimers();
		});
	});

	describe('returnToPreviousAppIfNeeded', () => {
		it('backgrounds Ring after a successful Android deeplink auth', async () => {
			const moveTaskToBack = jest.fn().mockResolvedValue(true);
			await returnToPreviousAppIfNeeded(true, 'android', { moveTaskToBack });
			expect(moveTaskToBack).toHaveBeenCalledTimes(1);
		});

		it('does nothing on deny/error paths that never call it', async () => {
			const moveTaskToBack = jest.fn().mockResolvedValue(true);
			await returnToPreviousAppIfNeeded(false, 'android', { moveTaskToBack });
			expect(moveTaskToBack).not.toHaveBeenCalled();
		});

		it('does nothing on iOS', async () => {
			const moveTaskToBack = jest.fn().mockResolvedValue(true);
			await returnToPreviousAppIfNeeded(true, 'ios', { moveTaskToBack });
			expect(moveTaskToBack).not.toHaveBeenCalled();
		});
	});
});
