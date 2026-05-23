// src/utils/mobile-backtest-engine.ts
/**
 * 移动端本地离线回测引擎 v3
 * ─────────────────────────────────────────────────────────────────────────────
 * v3 修复清单：
 *
 * [P0-1] 时间戳双重错误修复
 *   - 日线/周线/月线信号的 signalTs 原指向当日 00:00 UTC（北京时间 08:00 开盘前），
 *     导致 findMinuteStart 定位到开盘前，endTs 又用物理时钟计算导致窗口被截断。
 *   - 修复：isDayPlus 时，minuteStartTs 取入场 bar（nextBar）当天 09:30 CST；
 *     分钟窗口改为 K 线根数偏移（startIdx + mins - 1），彻底规避物理时钟跨越
 *     非交易时段的截断问题。
 *
 * [P0-2] 跨周期 up_cross / down_cross 双重修复
 *   - 修复1（未来函数）：mergeCrossPeriodData 方向A 原用时间戳比较，导致当天
 *     第一根低周期 bar 注入了尚未收盘的高周期 bar 的指标值。
 *     修复：改为日期字符串比较（linkedDate < barDate），确保只注入"比当天更早
 *     已收盘"的高周期 bar。
 *   - 修复2（永不触发）：方向A 下同一天所有主周期 bar 的 htf_xxx 字段完全一致，
 *     用主周期相邻 bar 差分做 up_cross 判断数学上永不成立。
 *     修复：注入时同时写入 htf_<period>_prev_<field>（联动周期前一根 bar 的值）；
 *     evaluateRule 遇到 htf_ 前缀的 cross 条件时，改用 cur[htf_prev_xxx] 与
 *     cur[htf_xxx] 做穿越判断，而非主周期相邻 bar 差分。
 *
 * [P1-1] 末尾窗口截断：统计桶只接受完整窗口
 *   - 原 Math.min(i + w, n-1) 让尾部不完整样本混入统计，长窗口胜率系统性失真。
 *   - 修复：只有 i + w <= n - 1 时才写入统计桶；detail 始终记录实际持有根数
 *     bars_c${w} 和完整性标志 full_c${w}，前端可据此标注"不完整窗口"。
 *
 * [P1-2] 连续信号冷却：防止趋势行情样本不独立
 *   - 原逻辑条件连续成立时会连续计信号，样本不独立导致胜率虚高。
 *   - 修复：每支品种维护独立的 cooldown 计数器，信号触发后冷却 barWindows[0]
 *     根（最小统计窗口），冷却期内跳过条件判断。
 *
 * [P3] up_cross 边界修正
 *   - pl <= pr 改为 pl < pr，平盘时不应触发上穿。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 原有功能：
 *  1. 周期级统计（K线根数）随主周期自适应窗口
 *     - 日线/周/月：3/5/10/15/20/30 根
 *     - 60/120/240分：3/6/9/12/18/24 根
 *     - 15/30分：    5/10/20/40/60/80 根
 *     - 1/5分：      5/10/20/40/80/120 根
 *
 *  2. 分钟级统计（真实交易分钟 K 线根数）随主周期自适应
 *     - 日线：       60/120/240 分钟
 *     - 60/120/240分：5/15/30/60 分钟
 *     - 15/30分：    5/15/30 分钟
 *     - 1/5分：      5/15 分钟
 *
 *  3. 跨周期联动支持两个方向（均已修复，见上）
 *
 *  4. 每个统计窗口输出：胜率、平均MFE/MAE/盈亏、Wilson 95% CI
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
    has_minute_stats:      boolean
    main_period:           string
    bar_windows:           number[]
    minute_windows:        number[]
    batch_info: {
        requested:    number
        processed:    number
        skipped:      number
        cross_periods: string[]
        main_period:  string
    }
    [key: string]: any
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

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

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

/**
 * [P0-2 辅助] 将 htf 字段名转为对应的 prev 字段名。
 * 例：htf_1d_macd → htf_1d_prev_macd
 *     htf_60m_ma5 → htf_60m_prev_ma5
 */
