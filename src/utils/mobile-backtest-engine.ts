// src/utils/mobile-backtest-engine.ts
/**
 * 移动端本地离线回测引擎
 * ─────────────────────────────────────
 * 新增能力：
 *  1. 跨周期联动 —— 支持将高周期(HTF)指标值注入到主周期(primary)K线中
 *     使用 `htf_<period>_<field>` 字段名，评估条件时自动解析
 *  2. 批量多品种 —— rawKlinesMap 的 key = stockCode，支持最多20支
 *  3. onProgress 进度回调，用于UI进度条
 */

import { calculateAllIndicators, KlineItem } from './ta-math'

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

export interface BacktestCondition {
    left: string
    op: '>' | '<' | '>=' | '<=' | '==' | 'up_cross' | 'down_cross'
    right: string | number
}

export interface BacktestConditionGroup {
    logic: 'AND' | 'OR'
    conditions: (BacktestCondition | BacktestConditionGroup)[]
}

export interface BacktestResult {
    total_signals: number
    stocks_with_data: number
    survivorship_warning: boolean
    data_disclaimer: string
    signal_details: Array<{time: string, stock: string, [key: string]: any}>
    signal_details_total: number
    signal_details_capped: boolean
    [key: string]: any
}

/**
 * 跨周期联动数据 Map
 * key = htf周期字符串 (e.g. '1d'), value = 已计算指标的K线数组（正序）
 */
export type CrossPeriodMap = Record<string, KlineItem[]>

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function wilsonCI(wins: number, n: number, z = 1.96) {
    if (n === 0) return { low: null, high: null }
    const p = wins / n
    const denom = 1 + z * z / n
    const centre = (p + z * z / (2 * n)) / denom
    const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return {
        low:  Math.round((centre - margin) * 1000) / 10,
        high: Math.round((centre + margin) * 1000) / 10
    }
}

/**
 * 将时间字符串统一转为毫秒时间戳，用于跨周期时间对齐
 */
function toTs(time: string | number): number {
    if (typeof time === 'number') return time
    // 处理 "2024-01-02 09:30:00" 或 "2024-01-02" 格式
    return new Date(String(time).replace(' ', 'T')).getTime()
}

/**
 * 核心：将高周期(HTF)的指标数据对齐并注入到主周期(primary)K线中
 *
 * 对齐规则：对于每根主周期K线，找到 HTF 中 time <= primary_bar.time 的最新一根
 * 注入字段命名：`htf_${htfPeriod}_${field}` e.g. `htf_1d_ma20`
 *
 * 这样在 evaluateRule 中，条件 left="htf_1d_ma20" 就能直接从 item 中读到日线MA20
 */
export function mergeCrossPeriodData(
    primaryBars: KlineItem[],
    htfBars: KlineItem[],
    htfPeriod: string
): KlineItem[] {
    if (!htfBars || htfBars.length === 0) return primaryBars

    // 确保 HTF 正序
    const sortedHtf = [...htfBars].sort(
        (a, b) => toTs(a.time) - toTs(b.time)
    )
    // 对 HTF 计算指标
    const htfWithIndicators = calculateAllIndicators([...sortedHtf])

    // 对主周期每根K线做二分查找最近HTF bar
    const prefix = `htf_${htfPeriod}_`
    let htfIdx = 0

    return primaryBars.map(bar => {
        const barTs = toTs(bar.time)

        // 推进 htfIdx 直到找到最后一个 htfTs <= barTs
        while (
            htfIdx + 1 < htfWithIndicators.length &&
            toTs(htfWithIndicators[htfIdx + 1].time) <= barTs
        ) {
            htfIdx++
        }

        const htfBar = htfWithIndicators[htfIdx]
        if (!htfBar || toTs(htfBar.time) > barTs) return bar

        // 注入：把 HTF 所有指标字段复制到主周期 bar，加上 `htf_${period}_` 前缀
        const injected: Record<string, any> = {}
        for (const key of Object.keys(htfBar)) {
            if (key === 'time' || key === 'open' || key === 'high' ||
                key === 'low'  || key === 'close' || key === 'volume' ||
                key === 'stock_code' || key === 'stock_name' || key === 'period') {
                continue
            }
            injected[`${prefix}${key}`] = htfBar[key]
        }

        return { ...bar, ...injected }
    })
}

