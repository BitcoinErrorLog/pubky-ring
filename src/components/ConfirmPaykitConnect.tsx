/**
 * Paykit-connect confirmation sheet.
 *
 * Mirrors ConfirmAuth: PubkyCard, capabilities list, Deny/Approve,
 * generation-gated buttons. Does not call sign-in — the action awaits
 * onDecision and only then talks to the network.
 */

import React, { memo, ReactElement, useCallback } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import {
	ActionButton,
	ActionSheetContainer,
	Folder,
	SessionText,
	Text,
	View,
	SkiaGradient,
	Globe,
} from '../theme/components';
import { SheetManager } from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import {
	getToastStyle,
	isSmallScreen,
	showToast,
} from '../utils/helpers.ts';
import PubkyCard from './PubkyCard.tsx';
import { getNavigationAnimation } from '../store/selectors/settingsSelectors.ts';
import Toast from 'react-native-toast-message';
import { toastConfig } from '../theme/toastConfig.tsx';
import ModalIndicator from './ModalIndicator.tsx';
import {
	ACTION_SHEET_HEIGHT,
	SMALL_SCREEN_ACTION_SHEET_HEIGHT,
} from '../utils/constants.ts';
import { buttonStyles } from '../theme/utils';
import { RootState } from '../store';
import { getPubkyName } from '../store/selectors/pubkySelectors.ts';
import { useTranslation } from 'react-i18next';
import { shouldAuthorizeRequest } from '../utils/authRequestGeneration';
import { copyToClipboard } from '../utils/clipboard';
import { PaykitConnectConfirmPayload } from '../utils/confirmPaykitConnect';
import { PaykitConnectCapability } from '../utils/paykitConnectCaps';
import { DEVICE_ID_DISPLAY_MAX, sanitizeDisplayString } from '../utils/sanitizeDisplayString';

const toastStyle = getToastStyle();
const smallScreen = isSmallScreen();
const actionSheetHeight = smallScreen ? SMALL_SCREEN_ACTION_SHEET_HEIGHT : ACTION_SHEET_HEIGHT;

const CapabilitiesList = memo(({
	capabilities,
}: {
	capabilities: PaykitConnectCapability[];
}): ReactElement => {
	if (capabilities.length === 0) {
		return <></>;
	}
	return (
		<>
			{capabilities.map((capability, index) => (
				<View style={styles.permissionsSection} key={`${capability.path}:${index}`}>
					<Permission capability={capability} />
					{index !== capabilities.length - 1 && <View style={styles.spacer} />}
				</View>
			))}
		</>
	);
});

const Permission = memo(({
	capability,
}: {
	capability: PaykitConnectCapability;
}): ReactElement => {
	const { t } = useTranslation();
	const hasReadPermission = capability.permission.includes('r');
	const hasWritePermission = capability.permission.includes('w');
	return (
		<View style={styles.permissionRow}>
			<Folder size={13} />
			<View style={styles.pathContainer}>
				<Text style={styles.pathText}>{sanitizeDisplayString(capability.path)}</Text>
			</View>
			<View style={styles.permissionsContainer}>
				{hasReadPermission && (
					<SessionText style={styles.unauthorizedText}>
						{t('common.read')}{hasWritePermission ? ',' : ''}
					</SessionText>
				)}
				{hasWritePermission && (
					<SessionText style={styles.unauthorizedText}>{t('common.write')}</SessionText>
				)}
			</View>
		</View>
	);
});

