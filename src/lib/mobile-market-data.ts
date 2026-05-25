// src/lib/mobile-market-data.ts
/**
 * 行情数据同步模块
 *
 * ════════════════════════════════════════════════════════════════
 * 分钟线：完全照搬 Python akshare stock_zh_a_minute 实现
 * ════════════════════════════════════════════════════════════════
 *
 * Python 源码（akshare stock_zh_a_minute，经实测可获取 2 年 60m 数据）：
 *
 *   url = "https://quotes.sina.cn/cn/api/jsonp_v2.php/=/CN_MarketDataService.getKLineData"
 *   params = {"symbol": symbol, "scale": period, "ma": "no", "datelen": "1970"}
 *   r = requests.get(url, params=params)
 *   data_json = json.loads(r.text.split("=(")[1].split(");")[0])
 *
 *   备用URL:
 *   url = f"https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_{symbol}_{period}_1658852984203=/..."
 *
 * 数据量（datelen=1970，服务端上限）：
 *   60m ÷ 4根/天  = ~492 交易日 ≈ 2年   ← Python 实测结果
 *   30m ÷ 8根/天  = ~246 交易日 ≈ 1年
 *   15m ÷ 16根/天 = ~123 交易日 ≈ 6个月
 *   5m  ÷ 48根/天 = ~41  交易日 ≈ 2个月
 *   1m  ÷ 240根/天= ~8   交易日
 *
 * JSONP 响应格式：=([{"day":"...","open":"...","high":"...","low":"...","close":"...","volume":"..."},...]);
 * 字段顺序：day, open, high, low, close, volume（标准 OHLCV，注意 high 在 low 之前）
 *
 * ════════════════════════════════════════════════════════════════
 * 日/周/月线：腾讯 fqkline + startdate=1990-01-01（完整历史）
 * ════════════════════════════════════════════════════════════════
 *
 * 腾讯 fqkline param 格式：symbol,period,startdate,enddate,count,adjustflag
 *   日线: sz002030,day,1990-01-01,,9000,qfq → IPO 至今完整 20+ 年
 *   周线: sz002030,week,1990-01-01,,2000,qfq
 *   月线: sz002030,month,1990-01-01,,500,qfq
 *
 * ════════════════════════════════════════════════════════════════
 * 其他改进（借鉴 Python fetch_stock_data.py）：
 *   withRetry：3次重试 + 指数退避
 *   cleanRows：ffill补空 + volume补0 + 涨跌>20%异常K线过滤
 *   _doResample：交易日感知分组，防止跨日合成假K线
 *   [FIX-10] buildPrefixedSymbol：北交所 bj 前缀
 *   [FIX-11] 120m/240m 本地合成
 * ════════════════════════════════════════════════════════════════
 */

import { CapacitorHttp } from '@capacitor/core';
import { bulkInsertKlines, getKlinesForStocks } from './mobile-db';

// ── 新浪分钟线 scale 映射 ─────────────────────────────────────────
const SINA_SCALE_MAP: Record<string, string> = {
    '1m':  '1',
    '5m':  '5',
    '15m': '15',
    '30m': '30',
    '60m': '60',
};

// ── 腾讯日/周/月线 period 映射 ────────────────────────────────────
const TENCENT_PERIOD_MAP: Record<string, string> = {
    '1d': 'day',
    '1w': 'week',
    '1M': 'month',
};

// ── 腾讯最大请求量（配合 startdate=1990-01-01 覆盖完整历史）──────────
const TENCENT_MAX_NUM: Record<string, string> = {
    '1d': '9000',   // 35年 × 250 ≈ 8750 → 9000
    '1w': '2000',   // 35年 × 52  ≈ 1820 → 2000
    '1M': '500',    // 35年 × 12  ≈  420 →  500
};

const TENCENT_START_DATE = '1990-01-01';

// ── 合成周期 ──────────────────────────────────────────────────────
const RESAMPLE_MAP: Record<string, { from: string; ratio: number }> = {
    '120m': { from: '60m', ratio: 2 },
    '240m': { from: '60m', ratio: 4 },
};

// ════════════════════════════════════════════════════════════════
//  重试（对标 Python retry_request）
// ════════════════════════════════════════════════════════════════

