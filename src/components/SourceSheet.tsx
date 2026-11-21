import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Settings2, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import type { BooruSource } from '../types/booru';
import { useSource } from '../context/SourceContext';
import { StorageService } from '../services/storage';
import { SourceCatalog } from './SourceCatalog';
import { Colors } from '../theme/colors';

interface SourceSheetProps {
  visible: boolean;
  activeSource?: BooruSource;
  onSelectSource?: (source: BooruSource) => Promise<void>;
  onClose: () => void;
  onManage?: () => void;
}

/**
 * In-place source picker for Explore/Search headers.
 * Switching stays on the current screen; managing keys still lives in Settings.
 */
const SourceSheetComponent: React.FC<SourceSheetProps> = ({ visible, activeSource: propSource, onSelectSource, onClose, onManage }) => {
  const { activeSource: contextSource, selectSource } = useSource();
  const activeSource = propSource ?? contextSource;
  const insets = useSafeAreaInsets();
  const [hasRule34Key, setHasRule34Key] = useState(true);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    StorageService.getRule34Auth()
      .then((auth) => {
        if (alive) setHasRule34Key(!!(auth.userId && auth.apiKey));
      })
      .catch(() => {
        if (alive) setHasRule34Key(true);
      });
    return () => {
      alive = false;
    };
  }, [visible]);

  const handleSelect = async (source: BooruSource) => {
    if (source.id === activeSource.id) {
      onClose();
      return;
    }
    Haptics.selectionAsync();
    try {
      await (onSelectSource ?? selectSource)(source);
    } catch {
      // Keep the sheet open so the user can retry; selection already failed.
      return;
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'}
      onRequestClose={onClose}
    >
      {visible ? (
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: Platform.OS === 'ios' ? 8 : insets.top + 8 }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {Platform.OS === 'ios' && (
          <View style={styles.dragHandleContainer}>
            <View style={styles.dragHandle} />
          </View>
        )}

        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close source picker"
            style={styles.circleBtn}
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <X size={20} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>Choose source</Text>
            <Text style={styles.headerSubtitle}>Stay here, switch instantly</Text>
          </View>

          {onManage ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Manage sources"
              style={styles.circleBtn}
              onPress={onManage}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Settings2 size={20} color="#FFFFFF" />
            </TouchableOpacity>
          ) : (
            <View style={styles.circleBtnPlaceholder} />
          )}
        </View>

        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
        >
          <SourceCatalog
            activeSource={activeSource}
            onSelect={handleSelect}
            credentials={{ rule34: hasRule34Key }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
      ) : null}
    </Modal>
  );
};

export const SourceSheet = React.memo(SourceSheetComponent);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleBtnPlaceholder: {
    width: 40,
    height: 40,
  },
  headerCopy: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: Colors.dark.textMuted,
    marginTop: 2,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
});
