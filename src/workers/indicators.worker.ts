// src/workers/indicators.worker.ts
/**
 * 指标计算 Web Worker
 * ─────────────────────────────────────────────────────────────────────────
 * 将 calculateAllIndicators（含 TROC）从主线程迁移到独立 Worker 线程，
 * 彻底消除指标计算时 UI 卡顿问题。
 *
 * 调用方式（在 React 组件或 Zustand store 中）：
 *
 *   const worker = new Worker(
 *     new URL('../workers/indicators.worker.ts', import.meta.url)
 *   );
 *   worker.postMessage({ items: rawKlines, swingMode: 'review' });
 *   worker.onmessage = ({ data }) => {
 *       if (data.type === 'done')    setComputedKlines(data.items);
 *       if (data.type === 'error')   console.error(data.message);
 *       if (data.type === 'progress') setProgress(data.pct);
 *   };
 *   worker.onerror = (e) => console.error('Worker error:', e);
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 消息协议：
 *
 *   主线程 → Worker（postMessage）：
 *   {
 *     items:     KlineItem[]          // 原始 OHLCV 数组
 *     swingMode: 'review' | 'live'   // 摆动点模式
 *   }
 *
 *   Worker → 主线程（postMessage）：
 *   { type: 'done',     items: KlineItem[] }   // 计算完成，带指标的完整数组
 *   { type: 'error',    message: string   }   // 计算出错
 *   { type: 'progress', pct: number       }   // 进度（0~100），预留
 * ─────────────────────────────────────────────────────────────────────────
 */

import { calculateAllIndicators } from '../utils/ta-math';
import type { KlineItem } from '../utils/ta-math';

interface WorkerInput {
    items:     KlineItem[];
    swingMode: 'review' | 'live';
}

self.onmessage = (event: MessageEvent<WorkerInput>) => {
    const { items, swingMode } = event.data;

    if (!Array.isArray(items) || items.length === 0) {
        self.postMessage({ type: 'done', items: [] });
        return;
    }

    try {
        // calculateAllIndicators 原地修改 items 并调用 calculateTROC
        const computed = calculateAllIndicators(items, swingMode);
        self.postMessage({ type: 'done', items: computed });
    } catch (e: any) {
        self.postMessage({ type: 'error', message: e?.message ?? String(e) });
    }
};
