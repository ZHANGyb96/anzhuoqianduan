"use client";
/**
 * useBacktestTaskStore.ts
 *
 * 批量回测任务状态管理
 * ─────────────────────────────────────
 * 移动端 (isCapacitor) 离线路线：
 *  1. 从 StrategyFormValues.stockCodes 取批量品种列表（最多20支）
 *  2. 识别条件中的跨周期需求（conditionPeriod ≠ mainPeriod）
 *  3. 用 getKlinesForStocks() 批量查询主周期数据
 *  4. 对每支品种，按需加载 HTF 数据并通过 mergeCrossPeriodData() 注入 HTF 指标
 *  5. 将条件的 left/right 字段名转为 htf_<period>_<field> 格式（引擎能识别）
 *  6. 调用 runMobileBacktest() 执行回测，写入 store
 */

import { create } from 'zustand';
import type { StrategyFormValues } from '@/app/dashboard/backtest/strategy-builder';
import { API_URL }              from '@/config/constants';
import { useAuthStore }         from './useAuthStore';
import { isCapacitor }          from '@/config/platform';
import {
    runMobileBacktest,
    mergeCrossPeriodData,
    type CrossPeriodMap,
} from '@/utils/mobile-backtest-engine';
import {
    getKlinesForStocks,
    getKlineFromMobileDB,
    getAvailablePeriodsForStock,
} from '@/lib/mobile-db';
import { calculateAllIndicators } from '@/utils/ta-math';

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export type Task = {
    task_id: string;
    user_id: number;
    strategy_name: string;
    strategy_params: any;
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    result_summary: any;
    created_at: string;
    completed_at: string | null;
};

type BacktestTaskState = {
    taskId: string | null;
    task: Task | null;
    isSubmitting: boolean;
    progress: { done: number; total: number } | null;
    error: string | null;
};

type BacktestTaskActions = {
    submitTask: (data: StrategyFormValues) => Promise<void>;
    reset: () => void;
};

const initialState: BacktestTaskState = {
    taskId: null,
    task: null,
    isSubmitting: false,
    progress: null,
    error: null,
};

let pollTimeout: NodeJS.Timeout | null = null;

// ─── Store ───────────────────────────────────────────────────────────────────

