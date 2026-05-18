'use client';

/**
 * src/app/dashboard/backtest/page.tsx
 *
 * 回测页面 — 支持三层导航栈
 * ─────────────────────────────────────
 * Layer 0（默认）: 策略配置 + 统计结果 Tabs
 * Layer 1: 信号明细（按特定 K 线窗口筛选）
 *   → 点击结果卡片后进入，顶部有「返回」键
 * Layer 2: 图表跳转（调用 useChartNavStore 后切换到图表 Tab）
 */

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart2, ListFilter, Settings2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import StrategyBuilder from './strategy-builder';
import BacktestResults from './backtest-results';
import SignalDetails, { type FilterWindow } from './signal-details';
import { useChartNavStore } from '@/store/useChartNavigationStore';

type ViewLayer = 'results' | 'filtered-signals';

export default function BacktestPage() {
  const router = useRouter();
  const setChartTarget = useChartNavStore(s => s.setTarget);

  // ── 当前视图层 ─────────────────────────────────────────────────────────
  const [viewLayer,     setViewLayer]     = useState<ViewLayer>('results');
  const [activeTab,     setActiveTab]     = useState<'results' | 'signals'>('results');
  const [filterWindow,  setFilterWindow]  = useState<FilterWindow | undefined>(undefined);

  // ── 点击结果卡片 → 进入筛选信号明细 ────────────────────────────────────
  const handleWindowClick = useCallback((windowKey: string, windowLabel: string) => {
    setFilterWindow({ key: windowKey, label: windowLabel });
    setViewLayer('filtered-signals');
  }, []);

  // ── 从信号明细返回 ──────────────────────────────────────────────────────
  const handleBackFromSignals = useCallback(() => {
    setViewLayer('results');
    setFilterWindow(undefined);
  }, []);

  // ── 点击信号行 → 跳转到图表 ─────────────────────────────────────────────
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
              点击任意信号行可跳转至图表对应K线
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
        {/* 移动端策略配置入口 */}
        <div className="lg:hidden">
          <Sheet>
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
