import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';

const SECURITY_CONFIG_KEY = '@booru_security_config_v2';

export interface SecurityConfig {
  enabled: boolean;
  passcodeHash: string | null;
  useBiometrics: boolean;
  autoLockImmediately: boolean;
}

const DEFAULT_CONFIG: SecurityConfig = {
  enabled: false,
  passcodeHash: null,
  useBiometrics: true,
  autoLockImmediately: true,
};

export type BiometryType = 'Face ID' | 'Touch ID' | 'Fingerprint' | 'Biometric';

export const SecurityService = {
  /**
   * Hash a plaintext PIN using SHA-256
   */
  async hashPasscode(pin: string): Promise<string> {
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `booru_salt_${pin}`
    );
    return hash;
  },

  /**
   * Get current security configuration from storage
   */
  async getConfig(): Promise<SecurityConfig> {
    try {
      const data = await AsyncStorage.getItem(SECURITY_CONFIG_KEY);
      if (data) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
      }
      return DEFAULT_CONFIG;
    } catch (e) {
      console.warn('Error reading security config:', e);
      return DEFAULT_CONFIG;
    }
  },

  /**
   * Save security configuration
   */
  async saveConfig(config: SecurityConfig): Promise<void> {
    try {
      await AsyncStorage.setItem(SECURITY_CONFIG_KEY, JSON.stringify(config));
    } catch (e) {
      console.warn('Error saving security config:', e);
    }
  },

  /**
   * Check if passcode lock is enabled
   */
  async isPasscodeEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return !!(config.enabled && config.passcodeHash);
  },

  /**
   * Verify an entered PIN against stored hash
   */
  async verifyPasscode(pin: string): Promise<boolean> {
    const config = await this.getConfig();
    if (!config.enabled || !config.passcodeHash) {
      return true; // not locked
    }
    const enteredHash = await this.hashPasscode(pin);
    return enteredHash === config.passcodeHash;
  },

  /**
   * Set new passcode and enable lock
   */
  async setPasscode(pin: string, useBiometrics: boolean = true): Promise<void> {
    const hash = await this.hashPasscode(pin);
    const current = await this.getConfig();
    const updated: SecurityConfig = {
      ...current,
      enabled: true,
      passcodeHash: hash,
      useBiometrics,
    };
    await this.saveConfig(updated);
  },

  /**
   * Disable passcode lock
   */
  async disablePasscode(): Promise<void> {
    const current = await this.getConfig();
    const updated: SecurityConfig = {
      ...current,
      enabled: false,
      passcodeHash: null,
    };
    await this.saveConfig(updated);
  },

  /**
   * Toggle biometrics setting
   */
  async setUseBiometrics(useBiometrics: boolean): Promise<void> {
    const current = await this.getConfig();
    const updated: SecurityConfig = {
      ...current,
      useBiometrics,
    };
    await this.saveConfig(updated);
  },

  /**
   * Check hardware biometric capability and enrolled status
   */
  async getBiometricStatus(): Promise<{
    hasHardware: boolean;
    isEnrolled: boolean;
    biometryType: BiometryType | null;
  }> {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      
      let biometryType: BiometryType | null = null;
      if (hasHardware) {
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
        if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
          biometryType = 'Face ID';
        } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
          biometryType = 'Touch ID';
        } else if (types.length > 0) {
          biometryType = 'Biometric';
        }
      }

      return {
        hasHardware,
        isEnrolled,
        biometryType,
      };
    } catch {
      return {
        hasHardware: false,
        isEnrolled: false,
        biometryType: null,
      };
    }
  },

  /**
   * Prompt biometric authentication (Face ID / Touch ID)
   */
  async authenticateWithBiometrics(
    promptMessage: string = 'Verify to unlock the app'
  ): Promise<boolean> {
    try {
      const status = await this.getBiometricStatus();
      if (!status.hasHardware || !status.isEnrolled) {
        return false;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        cancelLabel: 'Use Passcode',
        fallbackLabel: 'Open with Passcode',
        disableDeviceFallback: true, // We have our own custom PIN pad fallback
      });

      return result.success;
    } catch (e) {
      console.warn('Biometric auth error:', e);
      return false;
    }
  },
};
