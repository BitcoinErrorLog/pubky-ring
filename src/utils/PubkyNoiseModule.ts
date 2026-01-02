/**
 * PubkyNoiseModule - React Native bridge to pubky-noise Rust library
 *
 * This module provides TypeScript bindings for the native PubkyNoiseModule,
 * which bridges the pubky-noise Rust FFI for X25519 key derivation and
 * Noise Protocol session management.
 */

import { NativeModules } from 'react-native';

const { PubkyNoiseModule: NativePubkyNoiseModule } = NativeModules;

// ============================================================================
// Types - Key Derivation
// ============================================================================

export interface KeypairResult {
	secretKey: string;
	publicKey: string;
}

// ============================================================================
// Types - Noise Manager
// ============================================================================

export interface NoiseManagerResult {
	managerId: string;
}

export interface InitiateConnectionResult {
	sessionId: string;
	firstMessage: string;
}

export interface AcceptConnectionResult {
	sessionId: string;
	responseMessage: string;
}

export interface CompleteConnectionResult {
	sessionId: string;
}

export interface EncryptResult {
	ciphertext: string;
}

export interface DecryptResult {
	plaintext: string;
}

export interface SessionStateResult {
	sessionId: string;
	peerStaticPk: string;
	writeCounter: number;
	readCounter: number;
	status: 'connected' | 'reconnecting' | 'disconnected' | 'error';
}

export interface X25519KeypairResult {
	secretKey: string;
	publicKey: string;
}

export type NoiseConfigType = 'default' | 'batterySaver' | 'performance';
export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected' | 'error';

// ============================================================================
// Availability Check
// ============================================================================

/**
 * Check if the native module is available
 */
export const isNativeModuleAvailable = (): boolean => {
	return NativePubkyNoiseModule != null;
};

// ============================================================================
// Key Derivation Functions
// ============================================================================

/**
 * Derive X25519 keypair from seed, device ID, and epoch
 * Uses pubky-noise HKDF-SHA512 key derivation
 *
 * @param seedHex - 32-byte seed as hex string (Ed25519 secret key)
 * @param deviceIdHex - Device ID as hex string
 * @param epoch - Epoch number for key rotation
 * @returns Promise resolving to keypair with secretKey and publicKey as hex strings
 */
export const deriveX25519ForDeviceEpoch = async (
	seedHex: string,
	deviceIdHex: string,
	epoch: number
): Promise<KeypairResult> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.deriveX25519ForDeviceEpoch(
		seedHex,
		deviceIdHex,
		epoch
	);
};

/**
 * Get the X25519 public key from a secret key
 *
 * @param secretKeyHex - 32-byte secret key as hex string
 * @returns Promise resolving to public key as hex string
 */
export const getPublicKey = async (secretKeyHex: string): Promise<string> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.getPublicKey(secretKeyHex);
};

// ============================================================================
// Noise Manager - Lifecycle
// ============================================================================

/**
 * Create a client Noise Protocol manager
 *
 * @param clientSeedHex - 32-byte client seed as hex string
 * @param clientKid - Client key ID string
 * @param deviceIdHex - Device ID as hex string
 * @param configType - Config type: "default", "batterySaver", or "performance"
 * @returns Promise resolving to manager info with managerId
 */
export const createClientManager = async (
	clientSeedHex: string,
	clientKid: string,
	deviceIdHex: string,
	configType: NoiseConfigType = 'default'
): Promise<NoiseManagerResult> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.createClientManager(
		clientSeedHex,
		clientKid,
		deviceIdHex,
		configType
	);
};

/**
 * Create a server Noise Protocol manager
 *
 * @param serverSeedHex - 32-byte server seed as hex string
 * @param serverKid - Server key ID string
 * @param deviceIdHex - Device ID as hex string
 * @param configType - Config type: "default", "batterySaver", or "performance"
 * @returns Promise resolving to manager info with managerId
 */
