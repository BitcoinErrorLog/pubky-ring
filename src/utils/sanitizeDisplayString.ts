/**
 * Display-only sanitizer for attacker-controlled QR strings (deviceId, caps).
 * Strips Unicode Cc/Cf (controls, bidi, ZWSP, format) then optionally caps.
 */

const CONTROL_AND_FORMAT = /\p{Cc}|\p{Cf}/gu;

export const DEVICE_ID_DISPLAY_MAX = 64;

export const sanitizeDisplayString = (
	value: string,
	maxLength?: number,
): string => {
	const stripped = value.replace(CONTROL_AND_FORMAT, '');
	if (maxLength === undefined || stripped.length <= maxLength) {
		return stripped;
	}
	return `${stripped.slice(0, maxLength)}…`;
};
