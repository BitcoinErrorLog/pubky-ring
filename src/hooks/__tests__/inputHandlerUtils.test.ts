/**
 * Tests for pubky selection sheet settle semantics.
 *
 * Reproduced bug: hiding the picker fires onClose, which resolved null and
 * cleared the deeplink while a delayed routeInput was still pending, tearing
 * down ConfirmAuth. Selection must win over the close handler.
 */

import { SheetManager } from 'react-native-actions-sheet';
import { InputAction, ParsedInput } from '../../utils/inputParser';
import { setDeepLink } from '../../store/slices/pubkysSlice';
import { showPubkySelectionSheet } from '../inputHandlerUtils';

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

describe('showPubkySelectionSheet', () => {
	const dispatch = jest.fn();

	beforeEach(() => {
		jest.clearAllMocks();
		(SheetManager.hide as jest.Mock).mockResolvedValue(undefined);
		(SheetManager.hideAll as jest.Mock).mockResolvedValue(undefined);
		(SheetManager.show as jest.Mock).mockResolvedValue(undefined);
	});

	it('resolves the selected pubky when onClose fires after a real selection', async () => {
		const resultPromise = showPubkySelectionSheet(parsed, 'deeplink', dispatch);
		await Promise.resolve();
		await Promise.resolve();

		const options = getShowOptions();
		options.payload.onSelect('pk:selected');
		options.onClose();

		await expect(resultPromise).resolves.toBe('pk:selected');
		expect(dispatch).not.toHaveBeenCalledWith(setDeepLink(''));
	});

	it('does not let a late onClose cancel a selection already in flight', async () => {
		let resolveHide: (() => void) | undefined;
		(SheetManager.hide as jest.Mock).mockImplementation(
			() =>
				new Promise<void>(resolve => {
					resolveHide = resolve;
				}),
		);

		const resultPromise = showPubkySelectionSheet(parsed, 'deeplink', dispatch);
		await Promise.resolve();
		await Promise.resolve();

		const options = getShowOptions();
		options.payload.onSelect('pk:selected');
		options.onClose();
		resolveHide?.();

		await expect(resultPromise).resolves.toBe('pk:selected');
		expect(dispatch).not.toHaveBeenCalledWith(setDeepLink(''));
	});

	it('resolves null and clears the deeplink on dismiss without a selection', async () => {
		const resultPromise = showPubkySelectionSheet(parsed, 'deeplink', dispatch);
		await Promise.resolve();
		await Promise.resolve();

		const options = getShowOptions();
		options.onClose();

		await expect(resultPromise).resolves.toBeNull();
		expect(dispatch).toHaveBeenCalledWith(setDeepLink(''));
	});

	it('does not clear deeplink when a scan/clipboard picker is dismissed', async () => {
		const resultPromise = showPubkySelectionSheet(parsed, 'scan', dispatch);
		await Promise.resolve();
		await Promise.resolve();

		const options = getShowOptions();
		options.onClose();

		await expect(resultPromise).resolves.toBeNull();
		expect(dispatch).not.toHaveBeenCalled();
	});

	it('ignores a second onSelect after the sheet has settled', async () => {
		const resultPromise = showPubkySelectionSheet(parsed, 'deeplink', dispatch);
		await Promise.resolve();
		await Promise.resolve();

		const options = getShowOptions();
		options.payload.onSelect('pk:first');
		options.payload.onSelect('pk:second');
		options.onClose();

		await expect(resultPromise).resolves.toBe('pk:first');
	});

	it('starts a fresh picker for a repeated deeplink by hiding existing sheets', async () => {
		const first = showPubkySelectionSheet(parsed, 'deeplink', dispatch);
		await Promise.resolve();
		await Promise.resolve();
		getShowOptions().onClose();
		await first;

		jest.clearAllMocks();
		(SheetManager.hide as jest.Mock).mockResolvedValue(undefined);
		(SheetManager.hideAll as jest.Mock).mockResolvedValue(undefined);
		(SheetManager.show as jest.Mock).mockResolvedValue(undefined);

		const secondParsed: ParsedInput = {
			action: InputAction.Auth,
			data: {
				action: InputAction.Auth,
				params: {
					relay: 'https://relay.example',
					secret: 'retry-secret',
					caps: [],
				},
				rawUrl: 'pubkyauth:///?secret=retry-secret',
			},
			source: 'deeplink',
			rawInput: 'pubkyauth:///?secret=retry-secret',
		};
		const second = showPubkySelectionSheet(secondParsed, 'deeplink', dispatch);
		await Promise.resolve();
		await Promise.resolve();

		expect(SheetManager.hideAll).toHaveBeenCalled();
		const options = getShowOptions();
		options.payload.onSelect('pk:retry');
		await expect(second).resolves.toBe('pk:retry');
	});
});
