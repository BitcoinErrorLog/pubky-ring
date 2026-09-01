/**
 * Intake parse rejections must not leak URLs or become unhandled (H-6).
 */

import fs from 'fs';
import path from 'path';
import { acceptDeepLinkUrl } from '../acceptDeepLinkUrl';
import { AUTH_ERROR_LOG_PREFIX } from '../authError';

jest.mock('../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

describe('acceptDeepLinkUrl', () => {
	it('swallows parse rejections and logs only a bounded code', async () => {
		const leaky = 'pubkyauth:///?secret=abc123';
		const intake = {
			handleUrl: jest.fn().mockRejectedValue(new Error(`parse failed ${leaky}`)),
		};
		const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

		await expect(acceptDeepLinkUrl(intake, leaky)).resolves.toBeUndefined();

		const logged = errorSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
		expect(logged).toContain(`${AUTH_ERROR_LOG_PREFIX}intake`);
		expect(logged).not.toContain('abc123');
		expect(logged).not.toContain(leaky);
		errorSpy.mockRestore();
	});

	it('does not reject when handleUrl succeeds', async () => {
		const intake = { handleUrl: jest.fn().mockResolvedValue(undefined) };
		await expect(acceptDeepLinkUrl(intake, 'pubkyauth:///?secret=x')).resolves.toBeUndefined();
		expect(intake.handleUrl).toHaveBeenCalledTimes(1);
	});
});

describe('App initial URL failure', () => {
	it('logs only the bounded intake code, never a raw native error', () => {
		const source = fs.readFileSync(
			path.join(__dirname, '../../../App.tsx'),
			'utf8',
		);
		expect(source).toMatch(/logAuthError\('intake'\)/);
		expect(source).not.toMatch(/Error getting initial URL/);
		expect(source).not.toMatch(/catch\s*\(\s*err\s*\)/);
	});
});
