// Instrument Configuration & Constants
// Matches backend/logic/constants.js
// Single Source of Truth for Frontend
//
// `marginPct` mirrors backend marginPct: SPAN+Exposure as a fraction of
// notional (spot × lotSize). Used by the Selling-mode UI to preview the
// auto-derived margin before sending the backtest request.

// MCX initial margin (SPAN + ELM) as a share of the CONTRACT VALUE — the same dated
// snapshot the backend uses (backend/src/domain/costs/mcxMargin.js). The fixed rupee
// `marginPerLot` values below are stale (GOLD ₹55,000 vs ₹13.8 lakh real) and unused.
export const MCX_MARGIN = {
  asOf: '2026-10-13',
  source: 'Zerodha NRML margin rate (= MCX SPAN + ELM)',
  rates: {
    GOLD: 0.0925, GOLDM: 0.0925, GOLDPETAL: 0.0925, GOLDGUINEA: 0.0925, GOLDTEN: 0.0925,
    SILVER: 0.1275, SILVERM: 0.1275, SILVERMIC: 0.1275, CRUDEOIL: 0.3125, CRUDEOILM: 0.3125,
    NATURALGAS: 0.1713, NATGASMINI: 0.1713, COPPER: 0.0925, ZINC: 0.0934, ZINCMINI: 0.0933,
    ALUMINIUM: 0.0939, ALUMINI: 0.0936, LEAD: 0.0743, LEADMINI: 0.0743, NICKEL: 0.0927,
  },
};

