// src/utils/troc-math.ts
/**
 * TROC 指标计算引擎 v1
 * ──────────────────────────────────────────────────────────────────────────
 * 将 troc_indicator_short.py / troc_indicator_long.py 完整移植到 TypeScript，
 * 集成进 ta-math.ts 的 calculateAllIndicators() 输出，
 * 使 strategy-builder 可以直接把 TROC 字段当作回测条件。
 *
 * 新增字段（挂载到 KlineItem）：
 *
 *  短期（short）
 *  ┌─────────────────┬──────────────────────────────────────────────┐
 *  │ troc_osc        │ 短期振荡主线  (Z-score合成，无量纲)           │
 *  │ troc_osc_ma     │ OSC 5周期EMA（信号线）                        │
 *  │ troc_trix_s     │ 短期TRIX归一化（趋势参考，>0多头<0空头）        │
 *  │ troc_adx_s      │ ADX 趋势强度（0~100，>25为趋势市场）           │
 *  └─────────────────┴──────────────────────────────────────────────┘
 *
 *  长期（long）
 *  ┌─────────────────┬──────────────────────────────────────────────┐
 *  │ troc_osc_l      │ 长期振荡主线（26周期参数）                     │
 *  │ troc_osc_ma_l   │ 长期OSC 5周期EMA                             │
 *  │ troc_trix_l     │ 长期TRIX归一化（18周期）                      │
 *  │ troc_phase      │ 区间状态 +1=吸筹 / -1=派筹 / 0=中性           │
 *  │ troc_acc        │ 吸筹强度得分（0~1 归一化）                     │
 *  │ troc_dist       │ 派筹强度得分（0~-1，向下显示）                 │
 *  │ troc_pct        │ 价格历史分位（0~1，<0.3低位区, >0.7高位区）     │
 *  │ troc_adx_l      │ ADX 长期趋势强度                              │
 *  │ troc_chop       │ 震荡指数（<38.2趋势,>61.8震荡）               │
 *  │ troc_swing_lo   │ 最近摆动低点（ffill，用于结构判断）             │
 *  │ troc_swing_hi   │ 最近摆动高点（ffill，用于结构判断）             │
 *  │ troc_ob_dyn     │ 动态超买线（随波动率自适应）                    │
 *  │ troc_os_dyn     │ 动态超卖线（随波动率自适应）                    │
 *  └─────────────────┴──────────────────────────────────────────────┘
 *
 *  swing_mode 参数：
 *    'review' （默认）: left=2, right=2 / left=5, right=5
 *                       历史复盘模式，包含未来 N 根确认，图形干净
 *    'live'            : right=0，纯左侧判断，实盘/回测模式
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 设计说明：
 *  1. 全部使用纯数组运算，无 pandas 依赖
 *  2. price_percentile 使用滑动排序窗口（O(n·n_window)），避免 O(n²) 问题
 *  3. ADX 直接复用 calculateAllIndicators 已有的 full_adx 字段（传参复用）
 *  4. Choppiness Index = 100 × log10(ATR_sum / (highest - lowest)) / log10(n)
 *     n=14，值域 0~100，< 38.2 趋势，> 61.8 震荡
 *  5. 动态阈值 troc_ob_dyn / troc_os_dyn = ±(1.5 + osc_std * 0.5)
 *     基于 OSC 自身的滚动标准差做包络扩张/收缩
 */

import type { KlineItem } from './ta-math'

// ─── 内部工具函数（不导出，供本模块内部使用）──────────────────────────────────

/** 等权 EMA，multiplier = 2/(n+1)，对齐 pandas ewm(span=n, adjust=False) */
function _ema(data: number[], n: number): (number | null)[] {
    const out: (number | null)[] = new Array(data.length).fill(null)
    const k = 2 / (n + 1)
    let prev = data[0]
    out[0] = prev
    for (let i = 1; i < data.length; i++) {
        prev = data[i] * k + prev * (1 - k)
        out[i] = prev
    }
    return out
}

