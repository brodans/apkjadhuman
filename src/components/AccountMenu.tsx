import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, LogOut, Settings, ShieldCheck, UserCircle, Users } from 'lucide-react';

interface AccountMenuProps {
  displayName: string;
  photoUrl?: string;
  role: string;
  onSettings: () => void;
  onLogout: () => void;
}

const MENU_WIDTH = 264;
const SCREEN_MARGIN = 12;

interface MenuPosition {
  left: number;
  top: number;
  maxHeight: number;
}

export default function AccountMenu({
  displayName,
  photoUrl,
  role,
  onSettings,
  onLogout,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuWidth, setMenuWidth] = useState(MENU_WIDTH);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>();
  const isAdmin = role === 'admin';
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(MENU_WIDTH, window.innerWidth - SCREEN_MARGIN * 2);
      const left = Math.min(
        Math.max(SCREEN_MARGIN, rect.right - width),
        window.innerWidth - width - SCREEN_MARGIN,
      );
      const roomBelow = window.innerHeight - rect.bottom - SCREEN_MARGIN * 2;
      const roomAbove = rect.top - SCREEN_MARGIN * 2;
      const placeAbove = roomBelow < 220 && roomAbove > roomBelow;
      const maxHeight = Math.max(120, placeAbove ? roomAbove : roomBelow);
      const top = placeAbove
        ? Math.max(SCREEN_MARGIN, rect.top - Math.min(220, maxHeight) - 8)
        : rect.bottom + 8;

      setMenuWidth(width);
      setMenuPosition({ left, top, maxHeight });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menu akun — ${displayName}`}
        title={displayName}
        className={`flex cursor-pointer items-center rounded-full border bg-white/50 p-0.5 shadow-sm transition-all dark:bg-slate-800/50 sm:gap-2 sm:pr-2.5 ${
          open
            ? 'border-blue-400 ring-2 ring-blue-500/20 dark:border-blue-500/60'
            : 'border-slate-200 hover:border-slate-300 hover:shadow-md dark:border-slate-700/80 dark:hover:border-slate-600'
        }`}
      >
        {photoUrl ? (
          <img
            src={photoUrl}
            alt=""
            className="aspect-square h-8 w-8 shrink-0 rounded-full border border-slate-200 object-cover dark:border-slate-600"
          />
        ) : (
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold dark:border-slate-600 ${
              isAdmin
                ? 'border-violet-200 bg-violet-100 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/20 dark:text-violet-300'
                : 'border-slate-300 bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
            }`}
          >
            {initials || <UserCircle className="h-4 w-4" />}
          </span>
        )}
        <span className="hidden max-w-[130px] truncate text-sm font-semibold text-slate-700 dark:text-slate-200 sm:inline">
          {displayName}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`hidden h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 sm:block ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && menuPosition && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.14, ease: 'easeOut' }}
              role="menu"
              style={{
                position: 'fixed',
                left: menuPosition.left,
                top: menuPosition.top,
                width: menuWidth,
                maxHeight: menuPosition.maxHeight,
              }}
              className="z-[2147482000] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/25 dark:border-slate-700 dark:bg-slate-800"
            >
            <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3.5 dark:border-slate-700/60 dark:bg-slate-900/40">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-full border border-slate-200 object-cover dark:border-slate-600"
                />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-slate-200 text-xs font-bold text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  {initials || <UserCircle className="h-5 w-5" />}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="break-words text-xs font-bold leading-snug text-slate-800 dark:text-slate-100">
                  {displayName}
                </p>
                <span
                  className={`mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                    isAdmin
                      ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300'
                      : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                  }`}
                >
                  {isAdmin ? <ShieldCheck className="h-2.5 w-2.5" /> : <Users className="h-2.5 w-2.5" />}
                  {isAdmin ? 'Administrator' : 'Pengguna'}
                </span>
              </div>
            </div>

            <div className="space-y-0.5 p-1.5">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onSettings();
                }}
                className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/50"
              >
                <Settings className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <span>
                  <span className="block text-xs font-bold">Pengaturan Jadhuman</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-400 dark:text-slate-500">
                    Pengaturan akun, akses, dan aplikasi
                  </span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onLogout();
                }}
                className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
              >
                <LogOut className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="block text-xs font-bold">Keluar Akun</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-rose-400/80 dark:text-rose-400/70">
                    Akhiri sesi akun Jadhuman
                  </span>
                </span>
              </button>
            </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
