// src/hooks/useIndicatorWorker.ts
/**
 * useIndicatorWorker
 * ─────────────────────────────────────────────────────────────────────────
 * React Hook，封装 indicators.worker.ts 的调用。
 *
 * 用法（在 chart-view.tsx 或任何需要指标数据的组件里替换原有的同步计算调用）：
 *
 *   const { computedItems, isComputing } = useIndicatorWorker(rawKlines, 'review');
 *
 *   return isComputing
 *     ? <ChartSkeleton />
 *     : <KlineChart items={computedItems} />;
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 特性：
 *   - Worker 实例在组件卸载时自动 terminate()，无内存泄漏
 *   - rawKlines 引用变化时自动重新计算（通过 useEffect 依赖）
 *   - 计算期间 isComputing = true，可用于显示骨架屏
 *   - 错误信息通过 error 返回，不抛出
 */

import { useState, useEffect, useRef } from 'react';
import type { KlineItem } from '../utils/ta-math';

interface UseIndicatorWorkerResult {
    computedItems: KlineItem[];
    isComputing:   boolean;
    error:         string | null;
}

export function useIndicatorWorker(
    rawItems:  KlineItem[] | null | undefined,
    swingMode: 'review' | 'live' = 'review',
): UseIndicatorWorkerResult {
    const [computedItems, setComputedItems] = useState<KlineItem[]>([]);
    const [isComputing,   setIsComputing]   = useState(false);
    const [error,         setError]         = useState<string | null>(null);

    // 持有 Worker 引用，避免重复创建
    const workerRef = useRef<Worker | null>(null);

    useEffect(() => {
        if (!rawItems || rawItems.length === 0) {
            setComputedItems([]);
            setIsComputing(false);
            return;
        }

        // 终止上一个未完成的 Worker（切换品种时）
        if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
        }

        setIsComputing(true);
        setError(null);

        const worker = new Worker(
            new URL('../workers/indicators.worker.ts', import.meta.url),
            { type: 'module' },
        );
        workerRef.current = worker;

        worker.onmessage = ({ data }) => {
            if (data.type === 'done') {
                setComputedItems(data.items);
                setIsComputing(false);
            } else if (data.type === 'error') {
                setError(data.message ?? '指标计算失败');
                setIsComputing(false);
            }
        };

        worker.onerror = (e) => {
            setError(e.message ?? 'Worker 未知错误');
            setIsComputing(false);
        };

        // 发送计算任务（structuredClone 在 Worker 边界自动深拷贝）
        worker.postMessage({ items: rawItems, swingMode });

        return () => {
            worker.terminate();
            workerRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rawItems, swingMode]);

    return { computedItems, isComputing, error };
}
