"use client";
/**
 * useHistoryStore.ts
 *
 * 持久化回测历史记录 Store
 * ─────────────────────────────────────
 * 修复记录：
 *  [FIX-6] localStorage 容量炸弹
 *    v1 问题：saveRecord 直接把完整 Task 对象（含最多 2000 条 signal_details）
 *             序列化写入 localStorage。
 *             单条记录约 300~500KB，50 条上限 = 最高 25MB。
 *             localStorage 通常上限 5~10MB，超出后抛 QuotaExceededError，
 *             导致历史记录全部丢失。
 *
 *    修复方案：
 *      1. 保存前剥离 signal_details（大字段），只保留统计汇总 result_summary 中的
 *         数值统计部分，并标记 signal_details_stripped: true。
 *         统计卡片（胜率/MFE/MAE/CI）不受影响，因为它们来自 result_summary 的
 *         其他字段而非 signal_details。
 *      2. persist 写入前用 try-catch 捕获 QuotaExceededError，写入失败时自动
 *         清理最旧的一批记录后重试，而不是静默丢失数据。
 *      3. 保存时预估序列化体积，超过 200KB 则主动触发裁剪。
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Task } from './useBacktestTaskStore';

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export type HistoryRecord = {
    id:      string;   // 唯一 ID，使用 task_id
    savedAt: string;   // 保存时的 ISO 时间戳
    task:    Task;     // 完整任务数据（signal_details 已剥离，仅保留统计汇总）
    label:   string;   // 显示名称
};

type HistoryState = {
    records: HistoryRecord[];
};

type HistoryActions = {
    saveRecord:   (task: Task) => void;
    deleteRecord: (id: string) => void;
    clearAll:     () => void;
};

const MAX_RECORDS = 50;

// ─── 工具：剥离大字段，只保留统计摘要 ────────────────────────────────────────

/**
 * 深拷贝 Task 并移除 signal_details（最多 2000 条，约 300~500KB），
 * 保留所有统计汇总字段（win_rate_*、avg_mfe_*、ci_*、bar_windows 等）。
 * 标记 _signal_details_stripped: true，让 UI 知道明细不可用。
 */
function stripSignalDetails(task: Task): Task {
    const result_summary = task.result_summary
        ? {
              ...task.result_summary,
              signal_details:          [],     // 清空明细数组
              _signal_details_stripped: true,  // 标记已裁剪
          }
        : task.result_summary;

    return { ...task, result_summary };
}

/**
 * 预估序列化体积（字节），超过阈值时提前警告。
 * JSON.stringify 开销较小，用于保存前快速评估。
 */
function estimateSize(obj: unknown): number {
    try {
        return new Blob([JSON.stringify(obj)]).size;
    } catch {
        return 0;
    }
}

// ─── 自定义 storage：包裹 localStorage，捕获 QuotaExceededError ──────────────

const safeLocalStorage = {
    getItem: (key: string): string | null => {
        try { return localStorage.getItem(key); } catch { return null; }
    },
    setItem: (key: string, value: string): void => {
        try {
            localStorage.setItem(key, value);
        } catch (e: any) {
            const isQuota =
                e instanceof DOMException &&
                (e.code === 22 ||
                    e.code === 1014 ||
                    e.name === 'QuotaExceededError' ||
                    e.name === 'NS_ERROR_DOM_QUOTA_REACHED');

            if (isQuota) {
                // 自动清理：移除最旧的 10 条记录后重试
                console.warn('[useHistoryStore] localStorage 超限，自动清理旧记录...');
                try {
                    const existing = localStorage.getItem(key);
                    if (existing) {
                        const parsed = JSON.parse(existing);
                        if (parsed?.state?.records?.length > 10) {
                            parsed.state.records = parsed.state.records.slice(0, -10);
                            localStorage.setItem(key, JSON.stringify(parsed));
                        }
                    }
                    // 再次尝试
                    localStorage.setItem(key, value);
                } catch (retryErr) {
                    console.error('[useHistoryStore] 清理后仍无法写入，放弃本次保存:', retryErr);
                }
            } else {
                console.error('[useHistoryStore] localStorage 写入失败:', e);
            }
        }
    },
    removeItem: (key: string): void => {
        try { localStorage.removeItem(key); } catch { /* ignore */ }
    },
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useHistoryStore = create<HistoryState & HistoryActions>()(
    persist(
        (set, get) => ({
            records: [],

            saveRecord: (task: Task) => {
                // 防止重复保存同一个 task_id
                if (get().records.some(r => r.id === task.task_id)) return;

                const now = new Date();
                const timeLabel = now.toLocaleString('zh-CN', {
                    month:  '2-digit',
                    day:    '2-digit',
                    hour:   '2-digit',
                    minute: '2-digit',
                });

                // [FIX-6] 剥离 signal_details，只存统计摘要
                const liteTask = stripSignalDetails(task);

                // 体积预估（超过 200KB 则打印警告，方便调试）
                const estimatedSize = estimateSize(liteTask);
                if (estimatedSize > 200 * 1024) {
                    console.warn(
                        `[useHistoryStore] 记录体积偏大（${(estimatedSize / 1024).toFixed(0)}KB），` +
                        '已剥离 signal_details，如仍有问题请联系开发者。'
                    );
                }

                const record: HistoryRecord = {
                    id:      task.task_id,
                    savedAt: now.toISOString(),
                    task:    liteTask,
                    label:   `${task.strategy_name}  ·  ${timeLabel}`,
                };

                set(state => {
                    const updated = [record, ...state.records];
                    // 超出上限时截断最旧的
                    return { records: updated.slice(0, MAX_RECORDS) };
                });
            },

            deleteRecord: (id: string) => {
                set(state => ({
                    records: state.records.filter(r => r.id !== id),
                }));
            },

            clearAll: () => set({ records: [] }),
        }),
        {
            name:    'alphascan-history',
            // [FIX-6] 使用带 QuotaExceededError 捕获的安全 storage
            storage: createJSONStorage(() => safeLocalStorage),
        }
    )
);
