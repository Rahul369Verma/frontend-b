import { INSTRUMENT_CONFIG } from '../constants';
import { API_BASE } from '../config/api.js';

/**
 * Get the target day of week for expiry for a given symbol
 * targetDay: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
 */
export const getExpiryDayOfWeek = (symbol) => {
    const sym = symbol?.toUpperCase() || "";
    if (INSTRUMENT_CONFIG[sym] && INSTRUMENT_CONFIG[sym].expiryDay !== undefined) {
        return INSTRUMENT_CONFIG[sym].expiryDay;
    }

    if (sym.includes('MIDCP')) return 1; // Mon
    if (sym.includes('FIN')) return 2;   // Tue
    if (sym.includes('BANKNIFTY')) return 3; // Wed (legacy fallback)
    if (sym.includes('NIFTY')) return 2;     // Tue
    if (sym.includes('SENSEX')) return 4;    // Thu
    if (sym.includes('BANKEX')) return 1;    // Mon

    return 4; // Default Thu
};

/**
 * Calculates the last occurrence of a target day in a specific year and month
 */
export const getMonthlyExpiryDate = (year, month, targetDay) => {
    const date = new Date(year, month + 1, 0); // Last day of month
    const day = date.getDay();
    const diff = (day - targetDay + 7) % 7;
    date.setDate(date.getDate() - diff); // Move back to last targetDay
    return date;
};

/**
 * Generates an array of upcoming explicit expiry dates based on symbol type
 * Supports both MONTHLY and WEEKLY generation statically
 * 
 * @param {string} symbol NSE:NIFTY50-INDEX etc
 * @param {number} nextCount How many future dates to generate
 * @param {number} pastCount How many past dates to generate 
 * @returns Array of objects { date: "YYYY-MM-DD", label: "[MONTHLY] Tue Mar 25 2026", isPast: boolean }
 */
export const getExpiriesForSymbol = (symbol, nextCount = 4, pastCount = 1) => {
    if (!symbol) return [];

    const config = INSTRUMENT_CONFIG[symbol];
    const targetDay = getExpiryDayOfWeek(symbol);
    const isWeekly = config?.expiryType === 'WEEKLY';
    
    const dates = [];
    const now = new Date();
    
    if (isWeekly) {
        // Generate Weekly Expiries
        // Start from roughly `pastCount` weeks ago
        let anchorDate = new Date(now);
        anchorDate.setDate(now.getDate() - (pastCount * 7));

        // Find the next targetDay from anchor
        while (anchorDate.getDay() !== targetDay) {
            anchorDate.setDate(anchorDate.getDate() + 1);
        }

        // Generate the weeks
        for (let i = 0; i < (nextCount + pastCount); i++) {
            const expiry = new Date(anchorDate);
            expiry.setDate(anchorDate.getDate() + (i * 7));

            // Determine if this weekly expiry is also the monthly expiry (last one of the month)
            const year = expiry.getFullYear();
            const month = expiry.getMonth();
            const lastTargetDayOfMonth = getMonthlyExpiryDate(year, month, targetDay);
            
            // It's the monthly expiry if the dates match exactly
            const isMonthlyEx = (expiry.getDate() === lastTargetDayOfMonth.getDate() && 
                                 expiry.getMonth() === lastTargetDayOfMonth.getMonth());

            const yyyy = expiry.getFullYear();
            const mm = String(expiry.getMonth() + 1).padStart(2, '0');
            const dd = String(expiry.getDate()).padStart(2, '0');
            const dateStr = `${yyyy}-${mm}-${dd}`;

            dates.push({
                date: dateStr,
                label: `[${isMonthlyEx ? 'MONTHLY' : 'WEEKLY'}] ${expiry.toDateString()}`,
                isPast: expiry < new Date(new Date().setHours(0,0,0,0))
            });
        }
    } else {
        // Generate Monthly Expiries Only
        // e.g., if pastCount=2, start from currentMonth - 2
        for (let i = -pastCount; i < nextCount; i++) {
            const year = now.getFullYear();
            const month = now.getMonth() + i;

            // JS Date constructor handles overflow/underflow automatically
            const expiry = getMonthlyExpiryDate(year, month, targetDay);
            
            const yyyy = expiry.getFullYear();
            const mm = String(expiry.getMonth() + 1).padStart(2, '0');
            const dd = String(expiry.getDate()).padStart(2, '0');
            const dateStr = `${yyyy}-${mm}-${dd}`;

            dates.push({
                date: dateStr,
                label: `[MONTHLY] ${expiry.toDateString()}`,
                isPast: expiry < new Date(new Date().setHours(0,0,0,0))
            });
        }
    }

    // Sort chronologically
    dates.sort((a,b) => new Date(a.date) - new Date(b.date));
    return dates;
};

/**
 * Async version: fetches real expiry dates from the backend API (which pulls from NSE).
 * Falls back to the synchronous getExpiriesForSymbol if the API call fails or times out.
 *
 * @param {string} symbol   e.g. "NSE:FINNIFTY-INDEX"
 * @param {number} nextCount
 * @param {number} pastCount
 * @returns {Promise<Array<{date: string, label: string, isPast: boolean}>>}
 */
export const fetchExpiriesForSymbol = async (symbol, nextCount = 4, pastCount = 1) => {
    if (!symbol) return [];

        const url = `${API_BASE}/api/expiry?symbol=${encodeURIComponent(symbol)}&count=${nextCount}&pastCount=${pastCount}`;

    console.log(`[fetchExpiriesForSymbol] Fetching: ${url}`);

    // Use AbortController for compatibility (AbortSignal.timeout not available in all envs)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();

        if (data.expiries && Array.isArray(data.expiries) && data.expiries.length > 0) {
            console.log(`[fetchExpiriesForSymbol] Got ${data.expiries.length} expiries from API (source: ${data.source})`);
            return data.expiries;
        }

        throw new Error('Empty expiry list returned');

    } catch (err) {
        clearTimeout(timeoutId);
        const reason = err.name === 'AbortError' ? 'timeout' : err.message;
        console.warn(`[fetchExpiriesForSymbol] API failed for ${symbol} (${reason}). Using computed fallback.`);
        return getExpiriesForSymbol(symbol, nextCount, pastCount);
    }
};
