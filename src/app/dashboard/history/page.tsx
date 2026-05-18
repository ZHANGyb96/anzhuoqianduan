'use client';

/**
 * src/app/dashboard/history/page.tsx
 *
 * 历史记录页面
 * ─────────────────────────────────────
 * 功能：
 *  1. 列出所有已保存的回测历史记录（含删除按钮）
 *  2. 点击某条记录 → 查看其统计结果（与回测结果页完全相同的 BacktestResults）
 *  3. 点击统计卡片 → 进入筛选信号明细（FilteredSignalDetails）
 *  4. 点击信号行 → 跳转到图表页对应 K 线
 *  5. 每个层级均有返回键
 */

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useHistoryStore, type HistoryRecord } from '@/store/useHistoryStore';
import { useChartNavStore } from '@/store/useChartNavigationStore';
import BacktestResults from '@/app/dashboard/backtest/backtest-results';
import SignalDetails, { type FilterWindow } from '@/app/dashboard/backtest/signal-details';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  History, Trash2, ChevronLeft, ChevronRight,
  BarChart2, Calendar, Database,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── 视图层 ─────────────────────────────────────────────────────────────────

type ViewLayer = 'list' | 'record-results' | 'filtered-signals';

// ─── 单条历史条目 ─────────────────────────────────────────────────────────────

