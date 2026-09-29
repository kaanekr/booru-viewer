import { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';

// Bir AppState aboneliği: her kart için ayrı native abonelik oluşturma.
export const MediaPlaybackContext = createContext(true);

export function useAppForeground(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);
  return active;
}

export function useMediaPlaybackAllowed(): boolean {
  return useContext(MediaPlaybackContext);
}
