import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask, TextLayer } from 'pdfjs-dist';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Minus, Plus, Search } from 'lucide-react';
import {
  buildSearchIndex,
  findSearchMatches,
  toSearchKey,
} from '../../lib/documentSearch';

interface ReportDocumentPreviewProps {
  file: Blob;
  format: 'pdf' | 'xls';
}

interface SpreadsheetSheet {
  name: string;
  rows: string[][];
  merges: SpreadsheetMerge[];
}

interface SpreadsheetMerge {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

interface ActiveHtmlMerge {
  endRow: number;
  startColumn: number;
  endColumn: number;
}

/* ------------------------------------------------------------------ */
/* Parsing spreadsheet                                                 */
/* ------------------------------------------------------------------ */

function parseHtmlSpreadsheet(source: string): SpreadsheetSheet[] | null {
  if (!/<table\b/i.test(source)) return null;

  const document = new DOMParser().parseFromString(source, 'text/html');
  const tables = Array.from(document.querySelectorAll('table'));
  const sheets = tables.map((table, index) => {
    const rows: string[][] = [];
    const merges: SpreadsheetMerge[] = [];
    let activeMerges: ActiveHtmlMerge[] = [];

    Array.from(table.querySelectorAll('tr')).forEach((row, rowIndex) => {
      rows[rowIndex] ??= [];
      activeMerges = activeMerges.filter(merge => merge.endRow >= rowIndex);
      let columnIndex = 0;
      Array.from(row.querySelectorAll('th, td')).forEach(cell => {
        let blockingMerge: ActiveHtmlMerge | undefined;
        while ((blockingMerge = activeMerges.find(merge =>
          columnIndex >= merge.startColumn && columnIndex <= merge.endColumn,
        ))) {
          columnIndex = blockingMerge.endColumn + 1;
        }
        const rowSpan = Math.max(1, Number(cell.getAttribute('rowspan')) || 1);
        const colSpan = Math.max(1, Number(cell.getAttribute('colspan')) || 1);
        rows[rowIndex][columnIndex] = (cell.textContent || '').replace(/\s+/g, ' ').trim();
        if (rowSpan > 1 || colSpan > 1) {
          merges.push({
            startRow: rowIndex,
            startColumn: columnIndex,
            endRow: rowIndex + rowSpan - 1,
            endColumn: columnIndex + colSpan - 1,
          });
        }
        if (rowSpan > 1 || colSpan > 1) {
          activeMerges.push({
            endRow: rowIndex + rowSpan - 1,
            startColumn: columnIndex,
            endColumn: columnIndex + colSpan - 1,
          });
        }
        columnIndex += colSpan;
      });
    });

    return {
      name: table.getAttribute('data-sheet-name') || `Lembar ${index + 1}`,
      rows,
      merges,
    };
  }).filter(sheet => sheet.rows.length > 0);

  return sheets.length ? sheets : null;
}

async function parseSpreadsheet(buffer: ArrayBuffer): Promise<SpreadsheetSheet[]> {
  const preview = new TextDecoder().decode(buffer.slice(0, 1024));
  if (/<table\b/i.test(preview)) {
    const htmlSheets = parseHtmlSpreadsheet(new TextDecoder().decode(buffer));
    if (htmlSheets) return htmlSheets;
  }

  const XLSX = await import('@keep-lts/xlsx');
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: 'array',
    cellDates: true,
    cellFormula: false,
    cellHTML: false,
  });
  const sheets = workbook.SheetNames.map(name => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
      header: 1,
      raw: false,
      defval: '',
    }).map(row => row.map(value => String(value ?? ''))),
    merges: (workbook.Sheets[name]['!merges'] ?? []).map(merge => ({
      startRow: merge.s.r,
      startColumn: merge.s.c,
      endRow: merge.e.r,
      endColumn: merge.e.c,
    })),
  })).filter(sheet => sheet.rows.length > 0);

  if (!sheets.length) throw new Error('Spreadsheet tidak berisi data yang dapat ditampilkan.');
  return sheets;
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

interface PdfSearchHit {
  page: number;
  index: number;
}

interface PdfPageLayers {
  surface: HTMLElement;
  textDivs: HTMLElement[];
}

const MAX_PDF_CANVAS_PIXELS = 6_000_000;
const MAX_PDF_CANVAS_DIMENSION = 8192;

function scrollWithinPdfStage(
  stage: HTMLElement,
  targetRect: DOMRect,
  behavior: ScrollBehavior,
  align: 'center' | 'start',
) {
  const stageRect = stage.getBoundingClientRect();
  const top = align === 'center'
    ? targetRect.top + targetRect.height / 2 - (stageRect.top + stage.clientHeight / 2)
    : targetRect.top - stageRect.top - 8;
  const left = align === 'center'
    ? targetRect.left + targetRect.width / 2 - (stageRect.left + stage.clientWidth / 2)
    : targetRect.left - stageRect.left - 8;

  stage.scrollTo({
    top: stage.scrollTop + top,
    left: stage.scrollLeft + left,
    behavior,
  });
}