/** 简单移动平均 */
function _sma(data: number[], n: number): (number | null)[] {
    const out: (number | null)[] = new Array(data.length).fill(null)
    let sum = 0
    for (let i = 0; i < data.length; i++) {
        sum += data[i]
        if (i >= n) sum -= data[i - n]
        if (i >= n - 1) out[i] = sum / n
    }
    return out
}

/** 滚动标准差（总体标准差，ddof=0，对齐 pandas rolling.std(ddof=0)）*/
function _rollStd(data: number[], n: number): (number | null)[] {
    const ma = _sma(data, n)
    const out: (number | null)[] = new Array(data.length).fill(null)
    for (let i = n - 1; i < data.length; i++) {
        let sum = 0
        const m = ma[i]!
        for (let j = 0; j < n; j++) sum += (data[i - j] - m) ** 2
        // [F1] 样本标准差（ddof=1），对齐 pandas rolling(n).std() 默认行为
        out[i] = n > 1 ? Math.sqrt(sum / (n - 1)) : 0
    }
    return out
}

/** Z-score 归一化：(x - rolling_mean) / rolling_std */
function _zscore(data: (number | null)[], n: number): (number | null)[] {
    const clean = data.map(v => v ?? 0)
    const ma    = _sma(clean, n)
    const std   = _rollStd(clean, n)
    return data.map((orig, i) => {
        // [F2] 原始值为 null，输出 null，不用被污染的 rolling 结果
        if (orig == null) return null
        if (ma[i] == null || std[i] == null || std[i]! === 0) return null
        return (orig - ma[i]!) / std[i]!
    })
}

/** TRIX(n)：三重EMA的变化率 × 100 */
function _trix(close: number[], n: number): (number | null)[] {
    const e1 = _ema(close, n).map(v => v ?? 0)
    const e2 = _ema(e1, n).map(v => v ?? 0)
    const e3 = _ema(e2, n).map(v => v ?? 0)
    const out: (number | null)[] = [null]
    for (let i = 1; i < e3.length; i++) {
        out.push(e3[i - 1] !== 0 ? (e3[i] - e3[i - 1]) / e3[i - 1] * 100 : null)
    }
    return out
}

/** CCI(n)：(TP - MA(TP,n)) / (0.015 * Mean_Deviation) */
function _cci(items: KlineItem[], n: number): (number | null)[] {
    const tp  = items.map(d => (d.high + d.low + d.close) / 3)
    const ma  = _sma(tp, n)
    const out: (number | null)[] = new Array(tp.length).fill(null)
    for (let i = n - 1; i < tp.length; i++) {
        const avg = ma[i]!
        let md = 0
        for (let j = 0; j < n; j++) md += Math.abs(tp[i - j] - avg)
        md /= n
        out[i] = md === 0 ? 0 : (tp[i] - avg) / (0.015 * md)
    }
    return out
}

/** BIAS(n)：(close - MA(n)) / MA(n) × 100 */
function _bias(close: number[], n: number): (number | null)[] {
    const ma = _sma(close, n)
    return close.map((c, i) => ma[i] != null ? (c - ma[i]!) / ma[i]! * 100 : null)
}

/** DPO(n)：close - MA(n).shift(n/2+1) */
function _dpo(close: number[], n: number): (number | null)[] {
    const shift = Math.floor(n / 2) + 1
    const ma    = _sma(close, n)
    const out: (number | null)[] = new Array(close.length).fill(null)
    for (let i = shift; i < close.length; i++) {
        if (ma[i - shift] != null) out[i] = close[i] - ma[i - shift]!
    }
    return out
}

/**
 * 价格历史分位：当前收盘价在过去 n 根中的百分位（0~1）
 * 使用插入排序维护滑动有序数组，O(n×window) 而非 O(n²)
 */
