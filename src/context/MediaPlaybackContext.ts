import { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';

// A single AppState subscription: no separate native subscription per card.
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