async function withRetry<T>(
    fn: () => Promise<T>,
    retries = 3,
    baseMs  = 2000,
    onLog?: (msg: string) => void,
): Promise<T> {
    let last: unknown;
    for (let i = 0; i < retries; i++) {
        try { return await fn(); } catch (e) {
            last = e;
            if (i < retries - 1) {
                const w = baseMs * (i + 1);
                onLog?.(`  ⚠ 第${i + 1}次失败，${w / 1000}s 后重试...`);
                await new Promise(r => setTimeout(r, w));
            }
        }
    }
    throw last;
}

// ════════════════════════════════════════════════════════════════
//  数据清洗（对标 Python clean_ohlcv）
// ════════════════════════════════════════════════════════════════

function cleanRows(rows: any[]): any[] {
    if (rows.length === 0) return rows;
    rows.sort((a, b) => (String(a.time) < String(b.time) ? -1 : 1));

    // ffill + volume 补零
    let prev = rows[0].close;
    for (const r of rows) {
        if (r.close == null || isNaN(r.close)) r.close = prev;
        else prev = r.close;
        if (r.open   == null || isNaN(r.open))   r.open   = r.close;
        if (r.high   == null || isNaN(r.high))   r.high   = r.close;
        if (r.low    == null || isNaN(r.low))    r.low    = r.close;
        if (r.volume == null || isNaN(r.volume)) r.volume = 0;
    }

    // 过滤单根涨跌幅 > 20% 的异常 K 线（对标 Python pct_change().abs() < 0.2）
    const out: any[] = [rows[0]];
    for (let i = 1; i < rows.length; i++) {
        const p = out[out.length - 1];
        if (p.close > 0 && Math.abs((rows[i].close - p.close) / p.close) >= 0.20) continue;
        out.push(rows[i]);
    }
    return out;
}

// ════════════════════════════════════════════════════════════════
//  主入口
// ════════════════════════════════════════════════════════════════

export async function syncStockToMobile(
    stockCode: string,
    stockName: string,
    period:    string,
    onLog:     (msg: string) => void,
) {
    onLog(`[系统] 启动同步 ${stockName || stockCode} (${period})...`);

    if (SINA_SCALE_MAP[period]) {
        await fetchMinuteFromSina(stockCode, stockName, period, onLog);
    } else if (TENCENT_PERIOD_MAP[period]) {
        await fetchDailyFromTencent(stockCode, stockName, period, onLog);
    } else if (RESAMPLE_MAP[period]) {
        await resampleFromLocal(stockCode, stockName, period, onLog);
    } else {
        onLog(`✗ 不支持的周期: ${period}（支持: 1m/5m/15m/30m/60m/1d/1w/1M/120m/240m）`);
    }
}

// ════════════════════════════════════════════════════════════════
//  工具
// ════════════════════════════════════════════════════════════════

/**
 * [FIX-10] 股票代码 → 带交易所前缀
 *   上交所 6开头 → sh；北交所 43/83/8开头 → bj；其余 → sz
 */
function buildPrefixedSymbol(code: string): string {
    if (code.startsWith('sh') || code.startsWith('sz') || code.startsWith('bj')) return code;
    if (code.startsWith('6')) return `sh${code}`;
    if (code.startsWith('43') || code.startsWith('83') || code.startsWith('8')) return `bj${code}`;
    return `sz${code}`;
}

function logPreview(data: any, onLog: (msg: string) => void) {
    if (data == null) return;
    const s = typeof data === 'string' ? data : JSON.stringify(data);
    onLog(`  → 响应预览: ${s.slice(0, 160)}`);
}

// ════════════════════════════════════════════════════════════════
//  新浪分钟线 — 完全照搬 Python akshare stock_zh_a_minute
// ════════════════════════════════════════════════════════════════

/**
 * 完全照搬 Python akshare stock_zh_a_minute 的请求和解析逻辑：
 *
 *   Python:
 *     url    = "https://quotes.sina.cn/cn/api/jsonp_v2.php/=/CN_MarketDataService.getKLineData"
 *     params = {"symbol": symbol, "scale": period, "ma": "no", "datelen": "1970"}
 *     data   = json.loads(r.text.split("=(")[1].split(");")[0])
 *
 *   TypeScript（本函数）：
 *     URL 完全相同
 *     参数完全相同：symbol / scale / ma='no' / datelen='1970'
 *     解析完全相同：找 "=(" 切割，找 ");" 切割
 *
 * Python 实测：60m 约 492 交易日（2年），30m 约 246 天（1年）
 *
 * CapacitorHttp 注意事项：
 *   Sina 返回 Content-Type: application/javascript，CapacitorHttp 会以字符串返回 res.data。
 *   若 CapacitorHttp 在某些版本中自动解析为数组，parseJsonp 已做兼容处理。
 */
