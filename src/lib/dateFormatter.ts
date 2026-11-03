/**
 * Utility to format dates and times into a clean, professional Indonesian format with WIB timezone where applicable.
 */
export function formatBeautifulDateTime(val: string | null | undefined): string {
  if (!val) return '-';
  const cleanVal = val.trim();
  if (!cleanVal) return '-';

  // 1. Matches full timestamp format, e.g., "2026-06-29 09:42:53.682449" or "2026-06-29T09:42:53"
  const dateTimeRegex = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?/;
  const match = cleanVal.match(dateTimeRegex);
  
  if (match) {
    const year = match[1];
    const monthIndex = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const hour = match[4];
    const minute = match[5];
    const second = match[6];
    
    const MONTHS_ID = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    
    const monthName = MONTHS_ID[monthIndex] || match[2];
    
    let formatted = `${day} ${monthName} ${year}`;
    if (hour && minute) {
      formatted += `, ${hour}:${minute}`;
      if (second) {
        formatted += ` WIB`;
      }
    }
    return formatted;
  }
  
  // 2. Matches just time, e.g., "09:42:53" or "09:42"
  const timeRegex = /^(\d{2}):(\d{2})(?::(\d{2}))?/;
  const matchTime = cleanVal.match(timeRegex);
  if (matchTime) {
    return `${matchTime[1]}:${matchTime[2]} WIB`;
  }

  // 3. Matches simple date, e.g., "2026-06-29"
  const dateRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
  const matchDate = cleanVal.match(dateRegex);
  if (matchDate) {
    const year = matchDate[1];
    const monthIndex = parseInt(matchDate[2], 10) - 1;
    const day = parseInt(matchDate[3], 10);
    const MONTHS_ID = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const monthName = MONTHS_ID[monthIndex] || matchDate[2];
    return `${day} ${monthName} ${year}`;
  }
  
  return val;
}

export const SHORT_MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'];

export function formatCompactDateTime(val: string | null | undefined): string {
  if (!val) return '-';
  const cleanVal = val.trim();
  if (!cleanVal) return '-';

  const match = cleanVal.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!match) return cleanVal;

  const date = `${Number(match[3])} ${SHORT_MONTHS_ID[Number(match[2]) - 1] || match[2]} ${match[1]}`;
  return match[4] && match[5] ? `${date}, ${match[4]}:${match[5]}` : date;
}

/**
 * Mendapatkan tanggal hari ini dalam format YYYY-MM-DD disesuaikan dengan zona waktu Asia/Jakarta (WIB).
 */
export function getTodayWIB(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d);
  } catch (e) {
    // Fallback jika timezone Asia/Jakarta tidak disupport
    const offset = 7 * 60; // WIB is UTC+7
    const wibTime = new Date(d.getTime() + (offset + d.getTimezoneOffset()) * 60000);
    return wibTime.toISOString().split('T')[0];
  }
}

/**
 * Mendapatkan tanggal WIB (YYYY-MM-DD) dengan offset bulan tertentu (misal -1 untuk sebulan yang lalu).
 */
export function getTodayWIBWithOffset(monthsOffset: number): string {
  const [year, month, day] = getTodayWIB().split('-').map(Number);
  const targetMonth = new Date(Date.UTC(year, month - 1 + monthsOffset, 1));
  const targetYear = targetMonth.getUTCFullYear();
  const targetMonthIndex = targetMonth.getUTCMonth();
  const targetDay = Math.min(day, new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate());
  const y = String(targetYear).padStart(4, '0');
  const m = String(targetMonthIndex + 1).padStart(2, '0');
  const d = String(targetDay).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