export const INSTRUMENT_CONFIG = {
    "NSE:NIFTYBANK-INDEX": {
        underlying: "BANKNIFTY",
        exchange: "NSE",
        lotSize: 30,      // SEBI Jan 2026 Revision
        strikeStep: 100,
        expiryDay: 2,      // Tuesday
        expiryType: "MONTHLY", // Weekly Discontinued
        min_sl_range: [10, 35],
        marginPct: 0.15
    },
    "NSE:FINNIFTY-INDEX": {
        underlying: "FINNIFTY",
        exchange: "NSE",
        lotSize: 60,
        strikeStep: 50,
        expiryDay: 2,      // Tuesday
        expiryType: "MONTHLY", // Weekly Discontinued
        min_sl_range: [5, 20],
        marginPct: 0.15
    },
    "NSE:MIDCPNIFTY-INDEX": {
        underlying: "MIDCPNIFTY",
        exchange: "NSE",
        lotSize: 120,
        strikeStep: 25,
        expiryDay: 2,      // Tuesday (Reverted: 2026 Rules)
        expiryType: "MONTHLY", // User confirmed Monthly Only
        min_sl_range: [2, 12],
        marginPct: 0.15
    },
    "NSE:NIFTY50-INDEX": {
        underlying: "NIFTY",
        exchange: "NSE",
        lotSize: 65,
        strikeStep: 50,
        expiryDay: 2,     // Tuesday — see backend/logic/constants.js for the
                          // SEBI Oct 2024 + NSE Sept 2025 rationale. Pre-fix
                          // this was 4 (Thursday) which produced wrong dates
                          // in the fallback expiry generator.
        expiryType: "WEEKLY", // NIFTY 50 retained weekly options; last Tuesday
                              // of each month is the monthly futures expiry.
        min_sl_range: [5, 25],
        marginPct: 0.15
    },
    "BSE:SENSEX-INDEX": {
        underlying: "SENSEX",
        exchange: "BSE",
        lotSize: 20,      // SEBI Nov 2024 Revision
        strikeStep: 100,
        expiryDay: 4,      // Thursday
        expiryType: "WEEKLY", // Both Weekly and Monthly
        min_sl_range: [15, 40],
        marginPct: 0.18
    },
    "BSE:BANKEX-INDEX": {
        underlying: "BANKEX",
        exchange: "BSE",
        lotSize: 30,       // BSE lists 30 since Feb-2025 (was 15)
        strikeStep: 100,
        expiryDay: 4,      // Thursday — last of the month; the Monday weekly series no longer exists
        expiryType: "MONTHLY",
        min_sl_range: [15, 40],
        marginPct: 0.18
    },
    // Stocks (Option Buying List - Top Liquid). NSE stock options expire on the
    // LAST TUESDAY (expiryDay 2). Lots/steps are the exchange's — mirrored from
    // backend/logic/constants.js, which tests/engine/marketFacts.test.js pins to
    // the exchange evidence (and pins THIS file to the backend's).
    "NSE:RELIANCE-EQ": { underlying: "RELIANCE", exchange: "NSE", lotSize: 500, strikeStep: 10, expiryDay: 2, expiryType: "MONTHLY", min_sl_range: [1, 5], marginPct: 0.22 },
    "NSE:HDFCBANK-EQ": { underlying: "HDFCBANK", exchange: "NSE", lotSize: 650, strikeStep: 10, expiryDay: 2, expiryType: "MONTHLY", min_sl_range: [1, 5], marginPct: 0.22 },
    "NSE:ICICIBANK-EQ": { underlying: "ICICIBANK", exchange: "NSE", lotSize: 700, strikeStep: 10, expiryDay: 2, expiryType: "MONTHLY", min_sl_range: [1, 5], marginPct: 0.22 },
    "NSE:SBIN-EQ": { underlying: "SBIN", exchange: "NSE", lotSize: 750, strikeStep: 10, expiryDay: 2, expiryType: "MONTHLY", min_sl_range: [0.5, 3], marginPct: 0.22 },
    "NSE:INFY-EQ": { underlying: "INFY", exchange: "NSE", lotSize: 400, strikeStep: 20, expiryDay: 2, expiryType: "MONTHLY", min_sl_range: [1, 5], marginPct: 0.22 },
    "NSE:TCS-EQ": { underlying: "TCS", exchange: "NSE", lotSize: 225, strikeStep: 20, expiryDay: 2, expiryType: "MONTHLY", min_sl_range: [2, 8], marginPct: 0.22 },
    "NSE:TMPV-EQ": { underlying: "TMPV", exchange: "NSE", lotSize: 1600, strikeStep: 5, expiryDay: 2, expiryType: "MONTHLY", marginPct: 0.22 },
    "NSE:MARUTI-EQ": { underlying: "MARUTI", exchange: "NSE", lotSize: 50, strikeStep: 100, expiryDay: 2, expiryType: "MONTHLY", marginPct: 0.22 },
    "NSE:AXISBANK-EQ": { underlying: "AXISBANK", exchange: "NSE", lotSize: 625, strikeStep: 10, expiryDay: 2, expiryType: "MONTHLY", marginPct: 0.22 },
    "NSE:BAJFINANCE-EQ": { underlying: "BAJFINANCE", exchange: "NSE", lotSize: 750, strikeStep: 10, expiryDay: 2, expiryType: "MONTHLY", marginPct: 0.22 },
    
    // MCX Commodities (Futures) — Precious Metals
    // lotSize = P&L multiplier per lot per ₹1 price move
    // GOLD: price quoted in ₹/10g, 1 lot = 1 kg = 100 × 10g → lotSize = 100
    // GOLDM: price in ₹/10g, 1 lot = 100g = 10 × 10g → lotSize = 10
    // GOLDPETAL: price in ₹/g, 1 lot = 1g → lotSize = 1
    // SILVER/SILVERMIC/SILVERM: price in ₹/kg, lot in kg → lotSize = kg quantity
    // tickSize: minimum price move on MCX exchange
    // marginPerLot: approx SPAN + Exposure margin (varies with volatility)
    // rollCostPct: approx % of entry price deducted per contract roll (contango/basis)
    "MCX:GOLD":      { underlying: "GOLD",      exchange: "MCX", lotSize: 100,  tickSize: 1,    marginPerLot: 55000,  rollCostPct: 0.15, strikeStep: 100, expiryType: "FUTURES", displayName: "Gold (1kg)" },
    "MCX:GOLDM":     { underlying: "GOLDM",     exchange: "MCX", lotSize: 10,   tickSize: 1,    marginPerLot: 5500,   rollCostPct: 0.15, strikeStep: 10,  expiryType: "FUTURES", displayName: "Gold Mini (100g)" },
    "MCX:GOLDPETAL": { underlying: "GOLDPETAL", exchange: "MCX", lotSize: 1,    tickSize: 0.5,  marginPerLot: 550,    rollCostPct: 0.15, strikeStep: 1,   expiryType: "FUTURES", displayName: "Gold Petal (1g)" },
    "MCX:SILVER":    { underlying: "SILVER",    exchange: "MCX", lotSize: 30,   tickSize: 1,    marginPerLot: 40000,  rollCostPct: 0.12, strikeStep: 100, expiryType: "FUTURES", displayName: "Silver (30kg)" },
    "MCX:SILVERMIC": { underlying: "SILVERMIC", exchange: "MCX", lotSize: 1,    tickSize: 1,    marginPerLot: 1400,   rollCostPct: 0.12, strikeStep: 1,   expiryType: "FUTURES", displayName: "Silver Micro (1kg)" },
    "MCX:SILVERM":   { underlying: "SILVERM",   exchange: "MCX", lotSize: 5,    tickSize: 1,    marginPerLot: 7000,   rollCostPct: 0.12, strikeStep: 10,  expiryType: "FUTURES", displayName: "Silver Mini (5kg)" },
    // MCX Commodities (Futures) — Energy
    "MCX:CRUDEOIL":  { underlying: "CRUDEOIL",  exchange: "MCX", lotSize: 100,  tickSize: 1,    marginPerLot: 42000,  rollCostPct: 0.20, strikeStep: 10,  expiryType: "FUTURES", displayName: "Crude Oil (100 bbl)" },
    "MCX:NATURALGAS":{ underlying: "NATURALGAS",exchange: "MCX", lotSize: 1250, tickSize: 0.10, marginPerLot: 15000,  rollCostPct: 0.30, strikeStep: 1,   expiryType: "FUTURES", displayName: "Natural Gas (1250 mmBTU)" },
    // MCX Commodities (Futures) — Base Metals
    "MCX:COPPER":    { underlying: "COPPER",    exchange: "MCX", lotSize: 2500, tickSize: 0.05, marginPerLot: 35000,  rollCostPct: 0.10, strikeStep: 0.5, expiryType: "FUTURES", displayName: "Copper (2.5 MT)" },
    "MCX:ZINC":      { underlying: "ZINC",      exchange: "MCX", lotSize: 5000, tickSize: 0.05, marginPerLot: 12000,  rollCostPct: 0.10, strikeStep: 0.5, expiryType: "FUTURES", displayName: "Zinc (5 MT)" },
    "MCX:ALUMINIUM": { underlying: "ALUMINIUM", exchange: "MCX", lotSize: 5000, tickSize: 0.05, marginPerLot: 10000,  rollCostPct: 0.10, strikeStep: 0.5, expiryType: "FUTURES", displayName: "Aluminium (5 MT)" },
    "MCX:LEAD":      { underlying: "LEAD",      exchange: "MCX", lotSize: 5000, tickSize: 0.05, marginPerLot: 10000,  rollCostPct: 0.10, strikeStep: 0.5, expiryType: "FUTURES", displayName: "Lead (5 MT)" },
    "MCX:NICKEL":    { underlying: "NICKEL",    exchange: "MCX", lotSize: 1500, tickSize: 0.10, marginPerLot: 20000,  rollCostPct: 0.10, strikeStep: 1,   expiryType: "FUTURES", displayName: "Nickel (1.5 MT)" }
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

// open/close are MARKET FACTS and derive from ./config/marketSession.js (which
// mirrors backend/logic/marketSession.js — the authority). strategyStart/End are
// POLICY and stay literal, exactly as on the backend.
import { sessionFor as _sessionFor } from './config/marketSession';

export const MARKET_TIMINGS = {
    NSE: {
        open: _sessionFor({ exchange: 'NSE', segment: 'DERIVATIVES' }).open,
        close: _sessionFor({ exchange: 'NSE', segment: 'DERIVATIVES' }).close,
        strategyStart: "09:30",
        strategyEnd: "15:15"
    },
    BSE: {
        open: _sessionFor({ exchange: 'BSE', segment: 'DERIVATIVES' }).open,
        close: _sessionFor({ exchange: 'BSE', segment: 'DERIVATIVES' }).close,
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