async function fetchMinuteFromSina(
    stockCode: string,
    stockName: string,
    period:    string,
    onLog:     (msg: string) => void,
) {
    const scale    = SINA_SCALE_MAP[period];
    const prefixed = buildPrefixedSymbol(stockCode);

    // 预期覆盖范围提示（与 Python 相同的 datelen=1970）
    const barsPerDay: Record<string, number> = { '1': 240, '5': 48, '15': 16, '30': 8, '60': 4 };
    const days = Math.round(1970 / (barsPerDay[scale] ?? 4));
    onLog(`  → 新浪分钟 ${prefixed} scale=${scale}，datelen=1970`);
    onLog(`  ℹ 预期约 1970 根，覆盖约 ${days} 个交易日（60m≈2年 30m≈1年 15m≈6月）`);

    if (prefixed.startsWith('bj'))
        onLog(`  ⚠ 北交所品种：新浪接口数据支持有限，可能返回空。`);

    // ── 主 URL（与 Python 完全一致）────────────────────────────────
    const urlMain = 'https://quotes.sina.cn/cn/api/jsonp_v2.php/=/CN_MarketDataService.getKLineData';
    // ── 备用 URL（与 Python except 分支完全一致）────────────────────
    const urlFallback = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_${prefixed}_${scale}_1658852984203=/CN_MarketDataService.getKLineData`;
    // ── 参数（与 Python 完全一致）───────────────────────────────────
    const params = { symbol: prefixed, scale, ma: 'no', datelen: '1970' };

    let parsedArr: any[] | null = null;

    for (const [label, url] of [['主URL', urlMain], ['备用URL', urlFallback]]) {
        try {
            const res = await withRetry(
                () => CapacitorHttp.request({ method: 'GET', url, params }),
                3, 2000, onLog,
            );
            onLog(`  → HTTP ${res.status} [${label}], 类型=${typeof res.data}`);
            logPreview(res.data, onLog);

            parsedArr = parseJsonp(res.data, prefixed, scale);

            if (parsedArr && parsedArr.length > 0) {
                onLog(`  → JSONP 解析成功，${parsedArr.length} 条`);
                break;
            }
            onLog(`  → 解析为空，尝试${label === '主URL' ? '备用URL' : '放弃'}...`);
        } catch (e: any) {
            onLog(`  ⚠ ${label}请求失败: ${e?.message ?? e}`);
        }
    }

    if (!parsedArr || parsedArr.length === 0) {
        onLog(`⚠ [无数据] 两个 URL 均返回空（可能退市或停牌）。`);
        return;
    }

    // 字段映射：Python: day,open,high,low,close,volume（标准 OHLCV 顺序）
    const raw = parsedArr
        .map((item: any) => ({
            time:       item.day    ?? item.d ?? item.datetime,
            stock_code: stockCode,
            stock_name: stockName,
            period,
            open:   parseFloat(item.open   ?? item.o),
            high:   parseFloat(item.high   ?? item.h),   // high 在 low 之前
            low:    parseFloat(item.low    ?? item.l),
            close:  parseFloat(item.close  ?? item.c),
            volume: parseFloat(item.volume ?? item.v ?? '0'),
        }))
        .filter((r: any) =>
            r.time && !isNaN(r.open) && !isNaN(r.high) && !isNaN(r.low) && !isNaN(r.close)
        );

    const rows = cleanRows(raw);

    if (rows.length > 0) {
        await bulkInsertKlines(rows);
        onLog(`✓ [写入] ${rows.length} 根 ${period} 落库`
            + `（${rows[0]?.time} → ${rows[rows.length - 1]?.time}）`);
    } else {
        onLog(`⚠ 数据清洗后为空，跳过写库。`);
    }
}

/**
 * JSONP 响应解析
 *
 * 完全照搬 Python 解析方式：
 *   Python: json.loads(r.text.split("=(")[1].split(");")[0])
 *
 * 兼容以下响应格式：
 *   格式1（主URL）:   =([{...},...]);
 *   格式2（备用URL）:  var _sz002030_60_xxx=([{...},...]);
 *   格式3（CapacitorHttp 自动解析）: 已是数组/对象
 */
function parseJsonp(data: any, symbol: string, scale: string): any[] | null {
    // CapacitorHttp 在某些情况下会自动将响应解析为 JS 对象/数组
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
        if (Array.isArray(data.result)) return data.result;
        // 某些版本可能返回 {data: [...]}
        if (Array.isArray(data.data)) return data.data;
        return null;
    }

    if (typeof data !== 'string' || !data.trim()) return null;

    const text = data.trim();

    // ── 照搬 Python: split("=(")[1].split(");")[0] ─────────────────
    const splitIdx = text.indexOf('=(');
    if (splitIdx !== -1) {
        try {
            // Python 精确方式：找第一个 "=("，然后找最后一个 ");"
            const inner  = text.slice(splitIdx + 2);
            const endIdx = inner.lastIndexOf(');');
            const jsonStr = endIdx !== -1 ? inner.slice(0, endIdx) : inner;
            const parsed  = JSON.parse(jsonStr);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        } catch { /* fallthrough */ }
    }

    // ── 备用正则兜底 ────────────────────────────────────────────────
    const m = text.match(/=\(([\s\S]+?)\);?\s*$/);
    if (m) {
        try {
            const parsed = JSON.parse(m[1]);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        } catch { /* */ }
    }

    return null;
}

// ════════════════════════════════════════════════════════════════
//  腾讯日/周/月线（startdate=1990-01-01，覆盖完整上市历史）
// ════════════════════════════════════════════════════════════════

async function fetchDailyFromTencent(
    stockCode: string,
    stockName: string,
    period:    string,
    onLog:     (msg: string) => void,
) {
    const tencentPeriod = TENCENT_PERIOD_MAP[period];
    const prefixed      = buildPrefixedSymbol(stockCode);
    const num           = TENCENT_MAX_NUM[period] ?? '9000';
    // startdate=1990-01-01：腾讯服务端自动从该股实际 IPO 日起返回
    const paramStr      = `${prefixed},${tencentPeriod},${TENCENT_START_DATE},,${num},qfq`;

    onLog(`  → 腾讯fqkline: ${paramStr}`);
    onLog(`  ℹ 最多 ${num} 根，从1990年（实际从IPO日）起全量返回`);

    if (prefixed.startsWith('bj'))
        onLog(`  ⚠ 北交所品种：腾讯 fqkline 对北交所支持有限。`);

    const res = await withRetry(
        () => CapacitorHttp.request({
            method: 'GET',
            url:    'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get',
            params: { param: paramStr },
        }),
        3, 2000, onLog,
    );

    onLog(`  → HTTP ${res.status}`);
    logPreview(res.data, onLog);

    const raw  = parseTencentData(res.data, stockCode, stockName, period, prefixed, tencentPeriod);
    const rows = cleanRows(raw);

    if (rows.length > 0) {
        await bulkInsertKlines(rows);
        onLog(`✓ [写入] ${rows.length} 根 ${period} 落库`
            + `（${rows[0]?.time} → ${rows[rows.length - 1]?.time}）`);
    } else {
        onLog(`⚠ 腾讯接口返回为空 (${tencentPeriod}).`);
    }
}

function parseTencentData(
    data: any, stockCode: string, stockName: string,
    period: string, prefixedSymbol: string, tencentPeriod: string,
): any[] {
    if (!data) return [];
    let parsed = data;
    if (typeof data === 'string') { try { parsed = JSON.parse(data); } catch { return []; } }
    if (parsed.code != null && parsed.code !== 0)
        throw new Error(`腾讯接口错误: code=${parsed.code}, msg=${parsed.msg ?? ''}`);

    const symbolData = parsed?.data?.[prefixedSymbol];
    if (!symbolData) return [];

    // 腾讯 fqkline 字段顺序: [date, open, close, high, low, volume]
    const list: any[] = symbolData[`qfq${tencentPeriod}`] ?? symbolData[tencentPeriod] ?? [];
    if (!Array.isArray(list) || list.length === 0) return [];

    return list
        .map((item: any) => {
            if (!Array.isArray(item) || item.length < 5) return null;
            return {
                time:       item[0],
                stock_code: stockCode,
                stock_name: stockName,
                period,
                open:   parseFloat(item[1]),
                close:  parseFloat(item[2]),
                high:   parseFloat(item[3]),
                low:    parseFloat(item[4]),
                volume: parseFloat(item[5] ?? '0'),
            };
        })
        .filter((r: any): r is NonNullable<typeof r> =>
            r !== null && r.time && !isNaN(r.open) && !isNaN(r.high) && !isNaN(r.low) && !isNaN(r.close)
        );
}

// ════════════════════════════════════════════════════════════════
//  [FIX-11] 120m / 240m 本地合成（交易日感知分组）
// ════════════════════════════════════════════════════════════════

async function resampleFromLocal(
    stockCode: string,
    stockName: string,
    period:    string,
    onLog:     (msg: string) => void,
) {
    const { from: src, ratio } = RESAMPLE_MAP[period]!;
    onLog(`  → ${period} = 本地 ${src} × ${ratio}，读取全部数据（不限行数）...`);

    const local = await getKlinesForStocks([stockCode], src, 999999);
    let rows    = local[stockCode] ?? [];

    if (rows.length === 0) {
        onLog(`  ⚠ 本地无 ${src}，先同步 ${src}...`);
        await fetchMinuteFromSina(stockCode, stockName, src, onLog);
        const refetched = await getKlinesForStocks([stockCode], src, 999999);
        rows = refetched[stockCode] ?? [];
        if (rows.length === 0) { onLog(`✗ 拉取 ${src} 失败，无法合成 ${period}。`); return; }
    }

    onLog(`  → 本地 ${rows.length} 根 ${src}，合成 ${period}...`);
    await _doResample(rows, stockCode, stockName, period, ratio, onLog);
}

/**
 * 交易日感知分组合成（防止跨日产生假K线）
 *   120m (ratio=2): 按日期分组，前2根=上午场，后2根=下午场，每天出2根
 *   240m (ratio=4): 整天4根合1根，不足4根跳过
 */
async function _doResample(
    sourceRows: any[], stockCode: string, stockName: string,
    period: string, ratio: number, onLog: (msg: string) => void,
) {
    const sorted = [...sourceRows].sort((a, b) =>
        String(a.time) < String(b.time) ? -1 : 1
    );

    // 按日期分组（取 time 前10位 "YYYY-MM-DD"）
    const byDate = new Map<string, typeof sorted>();
    for (const row of sorted) {
        const k = String(row.time).slice(0, 10);
        if (!byDate.has(k)) byDate.set(k, []);
        byDate.get(k)!.push(row);
    }

    const merged: any[] = [];
    for (const [, dayBars] of byDate) {
        if (ratio === 2) {
            for (let i = 0; i + 1 < dayBars.length; i += 2) {
                const b = _buildBar(dayBars.slice(i, i + 2), stockCode, stockName, period);
                if (b) merged.push(b);
            }
        } else if (ratio === 4) {
            if (dayBars.length >= 4) {
                const b = _buildBar(dayBars.slice(0, 4), stockCode, stockName, period);
                if (b) merged.push(b);
            }
        } else {
            for (let i = 0; i + ratio - 1 < dayBars.length; i += ratio) {
                const b = _buildBar(dayBars.slice(i, i + ratio), stockCode, stockName, period);
                if (b) merged.push(b);
            }
        }
    }

    if (merged.length === 0) { onLog(`⚠ 合成结果为空。`); return; }
    await bulkInsertKlines(merged);
    onLog(`✓ [合成] ${merged.length} 根 ${period} 落库`
        + `（来源 ${sorted.length} 根 ${RESAMPLE_MAP[period]!.from}）`);
}

function _buildBar(
    group: any[], stockCode: string, stockName: string, period: string,
): any | null {
    const open   = group[0].open;
    const close  = group[group.length - 1].close;
    const high   = group.reduce((m, r) => Math.max(m, r.high),  -Infinity);
    const low    = group.reduce((m, r) => Math.min(m, r.low),    Infinity);
    const volume = group.reduce((s, r) => s + (r.volume ?? 0),   0);
    if (isNaN(open) || isNaN(close) || isNaN(high) || isNaN(low)) return null;
    return {
        time:       group[0].time,
        stock_code: stockCode,
        stock_name: stockName,
        period,
        open, high, low, close, volume,
    };
}
