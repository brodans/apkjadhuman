import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

export type PegawaiSearchItem = {
  nama?: string | null;
  nip?: string | number | null;
  [key: string]: any;
};

interface UsePegawaiSearchOptions {
  maxResults?: number;
  showAllWhenEmpty?: boolean;
}

export function usePegawaiSearch<T extends PegawaiSearchItem>(
  pegawaiList: T[],
  { maxResults, showAllWhenEmpty = true }: UsePegawaiSearchOptions = {}
) {
  const [selectedPegawai, setSelectedPegawai] = useState<T | null>(null);
  const [searchPegawai, setSearchPegawai] = useState('');
  const deferredSearchPegawai = useDeferredValue(searchPegawai);
  const [showPegawaiDropdown, setShowPegawaiDropdown] = useState(false);
  const pegawaiDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pegawaiDropdownRef.current && !pegawaiDropdownRef.current.contains(event.target as Node)) {
        setShowPegawaiDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredPegawai = useMemo(() => {
    const query = deferredSearchPegawai.trim().toLowerCase();
    if (!showAllWhenEmpty && !query) return [];

    const matches: T[] = [];
    for (const pegawai of pegawaiList) {
      const nama = String(pegawai.nama ?? '').toLowerCase();
      const nip = String(pegawai.nip ?? '').toLowerCase();
      if (nama.includes(query) || nip.includes(query)) {
        matches.push(pegawai);
        if (typeof maxResults === 'number' && matches.length >= maxResults) break;
      }
    }

    return matches;
  }, [pegawaiList, deferredSearchPegawai, maxResults, showAllWhenEmpty]);

  return {
    selectedPegawai,
    setSelectedPegawai,
    searchPegawai,
    setSearchPegawai,
    showPegawaiDropdown,
    setShowPegawaiDropdown,
    pegawaiDropdownRef,
    filteredPegawai,
  };
}
