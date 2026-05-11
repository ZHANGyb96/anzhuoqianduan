// src/utils/mobile-backtest-engine.ts
/**
 * 移动端本地离线回测引擎 v2
 * ─────────────────────────────────────────────────────────────────────────────
 * 升级内容：
 *  1. 周期级统计（K线根数）随主周期自适应窗口
 *     - 日线/周/月：3/5/10/15/20/30 根
 *     - 60/120/240分：3/6/9/12/18/24 根
 *     - 15/30分：    5/10/20/40/60/80 根
 *     - 1/5分：      5/10/20/40/80/120 根
 *
 *  2. 分钟级统计（真实时钟时间）同样随主周期自适应
 *     - 日线：       60/120/240 分钟
 *     - 60/120/240分：5/15/30/60 分钟
 *     - 15/30分：    5/15/30 分钟
 *     - 1/5分：      5/15 分钟
 *     使用真实1分钟K线数据，按时间戳定位信号后的N分钟内最高/最低/收盘价
 *
 *  3. 跨周期联动支持两个方向：
 *     - 高周期→低周期（5分钟主周期 + 日线条件）：取 time <= bar.time 最新的高周期bar
 *     - 低周期→高周期（日线主周期 + 60分钟条件）：取同一日期最后一根低周期bar
 *
 *  4. 每个统计窗口输出：上涨次数、下跌次数、胜率、平均最高涨幅、平均最大跌幅、平均盈亏
 *     字段格式保持兼容：win_rate_c3、win_rate_m60 等（backtest-results.tsx 无需改动）
 */

import { calculateAllIndicators, KlineItem } from './ta-math'

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

export interface BacktestCondition {
    left:  string
    op:    '>' | '<' | '>=' | '<=' | '==' | 'up_cross' | 'down_cross'
    right: string | number
}

export interface BacktestConditionGroup {
    logic:      'AND' | 'OR'
    conditions: (BacktestCondition | BacktestConditionGroup)[]
}

export interface BacktestResult {
    total_signals:         number
    stocks_with_data:      number
    survivorship_warning:  boolean
    data_disclaimer:       string
    signal_details:        SignalDetail[]
    signal_details_total:  number
    signal_details_capped: boolean
    has_minute_stats:      boolean   // 是否有真实分钟数据
    main_period:           string
    bar_windows:           number[]  // 实际使用的K线窗口
    minute_windows:        number[]  // 实际使用的分钟窗口
    batch_info: {
        requested:    number
        processed:    number
        skipped:      number
        cross_periods: string[]
        main_period:  string
    }
    [key: string]: any  // win_rate_c3 / win_rate_m60 等动态字段
}

export interface SignalDetail {
    time:  string
    stock: string
    close: number
    [key: string]: any
}

export type CrossPeriodMap = Record<string, KlineItem[]>

// ─── 自适应窗口配置 ───────────────────────────────────────────────────────────

/** 根据主周期返回合适的 K线根数统计窗口 */
export function getBarWindows(period: string): number[] {
    if (['1d', '1w', '1M'].includes(period))       return [3,  5, 10, 15, 20, 30]
    if (['240m', '120m', '60m'].includes(period))  return [3,  6,  9, 12, 18, 24]
    if (['30m',  '15m'].includes(period))          return [5, 10, 20, 40, 60, 80]
    /* 1m, 5m */                                   return [5, 10, 20, 40, 80, 120]
}

/** 根据主周期返回合适的分钟级统计窗口（真实分钟数） */
export function getMinuteWindows(period: string): number[] {
    if (['1d', '1w', '1M'].includes(period))       return [60, 120, 240]
    if (['240m', '120m', '60m'].includes(period))  return [5, 15, 30, 60]
    if (['30m',  '15m'].includes(period))          return [5, 15, 30]
    /* 1m, 5m */                                   return [5, 15]
}

// ─── 工具 ─────────────────────────────────────────────────────────────────────

function wilsonCI(wins: number, n: number, z = 1.96) {
    if (n === 0) return { low: null, high: null }
    const p      = wins / n
    const denom  = 1 + z * z / n
    const centre = (p + z * z / (2 * n)) / denom
    const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return {
        low:  Math.round((centre - margin) * 1000) / 10,
        high: Math.round((centre + margin) * 1000) / 10,
    }
}

function toTs(time: string | number): number {
    if (typeof time === 'number') return time
    return new Date(String(time).replace(' ', 'T')).getTime()
}

function toDateStr(time: string | number): string {
    return String(time).slice(0, 10)
}