function toHtfPrevField(field: string): string {
    const match = field.match(/^(htf_[^_]+_)(.+)$/)
    return match ? `${match[1]}prev_${match[2]}` : field
}

// ─── 跨周期数据注入 ────────────────────────────────────────────────────────────

/**
 * 将联动周期的指标注入到主周期 bar，支持两个方向：
 *
 * 方向A（高周期→低周期）：5分钟主周期 + 日线条件
 *   [v3修复] 使用日期字符串比较（linkedDate < barDate），确保只注入比当天
 *   更早已收盘的高周期 bar，彻底消除未来函数。
 *   同时注入 htf_<period>_prev_<field>（联动周期前一根 bar 的值），供
 *   up_cross / down_cross 条件正确判断穿越方向。
 *
 * 方向B（低周期→高周期）：日线主周期 + 60分钟条件
 *   每根日线 bar，取同一日期最后一根低周期 bar 注入（含 prev_ 字段）。
 *
 * 注入字段命名：
 *   htf_<linkedPeriod>_<field>       当根值
 *   htf_<linkedPeriod>_prev_<field>  前一根值（供 up/down_cross 使用）
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

    const PERIOD_RANK: Record<string, number> = {
        '1m': 1, '5m': 5, '15m': 15, '30m': 30,
        '60m': 60, '120m': 120, '240m': 240,
        '1d': 1440, '1w': 10080, '1M': 43200,
    }
    const mainRank      = PERIOD_RANK[mainPeriod]   ?? 1440
    const linkedRank    = PERIOD_RANK[linkedPeriod] ?? 1440
    const isLinkedCoarser = linkedRank >= mainRank

    const excludeKeys = new Set([
        'time', 'open', 'high', 'low', 'close', 'volume',
        'stock_code', 'stock_name', 'period',
    ])

    /** 将一根 linkedBar 及其 prev 的指标注入到目标对象 */
    function buildInjected(
        linkedBar: KlineItem,
        prevLinkedBar: KlineItem | undefined,
    ): Record<string, any> {
        const injected: Record<string, any> = {}
        for (const key of Object.keys(linkedBar)) {
            if (excludeKeys.has(key)) continue
            injected[`${prefix}${key}`]      = linkedBar[key]
            // [P0-2修复] 同时注入前一根值，供 up_cross / down_cross 使用
            injected[`${prefix}prev_${key}`] = prevLinkedBar != null
                ? (prevLinkedBar as any)[key] ?? null
                : null
        }
        return injected
    }

    if (isLinkedCoarser) {
        // ── 方向A：高周期→低周期 ──────────────────────────────────────────────
        // [P0-2修复] 改为日期字符串比较：只注入日期严格早于当前主周期 bar 日期的
        // 高周期 bar，确保不读取当天尚未收盘的高周期数据（消除未来函数）。
        // idx = -1 表示当前还没有任何可用的高周期 bar。
        let idx = -1

        return primaryBars.map(bar => {
            const barDateStr = toDateStr(bar.time)

            // 推进 idx：找到日期严格小于 barDateStr 的最后一根 linked bar
            while (
                idx + 1 < linkedWithInd.length &&
                toDateStr(linkedWithInd[idx + 1].time) < barDateStr
            ) {
                idx++
            }

            // 尚无前置高周期 bar，不注入
            if (idx < 0) return bar

            const linkedBar     = linkedWithInd[idx]
            const prevLinkedBar = idx > 0 ? linkedWithInd[idx - 1] : undefined
            return { ...bar, ...buildInjected(linkedBar, prevLinkedBar) }
        })

    } else {
        // ── 方向B：低周期→高周期 ──────────────────────────────────────────────
        // 每根高周期 bar，取同一日期最后一根低周期 bar 注入。
        // byDate 已按时间升序构建，后写的覆盖先写的，自然取当日最后一根。
        const byDateIndex = new Map<string, number>()
        for (let i = 0; i < linkedWithInd.length; i++) {
            byDateIndex.set(toDateStr(linkedWithInd[i].time), i)
        }

        return primaryBars.map(bar => {
            const d   = toDateStr(bar.time)
            const idx = byDateIndex.get(d)
            if (idx == null) return bar

            const linkedBar     = linkedWithInd[idx]
            const prevLinkedBar = idx > 0 ? linkedWithInd[idx - 1] : undefined
            return { ...bar, ...buildInjected(linkedBar, prevLinkedBar) }
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

            const leftIsHtf  = typeof rule.left  === 'string' && rule.left.startsWith('htf_')
            const rightIsHtf = typeof rule.right === 'string' && (rule.right as string).startsWith('htf_')

            let pl: number | null
            let pr: number | null

            if (leftIsHtf || rightIsHtf) {
                // [P0-2修复] 跨周期穿越：用注入的 prev_ 字段，
                // 而非主周期相邻 bar 差分（后者对同天内所有 bar 永远相等）。
                pl = leftIsHtf
                    ? resolveField(toHtfPrevField(rule.left as string), item)
                    : resolveField(rule.left, prevItem)
                pr = rightIsHtf
                    ? resolveField(toHtfPrevField(rule.right as string), item)
                    : resolveField(rule.right, prevItem)
            } else {
                pl = resolveField(rule.left,  prevItem)
                pr = resolveField(rule.right, prevItem)
            }

            if (pl === null || isNaN(pl) || pr === null || isNaN(pr)) return false
            // [P3修复] pl < pr（严格小于），平盘时不触发上穿
            return pl < pr && lv > rv
        }

        case 'down_cross': {
            if (!prevItem) return false

            const leftIsHtf  = typeof rule.left  === 'string' && rule.left.startsWith('htf_')
            const rightIsHtf = typeof rule.right === 'string' && (rule.right as string).startsWith('htf_')

            let pl: number | null
            let pr: number | null

            if (leftIsHtf || rightIsHtf) {
                pl = leftIsHtf
                    ? resolveField(toHtfPrevField(rule.left as string), item)
                    : resolveField(rule.left, prevItem)
                pr = rightIsHtf
                    ? resolveField(toHtfPrevField(rule.right as string), item)
                    : resolveField(rule.right, prevItem)
            } else {
                pl = resolveField(rule.left,  prevItem)
                pr = resolveField(rule.right, prevItem)
            }

            if (pl === null || isNaN(pl) || pr === null || isNaN(pr)) return false
            // [P3修复] pl > pr（严格大于），平盘时不触发下穿
            return pl > pr && lv < rv
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

/**
 * 返回 min1Ts 中第一个 > signalTs 的下标（即 > signalTs 的左边界）。
 * 调用时传入 minuteStartTs - 1 可实现"第一个 >= minuteStartTs"的定位。
 */
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

    // [P0-1] 日线/周线/月线下分钟统计需要以入场 bar 当天 09:30 CST 为起点
    const isDayPlus = ['1d', '1w', '1M'].includes(mainPeriod)

    // [P1-2] 信号冷却期 = 最小K线窗口，防止趋势行情连续信号样本不独立
    const SIGNAL_COOLDOWN = barWindows[0]

    // 统计样本阈值
    const MIN_RELIABLE_SAMPLE = 30

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
        const min1Raw = minute1Map[code] ?? []
        const min1    = [...min1Raw].sort((a, b) => toTs(a.time) - toTs(b.time))
        const min1Ts  = min1.map(b => toTs(b.time))
        const hasMin1 = min1.length > 10

        // [P1-2] 每支品种独立的信号冷却计数器
        let cooldown = 0

        for (let i = 1; i < n - 1; i++) {
            // [P1-2] 冷却期内跳过
            if (cooldown > 0) { cooldown--; continue }

            const cur  = items[i]
            const prev = items[i - 1]
            if (!evalTree(cur, prev, conditions)) continue

            const nextBar = items[i + 1]
            if (!nextBar) continue

            totalSignals++
            // [P1-2] 触发信号后设置冷却期
            cooldown = SIGNAL_COOLDOWN

            const entry = nextBar.open
            const detail: SignalDetail = { time: String(cur.time), stock: code, close: cur.close }

            // ── K线根数窗口 ───────────────────────────────────────────────────
            for (const w of barWindows) {
                const startIdx   = i + 1
                const fullEndIdx = i + w          // 完整窗口所需的末尾下标
                // [P1-1] 判断当前信号是否有完整的 w 根窗口
                const isComplete = fullEndIdx <= n - 1
                const endIdx     = Math.min(fullEndIdx, n - 1)

                if (startIdx > endIdx) continue

                let maxHigh = -Infinity, minLow = Infinity
                for (let k = startIdx; k <= endIdx; k++) {
                    if (items[k].high > maxHigh) maxHigh = items[k].high
                    if (items[k].low  < minLow)  minLow  = items[k].low
                }
                const exitClose  = items[endIdx].close
                const p          = pct(exitClose, entry)
                const actualBars = endIdx - startIdx + 1

                // [P1-1] 只有完整窗口才写入统计桶，不完整则跳过
                if (isComplete) {
                    barBuckets[w].pnls.push(p)
                    barBuckets[w].maxGains.push(pct(maxHigh, entry))
                    barBuckets[w].maxLoss.push(pct(minLow, entry))
                }

                // detail 始终记录（含实际根数和完整性标志，前端可据此标注）
                detail[`pnl_c${w}`]   = p
                detail[`high_c${w}`]  = pct(maxHigh, entry)
                detail[`low_c${w}`]   = pct(minLow, entry)
                detail[`bars_c${w}`]  = actualBars   // [P1-1新增] 实际持有根数
                detail[`full_c${w}`]  = isComplete   // [P1-1新增] 窗口是否完整
            }

            // ── 分钟级窗口 ────────────────────────────────────────────────────
            if (hasMin1) {
                // [P0-1修复] 计算分钟统计的正确起始时间戳
                let minuteStartTs: number
                if (isDayPlus) {
                    // 日线/周线/月线：入场 bar（nextBar）当天 09:30 CST 开盘
                    // nextBar.time 格式为 "YYYY-MM-DD"
                    const entryDateStr = String(nextBar.time).slice(0, 10)
                    minuteStartTs = new Date(`${entryDateStr}T09:30:00+08:00`).getTime()
                } else {
                    // 分钟周期：入场 bar 的精确时间戳
                    minuteStartTs = toTs(nextBar.time)
                }

                // findMinuteStart 返回第一个 > (minuteStartTs - 1) 的下标
                // 即第一个 >= minuteStartTs 的 1m bar
                const startIdx = findMinuteStart(min1Ts, minuteStartTs - 1)

                // 边界检查：startIdx 对应的 bar 确实在 entryDate 当天（防止 1m 数据缺口跨日定位）
                if (startIdx >= min1.length) continue
                if (isDayPlus) {
                    const entryDateStr = String(nextBar.time).slice(0, 10)
                    // 用 UTC+8 偏移（8*3600*1000）计算 1m bar 对应的北京时间日期
                    const startBarCst    = new Date(min1Ts[startIdx] + 8 * 3600 * 1000)
                    const startBarDateStr = startBarCst.toISOString().slice(0, 10)
                    // 若定位到的 1m bar 不在入场当天，说明当天无分钟数据，跳过
                    if (startBarDateStr !== entryDateStr) continue
                }

                for (const mins of minuteWindows) {
                    // [P0-1修复] 改为 K 线根数偏移，彻底规避物理时钟跨越非交易时段问题
                    const endIdx = startIdx + mins - 1
                    // 数据不足 mins 根则跳过（与 K 线级截断逻辑保持一致）
                    if (endIdx >= min1.length) continue
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
        // [P3] survivorship_warning 由调用方（useBacktestTaskStore）在拿到
        //      batch_info.skipped 后动态覆盖，此处仅做默认值
        survivorship_warning:  false,
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
        result[`low_sample_${key}`]       = pnls.length < MIN_RELIABLE_SAMPLE
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
        result[`low_sample_${key}`]       = pnls.length < MIN_RELIABLE_SAMPLE
    }

    return result
}
