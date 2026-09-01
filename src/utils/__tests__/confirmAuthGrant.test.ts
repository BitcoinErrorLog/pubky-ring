/**
 * ConfirmAuth grant ownership (Kimi H3).
 */

import { err, ok } from '@synonymdev/result';
import {
	nextRequestGeneration,
	resetRequestGenerationForTests,
	shouldAuthorizeRequest,
} from '../authRequestGeneration';
import { runConfirmAuthGrant } from '../confirmAuthGrant';
import { sanitizeAuthError } from '../authError';

jest.mock('../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

describe('runConfirmAuthGrant', () => {
	beforeEach(() => {
		resetRequestGenerationForTests();
	});

	it('does not call authorize when a newer request owns the generation', async () => {
		const stale = nextRequestGeneration();
		nextRequestGeneration();
		const authorize = jest.fn().mockResolvedValue(ok('success'));

		const result = await runConfirmAuthGrant(stale, authorize);

		expect(result).toBe('stale');
		expect(authorize).not.toHaveBeenCalled();
		expect(shouldAuthorizeRequest(stale)).toBe(false);
	});

	it('authorizes only the current generation', async () => {
		const current = nextRequestGeneration();
		const authorize = jest.fn().mockResolvedValue(ok('success'));

		const result = await runConfirmAuthGrant(current, authorize);

		expect(authorize).toHaveBeenCalledTimes(1);
		expect(result).not.toBe('stale');
		if (result !== 'stale') {
			expect(result.isOk()).toBe(true);
		}
	});

	it('refuses authorize when generation is missing', async () => {
		const authorize = jest.fn().mockResolvedValue(ok('success'));
		const result = await runConfirmAuthGrant(undefined, authorize);
		expect(result).toBe('stale');
		expect(authorize).not.toHaveBeenCalled();
	});

	it('returns sanitized failure text, never the raw native error', async () => {
		const current = nextRequestGeneration();
		const leaky = err('https://relay.example/?secret=abc');
		const result = await runConfirmAuthGrant(current, async () => leaky);
		if (result === 'stale') {
			throw new Error('expected a result');
		}
		const sanitized = sanitizeAuthError(result.error, 'failed');
		expect(sanitized.message).toBe('errors.authorizationFailed');
		expect(sanitized.message).not.toContain('relay.example');
	});
});