/**
 * 价格历史分位（0~1）— 修复版
 * 用 {val, idx} 对象数组维护有序窗口，按原始索引精确删除最旧值，
 * 解决重复价格时二分查找可能删错位置的问题。O(n×window)
 */
function _pricePercentile(close: number[], n: number): (number | null)[] {
    const out: (number | null)[] = new Array(close.length).fill(null)
    const win: { val: number; idx: number }[] = []

    const ins = (v: number, i: number) => {
        let lo = 0, hi = win.length
        while (lo < hi) {
            const mid = (lo + hi) >> 1
            const w = win[mid]
            w.val < v || (w.val === v && w.idx < i) ? lo = mid + 1 : hi = mid
        }
        win.splice(lo, 0, { val: v, idx: i })
    }
    const del = (v: number, i: number) => {
        let lo = 0, hi = win.length
        while (lo < hi) {
            const mid = (lo + hi) >> 1
            const w = win[mid]
            w.val < v || (w.val === v && w.idx < i) ? lo = mid + 1 : hi = mid
        }
        if (lo < win.length && win[lo].val === v && win[lo].idx === i) win.splice(lo, 1)
    }

    for (let i = 0; i < close.length; i++) {
        const val = close[i]
        ins(val, i)
        if (win.length > n) del(close[i - n], i - n)
        if (win.length >= n) {
            let lo = 0, hi = win.length
            while (lo < hi) {
                const mid = (lo + hi) >> 1
                win[mid].val < val ? lo = mid + 1 : hi = mid
            }
            out[i] = lo / win.length
        }
    }
    return out
}

/**
 * 摆动低点（滑动扫描）
 * mode='review': right > 0，需要后方确认根数（历史复盘/图表显示用）
 * mode='live':   right = 0，纯左侧判断（回测/实盘用，无未来函数）
 * 返回数组：非摆动点处为 null（注意：不做 ffill，由调用方按需处理）
 */
function _swingLow(
    low: number[], left: number, right: number
): (number | null)[] {
    const out: (number | null)[] = new Array(low.length).fill(null)
    const end = low.length - right
    for (let i = left; i < end; i++) {
        const winL = low.slice(i - left, i)
        const winR = right > 0 ? low.slice(i + 1, i + right + 1) : []
        const isMin =
            (winL.length === 0 || low[i] <= Math.min(...winL)) &&
            (winR.length === 0 || low[i] <= Math.min(...winR))
        if (isMin) out[i] = low[i]
    }
    return out
}

function _swingHigh(
    high: number[], left: number, right: number
): (number | null)[] {
    const out: (number | null)[] = new Array(high.length).fill(null)
    const end = high.length - right
    for (let i = left; i < end; i++) {
        const winL = high.slice(i - left, i)
        const winR = right > 0 ? high.slice(i + 1, i + right + 1) : []
        const isMax =
            (winL.length === 0 || high[i] >= Math.max(...winL)) &&
            (winR.length === 0 || high[i] >= Math.max(...winR))
        if (isMax) out[i] = high[i]
    }
    return out
}

/** 前向填充 null（ffill） */
function _ffill(arr: (number | null)[]): (number | null)[] {
    const out = [...arr]
    let last: number | null = null
    for (let i = 0; i < out.length; i++) {
        if (out[i] != null) last = out[i]
        else out[i] = last
    }
    return out
}

/** ATR(n)：EMA 平滑的真实波动幅度 */
function _atr(items: KlineItem[], n: number): (number | null)[] {
    const tr: number[] = [0]
    for (let i = 1; i < items.length; i++) {
        tr.push(Math.max(
            items[i].high - items[i].low,
            Math.abs(items[i].high - items[i - 1].close),
            Math.abs(items[i].low  - items[i - 1].close),
        ))
    }
    return _ema(tr, n)
}