function setRangeFromTextOffsets(range: Range, element: HTMLElement, start: number, end: number): boolean {
  const walker = window.document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let offset = 0;
  let startNode: Node | null = null;
  let endNode: Node | null = null;
  let startOffset = 0;
  let endOffset = 0;

  while (node) {
    const length = node.textContent?.length ?? 0;
    if (!startNode && start <= offset + length) {
      startNode = node;
      startOffset = start - offset;
    }
    if (end <= offset + length) {
      endNode = node;
      endOffset = end - offset;
      break;
    }
    offset += length;
    node = walker.nextNode();
  }

  if (!startNode || !endNode) return false;
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return true;
}

interface PdfPageProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  stageWidth: number;
  zoom: number;
  aspectRatio: number;
  visible: boolean;
  searchQuery: string;
  activeMatchIndex: number;
  focusToken: number;
  onAspectRatio: (pageNumber: number, ratio: number) => void;
}

function PdfPage({
  document,
  pageNumber,
  stageWidth,
  zoom,
  aspectRatio,
  visible,
  searchQuery,
  activeMatchIndex,
  focusToken,
  onAspectRatio,
}: PdfPageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<PdfPageLayers | null>(null);
  const handledFocusRef = useRef(0);
  const [rendering, setRendering] = useState(false);
  const [textVersion, setTextVersion] = useState(0);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Render kanvas + text layer. Tidak bergantung pada pencarian, jadi mengetik
  // atau pindah hasil tidak merender ulang halaman.
  useEffect(() => {
    const element = pageRef.current;
    if (!visible || !element || stageWidth < 1) return;
    let active = true;
    let renderTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    setRendering(true);
    setRenderError(null);
    element.replaceChildren();
    layersRef.current = null;

    void document.getPage(pageNumber).then(async page => {
      if (!active) return;
      const baseViewport = page.getViewport({ scale: 1 });
      onAspectRatio(pageNumber, baseViewport.height / baseViewport.width);
      const scale = Math.max(Math.min((stageWidth - 32) / baseViewport.width, 1.5), 0.2) * zoom;
      const viewport = page.getViewport({ scale });
      const canvas = window.document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error(`Halaman ${pageNumber} tidak dapat dirender.`);

      const pixelRatio = Math.min(
        window.devicePixelRatio || 1,
        Math.sqrt(MAX_PDF_CANVAS_PIXELS / (viewport.width * viewport.height)),
        MAX_PDF_CANVAS_DIMENSION / viewport.width,
        MAX_PDF_CANVAS_DIMENSION / viewport.height,
      );
      canvas.width = Math.ceil(viewport.width * pixelRatio);
      canvas.height = Math.ceil(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.className = 'mx-auto block bg-white shadow-lg';
      const surface = window.document.createElement('div');
      surface.className = 'relative mx-auto shrink-0';
      surface.style.width = `${viewport.width}px`;
      surface.style.height = `${viewport.height}px`;
      surface.appendChild(canvas);

      element.appendChild(surface);

      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      const [textContent, pdfjs] = await Promise.all([
        page.getTextContent(),
        import('pdfjs-dist'),
      ]);
      if (!active) return;
      const textContainer = window.document.createElement('div');
      textContainer.className = 'textLayer pdf-text-layer';
      textContainer.style.setProperty('--scale-factor', String(viewport.scale));
      textContainer.style.width = `${viewport.width}px`;
      textContainer.style.height = `${viewport.height}px`;
      surface.appendChild(textContainer);
      textLayer = new pdfjs.TextLayer({
        textContentSource: textContent,
        container: textContainer,
        viewport,
      });
      await Promise.all([renderTask.promise, textLayer.render()]);
      if (!active) return;
      layersRef.current = { surface, textDivs: textLayer.textDivs };
      setTextVersion(value => value + 1);
    }).then(() => {
      if (active) setRendering(false);
    }).catch(cause => {
      if (!active) return;
      if (cause instanceof Error && cause.name === 'RenderingCancelledException') return;
      setRenderError(cause instanceof Error ? cause.message : `Gagal merender halaman ${pageNumber}.`);
      setRendering(false);
    });

    return () => {
      active = false;
      layersRef.current = null;
      renderTask?.cancel();
      textLayer?.cancel();
      element.replaceChildren();
    };
  }, [document, pageNumber, stageWidth, zoom, visible, renderAttempt, onAspectRatio]);

  // Navigate to the matched text without adding a visual highlight.
  useEffect(() => {
    const layers = layersRef.current;
    if (!layers || !searchQuery || activeMatchIndex < 0) return;
    const { surface, textDivs } = layers;

    const index = buildSearchIndex(textDivs.map(div => div.textContent ?? ''));
    const matches = findSearchMatches(index, searchQuery);
    const match = matches[activeMatchIndex];
    if (!match) return;
    const range = window.document.createRange();

    for (const segment of match) {
      const textDiv = textDivs[segment.source];
      if (!textDiv || !setRangeFromTextOffsets(range, textDiv, segment.start, segment.end)) continue;
      const rect = Array.from(range.getClientRects()).find(item => item.width > 0 && item.height > 0);
      if (!rect) continue;
      if (handledFocusRef.current !== focusToken) {
        handledFocusRef.current = focusToken;
        const stage = surface.closest<HTMLElement>('[data-pdf-stage]');
        if (stage) scrollWithinPdfStage(stage, rect, 'smooth', 'center');
      }
      break;
    }
  }, [searchQuery, activeMatchIndex, focusToken, textVersion]);

  return (
    <div
      ref={pageRef}
      data-pdf-page={pageNumber}
      className="relative mx-auto flex min-w-full items-center justify-center"
      style={{ height: Math.max((stageWidth - 32) * zoom * aspectRatio, 180) }}
    >
      {visible && rendering && (
        <span className="absolute z-[1] rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-medium text-slate-500 shadow dark:bg-slate-900/90 dark:text-slate-400">
          Memuat halaman {pageNumber}...
        </span>
      )}
      {visible && renderError && (
        <div className="absolute z-[2] flex max-w-[90%] flex-col items-center gap-2 rounded-xl bg-white/95 px-4 py-3 text-center text-xs text-rose-600 shadow dark:bg-slate-900/95 dark:text-rose-400">
          <span>Halaman {pageNumber} gagal ditampilkan: {renderError}</span>
          <button
            type="button"
            onClick={() => setRenderAttempt(value => value + 1)}
            className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white hover:bg-rose-700"
          >
            Coba muat halaman lagi
          </button>
        </div>
      )}
    </div>
  );
}

function PdfPreview({ file }: { file: Blob }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const pagesLayerRef = useRef<HTMLDivElement>(null);
  const pinchPreviewRef = useRef(1);
  const zoomRef = useRef(1);
  const searchRequestRef = useRef(0);
  const pageTextsRef = useRef<Map<number, string>>(new Map());
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [zoom, setZoom] = useState(1);
  const [stageWidth, setStageWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(() => new Set());
  const [pageRatios, setPageRatios] = useState<Record<number, number>>({});
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<PdfSearchHit[]>([]);
  const [searchIndex, setSearchIndex] = useState(-1);
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<{ completed: number; total: number } | null>(null);
  const [focusToken, setFocusToken] = useState(0);

  const currentQuery = useMemo(() => toSearchKey(searchText), [searchText]);
  const searchIsCurrent = searchedQuery === currentQuery;
  const activeHit = searchIsCurrent ? searchResults[searchIndex] : undefined;

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let startDistance = 0;
    let startZoom = 1;

    const distance = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      startDistance = distance(event.touches);
      startZoom = zoomRef.current;
      pinchPreviewRef.current = 1;
      if (pagesLayerRef.current) pagesLayerRef.current.style.transform = 'scale(1)';
      event.preventDefault();
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || startDistance <= 0) return;
      event.preventDefault();
      const nextScale = Math.min(5 / startZoom, Math.max(0.6 / startZoom, distance(event.touches) / startDistance));
      pinchPreviewRef.current = nextScale;
      if (pagesLayerRef.current) pagesLayerRef.current.style.transform = `scale(${nextScale})`;
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length > 0 || startDistance <= 0) return;
      const nextZoom = Math.min(5, Math.max(0.6, startZoom * pinchPreviewRef.current));
      setZoom(nextZoom);
      pinchPreviewRef.current = 1;
      if (nextZoom === startZoom && pagesLayerRef.current) {
        pagesLayerRef.current.style.transform = 'scale(1)';
      }
      startDistance = 0;
    };

    stage.addEventListener('touchstart', onTouchStart, { passive: false });
    stage.addEventListener('touchmove', onTouchMove, { passive: false });
    stage.addEventListener('touchend', onTouchEnd);
    stage.addEventListener('touchcancel', onTouchEnd);
    return () => {
      stage.removeEventListener('touchstart', onTouchStart);
      stage.removeEventListener('touchmove', onTouchMove);
      stage.removeEventListener('touchend', onTouchEnd);
      stage.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  useLayoutEffect(() => {
    if (pagesLayerRef.current) pagesLayerRef.current.style.transform = 'scale(1)';
  }, [zoom]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const observer = new ResizeObserver(entries => {
      setStageWidth(entries[0]?.contentRect.width ?? stage.clientWidth);
    });
    observer.observe(stage);
    setStageWidth(stage.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!document || !stage) return;

    const pages = Array.from(stage.querySelectorAll<HTMLElement>('[data-pdf-page]'));
    if (typeof IntersectionObserver === 'undefined') {
      setVisiblePages(new Set(pages.map(page => Number(page.dataset.pdfPage))));
      return;
    }

    const observer = new IntersectionObserver(entries => {
      setVisiblePages(current => {
        const next = new Set(current);
        for (const entry of entries) {
          const pageNumber = Number(entry.target.getAttribute('data-pdf-page'));
          if (!Number.isInteger(pageNumber)) continue;
          if (entry.isIntersecting) next.add(pageNumber);
          else next.delete(pageNumber);
        }
        return next;
      });
    }, { root: stage, rootMargin: '50% 0px' });

    pages.forEach(page => observer.observe(page));
    return () => observer.disconnect();
  }, [document]);

  useEffect(() => {
    let active = true;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    searchRequestRef.current += 1;
    pageTextsRef.current = new Map();
    setLoading(true);
    setError(null);
    setDocument(null);
    setVisiblePages(new Set());
    setPageRatios({});
    setSearchResults([]);
    setSearchIndex(-1);
    setSearching(false);
    setSearchProgress(null);
    setSearchedQuery(null);
    setSearchError(null);

    void file.arrayBuffer().then(buffer => {
      if (!active) return;
      const bytes = new Uint8Array(buffer);
      if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
        throw new Error('Berkas yang diterima bukan PDF yang valid.');
      }

      return Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]).then(([pdfjs, worker]) => {
        if (!active) return null;
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        loadingTask = pdfjs.getDocument({ data: bytes });
        return loadingTask.promise;
      });
    }).then(async pdf => {
      if (!active || !pdf) return;
      const firstPage = await pdf.getPage(1);
      if (!active) return;
      const firstViewport = firstPage.getViewport({ scale: 1 });
      setPageRatios({ 1: firstViewport.height / firstViewport.width });
      setDocument(pdf);
      setLoading(false);
    }).catch(cause => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : 'PDF tidak dapat dibuka.');
      setLoading(false);
    });

    return () => {
      active = false;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [file]);

  const handlePageAspectRatio = useCallback((pageNumber: number, ratio: number) => {
    setPageRatios(current => current[pageNumber] === ratio ? current : { ...current, [pageNumber]: ratio });
  }, []);

  const runSearch = useCallback(async () => {
    setSearchError(null);
    if (!document || !currentQuery) {
      searchRequestRef.current += 1;
      setSearching(false);
      setSearchProgress(null);
      setSearchResults([]);
      setSearchIndex(-1);
      setSearchedQuery(null);
      return;
    }

    const requestId = ++searchRequestRef.current;
    setSearching(true);
    setSearchProgress({ completed: 0, total: document.numPages });
    try {
      const hits: PdfSearchHit[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        let pageText = pageTextsRef.current.get(pageNumber);
        if (pageText === undefined) {
          const page = await document.getPage(pageNumber);
          const content = await page.getTextContent();
          if (requestId !== searchRequestRef.current) return;
          pageText = buildSearchIndex(
            content.items.map(item => 'str' in item ? item.str : ''),
            false,
          ).text;
          pageTextsRef.current.set(pageNumber, pageText);
        }
        let matchAt = pageText.indexOf(currentQuery);
        let matchIndex = 0;
        while (matchAt >= 0) {
          hits.push({ page: pageNumber, index: matchIndex });
          matchIndex += 1;
          if (matchIndex % 500 === 0) {
            await new Promise<void>(resolve => window.setTimeout(resolve, 0));
            if (requestId !== searchRequestRef.current) return;
          }
          matchAt = pageText.indexOf(currentQuery, matchAt + currentQuery.length);
        }

        if (pageNumber % 12 === 0 || pageNumber === document.numPages) {
          setSearchProgress({ completed: pageNumber, total: document.numPages });
          await new Promise<void>(resolve => window.setTimeout(resolve, 0));
          if (requestId !== searchRequestRef.current) return;
        }
      }
      if (requestId !== searchRequestRef.current) return;
      // Commit hasil bersama query supaya navigasi tidak memakai hasil sebelumnya.
      setSearchResults(hits);
      setSearchIndex(hits.length ? 0 : -1);
      setSearchedQuery(currentQuery);
      setFocusToken(token => token + 1);
    } catch (cause) {
      if (requestId === searchRequestRef.current) {
        setSearchError(cause instanceof Error ? cause.message : 'Pencarian teks PDF gagal.');
      }
    } finally {
      if (requestId === searchRequestRef.current) {
        setSearching(false);
        setSearchProgress(null);
      }
    }
  }, [document, currentQuery]);

  // Pencarian langsung (debounce) saat teks berubah.
  useEffect(() => {
    if (!document) return;
    if (!currentQuery) {
      searchRequestRef.current += 1;
      setSearching(false);
      setSearchProgress(null);
      setSearchResults([]);
      setSearchIndex(-1);
      setSearchedQuery(null);
      setSearchError(null);
      return;
    }
    const timer = window.setTimeout(() => void runSearch(), 180);
    return () => window.clearTimeout(timer);
  }, [document, currentQuery, runSearch]);

  const navigateSearch = (direction: -1 | 1) => {
    if (!searchResults.length) return;
    setSearchIndex((searchIndex + direction + searchResults.length) % searchResults.length);
    setFocusToken(token => token + 1);
  };

  // Pastikan halaman hasil aktif ikut dirender; jika belum, lompat ke halamannya dulu.
  useEffect(() => {
    if (!activeHit) return;
    const pageNumber = activeHit.page;
    setVisiblePages(current => current.has(pageNumber) ? current : new Set(current).add(pageNumber));
    const frame = requestAnimationFrame(() => {
      const page = stageRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${pageNumber}"]`);
      const stage = stageRef.current;
      if (page && stage && page.childElementCount === 0) {
        scrollWithinPdfStage(stage, page.getBoundingClientRect(), 'auto', 'start');
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeHit, focusToken]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-100 dark:bg-slate-950">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-y-1 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          {document ? `${document.numPages} halaman` : 'Dokumen PDF'}
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-0.5">
          <label className="flex min-w-0 items-center gap-1 rounded-lg border border-slate-200 px-2 dark:border-slate-700">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <input
              value={searchText}
              onChange={event => {
                searchRequestRef.current += 1;
                setSearching(false);
                setSearchProgress(null);
                setSearchText(event.target.value);
                setSearchError(null);
              }}
              onKeyDown={event => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (searchResults.length && searchedQuery === currentQuery) navigateSearch(event.shiftKey ? -1 : 1);
                else void runSearch();
              }}
              placeholder="Cari teks"
              aria-label="Cari teks di PDF"
              className="w-16 min-w-0 bg-transparent py-1.5 text-[11px] outline-none placeholder:text-slate-400 sm:w-32 dark:text-slate-200"
            />
            <button type="button" onClick={() => void runSearch()} disabled={!document || searching} aria-label="Cari di PDF" className="text-[10px] font-semibold text-blue-600 disabled:opacity-40 dark:text-blue-400">
              {searching
                ? searchProgress
                  ? `${searchProgress.completed}/${searchProgress.total}`
                  : '...'
                : 'Cari'}
            </button>
          </label>
          {searchIsCurrent && searchResults.length > 0 && (
            <div className="flex items-center gap-0.5 text-[10px] text-slate-500 dark:text-slate-400">
              <span className="min-w-8 text-center tabular-nums">{searchIndex + 1}/{searchResults.length}</span>
              <button type="button" onClick={() => navigateSearch(-1)} aria-label="Hasil PDF sebelumnya" className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronUp className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => navigateSearch(1)} aria-label="Hasil PDF berikutnya" className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronDown className="h-3.5 w-3.5" /></button>
            </div>
          )}
          {searchError && <span className="max-w-24 truncate text-[9px] text-rose-600 dark:text-rose-400" title={searchError}>{searchError}</span>}
          <button
            type="button"
            onClick={() => setZoom(value => Math.max(0.6, Math.round((value - 0.2) * 10) / 10))}
            disabled={zoom <= 0.6}
            className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Perkecil PDF"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="min-w-12 text-center text-[11px] font-semibold tabular-nums text-slate-600 dark:text-slate-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom(value => Math.min(5, Math.round((value + 0.2) * 10) / 10))}
            disabled={zoom >= 5}
            className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Perbesar PDF"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div ref={stageRef} data-pdf-stage className="relative min-h-0 flex-1 overflow-auto overscroll-contain p-2 sm:p-3" style={{ touchAction: 'pan-x pan-y' }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100/90 text-sm font-medium text-slate-500 dark:bg-slate-950/90 dark:text-slate-400">
            Menyiapkan halaman PDF...
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-sm text-rose-600 dark:text-rose-400">
            {error}
          </div>
        )}
        {document && (
          <div ref={pagesLayerRef} className="flex flex-col gap-2" style={{ transformOrigin: 'top center' }}>
            {Array.from({ length: document.numPages }, (_, index) => (
              <PdfPage
                key={index + 1}
                document={document}
                pageNumber={index + 1}
                stageWidth={stageWidth}
                zoom={zoom}
                aspectRatio={pageRatios[index + 1] ?? pageRatios[1] ?? 1.414}
                visible={visiblePages.has(index + 1)}
                searchQuery={searchIsCurrent ? searchedQuery ?? '' : ''}
                activeMatchIndex={activeHit?.page === index + 1 ? activeHit.index : -1}
                focusToken={focusToken}
                onAspectRatio={handlePageAspectRatio}
              />
            ))}
          </div>
        )}
        {document && searchedQuery !== null && searchedQuery === currentQuery && !searchError && !searching && searchResults.length === 0 && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/80 px-3 py-1 text-[10px] text-white">
            Tidak ada hasil
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Spreadsheet                                                         */
/* ------------------------------------------------------------------ */

interface SpreadsheetSearchHit {
  row: number;
  column: number;
  start: number;
  end: number;
}

interface SpreadsheetCellHit {
  start: number;
  end: number;
  index: number;
}

const EMPTY_ROWS: string[][] = [];
const EMPTY_MERGES: SpreadsheetMerge[] = [];
const EMPTY_HITS: SpreadsheetSearchHit[] = [];

const SPREADSHEET_MARK_CLASS = 'box-decoration-clone rounded-[3px] bg-yellow-200 px-px text-slate-900 dark:bg-yellow-400/40 dark:text-yellow-50';
const SPREADSHEET_MARK_ACTIVE_CLASS = 'box-decoration-clone rounded-[3px] bg-orange-400 px-px text-white ring-2 ring-orange-400 dark:bg-orange-500 dark:ring-orange-500';

// Menampilkan teks sel dengan bagian yang cocok dibungkus <mark>, sehingga
// highlight mengikuti persis huruf yang dicari, bukan satu sel penuh.
function renderCellText(value: string, hits: SpreadsheetCellHit[] | undefined, activeIndex: number): ReactNode {
  if (!hits || hits.length === 0) return value;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start < cursor) continue;
    if (hit.start > cursor) parts.push(value.slice(cursor, hit.start));
    const active = hit.index === activeIndex;
    parts.push(
      <mark
        key={hit.index}
        data-search-active={active ? 'true' : undefined}
        className={active ? SPREADSHEET_MARK_ACTIVE_CLASS : SPREADSHEET_MARK_CLASS}
      >
        {value.slice(hit.start, hit.end)}
      </mark>,
    );
    cursor = hit.end;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts;
}

