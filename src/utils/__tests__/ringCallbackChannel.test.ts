/**
 * Channel-id derivation must stay byte-identical to Hypercolor web.
 */

import {
	deriveRingCallbackChannelId,
	formatRingVerificationCode,
} from '../ringCallbackChannel';

const HYPERCOLOR_EPHEMERAL_PK =
	'c9aaad5b10794814e6ca4a5a18ea2aebb0467c83fd45515ab1634910e6a0b172';
const HYPERCOLOR_CH = '8eOwP5zDIW4PwXitMsHu3RdUDCF60o3DTwI-firPVT8';

describe('ringCallbackChannel', () => {
	it('derives the live Hypercolor QR channel from hex-decoded ephemeralPk', () => {
		expect(deriveRingCallbackChannelId(HYPERCOLOR_EPHEMERAL_PK)).toBe(HYPERCOLOR_CH);
	});

	it('does not hash UTF-8 of the hex string', () => {
		expect(deriveRingCallbackChannelId(HYPERCOLOR_EPHEMERAL_PK)).not.toBe(
			'kNosy5ONalvvynlBqJarQJSoIbbG6sNiT0LJSL6_R3A',
		);
	});

	it('groups the first 6 channel chars as XXX-XXX', () => {
		expect(formatRingVerificationCode(HYPERCOLOR_CH)).toBe('8eO-wP5');
	});

	it('is deterministic for a given ephemeralPk', () => {
		const first = deriveRingCallbackChannelId('aa'.repeat(32));
		expect(deriveRingCallbackChannelId('aa'.repeat(32))).toBe(first);
		expect(deriveRingCallbackChannelId('bb'.repeat(32))).not.toBe(first);
	});
});