/**
 * ADX(n)：复用 ta-math 里的 sma_recursive 逻辑，
 * 直接在本模块内独立实现，避免循环依赖
 */
function _adx(items: KlineItem[], n = 14): (number | null)[] {
    const highs  = items.map(d => d.high)
    const lows   = items.map(d => d.low)
    const closes = items.map(d => d.close)
    const len    = closes.length

    const tr: number[] = [0], pDm: number[] = [0], mDm: number[] = [0]
    for (let i = 1; i < len; i++) {
        tr.push(Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i]  - closes[i - 1]),
        ))
        const up   = highs[i] - highs[i - 1]
        const down = lows[i - 1] - lows[i]
        pDm.push(up > down && up > 0 ? up : 0)
        mDm.push(down > up && down > 0 ? down : 0)
    }

    // Wilder 平滑（sma_recursive 等效 alpha=1/n）
    const wilder = (arr: number[]) => {
        const r: number[] = [arr[0]]
        for (let i = 1; i < arr.length; i++)
            r.push(arr[i] / n + r[i - 1] * (1 - 1 / n))
        return r
    }
    const tr14  = wilder(tr)
    const pDm14 = wilder(pDm)
    const mDm14 = wilder(mDm)

    const dx: number[] = tr14.map((t, i) => {
        const p = t !== 0 ? pDm14[i] / t * 100 : 0
        const m = t !== 0 ? mDm14[i] / t * 100 : 0
        return (p + m) !== 0 ? Math.abs(p - m) / (p + m) * 100 : 0
    })

    const adxArr = wilder(dx)
    return adxArr.map(v => Math.round(v * 100) / 100)
}

/**
 * Choppiness Index(n=14)
 * = 100 × log10(Σ|ATR1| / (highest_high - lowest_low)) / log10(n)
 * < 38.2 强趋势，> 61.8 震荡整理
 */
function _choppiness(items: KlineItem[], n = 14): (number | null)[] {
    const atr1 = (() => {
        const r: number[] = [0]
        for (let i = 1; i < items.length; i++) {
            r.push(Math.max(
                items[i].high - items[i].low,
                Math.abs(items[i].high - items[i - 1].close),
                Math.abs(items[i].low  - items[i - 1].close),
            ))
        }
        return r
    })()

    const out: (number | null)[] = new Array(items.length).fill(null)
    const logN = Math.log10(n)
    for (let i = n - 1; i < items.length; i++) {
        let atrSum = 0, hh = -Infinity, ll = Infinity
        for (let j = 0; j < n; j++) {
            atrSum += atr1[i - j]
            if (items[i - j].high > hh) hh = items[i - j].high
            if (items[i - j].low  < ll) ll = items[i - j].low
        }
        const rng = hh - ll
        if (rng === 0 || atrSum === 0) { out[i] = null; continue }
        out[i] = Math.round(100 * (Math.log10(atrSum / rng) / logN) * 100) / 100
    }
    return out
}

// ─── OSC 合成 ─────────────────────────────────────────────────────────────────

function _calcOsc(
    items: KlineItem[], n_period: number, n_z: number
): (number | null)[] {
    const close = items.map(d => d.close)
    const cci_z  = _zscore(_cci(items, n_period), n_z)
    const bias_z = _zscore(_bias(close, n_period), n_z)
    const dpo_z  = _zscore(_dpo(close, n_period), n_z)

    return close.map((_, i) => {
        const c = cci_z[i], b = bias_z[i], d = dpo_z[i]
        if (c == null || b == null || d == null) return null
        return 0.4 * c + 0.4 * b + 0.2 * d
    })
}


// ─── K线形态确认（对齐 Python candle_confirm）──────────────────────────────────

/**
 * 锤子线/多方吞没 → buy_candle=1
 * 射击之星/空方吞没 → sell_candle=1
 * 对齐 troc_indicator_short.py 的 candle_confirm() 函数逻辑
 */
