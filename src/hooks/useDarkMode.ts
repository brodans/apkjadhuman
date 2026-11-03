import { useState, useEffect } from 'react';
import { appStorage } from '../lib/appStorage';

export function useDarkMode() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const saved = appStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = window.document.documentElement;
    const metaThemeColor = document.getElementById('theme-color-meta') || document.querySelector('meta[name="theme-color"]');
    
    if (isDarkMode) {
      root.classList.add('dark');
      root.classList.remove('light');
      appStorage.setItem('theme', 'dark');
      if (metaThemeColor) metaThemeColor.setAttribute('content', '#0B1120');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
      appStorage.setItem('theme', 'light');
      if (metaThemeColor) metaThemeColor.setAttribute('content', '#F8FAFC');
    }

    const nativeBridge = (window as any).AndroidJadhuman;
    if (typeof nativeBridge?.setTheme === 'function') nativeBridge.setTheme(isDarkMode);
  }, [isDarkMode]);

  const toggleDarkMode = () => setIsDarkMode(prev => !prev);

  return { isDarkMode, toggleDarkMode };
}
