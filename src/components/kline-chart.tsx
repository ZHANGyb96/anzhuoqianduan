'use client';

import { useEffect, useState, useRef, useCallback, memo } from 'react';
import * as LightweightCharts from 'lightweight-charts';
import { Skeleton } from './ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, DatabaseZap, ChevronDown, Eye } from "lucide-react";
import { API_URL, STOCKS } from '@/config/constants';
import { useAuthStore } from '@/store/useAuthStore';
import { calculateAllIndicators } from '@/utils/ta-math';
import { isCapacitor } from '@/config/platform';
import { getKlineFromMobileDB } from '@/lib/mobile-db';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

type CandlestickData    = LightweightCharts.SeriesDataItemTypeMap['Candlestick'];
type LineData           = LightweightCharts.SeriesDataItemTypeMap['Line'];
type IChartApi          = LightweightCharts.IChartApi;
type ISeriesApi<T extends LightweightCharts.SeriesType> = LightweightCharts.ISeriesApi<T>;

type RawKlineData = {
    time: string;
    open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null;
    ma5?: number|null; ma10?: number|null; ma20?: number|null; ma60?: number|null; ma120?: number|null; ma250?: number|null;
    macd?: number|null; macd_signal?: number|null; macd_hist?: number|null;
    kdj_k?: number|null; kdj_d?: number|null; kdj_j?: number|null;
    rsi_6?: number|null; rsi_12?: number|null; rsi_24?: number|null;
    trix?: number|null; trma?: number|null;
    boll_upper?: number|null; boll_middle?: number|null; boll_lower?: number|null;
    pdi?: number|null; mdi?: number|null; adx?: number|null; adxr?: number|null;
    bias_6?: number|null; bias_12?: number|null; bias_24?: number|null;
    bbi?: number|null; cci?: number|null; dpo?: number|null; madpo?: number|null;
    lon?: number|null; lonma?: number|null;
    vol_ma5?: number|null; vol_ma10?: number|null;
    // TROC 短期
    troc_osc?: number|null; troc_osc_ma?: number|null; troc_trix_s?: number|null; troc_adx_s?: number|null;
    // TROC 长期
    troc_osc_l?: number|null; troc_osc_ma_l?: number|null; troc_trix_l?: number|null;
    troc_phase?: number|null; troc_acc?: number|null; troc_dist?: number|null;
    troc_pct?: number|null; troc_adx_l?: number|null; troc_chop?: number|null;
    troc_swing_lo?: number|null; troc_swing_hi?: number|null;
    troc_ob_dyn?: number|null; troc_os_dyn?: number|null;
    // TROC 信号与结构
    troc_buy_s?: number|null; troc_sell_s?: number|null;
    troc_buy_l?: number|null; troc_sell_l?: number|null;
    troc_struct_lo?: number|null; troc_struct_hi?: number|null;
};

export type FormattedChartData = CandlestickData & {
    open: number; high: number; low: number; close: number; volume: number;
    ma5?: number; ma10?: number; ma20?: number; ma60?: number; ma120?: number; ma250?: number;
    macd?: number; macd_signal?: number; macd_hist?: number;
    kdj_k?: number; kdj_d?: number; kdj_j?: number;
    rsi_6?: number; rsi_12?: number; rsi_24?: number;
    trix?: number; trma?: number;
    boll_upper?: number; boll_middle?: number; boll_lower?: number;
    pdi?: number; mdi?: number; adx?: number; adxr?: number;
    bias_6?: number; bias_12?: number; bias_24?: number;
    bbi?: number; cci?: number; dpo?: number; madpo?: number;
    lon?: number; lonma?: number;
    vol_ma5?: number; vol_ma10?: number;
    // TROC 短期
    troc_osc?: number; troc_osc_ma?: number; troc_trix_s?: number; troc_adx_s?: number;
    // TROC 长期
    troc_osc_l?: number; troc_osc_ma_l?: number; troc_trix_l?: number;
    troc_phase?: number; troc_acc?: number; troc_dist?: number;
    troc_pct?: number; troc_adx_l?: number; troc_chop?: number;
    troc_swing_lo?: number; troc_swing_hi?: number;
    troc_ob_dyn?: number; troc_os_dyn?: number;
    // TROC 信号与结构
    troc_buy_s?: number; troc_sell_s?: number;
    troc_buy_l?: number; troc_sell_l?: number;
    troc_struct_lo?: number; troc_struct_hi?: number;
};

export type IndicatorType = 'Volume'|'MACD'|'KDJ'|'RSI'|'TRIX'|'DMI'|'BIAS'|'BBI'|'CCI'|'DPO'|'BOLL'|'LON'|'TROC_S'|'TROC_L';

export const indicatorList: { value: IndicatorType; label: string }[] = [
    { value: 'Volume', label: '成交量' },
    { value: 'MACD',   label: 'MACD'  },
    { value: 'KDJ',    label: 'KDJ'   },
    { value: 'RSI',    label: 'RSI'   },
    { value: 'BOLL',   label: 'BOLL'  },
    { value: 'TRIX',   label: 'TRIX'  },
    { value: 'DPO',    label: 'DPO'   },
    { value: 'BIAS',   label: 'BIAS'  },
    { value: 'BBI',    label: 'BBI'   },
    { value: 'CCI',    label: 'CCI'   },
    { value: 'DMI',    label: 'DMI'   },
    { value: 'LON',    label: 'LON'      },
    { value: 'TROC_S', label: 'TROC短期' },
    { value: 'TROC_L', label: 'TROC长期' },
];

const PERIOD_LABEL_MAP: Record<string, string> = {
  '1m': '1分', '5m': '5分', '15m': '15分', '30m': '30分', '60m': '1时', '120m': '2时', '240m': '4时', '1d': '日线', '1w': '周线', '1M': '月线'
};

export const maConfig: Record<string, { color: string; label: string }> = {
    ma5:  { color: '#F2A93B', label: 'MA5'  },
    ma10: { color: '#31C2F2', label: 'MA10' },
    ma20: { color: '#E85EFF', label: 'MA20' },
    ma60: { color: '#44F279', label: 'MA60' },
    ma120:{ color: '#FF6666', label: 'MA120'},
    ma250:{ color: '#D4D4D4', label: 'MA250'},
};

const bollConfig  = { upper: { color: '#F2A93B' }, middle: { color: 'rgba(255,255,255,0.4)' }, lower: { color: '#31C2F2' } };
const kdjConfig   = { k: { color: '#F2A93B', label: 'K' }, d: { color: '#31C2F2', label: 'D' }, j: { color: '#E85EFF', label: 'J' } };
const rsiConfig   = { rsi1: { color: '#F2A93B', label: 'RSI1' }, rsi2: { color: '#31C2F2', label: 'RSI2' }, rsi3: { color: '#E85EFF', label: 'RSI3' } };
const macdConfig  = { macd: { color: '#F2A93B', label: 'DIF' }, macd_signal: { color: '#31C2F2', label: 'DEA' }, macd_hist: { label: 'MACD' } };
const trixConfig  = { trix: { color: '#F2A93B', label: 'TRIX' }, trma: { color: '#31C2F2', label: 'TRMA' } };
const dmiConfig   = { pdi: { color: '#F2A93B', label: 'DI1' }, mdi: { color: '#31C2F2', label: 'DI2' }, adx: { color: '#E85EFF', label: 'ADX' }, adxr: { color: '#D4D4D4', label: 'ADXR' } };
const biasConfig  = { bias6: { color: '#F2A93B', label: 'BIAS1' }, bias12: { color: '#31C2F2', label: 'BIAS2' }, bias24: { color: '#E85EFF', label: 'BIAS3' } };
const bbiConfig   = { bbi: { color: '#D4D4D4', label: 'BBI' }, close: { color: 'rgba(255,255,255,0.4)', label: 'CLOSE' } };
const cciConfig   = { cci: { color: '#D4D4D4', label: 'CCI' } };
const dpoConfig   = { dpo: { color: '#F2A93B', label: 'DPO' }, madpo: { color: '#31C2F2', label: 'MADPO' } };
const lonConfig   = { lon: { color: '#F2A93B', label: 'LONG' }, lonma: { color: '#31C2F2', label: 'MA' } };
const trocConfig  = {
    osc:   { color: '#42A5F5', label: 'OSC'    },
    oscMa: { color: '#FFB300', label: 'Signal' },
    trix:  { color: '#78909C', label: 'TRIX'   },
    adx:   { color: '#F2A93B', label: 'ADX'    },
    acc:   'rgba(0,230,118,0.25)',
    dist:  'rgba(255,23,68,0.25)',
    phase: 'rgba(0,230,118,0.6)',
    ob:    '#EF5350',
    os:    '#66BB6A',
    zero:  'rgba(255,255,255,0.25)',
};