function _candleConfirm(items: KlineItem[]): { buy: number[]; sell: number[] } {
    const buy  = new Array(items.length).fill(0)
    const sell = new Array(items.length).fill(0)
    for (let i = 1; i < items.length; i++) {
        const o = items[i].open, h = items[i].high, l = items[i].low, c = items[i].close
        const po = items[i-1].open, pc = items[i-1].close
        const body  = Math.abs(c - o)
        const lower = c >= o ? o - l : c - l
        const upper = c >= o ? h - c : h - o
        const rng   = h - l
        const hammer     = lower > body * 1.5 && rng > 0
        const shooting   = upper > body * 1.5 && rng > 0
        const bullEngulf = c > o && pc < po && c > po && o < pc
        const bearEngulf = c < o && pc > po && c < po && o > pc
        if (hammer || bullEngulf)   buy[i]  = 1
        if (shooting || bearEngulf) sell[i] = 1
    }
    return { buy, sell }
}

// ─── PHASE 状态机 ─────────────────────────────────────────────────────────────

function _calcPhase(
    items: KlineItem[],
    osc: (number | null)[],
    close: number[],
): {
    phase:    number[]
    accScore: number[]
    distScore: number[]
} {
    const n       = items.length
    const volMa20 = _sma(items.map(d => d.volume), 20)
    const volRatio = items.map((d, i) =>
        volMa20[i] != null && volMa20[i]! > 0 ? d.volume / volMa20[i]! : 1
    )

    // 5根滑动均量比
    const volT5Ma = _sma(volRatio, 5)

    const trixRaw = _trix(close, 18).map(v => v ?? 0)
    const trixSig = _ema(trixRaw, 9).map(v => v ?? 0)
    const trixSlp = trixRaw.map((v, i) => i >= 5 ? v - trixRaw[i - 5] : 0)

    const pct = _pricePercentile(close, 120)

    const phase:     number[] = new Array(n).fill(0)
    const accScore:  number[] = new Array(n).fill(0)
    const distScore: number[] = new Array(n).fill(0)

    let accState = 0, distState = 0

    for (let i = 0; i < n; i++) {
        const p   = pct[i] ?? 0.5
        const o   = osc[i] ?? 0
        const vt  = volT5Ma[i] ?? 1
        const tr  = trixRaw[i]
        const ts  = trixSig[i]
        const tsl = trixSlp[i]

        // ── 吸筹得分 ─────────────────────────────────────────────────────────
        let acc = 0
        acc += p < 0.3 ? 30 : p < 0.45 ? 15 : 0
        acc += (tr < 0 && tsl > 0) ? 25 : (tr > 0 && tr > ts) ? 12 : 0
        acc += o < -1.2 ? 25 : o < -0.6 ? 12 : 0
        acc += vt < 0.85 ? 20 : vt < 1.0 ? 10 : 0
        accScore[i] = acc

        // ── 派筹得分 ─────────────────────────────────────────────────────────
        let dist = 0
        dist += p > 0.7 ? 30 : p > 0.55 ? 15 : 0
        dist += (tr > 0 && tsl < 0) ? 25 : (tr < 0 && tr < ts) ? 12 : 0
        dist += o > 1.2 ? 25 : o > 0.6 ? 12 : 0
        // 价格3根变化率（近似）
        const pChg = i >= 3 ? (close[i] - close[i - 3]) / close[i - 3] : 0
        dist += (vt > 1.2 && pChg < 0.015) ? 20 : vt > 1.5 ? 10 : 0
        distScore[i] = dist

        // ── 状态机：滞后切换，防止频繁抖动 ──────────────────────────────────
        if (acc  >= 60) accState  = 1
        else if (acc  < 40) accState  = 0

        if (dist >= 60) distState = 1
        else if (dist < 40) distState = 0

        // 派筹优先
        if (distState === 1) accState = 0

        phase[i] = accState - distState  // +1 / 0 / -1
    }

    return { phase, accScore, distScore }
}

