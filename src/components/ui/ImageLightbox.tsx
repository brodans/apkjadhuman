import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { resolveImageSource, useResolvedImageSource } from '../../hooks/useResolvedImageSource';
import { acquireNativeDarkOverlay } from '../../lib/nativeSystemBars';

interface ImageItem {
  src: string;
  title: string;
}

interface ImageLightboxProps {
  src: string;
  title: string;
  onClose: () => void;
  images?: ImageItem[];
  currentIndex?: number;
}

/** Preload single image into browser cache */
function preloadImage(url: string): HTMLImageElement {
  const img = new Image();
  img.src = url;
  img.referrerPolicy = 'no-referrer';
  return img;
}

export default function ImageLightbox({
  src,
  title,
  onClose,
  images,
  currentIndex,
}: ImageLightboxProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [localIndex, setLocalIndex] = useState<number>(currentIndex ?? -1);
  const [isImgLoading, setIsImgLoading] = useState(true);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const preloadedImgsRef = useRef<HTMLImageElement[]>([]);

  // Gesture refs
  const initialDistance = useRef<number | null>(null);
  const initialScale = useRef<number>(1);
  const lastTouchTime = useRef<number>(0);

  // SSR Guard
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => acquireNativeDarkOverlay(), []);

  // Synchronize localIndex with props
  useEffect(() => {
    if (currentIndex !== undefined) {
      setLocalIndex(currentIndex);
    } else if (images && src) {
      const idx = images.findIndex((img) => img.src === src);
      if (idx !== -1) setLocalIndex(idx);
    }
  }, [src, currentIndex, images]);

  const hasMultiple = Boolean(images && images.length > 1);

  const currentSrc =
    hasMultiple && images && localIndex >= 0 && localIndex < images.length
      ? images[localIndex].src
      : src;

  const currentTitle =
    hasMultiple && images && localIndex >= 0 && localIndex < images.length
      ? images[localIndex].title
      : title;
  const resolvedCurrentSrc = useResolvedImageSource(currentSrc);

  const handlePrev = useCallback(() => {
    if (!hasMultiple || !images) return;
    setLocalIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  }, [hasMultiple, images]);

  const handleNext = useCallback(() => {
    if (!hasMultiple || !images) return;
    setLocalIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  }, [hasMultiple, images]);

  // Reset viewport state when current image changes
  useEffect(() => {
    setIsImgLoading(true);
    setScale(1);
    setPosition({ x: 0, y: 0 });

    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setIsImgLoading(false);
    }
  }, [currentSrc]);

  // Preload adjacent images
  useEffect(() => {
    if (!hasMultiple || !images) return;

    const prevIdx = localIndex > 0 ? localIndex - 1 : images.length - 1;
    const nextIdx = localIndex < images.length - 1 ? localIndex + 1 : 0;

    const toPreload: string[] = [];
    if (images[prevIdx]?.src) toPreload.push(images[prevIdx].src);
    if (images[nextIdx]?.src && images[nextIdx].src !== images[prevIdx]?.src) {
      toPreload.push(images[nextIdx].src);
    }

    let active = true;
    Promise.all(toPreload.map(resolveImageSource)).then((resolvedSources) => {
      if (active) preloadedImgsRef.current = resolvedSources.map(preloadImage);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [localIndex, images, hasMultiple]);

  // Prevent background scroll and pull-to-refresh
  useEffect(() => {
    const originalBodyOverscroll = document.body.style.overscrollBehaviorY;
    const originalHtmlOverscroll = document.documentElement.style.overscrollBehaviorY;
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overscrollBehaviorY = 'contain';
    document.documentElement.style.overscrollBehaviorY = 'contain';
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overscrollBehaviorY = originalBodyOverscroll;
      document.documentElement.style.overscrollBehaviorY = originalHtmlOverscroll;
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
    };
  }, []);

  // Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasMultiple) handlePrev();
      else if (e.key === 'ArrowRight' && hasMultiple) handleNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, hasMultiple, handlePrev, handleNext]);

  // Global Mouse Drag Handlers (Prevents cursor loss outside viewport)
  useEffect(() => {
    if (!isDragging) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    };

    const handleWindowMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isDragging, dragStart]);

  // Non-passive Touch Gestures Handler (Pinch-to-zoom & Pan)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handleTouchStartNative = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        setIsDragging(false);
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        initialDistance.current = dist;
        initialScale.current = scale;
      } else if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTouchTime.current < 300) {
          // Double Tap
          if (scale > 1) {
            setScale(1);
            setPosition({ x: 0, y: 0 });
          } else {
            setScale(2.5);
          }
          lastTouchTime.current = 0;
          return;
        }
        lastTouchTime.current = now;

        if (scale > 1) {
          setIsDragging(true);
          const touch = e.touches[0];
          setDragStart({ x: touch.clientX - position.x, y: touch.clientY - position.y });
        }
      }
    };

    const handleTouchMoveNative = (e: TouchEvent) => {
      if (e.touches.length === 2 && initialDistance.current !== null) {
        e.preventDefault(); // Prevents native page zoom
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const nextScale = (dist / initialDistance.current) * initialScale.current;
        setScale(Math.max(1, Math.min(nextScale, 4)));
      } else if (e.touches.length === 1 && isDragging && scale > 1) {
        e.preventDefault();
        const touch = e.touches[0];
        setPosition({
          x: touch.clientX - dragStart.x,
          y: touch.clientY - dragStart.y,
        });
      }
    };

    const handleTouchEndNative = () => {
      setIsDragging(false);
      initialDistance.current = null;
    };

    stage.addEventListener('touchstart', handleTouchStartNative, { passive: false });
    stage.addEventListener('touchmove', handleTouchMoveNative, { passive: false });
    stage.addEventListener('touchend', handleTouchEndNative);

    return () => {
      stage.removeEventListener('touchstart', handleTouchStartNative);
      stage.removeEventListener('touchmove', handleTouchMoveNative);
      stage.removeEventListener('touchend', handleTouchEndNative);
    };
  }, [scale, position, isDragging, dragStart]);

  const handleDownload = async () => {
    const filename = `${currentTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'foto'}.jpg`;
    let downloadSource = resolvedCurrentSrc || currentSrc;
    try {
      if (!resolvedCurrentSrc) downloadSource = await resolveImageSource(currentSrc);
      if (downloadSource.startsWith('data:')) {
        const a = document.createElement('a');
        a.href = downloadSource;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        const response = await fetch(downloadSource);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      }
    } catch (error) {
      console.error('Failed to download image:', error);
      const a = document.createElement('a');
      a.href = downloadSource;
      a.target = '_blank';
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleImageClick = (e: React.MouseEvent) => {
    if (e.detail === 2) {
      if (scale > 1) {
        setScale(1);
        setPosition({ x: 0, y: 0 });
      } else {
        setScale(2.5);
      }
    }
  };

  if (!isMounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={currentTitle || 'Pratinjau Foto'}
      className="image-lightbox modal-layer fixed inset-0 z-[9999] flex flex-col items-center justify-between bg-slate-950/95 backdrop-blur-md p-4 transition-all duration-300 select-none animate-in fade-in touch-none overscroll-contain"
    >
      {/* Top Header */}
      <div className="w-full max-w-4xl flex items-center justify-between z-10 py-3 border-b border-slate-800/60 shrink-0">
        <div className="text-slate-100 font-semibold text-sm md:text-base line-clamp-1 pr-4 flex items-center gap-2">
          <span>{currentTitle || 'Pratinjau Foto'}</span>
          {hasMultiple && images && (
            <span className="text-xs bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-full border border-slate-700 font-mono shrink-0">
              {localIndex + 1} / {images.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleDownload}
            disabled={!resolvedCurrentSrc}
            className="text-blue-400 hover:text-blue-300 transition-colors p-2.5 bg-slate-900/60 hover:bg-slate-800 rounded-full cursor-pointer shadow-lg outline-none ring-2 ring-transparent focus:ring-blue-500 flex items-center gap-1.5 text-xs font-semibold"
            title="Unduh Foto"
            id="lightbox_download"
          >
            <Download className="w-4 h-4 md:w-5 md:h-5" />
            <span className="hidden sm:inline">Unduh</span>
          </button>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-2.5 bg-slate-900/60 hover:bg-slate-800 rounded-full cursor-pointer shadow-lg outline-none ring-2 ring-transparent focus:ring-blue-500"
            title="Tutup"
            id="close_lightbox_btn"
          >
            <X className="w-4 h-4 md:w-5 md:h-5" />
          </button>
        </div>
      </div>

      {/* Main Stage */}
      <div
        ref={stageRef}
        className="flex-1 w-full max-w-4xl flex items-center justify-center relative overflow-hidden my-4 rounded-xl border border-slate-800/40 bg-slate-900/20"
        onMouseDown={handleMouseDown}
        style={{ cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
      >
        {/* Navigation Arrows */}
        {hasMultiple && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-full bg-slate-950/70 hover:bg-slate-900 text-slate-200 border border-slate-700 hover:text-white transition-all cursor-pointer shadow-lg hover:scale-105 active:scale-95 flex items-center justify-center outline-none ring-2 ring-transparent focus:ring-blue-500"
              title="Foto Sebelumnya"
              id="lightbox_prev_btn"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-full bg-slate-950/70 hover:bg-slate-900 text-slate-200 border border-slate-700 hover:text-white transition-all cursor-pointer shadow-lg hover:scale-105 active:scale-95 flex items-center justify-center outline-none ring-2 ring-transparent focus:ring-blue-500"
              title="Foto Berikutnya"
              id="lightbox_next_btn"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}

        {/* Loading Spinner */}
        {isImgLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/20 z-10 pointer-events-none">
            <div className="w-10 h-10 rounded-full border-4 border-slate-700/50 border-t-blue-500 animate-spin" />
          </div>
        )}

        <div
          className={`transition-transform duration-100 ease-out flex items-center justify-center transition-opacity duration-300 ${
            isImgLoading ? 'opacity-40' : 'opacity-100'
          }`}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          }}
          onClick={handleImageClick}
        >
          <img
            ref={imgRef}
            src={resolvedCurrentSrc || undefined}
            alt={currentTitle}
            onLoad={() => setIsImgLoading(false)}
            onError={() => setIsImgLoading(false)}
            className="max-w-[90vw] max-h-[75vh] object-contain rounded-md shadow-2xl pointer-events-none"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
