import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Lock,
  Save,
  AlertCircle,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Users,
  Settings,
  AtSign,
  Loader2,
  Trash2,
  Edit3,
  UserPlus,
  CheckCircle2,
} from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// Internal Imports
import {
  hashPinLayered,
  verifyPinLayered,
  encryptAppCredential,
  decryptAppCredential,
} from '../lib/encryption';
import { db } from '../lib/firebase';
import { useAppContext } from '../context/AppContext';
import { useBackButton } from '../hooks/useBackButton';
import ExifSuntikPanel from './ui/ExifSuntikPanel';
import {
  getExifSuntik, setExifSuntik, type ExifSuntikTarget, type ExifSuntikConfig,
} from '../lib/exifSuntik';
import {
  fetchAllUsers,
  createUserAccount,
  updateUserAccount,
  deleteUserAccount,
  DEFAULT_USER_PERMISSIONS,
  PERMISSION_GROUPS,
  TAB_PERMISSION_LABELS,
  validatePassword,
  verifyUserPassword,
  type UserAccountSafe,
  type TabPermissions,
} from '../lib/userManager';

// ─── Types & Constants ──────────────────────────────────────────────
interface SettingAkunModalProps {
  onClose: () => void;
}

type ModalTab = 'pengaturan' | 'pengguna';
type CredSection = 'none' | 'username' | 'password';
type UserFormMode = 'idle' | 'create' | 'edit';

const ADMIN_USERNAME_REGEX = /^[a-zA-Z0-9_.-]{2,32}$/;

// ─── Helpers ────────────────────────────────────────────────────────
function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  return fallback;
}

function validateAdminUsername(u: string): string {
  const trimmed = u.trim();
  if (!trimmed) throw new Error('Username tidak boleh kosong.');
  if (trimmed.length < 2 || trimmed.length > 32)
    throw new Error('Username harus 2–32 karakter.');
  if (!ADMIN_USERNAME_REGEX.test(trimmed))
    throw new Error('Username hanya boleh huruf, angka, _ . -');
  return trimmed.toLowerCase();
}

async function verifyAdminPassword(password: string): Promise<boolean> {
  const authRef = doc(db, 'settings', 'auth');
  const authSnap = await getDoc(authRef);

  if (!authSnap.exists()) return false;

  const data = authSnap.data();
  if (data.pinEncrypted) {
    try {
      const dec = decryptAppCredential(data.pinEncrypted);
      if (dec && dec === password) return true;
    } catch {
      /* ignore decryption error */
    }
  }
  if (data.pinHash && verifyPinLayered(password, data.pinHash)) return true;
  return false;
}

// ─── UI Styling Components ──────────────────────────────────────────
const userInputClass =
  'w-full px-4 py-2.5 border border-slate-200 dark:border-slate-700/80 rounded-xl bg-white dark:bg-slate-900/60 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none text-sm transition-all';

const credentialInputClass =
  'w-full pl-10 pr-12 py-2.5 border border-slate-200 dark:border-slate-700/80 rounded-xl bg-white dark:bg-slate-900/60 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none text-sm transition-all';