function HistoryItem({
  record,
  onView,
  onDelete,
}: {
  record: HistoryRecord;
  onView: () => void;
  onDelete: () => void;
}) {
  const result  = record.task.result_summary;
  const signals = result?.total_signals ?? 0;
  const stocks  = result?.stocks_with_data ?? 0;
  const period  = result?.main_period ?? record.task.strategy_params?.period ?? '1d';

  const periodLabel: Record<string, string> = {
    '1d': '日线', '1w': '周线', '1M': '月线',
    '1m': '1分', '5m': '5分', '15m': '15分',
    '30m': '30分', '60m': '60分', '120m': '2时', '240m': '4时',
  };

  const savedTime = new Date(record.savedAt).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="relative rounded-2xl bg-[#1e2128] border border-white/8 overflow-hidden">
      {/* 点击区域（查看结果） */}
      <button
        onClick={onView}
        className="w-full text-left p-4 pr-14 hover:bg-white/3 active:bg-white/5 transition-colors"
      >
        {/* 策略名 */}
        <p className="text-sm font-semibold text-foreground leading-tight line-clamp-1">
          {record.task.strategy_name}
        </p>

        {/* 元信息行 */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0.5">
            <Calendar className="h-2.5 w-2.5" />
            {savedTime}
          </Badge>
          <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0.5">
            <BarChart2 className="h-2.5 w-2.5" />
            {periodLabel[period] ?? period}
          </Badge>
          <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0.5">
            <Database className="h-2.5 w-2.5" />
            {signals} 信号 · {stocks} 品种
          </Badge>
        </div>
      </button>

      {/* 右侧：查看 + 删除 按钮组 */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-1.5">
        <button
          onClick={onView}
          className="flex items-center justify-center h-8 w-8 rounded-lg
                     bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
          title="查看结果"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              className="flex items-center justify-center h-8 w-8 rounded-lg
                         bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors"
              title="删除记录"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除？</AlertDialogTitle>
              <AlertDialogDescription>
                将删除「{record.task.strategy_name}」的历史记录，此操作无法撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={onDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

// ─── 主页面 ─────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const { records, deleteRecord, clearAll } = useHistoryStore();
  const setChartTarget = useChartNavStore(s => s.setTarget);
  const router = useRouter();

  // ── 视图层状态 ────────────────────────────────────────────────────────
  const [viewLayer,    setViewLayer]    = useState<ViewLayer>('list');
  const [activeRecord, setActiveRecord] = useState<HistoryRecord | null>(null);
  const [filterWindow, setFilterWindow] = useState<FilterWindow | undefined>(undefined);

  // ── 点击某条记录 → 查看其统计结果 ────────────────────────────────────
  const handleViewRecord = useCallback((record: HistoryRecord) => {
    setActiveRecord(record);
    setViewLayer('record-results');
  }, []);

  // ── 从统计结果点击某个窗口卡片 → 进入筛选信号明细 ─────────────────────
  const handleWindowClick = useCallback((windowKey: string, windowLabel: string) => {
    setFilterWindow({ key: windowKey, label: windowLabel });
    setViewLayer('filtered-signals');
  }, []);

  // ── 从筛选信号明细返回到统计结果 ──────────────────────────────────────
  const handleBackToResults = useCallback(() => {
    setViewLayer('record-results');
    setFilterWindow(undefined);
  }, []);

  // ── 从统计结果返回到列表 ───────────────────────────────────────────────
  const handleBackToList = useCallback(() => {
    setViewLayer('list');
    setActiveRecord(null);
    setFilterWindow(undefined);
  }, []);

  // ── 点击信号行 → 跳转到图表 ──────────────────────────────────────────
  const handleGoToChart = useCallback((stockCode: string, period: string, time: string) => {
    setChartTarget({ stockCode, period, time });
    router.push('/dashboard/charts');
  }, [setChartTarget, router]);

  // ====================================================================
  // Layer 2：筛选信号明细
  // ====================================================================
  if (viewLayer === 'filtered-signals' && activeRecord) {
    return (
      <div className="flex flex-1 flex-col min-h-0">
        {/* 面包屑导航 */}
        <div className="flex items-center gap-1 mb-4 flex-shrink-0">
          <Button
            variant="ghost" size="sm"
            onClick={handleBackToList}
            className="h-8 px-2 text-xs gap-1"
          >
            <ChevronLeft className="h-3.5 w-3.5" />历史
          </Button>
          <span className="text-muted-foreground text-xs">/</span>
          <Button
            variant="ghost" size="sm"
            onClick={handleBackToResults}
            className="h-8 px-2 text-xs gap-1 max-w-[160px] truncate"
          >
            {activeRecord.task.strategy_name}
          </Button>
          <span className="text-muted-foreground text-xs">/</span>
          <span className="text-xs text-foreground font-medium">{filterWindow?.label}</span>
        </div>

        {/* 标题 */}
        <div className="mb-3">
          <h1 className="text-lg font-bold tracking-tight font-headline">
            信号明细 · {filterWindow?.label}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            点击任意信号行可跳转至图表对应K线
          </p>
        </div>

        {/* 信号列表 */}
        <div className="flex-1 overflow-y-auto rounded-xl border bg-card p-4">
          <SignalDetails
            filterWindow={filterWindow}
            onBack={handleBackToResults}
            onGoToChart={handleGoToChart}
            overrideTask={activeRecord.task}
          />
        </div>
      </div>
    );
  }

  // ====================================================================
  // Layer 1：查看某条记录的统计结果
  // ====================================================================
  if (viewLayer === 'record-results' && activeRecord) {
    return (
      <div className="flex flex-1 flex-col min-h-0">
        {/* 面包屑 */}
        <div className="flex items-center gap-1 mb-4 flex-shrink-0">
          <Button
            variant="ghost" size="sm"
            onClick={handleBackToList}
            className="h-8 px-2 text-xs gap-1"
          >
            <ChevronLeft className="h-3.5 w-3.5" />历史
          </Button>
          <span className="text-muted-foreground text-xs">/</span>
          <span className="text-xs text-foreground font-medium line-clamp-1">
            {activeRecord.task.strategy_name}
          </span>
        </div>

        {/* 标题 */}
        <div className="mb-3">
          <h1 className="text-lg font-bold tracking-tight font-headline line-clamp-1">
            {activeRecord.task.strategy_name}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            点击任意统计卡片可查看对应窗口的信号明细
          </p>
        </div>

        {/* 统计结果（复用 BacktestResults，传入 overrideTask） */}
        <div className="flex-1 overflow-y-auto">
          <BacktestResults
            onWindowClick={handleWindowClick}
            overrideTask={activeRecord.task}
          />
        </div>
      </div>
    );
  }

  // ====================================================================
  // Layer 0：历史记录列表
  // ====================================================================
  return (
    <div className="flex flex-1 flex-col">

      {/* ── 顶部标题栏 ── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-headline">历史记录</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            查看并管理您过往的回测任务
          </p>
        </div>
        {records.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-destructive/70 hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
                清空全部
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>清空所有历史记录？</AlertDialogTitle>
                <AlertDialogDescription>
                  共 {records.length} 条记录将被永久删除，此操作无法撤销。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={clearAll}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  确认清空
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* ── 记录列表 ── */}
      {records.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground py-20">
          <History className="mx-auto h-14 w-14 opacity-20 mb-4" />
          <h3 className="text-lg font-semibold">暂无历史记录</h3>
          <p className="text-sm mt-1 max-w-xs">
            在回测页面完成一次回测，点击「保存记录」按钮后即可在此处查看。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map(record => (
            <HistoryItem
              key={record.id}
              record={record}
              onView={() => handleViewRecord(record)}
              onDelete={() => deleteRecord(record.id)}
            />
          ))}
          <p className="text-center text-[11px] text-muted-foreground pt-2 pb-6">
            共 {records.length} 条记录 · 最多保留 50 条
          </p>
        </div>
      )}
    </div>
  );
}
