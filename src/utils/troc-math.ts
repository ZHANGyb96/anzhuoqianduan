// src/utils/troc-math.ts
/**
 * TROC 指标计算引擎 v1.1
 * ──────────────────────────────────────────────────────────────────────────
 * 修复记录（v1 → v1.1）：
 *
 *  [FIX-1] _zscore：彻底消除预热期 null→0 零值污染
 *    v1 做法：data.map(v => v ?? 0) 把预热期的 null 变成 0 再参与滚动均值/方差
 *    问题：前几十根的 OSC 值被系统性拉低，图上出现虚假超卖区域
 *    修复：滚动窗口内如有任何 null 则直接返回 null，不参与计算
 *
 *  [FIX-2] ADX 去重复计算
 *    v1 做法：troc-math.ts 内置 _adx() 函数独立重算一遍 ADX
 *    问题：与 ta-math.ts 的 full_adx 实现路径不同，导致副图 ADX 和 TROC 内部
 *          ADX 存在微小数值差异；同时造成重复计算开销
 *    修复：删除内置 _adx()，改为直接读取 calculateAllIndicators 已写入的
 *          items[i].adx 字段（calculateTROC 在 calculateAllIndicators 之后调用）
 *
 *  [FIX-3] _swingLow / _swingHigh：消除 spread 运算符
 *    v1 做法：Math.min(...winL) / Math.max(...winR)，每根K线都创建切片数组+spread
 *    修复：改为 for 循环，消除不必要的数组分配和 GC 压力
 *
 *  [FIX-4] _rollStd：注释与实现对齐
 *    v1 注释写"ddof=0 总体标准差"，但实现是 sum/(n-1)（ddof=1 样本标准差）
 *    修复：注释改为"ddof=1 样本标准差，对齐 pandas rolling.std() 默认行为"
 *
 * ──────────────────────────────────────────────────────────────────────────
 */

import type { KlineItem } from './ta-math'

// ─── 内部工具函数 ─────────────────────────────────────────────────────────────

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

/**
 * 滚动标准差（样本标准差，ddof=1，对齐 pandas rolling(n).std() 默认行为）
 * [FIX-4] 注释从"ddof=0"修正为"ddof=1"，与实现保持一致
 */
function _rollStd(data: number[], n: number): (number | null)[] {
    const ma = _sma(data, n)
    const out: (number | null)[] = new Array(data.length).fill(null)
    for (let i = n - 1; i < data.length; i++) {
        let sum = 0
        const m = ma[i]!
        for (let j = 0; j < n; j++) sum += (data[i - j] - m) ** 2
        // ddof=1：除以 (n-1)，对齐 pandas rolling(n).std() 的无偏估计
        out[i] = n > 1 ? Math.sqrt(sum / (n - 1)) : 0
    }
    return out
}

/**
 * Z-score 归一化：(x - rolling_mean) / rolling_std
 *
 * [FIX-1] 彻底消除预热期 null→0 零值污染
 *
 * v1 问题：data.map(v => v ?? 0) 把预热期（前 n_period-1 根）的 null 全部替换为 0，
 * 这些 0 进入了滚动均值/方差的计算窗口，导致：
 *   - 前 n_z 根的 rolling_mean 被人为压低（0 拉低均值）
 *   - rolling_std 被人为膨胀（0 与真实均值的偏差很大）
 *   - 最终 Z-score 在序列前期出现系统性偏差，图上呈现虚假超卖/超买
 *
 * v1.1 修复：窗口内有任何 null 则整个窗口输出 null，不污染统计量。
 * 在线单遍扫描，O(n) 空间，无额外数组分配。
 */