const ConfirmPaykitConnect = ({
	payload,
}: {
	payload: PaykitConnectConfirmPayload;
}): ReactElement => {
	const { t } = useTranslation();
	const navigationAnimation = useSelector(getNavigationAnimation);
	const {
		pubky,
		destination,
		deviceId,
		capabilities,
		verificationCode,
		requestGeneration,
		onDecision,
	} = payload;
	const pubkyName = useSelector((state: RootState) => getPubkyName(state, pubky));

	const handleCopyPubky = useCallback(() => {
		copyToClipboard(pubky);
		showToast({
			type: 'info',
			title: t('clipboard.pubkyCopied'),
			description: t('clipboard.pubkyCopiedDescription'),
		});
	}, [pubky, t]);

	const handleDeny = useCallback(() => {
		onDecision?.(false);
	}, [onDecision]);

	const handleApprove = useCallback(() => {
		// Decision: leftover sheet after a newer request must not Approve.
		if (!shouldAuthorizeRequest(requestGeneration)) {
			SheetManager.hide('confirm-paykit-connect');
			return;
		}
		onDecision?.(true);
	}, [onDecision, requestGeneration]);

	return (
		<ActionSheetContainer
			id="confirm-paykit-connect"
			navigationAnimation={navigationAnimation}
			CustomHeaderComponent={<></>}
			height={actionSheetHeight}
		>
			<SkiaGradient modal={true} style={styles.content}>
				<ModalIndicator />
				<View style={styles.mainContent}>
					<View style={styles.titleContainer}>
						<Text style={styles.title}>{t('session.paykitConnectTitle')}</Text>
					</View>

					<Pressable
						testID="ConfirmPaykitConnectPubky"
						onPress={handleCopyPubky}
						accessibilityRole="button"
					>
						<PubkyCard
							name={pubkyName}
							publicKey={pubky}
							style={styles.pubkyCard}
							containerStyle={styles.pubkyContainer}
							nameStyle={styles.pubkyName}
							pubkyTextStyle={styles.pubkyText}
							avatarSize={48}
							avatarStyle={styles.avatarContainer}
						/>
					</Pressable>

					<View style={styles.section} testID="ConfirmPaykitConnectDestination">
						<SessionText style={styles.sectionTitle}>
							{t('session.paykitConnectDestination')}
						</SessionText>
						<View style={styles.relayContainer}>
							<Globe color="rgba(255, 255, 255, 0.8)" size={15} />
							<Text style={styles.relayText}>{destination}</Text>
						</View>
					</View>

					<View style={styles.section} testID="ConfirmPaykitConnectDeviceId">
						<SessionText style={styles.sectionTitle}>
							{t('session.paykitConnectDeviceId')}
						</SessionText>
						<Text style={styles.relayText}>
							{sanitizeDisplayString(deviceId, DEVICE_ID_DISPLAY_MAX)}
						</Text>
					</View>

					<View style={styles.section} testID="ConfirmPaykitConnectVerification">
						<SessionText style={styles.sectionTitle}>
							{t('session.paykitConnectVerification')}
						</SessionText>
						<Text style={styles.verificationCode}>{verificationCode}</Text>
					</View>

					<View style={styles.section}>
						<SessionText style={styles.sectionTitle}>
							{t('auth.requestedPermissions')}
						</SessionText>
						<CapabilitiesList capabilities={capabilities} />
					</View>

					<SessionText style={styles.warningText} testID="ConfirmPaykitConnectWarning">
						{t('session.paykitConnectWarning')}
					</SessionText>
				</View>

				<View style={styles.footerContainer}>
					<View style={styles.buttonContainer}>
						<ActionButton
							testID="ConfirmPaykitConnectDenyButton"
							style={styles.denyButton}
							onPress={handleDeny}
							activeOpacity={0.7}
						>
							<Text numberOfLines={1} style={styles.actionButtonText}>
								{t('auth.deny')}
							</Text>
						</ActionButton>
						<ActionButton
							testID="ConfirmPaykitConnectApproveButton"
							style={styles.authorizeButton}
							onPress={handleApprove}
							activeOpacity={0.7}
						>
							<Text numberOfLines={1} style={styles.actionButtonText}>
								{t('session.paykitConnectApprove')}
							</Text>
						</ActionButton>
					</View>
				</View>
			</SkiaGradient>
			<Toast config={toastConfig({ style: toastStyle })} />
		</ActionSheetContainer>
	);
};

