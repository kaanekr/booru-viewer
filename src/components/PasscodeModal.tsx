import React, { useState, useEffect } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { LockScreen } from './LockScreen';
import { SecurityService } from '../services/securityService';

export type PasscodeModalMode = 'setup' | 'change' | 'disable';

interface PasscodeModalProps {
  visible: boolean;
  mode: PasscodeModalMode;
  onClose: () => void;
  onSuccess: () => void;
}

export const PasscodeModal: React.FC<PasscodeModalProps> = ({
  visible,
  mode,
  onClose,
  onSuccess,
}) => {
  // Step tracker:
  // setup: 1 (enter new) -> 2 (confirm new)
  // change: 1 (verify old) -> 2 (enter new) -> 3 (confirm new)
  // disable: 1 (verify old)
  const [step, setStep] = useState<number>(1);
  const [firstPin, setFirstPin] = useState<string>('');
  const [errorText, setErrorText] = useState<string | null>(null);

  // Reset state on open/close
  useEffect(() => {
    if (visible) {
      setStep(1);
      setFirstPin('');
      setErrorText(null);
    }
  }, [visible, mode]);

  if (!visible) return null;

  // Compute title & subtitle based on current mode and step
  let title = 'Passcode';
  let subtitle = 'PIN kodunuzu girin';

  if (mode === 'setup') {
    if (step === 1) {
      title = 'Yeni Passcode Belirleyin';
      subtitle = 'Uygulamayı kilitlemek için 4 haneli bir PIN girin';
    } else {
      title = 'Passcode\'u Doğrulayın';
      subtitle = 'Belirlediğiniz 4 haneli PIN kodunu tekrar girin';
    }
  } else if (mode === 'change') {
    if (step === 1) {
      title = 'Mevcut Passcode';
      subtitle = 'Devam etmek için mevcut PIN kodunuzu girin';
    } else if (step === 2) {
      title = 'Yeni Passcode';
      subtitle = 'Yeni 4 haneli PIN kodunuzu belirleyin';
    } else {
      title = 'Yeni Passcode\'u Doğrulayın';
      subtitle = 'Yeni PIN kodunu onaylamak için tekrar girin';
    }
  } else if (mode === 'disable') {
    title = 'Kilidi Kapat';
    subtitle = 'Passcode kilidini kaldırmak için mevcut PIN kodunuzu girin';
  }

  const handlePinSubmit = async (pin: string) => {
    setErrorText(null);

    // --- SETUP FLOW ---
    if (mode === 'setup') {
      if (step === 1) {
        setFirstPin(pin);
        setStep(2);
        return { success: true };
      } else if (step === 2) {
        if (pin === firstPin) {
          await SecurityService.setPasscode(pin);
          onSuccess();
          onClose();
          return { success: true };
        } else {
          setFirstPin('');
          setStep(1);
          return { success: false, error: 'Passcode eşleşmedi! Yeniden girin.' };
        }
      }
    }

    // --- CHANGE FLOW ---
    if (mode === 'change') {
      if (step === 1) {
        const isOldValid = await SecurityService.verifyPasscode(pin);
        if (isOldValid) {
          setStep(2);
          return { success: true };
        } else {
          return { success: false, error: 'Mevcut Passcode hatalı!' };
        }
      } else if (step === 2) {
        setFirstPin(pin);
        setStep(3);
        return { success: true };
      } else if (step === 3) {
        if (pin === firstPin) {
          await SecurityService.setPasscode(pin);
          onSuccess();
          onClose();
          return { success: true };
        } else {
          setFirstPin('');
          setStep(2);
          return { success: false, error: 'Yeni Passcode eşleşmedi! Tekrar deneyin.' };
        }
      }
    }

    // --- DISABLE FLOW ---
    if (mode === 'disable') {
      const isValid = await SecurityService.verifyPasscode(pin);
      if (isValid) {
        await SecurityService.disablePasscode();
        onSuccess();
        onClose();
        return { success: true };
      } else {
        return { success: false, error: 'Mevcut Passcode hatalı!' };
      }
    }

    return { success: false, error: 'Bilinmeyen işlem' };
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <LockScreen
          mode="custom"
          title={title}
          subtitle={subtitle}
          errorText={errorText}
          showCancelButton={true}
          onCancel={onClose}
          onPinSubmit={handlePinSubmit}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: '#0D0E12',
  },
});
