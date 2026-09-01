/**
 * SelectPubky must only notify the parent of a tap. Independent delayed
 * routing is what raced with the sheet onClose handler.
 */

import fs from 'fs';
import path from 'path';

describe('SelectPubky selection contract', () => {
	const source = fs.readFileSync(
		path.join(__dirname, '../SelectPubky.tsx'),
		'utf8',
	);

	it('does not independently parse or route after a pubky tap', () => {
		expect(source).not.toMatch(/routeInput/);
		expect(source).not.toMatch(/parseInput/);
		expect(source).not.toMatch(/setTimeout/);
	});

	it('forwards the tap to payload.onSelect', () => {
		expect(source).toMatch(/onSelect\?\.\(pubky\)/);
	});

	it('does not clear the deeplink itself', () => {
		expect(source).not.toMatch(/setDeepLink/);
	});
});