// ─── 条件评估 ─────────────────────────────────────────────────────────────────

/**
 * 解析条件中的字段名：
 *  - 如果条件 left/right 带有 `_${period}` 后缀（老格式），转成 `htf_${period}_${base}` 新格式
 *  - 新格式已经是 `htf_${period}_*`，直接使用
 *
 * 注：strategy-builder 生成的条件格式为：
 *   { left: 'ma20', op: '>', right: 'ma60', period: '1d' }
 *   → 在 store 中转换为：{ left: 'htf_1d_ma20', op: '>', right: 'htf_1d_ma60' }
 */
function resolveField(field: string | number, item: KlineItem): number | null {
    if (typeof field === 'number') return field
    const val = item[field]
    if (val === undefined || val === null) return null
    return typeof val === 'number' ? val : parseFloat(String(val))
}

function evaluateRule(
    item: KlineItem,
    prevItem: KlineItem | undefined,
    rule: BacktestCondition
): boolean {
    const lValue = resolveField(rule.left, item)
    if (lValue === null || isNaN(lValue)) return false

    const rValue = resolveField(rule.right, item)
    if (rValue === null || isNaN(rValue)) return false

    switch (rule.op) {
        case '>':  return lValue > rValue
        case '<':  return lValue < rValue
        case '>=': return lValue >= rValue
        case '<=': return lValue <= rValue
        case '==': return lValue === rValue
        case 'up_cross': {
            if (!prevItem) return false
            const prevL = resolveField(rule.left,  prevItem)
            const prevR = resolveField(rule.right, prevItem)
            if (prevL === null || prevR === null) return false
            return prevL <= prevR && lValue > rValue
        }
        case 'down_cross': {
            if (!prevItem) return false
            const prevL = resolveField(rule.left,  prevItem)
            const prevR = resolveField(rule.right, prevItem)
            if (prevL === null || prevR === null) return false
            return prevL >= prevR && lValue < rValue
        }
        default: return false
    }
}

function parseConditions(
    item: KlineItem,
    prevItem: KlineItem | undefined,
    node: BacktestConditionGroup | BacktestCondition
): boolean {
    if ('logic' in node) {
        const results = node.conditions.map(c => parseConditions(item, prevItem, c))
        return node.logic === 'AND' ? results.every(Boolean) : results.some(Boolean)
    }
    return evaluateRule(item, prevItem, node as BacktestCondition)
}

// ─── 主回测函数 ───────────────────────────────────────────────────────────────

/**
 * 移动端本地批量回测引擎
 *
 * @param rawKlinesMap     主周期K线数据，key=stockCode（已预处理含HTF注入）
 * @param conditions       策略条件树（支持跨周期字段 htf_<period>_<field>）
 * @param holdingPeriods   周期级持仓周期列表（K线根数）
 * @param onProgress       进度回调 (done, total)
 */