// ─────────────────────────────────────────────
// ★ 新增：scrollToTargetTime
// 图表渲染完成后，将视图滚动到指定日期的K线
// ─────────────────────────────────────────────
function scrollToTargetTime(
    chart: IChartApi,
    data: FormattedChartData[],
    targetTime: string,
    period: string,
) {
    try {
        const dateStr = targetTime.slice(0, 10); // "YYYY-MM-DD"
        const isDayPlus = period === '1d' || period === '1w' || period === '1M';
        let idx = -1;

        if (isDayPlus) {
            // 日线：time 是字符串 "YYYY-MM-DD"
            idx = data.findIndex(d => String(d.time).slice(0, 10) === dateStr);
        } else {
            // 分钟线：time 是 Unix 秒（数字），先精确匹配时间戳
            const isoStr = targetTime.replace(' ', 'T') + (targetTime.includes('+') ? '' : '+08:00');
            const targetTs = Math.floor(new Date(isoStr).getTime() / 1000);
            if (!isNaN(targetTs)) idx = data.findIndex(d => d.time === targetTs);
            // 精确匹配失败，按日期找当日第一根
            if (idx < 0) {
                idx = data.findIndex(d => {
                    const t = typeof d.time === 'number'
                        ? new Date((d.time as number) * 1000).toISOString().slice(0, 10)
                        : String(d.time).slice(0, 10);
                    return t === dateStr;
                });
            }
        }

        if (idx < 0) { console.warn('[KlineChart] targetTime not found:', targetTime); return; }

        const ts = chart.timeScale();
        let visibleBars = 60;
        try {
            const range = ts.getVisibleLogicalRange();
            if (range) visibleBars = Math.round(range.to - range.from);
        } catch {}

        // barsFromRight = 目标 bar 距数据末尾的根数，+偏移让目标居中
        const barsFromRight = data.length - idx - 1;
        ts.scrollToRealTime();
        ts.scrollToPosition(-(barsFromRight - Math.floor(visibleBars / 2)), false);
    } catch (e) {
        console.warn('[KlineChart] scrollToTargetTime 失败:', e);
    }
}

// ─────────────────────────────────────────────
// Data fetching
// ─────────────────────────────────────────────
async function fetchKlineData(stockCode: string, period: string, token: string): Promise<RawKlineData[]> {
    if (isCapacitor) {
        try {
            const rows = await getKlineFromMobileDB(stockCode, period, 5000);
            return rows.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
        } catch (e: any) {
            throw new Error('手机本地暂无此标的数据，请先在"数据管理"同步。');
        }
    }
    const res = await fetch(`${API_URL}/api/v1/market-data/${stockCode}/kline?period=${period}&limit=10000`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || '获取数据失败');
    }
    const data: any[] = await res.json();
    return data.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

function transformData(d: RawKlineData, period: string): FormattedChartData | null {
    if (d.open == null || d.high == null || d.low == null || d.close == null || !d.time) return null;
    const isDayPlus = period === '1d' || period === '1w' || period === '1M';
    let finalTime: LightweightCharts.Time;
    try {
        if (isDayPlus) {
            finalTime = d.time.split(' ')[0].split('T')[0];
        } else {
            const hasZ = /Z|[+-]\d{2}:?\d{2}$/.test(d.time);
            const ts = Math.floor(new Date(hasZ ? d.time : d.time.replace(' ', 'T') + '+08:00').getTime() / 1000);
            if (isNaN(ts)) throw new Error('NaN');
            finalTime = ts as LightweightCharts.UTCTimestamp;
        }
    } catch { return null; }

    return {
        time: finalTime, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume ?? 0,
        ma5: d.ma5??undefined, ma10: d.ma10??undefined, ma20: d.ma20??undefined,
        ma60: d.ma60??undefined, ma120: d.ma120??undefined, ma250: d.ma250??undefined,
        macd: d.macd??undefined, macd_signal: d.macd_signal??undefined, macd_hist: d.macd_hist??undefined,
        kdj_k: d.kdj_k??undefined, kdj_d: d.kdj_d??undefined, kdj_j: d.kdj_j??undefined,
        rsi_6: d.rsi_6??undefined, rsi_12: d.rsi_12??undefined, rsi_24: d.rsi_24??undefined,
        trix: d.trix??undefined, trma: d.trma??undefined,
        boll_upper: d.boll_upper??undefined, boll_middle: d.boll_middle??undefined, boll_lower: d.boll_lower??undefined,
        pdi: d.pdi??undefined, mdi: d.mdi??undefined, adx: d.adx??undefined, adxr: d.adxr??undefined,
        bias_6: d.bias_6??undefined, bias_12: d.bias_12??undefined, bias_24: d.bias_24??undefined,
        bbi: d.bbi??undefined, cci: d.cci??undefined, dpo: d.dpo??undefined, madpo: d.madpo??undefined,
        lon: d.lon??undefined, lonma: d.lonma??undefined,
        vol_ma5: d.vol_ma5??undefined, vol_ma10: d.vol_ma10??undefined,
        // TROC 短期
        troc_osc: d.troc_osc??undefined, troc_osc_ma: d.troc_osc_ma??undefined,
        troc_trix_s: d.troc_trix_s??undefined, troc_adx_s: d.troc_adx_s??undefined,
        // TROC 长期
        troc_osc_l: d.troc_osc_l??undefined, troc_osc_ma_l: d.troc_osc_ma_l??undefined,
        troc_trix_l: d.troc_trix_l??undefined, troc_phase: d.troc_phase??undefined,
        troc_acc: d.troc_acc??undefined, troc_dist: d.troc_dist??undefined,
        troc_pct: d.troc_pct??undefined, troc_adx_l: d.troc_adx_l??undefined,
        troc_chop: d.troc_chop??undefined, troc_swing_lo: d.troc_swing_lo??undefined,
        troc_swing_hi: d.troc_swing_hi??undefined,
        troc_ob_dyn: d.troc_ob_dyn??undefined, troc_os_dyn: d.troc_os_dyn??undefined,
        troc_buy_s: d.troc_buy_s??undefined, troc_sell_s: d.troc_sell_s??undefined,
        troc_buy_l: d.troc_buy_l??undefined, troc_sell_l: d.troc_sell_l??undefined,
        troc_struct_lo: d.troc_struct_lo??undefined, troc_struct_hi: d.troc_struct_hi??undefined,
    };
}

const safeData = (data: FormattedChartData[], field: keyof FormattedChartData) =>
    data.map(d => {
        const v = d[field];
        return (v != null && !isNaN(v as number)) ? { time: d.time, value: v as number } : { time: d.time };
    });

const sortMarkers = (m: LightweightCharts.SeriesMarker<LightweightCharts.Time>[]) =>
    [...m].sort((a, b) => {
        const tA = typeof a.time === 'string' ? new Date(a.time).getTime() : (a.time as number) * 1000;
        const tB = typeof b.time === 'string' ? new Date(b.time).getTime() : (b.time as number) * 1000;
        return tA - tB;
    });

function calcMacdDivergence(data: FormattedChartData[]) {
    const markers: LightweightCharts.SeriesMarker<LightweightCharts.Time>[] = [];
    if (data.length < 30) return markers;
    let lastJc = -1, lastSc = -1, prevHH = -1, prevMHD = -1, prevLL = -1, prevMLD = -1;
    for (let i = 1; i < data.length; i++) {
        const pd = data[i-1], cd = data[i];
        if (pd.macd==null||pd.macd_signal==null||cd.macd==null||cd.macd_signal==null) continue;
        const isJC = pd.macd <= pd.macd_signal && cd.macd > cd.macd_signal;
        const isSC = pd.macd >= pd.macd_signal && cd.macd < cd.macd_signal;
        if (isSC && lastJc !== -1) {
            const highs = data.slice(lastJc, i+1).map(d=>d.high).filter(Boolean) as number[];
            const hists = data.slice(lastJc, i+1).map(d=>d.macd_hist).filter(v=>v!=null) as number[];
            if (highs.length && hists.length) {
                const hh = Math.max(...highs), mhd = Math.max(...hists);
                if (prevHH !== -1 && hh > prevHH && mhd < prevMHD)
                    markers.push({ time: cd.time, position: 'aboveBar', color: '#26a69a', shape: 'arrowDown', text: '顶背离' });
                prevHH = hh; prevMHD = mhd;
            }
            lastSc = i;
        }
        if (isJC && lastSc !== -1) {
            const lows  = data.slice(lastSc, i+1).map(d=>d.low).filter(Boolean) as number[];
            const hists = data.slice(lastSc, i+1).map(d=>d.macd_hist).filter(v=>v!=null) as number[];
            if (lows.length && hists.length) {
                const ll = Math.min(...lows), mld = Math.min(...hists);
                if (prevLL !== -1 && ll < prevLL && mld > prevMLD)
                    markers.push({ time: cd.time, position: 'belowBar', color: '#ef5350', shape: 'arrowUp', text: '底背离' });
                prevLL = ll; prevMLD = mld;
            }
            lastJc = i;
        }
        if (isJC) lastJc = i;
        if (isSC) lastSc = i;
    }
    return markers;
}

function calcCrossSignals(
    data: FormattedChartData[],
    fastField: keyof FormattedChartData,
    slowField: keyof FormattedChartData,
) {
    const markers: LightweightCharts.SeriesMarker<LightweightCharts.Time>[] = [];
    for (let i = 1; i < data.length; i++) {
        const pf = data[i-1][fastField] as number, ps = data[i-1][slowField] as number;
        const cf = data[i][fastField]  as number, cs = data[i][slowField]  as number;
        if (pf==null||ps==null||cf==null||cs==null) continue;
        if (pf <= ps && cf > cs) markers.push({ time: data[i].time, position: 'belowBar', color: '#ef5350', shape: 'arrowUp',   text: '买' });
        if (pf >= ps && cf < cs) markers.push({ time: data[i].time, position: 'aboveBar', color: '#26a69a', shape: 'arrowDown', text: '卖' });
    }
    return markers;
}

