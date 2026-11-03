import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react';
import { getTodayWIB } from '../../lib/dateFormatter';
import { useAppContext } from '../../context/AppContext';

interface DatePickerProps {
  label?: string;
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  className?: string;
}

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const SHORT_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'];

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

const parseLocalDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const formatLocalYYYYMMDD = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

interface CustomDropdownProps<T> {
  value: T;
  onChange: (val: T) => void;
  options: { label: string; value: T; shortLabel?: string }[];
  className?: string;
  dropdownWidthClass?: string;
}

function CustomDropdown<T extends string | number>({
  value,
  onChange,
  options,
  className = '',
}: CustomDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const GAP = 4;
  const MARGIN = 8;
  const EST_H = 224;

  const placeMenu = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const devOffset = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dev-panel-right-offset') || '0');
    const usableWidth = Math.max(vw - devOffset, 0);
    const width = Math.max(rect.width, 96);
    const menuH = menuRef.current?.offsetHeight || EST_H;

    let left = rect.left;
    if (left + width > usableWidth - MARGIN) left = Math.max(MARGIN, usableWidth - width - MARGIN);
    if (left < MARGIN) left = MARGIN;

    const spaceBelow = vh - rect.bottom - MARGIN;
    const spaceAbove = rect.top - MARGIN;
    const openBelow = spaceBelow >= menuH || spaceBelow >= spaceAbove;

    let top: number;
    if (openBelow) {
      top = rect.bottom + GAP;
      if (top + menuH > vh - MARGIN) top = Math.max(MARGIN, vh - MARGIN - menuH);
    } else {
      top = rect.top - GAP - menuH;
      if (top < MARGIN) top = MARGIN;
    }

    setMenuStyle({
      position: 'fixed',
      top,
      left,
      width,
      maxHeight: Math.min(EST_H, vh - MARGIN * 2),
      zIndex: 10000,
    });
  }, []);

  const openMenu = () => {
    placeMenu();
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;
    const id = requestAnimationFrame(() => placeMenu());
    return () => cancelAnimationFrame(id);
  }, [isOpen, placeMenu]);

  useEffect(() => {
    if (!isOpen) return;
    const onOutside = (event: MouseEvent) => {
      if (
        containerRef.current && !containerRef.current.contains(event.target as Node) &&
        menuRef.current && !menuRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    window.addEventListener('scroll', placeMenu, true);
    window.addEventListener('resize', placeMenu);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      window.removeEventListener('scroll', placeMenu, true);
      window.removeEventListener('resize', placeMenu);
    };
  }, [isOpen, placeMenu]);

  const selectedOption = options.find(opt => opt.value === value) || options[0];

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
        className="w-full min-w-0 flex items-center justify-between bg-slate-50 dark:bg-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-900 dark:text-white border border-slate-300 dark:border-slate-600 rounded-xl px-1.5 sm:px-2.5 py-2 text-[10px] xs:text-[11px] sm:text-xs font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all cursor-pointer text-left shadow-xs gap-1"
      >
        <span className="min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
          <span className="sm:hidden">{selectedOption?.shortLabel || selectedOption?.label}</span>
          <span className="hidden sm:inline">{selectedOption?.label}</span>
        </span>
        <ChevronDown className={`w-3 h-3 sm:w-3.5 sm:h-3.5 text-slate-400 dark:text-slate-500 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180 text-blue-500' : ''}`} />
      </button>

      {isOpen && createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          className="overflow-y-auto bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-1 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600"
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-2.5 py-2 text-[11px] sm:text-xs font-medium transition-colors flex items-center justify-between ${
                  isSelected
                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-bold'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }`}
              >
                <span className="whitespace-nowrap overflow-hidden text-ellipsis">{opt.label}</span>
                {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400 shrink-0 ml-1.5" />}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

export default function DatePicker({ label, value, onChange, className = '' }: DatePickerProps) {
  const { datePickerStyle } = useAppContext();

  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<'days' | 'months' | 'years'>('days');
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});
  const [openAbove, setOpenAbove] = useState(false);

  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = value ? parseLocalDate(value) : parseLocalDate(getTodayWIB());
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const GAP = 4;
  const MARGIN = 8;
  const POPUP_WIDTH = 290;
  const EST_HEIGHT = 360;

  // Posisi: nempel kolom, flip atas/bawah agar selalu full di viewport
  const calculatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const devOffset = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dev-panel-right-offset') || '0');
    const usableWidth = Math.max(vw - devOffset, 280);
    const popupH = popupRef.current?.offsetHeight || EST_HEIGHT;

    const popupWidth = Math.min(POPUP_WIDTH, Math.max(usableWidth - MARGIN * 2, 220));
    const maxLeft = Math.max(MARGIN, usableWidth - popupWidth - MARGIN);
    const left = Math.min(Math.max(rect.left, MARGIN), maxLeft);

    const spaceBelow = vh - rect.bottom - MARGIN;
    const spaceAbove = rect.top - MARGIN;

    // Prefer bawah jika muat penuh; jika kolom di bawah → buka ke atas
    let below: boolean;
    if (spaceBelow >= popupH) below = true;
    else if (spaceAbove >= popupH) below = false;
    else below = spaceBelow >= spaceAbove;

    let top: number;
    if (below) {
      top = rect.bottom + GAP;
      // Pastikan penuh di viewport
      if (top + popupH > vh - MARGIN) {
        top = Math.max(MARGIN, vh - MARGIN - popupH);
      }
    } else {
      top = rect.top - GAP - popupH;
      if (top < MARGIN) top = MARGIN;
      // Pastikan penuh
      if (top + popupH > vh - MARGIN) {
        top = Math.max(MARGIN, vh - MARGIN - popupH);
      }
    }

    setOpenAbove(!below);
    setPopupStyle({
      position: 'fixed',
      top,
      left,
      width: popupWidth,
      maxHeight: vh - MARGIN * 2,
      transformOrigin: below ? 'top left' : 'bottom left',
      zIndex: 9999,
    });
  }, []);

  const handleOpen = () => {
    calculatePosition();
    setIsOpen(true);
  };

  // Reposisi setelah render (tinggi aktual) & saat scroll/resize
  useEffect(() => {
    if (!isOpen) return;
    const id = requestAnimationFrame(() => {
      calculatePosition();
      // second pass setelah font/layout settle
      requestAnimationFrame(calculatePosition);
    });
    return () => cancelAnimationFrame(id);
  }, [isOpen, view, calculatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        popupRef.current && !popupRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    window.addEventListener('scroll', calculatePosition, true);
    window.addEventListener('resize', calculatePosition);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      window.removeEventListener('scroll', calculatePosition, true);
      window.removeEventListener('resize', calculatePosition);
    };
  }, [isOpen, calculatePosition]);

  useEffect(() => {
    if (isOpen && value) {
      const d = parseLocalDate(value);
      setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    }
    if (!isOpen) setView('days');
  }, [isOpen, value]);

  if (datePickerStyle === 'klasik') {
    const dateObj = value ? parseLocalDate(value) : parseLocalDate(getTodayWIB());
    const selectedYear = dateObj.getFullYear();
    const selectedMonth = dateObj.getMonth() + 1;
    const selectedDay = dateObj.getDate();
    const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
    const daysInMonthArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    const handleDayChange = (newDay: number) => {
      onChange(`${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(newDay).padStart(2, '0')}`);
    };
    const handleMonthChange = (newMonth: number) => {
      const maxDays = new Date(selectedYear, newMonth, 0).getDate();
      onChange(`${selectedYear}-${String(newMonth).padStart(2, '0')}-${String(Math.min(selectedDay, maxDays)).padStart(2, '0')}`);
    };
    const handleYearChange = (newYear: number) => {
      const maxDays = new Date(newYear, selectedMonth, 0).getDate();
      onChange(`${newYear}-${String(selectedMonth).padStart(2, '0')}-${String(Math.min(selectedDay, maxDays)).padStart(2, '0')}`);
    };

    const dayOptions = daysInMonthArray.map(d => ({ label: String(d).padStart(2, '0'), value: d }));
    const monthOptions = MONTH_NAMES.map((m, index) => ({
      label: m,
      shortLabel: SHORT_MONTH_NAMES[index],
      value: index + 1,
    }));
    const yearOptions = Array.from({ length: 16 }, (_, i) => 2020 + i).map(y => ({ label: String(y), value: y }));

    return (
      <div className={`flex flex-col gap-1 relative z-20 focus-within:z-50 ${className}`}>
        {label && <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{label}</label>}
        <div className="flex items-center gap-1.5 w-full relative z-30">
          <CustomDropdown value={selectedDay} onChange={handleDayChange} options={dayOptions} className="flex-[1.2] min-w-[44px] xs:min-w-[52px] sm:min-w-[58px]" />
          <CustomDropdown value={selectedMonth} onChange={handleMonthChange} options={monthOptions} className="flex-[2.2] min-w-[80px] xs:min-w-[95px] sm:min-w-[105px]" />
          <CustomDropdown value={selectedYear} onChange={handleYearChange} options={yearOptions} className="flex-[1.5] min-w-[62px] xs:min-w-[70px] sm:min-w-[78px]" />
        </div>
      </div>
    );
  }

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const generateDays = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const days: { day: number; isCurrentMonth: boolean; date: Date }[] = [];

    for (let i = 0; i < firstDay; i++) {
      days.push({
        day: daysInPrevMonth - firstDay + i + 1,
        isCurrentMonth: false,
        date: new Date(year, month - 1, daysInPrevMonth - firstDay + i + 1),
      });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ day: i, isCurrentMonth: true, date: new Date(year, month, i) });
    }
    const totalNeeded = days.length <= 35 ? 35 : 42;
    for (let i = 1; i <= totalNeeded - days.length; i++) {
      days.push({ day: i, isCurrentMonth: false, date: new Date(year, month + 1, i) });
    }
    return days;
  };

  const handleSelectDate = (date: Date) => {
    onChange(formatLocalYYYYMMDD(date));
    setIsOpen(false);
  };

  const displayDate = value
    ? (() => {
        const dt = parseLocalDate(value);
        return `${dt.getDate()} ${MONTH_NAMES[dt.getMonth()]} ${dt.getFullYear()}`;
      })()
    : 'Pilih Tanggal';

  const calendarPopup = isOpen && createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={() => setIsOpen(false)} />
      <div
        ref={popupRef}
        style={popupStyle}
        className={`bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col ${
          openAbove ? 'animate-in fade-in slide-in-from-bottom-1 duration-150' : 'animate-in fade-in slide-in-from-top-1 duration-150'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-slate-200 dark:border-slate-700 gap-2 bg-slate-50/50 dark:bg-slate-800/50 shrink-0">
          <span className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
            <CalendarIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            Pilih
          </span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={handlePrevMonth} className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors flex-shrink-0">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div className="flex gap-0.5">
              <button
                type="button"
                onClick={() => setView(view === 'months' ? 'days' : 'months')}
                className={`px-1.5 py-0.5 rounded-md font-bold transition-colors text-[10px] sm:text-[11px] ${view === 'months' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-white'}`}
              >
                <span className="sm:hidden">{SHORT_MONTH_NAMES[currentMonth.getMonth()]}</span>
                <span className="hidden sm:inline">{MONTH_NAMES[currentMonth.getMonth()]}</span>
              </button>
              <button
                type="button"
                onClick={() => setView(view === 'years' ? 'days' : 'years')}
                className={`px-1.5 py-0.5 rounded-md font-bold transition-colors text-[10px] sm:text-[11px] ${view === 'years' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-white'}`}
              >
                {currentMonth.getFullYear()}
              </button>
            </div>
            <button type="button" onClick={handleNextMonth} className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors flex-shrink-0">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <button type="button" onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 overflow-y-auto custom-scrollbar flex-1 min-h-0">
          {view === 'days' && (
            <>
              <div className="grid grid-cols-7 gap-0.5 mb-1.5">
                {DAYS.map(day => (
                  <div key={day} className="text-center text-[10px] font-bold text-slate-400 dark:text-slate-500 py-0.5">
                    {day}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {generateDays().map((d, i) => {
                  const dayStr = formatLocalYYYYMMDD(d.date);
                  const isSelected = value && dayStr === value;
                  const isToday = getTodayWIB() === dayStr;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSelectDate(d.date)}
                      className={`
                        h-7 w-7 sm:h-8 sm:w-8 rounded-full flex items-center justify-center text-[11px] sm:text-xs font-semibold transition-colors mx-auto
                        ${!d.isCurrentMonth ? 'text-slate-300 dark:text-slate-600' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'}
                        ${isSelected ? '!bg-blue-600 !text-white hover:!bg-blue-700 shadow-sm' : ''}
                        ${isToday && !isSelected ? 'border border-blue-400 dark:border-blue-500 text-blue-600 dark:text-blue-400' : ''}
                      `}
                    >
                      {d.day}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {view === 'months' && (
            <div className="grid grid-cols-3 gap-1.5">
              {SHORT_MONTH_NAMES.map((m, i) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setCurrentMonth(new Date(currentMonth.getFullYear(), i, 1));
                    setView('days');
                  }}
                  className={`py-2 rounded-lg text-[11px] sm:text-xs font-bold transition-colors ${currentMonth.getMonth() === i ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-50 dark:bg-slate-700/50 hover:bg-blue-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}

          {view === 'years' && (
            <div className="grid grid-cols-3 gap-1.5 max-h-[160px] overflow-y-auto custom-scrollbar pr-1">
              {Array.from({ length: 11 }, (_, i) => 2020 + i).map(year => (
                <button
                  key={year}
                  type="button"
                  onClick={() => {
                    setCurrentMonth(new Date(year, currentMonth.getMonth(), 1));
                    setView('days');
                  }}
                  className={`py-2 rounded-lg text-[11px] sm:text-xs font-bold transition-colors ${currentMonth.getFullYear() === year ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-50 dark:bg-slate-700/50 hover:bg-blue-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200'}`}
                >
                  {year}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-2.5 border-t border-slate-200 dark:border-slate-700 flex justify-end shrink-0">
          <button
            type="button"
            onClick={() => handleSelectDate(parseLocalDate(getTodayWIB()))}
            className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
          >
            Hari Ini
          </button>
        </div>
      </div>
    </>,
    document.body
  );

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">{label}</label>}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleOpen}
        className="w-full min-w-0 flex items-center justify-between gap-2 px-3 sm:px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white hover:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-left"
      >
        <span className="min-w-0 truncate">
          {value ? (
            <>
              <span className="sm:hidden">{`${parseLocalDate(value).getDate()} ${SHORT_MONTH_NAMES[parseLocalDate(value).getMonth()]} ${parseLocalDate(value).getFullYear()}`}</span>
              <span className="hidden sm:inline">{displayDate}</span>
            </>
          ) : displayDate}
        </span>
        <CalendarIcon className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
      </button>
      {calendarPopup}
    </div>
  );
}
