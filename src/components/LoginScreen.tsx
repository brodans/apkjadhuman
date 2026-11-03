import React, { useState, useEffect, useReducer, useRef } from 'react';
import {
  Lock, LogIn, AlertCircle,
  Eye, EyeOff, Clock, CheckCircle2,
  Sun, Moon, User, ShieldAlert,
  Hexagon
} from 'lucide-react';
import { verifyPinLayered, decryptAppCredential } from '../lib/encryption';
import { db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { verifyUserPassword, sanitizeString, DEFAULT_ADMIN_PERMISSIONS } from '../lib/userManager';
import type { UserAccountSafe, TabPermissions } from '../lib/userManager';
import { useAppContext } from '../context/AppContext';
import { createAdminUserAccount, clearSessionByRole } from '../lib/sessionManager';
import { appStorage } from '../lib/appStorage';

interface LoginScreenProps {
  onLogin: () => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
}

// ─── Rate limiting ───────────────────────────────────────────────
const MAX_ATTEMPTS      = 5;
const COOLDOWN_MS       = 5 * 60 * 1000;
const MAX_USERNAME_LEN  = 32;
const MAX_PASSWORD_LEN  = 128;
const MIN_AUTH_DELAY_MS = 800; // timing-safe minimum response
const LS_ATTEMPTS       = 'jadhuman_login_attempts';
const LS_COOLDOWN       = 'jadhuman_cooldown_until';

// ─── Auth reducer ────────────────────────────────────────────────
type AuthStatus = 'IDLE' | 'AUTHENTICATING' | 'LOCKED' | 'SUCCESS';

interface AuthState {
  status: AuthStatus;
  username: string;
  pin: string;
  attempts: number;
  cooldownUntil: number | null;
  errorMessage: string | null;
}

type AuthAction =
  | { type: 'SET_USERNAME'; payload: string }
  | { type: 'SET_PIN'; payload: string }
  | { type: 'START_AUTH' }
  | { type: 'AUTH_SUCCESS' }
  | { type: 'AUTH_FAILED'; payload: { attempts: number; cooldownUntil?: number; errorMsg: string } }
  | { type: 'UPDATE_COOLDOWN'; payload: number | null };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SET_USERNAME':
      return { ...state, username: action.payload.substring(0, MAX_USERNAME_LEN) };
    case 'SET_PIN':
      return { ...state, pin: action.payload.substring(0, MAX_PASSWORD_LEN) };
    case 'START_AUTH':
      return { ...state, status: 'AUTHENTICATING', errorMessage: null };
    case 'AUTH_SUCCESS':
      return { ...state, status: 'SUCCESS', pin: '', errorMessage: null };
    case 'AUTH_FAILED':
      return {
        ...state,
        status: action.payload.cooldownUntil ? 'LOCKED' : 'IDLE',
        attempts: action.payload.attempts,
        cooldownUntil: action.payload.cooldownUntil ?? state.cooldownUntil,
        errorMessage: action.payload.errorMsg,
        pin: '',
      };
    case 'UPDATE_COOLDOWN':
      return {
        ...state,
        cooldownUntil: action.payload,
        status: action.payload && action.payload > Date.now() ? 'LOCKED' : 'IDLE',
      };
    default:
      return state;
  }
}

// ─── Input sanitizers ────────────────────────────────────────────
function sanitizeUsername(val: string): string {
  return sanitizeString(val, MAX_USERNAME_LEN).toLowerCase().replace(/\s/g, '');
}
function sanitizePassword(val: string): string {
  return val.replace(/[\x00-\x1F\x7F]/g, '').substring(0, MAX_PASSWORD_LEN);
}

