"use client";
/**
 * useChartNavigationStore.ts
 *
 * 跨页面图表导航意图 Store
 * ─────────────────────────────────────
 * 功能：
 *  当用户在信号明细中点击某条记录时，存储导航目标（品种+周期+时间）
 *  图表页挂载或获得焦点后读取并滚动到对应 K 线
 */

import { create } from 'zustand';

export type ChartNavigationTarget = {
  stockCode: string;
  period:    string;
  time:      string;   // ISO 日期字符串，如 "2024-03-15" 或 "2024-03-15 09:30:00"
};

type ChartNavState = {
  target: ChartNavigationTarget | null;
  setTarget: (t: ChartNavigationTarget) => void;
  clearTarget: () => void;
};

export const useChartNavStore = create<ChartNavState>((set) => ({
  target:      null,
  setTarget:   (t) => set({ target: t }),
  clearTarget: ()  => set({ target: null }),
}));