function calcBbiSignals(data: FormattedChartData[]) {
    const markers: LightweightCharts.SeriesMarker<LightweightCharts.Time>[] = [];
    for (let i = 1; i < data.length; i++) {
        const pc = data[i-1].close, pb = data[i-1].bbi;
        const cc = data[i].close,   cb = data[i].bbi;
        if (pc==null||pb==null||cc==null||cb==null) continue;
        if (pc <= pb && cc > cb) markers.push({ time: data[i].time, position: 'belowBar', color: '#ef5350', shape: 'arrowUp',   text: '买' });
        if (pc >= pb && cc < cb) markers.push({ time: data[i].time, position: 'aboveBar', color: '#26a69a', shape: 'arrowDown', text: '卖' });
    }
    return markers;
}

const fmt  = (n?: number|null, p = 2) => n != null ? n.toFixed(p) : '–';
const fmtV = (n?: number|null) => {
    if (n == null) return '–';
    if (n > 1e8)  return `${(n/1e8).toFixed(2)}亿`;
    if (n > 1e4)  return `${(n/1e4).toFixed(2)}万`;
    return n.toString();
};
const fmtTime = (t: LightweightCharts.Time, period: string) => {
    if (typeof t === 'string') return t;
    const d = new Date((t as number) * 1000);
    const Y = d.getFullYear(), M = String(d.getMonth()+1).padStart(2,'0'), D = String(d.getDate()).padStart(2,'0');
    const h = String(d.getHours()).padStart(2,'0'), m = String(d.getMinutes()).padStart(2,'0');
    return (period === '1d' || period === '1w' || period === '1M') ? `${Y}/${M}/${D}` : `${Y}/${M}/${D} ${h}:${m}`;
};

function getPrimaryField(ind: IndicatorType): keyof FormattedChartData {
    const map: Record<IndicatorType, keyof FormattedChartData> = {
        Volume:'volume', MACD:'macd', KDJ:'kdj_k', RSI:'rsi_6',
        TRIX:'trix', DMI:'pdi', BIAS:'bias_6', BBI:'bbi',
        CCI:'cci', DPO:'dpo', BOLL:'boll_middle', LON:'lon',
        TROC_S:'troc_osc', TROC_L:'troc_osc_l',
    };
    return map[ind];
}

// ─────────────────────────────────────────────
// Swing High/Low Detection (用于主图价格标签)
// ─────────────────────────────────────────────
type SwingPoint = { time: LightweightCharts.Time; price: number; type: 'high' | 'low' };

function detectSwingPoints(data: FormattedChartData[]): SwingPoint[] {
    const n = data.length;
    if (n < 6) return [];

    // 动态窗口：数据越多窗口越大，避免显示太密集
    const win = Math.max(4, Math.min(12, Math.round(n / 40)));

    // ① 找出所有局部极值候选点，并记录突出度（prominence）
    type Candidate = { idx: number; price: number; type: 'high' | 'low'; prominence: number };
    const candidates: Candidate[] = [];

    for (let i = win; i < n - win; i++) {
        const d = data[i];
        let isHigh = true, isLow = true;

        for (let j = i - win; j <= i + win; j++) {
            if (j === i) continue;
            if (data[j].high >= d.high) isHigh = false;
            if (data[j].low  <= d.low)  isLow  = false;
        }

        if (isHigh) {
            // 突出度 = 该高点与附近最低点的差值
            let nearLow = Infinity;
            for (let j = i - win; j <= i + win; j++) nearLow = Math.min(nearLow, data[j].low);
            candidates.push({ idx: i, price: d.high, type: 'high', prominence: d.high - nearLow });
        }
        if (isLow) {
            // 突出度 = 附近最高点与该低点的差值
            let nearHigh = -Infinity;
            for (let j = i - win; j <= i + win; j++) nearHigh = Math.max(nearHigh, data[j].high);
            candidates.push({ idx: i, price: d.low, type: 'low', prominence: nearHigh - d.low });
        }
    }

    // ② 按突出度降序，保留最显著的若干个极值
    candidates.sort((a, b) => b.prominence - a.prominence);
    const topN = candidates.slice(0, Math.min(30, candidates.length));

    // ③ 按时间排序后，去除相邻同类型过近的点（间距 < win*2）
    topN.sort((a, b) => a.idx - b.idx);
    const filtered: Candidate[] = [];
    for (const c of topN) {
        const tooClose = filtered.some(f => Math.abs(f.idx - c.idx) < win * 2 && f.type === c.type);
        if (!tooClose) filtered.push(c);
    }

    // ④ 再次按时间排序，最多返回 14 个标签
    filtered.sort((a, b) => a.idx - b.idx);
    const kept = filtered.slice(0, 14);

    return kept.map(c => ({ time: data[c.idx].time as LightweightCharts.Time, price: c.price, type: c.type }));
}

