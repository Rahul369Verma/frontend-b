// Instrument Configuration & Constants
// Matches backend/logic/constants.js
// Single Source of Truth for Frontend

export const INSTRUMENT_CONFIG = {
    "NSE:NIFTYBANK-INDEX": {
        underlying: "BANKNIFTY",
        exchange: "NSE",
        lotSize: 30,      // SEBI Jan 2026 Revision
        strikeStep: 100,
        expiryDay: 2,      // Tuesday
        expiryType: "MONTHLY", // Weekly Discontinued
        min_sl_range: [10, 35] 
    },
    "NSE:FINNIFTY-INDEX": {
        underlying: "FINNIFTY",
        exchange: "NSE",
        lotSize: 60,
        strikeStep: 50,
        expiryDay: 2,      // Tuesday
        expiryType: "MONTHLY", // Weekly Discontinued
        min_sl_range: [5, 20] 
    },
    "NSE:MIDCPNIFTY-INDEX": {
        underlying: "MIDCPNIFTY",
        exchange: "NSE",
        lotSize: 120,    
        strikeStep: 25,
        expiryDay: 2,      // Tuesday (Reverted: 2026 Rules)
        expiryType: "MONTHLY", // User confirmed Monthly Only
        min_sl_range: [2, 12] 
    },
    "NSE:NIFTY50-INDEX": {
        underlying: "NIFTY",
        exchange: "NSE",
        lotSize: 65,
        strikeStep: 50,
        expiryDay: 4,     // Thursday
        expiryType: "MONTHLY", // Weekly Retained
        min_sl_range: [5, 25] 
    },
    "BSE:SENSEX-INDEX": {
        underlying: "SENSEX",
        exchange: "BSE",
        lotSize: 20,      // SEBI Nov 2024 Revision
        strikeStep: 100,
        expiryDay: 4,      // Thursday 
        expiryType: "WEEKLY", // Both Weekly and Monthly
        min_sl_range: [15, 40] 
    },
    "BSE:BANKEX-INDEX": {
        underlying: "BANKEX",
        exchange: "BSE",
        lotSize: 15,      // SEBI Nov 2024 Revision
        strikeStep: 100,
        expiryDay: 1,      // Monday
        expiryType: "WEEKLY",
        min_sl_range: [15, 40] 
    },
    // Stocks (Option Buying List - Top Liquid)
    "NSE:RELIANCE-EQ": { underlying: "RELIANCE", exchange: "NSE", lotSize: 500, strikeStep: 20, expiryType: "MONTHLY", min_sl_range: [1, 5] },
    "NSE:HDFCBANK-EQ": { underlying: "HDFCBANK", exchange: "NSE", lotSize: 550, strikeStep: 10, expiryType: "MONTHLY", min_sl_range: [1, 5] },
    "NSE:ICICIBANK-EQ": { underlying: "ICICIBANK", exchange: "NSE", lotSize: 700, strikeStep: 10, expiryType: "MONTHLY", min_sl_range: [1, 5] },
    "NSE:SBIN-EQ": { underlying: "SBIN", exchange: "NSE", lotSize: 750, strikeStep: 5, expiryType: "MONTHLY", min_sl_range: [0.5, 3] },
    "NSE:INFY-EQ": { underlying: "INFY", exchange: "NSE", lotSize: 400, strikeStep: 20, expiryType: "MONTHLY", min_sl_range: [1, 5] },
    "NSE:TCS-EQ": { underlying: "TCS", exchange: "NSE", lotSize: 175, strikeStep: 50, expiryType: "MONTHLY", min_sl_range: [2, 8] },
    "NSE:TMPV-EQ": { underlying: "TMPV", exchange: "NSE", lotSize: 800, strikeStep: 10, expiryType: "MONTHLY" },
    "NSE:MARUTI-EQ": { underlying: "MARUTI", exchange: "NSE", lotSize: 50, strikeStep: 100, expiryType: "MONTHLY" },

    "NSE:BAJFINANCE-EQ": { underlying: "BAJFINANCE", exchange: "NSE", lotSize: 125, strikeStep: 50, expiryType: "MONTHLY" },
    
    // MCX Commodities (Futures)
    "MCX:CRUDEOIL": { underlying: "CRUDEOIL", exchange: "MCX", lotSize: 100, strikeStep: 10, expiryType: "FUTURES" },
    "MCX:SILVERMIC": { underlying: "SILVERMIC", exchange: "MCX", lotSize: 1, strikeStep: 1, expiryType: "FUTURES" },
    "MCX:GOLDM": { underlying: "GOLDM", exchange: "MCX", lotSize: 10, strikeStep: 10, expiryType: "FUTURES" }
};

export const SYMBOL_MAP = {};
Object.keys(INSTRUMENT_CONFIG).forEach(symbol => {
    const config = INSTRUMENT_CONFIG[symbol];
    SYMBOL_MAP[config.underlying] = symbol;
});

// Backward Compatibility / Manual Aliases
SYMBOL_MAP["TATAMOTORS"] = "NSE:TMPV-EQ";
SYMBOL_MAP["MIDCAPNIFTY"] = "NSE:MIDCPNIFTY-INDEX"; // Common Alias
SYMBOL_MAP["BANKEX"] = "BSE:BANKEX-INDEX";

export const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export const TIMEZONE = "Asia/Kolkata";

export const MARKET_TIMINGS = {
    NSE: {
        open: "09:15",
        close: "15:30",
        strategyStart: "09:30",
        strategyEnd: "15:15"
    },
    BSE: {
        open: "09:15",
        close: "15:30",
        strategyStart: "09:30",
        strategyEnd: "15:15"
    },
    MCX: {
        open: "09:00",
        close: "23:30",
        strategyStart: "09:15",
        strategyEnd: "23:00"
    }
};
