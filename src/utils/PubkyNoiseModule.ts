/**
 * PubkyNoiseModule - React Native bridge to pubky-noise Rust library
 *
 * This module provides TypeScript bindings for the native PubkyNoiseModule,
 * which bridges the pubky-noise Rust FFI for X25519 key derivation and
 * Noise Protocol session management.
 */

import { NativeModules, Platform } from 'react-native';

const { PubkyNoiseModule: NativePubkyNoiseModule } = NativeModules;

interface KeypairResult {
	secretKey: string;
	publicKey: string;
}

interface NoiseManagerResult {
	managerId: string;
}

interface SessionState {
	sessionId: string;
	isConnected: boolean;
	localPublicKey: string;
	remotePublicKey: string;
	createdAt: number;
	lastActivity: number;
}

/**
 * Check if the native module is available
 */
export const isNativeModuleAvailable = (): boolean => {
	return NativePubkyNoiseModule != null;
};

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

/**
 * Create a Noise Protocol manager for session handling
 *
 * @param secretKeyHex - 32-byte secret key as hex string
 * @param configType - Config type: "default", "batterySaver", or "performance"
 * @returns Promise resolving to manager info with managerId
 */
export const createNoiseManager = async (
	secretKeyHex: string,
	configType: 'default' | 'batterySaver' | 'performance' = 'default'
): Promise<NoiseManagerResult> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.createNoiseManager(secretKeyHex, configType);
};

/**
 * Start a Noise Protocol manager
 *
 * @param managerId - The manager ID from createNoiseManager
 * @returns Promise resolving to true on success
 */
export const startNoiseManager = async (managerId: string): Promise<boolean> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.startNoiseManager(managerId);
};

/**
 * Stop a Noise Protocol manager
 *
 * @param managerId - The manager ID from createNoiseManager
 * @returns Promise resolving to true on success
 */
export const stopNoiseManager = async (managerId: string): Promise<boolean> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.stopNoiseManager(managerId);
};

/**
 * Get session state from a Noise Protocol manager
 *
 * @param managerId - The manager ID from createNoiseManager
 * @returns Promise resolving to session state
 */
export const getSessionState = async (
	managerId: string
): Promise<SessionState> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.getSessionState(managerId);
};

/**
 * Destroy a Noise Protocol manager and free resources
 *
 * @param managerId - The manager ID from createNoiseManager
 * @returns Promise resolving to true on success
 */
export const destroyNoiseManager = async (
	managerId: string
): Promise<boolean> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.destroyNoiseManager(managerId);
};

export default {
	isNativeModuleAvailable,
	deriveX25519ForDeviceEpoch,
	getPublicKey,
	createNoiseManager,
	startNoiseManager,
	stopNoiseManager,
	getSessionState,
	destroyNoiseManager,
};

