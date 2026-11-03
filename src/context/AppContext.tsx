import React, { createContext, useContext, useState, ReactNode } from 'react';
import { getTodayWIB } from '../lib/dateFormatter';
import type { UserRole, TabPermissions, UserAccountSafe } from '../lib/userManager';
import { DEFAULT_ADMIN_PERMISSIONS, normalizeUserPermissions } from '../lib/userManager';
import { clearServerLoginCache } from '../lib/cacheManager';
import { appStorage } from '../lib/appStorage';
import {
  loadSession,
  saveSession,
  clearAuthSessions,
  UNAUTHENTICATED_PERMISSIONS,
} from '../lib/sessionManager';

export interface InstansiLogState {
  dateStart: string;
  dateEnd: string;
  unorCode: string;
  selectedOPD: any | null;
  searchOPD: string;
  searchQuery: string;
  currentPage: number;
  pageSize: number;
  logs: any[];
  totalElements: number;
  totalPages: number;
  hasLoadedOnce: boolean;
}

interface PegawaiData {
  id?: string;
  nama?: string;
  nip?: string;
  nama_jabatan?: string;
  kelas_jabatan?: string;
  nama_instansi?: string;
  nama_lokasi?: string;
  foto?: string;
  password?: string;
  kode_unor?: string;
  alamat_kantor?: string;
  alamat?: string;
  unor?: string;
  nama_unit_kerja?: string;
  message?: string;
}

interface KredensialConfig {
  idPegawai: string;
  deviceId: string;
  latitude: string;
  longitude: string;
  idLokasi: string;
  kodeInstansi: string;
  kodeUnor: string;
  workMode: string;
  versi: string;
}

interface AppContextType {
  pegawai: PegawaiData | null;
  setPegawai: (data: PegawaiData | null | ((prev: PegawaiData | null) => PegawaiData | null)) => void;
  config: KredensialConfig;
  setConfig: React.Dispatch<React.SetStateAction<KredensialConfig>>;
  loginForm: { username: string, password: string };
  setLoginForm: React.Dispatch<React.SetStateAction<{ username: string, password: string }>>;
  developerMode: boolean;
  setDeveloperMode: (val: boolean) => void;
  datePickerStyle: 'modern' | 'klasik';
  setDatePickerStyle: (val: 'modern' | 'klasik') => void;
  activePage: string;
  setActivePage: (page: string) => void;
  instansiLogState: InstansiLogState;
  setInstansiLogState: React.Dispatch<React.SetStateAction<InstansiLogState>>;
  // Auth user system
  currentUser: UserAccountSafe | null;
  setCurrentUser: (user: UserAccountSafe | null) => void;
  userRole: UserRole;
  tabPermissions: TabPermissions;
  setTabPermissions: (perms: TabPermissions) => void;
  // Trigger auto-login ke server pusat setelah login akun Jadhuman
  autoLoginTrigger: number;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  // ── Restore sesi persistent di Tauri, per-tab di browser ────────────────
  const initialSession = loadSession();
  const isTauriRuntime = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

  const [currentUser, setCurrentUserState] = useState<UserAccountSafe | null>(() => {
    return initialSession?.currentUser ?? null;
  });
  const currentUserRef = React.useRef<UserAccountSafe | null>(currentUser);

  // ⚠️ SECURITY: default WAJIB UNAUTHENTICATED_PERMISSIONS (semua false),
  // bukan DEFAULT_ADMIN_PERMISSIONS. Saat belum login = tidak ada hak akses.
  const [tabPermissions, setTabPermissionsState] = useState<TabPermissions>(() => {
    if (!initialSession) return UNAUTHENTICATED_PERMISSIONS;
    return normalizeUserPermissions(initialSession.tabPermissions as unknown as Record<string, unknown>);
  });

  // Pulihkan juga login server ketika sesi Tauri dipulihkan saat startup.
  const [autoLoginTrigger, setAutoLoginTrigger] = useState(initialSession && isTauriRuntime ? 1 : 0);

  // ⚠️ SECURITY: userRole HARUS 'user' saat currentUser null (belum login).
  // Sebelumnya 'admin' — ini sumber utama bug privilege escalation.
  const userRole: UserRole = currentUser?.role ?? 'user';

  React.useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  const [pegawai, setPegawaiState] = useState<PegawaiData | null>(null);

  const setPegawai = (data: PegawaiData | null | ((prev: PegawaiData | null) => PegawaiData | null)) => {
    setPegawaiState(prev => {
      const next = typeof data === 'function' ? (data as (prev: PegawaiData | null) => PegawaiData | null)(prev) : data;
      return next;
    });
  };

  const [loginForm, setLoginFormState] = useState({ username: '', password: '' });

  const setLoginForm: React.Dispatch<React.SetStateAction<{ username: string, password: string }>> = (value) => {
    setLoginFormState((prev: any) => {
      const next = typeof value === 'function' ? (value as any)(prev) : value;
      return next;
    });
  };

  const [configState, setConfigState] = useState<KredensialConfig>({
    idPegawai: '',
    deviceId: '',
    latitude: '',
    longitude: '',
    idLokasi: '',
    kodeInstansi: '',
    kodeUnor: '',
    workMode: '1',
    versi: '2.0.0'
  });

  const setConfig: React.Dispatch<React.SetStateAction<KredensialConfig>> = (value) => {
    setConfigState((prev: any) => {
      const next = typeof value === 'function' ? (value as any)(prev) : value;
      return next;
    });
  };

