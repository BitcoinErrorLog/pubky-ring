/**
 * ConfirmAuth deny/error must not background Ring. Return happens only after
 * a successful performAuth when returnToCaller was already decided by policy.
 */

import fs from 'fs';
import path from 'path';

describe('ConfirmAuth return contract', () => {
	const source = fs.readFileSync(
		path.join(__dirname, '../ConfirmAuth.tsx'),
		'utf8',
	);

	it('does not background Ring from the deny/close handler', () => {
		const start = source.indexOf('const handleClose');
		const end = source.indexOf('const handleAuth');
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		const handleClose = source.slice(start, end);
		expect(handleClose).not.toMatch(/moveTaskToBackground/);
		expect(handleClose).not.toMatch(/returnToPreviousApp/);
	});

	it('backgrounds Ring only after a successful grant when returnToCaller is set', () => {
		expect(source).toMatch(/if \(res\.isErr\(\)\)/);
		expect(source).toMatch(/if \(returnToCaller\)/);
		expect(source).toMatch(/moveTaskToBackground\(\)/);
		const successBlockStart = source.indexOf('setIsAuthorized(true)');
		const successBlock = source.slice(
			successBlockStart,
			source.indexOf('} catch'),
		);
		expect(successBlock).toMatch(/moveTaskToBackground/);
	});
});
