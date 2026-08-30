import { isE2EAutoApproveEnabled } from '../e2eAutoApprove';

describe('e2eAutoApprove', () => {
	it('is enabled under Jest (__DEV__)', () => {
		expect(isE2EAutoApproveEnabled()).toBe(true);
	});
});
