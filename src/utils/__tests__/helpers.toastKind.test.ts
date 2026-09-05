import Toast from 'react-native-toast-message';
import {
	hideToastIfKind,
	PAYKIT_CONNECT_RELAY_FAILURE_TOAST,
	showToast,
} from '../helpers';

describe('hideToastIfKind', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('hides only the paykit-connect relay-failure toast', () => {
		showToast({
			type: 'info',
			title: 'offline',
			description: 'offline',
			kind: 'network-offline',
		});
		hideToastIfKind(PAYKIT_CONNECT_RELAY_FAILURE_TOAST);
		expect(Toast.hide).not.toHaveBeenCalled();

		showToast({
			type: 'error',
			title: 'error',
			description: 'session.webHandoffRelayFailed',
			kind: PAYKIT_CONNECT_RELAY_FAILURE_TOAST,
		});
		hideToastIfKind(PAYKIT_CONNECT_RELAY_FAILURE_TOAST);
		expect(Toast.hide).toHaveBeenCalledTimes(1);

		showToast({
			type: 'info',
			title: 'online',
			description: 'online',
			kind: 'network-online',
		});
		hideToastIfKind(PAYKIT_CONNECT_RELAY_FAILURE_TOAST);
		expect(Toast.hide).toHaveBeenCalledTimes(1);
	});
});
