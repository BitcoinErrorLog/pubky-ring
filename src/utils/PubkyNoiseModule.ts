import { NativeModules } from 'react-native';

const { PubkyNoiseModule: NativePubkyNoiseModule } = NativeModules;

export const isNativeModuleAvailable = (): boolean => NativePubkyNoiseModule != null;

export const ed25519Sign = async (
	ed25519SecretHex: string,
	messageHex: string
): Promise<string> => {
	if (!isNativeModuleAvailable()) {
		throw new Error('PubkyNoiseModule native module is not available');
	}
	return NativePubkyNoiseModule.ed25519Sign(ed25519SecretHex, messageHex);
};

export default {
	isNativeModuleAvailable,
	ed25519Sign,
};
