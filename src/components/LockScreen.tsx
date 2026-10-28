import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Dimensions,
  StatusBar as RNStatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Lock, Delete, ScanFace, Fingerprint, ShieldCheck, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { SecurityService, BiometryType } from '../services/securityService';
import { Colors } from '../theme/colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GOLD_ACCENT = '#F5A623';
const PIN_LENGTH = 4;

interface KeypadItem {
  digit: string;
  letters?: string;
}

const KEYPAD_ROWS: KeypadItem[][] = [
  [
    { digit: '1', letters: '' },
    { digit: '2', letters: 'A B C' },
    { digit: '3', letters: 'D E F' },
  ],
  [
    { digit: '4', letters: 'G H I' },
    { digit: '5', letters: 'J K L' },
    { digit: '6', letters: 'M N O' },
  ],
  [
    { digit: '7', letters: 'P Q R S' },
    { digit: '8', letters: 'T U V' },
    { digit: '9', letters: 'W X Y Z' },
  ],
];

export interface LockScreenProps {
  mode?: 'unlock' | 'custom';
  title?: string;
  subtitle?: string;
  errorText?: string | null;
  onSuccess?: () => void;
  onCancel?: () => void;
  onPinSubmit?: (pin: string) => Promise<{ success: boolean; error?: string } | boolean | void>;
  showCancelButton?: boolean;
}