export const useBacktestTaskStore = create<BacktestTaskState & BacktestTaskActions>(
    (set, get) => ({
        ...initialState,

        reset: () => {
            if (pollTimeout) clearTimeout(pollTimeout);
            set(initialState);
        },

        submitTask: async (data) => {
            if (get().isSubmitting) return;

            if (!data.conditions || data.conditions.length === 0) {
                set({ error: '请至少添加一个策略条件。' });
                return;
            }

            get().reset();

            // ── 主回测周期 ─────────────────────────────────────────────────
            const mainPeriod = data.period || '1d';

            // ── 批量品种列表（兼容旧版 stockCode 单值） ──────────────────
            const stockCodes: string[] = Array.isArray(data.stockCodes) && data.stockCodes.length > 0
                ? data.stockCodes.slice(0, 20) // 严格限制最多20支
                : (data as any).stockCode ? [(data as any).stockCode] : [];

            if (stockCodes.length === 0) {
                set({ error: '请至少选择1支品种进行回测。' });
                return;
            }

            // ── 检测跨周期需求 ─────────────────────────────────────────────
            const crossPeriods: string[] = [
                ...new Set(
                    data.conditions
                        .filter(c => c.period && c.period !== '' && c.period !== mainPeriod)
                        .map(c => c.period)
                )
            ];

            // ── 构建条件树（统一转 htf_ 前缀格式） ────────────────────────
            const parsedConditions = data.conditions.map(c => {
                // 条件有独立联动周期，且与主周期不同 → 转成 htf 字段名
                const isLinked = c.period && c.period !== '' && c.period !== mainPeriod;
                const prefix = isLinked ? `htf_${c.period}_` : '';

                const leftStr = `${prefix}${c.left}`;
                const rightStr =
                    c.rightType === 'line'
                        ? `${prefix}${c.rightValue}` // 指标线也来自同一联动周期
                        : c.rightValue;

                return {
                    left: leftStr,
                    op:   c.operator,
                    right: c.rightType === 'value' ? Number(c.rightValue) : rightStr,
                };
            });

            const finalConditionTree = {
                logic: data.logic || 'AND',
                conditions: parsedConditions,
            };

            // ====================================================================
            // 📱 移动端离线引擎区
            // ====================================================================
            if (isCapacitor) {
                set({ isSubmitting: true, error: null, taskId: null, progress: null });

                try {
                    // ── 1. 批量加载主周期数据 ──────────────────────────────
                    const primaryMap = await getKlinesForStocks(stockCodes, mainPeriod, 5000);

                    // 检查是否有足够数据
                    const usableStocks = stockCodes.filter(
                        code => (primaryMap[code]?.length ?? 0) >= 50
                    );
                    if (usableStocks.length === 0) {
                        throw new Error(
                            `所选品种在本地均无足够数据（需≥50条）。请先在「数据管理」同步 ${mainPeriod} 数据。`
                        );
                    }

                    // ── 2. 跨周期数据：按需为每支品种加载并注入 HTF 指标 ──
                    const stocksObj: Record<string, any[]> = {};

                    for (const code of usableStocks) {
                        let bars: any[] = primaryMap[code] ?? [];

                        if (crossPeriods.length > 0) {
                            // 依次处理每个联动周期
                            for (const htfPeriod of crossPeriods) {
                                // 检查本地是否有该周期数据（友好提示）
                                const htfRaw = await getKlineFromMobileDB(code, htfPeriod, 3000);

                                if (htfRaw.length < 10) {
                                    console.warn(
                                        `[跨周期] ${code} 的 ${htfPeriod} 数据不足（${htfRaw.length}条），` +
                                        `跨周期条件可能无效。建议先同步该周期数据。`
                                    );
                                    // 不抛出错误，允许降级（条件评估时 HTF 字段为 null → 跳过该信号）
                                } else {
                                    // 计算 HTF 指标后注入到主周期 bars
                                    bars = mergeCrossPeriodData(bars, htfRaw, htfPeriod);
                                }
                            }
                        }

                        stocksObj[code] = bars;
                    }

                    // ── 3. 执行本地回测 ────────────────────────────────────
                    const totalStocks = usableStocks.length;
                    let doneCount = 0;

                    const result = runMobileBacktest(
                        stocksObj,
                        finalConditionTree as any,
                        [3, 6, 9, 12, 15, 18, 24, 30],
                        (done, total) => {
                            doneCount = done;
                            set({ progress: { done, total } });
                        }
                    );

                    const fakeTaskId = `mob_batch_${Date.now()}`;

                    // ── 4. 附加回测元信息 ──────────────────────────────────
                    result.batch_info = {
                        requested:   stockCodes.length,
                        processed:   usableStocks.length,
                        skipped:     stockCodes.length - usableStocks.length,
                        cross_periods: crossPeriods,
                        main_period: mainPeriod,
                    };

                    set({
                        taskId: fakeTaskId,
                        task: {
                            task_id:         fakeTaskId,
                            user_id:         0,
                            status:          'COMPLETED',
                            strategy_name:   `${data.strategyName} (离线批量 ${usableStocks.length}支)`,
                            strategy_params: {
                                ...data,
                                stockCodes:    usableStocks,
                                crossPeriods,
                                mainPeriod,
                            },
                            result_summary:  result,
                            created_at:      new Date().toISOString(),
                            completed_at:    new Date().toISOString(),
                        },
                        isSubmitting: false,
                        progress: { done: totalStocks, total: totalStocks },
                    });

                } catch (e: any) {
                    set({ error: e.message, isSubmitting: false, progress: null });
                }

                return; // 🔥 切断，不走 Web 路线
            }

            // ====================================================================
            // 🌐 Web 云端逻辑（保持原样）
            // ====================================================================
            const token = useAuthStore.getState().token;

            if (!token) {
                set({ error: '用户未登录，无法提交任务。' });
                return;
            }

            set({ isSubmitting: true, error: null });

            // 云端只取第一支（Web 端维持原有单支逻辑）
            const singleStockCode = stockCodes[0] ?? 'ALL';

            try {
                const payload: any = {
                    stockCode:    singleStockCode,
                    period:       mainPeriod,
                    strategyName: data.strategyName,
                    startTime:    data.startTime  || undefined,
                    endTime:      data.endTime    || undefined,
                    conditions:   finalConditionTree,
                };

                const response = await fetch(`${API_URL}/api/v1/backtest/submit`, {
                    method: 'POST',
                    headers: {
                        'Content-Type':  'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify(payload),
                });

                const result = await response.json();

                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) {
                        useAuthStore.getState().logout();
                    }
                    throw new Error(result.message || '提交任务失败');
                }

                set({ taskId: result.taskId });
                pollTask(result.taskId, 0);

            } catch (error: any) {
                const msg = error.message?.includes('Failed to fetch')
                    ? '无法连接后端，请确认服务已启动。'
                    : (error.message || '服务器通信错误。');
                set({ error: msg });
            } finally {
                set({ isSubmitting: false });
            }
        },
    })
);

// ─── Web 端轮询（移动端禁用） ─────────────────────────────────────────────────

async function pollTask(taskId: string, attempt: number) {
    if (isCapacitor) return;

    const token = useAuthStore.getState().token;
    if (!token) return;
    if (useBacktestTaskStore.getState().taskId !== taskId) return;

    try {
        const res = await fetch(`${API_URL}/api/v1/tasks/${taskId}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });

        if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
                useAuthStore.getState().logout();
                return;
            }
            const err = await res.json();
            throw new Error(err.message || '获取任务失败');
        }

        const data: Task = await res.json();
        useBacktestTaskStore.setState({ task: data });

        if (data.status === 'COMPLETED' || data.status === 'FAILED') return;

        const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
        pollTimeout = setTimeout(() => pollTask(taskId, attempt + 1), delay);

    } catch (err: any) {
        useBacktestTaskStore.setState({ error: err.message });
    }
}
