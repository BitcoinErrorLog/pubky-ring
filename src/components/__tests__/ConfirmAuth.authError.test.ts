/**
 * ConfirmAuth must not copy or display raw native auth errors (Kimi H4).
 */

import fs from 'fs';
import path from 'path';
import { sanitizeAuthError } from '../../utils/authError';

jest.mock('../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

describe('ConfirmAuth auth error contract', () => {
	const source = fs.readFileSync(
		path.join(__dirname, '../ConfirmAuth.tsx'),
		'utf8',
	);

	it('sanitizes failures and does not copy raw error text', () => {
		expect(source).toMatch(/sanitizeAuthError/);
		expect(source).toMatch(/runConfirmAuthGrant/);
		expect(source).not.toMatch(/copyToClipboard\(errorMsg\)/);
		expect(source).not.toMatch(/Alert\.alert/);
		expect(source).not.toMatch(/res\.error\.message/);
	});

	it('user-visible auth failures never include relay URLs or secrets', () => {
		const { message } = sanitizeAuthError(
			new Error('https://relay.example/?secret=abc'),
			'failed',
		);
		expect(message).toBe('errors.authorizationFailed');
		expect(message).not.toContain('https://');
		expect(message).not.toContain('secret=abc');
	});
});