  const setCurrentUser = (user: UserAccountSafe | null) => {
    if (!user) {
      // Logout — bersihkan semua data
      clearAuthSessions();
      setPegawaiState(null);
      setLoginFormState({ username: '', password: '' });
      setConfigState({
        idPegawai: '', deviceId: '', latitude: '', longitude: '',
        idLokasi: '', kodeInstansi: '', kodeUnor: '', workMode: '1', versi: '2.0.0'
      });
      setCurrentUserState(null);
      // ⚠️ Reset ke UNAUTHENTICATED — bukan DEFAULT_ADMIN_PERMISSIONS!
      setTabPermissionsState(UNAUTHENTICATED_PERMISSIONS);
      return;
    }

    // Ganti akun: hapus cache akun sebelumnya
    const prevUsername = currentUserRef.current?.username ?? '';
    const nextUsername = user.username ?? '';
    if (prevUsername && prevUsername !== nextUsername) {
      clearServerLoginCache(prevUsername);
    }

    // Reset data server pusat
    setPegawaiState(null);
    setLoginFormState({ username: '', password: '' });
    setConfigState({
      idPegawai: '', deviceId: '', latitude: '', longitude: '',
      idLokasi: '', kodeInstansi: '', kodeUnor: '', workMode: '1', versi: '2.0.0'
    });

    // Admin selalu dapat full permissions, user dari Firestore
    const perms: TabPermissions =
      user.role === 'admin'
        ? DEFAULT_ADMIN_PERMISSIONS
        : normalizeUserPermissions(user.permissions as unknown as Record<string, unknown>);

    setCurrentUserState(user);
    setTabPermissionsState(perms);
    saveSession(user, perms);
    // Increment trigger → App.tsx akan menjalankan autoLogin
    setAutoLoginTrigger(prev => prev + 1);
  };

  const setTabPermissions = (perms: TabPermissions) => {
    setTabPermissionsState(perms);
    if (currentUser) {
      saveSession(currentUser, perms);
    }
  };

  const PATH_MAP: Record<string, string> = {
    'tabLogin': '/login-info',
    'tabAbsen': '/submit-presensi',
    'tabLog': '/history-presensi',
    'tabInputAktivitas': '/produktivitas-harian',
    'tabAktivitas': '/history-produktivitas',
    'tabIzin': '/izin-cuti',
    'tabReview': '/review-produktivitas',
    'tabLogPresensiInstansi': '/history-presensi-instansi',
    'tabDatabase': '/database-pegawai',
    'tabUnor': '/struktur-organisasi',
    'tabReport': '/laporan',
    'tabAutomasi': '/preset-automasi',
  };

  const getPageFromPath = (path: string): string => {
    for (const [tabId, p] of Object.entries(PATH_MAP)) {
      if (path === p) return tabId;
    }
    return 'tabLogin';
  };

  const [activePage, setActivePageState] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return getPageFromPath(window.location.pathname);
    }
    return 'tabLogin';
  });

  const setActivePage = (pageId: string) => {
    setActivePageState(pageId);
    if (typeof window !== 'undefined') {
      const path = PATH_MAP[pageId] || '/login-info';
      if (window.location.pathname !== path) {
        window.history.pushState(null, '', path);
      }
    }
  };

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleLocationChange = () => {
      const pageId = getPageFromPath(window.location.pathname);
      setActivePageState(pageId);
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const [developerMode, setDeveloperModeState] = useState<boolean>(() => {
    return appStorage.getItem('developerMode') === 'true';
  });

  const setDeveloperMode = (val: boolean) => {
    setDeveloperModeState(val);
    appStorage.setItem('developerMode', val ? 'true' : 'false');
  };

  const [datePickerStyle, setDatePickerStyleState] = useState<'modern' | 'klasik'>(() => {
    const saved = appStorage.getItem('datePickerStyle');
    return (saved === 'klasik' || saved === 'modern') ? saved : 'modern';
  });

  const setDatePickerStyle = (val: 'modern' | 'klasik') => {
    setDatePickerStyleState(val);
    appStorage.setItem('datePickerStyle', val);
  };

  const [instansiLogState, setInstansiLogState] = useState<InstansiLogState>(() => {
    return {
      dateStart: getTodayWIB(),
      dateEnd: getTodayWIB(),
      unorCode: '',
      selectedOPD: null,
      searchOPD: '',
      searchQuery: '',
      currentPage: 1,
      pageSize: 10,
      logs: [],
      totalElements: 0,
      totalPages: 0,
      hasLoadedOnce: false
    };
  });

  React.useEffect(() => {
    if (configState.kodeInstansi || configState.kodeUnor) {
      setInstansiLogState(prev => {
        if (!prev.hasLoadedOnce && !prev.unorCode) {
          return {
            ...prev,
            unorCode: configState.kodeInstansi || configState.kodeUnor || '5.19.00.00.00'
          };
        }
        return prev;
      });
    }
  }, [configState.kodeInstansi, configState.kodeUnor]);

  return (
    <AppContext.Provider value={{
      pegawai,
      setPegawai,
      config: configState,
      setConfig,
      loginForm,
      setLoginForm,
      developerMode,
      setDeveloperMode,
      datePickerStyle,
      setDatePickerStyle,
      activePage,
      setActivePage,
      instansiLogState,
      setInstansiLogState,
      currentUser,
      setCurrentUser,
      userRole,
      tabPermissions,
      setTabPermissions,
      autoLoginTrigger,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
