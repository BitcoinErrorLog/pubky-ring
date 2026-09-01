/**
 * Tests for pubky selection sheet settle semantics and picker ownership (H-7).
 */

import { SheetManager } from 'react-native-actions-sheet';
import { InputAction, ParsedInput } from '../../utils/inputParser';
import { setDeepLink } from '../../store/slices/pubkysSlice';
import {
	resetPickerSessionForTests,
	showPubkySelectionSheet,
} from '../inputHandlerUtils';

jest.mock('../../utils/helpers', () => ({
	sleep: jest.fn().mockResolvedValue(undefined),
	showToast: jest.fn(),
}));

jest.mock('../../utils/inputRouter', () => ({
	routeInput: jest.fn(),
	actionRequiresPubky: jest.fn(),
}));

jest.mock('../../utils/clipboard', () => ({
	copyToClipboard: jest.fn(),
}));

jest.mock('../../utils/errorHandler', () => ({
	getErrorMessage: jest.fn((err, fallback) => err?.message || err || fallback),
}));

jest.mock('../../i18n', () => ({
	default: { t: (key: string) => key },
	t: (key: string) => key,
}));

jest.mock('../../utils/store-helpers', () => ({
	getStore: jest.fn(() => ({ pubky: { deepLink: '', pubkys: {} } })),
}));

const parsed: ParsedInput = {
	action: InputAction.Auth,
	data: {
		action: InputAction.Auth,
		params: { relay: 'https://relay.example', secret: 'secret', caps: [] },
		rawUrl: 'pubkyauth:///?secret=secret',
	},
	source: 'deeplink',
	rawInput: 'pubkyauth:///?secret=secret',
};

const parsedScan: ParsedInput = {
	...parsed,
	source: 'scan',
	rawInput: 'pubkyauth:///?secret=scan',
};

type ShowOptions = {
	payload: {
		onSelect: (pubky: string) => void;
	};
	onClose: () => void;
};

const getShowOptions = (): ShowOptions => {
	const showMock = SheetManager.show as jest.Mock;
	expect(showMock).toHaveBeenCalled();
	return showMock.mock.calls[showMock.mock.calls.length - 1][1] as ShowOptions;
};

const flushShow = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};

describe('showPubkySelectionSheet', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		resetPickerSessionForTests();
		(SheetManager.hide as jest.Mock).mockResolvedValue(undefined);
		(SheetManager.hideAll as jest.Mock).mockResolvedValue(undefined);
		(SheetManager.show as jest.Mock).mockResolvedValue(undefined);
	});

	it('resolves selected when onClose fires after a real selection', async () => {
		const resultPromise = showPubkySelectionSheet(parsed);
		await flushShow();

		const options = getShowOptions();
		options.payload.onSelect('pk:selected');
		options.onClose();

		await expect(resultPromise).resolves.toEqual({ kind: 'selected', pubky: 'pk:selected' });
	});

	it('does not let a late onClose cancel a selection already in flight', async () => {
		let resolveHide: (() => void) | undefined;
		let hideCalls = 0;
		(SheetManager.hide as jest.Mock).mockImplementation(
			() => {
				hideCalls += 1;
				if (hideCalls === 1) {
					return Promise.resolve();
				}
				return new Promise<void>(resolve => {
					resolveHide = resolve;
				});
			},
		);

		const resultPromise = showPubkySelectionSheet(parsed);
		await flushShow();

		const options = getShowOptions();
		options.payload.onSelect('pk:selected');
		options.onClose();
		resolveHide?.();

		await expect(resultPromise).resolves.toEqual({ kind: 'selected', pubky: 'pk:selected' });
	});

	it('resolves dismissed on close without clearing the deeplink', async () => {
		const dispatch = jest.fn();
		const resultPromise = showPubkySelectionSheet(parsed);
		await flushShow();

		const options = getShowOptions();
		options.onClose();

		await expect(resultPromise).resolves.toEqual({ kind: 'dismissed' });
		expect(dispatch).not.toHaveBeenCalled();
		expect(dispatch).not.toHaveBeenCalledWith(setDeepLink(''));
	});

	it('hides only the picker sheet, not every open sheet', async () => {
		const resultPromise = showPubkySelectionSheet(parsed);
		await flushShow();
		getShowOptions().onClose();
		await resultPromise;

		expect(SheetManager.hide).toHaveBeenCalledWith('select-pubky');
		expect(SheetManager.hideAll).not.toHaveBeenCalled();
	});

	it('ignores a second onSelect after the sheet has settled', async () => {
		const resultPromise = showPubkySelectionSheet(parsed);
		await flushShow();

		const options = getShowOptions();
		options.payload.onSelect('pk:first');
		options.payload.onSelect('pk:second');
		options.onClose();

		await expect(resultPromise).resolves.toEqual({ kind: 'selected', pubky: 'pk:first' });
	});

	it('does not show a picker when the owner is already stale after hide', async () => {
		const result = await showPubkySelectionSheet(parsed, {
			isCurrent: (): boolean => false,
		});

		expect(result).toEqual({ kind: 'stale' });
		expect(SheetManager.show).not.toHaveBeenCalled();
	});

	it('does not show a picker when the owner goes stale during the delay', async () => {
		const isCurrent = jest.fn()
			.mockReturnValueOnce(true)
			.mockReturnValue(false);

		const result = await showPubkySelectionSheet(parsed, { isCurrent });

		expect(result).toEqual({ kind: 'stale' });
		expect(SheetManager.show).not.toHaveBeenCalled();
	});

	it('settles a scan picker as replaced when a deeplink picker takes over', async () => {
		const scanPromise = showPubkySelectionSheet(parsedScan);
		await flushShow();
		expect(SheetManager.show).toHaveBeenCalledTimes(1);

		const deeplinkPromise = showPubkySelectionSheet(parsed);
		await flushShow();

		await expect(scanPromise).resolves.toEqual({ kind: 'replaced' });
		expect(SheetManager.show).toHaveBeenCalledTimes(2);

		getShowOptions().payload.onSelect('pk:deeplink');
		await expect(deeplinkPromise).resolves.toEqual({
			kind: 'selected',
			pubky: 'pk:deeplink',
		});
	});

	it('settles a hanging first picker when a second starts without onClose', async () => {
		(SheetManager.hide as jest.Mock).mockResolvedValue(undefined);
		const first = showPubkySelectionSheet(parsedScan);
		await flushShow();

		const second = showPubkySelectionSheet(parsed);
		await expect(first).resolves.toEqual({ kind: 'replaced' });
		await flushShow();
		getShowOptions().payload.onSelect('pk:second');
		await expect(second).resolves.toEqual({ kind: 'selected', pubky: 'pk:second' });
	});
});
