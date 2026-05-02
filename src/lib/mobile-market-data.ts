import { CapacitorHttp } from '@capacitor/core';
import { bulkInsertKlines } from './mobile-db';

// ── 新浪分钟线 scale 映射 ────────────────────────────────────────────────────
// CN_MarketDataService.getKLineData 仅支持数字 scale (1/5/15/30/60)
// scale=120/240/D/W/M 均返回 {__ERROR}，故不包含
const SINA_MINUTE_MAP: Record<string, string> = {
    '1m':  '1',
    '5m':  '5',
    '15m': '15',
    '30m': '30',
    '60m': '60',
};

// ── 腾讯日/周/月线 period 映射 ───────────────────────────────────────────────
// 新浪 getKLineData 不支持 D/W/M；改用腾讯 fqkline（前复权）接口，纯 JSON
const TENCENT_PERIOD_MAP: Record<string, string> = {
    '1d': 'day',
    '1w': 'week',
    '1M': 'month',
};

// ─── 主入口 ──────────────────────────────────────────────────────────────────

export async function syncStockToMobile(
    stockCode: string,
    stockName: string,
    period: string,
    onLog: (msg: string) => void
) {
    onLog(`[系统] 启动同步 ${stockName || stockCode} (${period}周期)...`);

    if (SINA_MINUTE_MAP[period]) {
        await fetchMinuteFromSina(stockCode, stockName, period, onLog);
    } else if (TENCENT_PERIOD_MAP[period]) {
        await fetchDailyFromTencent(stockCode, stockName, period, onLog);
    } else {
        onLog(`✗ [配置错误] 不支持的周期: ${period}，跳过。`);
        return;
    }
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** 股票代码 → sh/sz 前缀格式 (sh600519 / sz002030) */
function buildPrefixedSymbol(stockCode: string): string {
    const isSH = stockCode.startsWith('6') || stockCode.startsWith('sh');
    if (isSH && !stockCode.startsWith('sh')) return `sh${stockCode}`;
    if (!isSH && !stockCode.startsWith('sz')) return `sz${stockCode}`;
    return stockCode;
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

// ─── 新浪分钟线 (1m / 5m / 15m / 30m / 60m) ────────────────────────────────

async function fetchMinuteFromSina(
    stockCode: string, stockName: string, period: string, onLog: (msg: string) => void
) {
    const sinaScale = SINA_MINUTE_MAP[period];
    const prefixed = buildPrefixedSymbol(stockCode);
    const num = '2000';

    onLog(`  → 请求: symbol=${prefixed}, scale=${sinaScale}, num=${num}`);

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

    // 新浪错误响应早退：{__ERROR: 1, __ERRORMSG: 'Input error'}
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
            // 新浪分钟线字段：day / open / high / low / close / volume
            const time   = item.day ?? item.d ?? item.datetime ?? item[0];
            const open   = parseFloat(item.open ?? item.o ?? item[1]);
            const high   = parseFloat(item.high ?? item.h ?? item[2]);
            const low    = parseFloat(item.low ?? item.l ?? item[3]);
            const close  = parseFloat(item.close ?? item.c ?? item[4]);
            const volume = parseFloat(item.volume ?? item.v ?? item[5] ?? '0');
            return { time, stock_code: stockCode, stock_name: stockName, period, open, high, low, close, volume };
        })
        .filter((r: any) =>
            r.time && !isNaN(r.open) && !isNaN(r.high) && !isNaN(r.low) && !isNaN(r.close)
        );
}

// ─── 腾讯日/周/月线 (1d / 1w / 1M) ─────────────────────────────────────────

async function fetchDailyFromTencent(
    stockCode: string, stockName: string, period: string, onLog: (msg: string) => void
) {
    const tencentPeriod = TENCENT_PERIOD_MAP[period];
    const prefixed = buildPrefixedSymbol(stockCode);
    const num = '1500';

    onLog(`  → 请求: 腾讯fqkline, symbol=${prefixed}, period=${tencentPeriod}, num=${num}`);

    try {
        const res = await CapacitorHttp.request({
            method: 'GET',
            url: 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get',
            params: {
                param: `${prefixed},${tencentPeriod},,,${num},qfq`,
            },
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

    // Response: { code: 0, data: { "sz002030": { qfqday: [...], day: [...] } } }
    if (parsed.code !== undefined && parsed.code !== 0) {
        throw new Error(`腾讯接口返回错误: code=${parsed.code}, msg=${parsed.msg ?? ''}`);
    }

    const symbolData = parsed?.data?.[prefixedSymbol];
    if (!symbolData) return [];

    // 前复权数据 (qfqday/qfqweek/qfqmonth) 优先，否则取原始数据
    const qfqKey = `qfq${tencentPeriod}`;
    const list: any[] = symbolData[qfqKey] ?? symbolData[tencentPeriod] ?? [];

    if (!Array.isArray(list) || list.length === 0) return [];

    // 腾讯 fqkline 字段顺序: [date, open, close, high, low, volume]
    //                         [0]    [1]   [2]    [3]   [4]  [5]
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
