// src/lib/mobile-market-data.ts
/**
 * 行情数据同步模块
 *
 * 修复记录：
 *  [FIX-10] buildPrefixedSymbol 不处理北交所代码
 *    v1 问题：北交所股票代码以 '8' 或 '4' 开头（如 835588、430047），
 *             会被 v1 逻辑误判为深交所（sz835588），
 *             新浪和腾讯接口对 sz8xxxxx 均返回空数据，静默丢失。
 *    修复：增加 '8'/'43'/'83' 开头的北交所代码识别，前缀改为 'bj'。
 *    注意：新浪接口和腾讯 fqkline 对北交所数据支持有限，
 *          即使前缀正确也可能返回空，日志中会有 ⚠ [无数据] 提示。
 *
 *  [FIX-11] 120m / 240m 周期本地合成支持（Capacitor 环境）
 *    v1 问题：120m/240m 在 SINA_MINUTE_MAP 和 TENCENT_PERIOD_MAP 中均未定义，
 *             syncStockToMobile 会直接走 else 分支打印"不支持的周期"并返回。
 *             而 strategy-builder 允许选择这两个周期，导致回测数据为空。
 *    修复：对 120m/240m 采用"从本地 60m 数据合并重采样"策略：
 *          - 先检查本地是否有 60m 数据
 *          - 有则按 2/4 根一组合并为 120m/240m（OHLCV 合并规则：
 *            open=第一根、high=最高、low=最低、close=最后根、volume=求和）
 *          - 没有 60m 数据则先自动拉取 60m 再合并
 *          - 合并结果同样通过 bulkInsertKlines 写入本地库
 */

import { CapacitorHttp } from '@capacitor/core';
import { bulkInsertKlines, getKlinesForStocks } from './mobile-db';

// ── 新浪分钟线 scale 映射（最高支持 60m）──────────────────────────────────────
// CN_MarketDataService.getKLineData scale=120/240/D/W/M 均返回 {__ERROR}
const SINA_MINUTE_MAP: Record<string, string> = {
    '1m':  '1',
    '5m':  '5',
    '15m': '15',
    '30m': '30',
    '60m': '60',
};

// ── 腾讯日/周/月线 period 映射 ─────────────────────────────────────────────────
const TENCENT_PERIOD_MAP: Record<string, string> = {
    '1d': 'day',
    '1w': 'week',
    '1M': 'month',
};

// ── 合成周期：由哪个源周期合并、每几根一组 ────────────────────────────────────
const RESAMPLE_MAP: Record<string, { from: string; ratio: number }> = {
    '120m': { from: '60m', ratio: 2 },
    '240m': { from: '60m', ratio: 4 },
};

// ─── 主入口 ───────────────────────────────────────────────────────────────────

