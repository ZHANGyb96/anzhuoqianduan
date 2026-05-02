/**
 * @fileoverview 前端本地纯血量化指标计算引擎 (TA-Math)
 * 将原本后端的 pandas_ta 计算逻辑移植到前端，实现极速的客户端动态渲染，
 * 彻底解放服务端压力，完美适配 Pure OHLCV 存储架构。
 */

export type KlineItem = {
    time: number | string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    [key: string]: any;
};

// ----------------- 核心基础算法 -----------------

export function sma(data: number[], period: number): (number | null)[] {
    const result: (number | null)[] = new Array(data.length).fill(null);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i];
        if (i >= period) sum -= data[i - period];
        if (i >= period - 1) result[i] = sum / period;
    }
    return result;
}

export function ema(data: number[], period: number): (number | null)[] {
    const result: (number | null)[] = new Array(data.length).fill(null);
    const multiplier = 2 / (period + 1);
    let prevEma = data[0];
    result[0] = prevEma;
    for (let i = 1; i < data.length; i++) {
        prevEma = (data[i] - prevEma) * multiplier + prevEma;
        result[i] = prevEma;
    }
    // 前面不足 period 的数据也可以有初始 EMA，但通常第一根就是本值
    return result;
}

export function sma_recursive(data: number[], period: number): (number | null)[] {
    // 模拟 pandas ewm(alpha=1/period, adjust=False).mean()
    const result: (number | null)[] = new Array(data.length).fill(null);
    if(data.length === 0) return result;
    const alpha = 1 / period;
    let prev = data[0];
    result[0] = prev;
    for(let i=1; i<data.length; i++) {
        prev = data[i] * alpha + prev * (1 - alpha);
        result[i] = prev;
    }
    return result;
}

export function stdev(data: number[], period: number, ma: (number|null)[]): (number | null)[] {
    const result: (number | null)[] = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        const avg = ma[i] as number;
        for (let j = 0; j < period; j++) {
            sum += Math.pow(data[i - j] - avg, 2);
        }
        // 样本标准差，pandas stdev 默认也是无偏估计 (ddof=1)
        result[i] = Math.sqrt(sum / (period - 1));
    }
    return result;
}

// ----------------- 综合指标计算引擎 -----------------

