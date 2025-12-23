/**
 * Unified Input Parser
 *
 * This module provides a single entry point for parsing all input types:
 * - Deeplinks (pubkyring://, pubkyauth://)
 * - QR codes (scanned data)
 * - Clipboard content (pasted data)
 *
 * All input sources converge here to produce a standardized ParsedInput object
 * that can be routed to the appropriate action handler.
 */

import { parseAuthUrl } from '@synonymdev/react-native-pubky';
import { mnemonicPhraseToKeypair, getPublicKeyFromSecretKey } from '@synonymdev/react-native-pubky';
import { EBackupPreference } from '../types/pubky';

// Input source types
export type InputSource = 'deeplink' | 'scan' | 'clipboard';

// Action types that can be performed
export enum InputAction {
	Auth = 'auth',
	Import = 'import',
	Signup = 'signup',
	Invite = 'invite',
	Session = 'session',
	HomeserverSignIn = 'homeserver_signin',
	DeriveKeypair = 'derive_keypair',
	GetProfile = 'get_profile',
	GetFollows = 'get_follows',
	PaykitConnect = 'paykit_connect', // Combined session + noise keys for Paykit
	Unknown = 'unknown',
}

// Signup parameters extracted from signup deeplinks
export interface SignupParams {
	homeserver: string;
	inviteCode: string;
	relay: string;
	secret: string;
	caps: string[];
}

// Auth parameters extracted from auth URLs
export interface AuthParams {
	relay: string;
	secret: string;
	caps: string[];
}

// Import parameters for recovery phrases and secret keys
export interface ImportParams {
	data: string;
	backupPreference: EBackupPreference;
}

// Invite parameters
export interface InviteParams {
	inviteCode: string;
}

// Session parameters for external app session requests
export interface SessionParams {
	callback: string;
}

// Keypair derivation parameters for Paykit/Bitkit noise keys
export interface DeriveKeypairParams {
	deviceId: string;
	epoch: number;
	callback: string;
}

// Profile request parameters
export interface GetProfileParams {
	pubkey: string;
	callback: string;
	app?: string; // App namespace, defaults to 'pubky.app'
}

// Follows request parameters
export interface GetFollowsParams {
	callback: string;
	app?: string; // App namespace, defaults to 'pubky.app'
}

// Paykit connect parameters - combined session + noise keys
export interface PaykitConnectParams {
	deviceId: string;
	callback: string;
	includeEpoch1?: boolean; // Include epoch 1 keypair for rotation, defaults to true
	ephemeralPk?: string; // Optional: Bitkit's ephemeral X25519 public key for secure handoff
}

// Union type for all action data
export type ActionData =
	| { action: InputAction.Auth; params: AuthParams; rawUrl: string }
	| { action: InputAction.Import; params: ImportParams }
	| { action: InputAction.Signup; params: SignupParams }
	| { action: InputAction.Invite; params: InviteParams }
	| { action: InputAction.Session; params: SessionParams }
	| { action: InputAction.HomeserverSignIn; params: { url: string } }
	| { action: InputAction.DeriveKeypair; params: DeriveKeypairParams }
	| { action: InputAction.GetProfile; params: GetProfileParams }
	| { action: InputAction.GetFollows; params: GetFollowsParams }
	| { action: InputAction.PaykitConnect; params: PaykitConnectParams }
	| { action: InputAction.Unknown; params: { rawData: string } };

// The standardized parsed input type
export interface ParsedInput {
	action: InputAction;
	data: ActionData;
	source: InputSource;
	rawInput: string;
}

/**
 * Formats raw import data by normalizing it for validation
 */