export const createServerManager = async (
	serverSeedHex: string,
	serverKid: string,
	deviceIdHex: string,
	configType: NoiseConfigType = 'default'
): Promise<NoiseManagerResult> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.createServerManager(
		serverSeedHex,
		serverKid,
		deviceIdHex,
		configType
	);
};

/**
 * Destroy a Noise Protocol manager and free resources
 *
 * @param managerId - The manager ID from createClientManager/createServerManager
 * @returns Promise resolving to true on success
 */
export const destroyManager = async (managerId: string): Promise<boolean> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.destroyManager(managerId);
};

// ============================================================================
// Noise Manager - Connection Handshake
// ============================================================================

/**
 * Initiate a connection (client-side, step 1 of handshake)
 *
 * @param managerId - The manager ID
 * @param serverPkHex - Server public key as hex string
 * @param hint - Optional hint string
 * @returns Promise resolving to session ID and first message
 */
export const initiateConnection = async (
	managerId: string,
	serverPkHex: string,
	hint?: string | null
): Promise<InitiateConnectionResult> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.initiateConnection(managerId, serverPkHex, hint);
};

/**
 * Accept a connection (server-side)
 *
 * @param managerId - The manager ID
 * @param firstMessageHex - First handshake message as hex string
 * @returns Promise resolving to session ID and response message
 */
export const acceptConnection = async (
	managerId: string,
	firstMessageHex: string
): Promise<AcceptConnectionResult> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.acceptConnection(managerId, firstMessageHex);
};

/**
 * Complete a connection (client-side, step 2 of handshake)
 *
 * @param managerId - The manager ID
 * @param sessionId - Session ID from initiateConnection
 * @param serverResponseHex - Server response message as hex string
 * @returns Promise resolving to final session ID
 */
export const completeConnection = async (
	managerId: string,
	sessionId: string,
	serverResponseHex: string
): Promise<CompleteConnectionResult> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.completeConnection(
		managerId,
		sessionId,
		serverResponseHex
	);
};

// ============================================================================
// Noise Manager - Encryption/Decryption
// ============================================================================

/**
 * Encrypt data for a session
 *
 * @param managerId - The manager ID
 * @param sessionId - Session ID
 * @param plaintextHex - Plaintext as hex string
 * @returns Promise resolving to ciphertext as hex string
 */
export const encrypt = async (
	managerId: string,
	sessionId: string,
	plaintextHex: string
): Promise<EncryptResult> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.encrypt(managerId, sessionId, plaintextHex);
};

/**
 * Decrypt data for a session
 *
 * @param managerId - The manager ID
 * @param sessionId - Session ID
 * @param ciphertextHex - Ciphertext as hex string
 * @returns Promise resolving to plaintext as hex string
 */
export const decrypt = async (
	managerId: string,
	sessionId: string,
	ciphertextHex: string
): Promise<DecryptResult> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.decrypt(managerId, sessionId, ciphertextHex);
};

// ============================================================================
// Noise Manager - Session Management
// ============================================================================

/**
 * List all active session IDs
 *
 * @param managerId - The manager ID
 * @returns Promise resolving to array of session IDs
 */
export const listSessions = async (managerId: string): Promise<string[]> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	const result = await NativePubkyNoiseModule.listSessions(managerId);
	return result.sessions;
};

/**
 * Get session status
 *
 * @param managerId - The manager ID
 * @param sessionId - Session ID
 * @returns Promise resolving to status string or null if session not found
 */
export const getSessionStatus = async (
	managerId: string,
	sessionId: string
): Promise<ConnectionStatus | null> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	const result = await NativePubkyNoiseModule.getSessionStatus(managerId, sessionId);
	return result.status ?? null;
};

/**
 * Remove a session
 *
 * @param managerId - The manager ID
 * @param sessionId - Session ID to remove
 * @returns Promise resolving to true on success
 */
export const removeSession = async (
	managerId: string,
	sessionId: string
): Promise<boolean> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.removeSession(managerId, sessionId);
};

/**
 * Save session state for persistence
 *
 * @param managerId - The manager ID
 * @param sessionId - Session ID
 * @returns Promise resolving to session state for persistence
 */
