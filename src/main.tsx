import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { appStorage, initializeAppStorage } from './lib/appStorage';

declare global {
  interface Window {
    __JADHUMAN_SAFE_AREA_REQUIRED__?: boolean;
    __JADHUMAN_SAFE_AREA_READY__?: boolean;
  }
}

// Silently swallow benign HMR and WebSocket errors to keep the UX clean
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason?.message || String(event.reason || '');
    if (
      reason.includes('WebSocket') || 
      reason.includes('websocket') || 
      reason.includes('vite') ||
      reason.includes('HMR')
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  window.addEventListener('error', (event) => {
    const msg = event.message || '';
    if (
      msg.includes('WebSocket') || 
      msg.includes('websocket') || 
      msg.includes('vite') ||
      msg.includes('HMR')
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
const applyStoredTheme = () => {
  const savedTheme = appStorage.getItem('theme');
  if (!savedTheme) return;

  const isDark = savedTheme === 'dark';
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.classList.toggle('light', !isDark);
  document.body.style.background = isDark ? '#0B1120' : '#F8FAFC';
  document.getElementById('theme-color-meta')?.setAttribute('content', isDark ? '#0B1120' : '#F8FAFC');
  const nativeBridge = (window as any).AndroidJadhuman;
  if (typeof nativeBridge?.setTheme === 'function') nativeBridge.setTheme(isDark);
};

const waitForNativeSafeArea = async () => {
  if (!window.__JADHUMAN_SAFE_AREA_REQUIRED__ || window.__JADHUMAN_SAFE_AREA_READY__) return;

  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('jadhuman-safe-area-ready', onReady);
      console.error('[android] Safe area belum terkonfirmasi setelah 10 detik; melanjutkan startup.');
      resolve();
    }, 10_000);
    const onReady = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    window.addEventListener('jadhuman-safe-area-ready', onReady, { once: true });
    if (window.__JADHUMAN_SAFE_AREA_READY__) onReady();
  });
};

const renderApp = async () => {
  applyStoredTheme();
  await waitForNativeSafeArea();
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

  const fadeTimer = window.setTimeout(() => {
    document.getElementById('boot-splash')?.classList.add('boot-splash-hidden');
  }, 520);
  window.setTimeout(() => {
    document.getElementById('boot-splash')?.remove();
    window.clearTimeout(fadeTimer);
  }, 800);
};

void initializeAppStorage().then(renderApp).catch((error) => {
  console.error('[appStorage] Startup initialization failed:', error);
  renderApp();
});
