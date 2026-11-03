import { useState, useEffect, useRef } from 'react';
import { useResolvedImageSource } from '../../hooks/useResolvedImageSource';

interface LazyImageProps {
  src: string;
  alt: string;
  onClick?: () => void;
  className?: string;
  containerClassName?: string;
  /** Jika true, langsung load tanpa menunggu masuk viewport (untuk above-the-fold) */
  eager?: boolean;
  /** Index urutan — digunakan untuk stagger delay agar load dari atas ke bawah */
  loadIndex?: number;
}

export default function LazyImage({
  src,
  alt,
  onClick,
  className = '',
  containerClassName = '',
  eager = false,
  loadIndex,
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [isInView, setIsInView] = useState(eager); // langsung visible jika eager
  const [shouldLoad, setShouldLoad] = useState(eager);

  const containerRef = useRef<HTMLDivElement>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxRetries = 2;

  useEffect(() => () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
    }
  }, []);

  // Reset state ketika src berubah
  useEffect(() => {
    setIsLoaded(false);
    setError(false);
    retryCountRef.current = 0;
    if (eager) {
      setIsInView(true);
      setShouldLoad(true);
    } else {
      setIsInView(false);
      setShouldLoad(false);
    }
  }, [src, eager]);

  // Intersection Observer — deteksi kapan gambar masuk ke viewport
  useEffect(() => {
    if (eager) return; // skip jika eager mode
    if (!containerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect(); // cukup satu kali trigger
          }
        });
      },
      {
        rootMargin: '200px 0px', // preload 200px sebelum masuk viewport
        threshold: 0,
      }
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [eager]);

  // Stagger delay berdasarkan loadIndex agar loading berurutan dari atas ke bawah
  useEffect(() => {
    if (!isInView) return;
    if (eager || typeof loadIndex === 'undefined') {
      setShouldLoad(true);
      return;
    }
    // Delay maksimal 800ms, tapi cukup smooth — setiap item delay 60ms
    const delay = Math.min(loadIndex * 60, 800);
    const timer = setTimeout(() => setShouldLoad(true), delay);
    return () => clearTimeout(timer);
  }, [isInView, eager, loadIndex]);

  // Retry otomatis saat error & fallback domain
  const [currentSrc, setCurrentSrc] = useState(src);
  const resolvedSrc = useResolvedImageSource(currentSrc);

  useEffect(() => {
    setCurrentSrc(src);
  }, [src]);

  const handleError = () => {
    if (retryCountRef.current === 0 && currentSrc.includes('103.109.206.102:8087')) {
      retryCountRef.current = 1;
      const fallback = currentSrc.replace('http://103.109.206.102:8087', 'https://presensi.ponorogo.go.id');
      setCurrentSrc(fallback);
      return;
    }
    if (retryCountRef.current < maxRetries) {
      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(() => {
        setIsLoaded(false);
        setError(false);
        setShouldLoad(false);
        retryTimerRef.current = setTimeout(() => setShouldLoad(true), 50);
      }, 1000 * retryCountRef.current);
    } else {
      setError(true);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-slate-100 dark:bg-slate-900/50 ${containerClassName}`}
    >
      {/* Shimmer Skeleton — tampil saat belum loaded dan belum error */}
      {!isLoaded && !error && (
        <div className="absolute inset-0 bg-slate-200 dark:bg-slate-800 animate-pulse flex items-center justify-center">
          <div className="w-5 h-5 rounded-full border-2 border-slate-300 dark:border-slate-600 border-t-blue-500 animate-spin" />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-900 text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 italic">
          Gagal Memuat
        </div>
      )}

      {/* Gambar hanya di-render saat shouldLoad = true (masuk viewport + delay) */}
      {shouldLoad && !error && resolvedSrc && (
        <img
          src={resolvedSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setIsLoaded(true)}
          onError={handleError}
          onClick={onClick}
          className={`transition-all duration-500 ease-out ${
            isLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
          } ${className}`}
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
}