// ─── 主导出函数 ───────────────────────────────────────────────────────────────

/**
 * 计算全部 TROC 字段并原地写入 items（与 calculateAllIndicators 风格一致）
 *
 * @param items      排序好的 KlineItem 数组（需含 open/high/low/close/volume）
 * @param swingMode  'review'（含未来确认，图表分析用）| 'live'（纯左侧，回测用）
 */
export function calculateTROC(
    items: KlineItem[],
    swingMode: 'review' | 'live' = 'live',
): KlineItem[] {
    // TROC 最短预热期：OSC(26) + Z-score(80) + price_pct(120) = 最少 120 根数据
    if (items.length < 120) return items

    const close  = items.map(d => d.close)
    const high   = items.map(d => d.high)
    const low    = items.map(d => d.low)

    // ── 短期 OSC（参数14，Z窗口40）──────────────────────────────────────────
    const oscS    = _calcOsc(items, 14, 40)
    const oscSMa  = _ema(oscS.map(v => v ?? 0), 5)
    const trixS   = _trix(close, 9)
    const trixSZ  = _zscore(trixS, 40)

    // ── 长期 OSC（参数26，Z窗口80）──────────────────────────────────────────
    const oscL    = _calcOsc(items, 26, 80)
    const oscLMa  = _ema(oscL.map(v => v ?? 0), 5)
    const trixL   = _trix(close, 18)
    const trixLZ  = _zscore(trixL, 80)

    // ── ADX（短期14 / 长期用同一 ADX） ─────────────────────────────────────
    const adxArr  = _adx(items, 14)

    // ── 震荡指数 ─────────────────────────────────────────────────────────────
    const chop    = _choppiness(items, 14)

    // ── 价格历史分位（120根窗口）─────────────────────────────────────────────
    const pct     = _pricePercentile(close, 120)

    // ── PHASE 状态机 ─────────────────────────────────────────────────────────
    const { phase, accScore, distScore } = _calcPhase(items, oscL, close)

    // ── 摆动高低点 ────────────────────────────────────────────────────────────
    // review 模式: left=5, right=5（含未来确认，图形干净）
    // live 模式:   right=0（纯左侧判断，回测无未来函数）
    // [F3] 删除未使用的 sLeft/sRight（短期摆动从未计算），只保留长期参数
    const lLeft  = 5,  lRight  = swingMode === 'review' ? 5 : 0

    // 长期摆动用于 PHASE 结构判断
    const swingLo = _ffill(_swingLow(low,   lLeft, lRight))
    const swingHi = _ffill(_swingHigh(high, lLeft, lRight))

    // ── 短期结构判断（对齐 Python struct_long / struct_short）─────────────────
    // struct_long  = low  > swing_lo(ffill) && vol_t < 0.9（低于摆动低点不算）
    // struct_short = high < swing_hi(ffill) && vol_t < 0.9（突破摆动高点不算）
    const volMa20S  = _sma(items.map(d => d.volume), 20)
    const volRatioS = items.map((d, i) => volMa20S[i] && volMa20S[i]! > 0 ? d.volume / volMa20S[i]! : 1)
    const volT5S    = _sma(volRatioS, 5)

    // ── K线形态确认 ──────────────────────────────────────────────────────────
    const candles = _candleConfirm(items)

    // ── 短期辅助线（TRIX slope 用于触发层）──────────────────────────────────
    const trixRawS  = _trix(close, 9).map(v => v ?? 0)
    const trixSigS  = _ema(trixRawS, 6).map(v => v ?? 0)
    const trixSlpS  = trixRawS.map((v, i) => i >= 3 ? v - trixRawS[i - 3] : 0)
    const ema60     = _ema(close, 60).map(v => v ?? 0)

    // 长期辅助（TRIX slope 用于触发层）
    const trixRawL  = _trix(close, 18).map(v => v ?? 0)
    const trixSigL  = _ema(trixRawL, 9).map(v => v ?? 0)
    const trixSlpL  = trixRawL.map((v, i) => i >= 5 ? v - trixRawL[i - 5] : 0)
    const ema120    = _ema(close, 120).map(v => v ?? 0)

    // ── BUY / SELL 信号（三层过滤，对齐 Python calc_short 和 calc_long）─────
    // 短期信号：trend_up & close>ema60 & struct_long & (osc_buy + candle + slope_buy >= 2)
    // 长期信号：trend_up & close>ema120 & struct_long & (osc_buy + candle + slope_buy >= 2) & phase>=0
    const trocBuyS:  (number | null)[] = new Array(items.length).fill(null)
    const trocSellS: (number | null)[] = new Array(items.length).fill(null)
    const trocBuyL:  (number | null)[] = new Array(items.length).fill(null)
    const trocSellL: (number | null)[] = new Array(items.length).fill(null)
    const trocStructLo: number[] = new Array(items.length).fill(0)
    const trocStructHi: number[] = new Array(items.length).fill(0)

    for (let i = 1; i < items.length; i++) {
        const oscSv = oscS[i] ?? 0, oscLv = oscL[i] ?? 0
        const vt    = volT5S[i] ?? 1

        // 结构判断
        const sl = swingLo[i], sh = swingHi[i]
        const structLo = sl != null && low[i]  > sl && vt < 0.9 ? 1 : 0
        const structHi = sh != null && high[i] < sh && vt < 0.9 ? 1 : 0
        trocStructLo[i] = structLo
        trocStructHi[i] = structHi

        // 短期触发层
        const oscBuyS  = oscSv < -1.2 && oscSv > (oscS[i - 1] ?? 0) ? 1 : 0
        const oscSellS = oscSv >  1.2 && oscSv < (oscS[i - 1] ?? 0) ? 1 : 0
        const slpBuyS  = trixSlpS[i] > 0 && trixSlpS[i - 1] <= 0 ? 1 : 0
        const slpSellS = trixSlpS[i] < 0 && trixSlpS[i - 1] >= 0 ? 1 : 0
        const buyCntS  = oscBuyS  + candles.buy[i]  + slpBuyS
        const sellCntS = oscSellS + candles.sell[i] + slpSellS

        const trendUpS   = trixRawS[i] > 0 && trixRawS[i] > trixSigS[i]
        const trendDnS   = trixRawS[i] < 0 && trixRawS[i] < trixSigS[i]
        if (trendUpS   && close[i] > ema60[i]  && structLo && buyCntS  >= 2)
            trocBuyS[i]  = oscSv
        if (trendDnS   && close[i] < ema60[i]  && structHi && sellCntS >= 2)
            trocSellS[i] = oscSv

        // 长期触发层（额外要求 phase >= 0 做多 / phase <= 0 做空）
        const oscBuyL  = oscLv < -1.2 && oscLv > (oscL[i - 1] ?? 0) ? 1 : 0
        const oscSellL = oscLv >  1.2 && oscLv < (oscL[i - 1] ?? 0) ? 1 : 0
        const slpBuyL  = trixSlpL[i] > 0 && trixSlpL[i - 1] <= 0 ? 1 : 0
        const slpSellL = trixSlpL[i] < 0 && trixSlpL[i - 1] >= 0 ? 1 : 0
        const buyCntL  = oscBuyL  + candles.buy[i]  + slpBuyL
        const sellCntL = oscSellL + candles.sell[i] + slpSellL

        const trendUpL   = trixRawL[i] > 0 && trixRawL[i] > trixSigL[i]
        const trendDnL   = trixRawL[i] < 0 && trixRawL[i] < trixSigL[i]
        if (trendUpL   && close[i] > ema120[i] && structLo && buyCntL  >= 2 && phase[i] >= 0)
            trocBuyL[i]  = oscLv
        if (trendDnL   && close[i] < ema120[i] && structHi && sellCntL >= 2 && phase[i] <= 0)
            trocSellL[i] = oscLv
    }

    // ── 动态阈值（OSC 自身的滚动标准差扩张超买超卖线）────────────────────────
    // troc_ob_dyn = 1.5 + rollStd(OSC, 40) × 0.5，最小不低于 1.2
    const oscSClean = oscS.map(v => v ?? 0)
    const oscStd    = _rollStd(oscSClean, 40)

    // ── 写入 items ─────────────────────────────────────────────────────────────
    for (let i = 0; i < items.length; i++) {
        // 短期
        items[i].troc_osc     = oscS[i]    != null ? Math.round(oscS[i]!    * 10000) / 10000 : null
        items[i].troc_osc_ma  = oscSMa[i]  != null ? Math.round(oscSMa[i]!  * 10000) / 10000 : null
        items[i].troc_trix_s  = trixSZ[i]  != null ? Math.round(trixSZ[i]!  * 10000) / 10000 : null
        items[i].troc_adx_s   = adxArr[i]  != null ? Math.round(adxArr[i]!  * 100)   / 100   : null

        // 长期
        items[i].troc_osc_l   = oscL[i]    != null ? Math.round(oscL[i]!    * 10000) / 10000 : null
        items[i].troc_osc_ma_l= oscLMa[i]  != null ? Math.round(oscLMa[i]!  * 10000) / 10000 : null
        items[i].troc_trix_l  = trixLZ[i]  != null ? Math.round(trixLZ[i]!  * 10000) / 10000 : null
        items[i].troc_phase   = phase[i]                                        // +1 / 0 / -1
        items[i].troc_acc     = Math.round(accScore[i]  / 100 * 1000) / 1000   // 归一化 0~1
        items[i].troc_dist    = -(Math.round(distScore[i] / 100 * 1000) / 1000)// 负向 0~-1
        items[i].troc_pct     = pct[i]     != null ? Math.round(pct[i]!     * 1000) / 1000 : null
        items[i].troc_adx_l   = adxArr[i]  != null ? Math.round(adxArr[i]!  * 100)  / 100  : null
        items[i].troc_chop    = chop[i]    != null ? Math.round(chop[i]!    * 100)  / 100  : null
        items[i].troc_swing_lo= swingLo[i] != null ? Math.round(swingLo[i]! * 100)  / 100  : null
        items[i].troc_swing_hi= swingHi[i] != null ? Math.round(swingHi[i]! * 100)  / 100  : null

        // 动态阈值
        const std = oscStd[i]
        const ob  = std != null ? Math.max(1.2, 1.5 + std * 0.5) : 1.5
        const os  = std != null ? Math.min(-1.2, -1.5 - std * 0.5) : -1.5
        items[i].troc_ob_dyn    = Math.round(ob * 1000) / 1000
        items[i].troc_os_dyn    = Math.round(os * 1000) / 1000

        // BUY / SELL 信号（值 = 对应 OSC 值，用于副图箭头定位；null = 无信号）
        items[i].troc_buy_s     = trocBuyS[i]  != null ? Math.round(trocBuyS[i]!  * 10000) / 10000 : null
        items[i].troc_sell_s    = trocSellS[i] != null ? Math.round(trocSellS[i]! * 10000) / 10000 : null
        items[i].troc_buy_l     = trocBuyL[i]  != null ? Math.round(trocBuyL[i]!  * 10000) / 10000 : null
        items[i].troc_sell_l    = trocSellL[i] != null ? Math.round(trocSellL[i]! * 10000) / 10000 : null

        // 结构判断（1=结构性支撑/压力 + 缩量，0=否）
        items[i].troc_struct_lo = trocStructLo[i]
        items[i].troc_struct_hi = trocStructHi[i]
    }

    return items
}