export function runMobileBacktest(
    rawKlinesMap: Record<string, KlineItem[]>,
    conditions: BacktestConditionGroup,
    holdingPeriods = [3, 6, 9, 12, 15, 18, 24, 30],
    onProgress?: (done: number, total: number) => void
): BacktestResult {

    const stocks = Object.keys(rawKlinesMap)

    const tradesByPeriod: Record<string, number[]> = {}
    const mfeByPeriod:    Record<string, number[]> = {}
    const maeByPeriod:    Record<string, number[]> = {}

    // 初始化统计桶：周期级 c<n> + 分钟级 m<n>
    const minutePeriods = [5, 15, 30, 60, 120, 240]
    const allPeriods = [...new Set([...holdingPeriods, ...minutePeriods])]
    allPeriods.forEach(p => {
        ;[`c${p}`, `m${p}`].forEach(k => {
            tradesByPeriod[k] = []
            mfeByPeriod[k]    = []
            maeByPeriod[k]    = []
        })
    })

    let totalSignals   = 0
    let stocksWithData = 0
    const signalDetails: any[] = []
    const SIGNAL_DETAIL_LIMIT = 2000

    stocks.forEach((stockCode, si) => {
        let items = rawKlinesMap[stockCode]
        if (!items || items.length < 30) {
            onProgress?.(si + 1, stocks.length)
            return
        }

        // 正序排列
        items = [...items].sort(
            (a, b) => toTs(a.time) - toTs(b.time)
        )

        // 对主周期计算指标（HTF字段已注入，计算不影响其值）
        items = calculateAllIndicators(items)
        stocksWithData++

        const n       = items.length
        const maxHold = Math.max(...holdingPeriods)

        for (let i = 1; i < n - maxHold; i++) {
            const currentBar = items[i]
            const prevBar    = items[i - 1]

            const triggered = parseConditions(currentBar, prevBar, conditions)
            if (!triggered) continue

            totalSignals++
            const entryPrice = currentBar.close
            const signalObj: any = {
                time:  String(currentBar.time),
                stock: stockCode
            }

            // ── 周期级统计 ─────────────────────────────────────────────
            holdingPeriods.forEach(p => {
                const exitIdx  = Math.min(i + p, n - 1)
                const exitPrice = items[exitIdx].close
                const pnl = ((exitPrice - entryPrice) / entryPrice) * 100

                signalObj[`pnl_c${p}`] = Math.round(pnl * 100) / 100

                const window = items.slice(i + 1, exitIdx + 1)
                const fHigh  = window.length > 0 ? Math.max(...window.map(k => k.high)) : entryPrice
                const fLow   = window.length > 0 ? Math.min(...window.map(k => k.low))  : entryPrice

                tradesByPeriod[`c${p}`].push(pnl)
                mfeByPeriod[`c${p}`].push(((fHigh - entryPrice) / entryPrice) * 100)
                maeByPeriod[`c${p}`].push(((fLow  - entryPrice) / entryPrice) * 100)
            })

            if (signalDetails.length < SIGNAL_DETAIL_LIMIT) {
                signalDetails.push(signalObj)
            }
        }

        onProgress?.(si + 1, stocks.length)
    })

    // ── 汇总 ──────────────────────────────────────────────────────────────────

    const avg = (arr: number[]) =>
        arr.length
            ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100
            : null

    const flatResults: any = {
        total_signals:        totalSignals,
        stocks_with_data:     stocksWithData,
        survivorship_warning: true,
        data_disclaimer:      '本统计仅基于已同步数据，已退市品种未纳入。仅供技术研究参考，不构成投资建议。',
        signal_details:       signalDetails,
        signal_details_total: totalSignals,
        signal_details_capped: totalSignals > SIGNAL_DETAIL_LIMIT,
    }

    holdingPeriods.forEach(p => {
        const key    = `c${p}`
        const trades = tradesByPeriod[key]
        if (!trades || trades.length === 0) return

        const wins   = trades.filter(v => v > 0)
        const losses = trades.filter(v => v <= 0)
        const ci     = wilsonCI(wins.length, trades.length)

        flatResults[`win_rate_${key}`]         = Math.round((wins.length / trades.length) * 1000) / 10
        flatResults[`win_count_${key}`]        = wins.length
        flatResults[`loss_count_${key}`]       = losses.length
        flatResults[`avg_win_pnl_${key}`]      = avg(wins)
        flatResults[`avg_loss_pnl_${key}`]     = avg(losses)
        flatResults[`avg_mfe_${key}`]          = avg(mfeByPeriod[key])
        flatResults[`avg_mae_${key}`]          = avg(maeByPeriod[key])
        flatResults[`win_rate_ci_low_${key}`]  = ci.low
        flatResults[`win_rate_ci_high_${key}`] = ci.high
        flatResults[`low_sample_${key}`]       = trades.length < 30
    })

    return flatResults as BacktestResult
}
