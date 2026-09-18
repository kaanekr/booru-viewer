import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { BooruSource } from '../types/booru';
import { AVAILABLE_SOURCES, DEFAULT_SOURCE } from '../services/sources';
import { booruApi } from '../services/booruApi';
import { StorageService } from '../services/storage';

interface SourceContextValue {
  activeSource: BooruSource;
  selectSource: (source: BooruSource) => Promise<void>;
  isReady: boolean;
  init: () => Promise<void>;
}

const SourceContext = createContext<SourceContextValue>({
  activeSource: DEFAULT_SOURCE,
  selectSource: async () => {},
  isReady: false,
  init: async () => {},
});

export const useSource = () => useContext(SourceContext);

export const SourceProvider: React.FC<{
  initialSource?: BooruSource;
  children: React.ReactNode;
}> = ({ initialSource, children }) => {
  const [activeSource, setActiveSource] = useState<BooruSource>(initialSource || DEFAULT_SOURCE);
  const [isReady, setIsReady] = useState(false);

  const init = useCallback(async () => {
    try {
      const savedId = await StorageService.getActiveSourceId();
      const found = AVAILABLE_SOURCES.find((s) => s.id === savedId) || initialSource || DEFAULT_SOURCE;
      setActiveSource(found);
      booruApi.setSource(found);
    } catch {
      const fallback = initialSource || DEFAULT_SOURCE;
      setActiveSource(fallback);
      booruApi.setSource(fallback);
    } finally {
      setIsReady(true);
    }
  }, [initialSource]);

  useEffect(() => {
    init();
  }, [init]);

  const selectSource = useCallback(async (source: BooruSource) => {
    setActiveSource(source);
    booruApi.setSource(source);
    await StorageService.setActiveSourceId(source.id);
  }, []);

  return (
    <SourceContext.Provider value={{ activeSource, selectSource, isReady, init }}>
      {children}
    </SourceContext.Provider>
  );
};