const styles = StyleSheet.create({
	content: {
		height: '100%',
		backgroundColor: 'transparent',
		borderTopRightRadius: 20,
		borderTopLeftRadius: 20,
	},
	actionButtonText: {
		fontSize: 15,
		fontWeight: '600',
		lineHeight: 18,
		letterSpacing: 0.2,
		alignSelf: 'center',
	},
	section: {
		marginBottom: 16,
		backgroundColor: 'rgba(0, 0, 0, 0)',
		borderWidth: 1,
		borderColor: 'rgba(255, 255, 255, 0.16)',
		padding: 16,
		borderRadius: 16,
	},
	relayContainer: {
		flexDirection: 'row',
		justifyContent: 'flex-start',
		alignItems: 'center',
		backgroundColor: 'transparent',
	},
	permissionsSection: {
		backgroundColor: 'transparent',
	},
	relayText: {
		fontSize: 13,
		fontWeight: '600',
		lineHeight: 18,
		letterSpacing: 0.4,
		justifyContent: 'center',
		marginLeft: 6,
	},
	verificationCode: {
		fontSize: 22,
		fontWeight: '700',
		letterSpacing: 2,
	},
	warningText: {
		fontWeight: '400',
		fontSize: 15,
		lineHeight: 20,
		letterSpacing: 0.4,
		marginBottom: 8,
	},
	permissionRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		backgroundColor: 'transparent',
	},
	pathContainer: {
		flex: 2,
		marginLeft: 5,
		justifyContent: 'center',
		backgroundColor: 'transparent',
	},
	pathText: {
		fontSize: 13,
		fontWeight: '600',
		lineHeight: 18,
		backgroundColor: 'transparent',
	},
	permissionsContainer: {
		flex: 1,
		flexDirection: 'row',
		justifyContent: 'flex-end',
		gap: 8,
		backgroundColor: 'transparent',
	},
	footerContainer: {
		height: '12%',
		paddingHorizontal: 12,
		justifyContent: 'center',
		backgroundColor: 'transparent',
	},
	buttonContainer: {
		flexDirection: 'row',
		gap: 12,
		zIndex: 3,
		backgroundColor: 'transparent',
	},
	mainContent: {
		height: '83%',
		paddingHorizontal: 12,
		backgroundColor: 'transparent',
	},
	denyButton: {
		...buttonStyles.compactOutline,
		width: '45%',
		margin: 8,
		justifyContent: 'center',
		borderWidth: 0,
	},
	authorizeButton: {
		...buttonStyles.compactOutline,
		width: '45%',
		margin: 8,
		justifyContent: 'center',
	},
	unauthorizedText: {
		fontSize: 13,
		fontWeight: '500',
		lineHeight: 18,
		letterSpacing: 0.8,
		textTransform: 'uppercase',
		backgroundColor: 'transparent',
	},
	sectionTitle: {
		fontSize: 13,
		fontWeight: '500',
		lineHeight: 18,
		letterSpacing: 0.8,
		textTransform: 'uppercase',
		marginBottom: 8,
		backgroundColor: 'transparent',
	},
	titleContainer: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		marginBottom: 16,
		backgroundColor: 'transparent',
	},
	title: {
		fontSize: 17,
		fontWeight: '700',
		lineHeight: 22,
		letterSpacing: 0.4,
		backgroundColor: 'transparent',
	},
	pubkyCard: {
		minHeight: 100,
	},
	pubkyContainer: {},
	avatarContainer: {
		width: 48,
		height: 48,
		borderRadius: 24,
		marginRight: 16,
	},
	pubkyName: {
		fontSize: 26,
		fontWeight: '300',
		lineHeight: 32,
		letterSpacing: 0,
		marginBottom: 2,
	},
	pubkyText: {
		fontSize: 15,
		fontWeight: '600',
		lineHeight: 20,
		letterSpacing: 0.4,
	},
	spacer: {
		marginBottom: 12,
	},
});

export default memo(ConfirmPaykitConnect);
