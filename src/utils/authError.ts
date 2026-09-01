/**
 * Sanitized auth error messages and allowlisted log codes.
 *
 * Native auth failures and parse errors can include relay URLs and secrets.
 * User-visible text and logs must never include those strings.
 */

import i18n from '../i18n';

export type AuthErrorCode =
	| 'timeout'
	| 'failed'
	| 'parse'
	| 'process'
	| 'signIn'
	| 'secretKey'
	| 'noPubky'
	| 'intake'
	| 'unknown'
	| 'input';

export type AuthErrorI18nKey =
	| 'auth.timeoutError'
	| 'errors.authorizationFailed'
	| 'errors.failedToParseAuth'
	| 'errors.failedToProcessAuth'
	| 'errors.signInFailed'
	| 'pubkyErrors.failedToGetSecretKey'
	| 'pubky.noSelection'
	| 'errors.failedToProcessInput'
	| 'errors.unrecognizedFormat';

export const AUTH_ERROR_LOG_PREFIX = 'auth_error:';

const CODE_TO_I18N = {
	timeout: 'auth.timeoutError',
	failed: 'errors.authorizationFailed',
	parse: 'errors.failedToParseAuth',
	process: 'errors.failedToProcessAuth',
	signIn: 'errors.signInFailed',
	secretKey: 'pubkyErrors.failedToGetSecretKey',
	noPubky: 'pubky.noSelection',
	intake: 'errors.failedToProcessInput',
	unknown: 'errors.unrecognizedFormat',
	input: 'errors.failedToProcessInput',
} as const satisfies Record<AuthErrorCode, AuthErrorI18nKey>;

const TIMEOUT_PATTERN = /timed?\s*out|timeout/i;

const extractRawText = (error: unknown): string => {
	if (typeof error === 'string') {
		return error;
	}
	if (error instanceof Error) {
		return error.message;
	}
	if (error && typeof error === 'object' && 'message' in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === 'string') {
			return message;
		}
	}
	return '';
};

export const classifyAuthError = (
	error: unknown,
	fallback: AuthErrorCode = 'failed',
): AuthErrorCode => {
	const raw = extractRawText(error);
	if (TIMEOUT_PATTERN.test(raw)) {
		return 'timeout';
	}
	return fallback;
};

export const sanitizeAuthError = (
	error: unknown,
	fallback: AuthErrorCode = 'failed',
): { code: AuthErrorCode; message: string } => {
	const code = classifyAuthError(error, fallback);
	return {
		code,
		message: i18n.t(CODE_TO_I18N[code]),
	};
};

export const logAuthError = (code: AuthErrorCode): void => {
	console.error(`${AUTH_ERROR_LOG_PREFIX}${code}`);
};
