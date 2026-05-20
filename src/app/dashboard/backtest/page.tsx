'use client';

/**
 * src/app/dashboard/backtest/page.tsx
 *
 * 修复：
 *  1. viewLayer/filterWindow 改用 useBacktestViewStore（内存持久化）
 *     → 从信号明细跳图表 router.back() 返回后，viewLayer 仍是 'filtered-signals'
 *  2. 移动端 Sheet 改为受控，回测 COMPLETED 后自动关闭 + 切换到统计结果 Tab
 */

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart2, ListFilter, Settings2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import StrategyBuilder from './strategy-builder';
import BacktestResults from './backtest-results';
import SignalDetails from './signal-details';
import { useChartNavStore } from '@/store/useChartNavigationStore';
import { useBacktestViewStore } from '@/store/useBacktestViewStore';
import { useBacktestTaskStore } from '@/store/useBacktestTaskStore';

export default function BacktestPage() {
  const router = useRouter();
  const setChartTarget = useChartNavStore(s => s.setTarget);

  // ── viewLayer / filterWindow 从 Store 读取，跨路由导航不丢失 ────────────
  // 这样从信号明细跳图表 → router.back() 返回时，仍在信号明细层
  const { viewLayer, filterWindow, goToFilteredSignals, backToResults } = useBacktestViewStore();

  // ── 本地 Tab 状态（Layer 0 内部切换，不需要跨路由持久化）──────────────
  const [activeTab, setActiveTab] = useState<'results' | 'signals'>('results');

  // ── 移动端 Sheet 受控状态 ────────────────────────────────────────────────
  const [sheetOpen, setSheetOpen] = useState(false);

  // ── ★ 回测完成后：关闭策略配置 Sheet + 切换到统计结果 Tab ──────────────
  const task = useBacktestTaskStore(s => s.task);
  useEffect(() => {
    if (task?.status === 'COMPLETED') {
      setSheetOpen(false);      // 关闭移动端策略配置 Sheet
      setActiveTab('results');  // 切换到统计结果 Tab
    }
  }, [task?.status]);

  // ── 点击结果卡片 → 进入筛选信号明细 ────────────────────────────────────
  const handleWindowClick = useCallback((windowKey: string, windowLabel: string) => {
    goToFilteredSignals({ key: windowKey, label: windowLabel });
  }, [goToFilteredSignals]);

  // ── 从信号明细返回 ──────────────────────────────────────────────────────
  const handleBackFromSignals = useCallback(() => {
    backToResults();
  }, [backToResults]);

  // ── 点击信号行 → 跳转到图表 ─────────────────────────────────────────────
  // viewLayer 已写入 store，router.back() 返回时 store 保留 'filtered-signals'
  const handleGoToChart = useCallback((stockCode: string, period: string, time: string) => {
    setChartTarget({ stockCode, period, time });
    router.push('/dashboard/charts');
  }, [setChartTarget, router]);

  // ====================================================================
  // 渲染：筛选信号明细层（Layer 1）
  // ====================================================================
  if (viewLayer === 'filtered-signals') {
    return (
      <div className="flex flex-1 flex-col min-h-0">
        {/* 顶部标题栏（含返回键） */}
        <div className="flex items-center gap-2 mb-4 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBackFromSignals}
            className="h-8 gap-1 text-sm px-2 -ml-1"
          >
            ← 返回
          </Button>
          <div>
            <h1 className="text-lg font-bold tracking-tight font-headline">
              信号明细 · {filterWindow?.label}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              点击任意信号行可跳转至图表对应K线，图表页点击「返回」回到此页
            </p>
          </div>
        </div>

        {/* 信号明细 */}
        <div className="flex-1 overflow-y-auto rounded-xl border bg-card p-4">
          <SignalDetails
            filterWindow={filterWindow}
            onBack={handleBackFromSignals}
            onGoToChart={handleGoToChart}
          />
        </div>
      </div>
    );
  }

  // ====================================================================
  // 渲染：主层（Layer 0） — 策略配置 + 统计结果
  // ====================================================================
  return (
    <div className="flex flex-1 flex-col min-h-0">

      {/* ── 顶部标题栏 ── */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-headline">策略回测</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            构建条件，统计历史信号的胜率与收益分布
          </p>
        </div>
        {/* 移动端策略配置入口（受控 Sheet，回测完成后自动关闭） */}
        <div className="lg:hidden">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Settings2 className="h-4 w-4" />
                策略配置
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto pb-8">
              <SheetHeader className="mb-4">
                <SheetTitle>策略配置</SheetTitle>
              </SheetHeader>
              <StrategyBuilder />
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* ── 主体布局 ── */}
      <div className="flex flex-1 min-h-0 gap-4 overflow-hidden">

        {/* 左侧固定配置栏（桌面端） */}
        <aside className="hidden lg:flex w-[340px] xl:w-[380px] shrink-0 flex-col rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/40 flex-shrink-0">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Settings2 className="h-3 w-3" />
              策略配置
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <StrategyBuilder />
          </div>
        </aside>

        {/* 右侧结果区 Tab */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden rounded-xl border bg-card">
          <Tabs
            value={activeTab}
            onValueChange={v => setActiveTab(v as 'results' | 'signals')}
            className="flex flex-col flex-1 min-h-0"
          >
            <div className="border-b px-4 flex-shrink-0">
              <TabsList className="h-11 bg-transparent p-0 gap-0">
                <TabsTrigger
                  value="results"
                  className="h-11 px-4 text-sm rounded-none border-b-2 border-transparent
                             data-[state=active]:border-primary data-[state=active]:text-primary
                             data-[state=active]:bg-transparent data-[state=active]:shadow-none
                             text-muted-foreground hover:text-foreground transition-colors"
                >
                  <BarChart2 className="h-3.5 w-3.5 mr-1.5" />
                  统计结果
                </TabsTrigger>
                <TabsTrigger
                  value="signals"
                  className="h-11 px-4 text-sm rounded-none border-b-2 border-transparent
                             data-[state=active]:border-primary data-[state=active]:text-primary
                             data-[state=active]:bg-transparent data-[state=active]:shadow-none
                             text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ListFilter className="h-3.5 w-3.5 mr-1.5" />
                  信号明细
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="results" className="flex-1 overflow-y-auto m-0 p-4 lg:p-5">
              <BacktestResults onWindowClick={handleWindowClick} />
            </TabsContent>

            <TabsContent value="signals" className="flex-1 overflow-y-auto m-0 p-4 lg:p-5">
              <SignalDetails onGoToChart={handleGoToChart} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