// ─────────────────────────────────────────────
// Chart options factory
// ─────────────────────────────────────────────
function baseChartOpts(period: string): LightweightCharts.DeepPartial<LightweightCharts.ChartOptions> {
    return {
        layout:    { background: { type: LightweightCharts.ColorType.Solid, color: 'transparent' }, textColor: '#9ca3af', fontSize: 10 },
        grid:      { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: { width: 1, color: 'rgba(255,255,255,0.25)', style: LightweightCharts.LineStyle.Dashed },
            horzLine: { width: 1, color: 'rgba(255,255,255,0.25)', style: LightweightCharts.LineStyle.Dashed },
        },
        timeScale: {
            borderColor: 'rgba(255,255,255,0.08)',
            timeVisible: period !== '1d' && period !== '1w' && period !== '1M',
            secondsVisible: false,
            barSpacing: 10,
            minBarSpacing: 1,           // 🔧 从4→1：大幅增强缩图能力，手机端可同屏显示~350根K线
            fixLeftEdge: true,          // 🔧 固定左边缘，防止左滑越界
            lockVisibleTimeRangeOnResize: true,
        },
        rightPriceScale: {
            visible: false,             // 🔧 隐藏右侧价格刻度栏，价格通过主图内叠加标签显示
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale:  { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
        kineticScroll: { touch: true, mouse: false },
        localization: { locale: 'zh-CN', dateFormat: 'yyyy/MM/dd' },
    };
}

// ─────────────────────────────────────────────
// Legend Components (Memoized for Crosshair Performance)
// ─────────────────────────────────────────────
const MAIN_LABEL_H = 34;
const IND_LABEL_H = 20;

const TopLegend = memo(({ legendDataRef, updateLegendUIs }: { legendDataRef: React.MutableRefObject<FormattedChartData | null>, updateLegendUIs: React.MutableRefObject<Set<() => void>> }) => {
    const [, forceRender] = useState(0);

    useEffect(() => {
        const cb = () => forceRender(prev => prev + 1);
        updateLegendUIs.current.add(cb);
        return () => { updateLegendUIs.current.delete(cb); };
    }, [updateLegendUIs]);

    const currentLegend = legendDataRef.current;
    if (!currentLegend) return null;

    const changeVal = currentLegend.close - currentLegend.open;
    const changePct = currentLegend.open ? (changeVal / currentLegend.open) * 100 : 0;
    const isUp = changeVal >= 0;

    return (
        <div className="flex flex-col px-2 py-1.5 select-none border-b border-white/5 flex-shrink-0 bg-[#17191C]">
            <div className="flex items-center justify-between w-full">
                <div className={`flex flex-col shrink-0 ${isUp ? 'text-[#ef5350]' : 'text-[#26a69a]'}`}>
                    <div className="text-[24px] font-bold font-mono leading-none">{fmt(currentLegend.close)}</div>
                    <div className="flex items-center gap-2 text-[11px] font-mono mt-1 font-semibold">
                        <span>{isUp ? '+' : ''}{fmt(changeVal)}</span>
                        <span>{isUp ? '+' : ''}{fmt(changePct)}%</span>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground flex-1 ml-4 justify-items-end">
                    <div className="flex justify-between items-center w-full max-w-[100px]">
                        <span className="shrink-0 mr-1 opacity-70">高</span>
                        <span className="font-mono text-[#ef5350] truncate font-semibold">{fmt(currentLegend.high)}</span>
                    </div>
                    <div className="flex justify-between items-center w-full max-w-[100px]">
                        <span className="shrink-0 mr-1 opacity-70">低</span>
                        <span className="font-mono text-[#26a69a] truncate font-semibold">{fmt(currentLegend.low)}</span>
                    </div>
                    <div className="flex justify-between items-center w-full max-w-[100px]">
                        <span className="shrink-0 mr-1 opacity-70">开</span>
                        <span className="font-mono text-foreground truncate">{fmt(currentLegend.open)}</span>
                    </div>
                    <div className="flex justify-between items-center w-full max-w-[100px]">
                        <span className="shrink-0 mr-1 opacity-70">量</span>
                        <span className="font-mono text-foreground truncate">{fmtV(currentLegend.volume)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
});

const MaLegend = memo(({ legendDataRef, updateLegendUIs, period, visibleMAs }: { legendDataRef: React.MutableRefObject<FormattedChartData | null>, updateLegendUIs: React.MutableRefObject<Set<() => void>>, period: string, visibleMAs: Record<string, boolean> }) => {
    const [, forceRender] = useState(0);

    useEffect(() => {
        const cb = () => forceRender(prev => prev + 1);
        updateLegendUIs.current.add(cb);
        return () => { updateLegendUIs.current.delete(cb); };
    }, [updateLegendUIs]);

    const currentLegend = legendDataRef.current;

    return (
        <div
            className="absolute top-0 left-0 right-0 z-20 flex flex-col justify-center px-1.5 select-none bg-[#17191C] text-[10px] gap-y-0.5 border-b border-white/5 pointer-events-none"
            style={{ height: `${MAIN_LABEL_H}px` }}
        >
            <div className="flex flex-wrap items-center justify-between text-muted-foreground w-full">
                <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-foreground flex items-center gap-0.5 pointer-events-auto">
                        MA <ChevronDown className="h-3 w-3" />
                    </span>
                    <span>{currentLegend ? fmtTime(currentLegend.time, period) : ''}</span>
                    <span>{PERIOD_LABEL_MAP[period] || period}</span>
                </div>
                <div className="flex items-center pointer-events-auto cursor-pointer">
                    <Eye className="h-3 w-3" />
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-[10px]">
                <span className="text-muted-foreground font-semibold">MA</span>
                {currentLegend && Object.entries(maConfig).map(([k, c]) =>
                    visibleMAs[k] && (
                        <span key={k} style={{ color: c.color }}>
                            {c.label.replace('MA', '')}:{fmt(currentLegend[k as keyof FormattedChartData] as number, 2)}
                        </span>
                    )
                )}
            </div>
        </div>
    );
});

const IndLegend = memo(({
    legendDataRef,
    updateLegendUIs,
    ind,
    paneIndex,
    onChangeIndicator,
}: {
    legendDataRef: React.MutableRefObject<FormattedChartData | null>;
    updateLegendUIs: React.MutableRefObject<Set<() => void>>;
    ind: IndicatorType;
    paneIndex: number;
    onChangeIndicator?: (idx: number, val: IndicatorType) => void;
}) => {
    const [, forceRender] = useState(0);

    useEffect(() => {
        const cb = () => forceRender(prev => prev + 1);
        updateLegendUIs.current.add(cb);
        return () => { updateLegendUIs.current.delete(cb); };
    }, [updateLegendUIs]);

    const currentLegend = legendDataRef.current;

    const row = (items: [string, string, number|undefined][]) => (
        <div className="flex items-center gap-2 text-[10px] ml-1">
            {items.map(([label, color, val]) => (
                <span key={label} style={{ color }}>{label}:{fmt(val)}</span>
            ))}
        </div>
    );

    return (
        <div
            className="absolute top-0 left-0 right-0 z-20 flex items-center flex-wrap gap-1 px-1.5 select-none bg-[#17191C] text-[10px] pointer-events-none"
            style={{ height: `${IND_LABEL_H}px` }}
        >
            {/* ── 指标切换器：pointer-events-auto 穿透父层 none，让 Select 可点击 ── */}
            <div className="pointer-events-auto flex-shrink-0">
                {onChangeIndicator ? (
                    <Select
                        value={ind}
                        onValueChange={(v) => onChangeIndicator(paneIndex, v as IndicatorType)}
                    >
                        <SelectTrigger
                            className="h-6 min-w-[36px] px-1 border-0 bg-transparent shadow-none focus:ring-0
                                       text-[10px] font-semibold text-foreground gap-0.5
                                       hover:bg-white/10 rounded
                                       [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:opacity-60"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        {/* position="popper"：Portal 渲染跟随 trigger，不受 overflow:hidden 裁剪 */}
                        {/* z-[999]：确保浮出所有 canvas 层 */}
                        <SelectContent position="popper" className="z-[999] min-w-[80px]">
                            {indicatorList.map(item => (
                                <SelectItem key={item.value} value={item.value} className="text-xs">
                                    {item.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : (
                    // 未传回调时降级为静态展示（兼容其他使用场景）
                    <span className="font-semibold text-foreground flex items-center gap-0.5">
                        {ind} <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
                    </span>
                )}
            </div>

            {/* 参数说明 */}
            <span className="text-muted-foreground pointer-events-none">
                {ind === 'MACD' ? '(12,26,9)' : ind === 'CCI' ? '(14)' : ind === 'KDJ' ? '(9,3,3)' : ind === 'BIAS' ? '(24)' : ind === 'TROC_S' ? 'OSC±1.5 · ADX>25信号有效' : ind === 'TROC_L' ? 'Phase+1吸/-1派 · OSC±1.5' : ''}
            </span>

            {/* 数值图例 */}
            {currentLegend && (
                <>
                    {ind === 'Volume' && <span className="text-[10px] text-muted-foreground ml-1">量:{fmtV(currentLegend.volume)}</span>}
                    {ind === 'MACD' && row([['MACD', '#ef5350', currentLegend.macd_hist], ['DIFF', macdConfig.macd.color, currentLegend.macd], ['DEA', macdConfig.macd_signal.color, currentLegend.macd_signal]])}
                    {ind === 'KDJ' && row([['K', kdjConfig.k.color, currentLegend.kdj_k], ['D', kdjConfig.d.color, currentLegend.kdj_d], ['J', kdjConfig.j.color, currentLegend.kdj_j]])}
                    {ind === 'RSI' && row([['RSI1', rsiConfig.rsi1.color, currentLegend.rsi_6], ['RSI2', rsiConfig.rsi2.color, currentLegend.rsi_12], ['RSI3', rsiConfig.rsi3.color, currentLegend.rsi_24]])}
                    {ind === 'TRIX' && row([['TRIX', trixConfig.trix.color, currentLegend.trix], ['TRMA', trixConfig.trma.color, currentLegend.trma]])}
                    {ind === 'DMI' && row([['DI1', dmiConfig.pdi.color, currentLegend.pdi], ['DI2', dmiConfig.mdi.color, currentLegend.mdi], ['ADX', dmiConfig.adx.color, currentLegend.adx], ['ADXR', dmiConfig.adxr.color, currentLegend.adxr]])}
                    {ind === 'BIAS' && row([['B1', biasConfig.bias6.color, currentLegend.bias_6], ['B2', biasConfig.bias12.color, currentLegend.bias_12], ['B3', biasConfig.bias24.color, currentLegend.bias_24]])}
                    {ind === 'BBI' && row([['BBI', bbiConfig.bbi.color, currentLegend.bbi]])}
                    {ind === 'CCI' && row([['CCI', cciConfig.cci.color, currentLegend.cci]])}
                    {ind === 'DPO' && row([['DPO', dpoConfig.dpo.color, currentLegend.dpo], ['MA', dpoConfig.madpo.color, currentLegend.madpo]])}
                    {ind === 'BOLL' && row([['UP', bollConfig.upper.color, currentLegend.boll_upper], ['MID', bollConfig.middle.color, currentLegend.boll_middle], ['LO', bollConfig.lower.color, currentLegend.boll_lower]])}
                    {ind === 'LON' && row([['LON', lonConfig.lon.color, currentLegend.lon], ['MA', lonConfig.lonma.color, currentLegend.lonma]])}
                    {ind === 'TROC_S' && row([['OSC', trocConfig.osc.color, currentLegend.troc_osc], ['Sig', trocConfig.oscMa.color, currentLegend.troc_osc_ma], ['TRIX', trocConfig.trix.color, currentLegend.troc_trix_s], ['ADX', trocConfig.adx.color, currentLegend.troc_adx_s]])}
                    {ind === 'TROC_L' && row([['OSC', trocConfig.osc.color, currentLegend.troc_osc_l], ['Sig', trocConfig.oscMa.color, currentLegend.troc_osc_ma_l], ['Phase', trocConfig.phase, currentLegend.troc_phase], ['Acc', '#00E676', currentLegend.troc_acc], ['Pct', trocConfig.trix.color, currentLegend.troc_pct]])}
                </>
            )}
        </div>
    );
});

// ─────────────────────────────────────────────
// KlineChart Component
// ─────────────────────────────────────────────
export function KlineChart({
    stockCode, period, visibleMAs, indicatorPanes,
    showDivergence, showTrixSignal, showDpoSignal, showBbiSignal,
    toolbar,
    onChangeIndicator,
    onDataReady,
    targetTime,    // ★ 新增
}: {
    stockCode: string; period: string;
    visibleMAs: Record<string, boolean>; indicatorPanes: IndicatorType[];
    showDivergence: boolean; showTrixSignal: boolean; showDpoSignal: boolean; showBbiSignal: boolean;
    toolbar?: React.ReactNode;
    onChangeIndicator?: (idx: number, val: IndicatorType) => void;
    /** AI 分析：数据就绪后回调最新的完整数据 */
    onDataReady?: (data: FormattedChartData[]) => void;
    /** ★ 新增：来自信号明细的跳转目标时间，格式 "YYYY-MM-DD" 或 "YYYY-MM-DD HH:mm:ss" */
    targetTime?: string;
}) {
    const token = useAuthStore(s => s.token);
    const containerRef = useRef<HTMLDivElement>(null);
    const mainChartRef = useRef<IChartApi | null>(null);      // 🔧 主图实例引用（供价格标签计算使用）
    const extremaRef   = useRef<SwingPoint[]>([]);             // 🔧 波段高低点数据
    // ★ 新增：用 ref 追踪最新 targetTime，避免触发图表重建
    const targetTimeRef = useRef<string | undefined>(targetTime);
    useEffect(() => { targetTimeRef.current = targetTime; }, [targetTime]);

    type LabelPos = { x: number; y: number; price: number; type: 'high' | 'low' };
    const [labelPositions, setLabelPositions] = useState<LabelPos[]>([]); // 🔧 渲染标签的像素坐标

    const [data,    setData   ] = useState<FormattedChartData[]>([]);
    const dataMapRef = useRef(new Map<LightweightCharts.Time, FormattedChartData>());
    const [loading, setLoading] = useState(true);
    const [error,   setError  ] = useState<string | null>(null);
    const [renderError, setRenderError] = useState<string | null>(null);
    const [debugInfo, setDebugInfo] = useState<string>('');
    const legendDataRef = useRef<FormattedChartData | null>(null);
    const lastLegendTimeRef = useRef<LightweightCharts.Time | null>(null);
    const updateLegendUIs = useRef<Set<() => void>>(new Set());
    const seriesRefs = useRef<{
        candle: ISeriesApi<"Candlestick"> | null;
        mas: Record<string, ISeriesApi<"Line">>;
        indicators: Record<string, ISeriesApi<any>>;
    }>({ candle: null, mas: {}, indicators: {} });
    // ★ 存储背离等基础 markers，与跳转箭头合并，互不覆盖
    const baseMarkersRef = useRef<LightweightCharts.SeriesMarker<LightweightCharts.Time>[]>([]);

    const stockLabel = STOCKS.find(s => s.value === stockCode)?.label || stockCode;

    // ─── 1. Data loading ───────────────────────────────────────────
    useEffect(() => {
        let alive = true;
        async function load() {
            if (!token && !isCapacitor) return;
            if (!stockCode) { setData([]); dataMapRef.current = new Map(); legendDataRef.current = null; setError(null); setLoading(false); return; }
            setLoading(true); setError(null); setData([]); dataMapRef.current = new Map(); legendDataRef.current = null;
            try {
                const raw = await fetchKlineData(stockCode, period, token || '');
                if (!alive) return;
                if (!raw.length) { setData([]); setLoading(false); return; }
                let transformed = raw.map(d => transformData(d, period)).filter((d): d is FormattedChartData => d !== null);
                
                // 去重，由于 lightweight-charts 不允许存在重复时间戳
                const uniqueMap = new Map();
                transformed.forEach(d => uniqueMap.set(d.time, d));
                transformed = Array.from(uniqueMap.values());
                
                transformed.sort((a, b) => {
                    const tA = typeof a.time==='string' ? new Date(a.time).getTime() : (a.time as number);
                    const tB = typeof b.time==='string' ? new Date(b.time).getTime() : (b.time as number);
                    return tA - tB;
                });
                transformed = calculateAllIndicators(transformed as any, 'review') as FormattedChartData[];
                const map = new Map<LightweightCharts.Time, FormattedChartData>();
                transformed.forEach(d => map.set(d.time, d));
                setData(transformed); dataMapRef.current = map;
                if (transformed.length > 0) {
                    legendDataRef.current = transformed[transformed.length - 1];
                    updateLegendUIs.current.forEach(cb => cb());
                    // AI 数据回调：将完整 K 线+指标数据暴露给父组件
                    onDataReady?.(transformed);
                } else {
                    legendDataRef.current = null;
                }
            } catch (e: any) {
                if (alive) setError(e.message);
            } finally {
                if (alive) setLoading(false);
            }
        }
        load();
        return () => { alive = false; };
    }, [stockCode, period, token]);

    // ─── 2. Chart rendering (rAF 延迟，等 flex 布局完成) ──────────
    useEffect(() => {
        if (loading || error || !data.length || !containerRef.current) return;

        let disposed = false;
        let initialized = false; 
        let rafHandle: number;
        let retryCount = 0;
        const MAX_RETRY = 60;    

        let allCharts: IChartApi[] = [];
        let ro: ResizeObserver | null = null;
        const syncRafIds = new Map<IChartApi, number>();

        const initChart = () => {
            try {
                if (disposed || initialized || !containerRef.current) return;

                const root   = containerRef.current;
                const mainEl = root.querySelector<HTMLDivElement>('[data-pane="main"]');
                const indEls = indicatorPanes
                    .map((_, i) => root.querySelector<HTMLDivElement>(`[data-pane="ind-${i}"]`))
                    .filter(Boolean) as HTMLDivElement[];
                    
                if (!mainEl || indEls.length !== indicatorPanes.length) return;
                
                const { clientWidth, clientHeight } = mainEl;
                
                if (!clientWidth || !clientHeight) {
                    if (retryCount++ > MAX_RETRY) {
                        console.warn('Chart init aborted: container size still 0 after 60 frames.');
                        setDebugInfo(`布局失败: 容器高度为 0`);
                        return; 
                    }
                    setDebugInfo(`Waiting layout... ${retryCount}/${MAX_RETRY}`);
                    rafHandle = requestAnimationFrame(initChart);
                    return; 
                }

                initialized = true;
                setDebugInfo(`root: ${root.clientHeight}px, mainEl: ${mainEl.clientHeight}px`);

                const sopts = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, lineWidth: 1 as 1 };

                // ── Main chart ──
                const mainChart = LightweightCharts.createChart(mainEl, {
                    ...baseChartOpts(period),
                    width:  clientWidth,
                    height: clientHeight,
                    timeScale: {
                        ...baseChartOpts(period).timeScale,
                        visible: indEls.length === 0, 
                    }
                });
                const candleSeries = mainChart.addCandlestickSeries({
                    upColor: '#ef5350', downColor: '#26a69a', borderVisible: false,
                    wickUpColor: '#ef5350', wickDownColor: '#26a69a',
                });
                candleSeries.setData(data);
                seriesRefs.current.candle = candleSeries;

                // 🔧 存储主图实例引用，计算波段高低点
                mainChartRef.current = mainChart;
                extremaRef.current = detectSwingPoints(data);

                // 🔧 计算价格标签的像素坐标（在可见区域内的极值点）
                const computeLabelPositions = () => {
                    const series = seriesRefs.current.candle;
                    if (!series || !extremaRef.current.length) return;
                    const chartWidth = mainEl.clientWidth;
                    const positions: LabelPos[] = [];
                    for (const pt of extremaRef.current) {
                        const x = mainChart.timeScale().timeToCoordinate(pt.time);
                        const y = series.priceToCoordinate(pt.price);
                        if (x === null || y === null) continue;
                        if (x < 10 || x > chartWidth - 10) continue; // 超出可视区忽略
                        positions.push({ x, y, price: pt.price, type: pt.type });
                    }
                    setLabelPositions(positions);
                };

                // 首次渲染后计算 + 滚动/缩放时实时更新
                requestAnimationFrame(computeLabelPositions);
                mainChart.timeScale().subscribeVisibleLogicalRangeChange(() => {
                    requestAnimationFrame(computeLabelPositions);
                });

                // MA lines - 初始化所有的 MA
                Object.keys(maConfig).forEach(key => {
                    const s = mainChart.addLineSeries({ color: maConfig[key].color, visible: !!visibleMAs[key], ...sopts });
                    s.setData(safeData(data, key as keyof FormattedChartData));
                    seriesRefs.current.mas[key] = s;
                });
                
                // 初始 Divergence Marker
                if (showDivergence) candleSeries.setMarkers(sortMarkers(calcMacdDivergence(data)));

                // ── Indicator charts ──
                const indCharts: IChartApi[] = indEls.map((el, idx) => {
                    const isLast = idx === indEls.length - 1;
                    return LightweightCharts.createChart(el, {
                        ...baseChartOpts(period),
                        width:  el.clientWidth,
                        height: el.clientHeight,
                        timeScale: {
                            ...baseChartOpts(period).timeScale,
                            visible: isLast,
                        },
                        rightPriceScale: {
                            visible: false,  // 🔧 副图同样隐藏右侧价格栏
                        },
                    });
                });

                const drawIndicator = (chart: IChartApi, ind: IndicatorType): ISeriesApi<any> | null => {
                    let primary: ISeriesApi<any> | null = null;
                    switch (ind) {
                        case 'Volume': {
                            const s = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, ...sopts });
                            s.setData(data.map(d => ({ time: d.time, value: d.volume, color: d.close >= d.open ? 'rgba(239,83,80,0.7)' : 'rgba(38,166,154,0.7)' })));
                            if (data[0]?.vol_ma5 != null) chart.addLineSeries({ ...sopts, color: maConfig.ma5.color, lineWidth: 1 }).setData(safeData(data, 'vol_ma5'));
                            if (data[0]?.vol_ma10 != null) chart.addLineSeries({ ...sopts, color: maConfig.ma10.color, lineWidth: 1 }).setData(safeData(data, 'vol_ma10'));
                            primary = s; break;
                        }
                        case 'MACD': {
                            primary = chart.addLineSeries({ ...sopts, color: macdConfig.macd.color, lineWidth: 1 });
                            (primary as any).setData(safeData(data, 'macd'));
                            chart.addLineSeries({ ...sopts, color: macdConfig.macd_signal.color, lineWidth: 1 }).setData(safeData(data, 'macd_signal'));
                            chart.addHistogramSeries({ priceFormat: { type: 'volume' }, ...sopts })
                                 .setData(data.map(d => ({ time: d.time, value: d.macd_hist, color: (d.macd_hist||0) >= 0 ? '#ef5350' : '#26a69a' })));
                            break;
                        }
                        case 'KDJ': {
                            primary = chart.addLineSeries({ ...sopts, color: kdjConfig.k.color, lineWidth: 1 });
                            (primary as any).setData(safeData(data, 'kdj_k'));
                            chart.addLineSeries({ ...sopts, color: kdjConfig.d.color, lineWidth: 1 }).setData(safeData(data, 'kdj_d'));
                            chart.addLineSeries({ ...sopts, color: kdjConfig.j.color, lineWidth: 1 }).setData(safeData(data, 'kdj_j'));
                            [20, 80].forEach(v => chart.addLineSeries({ ...sopts, color: 'rgba(145,55,76,0.3)', lineStyle: LightweightCharts.LineStyle.Dotted, lineWidth: 1 }).setData(data.map(d => ({ time: d.time, value: v }))));
                            break;
                        }
                        case 'RSI': {
                            primary = chart.addLineSeries({ ...sopts, color: rsiConfig.rsi1.color, lineWidth: 1 });
                            (primary as any).setData(safeData(data, 'rsi_6'));
                            chart.addLineSeries({ ...sopts, color: rsiConfig.rsi2.color, lineWidth: 1 }).setData(safeData(data, 'rsi_12'));
                            chart.addLineSeries({ ...sopts, color: rsiConfig.rsi3.color, lineWidth: 1 }).setData(safeData(data, 'rsi_24'));
                            [30, 70].forEach(v => chart.addLineSeries({ ...sopts, color: 'rgba(145,55,76,0.3)', lineStyle: LightweightCharts.LineStyle.Dotted, lineWidth: 1 }).setData(data.map(d => ({ time: d.time, value: v }))));
                            break;
                        }
                        case 'TRIX': {
                            primary = chart.addLineSeries({ ...sopts, color: trixConfig.trix.color, lineWidth: 1 });
                            (primary as any).setData(safeData(data, 'trix'));
                            if (showTrixSignal) (primary as any).setMarkers(sortMarkers(calcCrossSignals(data, 'trix', 'trma')));
                            chart.addLineSeries({ ...sopts, color: trixConfig.trma.color, lineWidth: 1 }).setData(safeData(data, 'trma'));
                            break;
                        }
                        case 'DMI': {
                            primary = chart.addLineSeries({ ...sopts, color: dmiConfig.pdi.color, lineWidth: 1 });
                            (primary as any).setData(safeData(data, 'pdi'));
                            chart.addLineSeries({ ...sopts, color: dmiConfig.mdi.color,  lineWidth: 1 }).setData(safeData(data, 'mdi'));
                            chart.addLineSeries({ ...sopts, color: dmiConfig.adx.color,  lineWidth: 1 }).setData(safeData(data, 'adx'));
                            chart.addLineSeries({ ...sopts, color: dmiConfig.adxr.color, lineWidth: 1 }).setData(safeData(data, 'adxr'));
                            break;
                        }
                        case 'BIAS': {
                            primary = chart.addLineSeries({ ...sopts, color: biasConfig.bias6.color,  lineWidth: 1 });
                            (primary as any).setData(safeData(data, 'bias_6'));
                            chart.addLineSeries({ ...sopts, color: biasConfig.bias12.color, lineWidth: 1 }).setData(safeData(data, 'bias_12'));
                            chart.addLineSeries({ ...sopts, color: biasConfig.bias24.color, lineWidth: 1 }).setData(safeData(data, 'bias_24'));
                            break;
                        }
                        case 'BBI': {
                            primary = chart.addLineSeries({ ...sopts, color: bbiConfig.bbi.color, lineWidth: 1 });
                            (primary as any).setData(safeData(data, 'bbi'));
                            if (showBbiSignal) (primary as any).setMarkers(sortMarkers(calcBbiSignals(data)));
                            chart.addLineSeries({ ...sopts, color: bbiConfig.close.color, lineWidth: 1 }).setData(safeData(data, 'close'));
                            break;
                        }
                        case 'CCI': {
                            primary = chart.addLineSeries({ ...sopts, color: cciConfig.cci.color, lineWidth: 1 });
                            (primary as any).setData(safeData(data, 'cci'));
                            [-100, 100].forEach(v => chart.addLineSeries({ ...sopts, color: 'rgba(145,55,76,0.5)', lineStyle: LightweightCharts.LineStyle.Dotted, lineWidth: 1 }).setData(data.map(d => ({ time: d.time, value: v }))));
                            break;
                        }
                        case 'DPO': {
                            primary = chart.addLineSeries({ ...sopts, color: dpoConfig.dpo.color, lineWidth: 1 });
                            (primary as any).setData(safeData(data, 'dpo'));
                            if (showDpoSignal) (primary as any).setMarkers(sortMarkers(calcCrossSignals(data, 'dpo', 'madpo')));
                            chart.addLineSeries({ ...sopts, color: dpoConfig.madpo.color, lineWidth: 1 }).setData(safeData(data, 'madpo'));
                            break;
                        }
                        case 'BOLL': {
                            const cs2 = chart.addCandlestickSeries({ upColor: '#ef5350', downColor: '#26a69a', borderVisible: false, wickUpColor: '#ef5350', wickDownColor: '#26a69a' });
                            cs2.setData(data);
                            chart.addLineSeries({ ...sopts, color: bollConfig.upper.color,  lineWidth: 1 }).setData(safeData(data, 'boll_upper'));
                            chart.addLineSeries({ ...sopts, color: bollConfig.middle.color, lineStyle: LightweightCharts.LineStyle.Dashed, lineWidth: 1 }).setData(safeData(data, 'boll_middle'));
                            chart.addLineSeries({ ...sopts, color: bollConfig.lower.color,  lineWidth: 1 }).setData(safeData(data, 'boll_lower'));
                            chart.addLineSeries({ ...sopts, color: maConfig.ma5.color,  lineWidth: 1 }).setData(safeData(data, 'ma5'));
                            chart.addLineSeries({ ...sopts, color: maConfig.ma10.color, lineWidth: 1 }).setData(safeData(data, 'ma10'));
                            primary = cs2; break;
                        }
                        case 'LON': {
                            primary = chart.addLineSeries({ ...sopts, color: lonConfig.lon.color, lineWidth: 1 });
                            (primary as any).setData(safeData(data, 'lon'));
                            chart.addLineSeries({ ...sopts, color: lonConfig.lonma.color, lineWidth: 1 }).setData(safeData(data, 'lonma'));
                            chart.addHistogramSeries({ priceFormat: { type: 'volume' }, ...sopts })
                                 .setData(data.map(d => ({ time: d.time, value: d.lon, color: (d.lon||0) >= 0 ? '#ef5350' : '#26a69a' })));
                            break;
                        }
                        case 'TROC_S': {
                            // 零轴（最底层）
                            chart.addLineSeries({ ...sopts, color: trocConfig.zero, lineStyle: LightweightCharts.LineStyle.Dotted, lineWidth: 1 })
                                 .setData(data.map(d => ({ time: d.time, value: 0 })));
                            // 动态超卖线（绿虚）
                            chart.addLineSeries({ ...sopts, color: trocConfig.os, lineStyle: LightweightCharts.LineStyle.Dashed, lineWidth: 1 })
                                 .setData(data.map(d => ({ time: d.time, value: d.troc_os_dyn ?? -1.5 })));
                            // 动态超买线（红虚）
                            chart.addLineSeries({ ...sopts, color: trocConfig.ob, lineStyle: LightweightCharts.LineStyle.Dashed, lineWidth: 1 })
                                 .setData(data.map(d => ({ time: d.time, value: d.troc_ob_dyn ?? 1.5 })));
                            // TRIX归一化趋势线（灰）
                            chart.addLineSeries({ ...sopts, color: trocConfig.trix.color, lineWidth: 1 })
                                 .setData(safeData(data, 'troc_trix_s'));
                            // ADX线 + ADX=25 趋势/震荡分界参考线（白色点线）
                            chart.addLineSeries({ ...sopts, color: trocConfig.adx.color, lineStyle: LightweightCharts.LineStyle.Dashed, lineWidth: 1 })
                                 .setData(safeData(data, 'troc_adx_s'));
                            chart.addLineSeries({ ...sopts, color: 'rgba(255,255,255,0.18)', lineStyle: LightweightCharts.LineStyle.Dotted, lineWidth: 1 })
                                 .setData(data.map(d => ({ time: d.time, value: 25 })));
                            // OSC_MA信号线（橙）
                            chart.addLineSeries({ ...sopts, color: trocConfig.oscMa.color, lineWidth: 1 })
                                 .setData(safeData(data, 'troc_osc_ma'));
                            // OSC主线（蓝，2px，最顶层）
                            primary = chart.addLineSeries({ ...sopts, color: trocConfig.osc.color, lineWidth: 2 });
                            (primary as any).setData(safeData(data, 'troc_osc'));
                            // BUY/SELL 箭头标记（对齐 Python DISPLAY_CONFIG_SHORT markers）
                            const buyMarkersS = data
                                .filter(d => d.troc_buy_s != null)
                                .map(d => ({ time: d.time, position: 'belowBar' as const, color: '#00E676', shape: 'arrowUp' as const, text: 'B' }));
                            const sellMarkersS = data
                                .filter(d => d.troc_sell_s != null)
                                .map(d => ({ time: d.time, position: 'aboveBar' as const, color: '#FF1744', shape: 'arrowDown' as const, text: 'S' }));
                            (primary as any).setMarkers(sortMarkers([...buyMarkersS, ...sellMarkersS]));
                            break;
                        }
                        case 'TROC_L': {
                            // 零轴
                            chart.addLineSeries({ ...sopts, color: trocConfig.zero, lineStyle: LightweightCharts.LineStyle.Dotted, lineWidth: 1 })
                                 .setData(data.map(d => ({ time: d.time, value: 0 })));
                            // 吸筹强度柱（浅绿，正向）
                            chart.addHistogramSeries({ ...sopts, color: trocConfig.acc })
                                 .setData(data.map(d => ({ time: d.time, value: d.troc_acc ?? 0 })));
                            // 派筹强度柱（浅红，负向，troc-math 已取负值）
                            chart.addHistogramSeries({ ...sopts, color: trocConfig.dist })
                                 .setData(data.map(d => ({ time: d.time, value: d.troc_dist ?? 0 })));
                            // 动态超卖线
                            chart.addLineSeries({ ...sopts, color: trocConfig.os, lineStyle: LightweightCharts.LineStyle.Dashed, lineWidth: 1 })
                                 .setData(data.map(d => ({ time: d.time, value: d.troc_os_dyn ?? -1.5 })));
                            // 动态超买线
                            chart.addLineSeries({ ...sopts, color: trocConfig.ob, lineStyle: LightweightCharts.LineStyle.Dashed, lineWidth: 1 })
                                 .setData(data.map(d => ({ time: d.time, value: d.troc_ob_dyn ?? 1.5 })));
                            // PHASE状态线（±1.2缩放，在副图范围内可见）
                            chart.addLineSeries({ ...sopts, color: trocConfig.phase, lineStyle: LightweightCharts.LineStyle.Dashed, lineWidth: 1 })
                                 .setData(data.map(d => ({ time: d.time, value: (d.troc_phase ?? 0) * 1.2 })));
                            // TRIX长期归一化（灰）
                            chart.addLineSeries({ ...sopts, color: trocConfig.trix.color, lineWidth: 1 })
                                 .setData(safeData(data, 'troc_trix_l'));
                            // OSC_MA_L信号线（橙）
                            chart.addLineSeries({ ...sopts, color: trocConfig.oscMa.color, lineWidth: 1 })
                                 .setData(safeData(data, 'troc_osc_ma_l'));
                            // OSC_L主线（蓝，2px）
                            primary = chart.addLineSeries({ ...sopts, color: trocConfig.osc.color, lineWidth: 2 });
                            (primary as any).setData(safeData(data, 'troc_osc_l'));
                            // BUY/SELL 箭头标记（对齐 Python DISPLAY_CONFIG_LONG markers，L=Long长线）
                            const buyMarkersL = data
                                .filter(d => d.troc_buy_l != null)
                                .map(d => ({ time: d.time, position: 'belowBar' as const, color: '#00E676', shape: 'arrowUp' as const, text: 'L' }));
                            const sellMarkersL = data
                                .filter(d => d.troc_sell_l != null)
                                .map(d => ({ time: d.time, position: 'aboveBar' as const, color: '#FF1744', shape: 'arrowDown' as const, text: 'S' }));
                            (primary as any).setMarkers(sortMarkers([...buyMarkersL, ...sellMarkersL]));
                            break;
                        }
                    }
                    return primary;
                };

                const indSeries = indicatorPanes.map((ind, i) => {
                    const s = drawIndicator(indCharts[i], ind);
                    if (s) seriesRefs.current.indicators[ind] = s;
                    return s;
                });
                allCharts = [mainChart, ...indCharts];

                // ─── Cross-chart sync with rAF debounce ───
                let syncingRange = false;
                const syncGroup = [
                    { chart: mainChart, series: candleSeries, field: 'close' as keyof FormattedChartData },
                    ...indicatorPanes.map((ind, i) => ({ chart: indCharts[i], series: indSeries[i], field: getPrimaryField(ind) })),
                ];

                allCharts.forEach(chart => {
                    chart.subscribeCrosshairMove(param => {

                        // ── 步骤1：十字光标位置同步（纯 Canvas 操作，必须同步执行）──────────────
                        // setCrosshairPosition 放在 rAF 里会导致副图竖线比主图晚渲染一帧(~16ms)
                        // 手指快速滑动时产生肉眼可见的动态错位，必须拆出来同步调用
                        if (!param.point || !param.time) {
                            syncGroup.forEach(g => { if (g.chart !== chart) g.chart.clearCrosshairPosition(); });
                        } else {
                            syncGroup.forEach(g => {
                                if (g.chart === chart || !g.series) return;
                                const dp = dataMapRef.current.get(param.time!);
                                const price = dp?.[g.field];
                                if (price != null && !isNaN(price as number))
                                    g.chart.setCrosshairPosition(price as number, param.time!, g.series);
                                else
                                    g.chart.clearCrosshairPosition();
                            });
                        }

                        // ── 步骤2：图例文字更新（触发 React re-render，用 rAF 节流防卡顿）──────
                        const existingId = syncRafIds.get(chart);
                        if (existingId) cancelAnimationFrame(existingId);

                        const newId = requestAnimationFrame(() => {
                            if (!param.point || !param.time) {
                                if (data.length) {
                                    legendDataRef.current = data[data.length - 1];
                                    updateLegendUIs.current.forEach(cb => cb());
                                }
                                lastLegendTimeRef.current = null;
                                return;
                            }

                            // 只有移动到新的一根K线时，才触发图例重绘
                            if (param.time !== lastLegendTimeRef.current) {
                                lastLegendTimeRef.current = param.time;
                                const dp = dataMapRef.current.get(param.time);
                                if (dp) {
                                    legendDataRef.current = dp;
                                    updateLegendUIs.current.forEach(cb => cb());
                                }
                            }
                        });
                        syncRafIds.set(chart, newId);
                    });

                    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
                        if (syncingRange || !range) return;
                        syncingRange = true;
                        allCharts.forEach(c => { if (c !== chart) c.timeScale().setVisibleLogicalRange(range); });
                        syncingRange = false;
                    });
                });

                // ─── ResizeObserver — 处理后续尺寸变化 ───
                const elMap = new Map<Element, IChartApi>();
                elMap.set(mainEl, mainChart);
                indEls.forEach((el, i) => elMap.set(el, indCharts[i]));
                
                const sizeCache = new WeakMap<Element, { width: number; height: number }>();

                ro = new ResizeObserver(entries => {
                    requestAnimationFrame(() => {
                        entries.forEach(entry => {
                            const c = elMap.get(entry.target);
                            if (!c) return;

                            const width = Math.floor(entry.contentRect.width);
                            const height = Math.floor(entry.contentRect.height);

                            if (width <= 0 || height <= 0) return;

                            const prev = sizeCache.get(entry.target);
                            if (!prev || prev.width !== width || prev.height !== height) {
                                sizeCache.set(entry.target, { width, height });
                                c.applyOptions({ width, height });
                            }
                        });
                    });
                });
                [mainEl, ...indEls].forEach(el => ro!.observe(el));

                // ★ 图表初始化完成后：定位到 targetTime K线 + 绘制金色箭头
                if (targetTimeRef.current) {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            if (!disposed && targetTimeRef.current) {
                                // 定位滚动
                                scrollToTargetTime(mainChart, data, targetTimeRef.current, period);
                                // 绘制金色箭头（在图表初始化完成后立即画，避免 Effect 时序问题）
                                const dateStr   = targetTimeRef.current.slice(0, 10);
                                const isDayPlus = period === '1d' || period === '1w' || period === '1M';
                                let   targetBar: FormattedChartData | undefined;
                                if (isDayPlus) {
                                    targetBar = data.find(d => String(d.time).slice(0, 10) === dateStr);
                                } else {
                                    const isoStr  = targetTimeRef.current.replace(' ', 'T') + (targetTimeRef.current.includes('+') ? '' : '+08:00');
                                    const ts      = Math.floor(new Date(isoStr).getTime() / 1000);
                                    targetBar = data.find(d => d.time === ts);
                                    if (!targetBar) targetBar = data.find(d => {
                                        const t = typeof d.time === 'number'
                                            ? new Date((d.time as number) * 1000).toISOString().slice(0, 10)
                                            : String(d.time).slice(0, 10);
                                        return t === dateStr;
                                    });
                                }
                                if (targetBar) {
                                    const arrow: LightweightCharts.SeriesMarker<LightweightCharts.Time> = {
                                        time: targetBar.time, position: 'belowBar',
                                        color: '#FFD700', shape: 'arrowUp',
                                        text: '▲ 信号', size: 2,
                                    };
                                    candleSeries.setMarkers(sortMarkers([...baseMarkersRef.current, arrow]));
                                }
                            }
                        });
                    });
                }
                
            } catch (err: any) {
                console.error("Chart render error:", err);
                setRenderError(err.message || '图表渲染错误');
            }
        };
        rafHandle = requestAnimationFrame(initChart);

        return () => {
            disposed = true; 
            if (rafHandle) cancelAnimationFrame(rafHandle);
            syncRafIds.forEach(id => cancelAnimationFrame(id));
            syncRafIds.clear();
            mainChartRef.current = null;   // 🔧 清除主图引用
            setLabelPositions([]);         // 🔧 清除价格标签
            if (ro) ro.disconnect();
            allCharts.forEach(c => c.remove());
        };
    }, [data, period, indicatorPanes]); // 去除了 visibleMAs 和 showDivergence 等状态

    // ★ 新增 useEffect：targetTime 变化时（图表已渲染），重新执行定位
    // 场景：同品种点击了不同信号行，targetTime 变化但图表不重建
    useEffect(() => {
        if (!targetTime || !mainChartRef.current || !data.length) return;
        const timer = setTimeout(() => {
            if (mainChartRef.current && data.length) {
                scrollToTargetTime(mainChartRef.current, data, targetTime, period);
            }
        }, 150);
        return () => clearTimeout(timer);
    }, [targetTime, data, period]);

    // ★ targetTime 变化时（图表已存在，如同品种换信号行）：重新定位 + 更新箭头
    useEffect(() => {
        const candle = seriesRefs.current.candle;
        const base   = baseMarkersRef.current;

        if (!targetTime) {
            if (candle && data.length) candle.setMarkers(base);
            return;
        }
        if (!data.length || !candle) return;

        const dateStr   = targetTime.slice(0, 10);
        const isDayPlus = period === '1d' || period === '1w' || period === '1M';
        let   targetBar: FormattedChartData | undefined;

        if (isDayPlus) {
            targetBar = data.find(d => String(d.time).slice(0, 10) === dateStr);
        } else {
            const isoStr  = targetTime.replace(' ', 'T') + (targetTime.includes('+') ? '' : '+08:00');
            const ts      = Math.floor(new Date(isoStr).getTime() / 1000);
            targetBar = data.find(d => d.time === ts);
            if (!targetBar) targetBar = data.find(d => {
                const t = typeof d.time === 'number'
                    ? new Date((d.time as number) * 1000).toISOString().slice(0, 10)
                    : String(d.time).slice(0, 10);
                return t === dateStr;
            });
        }

        if (targetBar) {
            const arrow: LightweightCharts.SeriesMarker<LightweightCharts.Time> = {
                time: targetBar.time, position: 'belowBar',
                color: '#FFD700', shape: 'arrowUp',
                text: '▲ 信号', size: 2,
            };
            candle.setMarkers(sortMarkers([...base, arrow]));
        } else {
            candle.setMarkers(base);
        }

        // 重新定位滚动
        const timer = setTimeout(() => {
            if (mainChartRef.current && data.length)
                scrollToTargetTime(mainChartRef.current, data, targetTime, period);
        }, 150);
        return () => clearTimeout(timer);
    }, [targetTime, data, period]);

    // 3. 动态控制均线可见性 (极速响应)
    useEffect(() => {
        Object.keys(seriesRefs.current.mas).forEach(key => {
            const series = seriesRefs.current.mas[key];
            if (series) {
                series.applyOptions({ visible: !!visibleMAs[key] });
            }
        });
    }, [visibleMAs]);

    // 4. 动态控制背离信号和指标信号 (增量更新 Markers)
    useEffect(() => {
        const candle = seriesRefs.current.candle;
        if (candle && data.length) {
            // ★ 存入 ref，供箭头 effect 合并
            baseMarkersRef.current = showDivergence
                ? sortMarkers(calcMacdDivergence(data))
                : [];
            // 若无跳转目标，直接应用基础 markers
            if (!targetTimeRef.current) {
                candle.setMarkers(baseMarkersRef.current);
            }
        }
    }, [showDivergence, data]);

    useEffect(() => {
        const inds = seriesRefs.current.indicators;
        if (!data.length) return;
        if (inds['TRIX']) {
            inds['TRIX'].setMarkers(showTrixSignal ? sortMarkers(calcCrossSignals(data, 'trix', 'trma')) : []);
        }
        if (inds['BBI']) {
            inds['BBI'].setMarkers(showBbiSignal ? sortMarkers(calcBbiSignals(data)) : []);
        }
        if (inds['DPO']) {
            inds['DPO'].setMarkers(showDpoSignal ? sortMarkers(calcCrossSignals(data, 'dpo', 'madpo')) : []);
        }
    }, [showTrixSignal, showBbiSignal, showDpoSignal, data]);

    // ─── Render ────────────────────────────────────────────────────
    if (loading) return <Skeleton className="h-full w-full bg-transparent" />;
    if (error)   return <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>错误</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>;
    if (!stockCode || !data.length) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center text-muted-foreground">
                <DatabaseZap className="h-10 w-10 mb-3" />
                <p className="text-sm font-medium">暂无数据</p>
                <p className="text-xs mt-1 opacity-60">请在"数据管理"同步后查看</p>
            </div>
        );
    }

    if (renderError) {
        return (
            <div className="flex flex-col h-full items-center justify-center p-4">
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>图表渲染失败</AlertTitle>
                    <AlertDescription className="break-all">{renderError}</AlertDescription>
                </Alert>
                <div className="text-xs mt-4 text-muted-foreground whitespace-pre-wrap">{debugInfo}</div>
            </div>
        );
    }

    const indCount = indicatorPanes.length;
    // 细化主图权重
    const MAIN_FLEX  = indCount === 0 ? 1 : (indCount >= 3 ? 3 : 4); 
    // 主图最低高度托底提升
    const MAIN_MIN_H = 220; 

    return (
        <div ref={containerRef} className="flex flex-col flex-1 min-h-0 w-full overflow-hidden bg-[#17191C]">
            {/* ① OHLCV 价格信息栏 */}
            <TopLegend legendDataRef={legendDataRef} updateLegendUIs={updateLegendUIs} />

            {/* ② 周期切换工具栏 */}
            {toolbar}

            {/* ③ 主图区块（K 线 + 均线叠加层） */}
            <div
                className="relative w-full border-b"
                style={{
                    flex: `${MAIN_FLEX} 1 0%`,
                    minHeight: `${MAIN_MIN_H}px`,
                    borderColor: 'rgba(255,255,255,0.08)'
                }}
            >
                <MaLegend legendDataRef={legendDataRef} updateLegendUIs={updateLegendUIs} period={period} visibleMAs={visibleMAs} />
                <div
                    data-pane="main"
                    className="absolute left-0 right-0 bottom-0"
                    style={{ top: `${MAIN_LABEL_H}px` }}
                />
                {/* 🔧 波段高低价标签 overlay — 与 data-pane="main" 完全重叠，pointer-events-none 不阻挡交互 */}
                <div
                    className="absolute left-0 right-0 bottom-0 pointer-events-none z-10"
                    style={{ top: `${MAIN_LABEL_H}px` }}
                >
                    {labelPositions.map((lp, i) => (
                        <span
                            key={i}
                            className="absolute font-mono select-none"
                            style={{
                                left:      lp.x,
                                top:       lp.type === 'high' ? lp.y - 16 : lp.y + 3,
                                transform: 'translateX(-50%)',
                                fontSize:  '9px',
                                lineHeight: '1',
                                color:     lp.type === 'high' ? '#ef5350' : '#26a69a',
                                textShadow: '0 0 4px rgba(0,0,0,0.9)',  // 黑色阴影提升可读性
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {fmt(lp.price)}
                        </span>
                    ))}
                </div>
            </div>

            {/* ④ 副图区块列表 */}
            {indicatorPanes.map((ind, i) => {
                const isLast = i === indicatorPanes.length - 1;
                // 🔴 核心修复：最后副图需为 X 轴(~26px)额外补偿空间，非最后副图保持不变
                const indFlex = isLast ? 1.3 : 1;
                const indMinH = isLast ? 105 : 80; 

                return (
                    <div
                        key={`${ind}-${i}`}
                        className="relative w-full border-t"
                        style={{
                            flex: `${indFlex} 1 0%`,
                            minHeight: `${indMinH}px`,
                            borderColor: 'rgba(255,255,255,0.08)'
                        }}
                    >
                        <IndLegend
                            legendDataRef={legendDataRef}
                            updateLegendUIs={updateLegendUIs}
                            ind={ind}
                            paneIndex={i}
                            onChangeIndicator={onChangeIndicator}
                        />
                        <div
                            data-pane={`ind-${i}`}
                            className="absolute left-0 right-0 bottom-0"
                            style={{ top: `${IND_LABEL_H}px` }}
                        />
                    </div>
                );
            })}
        </div>
    );
}


