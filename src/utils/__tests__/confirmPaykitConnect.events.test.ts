/**
 * Event-faithful SheetManager integration for confirmPaykitConnect.
 *
 * jest.setup.js mocks hide() without publishing onclose_<id>, so the
 * global mock cannot see the Approve/onClose race. This file replaces
 * that mock with library semantics: show registers onclose_<id> and
 * calls options.onClose; hide registers a second handler then publishes
 * onclose_<id> (Map insertion order → show handler first).
 */

type SheetHandler = (...args: unknown[]) => void;

type ShowOptions = {
	payload: {
		onDecision: (approved: boolean) => void;
	};
	onClose: () => void;
};

type FaithfulSheetManager = {
	show: (id: string, options?: ShowOptions) => Promise<unknown>;
	hide: (id: string) => Promise<unknown>;
	hideAll: jest.Mock;
	getActiveSheets: (id: string) => Array<{ id: string; context: string }>;
	lastOptions: ShowOptions | null;
	dismiss: (id: string) => void;
	reset: () => void;
};

jest.mock('react-native-actions-sheet', () => {
	class EventManager {
		private _registry = new Map<SheetHandler, { name: string }>();

		subscribe(name: string, handler: SheetHandler): { unsubscribe: () => boolean } {
			this._registry.set(handler, { name });
			return { unsubscribe: (): boolean => this._registry.delete(handler) };
		}

		publish(name: string, ...args: unknown[]): void {
			this._registry.forEach((props, handler) => {
				if (props.name === name) {
					handler(...args);
				}
			});
		}
	}

	const actionSheetEventManager = new EventManager();
	const renderedSheetIds: string[] = [];
	const SheetManager: FaithfulSheetManager = {
		lastOptions: null,
		hideAll: jest.fn(),
		reset(): void {
			renderedSheetIds.length = 0;
			this.lastOptions = null;
		},
		getActiveSheets(id: string): Array<{ id: string; context: string }> {
			return renderedSheetIds
				.filter((key) => key.startsWith(`${id}:`))
				.map((key) => {
					const [sheetId, context] = key.split(':');
					return { id: sheetId, context };
				});
		},
		show(id: string, options?: ShowOptions): Promise<unknown> {
			this.lastOptions = options ?? null;
			return new Promise((resolve) => {
				const handler = (data?: unknown, context = 'global'): void => {
					if (context !== 'global') {
						return;
					}
					options?.onClose?.();
					sub.unsubscribe();
					resolve(data);
				};
				const sub = actionSheetEventManager.subscribe(`onclose_${id}`, handler);
				const key = `${id}:global`;
				if (!renderedSheetIds.includes(key)) {
					renderedSheetIds.push(key);
				}
			});
		},
		hide(id: string): Promise<unknown> {
			return new Promise((resolve) => {
				const hideHandler = (data?: unknown, context = 'global'): void => {
					if (context !== 'global') {
						return;
					}
					sub.unsubscribe();
					resolve(data);
				};
				const sub = actionSheetEventManager.subscribe(`onclose_${id}`, hideHandler);
				const key = `${id}:global`;
				const idx = renderedSheetIds.indexOf(key);
				if (idx > -1) {
					renderedSheetIds.splice(idx, 1);
				}
				actionSheetEventManager.publish(`onclose_${id}`, undefined, 'global');
			});
		},
		dismiss(id: string): void {
			const key = `${id}:global`;
			const idx = renderedSheetIds.indexOf(key);
			if (idx > -1) {
				renderedSheetIds.splice(idx, 1);
			}
			actionSheetEventManager.publish(`onclose_${id}`, undefined, 'global');
		},
	};

	return {
		SheetManager,
		registerSheet: jest.fn(),
		default: jest.fn(() => null),
	};
});

jest.mock('../e2eAutoApprove', () => ({
	isE2EAutoApproveEnabled: jest.fn(),
}));

jest.mock('../constants', () => ({
	...jest.requireActual('../constants'),
	AUTH_SHEET_DELAY: 0,
}));

jest.mock('../helpers', () => ({
	sleep: jest.fn(() => Promise.resolve()),
	showToast: jest.fn(),
	getToastStyle: jest.fn(() => ({})),
	isSmallScreen: jest.fn(() => false),
}));

import { SheetManager } from 'react-native-actions-sheet';
import { requestPaykitConnectConfirmation } from '../confirmPaykitConnect';
import { isE2EAutoApproveEnabled } from '../e2eAutoApprove';
import {
	nextRequestGeneration,
	resetRequestGenerationForTests,
} from '../authRequestGeneration';

const faithful = SheetManager as unknown as FaithfulSheetManager;

const sheetPayload = {
	pubky: 'pk:test',
	destination: 'hypercolor.app — web browser via Pubky HTTP relay',
	deviceId: 'device-1',
	capabilities: [{ path: '/pub/paykit/', permission: 'rw' }],
	verificationCode: '8eO-wP5',
};

const flushShow = async (): Promise<ShowOptions> => {
	for (let i = 0; i < 8; i += 1) {
		await Promise.resolve();
		if (faithful.lastOptions) {
			return faithful.lastOptions;
		}
	}
	throw new Error('SheetManager.show never captured options');
};

describe('requestPaykitConnectConfirmation event-faithful SheetManager', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		resetRequestGenerationForTests();
		faithful.reset();
		(isE2EAutoApproveEnabled as jest.Mock).mockReturnValue(false);
	});

	it('resolves approved when onDecision(true) races hide→onclose', async () => {
		const decision = requestPaykitConnectConfirmation(sheetPayload);
		const options = await flushShow();
		options.payload.onDecision(true);
		await expect(decision).resolves.toBe('approved');
	});

	it('resolves denied when onDecision(false) races hide→onclose', async () => {
		const decision = requestPaykitConnectConfirmation(sheetPayload);
		const options = await flushShow();
		options.payload.onDecision(false);
		await expect(decision).resolves.toBe('denied');
	});

	it('resolves denied on swipe-dismiss (onclose without a decision)', async () => {
		const decision = requestPaykitConnectConfirmation(sheetPayload);
		await flushShow();
		faithful.dismiss('confirm-paykit-connect');
		await expect(decision).resolves.toBe('denied');
	});

	it('resolves superseded when a newer request owns the generation', async () => {
		const decision = requestPaykitConnectConfirmation(sheetPayload);
		await flushShow();
		nextRequestGeneration();
		faithful.dismiss('confirm-paykit-connect');
		await expect(decision).resolves.toBe('superseded');
	});

	it('does not resolve approved for a superseded waiter that taps Approve', async () => {
		const decision = requestPaykitConnectConfirmation(sheetPayload);
		const options = await flushShow();
		nextRequestGeneration();
		options.payload.onDecision(true);
		await expect(decision).resolves.toBe('superseded');
	});
});
