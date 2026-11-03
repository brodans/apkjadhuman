import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Clipboard, Code2, Download, Eraser, X, Zap } from 'lucide-react';
import { ApiTrafficEntry, subscribeToApiTraffic } from '../api';
import { acquireNativeDarkOverlay } from '../lib/nativeSystemBars';

const formatPayload = (value: unknown) => {
  if (value === undefined || value === null) return 'null';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export default function DeveloperInspector({ enabled }: { enabled: boolean }) {
  const [entries, setEntries] = useState<ApiTrafficEntry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [panelWidth, setPanelWidth] = useState(420);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [fabY, setFabY] = useState(96);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1280);

  const dragRef = useRef<{ active: boolean; startY: number; originY: number; moved: boolean }>({
    active: false,
    startY: 0,
    originY: 96,
    moved: false,
  });
  const dragState = useRef<{ active: boolean }>({ active: false });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1279px)');
    const syncViewport = () => setIsMobile(mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);
    return () => mediaQuery.removeEventListener('change', syncViewport);
  }, []);

  // Subscribe to API traffic
  useEffect(() => {
    const unsubscribe = subscribeToApiTraffic((entry) => {
      setEntries((current) => [...current, entry].slice(-100));
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Handle panel visibility & mobile drawer state
  useEffect(() => {
    if (!enabled) return;
    setSelectedId(null);
    if (isMobile) {
      setMobileOpen(true);
    }
  }, [enabled, isMobile]);

  useEffect(() => {
    if (!enabled || !mobileOpen || !isMobile) return;
    return acquireNativeDarkOverlay();
  }, [enabled, mobileOpen, isMobile]);

  // Initial FAB positioning boundary check
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const maxY = Math.max(window.innerHeight - 52, 8);
    setFabY((prev) => Math.min(Math.max(prev, 8), maxY));
  }, []);

  // Mobile FAB Touch/Mouse dragging handler
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !isMobile) return;

    const handleMove = (event: MouseEvent | TouchEvent) => {
      if (!dragRef.current.active) return;
      const point = 'touches' in event ? event.touches[0] : event;
      const dy = point.clientY - dragRef.current.startY;
      const nextY = Math.min(
        Math.max(dragRef.current.originY + dy, 8),
        Math.max(window.innerHeight - 52, 8)
      );
      if (Math.abs(dy) > 4) dragRef.current.moved = true;
      setFabY(nextY);
      if ('touches' in event && event.cancelable) event.preventDefault();
    };

    const handleStop = () => {
      dragRef.current.active = false;
    };

    window.addEventListener('mousemove', handleMove as EventListener);
    window.addEventListener('mouseup', handleStop);
    window.addEventListener('touchmove', handleMove as EventListener, { passive: false });
    window.addEventListener('touchend', handleStop);

    return () => {
      window.removeEventListener('mousemove', handleMove as EventListener);
      window.removeEventListener('mouseup', handleStop);
      window.removeEventListener('touchmove', handleMove as EventListener);
      window.removeEventListener('touchend', handleStop);
    };
  }, [enabled, isMobile]);

  // Auto-sync panel width on desktop resize
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const syncWidth = () => {
      const maxWidth = Math.max(window.innerWidth - 560, 340);
      const next = Math.min(Math.max(window.innerWidth * 0.34, 340), Math.min(680, maxWidth));
      setPanelWidth(next);
    };
    syncWidth();
    window.addEventListener('resize', syncWidth);
    return () => window.removeEventListener('resize', syncWidth);
  }, [enabled]);

  // Sync `--dev-panel-right-offset` for `.modal-layer` in CSS
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const offset = enabled && !isMobile ? panelWidth : 0;
    document.documentElement.style.setProperty('--dev-panel-right-offset', `${offset}px`);
    return () => {
      document.documentElement.style.removeProperty('--dev-panel-right-offset');
    };
  }, [enabled, isMobile, panelWidth]);

  // Desktop Panel Resize Handler
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || isMobile) return;
    const handleMove = (event: MouseEvent) => {
      if (!dragState.current.active) return;
      const availableWidth = Math.max(window.innerWidth - 256 - 48, 340);
      const nextWidth = Math.min(Math.max(window.innerWidth - event.clientX, 340), 720, availableWidth);
      setPanelWidth(nextWidth);
    };
    const handleStop = () => {
      dragState.current.active = false;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleStop);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleStop);
    };
  }, [enabled, isMobile]);

  // Lock body scroll on mobile drawer active state
  useEffect(() => {
    if (!enabled || !mobileOpen || typeof document === 'undefined' || !isMobile) return;

    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
    };
  }, [enabled, mobileOpen, isMobile]);

  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? entries[entries.length - 1];
  const successCount = entries.filter((entry) => !entry.error).length;
  const errorCount = entries.length - successCount;

  const exportLog = () => {
    const content = entries
      .map((entry) =>
        [
          `=== ${entry.endpoint} | ${entry.timestamp} | ${entry.duration}ms ===`,
          '[REQUEST]',
          formatPayload(entry.payload),
          entry.error ? '[ERROR]' : '[RESPONSE]',
          formatPayload(entry.error ? { error: entry.error, status: entry.status } : entry.response),
          '',
        ].join('\n')
      )
      .join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `api-traffic-log-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copySelected = async () => {
    if (!selectedEntry) return;
    await navigator.clipboard.writeText(formatPayload(selectedEntry));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const responsePreview = useMemo(() => {
    if (!selectedEntry) return '';
    return formatPayload(
      selectedEntry.error
        ? { error: selectedEntry.error, status: selectedEntry.status }
        : selectedEntry.response
    );
  }, [selectedEntry]);

  const closeInspector = () => {
    if (isMobile) {
      setMobileOpen(false);
      return;
    }
    window.dispatchEvent(new Event('close-developer-inspector'));
  };

  if (!enabled) return null;

  // ─── TAMPILAN MOBILE (< 1024px) ──────────────────────────────────────────
  if (isMobile) {
    return (
      <>
        {/* Floating Action Button (FAB) Dragable */}
        {!mobileOpen && (
          <button
            type="button"
            onClick={() => {
              if (!dragRef.current.moved) setMobileOpen(true);
              dragRef.current.moved = false;
            }}
            style={{
              top: `min(max(${fabY}px, calc(var(--poni-atas, var(--sat, 0px)) + 8px)), calc(100dvh - var(--poni-bawah, var(--sab, 0px)) - 52px))`,
            }}
            className="developer-inspector-layer developer-inspector-fab fixed right-4 z-[2147483000] flex items-center gap-2 rounded-full bg-slate-900 px-3.5 py-2 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-2xl ring-1 ring-slate-700/80 touch-none select-none active:scale-95 transition-transform"
            onMouseDown={(event) => {
              dragRef.current = {
                active: true,
                startY: event.clientY,
                originY: fabY,
                moved: false,
              };
            }}
            onTouchStart={(event) => {
              const touch = event.touches[0];
              dragRef.current = {
                active: true,
                startY: touch.clientY,
                originY: fabY,
                moved: false,
              };
            }}
          >
            <Code2 className="h-3.5 w-3.5 text-blue-400" />
            <span>Dev</span>
          </button>
        )}

        {/* Mobile Fullscreen Drawer Overlay */}
        {mobileOpen && (
          <>
            <button
              type="button"
              aria-label="Tutup panel developer"
              className="developer-inspector-layer fixed inset-0 z-[2147482999] bg-slate-950/60 backdrop-blur-sm animate-fade-in"
              onClick={() => setMobileOpen(false)}
            />

            <aside className="developer-inspector-layer developer-inspector-drawer fixed inset-0 z-[2147483000] flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-950 text-slate-200 font-sans shadow-2xl animate-pop-in">
              {/* Header */}
              <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-3 shrink-0 bg-slate-900/50">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/20">
                    <Code2 className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-100 truncate">
                      Network Inspector
                    </p>
                    <p className="text-[9px] text-slate-400 font-mono">Developer Mode</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Toolbar */}
              <div className="flex items-center gap-2 border-b border-slate-800/80 px-3 py-2 text-[10px] font-mono shrink-0 bg-slate-900/30">
                <span className="text-emerald-400 font-bold">{successCount} OK</span>
                <span className="text-slate-700">/</span>
                <span className="text-rose-400 font-bold">{errorCount} ERR</span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setEntries([])}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                    title="Bersihkan log"
                  >
                    <Eraser className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={exportLog}
                    disabled={!entries.length}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30 transition-colors"
                    title="Unduh semua log"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={copySelected}
                    disabled={!selectedEntry}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30 transition-colors"
                    title="Salin detail"
                  >
                    <Clipboard className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Entries List */}
              <div className="flex h-2/5 min-h-0 flex-col border-b border-slate-800/80 p-2">
                <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar space-y-1.5">
                  {entries.length === 0 ? (
                    <div className="py-8 text-center text-[11px] text-slate-500">
                      <Zap className="mx-auto mb-2 h-5 w-5 text-slate-700" />
                      Belum ada komunikasi server.
                    </div>
                  ) : (
                    entries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setSelectedId(entry.id)}
                        className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                          selectedEntry?.id === entry.id
                            ? 'border-slate-600 bg-slate-800/90 text-slate-100'
                            : 'border-slate-800/60 bg-slate-900/40 text-slate-300 hover:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              entry.error ? 'bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.5)]' : 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
                            }`}
                          />
                          <span className="truncate text-[10px] font-semibold font-mono tracking-tight">
                            {entry.endpoint}
                          </span>
                        </div>
                        <div className="mt-1 flex justify-between text-[9px] font-mono text-slate-400">
                          <span>{new Date(entry.timestamp).toLocaleTimeString('id-ID')}</span>
                          <span>{entry.duration}ms</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Payload Inspector Area */}
              <div className="flex min-w-0 flex-1 min-h-0 flex-col overflow-hidden bg-slate-950 p-3">
                {selectedEntry ? (
                  <>
                    <div className="flex items-center justify-between pb-2">
                      <span
                        className={`rounded px-2 py-0.5 text-[9px] font-bold font-mono ${
                          selectedEntry.error
                            ? 'bg-rose-500/15 text-rose-300 border border-rose-500/20'
                            : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                        }`}
                      >
                        {selectedEntry.error ? 'ERROR' : 'RESPONSE'} · {selectedEntry.status ?? '-'}
                      </span>
                      <span className="text-[9px] font-mono text-slate-400">{selectedEntry.duration} ms</span>
                    </div>

                    <div className="mt-2 grid min-h-0 min-w-0 flex-1 grid-rows-2 gap-3">
                      <section className="flex min-h-0 min-w-0 flex-col">
                        <h3 className="mb-1 flex shrink-0 items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-blue-400 font-mono">
                          <ChevronDown className="h-3 w-3" /> Request Payload
                        </h3>
                        <pre className="developer-inspector-payload min-h-0 min-w-0 max-w-full flex-1 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 text-[10px] leading-relaxed text-slate-300 font-mono custom-scrollbar">
                          {formatPayload(selectedEntry.payload)}
                        </pre>
                      </section>

                      <section className="flex min-h-0 min-w-0 flex-col">
                        <h3
                          className={`mb-1 flex shrink-0 items-center gap-1 text-[9px] font-bold uppercase tracking-wider font-mono ${
                            selectedEntry.error ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          <ChevronUp className="h-3 w-3" /> Response Output
                        </h3>
                        <pre className="developer-inspector-payload min-h-0 min-w-0 max-w-full flex-1 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 text-[10px] leading-relaxed text-slate-300 font-mono custom-scrollbar">
                          {responsePreview}
                        </pre>
                      </section>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-[11px] text-slate-500">
                    Pilih request untuk melihat detail.
                  </div>
                )}
              </div>

              {/* Toast Alert */}
              {copied && (
                <div className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[10px] font-bold text-white shadow-xl animate-pop-in">
                  <Check className="h-3.5 w-3.5" /> Tersalin ke clipboard
                </div>
              )}
            </aside>
          </>
        )}
      </>
    );
  }

  // ─── TAMPILAN DESKTOP (≥ 1024px Sidebar) ──────────────────────────────────
  return (
    <aside
      className="developer-inspector-layer relative z-[2147483000] h-full shrink-0 border-l border-slate-800 bg-slate-950 text-slate-200 font-sans shadow-2xl transition-all duration-150 select-none"
      style={{ width: `${panelWidth}px`, maxWidth: 'min(68vw, 680px)' }}
    >
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-3 shrink-0 bg-slate-900/40">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/20">
              <Code2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wider text-slate-100 truncate">
                Network Inspector
              </p>
              <p className="text-[10px] text-slate-400 font-mono">Developer Mode</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold">
            <span className="text-emerald-400">{successCount} OK</span>
            <span className="text-slate-700">/</span>
            <span className="text-rose-400">{errorCount} ERR</span>
          </div>
        </div>

        {/* Toolbar Bar */}
        <div className="flex items-center gap-2 border-b border-slate-800/80 px-3 py-2 shrink-0 bg-slate-900/20">
          <span className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE
          </span>
          <span className="text-[10px] text-slate-400 font-mono">{entries.length} requests</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setEntries([])}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              title="Bersihkan log"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={exportLog}
              disabled={!entries.length}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30 transition-colors"
              title="Unduh semua log"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={copySelected}
              disabled={!selectedEntry}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30 transition-colors"
              title="Salin detail"
            >
              <Clipboard className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={closeInspector}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              title="Tutup Developer Inspector"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Main Content Pane */}
        <div className="flex-1 min-h-0 flex divide-x divide-slate-800/80">
          {/* Left Side: Entries List */}
          <div className="w-[42%] min-w-0 overflow-y-auto custom-scrollbar">
            {entries.length === 0 ? (
              <div className="p-5 text-center text-[11px] text-slate-500">
                <Zap className="mx-auto mb-2 h-5 w-5 text-slate-700" />
                Belum ada data request server.
              </div>
            ) : (
              entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelectedId(entry.id)}
                  className={`w-full border-b border-slate-800/50 px-3 py-2.5 text-left transition-colors ${
                    selectedEntry?.id === entry.id
                      ? 'bg-slate-800/80 text-slate-100'
                      : 'text-slate-300 hover:bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        entry.error ? 'bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.5)]' : 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
                      }`}
                    />
                    <span className="truncate text-[10px] font-bold font-mono tracking-tight">
                      {entry.endpoint}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between text-[9px] font-mono text-slate-400">
                    <span>{new Date(entry.timestamp).toLocaleTimeString('id-ID')}</span>
                    <span>{entry.duration}ms</span>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Right Side: Request/Response Details */}
          <div className="w-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3 custom-scrollbar bg-slate-950/40 select-text">
            {selectedEntry ? (
              <>
                <div className="flex items-center justify-between pb-1">
                  <span
                    className={`rounded px-2 py-0.5 text-[9px] font-bold font-mono ${
                      selectedEntry.error
                        ? 'bg-rose-500/15 text-rose-300 border border-rose-500/20'
                        : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                    }`}
                  >
                    {selectedEntry.error ? 'ERROR' : 'RESPONSE'} · {selectedEntry.status ?? '-'}
                  </span>
                  <span className="text-[9px] font-mono text-slate-400">{selectedEntry.duration} ms</span>
                </div>

                <section>
                  <h3 className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-blue-400 font-mono">
                    <ChevronDown className="h-3 w-3" /> Request
                  </h3>
                  <pre className="developer-inspector-payload max-h-52 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-800 bg-slate-900/80 p-2.5 text-[10px] leading-relaxed text-slate-300 font-mono custom-scrollbar">
                    {formatPayload(selectedEntry.payload)}
                  </pre>
                </section>

                <section>
                  <h3
                    className={`mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider font-mono ${
                      selectedEntry.error ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  >
                    <ChevronUp className="h-3 w-3" /> Response
                  </h3>
                  <pre className="developer-inspector-payload max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-800 bg-slate-900/80 p-2.5 text-[10px] leading-relaxed text-slate-300 font-mono custom-scrollbar">
                    {responsePreview}
                  </pre>
                </section>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-[11px] text-slate-500">
                Pilih request untuk melihat detail.
              </div>
            )}
          </div>
        </div>

        {/* Resizer Handle Bar */}
        <div
          className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize bg-transparent hover:bg-blue-500/20 transition-colors group"
          onMouseDown={() => {
            dragState.current.active = true;
          }}
          aria-label="Resize inspector"
          role="separator"
        >
          <div className="absolute inset-y-4 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-slate-700/60 group-hover:bg-blue-400 transition-colors" />
        </div>
      </div>

      {/* Copy Feedback Toast */}
      {copied && (
        <div className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[10px] font-bold text-white shadow-xl animate-pop-in">
          <Check className="h-3.5 w-3.5" /> Tersalin ke clipboard
        </div>
      )}
    </aside>
  );
}
