import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Check, Settings2 } from 'lucide-react-native';
import type { BooruSource } from '../types/booru';
import { AVAILABLE_SOURCES } from '../services/sources';
import { Colors } from '../theme/colors';

type SourceKind = 'Images' | 'Videos' | 'Manga';
const BRANDS: Record<string, { initials: string; color: string; kind: SourceKind }> = {
  gelbooru: { initials: 'G', color: '#6EA8FE', kind: 'Images' },
  yandere: { initials: 'Y', color: '#F194AF', kind: 'Images' },
  danbooru: { initials: 'D', color: '#B1A1FA', kind: 'Images' },
  realbooru: { initials: 'R', color: '#D4B48C', kind: 'Images' },
  rule34: { initials: '34', color: '#9BCB88', kind: 'Images' },
  cumst: { initials: 'C', color: '#80CABB', kind: 'Images' },
  redgifs: { initials: 'RG', color: '#F58F9D', kind: 'Videos' },
  xvideos: { initials: 'XV', color: '#FA9890', kind: 'Videos' },
  xhamster: { initials: 'XH', color: '#F2B178', kind: 'Videos' },
  pornhub: { initials: 'PH', color: '#E9B368', kind: 'Videos' },
  sexcom: { initials: 'SX', color: '#E49BC3', kind: 'Videos' },
  hentaihaven: { initials: 'HH', color: '#AC9BEB', kind: 'Videos' },
  nhentai: { initials: 'nH', color: '#F08EA6', kind: 'Manga' },
};

export function sourcePresentation(source: BooruSource) {
  return BRANDS[source.id] ?? { initials: source.name.slice(0, 2).toUpperCase(), color: '#A6A8BE', kind: 'Images' as SourceKind };
}

export function SourceMark({ source, large = false }: { source: BooruSource; large?: boolean }) {
  const brand = sourcePresentation(source);
  return <View style={[styles.mark, { backgroundColor: `${brand.color}14` }, large && styles.markLarge]}>
    <Text style={[styles.initials, { color: brand.color }, large && styles.initialsLarge]}>{brand.initials}</Text>
  </View>;
}

interface SourceCatalogProps {
  activeSource: BooruSource;
  onSelect: (source: BooruSource) => void | Promise<void>;
  onConfigure?: (source: BooruSource) => void;
  credentials?: Partial<Record<string, boolean>>;
  busy?: boolean;
}

/** Shared by Settings and the search filter; hidden sources stay hidden in both. */
export const SourceCatalog: React.FC<SourceCatalogProps> = ({ activeSource, onSelect, onConfigure, credentials, busy }) => {
  const sources = AVAILABLE_SOURCES.filter((source) => !source.hidden);

  return <View style={styles.catalog}>
    <View style={styles.countRow}>
      <Text style={styles.count}>{sources.length} {sources.length === 1 ? 'SOURCE' : 'SOURCES'}</Text>
      <Text style={styles.hint}>Tap to switch</Text>
    </View>
    {sources.map((source) => {
      const selected = activeSource.id === source.id;
      const needsKey = source.id === 'rule34' && credentials?.rule34 === false;
      return <View key={source.id} style={[styles.source, selected && styles.sourceSelected]}>
        <TouchableOpacity accessibilityRole="radio" accessibilityState={{ selected, disabled: !!busy }}
          accessibilityLabel={`Use ${source.name}`} disabled={busy} onPress={() => onSelect(source)} activeOpacity={0.7} style={styles.select}>
          <SourceMark source={source} />
          <View style={styles.info}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{source.name}</Text>
              {selected && <View style={styles.activeBadge}><Text style={styles.activeText}>ACTIVE</Text></View>}
            </View>
            <Text style={styles.description} numberOfLines={1}>{sourcePresentation(source).kind} · {source.baseUrl.replace(/^https?:\/\//, '')}</Text>
            {needsKey && <Text style={styles.keyHint}>API key required</Text>}
          </View>
          <View style={[styles.radio, selected && styles.radioSelected]}>{selected && <Check size={10} color="#FFF" strokeWidth={3} />}</View>
        </TouchableOpacity>
        {onConfigure && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${source.name} settings`}
          onPress={() => onConfigure(source)} style={styles.configure} hitSlop={4}>
          <Settings2 size={18} color={Colors.dark.textSecondary} />
        </TouchableOpacity>}
      </View>;
    })}
  </View>;
};

const styles = StyleSheet.create({
  catalog: { gap: 6 },
  countRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, marginBottom: 2 },
  count: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.dark.textSecondary },
  hint: { fontSize: 11, color: Colors.dark.textMuted },
  source: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: Colors.dark.cardBorder, backgroundColor: Colors.dark.card },
  sourceSelected: { borderColor: '#6366F177', backgroundColor: '#181B30' },
  select: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, minHeight: 54 },
  mark: { width: 30, height: 30, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  markLarge: { width: 60, height: 60, borderRadius: 18 },
  initials: { fontSize: 12, fontWeight: '800', letterSpacing: -0.5 },
  initialsLarge: { fontSize: 22 },
  info: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { fontSize: 13, fontWeight: '600', color: Colors.dark.text },
  activeBadge: { backgroundColor: '#818CF818', borderRadius: 4, paddingVertical: 2, paddingHorizontal: 4 },
  activeText: { color: '#A6ACFF', fontSize: 8, letterSpacing: 0.7, fontWeight: '800' },
  description: { color: Colors.dark.textSecondary, fontSize: 10, lineHeight: 14 },
  keyHint: { color: '#E9B368', fontSize: 10 },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: '#3A3F52', alignItems: 'center', justifyContent: 'center' },
  radioSelected: { backgroundColor: Colors.dark.primary, borderColor: Colors.dark.primary },
  configure: { minHeight: 44, width: 40, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: Colors.dark.divider, marginRight: 4 },
});
