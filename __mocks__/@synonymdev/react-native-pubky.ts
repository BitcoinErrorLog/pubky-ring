/**
 * Mock for @synonymdev/react-native-pubky
 */

export const parseAuthUrl = jest.fn();
export const mnemonicPhraseToKeypair = jest.fn();
export const getPublicKeyFromSecretKey = jest.fn();
export const signUp = jest.fn();
export const signIn = jest.fn();
export const signOut = jest.fn();
export const put = jest.fn();
export const get = jest.fn();
export const list = jest.fn();
export const deleteFile = jest.fn();
export const generateSecretKey = jest.fn();
export const generateMnemonicPhrase = jest.fn();
export const generateMnemonicPhraseAndKeypair = jest.fn();
export const validateMnemonicPhrase = jest.fn();
export const createRecoveryFile = jest.fn();
export const decryptRecoveryFile = jest.fn();
export const revalidateSession = jest.fn();

export default {
	parseAuthUrl,
	mnemonicPhraseToKeypair,
	getPublicKeyFromSecretKey,
	signUp,
	signIn,
	signOut,
	put,
	get,
	list,
	deleteFile,
	generateSecretKey,
	generateMnemonicPhrase,
	generateMnemonicPhraseAndKeypair,
	validateMnemonicPhrase,
	createRecoveryFile,
	decryptRecoveryFile,
	revalidateSession,
};

