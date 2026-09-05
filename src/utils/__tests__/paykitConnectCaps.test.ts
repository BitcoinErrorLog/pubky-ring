import {
	formatPaykitConnectDestination,
	parsePaykitConnectCaps,
} from '../paykitConnectCaps';

describe('parsePaykitConnectCaps', () => {
	it('splits Hypercolor path:rw caps the way ConfirmAuth renders them', () => {
		expect(parsePaykitConnectCaps([
			'/pub/paykit/:rw',
			'/pub/hypercolor.app/v1/:rw',
		])).toEqual([
			{ path: '/pub/paykit/', permission: 'rw' },
			{ path: '/pub/hypercolor.app/v1/', permission: 'rw' },
		]);
	});

	it('returns an empty list when caps are missing', () => {
		expect(parsePaykitConnectCaps(undefined)).toEqual([]);
		expect(parsePaykitConnectCaps([])).toEqual([]);
	});
});

describe('formatPaykitConnectDestination', () => {
	const labels = {
		webBrowser: 'web browser via Pubky HTTP relay',
		appOnDevice: 'app on this device',
	};

	it('shows the https host as a browser destination via the HTTP relay', () => {
		expect(formatPaykitConnectDestination(
			'https://hypercolor.app/ring-callback?ch=abc',
			true,
			labels,
		)).toBe('hypercolor.app — web browser via Pubky HTTP relay');
	});

	it('shows the custom scheme as an on-device app', () => {
		expect(formatPaykitConnectDestination(
			'hypercolor://paykit-setup',
			false,
			labels,
		)).toBe('hypercolor:// app on this device');
		expect(formatPaykitConnectDestination(
			'bitkit://paykit-setup',
			false,
			labels,
		)).toBe('bitkit:// app on this device');
	});
});
