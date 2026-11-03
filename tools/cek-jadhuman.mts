import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildSearchIndex, countSearchMatches, findSearchMatches } from '../src/lib/documentSearch';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
let failures = 0;

const check = (name: string, passed: boolean, detail = '') => {
  console.log(`${passed ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!passed) failures++;
};

const walkSource = (directory: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== 'data') files.push(...walkSource(join(directory, entry.name)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
};

const app = read('src/App.tsx');
const pageBlock = app.match(/const PAGES(?:\s*:\s*PageDefinition\[\])?\s*=\s*\[([\s\S]*?)\n\];/)?.[1] ?? '';
const pageIds = [...pageBlock.matchAll(/\bid:\s*'([^']+)'/g)].map((match) => match[1]);
const importerBlock = app.match(/const pageImporters = \{([\s\S]*?)\}\s+satisfies/)?.[1] ?? '';
const importerIds = [...importerBlock.matchAll(/^\s*(tab\w+):/gm)].map((match) => match[1]);
const duplicatePageIds = pageIds.filter((id, index) => pageIds.indexOf(id) !== index);
const unimportedPages = pageIds.filter((id) => id !== 'tabLogin' && !importerIds.includes(id));

check('menu punya ID unik', pageIds.length > 0 && duplicatePageIds.length === 0, duplicatePageIds.join(', '));
check('setiap menu lazy page punya importer', unimportedPages.length === 0, unimportedPages.join(', '));
check('login memakai komponen LoginServer langsung', /component:\s*LoginServer/.test(pageBlock));

const handlerBlock = read('src-tauri/src/lib.rs').match(/generate_handler!\s*\[([\s\S]*?)\]/)?.[1] ?? '';
const registeredCommands = new Set([...handlerBlock.matchAll(/\b([a-z][a-z0-9_]*)\s*,?/g)].map((match) => match[1]));
const sourceFiles = walkSource('src');
const invokedCommands = new Set<string>();
for (const file of sourceFiles) {
  const source = read(file);
  for (const match of source.matchAll(/invoke(?:<[^>]+>)?\(\s*['"]([a-z][a-z0-9_]*)['"]/g)) {
    invokedCommands.add(match[1]);
  }
}
const missingCommands = [...invokedCommands].filter((command) => !registeredCommands.has(command));
const unusedCommands = [...registeredCommands].filter((command) => !invokedCommands.has(command));
check('semua invoke terdaftar di Rust', missingCommands.length === 0, missingCommands.join(', '));
check('semua command Rust punya pemanggil frontend', unusedCommands.length === 0, unusedCommands.join(', '));

const localStorageCallers = sourceFiles.filter((file) =>
  file !== 'src/lib/appStorage.ts' && /(?:window\.)?localStorage\s*\./.test(read(file)),
);
check('localStorage hanya dipakai adapter migrasi', localStorageCallers.length === 0, localStorageCallers.join(', '));
check('aplikasi menunggu IndexedDB sebelum render', /initializeAppStorage\(\)\.then\(renderApp\)/.test(read('src/main.tsx')));
check('sesi Tauri memakai adapter IndexedDB', /isTauriRuntime\(\)\s*\?\s*appStorage/.test(read('src/lib/sessionManager.ts')));

const androidPatch = read('tools/patch-android-native.mts');
const css = read('src/index.css');
const main = read('src/main.tsx');
const html = read('index.html');
check('system bar transparan dan kontras mengikuti tema',
  androidPatch.includes('window.statusBarColor = Color.TRANSPARENT') &&
  androidPatch.includes('window.navigationBarColor = Color.TRANSPARENT') &&
  androidPatch.includes('controller.isAppearanceLightStatusBars = !isDark') &&
  androidPatch.includes('controller.isAppearanceLightNavigationBars = !isDark'),
);
check('overlay gelap mempertahankan ikon system bar putih',
  androidPatch.includes('fun setDarkOverlay(active: Boolean)') &&
  androidPatch.includes('appThemeDark || darkOverlayActive') &&
  read('src/lib/nativeSystemBars.ts').includes('setDarkOverlay?.(activeDarkOverlays > 0)'),
);
const instansiHistory = read('src/pages/LogPresensiInstansi.tsx');
check('history instansi menjaga NIP satu baris dan menghapus kolom OPD',
  instansiHistory.includes('min-w-[760px]') &&
  instansiHistory.includes('whitespace-nowrap">NIP</th>') &&
  !instansiHistory.includes('>OPD</th>'),
);
check('Android mengirim inset ke safe-area CSS',
  androidPatch.includes("setProperty('--sat', top)") &&
  androidPatch.includes("setProperty('--sab', bot)") &&
  css.includes('body.is-native .poni-sidebar') &&
  css.includes('body.is-native .login-screen'),
);
check('startup Android menunggu safe area sebelum render',
  androidPatch.includes("document.readyState !== 'complete'") &&
  androidPatch.includes("dispatchEvent(new Event('jadhuman-safe-area-ready'))") &&
  main.includes('await waitForNativeSafeArea()') &&
  html.includes('__JADHUMAN_SAFE_AREA_REQUIRED__'),
);
check('pemuatan database pegawai memiliki batas retry dan error UI',
  read('src/lib/pegawaiData.ts').includes('attempt <= RETRY_DELAYS_MS.length') &&
  read('src/pages/Presensi.tsx').includes('Database pegawai gagal dimuat.') &&
  read('src/pages/Produktivitas.tsx').includes('Database pegawai gagal dimuat.'),
);
check('form login Android menyesuaikan keyboard tanpa menimpa status bar',
  read('src/components/LoginScreen.tsx').includes('const viewport = window.visualViewport') &&
  read('src/components/LoginScreen.tsx').includes("viewport.addEventListener('resize'") &&
  !read('src/components/LoginScreen.tsx').includes('scrollIntoView') &&
  !read('src/components/LoginScreen.tsx').includes('bg-emerald-500/10 dark:bg-emerald-500/15') &&
  css.includes('.login-screen.login-keyboard-open') &&
  css.includes('top: var(--login-viewport-top, 0px)') &&
  read('src/components/LoginScreen.tsx').includes('translate-y-2') &&
  !css.includes('zoom: 0.76'),
);
check('modal akun dan konfirmasi logout tampil di atas semua menu',
  read('src/components/SettingAkunModal.tsx').includes('createPortal(') &&
  read('src/App.tsx').includes('isLogoutConfirmOpen && createPortal(') &&
  read('src/App.tsx').includes('dialog.showModal()') &&
  read('src/App.tsx').includes('z-[2147483647]') &&
  read('src/components/AccountMenu.tsx').includes('createPortal(') &&
  read('src/components/AccountMenu.tsx').includes('z-[2147482000]') &&
  read('src/App.tsx').includes('setIsLogoutConfirmOpen(true)') &&
  read('src/App.tsx').includes('handleLogout'),
);
const reportPreview = read('src/components/ui/ReportDocumentPreview.tsx');
check('viewer PDF menavigasi hasil tanpa highlight dan membatasi penggunaan memori',
  reportPreview.includes('baseViewport.height / baseViewport.width') &&
  reportPreview.includes("addEventListener('touchmove'") &&
  reportPreview.includes('page.getTextContent()') &&
  reportPreview.includes('data-pdf-page') &&
  reportPreview.includes('buildSearchIndex(textDivs.map(div => div.textContent ?? \'\'))') &&
  reportPreview.includes('findSearchMatches(index, searchQuery)') &&
  reportPreview.includes("scrollWithinPdfStage(stage, rect, 'smooth', 'center')") &&
  !reportPreview.includes('pdf-search-layer') &&
  !css.includes('pdf-search-highlight') &&
  reportPreview.includes('MAX_PDF_CANVAS_PIXELS') &&
  reportPreview.includes('textContainer.style.width') &&
  reportPreview.includes('pageNumber % 12 === 0') &&
  reportPreview.includes('searchRequestRef.current += 1') &&
  reportPreview.includes('Math.min(5 / startZoom') &&
  reportPreview.includes('Math.min(5, Math.round((value + 0.2) * 10) / 10)'),
);
check('viewer spreadsheet mempertahankan merge cells dan pencarian bertahap',
  reportPreview.includes("['!merges']") &&
  reportPreview.includes('rowSpan={rowSpan}') &&
  reportPreview.includes('colSpan={Math.min(merge.endColumn, columnCount - 1) - merge.startColumn + 1}') &&
  reportPreview.includes('Cari di spreadsheet') &&
  reportPreview.includes('toSearchKey(value).includes(query)') &&
  reportPreview.includes('completed % 500 === 0') &&
  reportPreview.includes('Pencarian spreadsheet gagal.') &&
  reportPreview.includes('setZoom(value => Math.min(2') &&
  reportPreview.includes('style={{ zoom }}') &&
  reportPreview.includes('activeSearchCellKey === cellKey') &&
  !reportPreview.includes('searchMatchIndexes') &&
  !reportPreview.includes('ring-2 ring-inset ring-amber-400') &&
  !reportPreview.includes('ring-2 ring-inset ring-blue-500'),
);
check('merge spreadsheet tidak diperluas menjadi satu entri per sel',
  reportPreview.includes('activeMerges = activeMerges.filter') &&
  reportPreview.includes('const rows = new Map<number, SpreadsheetMerge[]>()') &&
  reportPreview.includes('merges.reduce((count, merge)') &&
  !reportPreview.includes('...merges.map(') &&
  !reportPreview.includes('occupied.add('),
);
const splitSourceMatch = findSearchMatches(buildSearchIndex(['Alpha', 'Beta']), 'hab')[0] ?? [];
const accentedMatch = findSearchMatches(buildSearchIndex(['Cafe\u0301']), 'cafe')[0]?.[0];
check('indeks pencarian menjaga batas sumber dan offset Unicode',
  splitSourceMatch.length === 2 &&
  splitSourceMatch[0].source === 0 &&
  splitSourceMatch[0].start === 3 &&
  splitSourceMatch[0].end === 5 &&
  splitSourceMatch[1].source === 1 &&
  splitSourceMatch[1].start === 0 &&
  splitSourceMatch[1].end === 1 &&
  accentedMatch?.start === 0 &&
  accentedMatch.end === 5 &&
  findSearchMatches(buildSearchIndex(['banana']), 'a').length === 3 &&
  countSearchMatches('banana', '') === 0,
);
const developerInspector = read('src/components/DeveloperInspector.tsx');
check('Developer Inspector membungkus payload panjang tanpa overflow mobile',
  developerInspector.includes('whitespace-pre-wrap break-all') &&
  developerInspector.includes('developer-inspector-payload') &&
  css.includes('.developer-inspector-payload') &&
  css.includes('overflow-wrap: anywhere') &&
  developerInspector.includes('w-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden'),
);
check('splash memakai drawable logo khusus Jadhuman',
  androidPatch.includes('res/drawable-nodpi/splash_icon.png') &&
  androidPatch.includes('android:src="@drawable/splash_icon"'),
);

const rust = read('src-tauri/src/lib.rs');
check('tidak ada TLS verification dimatikan secara global', !rust.includes('NODE_TLS_REJECT_UNAUTHORIZED'));
check('tidak ada panic/TODO stub di Rust', !/\b(?:todo|unimplemented)!\s*\(/.test(rust));

const packageJson = JSON.parse(read('package.json')) as { engines?: { node?: string } };
check('versi Node proyek dideklarasikan', packageJson.engines?.node === '22.x', packageJson.engines?.node ?? 'missing');

console.log(`\n${failures === 0 ? 'SEMUA LULUS' : `${failures} CHECK GAGAL`} — ${relative(root, process.cwd()) || 'Jadhuman'}`);
process.exitCode = failures === 0 ? 0 : 1;