export const saveSessionState = async (
	managerId: string,
	sessionId: string
): Promise<SessionStateResult> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.saveSessionState(managerId, sessionId);
};

/**
 * Restore session state from persistence
 *
 * @param managerId - The manager ID
 * @param sessionId - Session ID
 * @param peerStaticPkHex - Peer's static public key as hex string
 * @param writeCounter - Write counter value
 * @param readCounter - Read counter value
 * @param status - Connection status
 * @returns Promise resolving to true on success
 */
export const restoreSessionState = async (
	managerId: string,
	sessionId: string,
	peerStaticPkHex: string,
	writeCounter: number,
	readCounter: number,
	status: ConnectionStatus
): Promise<boolean> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.restoreSessionState(
		managerId,
		sessionId,
		peerStaticPkHex,
		writeCounter,
		readCounter,
		status
	);
};

// ============================================================================
// Sealed Blob v1 Functions
// ============================================================================

/**
 * Generate a new X25519 keypair for sealed blob encryption
 *
 * @returns Promise resolving to keypair with secretKey and publicKey as hex strings
 */
export const x25519GenerateKeypair = async (): Promise<X25519KeypairResult> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.x25519GenerateKeypair();
};

/**
 * Derive X25519 public key from a secret key
 *
 * @param secretKeyHex - 32-byte secret key as hex string
 * @returns Promise resolving to public key as hex string
 */
export const x25519PublicFromSecret = async (secretKeyHex: string): Promise<string> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.x25519PublicFromSecret(secretKeyHex);
};

/**
 * Encrypt plaintext using Paykit Sealed Blob v1 format
 *
 * @param recipientPkHex - Recipient's X25519 public key as hex string (32 bytes)
 * @param plaintextHex - Plaintext to encrypt as hex string
 * @param aad - Associated authenticated data (e.g., "handoff:pubkey:/path")
 * @param purpose - Optional purpose hint ("handoff", "request", "proposal")
 * @returns Promise resolving to JSON-encoded sealed blob envelope
 */
export const sealedBlobEncrypt = async (
	recipientPkHex: string,
	plaintextHex: string,
	aad: string,
	purpose?: string | null
): Promise<string> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.sealedBlobEncrypt(recipientPkHex, plaintextHex, aad, purpose);
};

/**
 * Decrypt a Paykit Sealed Blob v1 envelope
 *
 * @param recipientSkHex - Recipient's X25519 secret key as hex string (32 bytes)
 * @param envelopeJson - JSON-encoded sealed blob envelope
 * @param aad - Associated authenticated data (must match encryption)
 * @returns Promise resolving to decrypted plaintext as hex string
 */
export const sealedBlobDecrypt = async (
	recipientSkHex: string,
	envelopeJson: string,
	aad: string
): Promise<string> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.sealedBlobDecrypt(recipientSkHex, envelopeJson, aad);
};

/**
 * Check if a JSON string looks like a sealed blob envelope
 *
 * @param json - JSON string to check
 * @returns Promise resolving to boolean indicating if it's a sealed blob
 */
export const isSealedBlob = async (json: string): Promise<boolean> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.isSealedBlob(json);
};

// ============================================================================
// Default Export
// ============================================================================

export default {
	// Availability
	isNativeModuleAvailable,
	// Key Derivation
	deriveX25519ForDeviceEpoch,
	getPublicKey,
	// Sealed Blob v1
	x25519GenerateKeypair,
	x25519PublicFromSecret,
	sealedBlobEncrypt,
	sealedBlobDecrypt,
	isSealedBlob,
	// Manager Lifecycle
	createClientManager,
	createServerManager,
	destroyManager,
	// Connection Handshake
	initiateConnection,
	acceptConnection,
	completeConnection,
	// Encryption/Decryption
	encrypt,
	decrypt,
	// Session Management
	listSessions,
	getSessionStatus,
	removeSession,
	saveSessionState,
	restoreSessionState,
};
