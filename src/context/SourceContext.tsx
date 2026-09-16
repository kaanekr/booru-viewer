import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { BooruSource } from '../types/booru';
import { DEFAULT_SOURCE } from '../services/sources';
import { booruApi } from '../services/booruApi';
import { StorageService } from '../services/storage';

interface SourceContextValue {
  activeSource: BooruSource;
  selectSource: (source: BooruSource) => Promise<void>;
}

const SourceContext = createContext<SourceContextValue>({
  activeSource: DEFAULT_SOURCE,
  selectSource: async () => {},
});

export const useSource = () => useContext(SourceContext);

export const SourceProvider: React.FC<{
  initialSource: BooruSource;
  children: React.ReactNode;
}> = ({ initialSource, children }) => {
  const [activeSource, setActiveSource] = useState<BooruSource>(initialSource);

  useEffect(() => {
    setActiveSource(initialSource);
    booruApi.setSource(initialSource);
  }, [initialSource]);

  const selectSource = useCallback(async (source: BooruSource) => {
    setActiveSource(source);
    booruApi.setSource(source);
    await StorageService.setActiveSourceId(source.id);
  }, []);

  return (
    <SourceContext.Provider value={{ activeSource, selectSource }}>
      {children}
    </SourceContext.Provider>
  );
};