// Scroll ke elemen hasil dengan memperhitungkan kolom nomor baris yang sticky.
function scrollSpreadsheetTarget(container: HTMLElement, target: HTMLElement) {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const stickyWidth = container.querySelector<HTMLElement>('th')?.getBoundingClientRect().width ?? 0;
  const margin = 12;
  const minLeft = containerRect.left + stickyWidth + margin;
  const maxRight = containerRect.right - margin;

  let left = container.scrollLeft;
  if (targetRect.left < minLeft || targetRect.width > maxRight - minLeft) {
    left += targetRect.left - minLeft;
  } else if (targetRect.right > maxRight) {
    left += targetRect.right - maxRight;
  }
  const top = container.scrollTop
    + targetRect.top + targetRect.height / 2
    - (containerRect.top + containerRect.height / 2);

  container.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: 'smooth' });
}

function SpreadsheetPreview({ file }: { file: Blob }) {
  const [sheets, setSheets] = useState<SpreadsheetSheet[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [page, setPage] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SpreadsheetSearchHit[]>(EMPTY_HITS);
  const [searchIndex, setSearchIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<{ completed: number; total: number } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [scrollToken, setScrollToken] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const handledScrollRef = useRef(-1);
  const searchRequestRef = useRef(0);
  const pageSize = 100;

  useEffect(() => {
    let active = true;
    setSheets([]);
    setActiveSheet(0);
    setPage(0);
    setSearchText('');
    setAppliedSearch('');
    setSearchResults(EMPTY_HITS);
    setSearchIndex(-1);
    setSearching(false);
    setSearchProgress(null);
    setSearchError(null);
    searchRequestRef.current += 1;
    setError(null);

    void file.arrayBuffer().then(parseSpreadsheet).then(result => {
      if (active) setSheets(result);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Spreadsheet tidak dapat dibuka.');
    });

    return () => {
      active = false;
    };
  }, [file]);

  // Pencarian langsung (debounce) saat teks berubah.
  useEffect(() => {
    const delay = searchText.trim() ? 150 : 0;
    const timer = window.setTimeout(() => setAppliedSearch(searchText), delay);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const rows = sheets[activeSheet]?.rows ?? EMPTY_ROWS;
  const visibleRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  const merges = sheets[activeSheet]?.merges ?? EMPTY_MERGES;
  const pageStart = page * pageSize;
  const pageEnd = Math.min(rows.length - 1, (page + 1) * pageSize - 1);
  const columnCount = Math.max(
    1,
    visibleRows.reduce((count, row) => Math.max(count, row.length), 0),
    merges.reduce((count, merge) => Math.max(count, merge.endColumn + 1), 0),
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const visibleMerges = useMemo(() => {
    const rows = new Map<number, SpreadsheetMerge[]>();
    for (const merge of merges) {
      const startRow = Math.max(merge.startRow, pageStart);
      const endRow = Math.min(merge.endRow, pageEnd);
      if (startRow > endRow) continue;
      for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
        const rowMerges = rows.get(rowIndex);
        if (rowMerges) rowMerges.push(merge);
        else rows.set(rowIndex, [merge]);
      }
    }
    rows.forEach(rowMerges => rowMerges.sort((left, right) => left.startColumn - right.startColumn));
    return rows;
  }, [merges, pageStart, pageEnd]);

  // Build results in chunks so searching large sheets does not block scrolling or input.
  useEffect(() => {
    const requestId = ++searchRequestRef.current;
    const query = toSearchKey(appliedSearch);
    setSearchError(null);
    setSearchResults(EMPTY_HITS);
    setSearchIndex(-1);
    if (!query || !rows.length) {
      setSearching(false);
      setSearchProgress(null);
      return;
    }

    const total = rows.reduce((count, row) => count + row.length, 0);
    const hits: SpreadsheetSearchHit[] = [];
    setSearching(true);
    setSearchProgress({ completed: 0, total });

    const search = async () => {
      let completed = 0;
      try {
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
          const row = rows[rowIndex];
          for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
            const value = row[columnIndex];
            if (value && toSearchKey(value).includes(query)) {
              for (const match of findSearchMatches(buildSearchIndex([value]), query)) {
                const segment = match[0];
                if (segment) hits.push({ row: rowIndex, column: columnIndex, start: segment.start, end: segment.end });
              }
            }

            completed += 1;
            if (completed % 500 === 0 || completed === total) {
              setSearchProgress({ completed, total });
              await new Promise<void>(resolve => window.setTimeout(resolve, 0));
              if (requestId !== searchRequestRef.current) return;
            }
          }
        }
        if (requestId === searchRequestRef.current) {
          setSearchResults(hits.length ? hits : EMPTY_HITS);
        }
      } catch (cause) {
        if (requestId === searchRequestRef.current) {
          setSearchError(cause instanceof Error ? cause.message : 'Pencarian spreadsheet gagal.');
        }
      } finally {
        if (requestId === searchRequestRef.current) {
          setSearching(false);
          setSearchProgress(null);
        }
      }
    };

    void search();
    return () => {
      if (searchRequestRef.current === requestId) searchRequestRef.current += 1;
    };
  }, [rows, merges, appliedSearch]);

  const hitsByCell = useMemo(() => {
    const map = new Map<string, SpreadsheetCellHit[]>();
    searchResults.forEach((hit, index) => {
      const key = `${hit.row}:${hit.column}`;
      const list = map.get(key);
      const cellHit = { start: hit.start, end: hit.end, index };
      if (list) list.push(cellHit);
      else map.set(key, [cellHit]);
    });
    return map;
  }, [searchResults]);

  const activeResult: SpreadsheetSearchHit | undefined = searchResults[searchIndex];
  const activeSearchCellKey = activeResult ? `${activeResult.row}:${activeResult.column}` : null;
  const searchInputPending = toSearchKey(searchText) !== toSearchKey(appliedSearch);

  // Hasil berubah (ketik, ganti lembar) -> otomatis ke hasil pertama.
  useEffect(() => {
    setSearchIndex(searchResults.length ? 0 : -1);
    setScrollToken(token => token + 1);
  }, [searchResults]);

  // Pindah ke halaman yang memuat hasil aktif.
  useEffect(() => {
    if (!activeResult) return;
    setPage(Math.floor(activeResult.row / pageSize));
  }, [activeResult, scrollToken]);

  // Setelah halaman dirender, scroll tepat ke teks yang cocok.
  useEffect(() => {
    if (!activeResult || handledScrollRef.current === scrollToken) return;
    const container = scrollRef.current;
    if (!container) return;
    const cell = container.querySelector<HTMLElement>(
      `[data-spreadsheet-row="${activeResult.row}"] [data-spreadsheet-column="${activeResult.column}"]`,
    );
    if (!cell) return;
    const target = cell.querySelector<HTMLElement>('mark[data-search-active="true"]') ?? cell;
    handledScrollRef.current = scrollToken;
    scrollSpreadsheetTarget(container, target);
  }, [activeResult, scrollToken, page, searchIndex]);

  const moveSearch = (direction: -1 | 1) => {
    if (!searchResults.length) return;
    setSearchIndex(index => index < 0
      ? direction === 1 ? 0 : searchResults.length - 1
      : (index + direction + searchResults.length) % searchResults.length);
    setScrollToken(token => token + 1);
  };

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-rose-600 dark:text-rose-400">
        {error}
      </div>
    );
  }

  if (!sheets.length) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        Membuka spreadsheet...
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-slate-950">
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sheets.map((sheet, index) => (
            <button
              key={`${sheet.name}-${index}`}
              type="button"
              onClick={() => {
                setActiveSheet(index);
                setPage(0);
                setSearchIndex(-1);
              }}
              className={`max-w-48 shrink-0 truncate rounded-lg px-3 py-1.5 text-xs font-semibold ${
                activeSheet === index
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                  : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
        <span className="shrink-0 text-[10px] text-slate-500 dark:text-slate-400">
          {rows.length.toLocaleString('id-ID')} baris
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-1.5 dark:border-slate-800">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-slate-200 px-2 dark:border-slate-700">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <input
            value={searchText}
            onChange={event => {
              searchRequestRef.current += 1;
              setSearchResults(EMPTY_HITS);
              setSearchIndex(-1);
              setSearching(false);
              setSearchProgress(null);
              setSearchError(null);
              setSearchText(event.target.value);
            }}
            onKeyDown={event => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (appliedSearch !== searchText) setAppliedSearch(searchText);
              else moveSearch(event.shiftKey ? -1 : 1);
            }}
            placeholder="Cari di spreadsheet"
            aria-label="Cari di spreadsheet"
            className="min-w-0 flex-1 bg-transparent py-1 text-[11px] outline-none placeholder:text-slate-400 dark:text-slate-200"
          />
        </label>
        <span aria-live="polite" className="shrink-0 text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
          {searchError ?? (searching
            ? searchProgress
              ? `${searchProgress.completed}/${searchProgress.total}`
              : 'Mencari...'
            : searchInputPending
              ? 'Menunggu...'
              : searchResults.length
                ? `${searchIndex + 1}/${searchResults.length}`
                : appliedSearch.trim()
                  ? '0 hasil'
                  : '')}
        </span>
        <button type="button" onClick={() => moveSearch(-1)} disabled={!searchResults.length || searching || searchInputPending} aria-label="Hasil spreadsheet sebelumnya" className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"><ChevronUp className="h-4 w-4" /></button>
        <button type="button" onClick={() => moveSearch(1)} disabled={!searchResults.length || searching || searchInputPending} aria-label="Hasil spreadsheet berikutnya" className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"><ChevronDown className="h-4 w-4" /></button>
        <div className="ml-1 flex shrink-0 items-center gap-0.5 border-l border-slate-200 pl-1 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setZoom(value => Math.max(0.5, Math.round((value - 0.1) * 10) / 10))}
            disabled={zoom <= 0.5}
            aria-label="Perkecil spreadsheet"
            className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="min-w-10 text-center text-[10px] tabular-nums text-slate-600 dark:text-slate-300">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom(value => Math.min(2, Math.round((value + 0.1) * 10) / 10))}
            disabled={zoom >= 2}
            aria-label="Perbesar spreadsheet"
            className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto overscroll-contain" style={{ touchAction: 'pan-x pan-y' }}>
        <table style={{ zoom }} className="min-w-full w-max border-separate border-spacing-0 text-left text-xs">
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr key={`${page}-${rowIndex}`} data-spreadsheet-row={pageStart + rowIndex} className="group">
                <th className="sticky left-0 z-[1] border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-right font-mono text-[10px] font-medium text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
                  {pageStart + rowIndex + 1}
                </th>
                {Array.from({ length: columnCount }, (_, columnIndex) => (
                  (() => {
                    const absoluteRow = pageStart + rowIndex;
                    const merge = visibleMerges.get(absoluteRow)?.find(candidate =>
                      columnIndex >= candidate.startColumn && columnIndex <= candidate.endColumn,
                    );
                    const cellKey = `${absoluteRow}:${columnIndex}`;
                    if (merge) {
                      if (columnIndex !== merge.startColumn) return null;
                      const rowSpan = Math.min(merge.endRow, pageEnd) - Math.max(merge.startRow, pageStart) + 1;
                      return (
                        <td
                          key={columnIndex}
                          rowSpan={rowSpan}
                          colSpan={Math.min(merge.endColumn, columnCount - 1) - merge.startColumn + 1}
                          data-spreadsheet-column={columnIndex}
                          className={`max-w-[32rem] whitespace-pre-wrap border-b border-r border-slate-100 px-3 py-2 align-top text-slate-700 group-hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:group-hover:bg-slate-900/70 ${
                            merge.startRow < pageStart ? 'text-transparent' : ''
                          } ${
                            activeSearchCellKey === cellKey
                              ? 'bg-amber-50 dark:bg-amber-500/10'
                              : ''
                          }`}
                        >
                          {merge.startRow < pageStart
                            ? ''
                            : renderCellText(row[columnIndex] ?? '', hitsByCell.get(cellKey), searchIndex)}
                        </td>
                      );
                    }
                    return (
                      <td
                        key={columnIndex}
                        data-spreadsheet-column={columnIndex}
                        className={`max-w-[32rem] whitespace-pre-wrap border-b border-r border-slate-100 px-3 py-2 align-top text-slate-700 group-hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:group-hover:bg-slate-900/70 ${
                          activeSearchCellKey === cellKey ? 'bg-amber-50 dark:bg-amber-500/10' : ''
                        }`}
                      >
                        {renderCellText(row[columnIndex] ?? '', hitsByCell.get(cellKey), searchIndex)}
                      </td>
                    );
                  })()
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-slate-200 px-3 py-2 dark:border-slate-800">
        <span className="text-[10px] text-slate-500 dark:text-slate-400">
          Baris {rows.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, rows.length)} dari {rows.length}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPage(value => Math.max(0, value - 1))}
            disabled={page === 0}
            className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Halaman spreadsheet sebelumnya"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-12 text-center text-[10px] font-medium tabular-nums text-slate-600 dark:text-slate-300">
            {page + 1} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage(value => Math.min(pageCount - 1, value + 1))}
            disabled={page >= pageCount - 1}
            className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Halaman spreadsheet berikutnya"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ReportDocumentPreview({ file, format }: ReportDocumentPreviewProps) {
  return format === 'pdf' ? <PdfPreview file={file} /> : <SpreadsheetPreview file={file} />;
}