function _zscore(data: (number | null)[], n: number): (number | null)[] {
    const out: (number | null)[] = new Array(data.length).fill(null)

    // 滑动窗口：维护当前窗口的 sum 和 sum² 以及有效值计数
    let wSum = 0, wSum2 = 0, nullCnt = 0

    for (let i = 0; i < data.length; i++) {
        // 加入新值
        const cur = data[i]
        if (cur == null) {
            nullCnt++
            // null 占位：用 0 维护窗口长度（不影响最终判断，因为 nullCnt > 0 时跳过）
            wSum  += 0
            wSum2 += 0
        } else {
            wSum  += cur
            wSum2 += cur * cur
        }

        // 移除最旧值（超出窗口后）
        if (i >= n) {
            const old = data[i - n]
            if (old == null) {
                nullCnt--
            } else {
                wSum  -= old
                wSum2 -= old * old
            }
        }

        // 窗口未满或含 null → 不输出
        if (i < n - 1 || nullCnt > 0 || cur == null) continue

        const mean = wSum / n
        // ddof=1 样本方差（与 _rollStd 一致）
        const variance = (wSum2 - n * mean * mean) / (n - 1)
        const std = variance > 0 ? Math.sqrt(variance) : 0
        if (std === 0) continue

        out[i] = (cur - mean) / std
    }

    return out
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

/** DPO(n)：close - MA(n).shift(floor(n/2)+1) */
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
 * 价格历史分位（0~1）
 * 用 {val, idx} 对象数组维护有序窗口，按原始索引精确删除最旧值。
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
 * [FIX-3] 将 Math.min(...winL) / Math.min(...winR) 替换为 for 循环，
 * 消除每根K线的数组切片+spread分配，减少 GC 压力。
 */
function _swingLow(
    low: number[], left: number, right: number
): (number | null)[] {
    const out: (number | null)[] = new Array(low.length).fill(null)
    const end = low.length - right

    for (let i = left; i < end; i++) {
        // 左侧窗口最小值
        let minL = Infinity
        for (let j = i - left; j < i; j++) {
            if (low[j] < minL) minL = low[j]
        }
        // 右侧窗口最小值（live 模式 right=0 跳过）
        let minR = Infinity
        if (right > 0) {
            for (let j = i + 1; j <= i + right; j++) {
                if (low[j] < minR) minR = low[j]
            }
        }

        const leftOk  = left  === 0 || low[i] <= minL
        const rightOk = right === 0 || low[i] <= minR
        if (leftOk && rightOk) out[i] = low[i]
    }
    return out
}

/**
 * 摆动高点（滑动扫描）
 * [FIX-3] 同 _swingLow，替换 spread 为 for 循环
 */
function _swingHigh(
    high: number[], left: number, right: number
): (number | null)[] {
    const out: (number | null)[] = new Array(high.length).fill(null)
    const end = high.length - right

    for (let i = left; i < end; i++) {
        let maxL = -Infinity
        for (let j = i - left; j < i; j++) {
            if (high[j] > maxL) maxL = high[j]
        }
        let maxR = -Infinity
        if (right > 0) {
            for (let j = i + 1; j <= i + right; j++) {
                if (high[j] > maxR) maxR = high[j]
            }
        }

        const leftOk  = left  === 0 || high[i] >= maxL
        const rightOk = right === 0 || high[i] >= maxR
        if (leftOk && rightOk) out[i] = high[i]
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
    // [FIX-1] _zscore 已修复，此处无需 null→0 预处理
    const cci_z  = _zscore(_cci(items, n_period), n_z)
    const bias_z = _zscore(_bias(close, n_period), n_z)
    const dpo_z  = _zscore(_dpo(close, n_period), n_z)

    return close.map((_, i) => {
        const c = cci_z[i], b = bias_z[i], d = dpo_z[i]
        if (c == null || b == null || d == null) return null
        return 0.4 * c + 0.4 * b + 0.2 * d
    })
}

// ─── K线形态确认 ──────────────────────────────────────────────────────────────

/**
 * 锤子线/多方吞没 → buy_candle=1
 * 射击之星/空方吞没 → sell_candle=1
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

        // ── 吸筹得分
        let acc = 0
        acc += p < 0.3 ? 30 : p < 0.45 ? 15 : 0
        acc += (tr < 0 && tsl > 0) ? 25 : (tr > 0 && tr > ts) ? 12 : 0
        acc += o < -1.2 ? 25 : o < -0.6 ? 12 : 0
        acc += vt < 0.85 ? 20 : vt < 1.0 ? 10 : 0
        accScore[i] = acc

        // ── 派筹得分
        let dist = 0
        dist += p > 0.7 ? 30 : p > 0.55 ? 15 : 0
        dist += (tr > 0 && tsl < 0) ? 25 : (tr < 0 && tr < ts) ? 12 : 0
        dist += o > 1.2 ? 25 : o > 0.6 ? 12 : 0
        const pChg = i >= 3 ? (close[i] - close[i - 3]) / close[i - 3] : 0
        dist += (vt > 1.2 && pChg < 0.015) ? 20 : vt > 1.5 ? 10 : 0
        distScore[i] = dist

        // ── 状态机：滞后切换
        if (acc  >= 60) accState  = 1
        else if (acc  < 40) accState  = 0

        if (dist >= 60) distState = 1
        else if (dist < 40) distState = 0

        if (distState === 1) accState = 0
        phase[i] = accState - distState
    }

    return { phase, accScore, distScore }
}

// ─── 主导出函数 ───────────────────────────────────────────────────────────────

/**
 * 计算全部 TROC 字段并原地写入 items
 *
 * @param items      排序好的 KlineItem 数组（需已经过 calculateAllIndicators 写入，
 *                   以便复用 items[i].adx 字段）
 * @param swingMode  'review'（含未来确认，图表分析用）| 'live'（纯左侧，回测用）
 *
 * [FIX-2] ADX 去重复计算：
 *   calculateAllIndicators 已将 full_adx 写入 items[i].adx，此处直接读取复用，
 *   不再调用内置 _adx() 函数，消除双重计算和数值微差。
 *   注意：calculateTROC 必须在 calculateAllIndicators 之后调用（ta-math.ts 已保证）。
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

    // ── 短期 OSC（参数14，Z窗口40）
    const oscS    = _calcOsc(items, 14, 40)
    const oscSMa  = _ema(oscS.map(v => v ?? 0), 5)
    const trixS   = _trix(close, 9)
    const trixSZ  = _zscore(trixS, 40)

    // ── 长期 OSC（参数26，Z窗口80）
    const oscL    = _calcOsc(items, 26, 80)
    const oscLMa  = _ema(oscL.map(v => v ?? 0), 5)
    const trixL   = _trix(close, 18)
    const trixLZ  = _zscore(trixL, 80)

    // ── [FIX-2] ADX 直接复用 calculateAllIndicators 已写入的 items[i].adx
    // full_adx 前 14 根为 null（ta-math.ts 有 14 根 null 填充），此处保持一致
    const adxArr: (number | null)[] = items.map(d =>
        typeof d.adx === 'number' ? d.adx : null
    )

    // ── 震荡指数
    const chop    = _choppiness(items, 14)

    // ── 价格历史分位（120根窗口）
    const pct     = _pricePercentile(close, 120)

    // ── PHASE 状态机
    const { phase, accScore, distScore } = _calcPhase(items, oscL, close)

    // ── 摆动高低点
    const lLeft  = 5,  lRight  = swingMode === 'review' ? 5 : 0
    const swingLo = _ffill(_swingLow(low,   lLeft, lRight))
    const swingHi = _ffill(_swingHigh(high, lLeft, lRight))

    // ── 结构判断辅助
    const volMa20S  = _sma(items.map(d => d.volume), 20)
    const volRatioS = items.map((d, i) => volMa20S[i] && volMa20S[i]! > 0 ? d.volume / volMa20S[i]! : 1)
    const volT5S    = _sma(volRatioS, 5)

    // ── K线形态
    const candles = _candleConfirm(items)

    // ── 短期辅助线
    const trixRawS  = _trix(close, 9).map(v => v ?? 0)
    const trixSigS  = _ema(trixRawS, 6).map(v => v ?? 0)
    const trixSlpS  = trixRawS.map((v, i) => i >= 3 ? v - trixRawS[i - 3] : 0)
    const ema60     = _ema(close, 60).map(v => v ?? 0)

    // ── 长期辅助线
    const trixRawL  = _trix(close, 18).map(v => v ?? 0)
    const trixSigL  = _ema(trixRawL, 9).map(v => v ?? 0)
    const trixSlpL  = trixRawL.map((v, i) => i >= 5 ? v - trixRawL[i - 5] : 0)
    const ema120    = _ema(close, 120).map(v => v ?? 0)

    // ── BUY / SELL 信号（三层过滤）
    const trocBuyS:  (number | null)[] = new Array(items.length).fill(null)
    const trocSellS: (number | null)[] = new Array(items.length).fill(null)
    const trocBuyL:  (number | null)[] = new Array(items.length).fill(null)
    const trocSellL: (number | null)[] = new Array(items.length).fill(null)
    const trocStructLo: number[] = new Array(items.length).fill(0)
    const trocStructHi: number[] = new Array(items.length).fill(0)

    for (let i = 1; i < items.length; i++) {
        const oscSv = oscS[i] ?? 0, oscLv = oscL[i] ?? 0
        const vt    = volT5S[i] ?? 1

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
        if (trendUpS   && close[i] > ema60[i]  && structLo && buyCntS  >= 2) trocBuyS[i]  = oscSv
        if (trendDnS   && close[i] < ema60[i]  && structHi && sellCntS >= 2) trocSellS[i] = oscSv

        // 长期触发层
        const oscBuyL  = oscLv < -1.2 && oscLv > (oscL[i - 1] ?? 0) ? 1 : 0
        const oscSellL = oscLv >  1.2 && oscLv < (oscL[i - 1] ?? 0) ? 1 : 0
        const slpBuyL  = trixSlpL[i] > 0 && trixSlpL[i - 1] <= 0 ? 1 : 0
        const slpSellL = trixSlpL[i] < 0 && trixSlpL[i - 1] >= 0 ? 1 : 0
        const buyCntL  = oscBuyL  + candles.buy[i]  + slpBuyL
        const sellCntL = oscSellL + candles.sell[i] + slpSellL

        const trendUpL   = trixRawL[i] > 0 && trixRawL[i] > trixSigL[i]
        const trendDnL   = trixRawL[i] < 0 && trixRawL[i] < trixSigL[i]
        if (trendUpL   && close[i] > ema120[i] && structLo && buyCntL  >= 2 && phase[i] >= 0) trocBuyL[i]  = oscLv
        if (trendDnL   && close[i] < ema120[i] && structHi && sellCntL >= 2 && phase[i] <= 0) trocSellL[i] = oscLv
    }

    // ── 动态阈值（OSC 自身的滚动标准差扩张超买超卖线）
    const oscSClean = oscS.map(v => v ?? 0)
    const oscStd    = _rollStd(oscSClean, 40)

    // ── 写入 items
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
        items[i].troc_phase   = phase[i]
        items[i].troc_acc     = Math.round(accScore[i]  / 100 * 1000) / 1000
        items[i].troc_dist    = -(Math.round(distScore[i] / 100 * 1000) / 1000)
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

        // BUY / SELL 信号
        items[i].troc_buy_s     = trocBuyS[i]  != null ? Math.round(trocBuyS[i]!  * 10000) / 10000 : null
        items[i].troc_sell_s    = trocSellS[i] != null ? Math.round(trocSellS[i]! * 10000) / 10000 : null
        items[i].troc_buy_l     = trocBuyL[i]  != null ? Math.round(trocBuyL[i]!  * 10000) / 10000 : null
        items[i].troc_sell_l    = trocSellL[i] != null ? Math.round(trocSellL[i]! * 10000) / 10000 : null

        // 结构判断
        items[i].troc_struct_lo = trocStructLo[i]
        items[i].troc_struct_hi = trocStructHi[i]
    }

    return items
}
