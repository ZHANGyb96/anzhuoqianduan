"use client";
/**
 * useHistoryStore.ts
 *
 * 持久化回测历史记录 Store
 * ─────────────────────────────────────
 * 功能：
 *  1. 将每次成功的回测结果保存为 HistoryRecord
 *  2. 支持删除单条记录
 *  3. 通过 zustand persist 自动落盘到 localStorage（跨会话保留）
 *  4. 最多保留 50 条，超限自动淘汰最旧的
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Task } from './useBacktestTaskStore';

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export type HistoryRecord = {
  id: string;           // 唯一 ID，使用 task_id
  savedAt: string;      // 保存时的 ISO 时间戳
  task: Task;           // 完整的任务数据（含 result_summary）
  label: string;        // 显示名称（strategy_name + 时间）
};

type HistoryState = {
  records: HistoryRecord[];
};

type HistoryActions = {
  /** 将一次已完成的回测保存到历史 */
  saveRecord: (task: Task) => void;
  /** 删除单条历史记录 */
  deleteRecord: (id: string) => void;
  /** 清空所有历史 */
  clearAll: () => void;
};

const MAX_RECORDS = 50;

// ─── Store ───────────────────────────────────────────────────────────────────

export const useHistoryStore = create<HistoryState & HistoryActions>()(
  persist(
    (set, get) => ({
      records: [],

      saveRecord: (task) => {
        // 防止重复保存同一个 task_id
        if (get().records.some(r => r.id === task.task_id)) return;

        const now = new Date();
        const timeLabel = now.toLocaleString('zh-CN', {
          month:  '2-digit',
          day:    '2-digit',
          hour:   '2-digit',
          minute: '2-digit',
        });

        const record: HistoryRecord = {
          id:      task.task_id,
          savedAt: now.toISOString(),
          task,
          label:   `${task.strategy_name}  ·  ${timeLabel}`,
        };

        set(state => {
          const updated = [record, ...state.records];
          // 超出上限时截断最旧的
          return { records: updated.slice(0, MAX_RECORDS) };
        });
      },

      deleteRecord: (id) => {
        set(state => ({
          records: state.records.filter(r => r.id !== id),
        }));
      },

      clearAll: () => set({ records: [] }),
    }),
    {
      name:    'alphascan-history',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
