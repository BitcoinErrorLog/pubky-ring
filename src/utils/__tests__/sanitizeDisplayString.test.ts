import { DEVICE_ID_DISPLAY_MAX, sanitizeDisplayString } from '../sanitizeDisplayString';

describe('sanitizeDisplayString', () => {
	it('strips RTL override and caps a 300-char input at 64 with ellipsis', () => {
		const hostile = `\u202E${'A'.repeat(300)}`;
		const displayed = sanitizeDisplayString(hostile, DEVICE_ID_DISPLAY_MAX);

		expect(displayed).toBe(`${'A'.repeat(DEVICE_ID_DISPLAY_MAX)}…`);
		expect(displayed.includes('\u202E')).toBe(false);
		expect(displayed).not.toMatch(/\p{Cf}/u);
		expect(displayed).not.toMatch(/\p{Cc}/u);
		expect(displayed.length).toBe(DEVICE_ID_DISPLAY_MAX + 1);
	});

	it('strips ZWSP, bidi isolates, and C0 controls without capping short strings', () => {
		const mixed = `ok\u200B\u200F\u202A\u202E\u2066\u2069\u0007path`;
		expect(sanitizeDisplayString(mixed)).toBe('okpath');
	});

	it('leaves a clean short deviceId unchanged', () => {
		expect(sanitizeDisplayString('hypercolor-web-1', DEVICE_ID_DISPLAY_MAX))
			.toBe('hypercolor-web-1');
	});
});