// ─── Main Component ──────────────────────────────────────────────
export default function LoginScreen({ onLogin, isDarkMode, toggleDarkMode }: LoginScreenProps) {
  const { setCurrentUser, setTabPermissions } = useAppContext();

  const [state, dispatch] = useReducer(authReducer, {
    status: 'IDLE', username: '', pin: '',
    attempts: 0, cooldownUntil: null, errorMessage: null,
  });

  const [showPin, setShowPin] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [credentialFocused, setCredentialFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const authInFlight = useRef(false);
  const keyboardBlurTimer = useRef<number | null>(null);
  const loginScreenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const screen = loginScreenRef.current;
    const viewport = window.visualViewport;
    if (!screen || !viewport || !document.body.classList.contains('is-native')) return;

    let fullViewportHeight = viewport.height;
    let orientationFrame = 0;
    const syncViewportHeight = () => {
      screen.style.setProperty('--login-viewport-top', `${viewport.offsetTop}px`);
      screen.style.setProperty('--login-viewport-height', `${viewport.height}px`);
      setKeyboardVisible(viewport.height < fullViewportHeight - 120 || viewport.offsetTop > 24);
    };
    const resetViewportBaseline = () => {
      orientationFrame = window.requestAnimationFrame(() => {
        fullViewportHeight = viewport.height;
        syncViewportHeight();
      });
    };

    syncViewportHeight();
    viewport.addEventListener('resize', syncViewportHeight);
    viewport.addEventListener('scroll', syncViewportHeight);
    window.addEventListener('resize', syncViewportHeight);
    window.addEventListener('orientationchange', resetViewportBaseline);

    return () => {
      viewport.removeEventListener('resize', syncViewportHeight);
      viewport.removeEventListener('scroll', syncViewportHeight);
      window.removeEventListener('resize', syncViewportHeight);
      window.removeEventListener('orientationchange', resetViewportBaseline);
      window.cancelAnimationFrame(orientationFrame);
      screen.style.removeProperty('--login-viewport-top');
      screen.style.removeProperty('--login-viewport-height');
      if (keyboardBlurTimer.current !== null) window.clearTimeout(keyboardBlurTimer.current);
    };
  }, []);

  const handleLoginInputFocus = () => {
    if (keyboardBlurTimer.current !== null) window.clearTimeout(keyboardBlurTimer.current);
    setCredentialFocused(true);
  };

  const handleLoginInputBlur = () => {
    if (keyboardBlurTimer.current !== null) window.clearTimeout(keyboardBlurTimer.current);
    keyboardBlurTimer.current = window.setTimeout(() => {
      const activeElement = document.activeElement;
      if (activeElement?.id !== 'login-username' && activeElement?.id !== 'login-password') {
        setCredentialFocused(false);
      }
    }, 180);
  };

  // ── Restore lockout dari IndexedDB ────────────────────────────
  useEffect(() => {
    const savedAttempts = parseInt(appStorage.getItem(LS_ATTEMPTS) || '0', 10);
    const savedCooldown = parseInt(appStorage.getItem(LS_COOLDOWN) || '0', 10);
    if (savedCooldown && savedCooldown > Date.now()) {
      dispatch({ type: 'AUTH_FAILED', payload: { attempts: savedAttempts, cooldownUntil: savedCooldown, errorMsg: 'Sistem terkunci sementara.' } });
    } else if (savedAttempts > 0) {
      appStorage.setItem(LS_ATTEMPTS, '0');
      appStorage.removeItem(LS_COOLDOWN);
    }
  }, []);

  // ── Countdown ─────────────────────────────────────────────────
  useEffect(() => {
    let iv: NodeJS.Timeout;
    if (state.cooldownUntil && state.cooldownUntil > Date.now()) {
      iv = setInterval(() => {
        const rem = Math.ceil((state.cooldownUntil! - Date.now()) / 1000);
        if (rem <= 0) {
          setTimeLeft(0);
          dispatch({ type: 'UPDATE_COOLDOWN', payload: null });
          appStorage.removeItem(LS_COOLDOWN);
          appStorage.setItem(LS_ATTEMPTS, '0');
        } else setTimeLeft(rem);
      }, 1000);
    }
    return () => clearInterval(iv);
  }, [state.cooldownUntil]);

  const fmtTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  // ── Auth handler ───────────────────────────────────────────────
  const handleAuthentication = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (authInFlight.current) return;
    if (state.status === 'LOCKED' || state.cooldownUntil) {
      dispatch({ type: 'AUTH_FAILED', payload: { attempts: state.attempts, errorMsg: `Akses ditolak. Tunggu ${fmtTime(timeLeft)}.` } });
      return;
    }

    const uname = sanitizeUsername(state.username);
    const pass  = sanitizePassword(state.pin);

    if (!uname || !pass) {
      dispatch({ type: 'AUTH_FAILED', payload: { attempts: state.attempts, errorMsg: 'ID pengguna dan kata sandi wajib diisi.' } });
      return;
    }

    authInFlight.current = true;
    dispatch({ type: 'START_AUTH' });
    const t0 = Date.now();

    try {
      let authenticated = false;
      let loginAsUser: UserAccountSafe | null = null;
      let loginPermissions: TabPermissions = DEFAULT_ADMIN_PERMISSIONS;

      const authRef = doc(db, 'settings', 'auth');
      const authSnap = await getDoc(authRef);

      if (authSnap.exists()) {
        const data = authSnap.data();

        const storedAdminUser = typeof data.adminUsername === 'string'
          ? data.adminUsername.toLowerCase().trim()
          : '';

        const usernameOk = storedAdminUser
          ? uname === storedAdminUser
          : !uname; 

        if (usernameOk) {
          if (data.pinEncrypted) {
            try {
              const dec = decryptAppCredential(data.pinEncrypted);
              if (dec && dec === pass) authenticated = true;
            } catch { /* ignore */ }
          }
          if (!authenticated && data.pinHash) {
            if (verifyPinLayered(pass, data.pinHash)) authenticated = true;
          }
        }

        if (authenticated) {
          loginAsUser = null;
          loginPermissions = DEFAULT_ADMIN_PERMISSIONS;
        }
      }

      if (!authenticated && uname) {
        const userSafe = await verifyUserPassword(uname, pass);
        if (userSafe) {
          authenticated = true;
          loginAsUser = userSafe;
          loginPermissions = userSafe.permissions;
        }
      }

      const elapsed = Date.now() - t0;
      if (elapsed < MIN_AUTH_DELAY_MS) {
        await new Promise(r => setTimeout(r, MIN_AUTH_DELAY_MS - elapsed));
      }

      if (authenticated) {
        appStorage.setItem(LS_ATTEMPTS, '0');
        appStorage.removeItem(LS_COOLDOWN);

        if (!loginAsUser) {
          loginAsUser = createAdminUserAccount(uname || 'admin');
        }

        const oppositeRole = loginAsUser.role === 'admin' ? 'user' : 'admin';
        clearSessionByRole(oppositeRole);

        setCurrentUser(loginAsUser);
        setTabPermissions(loginPermissions);
        dispatch({ type: 'AUTH_SUCCESS' });
        setTimeout(() => onLogin(), 900);
      } else {
        throw new Error('invalid_credentials');
      }

    } catch {
      const elapsed = Date.now() - t0;
      if (elapsed < MIN_AUTH_DELAY_MS) {
        await new Promise(r => setTimeout(r, MIN_AUTH_DELAY_MS - elapsed));
      }
      const nextAttempts = state.attempts + 1;
      appStorage.setItem(LS_ATTEMPTS, String(nextAttempts));
      if (nextAttempts >= MAX_ATTEMPTS) {
        const lockUntil = Date.now() + COOLDOWN_MS;
        appStorage.setItem(LS_COOLDOWN, String(lockUntil));
        dispatch({ type: 'AUTH_FAILED', payload: { attempts: nextAttempts, cooldownUntil: lockUntil, errorMsg: 'Terlalu banyak percobaan gagal. Sistem dikunci.' } });
      } else {
        dispatch({ type: 'AUTH_FAILED', payload: { attempts: nextAttempts, errorMsg: `Kredensial salah. ${MAX_ATTEMPTS - nextAttempts} percobaan tersisa.` } });
      }
    } finally {
      authInFlight.current = false;
    }
  };

  const isLocked  = state.status === 'LOCKED';
  const isAuthing = state.status === 'AUTHENTICATING';
  const canSubmit = !isLocked && !isAuthing && sanitizeUsername(state.username).length > 0 && sanitizePassword(state.pin).length > 0;

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <div ref={loginScreenRef} className={`login-screen fixed inset-x-0 top-0 z-40 h-[100dvh] flex items-center [justify-content:safe_center] p-4 sm:p-8 font-sans transition-colors duration-500 bg-slate-200/80 dark:bg-[#0a0f1c] overflow-x-hidden overflow-y-auto selection:bg-indigo-500/30${keyboardVisible ? ' login-keyboard-open' : ''}`}>
      
      {/* ─── Background Grid & Ambient Glow ─── */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        {/* Latar belakang kotak-kotak (SaaS Grid) */}
        <div className="login-grid-mask absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] dark:bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)]" />
        
        {/* Glow ambient */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 rounded-full bg-indigo-500/10 dark:bg-indigo-500/20 blur-3xl" />
      </div>

      {/* ─── Theme Toggle ─── */}
      <div className="login-theme-toggle absolute top-6 right-6 z-20">
        <button
          onClick={toggleDarkMode}
          className="p-3 rounded-xl bg-white/60 dark:bg-slate-900/60 backdrop-blur-md border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-white transition-all duration-300 active:scale-95 group"
          aria-label="Toggle tema"
        >
          {isDarkMode ? (
            <Sun className="w-5 h-5 group-hover:rotate-45 transition-transform duration-500" />
          ) : (
            <Moon className="w-5 h-5 group-hover:-rotate-12 transition-transform duration-500" />
          )}
        </button>
      </div>

      {/* ─── Main Glassmorphism Card ─── */}
      <div className={`login-card relative z-10 w-full max-w-[26rem] ${credentialFocused && keyboardVisible ? 'translate-y-2' : ''} sm:translate-y-0 bg-white/95 dark:bg-slate-900/75 backdrop-blur-xl border border-slate-200/90 dark:border-slate-700/60 rounded-[2rem] shadow-2xl shadow-slate-900/10 dark:shadow-slate-950/50 overflow-hidden`}>
        
        {/* Pendaran subtle di dalam kartu */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent" />

        {/* ─── Branding & Header ─── */}
        <div className="px-8 pt-10 pb-6 text-center relative">
          <div className="relative inline-flex items-center justify-center w-20 h-20 mb-6 group">
            <div className="absolute inset-0 bg-indigo-500/20 dark:bg-indigo-500/30 rounded-full rotate-6 group-hover:rotate-12 transition-transform duration-500" />
            <div className="absolute inset-0 bg-emerald-500/20 dark:bg-emerald-500/30 rounded-full -rotate-6 group-hover:-rotate-12 transition-transform duration-500" />
            <div className="relative flex items-center justify-center w-full h-full bg-slate-100 dark:bg-slate-900 rounded-full border border-slate-200 dark:border-slate-700 shadow-sm p-1.5 overflow-hidden">
              {/* Logo aplikasi; fallback ke ikon modern bila gambar gagal dimuat */}
              <img src="/assets/icon-192.png" alt="Jadhuman Logo" className="h-full w-full scale-110 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />
              <Hexagon className="hidden w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 tracking-tight">
            JADHUMAN
          </h1>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-2 uppercase tracking-[0.2em]">
            AYO JADHUM REK
          </p>
        </div>

        {/* ─── Form Section ─── */}
        <div className="px-8 pb-10 relative">

          {/* Success Overlay */}
          {state.status === 'SUCCESS' && (
            <div className="absolute inset-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm flex flex-col justify-center items-center rounded-b-[2rem] animate-in fade-in zoom-in-95 duration-300">
              <div className="w-20 h-20 bg-emerald-50 dark:bg-emerald-500/10 rounded-full flex items-center justify-center mb-6 ring-8 ring-emerald-50/50 dark:ring-emerald-500/5">
                <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Autentikasi Berhasil</h2>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 animate-pulse">Menyiapkan workspace...</p>
            </div>
          )}

          <form onSubmit={handleAuthentication} className="space-y-6" autoComplete="off">
            
            {/* Error/Lockout Alert */}
            {state.errorMessage && (
              <div className={`flex items-start gap-3 p-4 rounded-xl text-sm font-medium shadow-sm border animate-in fade-in slide-in-from-top-2 duration-300 ${
                isLocked
                  ? 'bg-red-50/80 border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400'
                  : 'bg-amber-50/80 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400'
              }`}>
                {isLocked ? <ShieldAlert className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
                <span className="leading-relaxed">{state.errorMessage}</span>
              </div>
            )}

            <div className="space-y-5">
              {/* Username Input */}
              <div className="space-y-2">
                <label htmlFor="login-username" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider ml-1">
                  ID Pengguna
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                    <User className="h-5 w-5" />
                  </div>
                  <input
                    id="login-username"
                    type="text"
                    value={state.username}
                    disabled={isLocked || isAuthing}
                    onChange={e => dispatch({ type: 'SET_USERNAME', payload: e.target.value })}
                    onFocus={handleLoginInputFocus}
                    onBlur={handleLoginInputBlur}
                    className="block w-full pl-11 pr-4 py-3.5 bg-white/50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:focus:border-indigo-500 transition-all disabled:opacity-50"
                    placeholder="Masukkan ID Anda"
                    autoComplete="username"
                  />
                </div>
              </div>

              {/* Password Input */}
              <div className="space-y-2">
                <div className="flex justify-between items-center ml-1">
                  <label htmlFor="login-password" className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                    Kata Sandi
                  </label>
                  {isLocked && (
                    <span className="text-[10px] font-bold text-red-600 dark:text-red-400 flex items-center gap-1 bg-red-100 dark:bg-red-500/20 px-2 py-1 rounded-md animate-pulse">
                      <Clock className="w-3 h-3" /> {fmtTime(timeLeft)}
                    </span>
                  )}
                </div>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                    <Lock className="h-5 w-5" />
                  </div>
                  <input
                    id="login-password"
                    type={showPin ? 'text' : 'password'}
                    value={state.pin}
                    disabled={isLocked || isAuthing}
                    onChange={e => dispatch({ type: 'SET_PIN', payload: e.target.value })}
                    onFocus={handleLoginInputFocus}
                    onBlur={handleLoginInputBlur}
                    className="block w-full pl-11 pr-12 py-3.5 bg-white/50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl text-base font-mono tracking-widest text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:focus:border-indigo-500 transition-all disabled:opacity-50"
                    placeholder={isLocked ? 'TERKUNCI' : '••••••••'}
                    autoComplete="current-password"
                  />
                  <div className="absolute inset-y-0 right-1 flex items-center pr-2">
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      disabled={isLocked || isAuthing}
                      className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-300 dark:hover:bg-slate-800 transition-all focus:outline-none"
                    >
                      {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!canSubmit}
              className={`relative w-full flex justify-center items-center gap-2 py-3.5 px-6 rounded-xl text-sm font-bold text-white transition-all duration-300 overflow-hidden ${
                isAuthing   
                  ? 'bg-indigo-500 cursor-wait'
                  : isLocked  
                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                  : !canSubmit 
                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 shadow-[0_8px_20px_rgb(79,70,229,0.25)] dark:shadow-[0_8px_20px_rgb(79,70,229,0.15)] hover:-translate-y-0.5 active:translate-y-0 group'
              }`}
            >
              {isAuthing ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Memverifikasi...</span>
                </>
              ) : isLocked ? (
                <>
                  <Lock className="w-5 h-5" />
                  <span>Akses Tertutup</span>
                </>
              ) : (
                <>
                  <span className="relative z-10">Masuk ke Sistem</span>
                  <LogIn className="w-5 h-5 relative z-10 transition-transform duration-300 group-hover:translate-x-1" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