function pct(a: number, b: number): number {
    return Math.round(((a - b) / b) * 10000) / 100
}

function avg(arr: number[]): number | null {
    if (!arr.length) return null
    return Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100
}

// ─── 跨周期数据注入 ────────────────────────────────────────────────────────────

/**
 * 将联动周期的指标注入到主周期 bar，支持两个方向：
 *
 * 方向A（高周期→低周期）：5分钟主周期 + 日线条件
 *   → 每根5分钟bar，取 time <= bar.time 最新的日线bar注入
 *
 * 方向B（低周期→高周期）：日线主周期 + 60分钟条件
 *   → 每根日线bar，取同一日期(YYYY-MM-DD)中60分钟bars的最后一根注入
 *
 * 注入字段命名：htf_<linkedPeriod>_<field>
 */
export function mergeCrossPeriodData(
    primaryBars:   KlineItem[],
    linkedBars:    KlineItem[],
    linkedPeriod:  string,
    mainPeriod:    string,
): KlineItem[] {
    if (!linkedBars || linkedBars.length === 0) return primaryBars

    const sortedLinked  = [...linkedBars].sort((a, b) => toTs(a.time) - toTs(b.time))
    const linkedWithInd = calculateAllIndicators([...sortedLinked])
    const prefix        = `htf_${linkedPeriod}_`

    // 判断联动周期粒度是否粗于主周期（高周期注入低周期）
    const PERIOD_RANK: Record<string, number> = {
        '1m': 1, '5m': 5, '15m': 15, '30m': 30,
        '60m': 60, '120m': 120, '240m': 240,
        '1d': 1440, '1w': 10080, '1M': 43200,
    }
    const mainRank   = PERIOD_RANK[mainPeriod]   ?? 1440
    const linkedRank = PERIOD_RANK[linkedPeriod] ?? 1440
    const isLinkedCoarser = linkedRank >= mainRank  // 联动是高周期（粒度更粗）

    const excludeKeys = new Set([
        'time','open','high','low','close','volume',
        'stock_code','stock_name','period',
    ])

    if (isLinkedCoarser) {
        // 方向A：高周期注入低周期，二分扫描
        let idx = 0
        return primaryBars.map(bar => {
            const barTs = toTs(bar.time)
            while (idx + 1 < linkedWithInd.length && toTs(linkedWithInd[idx + 1].time) <= barTs) {
                idx++
            }
            const linkedBar = linkedWithInd[idx]
            if (!linkedBar || toTs(linkedBar.time) > barTs) return bar
            const injected: Record<string, any> = {}
            for (const key of Object.keys(linkedBar)) {
                if (!excludeKeys.has(key)) injected[`${prefix}${key}`] = linkedBar[key]
            }
            return { ...bar, ...injected }
        })
    } else {
        // 方向B：低周期注入高周期，按日期取最后一根
        // key = YYYY-MM-DD，value = 该日最后一根联动周期bar（含指标）
        const byDate = new Map<string, KlineItem>()
        for (const bar of linkedWithInd) {
            byDate.set(toDateStr(bar.time), bar)
        }
        return primaryBars.map(bar => {
            const d         = toDateStr(bar.time)
            const linkedBar = byDate.get(d)
            if (!linkedBar) return bar
            const injected: Record<string, any> = {}
            for (const key of Object.keys(linkedBar)) {
                if (!excludeKeys.has(key)) injected[`${prefix}${key}`] = linkedBar[key]
            }
            return { ...bar, ...injected }
        })
    }
}

// ─── 条件评估 ─────────────────────────────────────────────────────────────────

function resolveField(field: string | number, item: KlineItem): number | null {
    if (typeof field === 'number') return field
    const val = (item as any)[field]
    if (val === undefined || val === null) return null
    return typeof val === 'number' ? val : parseFloat(String(val))
}

function evaluateRule(
    item: KlineItem, prevItem: KlineItem | undefined, rule: BacktestCondition
): boolean {
    const lv = resolveField(rule.left,  item)
    const rv = resolveField(rule.right, item)
    if (lv === null || isNaN(lv) || rv === null || isNaN(rv)) return false

    switch (rule.op) {
        case '>':  return lv > rv
        case '<':  return lv < rv
        case '>=': return lv >= rv
        case '<=': return lv <= rv
        case '==': return lv === rv
        case 'up_cross': {
            if (!prevItem) return false
            const pl = resolveField(rule.left,  prevItem)
            const pr = resolveField(rule.right, prevItem)
            return pl !== null && pr !== null && pl <= pr && lv > rv
        }
        case 'down_cross': {
            if (!prevItem) return false
            const pl = resolveField(rule.left,  prevItem)
            const pr = resolveField(rule.right, prevItem)
            return pl !== null && pr !== null && pl >= pr && lv < rv
        }
        default: return false
    }
}