// ─── Sub-Component: User Management ────────────────────────────────
function UserManagement() {
  const [users, setUsers] = useState<UserAccountSafe[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<UserFormMode>('idle');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [form, setForm] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    permissions: { ...DEFAULT_USER_PERMISSIONS } as TabPermissions,
  });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const list = await fetchAllUsers();
      setUsers(list.sort((a, b) => a.username.localeCompare(b.username)));
    } catch (err) {
      setError(getErrorMessage(err, 'Gagal memuat pengguna.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const resetForm = () => {
    setMode('idle');
    setEditingId(null);
    setShowPassword(false);
    setShowConfirmPassword(false);
    setForm({
      username: '',
      password: '',
      confirmPassword: '',
      permissions: { ...DEFAULT_USER_PERMISSIONS },
    });
  };

  const saveUser = async () => {
    if (!form.username.trim()) return setError('Username wajib diisi.');
    if (!/^[a-z0-9_.-]+$/i.test(form.username))
      return setError('Username hanya boleh huruf, angka, _ . -');
    if (mode === 'create' && !form.password)
      return setError('Password wajib diisi.');
    if (form.password && form.password.length < 4)
      return setError('Password minimal 4 karakter.');
    if (
      (mode === 'create' || form.password) &&
      form.password !== form.confirmPassword
    )
      return setError('Konfirmasi password tidak cocok.');

    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'create') {
        await createUserAccount(
          form.username.trim().toLowerCase(),
          form.password,
          '',
          form.permissions
        );
        setMessage('Pengguna baru berhasil dibuat.');
      } else if (editingId) {
        await updateUserAccount(editingId, {
          username: form.username.trim().toLowerCase(),
          password: form.password || undefined,
          permissions: form.permissions,
        });
        setMessage('Data pengguna berhasil diperbarui.');
      }
      resetForm();
      await loadUsers();
    } catch (err) {
      setError(getErrorMessage(err, 'Gagal menyimpan pengguna.'));
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (user: UserAccountSafe) => {
    setMode('edit');
    setEditingId(user.id);
    setForm({
      username: user.username,
      password: '',
      confirmPassword: '',
      permissions: { ...user.permissions },
    });
    setError('');
    setMessage('');
  };

  const removeUser = async (id: string) => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await deleteUserAccount(id);
      setConfirmDelete(null);
      setMessage('Pengguna berhasil dihapus.');
      await loadUsers();
    } catch (err) {
      setError(getErrorMessage(err, 'Gagal menghapus pengguna.'));
    } finally {
      setSaving(false);
    }
  };

  const setAllPermissions = (value: boolean) => {
    setForm((prev) => {
      const nextPermissions = {
        ...prev.permissions,
      } as TabPermissions;

      (Object.keys(nextPermissions) as Array<keyof TabPermissions>).forEach((key) => {
        if (key !== 'tabLogin') {
          nextPermissions[key] = value;
        }
      });

      return {
        ...prev,
        permissions: nextPermissions,
      };
    });
  };

  const resetPermissionsToDefault = () => {
    setForm((prev) => ({
      ...prev,
      permissions: { ...DEFAULT_USER_PERMISSIONS },
    }));
  };

  return (
    <div className="space-y-4">
      {/* Header Controls */}
      <div className="flex items-center justify-between gap-3 pb-2 border-b border-slate-100 dark:border-slate-700/60">
        <span className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-500" /> Manajemen Pengguna
        </span>
        {mode === 'idle' && (
          <button
            type="button"
            onClick={() => {
              setMode('create');
              setError('');
              setMessage('');
            }}
            className="flex items-center gap-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 active:scale-95 text-white px-3 py-1.5 rounded-xl shadow-sm transition-all"
          >
            <UserPlus className="w-3.5 h-3.5" /> Tambah Akun
          </button>
        )}
      </div>

      {/* Alert Banners */}
      {error && (
        <div className="p-3 rounded-xl text-xs font-semibold bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/40 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {message && (
        <div className="p-3 rounded-xl text-xs font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {/* Form Tambah/Edit Pengguna */}
      {mode !== 'idle' && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 space-y-3.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-sm"
        >
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              {mode === 'create' ? 'Tambah Pengguna Baru' : 'Edit Pengguna'}
            </h3>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              Username
            </label>
            <input
              value={form.username}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  username: e.target.value.toLowerCase().replace(/\s/g, ''),
                }))
              }
              placeholder="username"
              className={userInputClass}
            />
          </div>

          {/* Password Input with Toggle */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              {mode === 'edit' ? 'Password Baru (Opsional)' : 'Password'}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, password: e.target.value }))
                }
                placeholder={
                  mode === 'edit'
                    ? 'Biarkan kosong jika tak diubah'
                    : 'Password'
                }
                className={userInputClass}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Confirm Password Input */}
          {(mode === 'create' || form.password) && (
            <div>
              <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                Konfirmasi Password
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={form.confirmPassword}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      confirmPassword: e.target.value,
                    }))
                  }
                  placeholder="Ulangi password"
                  className={userInputClass}
                />
                <button
                  type="button"
                  onClick={() =>
                    setShowConfirmPassword(!showConfirmPassword)
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Permission Settings */}
          <div className="space-y-3 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                Hak Akses Menu:
              </p>
              <button
                type="button"
                onClick={resetPermissionsToDefault}
                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                Default
              </button>
              <button
                type="button"
                onClick={() => setAllPermissions(true)}
                className="px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
              >
                Semua ON
              </button>
              <button
                type="button"
                onClick={() => setAllPermissions(false)}
                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                Semua OFF
              </button>
            </div>
            {PERMISSION_GROUPS.map((group) => (
              <div key={group.label} className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  {group.label}
                </p>
                <div className="grid grid-cols-1 gap-1.5">
                  {group.keys.map((key) => {
                    const isMandatory = key === 'tabLogin';
                    const isEnabled = form.permissions[key];

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() =>
                          !isMandatory &&
                          setForm((prev) => ({
                            ...prev,
                            permissions: {
                              ...prev.permissions,
                              [key]: !prev.permissions[key],
                            },
                          }))
                        }
                        className={`w-full flex justify-between items-center px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                          isMandatory
                            ? 'bg-blue-50/70 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900/60 text-blue-700 dark:text-blue-300'
                            : isEnabled
                            ? 'bg-emerald-50/80 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-400'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        <span>{TAB_PERMISSION_LABELS[key]}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-black/5 dark:bg-white/10">
                          {isMandatory ? 'WAJIB' : isEnabled ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Form Action Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={saveUser}
              disabled={saving}
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors flex justify-center items-center gap-1.5 shadow-sm"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />)}
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2.5 bg-slate-200 dark:bg-slate-700/80 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-colors"
            >
              Batal
            </button>
          </div>
        </motion.div>
      )}

      {/* User List */}
      {loading ? (
        <div className="py-8 text-center text-xs font-semibold text-slate-400 flex justify-center items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
          Memuat data pengguna...
        </div>
      ) : users.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-500">
          Belum ada pengguna terdaftar.
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between gap-3 p-3 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl shadow-sm transition-all"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                  <Users className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                  @{user.username}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => beginEdit(user)}
                  className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors text-xs font-bold flex items-center gap-1"
                  title="Edit Pengguna"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Edit</span>
                </button>

                {confirmDelete === user.id ? (
                  <div className="flex items-center gap-1 bg-red-50 dark:bg-red-950/40 p-1 rounded-lg border border-red-200 dark:border-red-900/40">
                    <button
                      type="button"
                      onClick={() => removeUser(user.id)}
                      disabled={saving}
                      className="px-2 py-0.5 text-[11px] font-bold bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                    >
                      Hapus
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
                    >
                      Batal
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(user.id)}
                    className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors text-xs font-bold"
                    title="Hapus Pengguna"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component: SettingAkunModal ────────────────────────────────
export default function SettingAkunModal({ onClose }: SettingAkunModalProps) {
  const {
    developerMode,
    setDeveloperMode,
    datePickerStyle,
    setDatePickerStyle,
    userRole,
    currentUser,
  } = useAppContext();

  const [activeTab, setActiveTab] = useState<ModalTab>('pengaturan');
  const [openSection, setOpenSection] = useState<CredSection>('none');

  // Konfigurasi Suntik EXIF (tersimpan di appStorage — terpusat untuk semua fitur)
  const [exifPreset, setExifPreset] = useState<ExifSuntikConfig>(() => getExifSuntik('preset'));
  const [exifPresensi, setExifPresensi] = useState<ExifSuntikConfig>(() => getExifSuntik('presensi'));
  const [exifProduktivitas, setExifProduktivitas] = useState<ExifSuntikConfig>(() => getExifSuntik('produktivitas'));
  const updateExif = (target: ExifSuntikTarget) => (cfg: ExifSuntikConfig) => {
    setExifSuntik(target, cfg);
    if (target === 'preset') setExifPreset(cfg);
    else if (target === 'presensi') setExifPresensi(cfg);
    else setExifProduktivitas(cfg);
  };

  useBackButton(() => {
    if (openSection !== 'none') {
      setOpenSection('none');
      return true;
    }
    return false;
  }, openSection !== 'none');

  // State: Admin Username Change
  const [currentAdminUsername, setCurrentAdminUsername] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [verifyPassForUsername, setVerifyPassForUsername] = useState('');
  const [showVerifyPass, setShowVerifyPass] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [usernameSuccess, setUsernameSuccess] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);

  // State: Password Change
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showOldPin, setShowOldPin] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);
  const [passError, setPassError] = useState('');
  const [passSuccess, setPassSuccess] = useState('');
  const [savingPass, setSavingPass] = useState(false);

  // Reset form status when toggling sections
  useEffect(() => {
    if (openSection !== 'username') {
      setNewUsername('');
      setVerifyPassForUsername('');
      setUsernameError('');
      setUsernameSuccess('');
    }
    if (openSection !== 'password') {
      setOldPin('');
      setNewPin('');
      setConfirmPin('');
      setPassError('');
      setPassSuccess('');
    }
  }, [openSection]);

  // Fetch current admin username from Firebase
  useEffect(() => {
    if (userRole !== 'admin') return;
    getDoc(doc(db, 'settings', 'auth'))
      .then((snap) => {
        if (snap.exists()) {
          setCurrentAdminUsername(snap.data().adminUsername || 'admin');
        } else {
          setCurrentAdminUsername('admin');
        }
      })
      .catch(() => setCurrentAdminUsername('admin'));
  }, [userRole]);

  // Admin Username Update Handler
  const handleSaveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError('');
    setUsernameSuccess('');

    let validated: string;
    try {
      validated = validateAdminUsername(newUsername);
    } catch (err) {
      setUsernameError(getErrorMessage(err, 'Username tidak valid.'));
      return;
    }

    if (!verifyPassForUsername) {
      setUsernameError('Konfirmasi password diperlukan.');
      return;
    }

    setSavingUsername(true);
    try {
      const passOk = await verifyAdminPassword(
        verifyPassForUsername.substring(0, 128)
      );
      if (!passOk) {
        setUsernameError('Password salah. Username tidak diubah.');
        return;
      }

      const authRef = doc(db, 'settings', 'auth');
      await setDoc(
        authRef,
        {
          adminUsername: validated,
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      setCurrentAdminUsername(validated);
      setUsernameSuccess(`Username berhasil diubah menjadi "${validated}".`);
      setNewUsername('');
      setVerifyPassForUsername('');
    } catch (err) {
      setUsernameError(getErrorMessage(err, 'Gagal menyimpan username.'));
    } finally {
      setSavingUsername(false);
    }
  };

  // Password Update Handler
  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError('');
    setPassSuccess('');

    const oldTrimmed = oldPin.substring(0, 128);
    const newTrimmed = newPin.substring(0, 128);
    const confirmTrimmed = confirmPin.substring(0, 128);

    if (!oldTrimmed || !newTrimmed || !confirmTrimmed) {
      setPassError('Semua kolom harus diisi.');
      return;
    }
    if (newTrimmed !== confirmTrimmed) {
      setPassError('Password baru dan konfirmasi tidak cocok.');
      return;
    }

    try {
      validatePassword(newTrimmed, 'Password baru');
    } catch (err) {
      setPassError(getErrorMessage(err, 'Password tidak valid.'));
      return;
    }

    setSavingPass(true);
    try {
      if (userRole === 'admin') {
        const passOk = await verifyAdminPassword(oldTrimmed);
        if (!passOk) {
          setPassError('Password lama tidak valid.');
          return;
        }

        const newHash = hashPinLayered(newTrimmed);
        const encryptedPin = encryptAppCredential(newTrimmed);
        await setDoc(
          doc(db, 'settings', 'auth'),
          {
            pinHash: newHash,
            pinEncrypted: encryptedPin,
            updatedAt: Date.now(),
          },
          { merge: true }
        );

        setPassSuccess('Password berhasil diperbarui!');
        setTimeout(() => onClose(), 1500);
      } else if (currentUser) {
        const valid = await verifyUserPassword(
          currentUser.username,
          oldTrimmed
        );
        if (!valid) {
          setPassError('Password lama tidak valid.');
          return;
        }

        await updateUserAccount(currentUser.id, { password: newTrimmed });
        setPassSuccess('Password berhasil diperbarui!');
        setTimeout(() => onClose(), 1500);
      }
    } catch (err) {
      setPassError(getErrorMessage(err, 'Terjadi kesalahan sistem.'));
    } finally {
      setSavingPass(false);
    }
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="account-modal-layer fixed inset-0 z-[2147483000] flex items-center justify-center bg-slate-950/60 p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.85, y: 30 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        style={{
          width:
            'min(100%, calc(100vw - var(--dev-panel-right-offset, 0px) - 2rem))',
          maxWidth: '28rem',
        }}
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl shadow-slate-950/20 h-auto min-h-[min(640px,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] border border-slate-200 dark:border-slate-700/80 overflow-hidden flex flex-col will-change-transform"
      >
        {/* Header Modal */}
        <div className="flex justify-between items-center p-4 sm:p-5 border-b border-slate-100 dark:border-slate-700/80 shrink-0 bg-white/80 dark:bg-slate-800/80 backdrop-blur">
          <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Lock className="w-5 h-5 text-blue-500" />
            Pengaturan Jadhuman
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-100 dark:border-slate-700/80 shrink-0 bg-slate-50/50 dark:bg-slate-900/20">
          <button
            type="button"
            onClick={() => setActiveTab('pengaturan')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold transition-colors border-b-2 ${
              activeTab === 'pengaturan'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-800'
                : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
            }`}
          >
            <Settings className="w-3.5 h-3.5" /> Pengaturan
          </button>
          {userRole === 'admin' && (
            <button
              type="button"
              onClick={() => setActiveTab('pengguna')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold transition-colors border-b-2 ${
                activeTab === 'pengguna'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-800'
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <Users className="w-3.5 h-3.5" /> Pengguna
            </button>
          )}
        </div>

        {/* Scrollable Content Body */}
        <div className="overflow-y-auto flex-1 custom-scrollbar">

          {/* ═══ TAB: PENGATURAN ═══ */}
          {activeTab === 'pengaturan' && (
            <div className="p-4 sm:p-5 space-y-4">
              {/* Dev Mode Toggle Card */}
              <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl flex items-center justify-between shadow-sm">
                <div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    ⚙️ Mode Developer
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500 block mt-0.5">
                    Aktifkan Fitur DevMode
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const nextDeveloperMode = !developerMode;
                    setDeveloperMode(nextDeveloperMode);
                    if (nextDeveloperMode) onClose();
                  }}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    developerMode ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                      developerMode ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Suntik EXIF — terpusat untuk semua fitur */}
              <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl space-y-2.5 shadow-sm">
                <div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    🔧 Suntik EXIF
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500 block mt-0.5">
                    Sematkan metadata Make / Model / Software kamera palsu ke foto (hanya bila foto sumber tak punya EXIF). Pengaturan terpisah untuk tiap fitur.
                  </span>
                </div>
                <ExifSuntikPanel target="preset" config={exifPreset} onChange={updateExif('preset')} />
                <ExifSuntikPanel target="presensi" config={exifPresensi} onChange={updateExif('presensi')} />
                <ExifSuntikPanel target="produktivitas" config={exifProduktivitas} onChange={updateExif('produktivitas')} />
              </div>

              {/* Datepicker Style Card */}
              <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl space-y-3 shadow-sm">
                <div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    📅 Gaya Pemilih Tanggal
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500 block mt-0.5">
                    Pilih tampilan kalender di aplikasi
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(['modern', 'klasik'] as const).map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => setDatePickerStyle(style)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
                        datePickerStyle === style
                          ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      {style === 'modern' ? 'Kalender Modern' : 'Klasik Dropdown'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Collapsible Account Settings */}
              <div className="border border-slate-200 dark:border-slate-700/80 rounded-2xl overflow-hidden shadow-sm bg-white dark:bg-slate-900/20">
                <div className="px-4 py-3 bg-slate-50/80 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-700/60">
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {userRole === 'admin'
                      ? '🔑 Akun Administrator'
                      : '🔑 Akun Saya'}
                  </p>
                  {userRole === 'admin' && currentAdminUsername && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      Username saat ini:{' '}
                      <span className="font-bold text-slate-700 dark:text-slate-300">
                        @{currentAdminUsername}
                      </span>
                    </p>
                  )}
                </div>

                {/* Section: Change Admin Username */}
                {userRole === 'admin' && (
                  <div className="border-b border-slate-100 dark:border-slate-700/60">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenSection(
                          openSection === 'username' ? 'none' : 'username'
                        )
                      }
                      className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <AtSign className="w-4 h-4 text-blue-500" />
                        <span className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300">
                          Ganti Username Admin
                        </span>
                      </div>
                      {openSection === 'username' ? (
                        <ChevronUp className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      )}
                    </button>

                    <AnimatePresence>
                      {openSection === 'username' && (
                        <motion.form
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          onSubmit={handleSaveUsername}
                          className="px-4 pb-4 space-y-3 overflow-hidden"
                        >
                          <div>
                            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                              Username Baru
                            </label>
                            <div className="relative">
                              <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                              <input
                                type="text"
                                value={newUsername}
                                onChange={(e) =>
                                  setNewUsername(
                                    e.target.value
                                      .toLowerCase()
                                      .replace(/\s/g, '')
                                      .substring(0, 32)
                                  )
                                }
                                className={credentialInputClass}
                                placeholder="username baru"
                                autoCapitalize="none"
                                maxLength={32}
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                              Konfirmasi Password Admin
                            </label>
                            <div className="relative">
                              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                              <input
                                type={showVerifyPass ? 'text' : 'password'}
                                value={verifyPassForUsername}
                                onChange={(e) =>
                                  setVerifyPassForUsername(
                                    e.target.value.substring(0, 128)
                                  )
                                }
                                className={credentialInputClass}
                                placeholder="Masukkan password verifikasi"
                                maxLength={128}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setShowVerifyPass(!showVerifyPass)
                                }
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                              >
                                {showVerifyPass ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </div>

                          {usernameError && (
                            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2.5 rounded-xl text-xs font-semibold">
                              <AlertCircle className="w-4 h-4 shrink-0" />
                              <span>{usernameError}</span>
                            </div>
                          )}
                          {usernameSuccess && (
                            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 p-2.5 rounded-xl text-xs font-semibold">
                              <CheckCircle2 className="w-4 h-4 shrink-0" />
                              <span>{usernameSuccess}</span>
                            </div>
                          )}

                          <button
                            type="submit"
                            disabled={savingUsername}
                            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex justify-center items-center gap-2 transition-colors shadow-sm"
                          >
                            {savingUsername ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Save className="w-4 h-4" />
                            )}
                            {savingUsername ? 'Menyimpan...' : 'Simpan Username'}
                          </button>
                        </motion.form>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* Section: Change Password */}
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenSection(
                        openSection === 'password' ? 'none' : 'password'
                      )
                    }
                    className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2.5">
                      <Lock className="w-4 h-4 text-blue-500" />
                      <span className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300">
                        Ganti Password
                      </span>
                    </div>
                    {openSection === 'password' ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </button>

                  <AnimatePresence>
                    {openSection === 'password' && (
                      <motion.form
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        onSubmit={handleSavePassword}
                        className="px-4 pb-4 space-y-3 overflow-hidden"
                      >
                        {[
                          {
                            label: 'Password Lama',
                            val: oldPin,
                            set: setOldPin,
                            show: showOldPin,
                            toggle: () => setShowOldPin(!showOldPin),
                            placeholder: 'Masukkan password lama',
                          },
                          {
                            label: 'Password Baru',
                            val: newPin,
                            set: setNewPin,
                            show: showNewPin,
                            toggle: () => setShowNewPin(!showNewPin),
                            placeholder: 'Min. 4 karakter',
                          },
                          {
                            label: 'Konfirmasi Password Baru',
                            val: confirmPin,
                            set: setConfirmPin,
                            show: showConfirmPin,
                            toggle: () => setShowConfirmPin(!showConfirmPin),
                            placeholder: 'Ulangi password baru',
                          },
                        ].map(({ label, val, set, show, toggle, placeholder }) => (
                          <div key={label}>
                            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                              {label}
                            </label>
                            <div className="relative">
                              <input
                                type={show ? 'text' : 'password'}
                                value={val}
                                onChange={(e) => set(e.target.value)}
                                className="w-full pl-4 pr-10 py-2.5 border border-slate-200 dark:border-slate-700/80 rounded-xl bg-white dark:bg-slate-900/60 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none text-sm transition-all"
                                placeholder={placeholder}
                                maxLength={128}
                              />
                              <button
                                type="button"
                                onClick={toggle}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                              >
                                {show ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </div>
                        ))}

                        {passError && (
                          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2.5 rounded-xl text-xs font-semibold">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>{passError}</span>
                          </div>
                        )}
                        {passSuccess && (
                          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 p-2.5 rounded-xl text-xs font-semibold">
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            <span>{passSuccess}</span>
                          </div>
                        )}

                        <button
                          type="submit"
                          disabled={savingPass}
                          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex justify-center items-center gap-2 transition-colors shadow-sm"
                        >
                          {savingPass ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4" />
                          )}
                          {savingPass ? 'Menyimpan...' : 'Simpan Password'}
                        </button>
                      </motion.form>
                    )}
                  </AnimatePresence>
                </div>
              </div>

            </div>
          )}

          {/* ═══ TAB: PENGGUNA (Admin Only) ═══ */}
          {activeTab === 'pengguna' && userRole === 'admin' && (
            <div className="p-4 sm:p-5">
              <UserManagement />
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-white/95 p-3 dark:border-slate-700/80 dark:bg-slate-800/95 sm:p-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Tutup
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