export async function syncStockToMobile(
    stockCode: string,
    stockName: string,
    period: string,
    onLog: (msg: string) => void,
) {
    onLog(`[系统] 启动同步 ${stockName || stockCode} (${period}周期)...`);

    if (SINA_MINUTE_MAP[period]) {
        await fetchMinuteFromSina(stockCode, stockName, period, onLog);
    } else if (TENCENT_PERIOD_MAP[period]) {
        await fetchDailyFromTencent(stockCode, stockName, period, onLog);
    } else if (RESAMPLE_MAP[period]) {
        // [FIX-11] 120m / 240m 本地合成
        await resampleFromLocal(stockCode, stockName, period, onLog);
    } else {
        onLog(`✗ [配置错误] 不支持的周期: ${period}（支持: 1m/5m/15m/30m/60m/1d/1w/1M/120m/240m），跳过。`);
    }
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * [FIX-10] 股票代码 → 带交易所前缀格式
 *
 * 规则：
 *   上交所 (SH)：6 开头 → sh
 *   北交所 (BJ)：43/83 开头 → bj（北交所两类主要板块前缀）
 *                8 开头（非 83 开头）→ bj（预防性兜底）
 *   深交所 (SZ)：其余 → sz（含 0/2/3 开头的主板/中小板/创业板）
 *
 * 注意：北交所品种在新浪/腾讯接口数据支持有限，
 *       前缀正确也可能返回空数据，属数据源限制而非代码错误。
 */
function buildPrefixedSymbol(stockCode: string): string {
    // 已经有前缀则直接返回
    if (
        stockCode.startsWith('sh') ||
        stockCode.startsWith('sz') ||
        stockCode.startsWith('bj')
    ) return stockCode;

    // 上交所：6 开头
    if (stockCode.startsWith('6')) return `sh${stockCode}`;

    // 北交所：43/83 开头，或 8 开头（兜底）
    if (
        stockCode.startsWith('43') ||
        stockCode.startsWith('83') ||
        stockCode.startsWith('8')
    ) return `bj${stockCode}`;

    // 深交所：0/2/3 及其他
    return `sz${stockCode}`;
}

/** 截取响应预览，方便日志排查 */
function logPreview(data: any, onLog: (msg: string) => void) {
    if (data !== null && data !== undefined) {
        const preview = typeof data === 'string'
            ? data.slice(0, 120)
            : JSON.stringify(data).slice(0, 120);
        onLog(`  → 响应预览: ${preview}`);
    }
}

// ─── [FIX-11] 本地合成 120m / 240m ──────────────────────────────────────────

/**
 * 从本地已有的 sourcePeriod（通常 60m）K 线数据合并重采样到目标 period。
 *
 * 合并规则（标准 OHLCV 重采样）：
 *   open   = 第一根的开盘价
 *   high   = 所有根的最高价
 *   low    = 所有根的最低价
 *   close  = 最后一根的收盘价
 *   volume = 所有根的成交量之和
 *   time   = 第一根的时间（代表该合成周期的起始时刻）
 *
 * 边界处理：末尾不足 ratio 根的组将被丢弃（未完成的 K 线不写入）。
 */
async function resampleFromLocal(
    stockCode: string,
    stockName: string,
    period: string,
    onLog: (msg: string) => void,
) {
    const { from: sourcePeriod, ratio } = RESAMPLE_MAP[period]!;

    onLog(`  → ${period} = 本地 ${sourcePeriod} × ${ratio}，准备读取本地数据...`);

    // 先检查本地是否有 sourcePeriod 数据
    const localData = await getKlinesForStocks([stockCode], sourcePeriod, 5000);
    const sourceRows = localData[stockCode] ?? [];

    if (sourceRows.length === 0) {
        onLog(`  ⚠ 本地无 ${sourcePeriod} 数据，尝试先拉取 ${sourcePeriod}...`);
        await fetchMinuteFromSina(stockCode, stockName, sourcePeriod, onLog);

        // 重新读取
        const refetched = await getKlinesForStocks([stockCode], sourcePeriod, 5000);
        const rows = refetched[stockCode] ?? [];
        if (rows.length === 0) {
            onLog(`✗ 拉取 ${sourcePeriod} 失败，无法合成 ${period}。`);
            return;
        }
        onLog(`  → 拉取完成，共 ${rows.length} 根 ${sourcePeriod} K线，开始合成...`);
        await _doResample(rows, stockCode, stockName, period, ratio, onLog);
    } else {
        onLog(`  → 本地已有 ${sourceRows.length} 根 ${sourcePeriod} K线，开始合成...`);
        await _doResample(sourceRows, stockCode, stockName, period, ratio, onLog);
    }
}

async function _doResample(
    sourceRows: any[],
    stockCode: string,
    stockName: string,
    period: string,
    ratio: number,
    onLog: (msg: string) => void,
) {
    // 按时间升序（getKlinesForStocks 返回降序，需要翻转）
    const sorted = [...sourceRows].sort((a, b) => {
        const ta = typeof a.time === 'string' ? a.time : String(a.time);
        const tb = typeof b.time === 'string' ? b.time : String(b.time);
        return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    const merged: any[] = [];
    // 按 ratio 根一组切分
    for (let i = 0; i + ratio - 1 < sorted.length; i += ratio) {
        const group = sorted.slice(i, i + ratio);
        const open   = group[0].open;
        const close  = group[group.length - 1].close;
        const high   = group.reduce((m, r) => Math.max(m, r.high),   -Infinity);
        const low    = group.reduce((m, r) => Math.min(m, r.low),     Infinity);
        const volume = group.reduce((s, r) => s + (r.volume ?? 0),    0);
        const time   = group[0].time;   // 用该组第一根的时间作为标识

        if (isNaN(open) || isNaN(close) || isNaN(high) || isNaN(low)) continue;

        merged.push({ time, stock_code: stockCode, stock_name: stockName, period, open, high, low, close, volume });
    }

    if (merged.length === 0) {
        onLog(`⚠ [无合成结果] ${stockCode} 合成后无有效数据，可能源数据不足 ${ratio} 根。`);
        return;
    }

    await bulkInsertKlines(merged);
    onLog(`✓ [合成写入] ${merged.length} 根 ${period} K线已写入本地库（来源：${merged.length * ratio} 根 ${RESAMPLE_MAP[period]!.from}）。`);
}

// ─── 新浪分钟线 (1m / 5m / 15m / 30m / 60m) ─────────────────────────────────

async function fetchMinuteFromSina(
    stockCode: string, stockName: string, period: string, onLog: (msg: string) => void
) {
    const sinaScale = SINA_MINUTE_MAP[period];
    const prefixed  = buildPrefixedSymbol(stockCode);
    const num       = '2000';

    onLog(`  → 请求: symbol=${prefixed}, scale=${sinaScale}, num=${num}`);

    // 北交所品种提前告警（数据支持有限）
    if (prefixed.startsWith('bj')) {
        onLog(`  ⚠ 北交所品种 ${stockCode}：新浪接口对北交所数据支持有限，可能返回空。`);
    }

    try {
        const res = await CapacitorHttp.request({
            method: 'GET',
            url: 'https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData',
            params: { symbol: prefixed, scale: sinaScale, dateback: '0', num },
        });

        onLog(`  → HTTP状态: ${res.status}, 数据类型: ${typeof res.data}, isArray: ${Array.isArray(res.data)}`);
        logPreview(res.data, onLog);

        const rows = parseSinaData(res.data, stockCode, stockName, period);

        if (rows.length > 0) {
            await bulkInsertKlines(rows);
            onLog(`✓ [写入成功] ${rows.length} 条数据已落库 (${period}).`);
        } else {
            onLog(`⚠ [无数据] 服务器响应为空或退市品种 (scale=${sinaScale}).`);
        }
    } catch (e: any) {
        onLog(`✗ [拉取报错] 网络不畅或解析失败: ${e.message}`);
        throw e;
    }
}

function parseSinaData(
    data: any, stockCode: string, stockName: string, period: string
): any[] {
    if (data === null || data === undefined) return [];

    let list: any = data;

    if (typeof data === 'string') {
        const trimmed = data.trim();
        if (!trimmed || trimmed === 'null' || trimmed === '[]') return [];
        try { list = JSON.parse(trimmed); } catch { return []; }
    }

    // 新浪错误响应早退
    if (!Array.isArray(list) && list && typeof list === 'object' && list.__ERROR) {
        throw new Error(`新浪接口拒绝请求: ${list.__ERRORMSG ?? 'Unknown error'}`);
    }

    // 新浪有时把数组包在对象里
    if (!Array.isArray(list) && list && typeof list === 'object') {
        list = list.result ?? list.data ?? list.KLineData ?? list.items ?? null;
    }

    if (!Array.isArray(list) || list.length === 0) return [];

    return list
        .map((item: any) => {
            const time   = item.day   ?? item.d  ?? item.datetime ?? item[0];
            const open   = parseFloat(item.open  ?? item.o        ?? item[1]);
            const high   = parseFloat(item.high  ?? item.h        ?? item[2]);
            const low    = parseFloat(item.low   ?? item.l        ?? item[3]);
            const close  = parseFloat(item.close ?? item.c        ?? item[4]);
            const volume = parseFloat(item.volume ?? item.v       ?? item[5] ?? '0');
            return { time, stock_code: stockCode, stock_name: stockName, period, open, high, low, close, volume };
        })
        .filter((r: any) =>
            r.time && !isNaN(r.open) && !isNaN(r.high) && !isNaN(r.low) && !isNaN(r.close)
        );
}

// ─── 腾讯日/周/月线 (1d / 1w / 1M) ──────────────────────────────────────────

async function fetchDailyFromTencent(
    stockCode: string, stockName: string, period: string, onLog: (msg: string) => void
) {
    const tencentPeriod = TENCENT_PERIOD_MAP[period];
    const prefixed      = buildPrefixedSymbol(stockCode);
    const num           = '1500';

    onLog(`  → 请求: 腾讯fqkline, symbol=${prefixed}, period=${tencentPeriod}, num=${num}`);

    if (prefixed.startsWith('bj')) {
        onLog(`  ⚠ 北交所品种 ${stockCode}：腾讯 fqkline 接口对北交所支持有限，可能返回空。`);
    }

    try {
        const res = await CapacitorHttp.request({
            method: 'GET',
            url: 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get',
            params: { param: `${prefixed},${tencentPeriod},,,${num},qfq` },
        });

        onLog(`  → HTTP状态: ${res.status}, 数据类型: ${typeof res.data}`);
        logPreview(res.data, onLog);

        const rows = parseTencentData(res.data, stockCode, stockName, period, prefixed, tencentPeriod);

        if (rows.length > 0) {
            await bulkInsertKlines(rows);
            onLog(`✓ [写入成功] ${rows.length} 条数据已落库 (${period}).`);
        } else {
            onLog(`⚠ [无数据] 腾讯接口返回为空 (${tencentPeriod}).`);
        }
    } catch (e: any) {
        onLog(`✗ [拉取报错] 网络不畅或解析失败: ${e.message}`);
        throw e;
    }
}

function parseTencentData(
    data: any, stockCode: string, stockName: string, period: string,
    prefixedSymbol: string, tencentPeriod: string
): any[] {
    if (!data) return [];

    let parsed = data;
    if (typeof data === 'string') {
        try { parsed = JSON.parse(data); } catch { return []; }
    }

    if (parsed.code !== undefined && parsed.code !== 0) {
        throw new Error(`腾讯接口返回错误: code=${parsed.code}, msg=${parsed.msg ?? ''}`);
    }

    const symbolData = parsed?.data?.[prefixedSymbol];
    if (!symbolData) return [];

    const qfqKey          = `qfq${tencentPeriod}`;
    const list: any[]     = symbolData[qfqKey] ?? symbolData[tencentPeriod] ?? [];

    if (!Array.isArray(list) || list.length === 0) return [];

    // 腾讯 fqkline 字段顺序: [date, open, close, high, low, volume]
    return list
        .map((item: any) => {
            if (!Array.isArray(item) || item.length < 5) return null;
            const time   = item[0];
            const open   = parseFloat(item[1]);
            const close  = parseFloat(item[2]);
            const high   = parseFloat(item[3]);
            const low    = parseFloat(item[4]);
            const volume = parseFloat(item[5] ?? '0');
            return { time, stock_code: stockCode, stock_name: stockName, period, open, high, low, close, volume };
        })
        .filter((r: any): r is NonNullable<typeof r> =>
            r !== null && r.time && !isNaN(r.open) && !isNaN(r.high) && !isNaN(r.low) && !isNaN(r.close)
        );
}