export const LockScreen: React.FC<LockScreenProps> = ({
  mode = 'unlock',
  title = 'Enter Passcode',
  subtitle = 'Enter your 4-digit PIN to access the app',
  errorText: externalError = null,
  onSuccess,
  onCancel,
  onPinSubmit,
  showCancelButton = false,
}) => {
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(externalError);
  const [isErrorState, setIsErrorState] = useState<boolean>(false);
  const [biometryType, setBiometryType] = useState<BiometryType | null>(null);
  const [biometricsAvailable, setBiometricsAvailable] = useState<boolean>(false);
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);

  const shakeAnim = useRef(new Animated.Value(0)).current;
  const dotsScaleAnim = useRef(new Animated.Value(1)).current;

  // Sync external error text if provided
  useEffect(() => {
    if (externalError) {
      triggerErrorAnimation(externalError);
    }
  }, [externalError]);

  // Check biometrics availability on mount
  useEffect(() => {
    let isMounted = true;

    async function checkBio() {
      const config = await SecurityService.getConfig();
      const status = await SecurityService.getBiometricStatus();

      if (isMounted) {
        setBiometryType(status.biometryType);
        const available = status.hasHardware && status.isEnrolled && config.useBiometrics;
        setBiometricsAvailable(available);

        // Auto trigger biometrics if unlock mode and biometrics enabled
        if (mode === 'unlock' && available) {
          triggerBiometricAuth();
        }
      }
    }

    checkBio();

    return () => {
      isMounted = false;
    };
  }, [mode]);

  const triggerErrorAnimation = useCallback((msg: string = 'Incorrect Passcode') => {
    setErrorMsg(msg);
    setIsErrorState(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: -14, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 14, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -5, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 5, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 45, useNativeDriver: true }),
    ]).start(() => {
      // Clear PIN after shake
      setTimeout(() => {
        setPin('');
        setIsErrorState(false);
      }, 400);
    });
  }, [shakeAnim]);

  const triggerBiometricAuth = async () => {
    if (isAuthenticating) return;
    setIsAuthenticating(true);
    try {
      const ok = await SecurityService.authenticateWithBiometrics(
        biometryType ? `Unlock with ${biometryType}` : 'Biometric Authentication'
      );
      if (ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onSuccess?.();
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleKeyPress = async (digit: string) => {
    if (isErrorState || pin.length >= PIN_LENGTH) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setErrorMsg(null);

    const newPin = pin + digit;
    setPin(newPin);

    // Pulse dots slightly
    Animated.sequence([
      Animated.timing(dotsScaleAnim, { toValue: 1.08, duration: 60, useNativeDriver: true }),
      Animated.timing(dotsScaleAnim, { toValue: 1, duration: 60, useNativeDriver: true }),
    ]).start();

    if (newPin.length === PIN_LENGTH) {
      if (onPinSubmit) {
        // Custom handler passed by parent
        try {
          const result = await onPinSubmit(newPin);
          if (typeof result === 'boolean') {
            if (result) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onSuccess?.();
            } else {
              triggerErrorAnimation('Incorrect Passcode');
            }
          } else if (result && typeof result === 'object') {
            if (result.success) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onSuccess?.();
            } else {
              triggerErrorAnimation(result.error || 'Incorrect Passcode');
            }
          }
        } catch (e: any) {
          triggerErrorAnimation(e?.message || 'Verification error');
        }
      } else if (mode === 'unlock') {
        // Default unlock check against stored hash
        const isMatch = await SecurityService.verifyPasscode(newPin);
        if (isMatch) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onSuccess?.();
        } else {
          triggerErrorAnimation('Incorrect Passcode');
        }
      }
    }
  };

  const handleDelete = () => {
    if (pin.length > 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setPin((prev) => prev.slice(0, -1));
      setErrorMsg(null);
      setIsErrorState(false);
    }
  };

  const renderBiometricIcon = () => {
    if (biometryType === 'Face ID') {
      return <ScanFace size={28} color={GOLD_ACCENT} />;
    }
    return <Fingerprint size={28} color={GOLD_ACCENT} />;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 20 }]}>
      <RNStatusBar barStyle="light-content" />

      {/* Optional Cancel/Close Button */}
      {showCancelButton && onCancel && (
        <TouchableOpacity
          style={[styles.cancelButton, { top: insets.top + 12 }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onCancel();
          }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <X size={24} color={Colors.dark.textMuted} />
        </TouchableOpacity>
      )}

      {/* Header Info */}
      <View style={styles.headerSection}>
        <View style={styles.iconCircle}>
          <Lock size={28} color={GOLD_ACCENT} />
        </View>

        <Text style={styles.titleText}>{title}</Text>
        <Text style={styles.subtitleText}>{subtitle}</Text>
      </View>

      {/* PIN Dots Display with Shake Animation */}
      <Animated.View
        style={[
          styles.dotsContainer,
          {
            transform: [
              { translateX: shakeAnim },
              { scale: dotsScaleAnim },
            ],
          },
        ]}
      >
        {Array.from({ length: PIN_LENGTH }).map((_, idx) => {
          const isFilled = idx < pin.length;
          return (
            <View
              key={idx}
              style={[
                styles.dot,
                isFilled && styles.dotFilled,
                isErrorState && styles.dotError,
              ]}
            >
              {isFilled && !isErrorState && (
                <View style={styles.dotInnerGlow} />
              )}
            </View>
          );
        })}
      </Animated.View>

      {/* Error Message */}
      <View style={styles.errorContainer}>
        {errorMsg ? (
          <Text style={styles.errorText}>{errorMsg}</Text>
        ) : null}
      </View>

      {/* Keypad (Strict 3-Columns x 4-Rows Layout) */}
      <View style={styles.keypadContainer}>
        {KEYPAD_ROWS.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.keypadRow}>
            {row.map((item) => (
              <TouchableOpacity
                key={item.digit}
                style={styles.keyButton}
                onPress={() => handleKeyPress(item.digit)}
                activeOpacity={0.4}
              >
                <Text style={styles.keyDigitText}>{item.digit}</Text>
                {item.letters ? (
                  <Text style={styles.keyLettersText}>{item.letters}</Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        ))}

        {/* 4th Row: Biometrics | 0 | Delete */}
        <View style={styles.keypadRow}>
          {/* Left Action (Biometrics) */}
          <View style={styles.actionButtonWrapper}>
            {biometricsAvailable && mode === 'unlock' ? (
              <TouchableOpacity
                style={styles.actionKeyButton}
                onPress={triggerBiometricAuth}
                activeOpacity={0.6}
              >
                {renderBiometricIcon()}
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Center Key (0) */}
          <TouchableOpacity
            style={styles.keyButton}
            onPress={() => handleKeyPress('0')}
            activeOpacity={0.4}
          >
            <Text style={styles.keyDigitText}>0</Text>
          </TouchableOpacity>

          {/* Right Action (Delete) */}
          <View style={styles.actionButtonWrapper}>
            {pin.length > 0 ? (
              <TouchableOpacity
                style={styles.actionKeyButton}
                onPress={handleDelete}
                activeOpacity={0.6}
              >
                <Delete size={26} color="#FFFFFF" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>

      {/* Security Footer Badge */}
      <View style={styles.footerSection}>
        <ShieldCheck size={14} color="#686E7D" />
        <Text style={styles.footerText}>End-to-end on-device security</Text>
      </View>
    </View>
  );
};

const BUTTON_SIZE = 75;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0E12',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  cancelButton: {
    position: 'absolute',
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  headerSection: {
    alignItems: 'center',
    marginTop: 10,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(245, 166, 35, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(245, 166, 35, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  titleText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitleText: {
    fontSize: 13,
    color: Colors.dark.textMuted,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 18,
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    marginVertical: 10,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  dotFilled: {
    borderColor: GOLD_ACCENT,
    backgroundColor: GOLD_ACCENT,
  },
  dotError: {
    borderColor: '#FF4D4F',
    backgroundColor: '#FF4D4F',
  },
  dotInnerGlow: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  errorContainer: {
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  errorText: {
    color: '#FF4D4F',
    fontSize: 13,
    fontWeight: '600',
  },
  keypadContainer: {
    width: BUTTON_SIZE * 3 + 48,
    alignItems: 'center',
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 14,
    alignItems: 'center',
  },
  keyButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyDigitText: {
    fontSize: 28,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  keyLettersText: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.4)',
    letterSpacing: 1.5,
    marginTop: -2,
  },
  actionButtonWrapper: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionKeyButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  footerText: {
    fontSize: 11,
    color: '#686E7D',
    fontWeight: '500',
  },
});