function evalTree(
    item: KlineItem, prevItem: KlineItem | undefined,
    node: BacktestConditionGroup | BacktestCondition
): boolean {
    if ('logic' in node) {
        const r = node.conditions.map(c => evalTree(item, prevItem, c))
        return node.logic === 'AND' ? r.every(Boolean) : r.some(Boolean)
    }
    return evaluateRule(item, prevItem, node as BacktestCondition)
}

// ─── 1分钟数据二分定位 ────────────────────────────────────────────────────────

function findMinuteStart(ts1: number[], signalTs: number): number {
    let lo = 0, hi = ts1.length - 1
    while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (ts1[mid] <= signalTs) lo = mid + 1
        else hi = mid
    }
    return lo
}

// ─── 主回测函数 ───────────────────────────────────────────────────────────────

/**
 * @param rawKlinesMap   主周期K线（已注入跨周期字段），key = stockCode
 * @param minute1Map     1分钟K线，key = stockCode（用于分钟级统计，可传 {}）
 * @param mainPeriod     主周期字符串
 * @param conditions     策略条件树
 * @param onProgress     进度回调 (done, total)
 */
export function runMobileBacktest(
    rawKlinesMap: Record<string, KlineItem[]>,
    minute1Map:   Record<string, KlineItem[]>,
    mainPeriod:   string,
    conditions:   BacktestConditionGroup,
    onProgress?:  (done: number, total: number) => void,
): BacktestResult {

    const barWindows    = getBarWindows(mainPeriod)
    const minuteWindows = getMinuteWindows(mainPeriod)
    const maxBarHold    = Math.max(...barWindows)

    // 初始化统计桶
    type Bucket = { pnls: number[]; maxGains: number[]; maxLoss: number[] }
    const barBuckets:    Record<number, Bucket> = {}
    const minuteBuckets: Record<number, Bucket> = {}
    for (const w of barWindows)    barBuckets[w]    = { pnls: [], maxGains: [], maxLoss: [] }
    for (const w of minuteWindows) minuteBuckets[w] = { pnls: [], maxGains: [], maxLoss: [] }

    const stocks = Object.keys(rawKlinesMap)
    let totalSignals   = 0
    let stocksWithData = 0
    let hasMinuteStats = false
    const signalDetails: SignalDetail[] = []
    const LIMIT = 2000

    stocks.forEach((code, si) => {
        let items = rawKlinesMap[code]
        if (!items || items.length < 30) { onProgress?.(si + 1, stocks.length); return }

        items = [...items].sort((a, b) => toTs(a.time) - toTs(b.time))
        items = calculateAllIndicators(items)
        stocksWithData++

        const n = items.length

        // 准备1分钟数据
        const min1Raw  = minute1Map[code] ?? []
        const min1     = [...min1Raw].sort((a, b) => toTs(a.time) - toTs(b.time))
        const min1Ts   = min1.map(b => toTs(b.time))
        const hasMin1  = min1.length > 10

        for (let i = 1; i < n - 1; i++) {
            const cur  = items[i]
            const prev = items[i - 1]
            if (!evalTree(cur, prev, conditions)) continue
            const nextBar = items[i + 1]
            if (!nextBar) continue

            totalSignals++
            const entry    = nextBar.open
            const signalTs = toTs(cur.time)
            const detail: SignalDetail = { time: String(cur.time), stock: code, close: cur.close }

            // ── K线根数窗口 ───────────────────────────────────────────────
            for (const w of barWindows) {
                const startIdx = i + 1
                const endIdx = Math.min(i + w, n - 1)
                if (startIdx > endIdx) continue
                let maxHigh = -Infinity, minLow = Infinity
                for (let k = startIdx; k <= endIdx; k++) {
                if (items[k].high > maxHigh) maxHigh = items[k].high
                if (items[k].low  < minLow)  minLow  = items[k].low
                }
                const exitClose = items[endIdx].close
                const p         = pct(exitClose, entry)
                barBuckets[w].pnls.push(p)
                barBuckets[w].maxGains.push(pct(maxHigh, entry))
                barBuckets[w].maxLoss.push(pct(minLow, entry))
                detail[`pnl_c${w}`]  = p
                detail[`high_c${w}`] = pct(maxHigh, entry)
                detail[`low_c${w}`]  = pct(minLow, entry)
            }

            // ── 分钟级窗口 ────────────────────────────────────────────────
            if (hasMin1) {
                const startIdx = findMinuteStart(min1Ts, signalTs)
                for (const mins of minuteWindows) {
                    const endTs   = signalTs + mins * 60 * 1000
                    let   endIdx  = startIdx
                    while (endIdx + 1 < min1.length && min1Ts[endIdx + 1] <= endTs) endIdx++
                    if (startIdx > endIdx) continue
                    hasMinuteStats = true
                    let maxHigh = -Infinity, minLow = Infinity
                    for (let k = startIdx; k <= endIdx; k++) {
                        if (min1[k].high > maxHigh) maxHigh = min1[k].high
                        if (min1[k].low  < minLow)  minLow  = min1[k].low
                    }
                    const exitClose = min1[endIdx].close
                    const p         = pct(exitClose, entry)
                    minuteBuckets[mins].pnls.push(p)
                    minuteBuckets[mins].maxGains.push(pct(maxHigh, entry))
                    minuteBuckets[mins].maxLoss.push(pct(minLow, entry))
                    detail[`pnl_m${mins}`]  = p
                    detail[`high_m${mins}`] = pct(maxHigh, entry)
                    detail[`low_m${mins}`]  = pct(minLow, entry)
                }
            }

            if (signalDetails.length < LIMIT) signalDetails.push(detail)
        }

        onProgress?.(si + 1, stocks.length)
    })

    // ── 汇总结果（保持 win_rate_c3 / win_rate_m60 等平铺格式） ────────────────

    const result: BacktestResult = {
        total_signals:         totalSignals,
        stocks_with_data:      stocksWithData,
        survivorship_warning:  true,
        data_disclaimer:       '本统计仅基于已同步的本地数据，已退市品种未纳入。仅供技术研究参考，不构成投资建议。',
        signal_details:        signalDetails,
        signal_details_total:  totalSignals,
        signal_details_capped: totalSignals > LIMIT,
        has_minute_stats:      hasMinuteStats,
        main_period:           mainPeriod,
        bar_windows:           barWindows,
        minute_windows:        minuteWindows,
        batch_info: {
            requested:    0,
            processed:    stocksWithData,
            skipped:      0,
            cross_periods: [],
            main_period:  mainPeriod,
        },
    }

    // K线级桶
    for (const w of barWindows) {
        const { pnls, maxGains, maxLoss } = barBuckets[w]
        if (!pnls.length) continue
        const wins   = pnls.filter(v => v > 0)
        const losses = pnls.filter(v => v <= 0)
        const ci     = wilsonCI(wins.length, pnls.length)
        const key    = `c${w}`
        result[`win_rate_${key}`]         = Math.round(wins.length / pnls.length * 1000) / 10
        result[`win_count_${key}`]        = wins.length
        result[`loss_count_${key}`]       = losses.length
        result[`avg_win_pnl_${key}`]      = avg(wins)
        result[`avg_loss_pnl_${key}`]     = avg(losses)
        result[`avg_mfe_${key}`]          = avg(maxGains)
        result[`avg_mae_${key}`]          = avg(maxLoss)
        result[`win_rate_ci_low_${key}`]  = ci.low
        result[`win_rate_ci_high_${key}`] = ci.high
        result[`low_sample_${key}`]       = pnls.length < 30
    }

    // 分钟级桶
    for (const m of minuteWindows) {
        const { pnls, maxGains, maxLoss } = minuteBuckets[m]
        if (!pnls.length) continue
        const wins   = pnls.filter(v => v > 0)
        const losses = pnls.filter(v => v <= 0)
        const ci     = wilsonCI(wins.length, pnls.length)
        const key    = `m${m}`
        result[`win_rate_${key}`]         = Math.round(wins.length / pnls.length * 1000) / 10
        result[`win_count_${key}`]        = wins.length
        result[`loss_count_${key}`]       = losses.length
        result[`avg_win_pnl_${key}`]      = avg(wins)
        result[`avg_loss_pnl_${key}`]     = avg(losses)
        result[`avg_mfe_${key}`]          = avg(maxGains)
        result[`avg_mae_${key}`]          = avg(maxLoss)
        result[`win_rate_ci_low_${key}`]  = ci.low
        result[`win_rate_ci_high_${key}`] = ci.high
        result[`low_sample_${key}`]       = pnls.length < 30
    }

    return result
}
