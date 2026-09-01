/**
 * Sanitized auth errors must never include relay URLs or secrets (Kimi H4).
 */

import {
	AUTH_ERROR_LOG_PREFIX,
	classifyAuthError,
	logAuthError,
	sanitizeAuthError,
} from '../authError';

jest.mock('../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

const LEAKY = 'Auth failed at https://relay.example/pubkyauth?secret=abc123';

describe('sanitizeAuthError', () => {
	it('maps timeout text to the stable timeout message', () => {
		const result = sanitizeAuthError(new Error('Authentication request timed out'));
		expect(result.code).toBe('timeout');
		expect(result.message).toBe('auth.timeoutError');
		expect(result.message).not.toMatch(/https?:\/\//);
		expect(result.message).not.toMatch(/secret/i);
	});

	it('never returns raw native text that contains a URL or secret', () => {
		const result = sanitizeAuthError(new Error(LEAKY), 'process');
		expect(result.code).toBe('process');
		expect(result.message).toBe('errors.failedToProcessAuth');
		expect(result.message).not.toContain('relay.example');
		expect(result.message).not.toContain('abc123');
		expect(result.message).not.toContain(LEAKY);
	});

	it('uses the fallback code for unknown objects', () => {
		const result = sanitizeAuthError({ message: LEAKY, relay: 'https://relay.example' }, 'parse');
		expect(result.code).toBe('parse');
		expect(result.message).toBe('errors.failedToParseAuth');
	});

	it('classifies only timeout from raw text; everything else stays allowlisted', () => {
		expect(classifyAuthError('request timeout')).toBe('timeout');
		expect(classifyAuthError(LEAKY, 'failed')).toBe('failed');
		expect(classifyAuthError(undefined, 'signIn')).toBe('signIn');
	});
});

describe('logAuthError', () => {
	it('logs only the allowlisted code, never the native object', () => {
		const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
		logAuthError('process');
		expect(spy).toHaveBeenCalledWith(`${AUTH_ERROR_LOG_PREFIX}process`);
		expect(spy.mock.calls[0].join(' ')).not.toMatch(/https?:\/\//);
		spy.mockRestore();
	});
});
