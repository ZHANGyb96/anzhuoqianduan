// src/lib/mobile-db.ts
/**
 * 本地 SQLite 数据库操作层 (Capacitor Android)
 * ─────────────────────────────────────────────
 * 新增：
 *  - getKlinesForStocks()  批量查询多支品种，单次SQL IN子句，避免N次串行IO
 *  - getAvailablePeriodsForStock()  查询某支品种在本地有哪些可用周期
 */

import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite'

let dbInstance: SQLiteDBConnection | null = null

export async function getMobileDB(): Promise<SQLiteDBConnection> {
    if (dbInstance) return dbInstance

    const sqlite = new SQLiteConnection(CapacitorSQLite)

    try {
        const db = await sqlite.createConnection(
            'alphascan_local_v2',
            false,
            'no-encryption',
            1,
            false
        )
        await db.open()

        // 建表 + 索引
        await db.execute(`
            CREATE TABLE IF NOT EXISTS kline_metrics (
                time TEXT NOT NULL,
                stock_code TEXT NOT NULL,
                stock_name TEXT,
                period TEXT NOT NULL,
                open REAL, high REAL, low REAL, close REAL, volume REAL,
                PRIMARY KEY (time, stock_code, period)
            );
            CREATE INDEX IF NOT EXISTS idx_kline ON kline_metrics(stock_code, period);
            CREATE INDEX IF NOT EXISTS idx_time  ON kline_metrics(time);
        `)

        dbInstance = db
        return db
    } catch (e) {
        console.error('本地 SQLite 初始化失败:', e)
        throw e
    }
}

// ─── 单品种查询（图表 / 单只回测） ────────────────────────────────────────────

export async function getKlineFromMobileDB(
    stockCode: string,
    period: string,
    limit = 5000
): Promise<any[]> {
    try {
        const db = await getMobileDB()
        let query  = ''
        let params: any[] = []

        if (!stockCode || stockCode === 'ALL') {
            query  = `SELECT * FROM kline_metrics WHERE period = ? ORDER BY time DESC LIMIT ?`
            params = [period, limit]
        } else {
            query  = `SELECT * FROM kline_metrics WHERE stock_code = ? AND period = ? ORDER BY time DESC LIMIT ?`
            params = [stockCode, period, limit]
        }

        const res = await db.query(query, params)
        return res.values ?? []
    } catch (error) {
        console.error('从本地 SQLite 读取失败:', error)
        return []
    }
}

// ─── 批量多品种查询（批量回测专用） ──────────────────────────────────────────

/**
 * 一次SQL查询批量取出多支品种的K线数据，分组后返回
 * 避免逐支串行查询导致的性能问题
 *
 * @param stockCodes  品种代码列表（最多20支）
 * @param period      周期（如 '1d', '60m'）
 * @param limit       每支品种最多取多少根（default 5000）
 * @returns           Record<stockCode, rows[]>
 */
export async function getKlinesForStocks(
    stockCodes: string[],
    period: string,
    limit = 5000
): Promise<Record<string, any[]>> {
    if (stockCodes.length === 0) return {}

    const result: Record<string, any[]> = {}
    stockCodes.forEach(code => { result[code] = [] })

    try {
        const db = await getMobileDB()

        // SQLite IN 子句，一次查完所有品种
        // 为每支品种限制行数：用 UNION ALL + 子查询（SQLite支持）
        // 但 SQLite 不支持 LIMIT per-group，改用 ROW_NUMBER（SQLite 3.25+）
        // 安卓端 SQLite 版本可能偏旧，最保险的做法是分批查询（品种数≤20，IO开销可控）
        //
        // 折中方案：单次查 IN 所有品种，再在 JS 里 groupBy + slice
        const placeholders = stockCodes.map(() => '?').join(',')
        const query = `
            SELECT * FROM kline_metrics
            WHERE stock_code IN (${placeholders})
              AND period = ?
            ORDER BY stock_code, time DESC
        `
        const params = [...stockCodes, period]
        const res = await db.query(query, params)
        const rows: any[] = res.values ?? []

        // JS 端分组 + 截断
        for (const row of rows) {
            const code = row.stock_code
            if (!result[code]) continue
            if (result[code].length < limit) {
                result[code].push(row)
            }
        }

        return result
    } catch (error) {
        console.error('批量读取本地 SQLite 失败:', error)
        return result
    }
}

/**
 * 查询某支品种本地已存在哪些周期的数据
 * 用于跨周期回测前的前置校验
 */
export async function getAvailablePeriodsForStock(stockCode: string): Promise<string[]> {
    try {
        const db = await getMobileDB()
        const res = await db.query(
            `SELECT DISTINCT period FROM kline_metrics WHERE stock_code = ? ORDER BY period`,
            [stockCode]
        )
        return (res.values ?? []).map((r: any) => r.period as string)
    } catch (e) {
        return []
    }
}

// ─── 批量增量写入（下载行情使用） ─────────────────────────────────────────────

export async function bulkInsertKlines(rows: any[]) {
    if (!rows.length) return
    const db = await getMobileDB()
    const BATCH = 500

    // ✅ 传入 transaction=false：禁用 Capacitor SQLite 的自动事务包装，
    //    避免 "cannot start a transaction within a transaction" 嵌套崩溃
    await db.execute('BEGIN TRANSACTION;', false)
    try {
        for (let i = 0; i < rows.length; i += BATCH) {
            const batch = rows.slice(i, i + BATCH)
            const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?)').join(',')
            const values = batch.flatMap(r => [
                r.time, r.stock_code, r.stock_name ?? '', r.period,
                r.open, r.high, r.low, r.close, r.volume
            ])
            await db.run(
                `INSERT OR REPLACE INTO kline_metrics
                 (time,stock_code,stock_name,period,open,high,low,close,volume)
                 VALUES ${placeholders}`,
                values,
                false  // ✅ 不自动包装事务（已在手动事务中）
            )
        }
        await db.execute('COMMIT;', false)
    } catch (e) {
        await db.execute('ROLLBACK;', false)
        throw e
    }
}
