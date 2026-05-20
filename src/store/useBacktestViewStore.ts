"use client";
/**
 * src/store/useBacktestViewStore.ts
 *
 * 持久化回测页面视图层状态（内存级，跨路由导航不丢失）
 * ─────────────────────────────────────────────────────
 * 问题根因：
 *   backtest/page.tsx 原本用 React 本地 useState 管理 viewLayer，
 *   从信号明细跳到图表页 → router.back() 回来时组件重新渲染，
 *   state 重置为 'results'，用户无法回到信号明细层。
 *
 * 解决方案：
 *   改用 Zustand 内存 store，只要 App 未刷新，state 就持续存在，
 *   路由来回切换不会重置视图层。
 */

import { create } from 'zustand';

export type BacktestViewLayer = 'results' | 'filtered-signals';

export type FilterWindow = {
  key:   string;   // e.g. 'c3' | 'm60'
  label: string;   // e.g. '3根K线' | '60分钟'
};

type State = {
  viewLayer:    BacktestViewLayer;
  filterWindow: FilterWindow | undefined;
  activeTab:    'results' | 'signals';
};

type Actions = {
  /** 从统计结果进入筛选信号明细 */
  goToFilteredSignals: (fw: FilterWindow) => void;
  /** 从信号明细返回统计结果 */
  backToResults:       () => void;
  /** 切换 Tab（统计结果 / 信号明细） */
  setActiveTab:        (tab: 'results' | 'signals') => void;
  /** 重置所有状态 */
  reset:               () => void;
};

const initial: State = {
  viewLayer:    'results',
  filterWindow: undefined,
  activeTab:    'results',
};

export const useBacktestViewStore = create<State & Actions>((set) => ({
  ...initial,

  goToFilteredSignals: (fw) => set({
    viewLayer:    'filtered-signals',
    filterWindow: fw,
  }),

  backToResults: () => set({
    viewLayer:    'results',
    filterWindow: undefined,
  }),

  setActiveTab: (activeTab) => set({ activeTab }),

  reset: () => set(initial),
}));