export const formatImportData = (data: string): string => {
	if (!data) return '';

	let formatted = data.trim();

	// Decode URL encoding if present
	if (formatted.includes('://') || formatted.includes('%20')) {
		try {
			formatted = decodeURIComponent(formatted);
		} catch {
			// Continue with original if decoding fails
		}
	}

	// Remove custom protocol prefixes
	formatted = formatted.replace(/^pubkyring:\/\//, '');
	formatted = formatted.replace(/^pubkyauth:\/\//, '');

	// Normalize word separators to spaces (for recovery phrases)
	formatted = formatted.replace(/[-_+]+/g, ' ');

	return formatted;
};

/**
 * Validates and determines the backup preference for import data
 */
const validateImportData = async (
	data: string
): Promise<{ isValid: boolean; backupPreference: EBackupPreference }> => {
	const formatted = formatImportData(data);

	// Check if it's a valid mnemonic phrase
	const mnemonicRes = await mnemonicPhraseToKeypair(formatted);
	if (mnemonicRes.isOk()) {
		return { isValid: true, backupPreference: EBackupPreference.recoveryPhrase };
	}

	// Check if it's a valid encrypted secret key
	const secretKeyRes = await getPublicKeyFromSecretKey(formatted);
	if (secretKeyRes.isOk()) {
		return { isValid: true, backupPreference: EBackupPreference.encryptedFile };
	}

	return { isValid: false, backupPreference: EBackupPreference.unknown };
};

/**
 * Parses invite code from a URL
 * Pattern: /invite/XXXX-XXXX-XXXX
 */
const parseInviteCodeFromUrl = (url: string): string | null => {
	const invitePattern = /\/invite\/([A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4})/;
	const match = url.match(invitePattern);
	return match ? match[1] : null;
};

/**
 * Checks if a string is a valid invite code format
 */
const isValidInviteCode = (code: string): boolean => {
	return /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/i.test(code);
};

/**
 * Parses signup deeplink parameters
 * Format: signup?hs={homeserver}&st={signup_token}&relay={relay_url}&secret={secret}&caps={capabilities}
 */
const parseSignupParams = (queryString: string): SignupParams | null => {
	try {
		const params = new URLSearchParams(queryString);
		return {
			homeserver: decodeURIComponent(params.get('hs') || ''),
			inviteCode: params.get('st') || '',
			relay: decodeURIComponent(params.get('relay') || ''),
			secret: params.get('secret') || '',
			caps: (params.get('caps') || '').split(',').filter(Boolean),
		};
	} catch {
		return null;
	}
};

/**
 * Parses session deeplink parameters
 * Format: session?callback={callback_url}
 * Example: pubkyring://session?callback=bitkit://session-data
 */
const parseSessionParams = (queryString: string): SessionParams | null => {
	try {
		const params = new URLSearchParams(queryString);
		const callback = params.get('callback');
		if (!callback) {
			return null;
		}
		return {
			callback: decodeURIComponent(callback),
		};
	} catch {
		return null;
	}
};

/**
 * Parses derive-keypair deeplink parameters
 * Format: derive-keypair?deviceId={device_id}&epoch={epoch}&callback={callback_url}
 * Example: pubkyring://derive-keypair?deviceId=abc123&epoch=0&callback=bitkit://paykit-keypair
 */
const parseDeriveKeypairParams = (queryString: string): DeriveKeypairParams | null => {
	try {
		const params = new URLSearchParams(queryString);
		const deviceId = params.get('deviceId');
		const epochStr = params.get('epoch');
		const callback = params.get('callback');
		if (!deviceId || !epochStr || !callback) {
			return null;
		}
		const epoch = parseInt(epochStr, 10);
		if (isNaN(epoch)) {
			return null;
		}
		return {
			deviceId,
			epoch,
			callback: decodeURIComponent(callback),
		};
	} catch {
		return null;
	}
};

/**
 * Parses get-profile deeplink parameters
 * Format: get-profile?pubkey={pubkey}&callback={callback_url}&app={app}
 * Example: pubkyring://get-profile?pubkey=abc123&callback=bitkit://paykit-profile
 */
const parseGetProfileParams = (queryString: string): GetProfileParams | null => {
	try {
		const params = new URLSearchParams(queryString);
		const pubkey = params.get('pubkey');
		const callback = params.get('callback');
		if (!pubkey || !callback) {
			return null;
		}
		return {
			pubkey,
			callback: decodeURIComponent(callback),
			app: params.get('app') || undefined,
		};
	} catch {
		return null;
	}
};

/**
 * Parses get-follows deeplink parameters
 * Format: get-follows?callback={callback_url}&app={app}
 * Example: pubkyring://get-follows?callback=bitkit://paykit-follows
 */
const parseGetFollowsParams = (queryString: string): GetFollowsParams | null => {
	try {
		const params = new URLSearchParams(queryString);
		const callback = params.get('callback');
		if (!callback) {
			return null;
		}
		return {
			callback: decodeURIComponent(callback),
			app: params.get('app') || undefined,
		};
	} catch {
		return null;
	}
};

/**
 * Parses paykit-connect deeplink parameters
 * Format: paykit-connect?deviceId={device_id}&callback={callback_url}&includeEpoch1={bool}&ephemeralPk={pk}
 * Example: pubkyring://paykit-connect?deviceId=abc123&callback=bitkit://paykit-setup&ephemeralPk=aabbcc...
 *
 * If ephemeralPk is provided, uses secure handoff (stores payload on homeserver).
 * Otherwise, returns session + noise keys directly in callback (legacy mode).
 */
const parsePaykitConnectParams = (queryString: string): PaykitConnectParams | null => {
	try {
		const params = new URLSearchParams(queryString);
		const deviceId = params.get('deviceId');
		const callback = params.get('callback');
		if (!deviceId || !callback) {
			return null;
		}
		const includeEpoch1Str = params.get('includeEpoch1');
		const includeEpoch1 = includeEpoch1Str === 'false' ? false : true; // Default to true
		const ephemeralPk = params.get('ephemeralPk') || undefined;
		return {
			deviceId,
			callback: decodeURIComponent(callback),
			includeEpoch1,
			ephemeralPk,
		};
	} catch {
		return null;
	}
};

/**
 * Main parsing function - the single entry point for all input parsing
 *
 * @param rawInput - The raw input string from any source
 * @param source - Where the input came from (deeplink, scan, clipboard)
 * @returns ParsedInput object with action type, data, and metadata
 */
export const parseInput = async (
	rawInput: string,
	source: InputSource
): Promise<ParsedInput> => {
	if (!rawInput || typeof rawInput !== 'string') {
		return {
			action: InputAction.Unknown,
			data: { action: InputAction.Unknown, params: { rawData: rawInput || '' } },
			source,
			rawInput: rawInput || '',
		};
	}

	let processedInput = rawInput.trim();

	// Try to decode URL encoding - may need multiple passes for double-encoded URLs
	let decoded = processedInput;
	for (let i = 0; i < 3; i++) {
		try {
			const newDecoded = decodeURIComponent(decoded);
			if (newDecoded === decoded) break; // No more encoding to decode
			decoded = newDecoded;
		} catch {
			break; // Stop if decoding fails
		}
	}
	processedInput = decoded;

	// Remove pubkyring:// wrapper protocol if present
	// This handles cases like pubkyring://pubkyauth:///?...
	if (processedInput.startsWith('pubkyring://')) {
		processedInput = processedInput.replace('pubkyring://', '');
	}

	// Fix malformed pubkyauth URL (pubkyauth/// -> pubkyauth:///)
	// Some sources may omit the colon
	if (processedInput.startsWith('pubkyauth///')) {
		processedInput = processedInput.replace('pubkyauth///', 'pubkyauth:///');
	}

	// Remove protocol prefixes for further analysis
	let urlWithoutProtocol = processedInput;
	if (urlWithoutProtocol.startsWith('pubkyauth://')) {
		urlWithoutProtocol = urlWithoutProtocol.replace('pubkyauth://', '');
	}

	// 1. Check for signup deeplink
	// Format: pubkyring://signup?... or pubkyauth://signup?...
	if (urlWithoutProtocol.startsWith('signup?')) {
		const queryString = urlWithoutProtocol.substring(7); // Remove "signup?"
		const signupParams = parseSignupParams(queryString);
		if (signupParams?.homeserver && signupParams?.inviteCode) {
			return {
				action: InputAction.Signup,
				data: { action: InputAction.Signup, params: signupParams },
				source,
				rawInput,
			};
		}
	}

	// 2. Check for session deeplink
	// Format: pubkyring://session?callback={callback_url}
	if (urlWithoutProtocol.startsWith('session?')) {
		const queryString = urlWithoutProtocol.substring(8); // Remove "session?"
		const sessionParams = parseSessionParams(queryString);
		if (sessionParams?.callback) {
			return {
				action: InputAction.Session,
				data: { action: InputAction.Session, params: sessionParams },
				source,
				rawInput,
			};
		}
	}

	// 2a. Check for derive-keypair deeplink (Paykit noise key derivation)
	// Format: pubkyring://derive-keypair?deviceId={id}&epoch={epoch}&callback={url}
	if (urlWithoutProtocol.startsWith('derive-keypair?')) {
		const queryString = urlWithoutProtocol.substring(15); // Remove "derive-keypair?"
		const keypairParams = parseDeriveKeypairParams(queryString);
		if (keypairParams) {
			return {
				action: InputAction.DeriveKeypair,
				data: { action: InputAction.DeriveKeypair, params: keypairParams },
				source,
				rawInput,
			};
		}
	}

	// 2b. Check for get-profile deeplink
	// Format: pubkyring://get-profile?pubkey={pubkey}&callback={url}
	if (urlWithoutProtocol.startsWith('get-profile?')) {
		const queryString = urlWithoutProtocol.substring(12); // Remove "get-profile?"
		const profileParams = parseGetProfileParams(queryString);
		if (profileParams) {
			return {
				action: InputAction.GetProfile,
				data: { action: InputAction.GetProfile, params: profileParams },
				source,
				rawInput,
			};
		}
	}

	// 2c. Check for get-follows deeplink
	// Format: pubkyring://get-follows?callback={url}
	if (urlWithoutProtocol.startsWith('get-follows?')) {
		const queryString = urlWithoutProtocol.substring(12); // Remove "get-follows?"
		const followsParams = parseGetFollowsParams(queryString);
		if (followsParams) {
			return {
				action: InputAction.GetFollows,
				data: { action: InputAction.GetFollows, params: followsParams },
				source,
				rawInput,
			};
		}
	}

	// 2d. Check for paykit-connect deeplink (combined session + noise keys)
	// Format: pubkyring://paykit-connect?deviceId={id}&callback={url}
	if (urlWithoutProtocol.startsWith('paykit-connect?')) {
		const queryString = urlWithoutProtocol.substring(15); // Remove "paykit-connect?"
		const paykitParams = parsePaykitConnectParams(queryString);
		if (paykitParams) {
			return {
				action: InputAction.PaykitConnect,
				data: { action: InputAction.PaykitConnect, params: paykitParams },
				source,
				rawInput,
			};
		}
	}

	// 3. Check for signin deeplink (alternative auth format)
	// Format: pubkyring://signin?caps=...&secret=...&relay=...
	// Convert to pubkyauth:/// format for parsing
	if (urlWithoutProtocol.startsWith('signin?')) {
		const queryString = urlWithoutProtocol.substring(7); // Remove "signin?"
		processedInput = `pubkyauth:///?${queryString}`;
	}

	// 4. Check for auth URL
	// Format: pubkyauth:///...
	const authResult = await parseAuthUrl(processedInput);
	if (authResult.isOk()) {
		return {
			action: InputAction.Auth,
			data: {
				action: InputAction.Auth,
				params: {
					relay: authResult.value.relay,
					secret: authResult.value.secret,
					caps: authResult.value.capabilities.map(c => `${c.path}:${c.permission}`),
				},
				rawUrl: processedInput,
			},
			source,
			rawInput,
		};
	}

	// 5. Check for invite code in URL
	const inviteCode = parseInviteCodeFromUrl(processedInput);
	if (inviteCode) {
		return {
			action: InputAction.Invite,
			data: { action: InputAction.Invite, params: { inviteCode } },
			source,
			rawInput,
		};
	}

	// 6. Check if it's a standalone invite code (XXXX-XXXX-XXXX format)
	if (isValidInviteCode(urlWithoutProtocol)) {
		return {
			action: InputAction.Invite,
			data: { action: InputAction.Invite, params: { inviteCode: urlWithoutProtocol } },
			source,
			rawInput,
		};
	}

	// 7. Check for import data (recovery phrase or secret key)
	const formatted = formatImportData(processedInput);
	const importValidation = await validateImportData(formatted);
	if (importValidation.isValid) {
		return {
			action: InputAction.Import,
			data: {
				action: InputAction.Import,
				params: {
					data: formatted,
					backupPreference: importValidation.backupPreference,
				},
			},
			source,
			rawInput,
		};
	}

	// 8. Quick check for recovery phrase pattern (12 words) even if validation failed
	// This handles cases where the mnemonic might be valid but validation takes time
	const words = formatted.trim().split(/\s+/);
	if (words.length === 12) {
		// Re-validate more carefully
		const mnemonicRes = await mnemonicPhraseToKeypair(formatted.toLowerCase());
		if (mnemonicRes.isOk()) {
			return {
				action: InputAction.Import,
				data: {
					action: InputAction.Import,
					params: {
						data: formatted.toLowerCase(),
						backupPreference: EBackupPreference.recoveryPhrase,
					},
				},
				source,
				rawInput,
			};
		}
	}

	// 9. Default to unknown
	return {
		action: InputAction.Unknown,
		data: { action: InputAction.Unknown, params: { rawData: processedInput } },
		source,
		rawInput,
	};
};

/**
 * Type guards for action data
 */
export const isAuthAction = (
	data: ActionData
): data is { action: InputAction.Auth; params: AuthParams; rawUrl: string } => {
	return data.action === InputAction.Auth;
};

export const isImportAction = (
	data: ActionData
): data is { action: InputAction.Import; params: ImportParams } => {
	return data.action === InputAction.Import;
};

export const isSignupAction = (
	data: ActionData
): data is { action: InputAction.Signup; params: SignupParams } => {
	return data.action === InputAction.Signup;
};

export const isInviteAction = (
	data: ActionData
): data is { action: InputAction.Invite; params: InviteParams } => {
	return data.action === InputAction.Invite;
};

export const isSessionAction = (
	data: ActionData
): data is { action: InputAction.Session; params: SessionParams } => {
	return data.action === InputAction.Session;
};

export const isUnknownAction = (
	data: ActionData
): data is { action: InputAction.Unknown; params: { rawData: string } } => {
	return data.action === InputAction.Unknown;
};

export const isDeriveKeypairAction = (
	data: ActionData
): data is { action: InputAction.DeriveKeypair; params: DeriveKeypairParams } => {
	return data.action === InputAction.DeriveKeypair;
};

export const isGetProfileAction = (
	data: ActionData
): data is { action: InputAction.GetProfile; params: GetProfileParams } => {
	return data.action === InputAction.GetProfile;
};

export const isGetFollowsAction = (
	data: ActionData
): data is { action: InputAction.GetFollows; params: GetFollowsParams } => {
	return data.action === InputAction.GetFollows;
};

export const isPaykitConnectAction = (
	data: ActionData
): data is { action: InputAction.PaykitConnect; params: PaykitConnectParams } => {
	return data.action === InputAction.PaykitConnect;
};