export function calculateAllIndicators(items: KlineItem[]): KlineItem[] {
    if (items.length === 0) return items;
    
    const closes = items.map(d => d.close);
    const highs = items.map(d => d.high);
    const lows = items.map(d => d.low);
    const volumes = items.map(d => d.volume);

    // --- MAs ---
    const ma5 = sma(closes, 5);
    const ma10 = sma(closes, 10);
    const ma20 = sma(closes, 20);
    const ma60 = sma(closes, 60);
    const ma120 = sma(closes, 120);
    const ma250 = sma(closes, 250);
    const vol_ma5 = sma(volumes, 5);
    const vol_ma10 = sma(volumes, 10);

    // --- BBI ---
    const ma3 = sma(closes, 3);
    const ma6 = sma(closes, 6);
    const ma12 = sma(closes, 12);
    const ma24 = sma(closes, 24);

    // --- MACD (12, 26, 9) ---
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const diff = closes.map((_, i) => (ema12[i] != null && ema26[i] != null) ? ema12[i]! - ema26[i]! : null);
    
    // EMA of Diff for Signal
    const diff_clean = diff.map(v => v || 0); // Handle nulls for smooth EMA start
    const dea = ema(diff_clean, 9);
    
    // --- KDJ (9, 3, 3) ---
    const kdj_k: (number|null)[] = new Array(closes.length).fill(null);
    const kdj_d: (number|null)[] = new Array(closes.length).fill(null);
    const kdj_j: (number|null)[] = new Array(closes.length).fill(null);
    let prevK = 50;
    let prevD = 50;
    for (let i = 0; i < items.length; i++) {
        if (i < 8) {
             // 不足9根时不严格计算，但给个基础值
             let minL = Math.min(...lows.slice(0, i+1));
             let maxH = Math.max(...highs.slice(0, i+1));
             let rsv = maxH - minL === 0 ? 0 : (closes[i] - minL) / (maxH - minL) * 100;
             prevK = (2/3)*prevK + (1/3)*rsv;
             prevD = (2/3)*prevD + (1/3)*prevK;
             kdj_k[i] = prevK; kdj_d[i] = prevD; kdj_j[i] = 3*prevK - 2*prevD;
        } else {
             let minL = Math.min(...lows.slice(i-8, i+1));
             let maxH = Math.max(...highs.slice(i-8, i+1));
             let rsv = maxH - minL === 0 ? 0 : (closes[i] - minL) / (maxH - minL) * 100;
             prevK = (2/3)*prevK + (1/3)*rsv;
             prevD = (2/3)*prevD + (1/3)*prevK;
             kdj_k[i] = prevK; kdj_d[i] = prevD; kdj_j[i] = 3*prevK - 2*prevD;
        }
    }

    // --- RSI (6, 12, 24) ---
    const diffs = [0];
    for(let i=1; i<closes.length; i++) diffs.push(closes[i] - closes[i-1]);
    const up = diffs.map(d => Math.max(d, 0));
    const abs = diffs.map(d => Math.abs(d));
    
    const rsi_6 = sma_recursive(up, 6).map((u, i) => { const a = sma_recursive(abs, 6)[i]; return (u != null && a != null && a !== 0) ? (u/a)*100 : null; });
    const rsi_12 = sma_recursive(up, 12).map((u, i) => { const a = sma_recursive(abs, 12)[i]; return (u != null && a != null && a !== 0) ? (u/a)*100 : null; });
    const rsi_24 = sma_recursive(up, 24).map((u, i) => { const a = sma_recursive(abs, 24)[i]; return (u != null && a != null && a !== 0) ? (u/a)*100 : null; });

    // --- BOLL ---
    const boll_mid = ma20;
    const boll_std = stdev(closes, 20, boll_mid);

    // --- TRIX (12, 9) ---
    const trix_ema1 = ema(closes, 12);
    const trix_ema2 = ema(trix_ema1.map(v => v||0), 12);
    const trix_ema3 = ema(trix_ema2.map(v => v||0), 12);
    const trix = [null as number|null];
    for(let i=1; i<trix_ema3.length; i++) {
        if(trix_ema3[i-1] != null && trix_ema3[i-1] !== 0) {
            trix.push((trix_ema3[i]! - trix_ema3[i-1]!) / trix_ema3[i-1]! * 100);
        } else trix.push(null);
    }
    const trma = sma(trix.map(v => v||0), 9);

    // --- CCI (14) ---
    const cci: (number|null)[] = new Array(closes.length).fill(null);
    const typs = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
    const ma_typ = sma(typs, 14);
    for(let i=13; i<closes.length; i++) {
        let avg_typ = ma_typ[i]!;
        let avedev = 0;
        for(let j=0; j<14; j++) avedev += Math.abs(typs[i-j] - avg_typ);
        avedev /= 14;
        cci[i] = avedev === 0 ? 0 : (typs[i] - avg_typ) / (0.015 * avedev);
    }

    // --- BIAS ---
    const bias_6 = closes.map((c, i) => ma6[i] != null ? (c - ma6[i]!) / ma6[i]! * 100 : null);
    const bias_12 = closes.map((c, i) => ma12[i] != null ? (c - ma12[i]!) / ma12[i]! * 100 : null);
    const bias_24 = closes.map((c, i) => ma24[i] != null ? (c - ma24[i]!) / ma24[i]! * 100 : null);

    // --- DPO (20, 10) ---
    const dpo: (number|null)[] = new Array(closes.length).fill(null);
    for(let i=0; i<closes.length; i++) {
        // DPO: CLOSE - REF(MA(C,20), 11)   (20/2 + 1)
        if (i >= 11 && ma20[i-11] != null) dpo[i] = closes[i] - ma20[i-11]!;
    }
    const madpo = sma(dpo.map(v => v||0), 10);

    // --- DMI (14, 6) ---
    const tr: number[] = [0];
    const plusDm: number[] = [0];
    const minusDm: number[] = [0];
    for (let i = 1; i < closes.length; i++) {
        const hl = highs[i] - lows[i];
        const hc = Math.abs(highs[i] - closes[i - 1]);
        const lc = Math.abs(lows[i] - closes[i - 1]);
        tr.push(Math.max(hl, hc, lc));

        const upMove = highs[i] - highs[i - 1];
        const downMove = lows[i - 1] - lows[i];
        plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    const tr14 = sma_recursive(tr, 14);
    const plusDm14 = sma_recursive(plusDm, 14);
    const minusDm14 = sma_recursive(minusDm, 14);

    const pdi = plusDm14.map((p, i) => (p != null && tr14[i] != null && tr14[i]! !== 0) ? (p / tr14[i]!) * 100 : null);
    const mdi = minusDm14.map((m, i) => (m != null && tr14[i] != null && tr14[i]! !== 0) ? (m / tr14[i]!) * 100 : null);
    
    const dx = pdi.map((p, i) => {
        const m = mdi[i];
        if (p == null || m == null || (p + m) === 0) return null;
        return (Math.abs(p - m) / (p + m)) * 100;
    });
    const adx = sma_recursive(dx.map(v => v || 0).slice(14), 14);
    const full_adx = new Array(14).fill(null).concat(adx);
    const adxr: (number|null)[] = new Array(closes.length).fill(null);
    for (let i = 6; i < full_adx.length; i++) {
        if (full_adx[i] != null && full_adx[i - 6] != null) {
            adxr[i] = (full_adx[i]! + full_adx[i - 6]!) / 2;
        }
    }

    // --- LON ---
    const lon = ema(closes, 10);
    const lonma = sma(lon.map(v => v || 0), 10);
    
    // Bind results back to items
    for(let i=0; i<items.length; i++) {
        items[i].ma5 = ma5[i];
        items[i].ma10 = ma10[i];
        items[i].ma20 = ma20[i];
        items[i].ma60 = ma60[i];
        items[i].ma120 = ma120[i];
        items[i].ma250 = ma250[i];
        items[i].vol_ma5 = vol_ma5[i];
        items[i].vol_ma10 = vol_ma10[i];
        
        items[i].macd = diff[i];
        items[i].macd_signal = dea[i];
        items[i].macd_hist = (diff[i] != null && dea[i] != null) ? (diff[i]! - dea[i]!) * 2 : null;

        items[i].kdj_k = kdj_k[i];
        items[i].kdj_d = kdj_d[i];
        items[i].kdj_j = kdj_j[i];

        items[i].rsi_6 = rsi_6[i];
        items[i].rsi_12 = rsi_12[i];
        items[i].rsi_24 = rsi_24[i];

        items[i].boll_middle = boll_mid[i];
        items[i].boll_upper = (boll_mid[i] != null && boll_std[i] != null) ? boll_mid[i]! + 2 * boll_std[i]! : null;
        items[i].boll_lower = (boll_mid[i] != null && boll_std[i] != null) ? boll_mid[i]! - 2 * boll_std[i]! : null;

        items[i].trix = trix[i];
        items[i].trma = trma[i];

        items[i].cci = cci[i];

        items[i].bias_6 = bias_6[i];
        items[i].bias_12 = bias_12[i];
        items[i].bias_24 = bias_24[i];

        items[i].dpo = dpo[i];
        items[i].madpo = madpo[i];

        items[i].bbi = (ma3[i] != null && ma6[i] != null && ma12[i] != null && ma24[i] != null) ? 
                        (ma3[i]! + ma6[i]! + ma12[i]! + ma24[i]!) / 4 : null;

        items[i].pdi = pdi[i];
        items[i].mdi = mdi[i];
        items[i].adx = full_adx[i];
        items[i].adxr = adxr[i];

        items[i].lon = lon[i];
        items[i].lonma = lonma[i];
    }

    return items;
}
