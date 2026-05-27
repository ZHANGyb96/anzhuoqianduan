'use client';

/**
 * src/app/dashboard/charts/chart-view.tsx
 *
 * 修复：
 *  1. 定位问题 — 通过 targetTime prop 传给 KlineChart，数据就绪后滚动到指定K线
 *  2. 返回键无响应 — 使用 router.back()，Capacitor 无历史时 fallback 到 backtest 页
 *  3. [新增] 周期自动匹配 — 切换品种时检测本地有哪些周期有数据，
 *           如果当前周期无数据则按优先级自动切换（1d > 60m > 30m > 15m > 5m > …）；
 *           周期栏中无数据的按钮置灰，防止用户误点。
 *           根本原因：重装 App 后 SQLite 清空，用户重新同步时可能只同步了部分周期，
 *           但图表默认显示 '1d'，若未同步日线则显示"暂无数据"空页面。
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Loader2, Settings2, Plus, Trash2, ChevronDown,
  AlertCircle, Bot, ArrowLeft,
} from 'lucide-react';
import { IndicatorType, indicatorList, maConfig } from '@/components/kline-chart';
import { useAuthStore } from '@/store/useAuthStore';
import { useMarketDataStore } from '@/store/useMarketDataStore';
import { isCapacitor } from '@/config/platform';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AIAnalysisPanel } from '@/components/ai-analysis-panel';
import { ChartContext } from '@/lib/ai-caller';
import type { FormattedChartData } from '@/components/kline-chart';
import { useAIStore } from '@/store/useAIStore';
import { useChartNavStore } from '@/store/useChartNavigationStore';
import { Badge } from '@/components/ui/badge';
// [新增] 用于查询本地数据库的可用周期
import { getMobileDB } from '@/lib/mobile-db';

const KlineChart = dynamic(
  () => import('@/components/kline-chart').then(m => m.KlineChart),
  { ssr: false, loading: () => <Skeleton className="h-full w-full bg-transparent" /> }
);

const PERIOD_TABS = [
  { value: '1m',   label: '1分'  },
  { value: '5m',   label: '5分'  },
  { value: '15m',  label: '15分' },
  { value: '30m',  label: '30分' },
  { value: '60m',  label: '60分' },
  { value: '120m', label: '2时'  },
  { value: '240m', label: '4时'  },
  { value: '1d',   label: '日K'  },
  { value: '1w',   label: '周K'  },
  { value: '1M',   label: '月K'  },
];

/**
 * 切换品种时自动选择的周期优先级顺序。
 * 逻辑：先日线（最常用），再从长到短的分钟线，最后周/月线。
 */
const PERIOD_PRIORITY = ['1d', '60m', '30m', '15m', '5m', '1m', '120m', '240m', '1w', '1M'];

// ─────────────────────────────────────────────────────────────────────────────
// [新增] 查询某只股票在本地 SQLite 中有哪些周期有数据
// ─────────────────────────────────────────────────────────────────────────────
async function fetchAvailablePeriods(stockCode: string): Promise<string[]> {
  if (!isCapacitor || !stockCode) return [];
  try {
    const db  = await getMobileDB();
    const res = await db.query(
      'SELECT DISTINCT period FROM kline_metrics WHERE stock_code = ? ORDER BY period',
      [stockCode],
    );
    return (res.values ?? []).map((r: any) => r.period as string).filter(Boolean);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ChartView() {
  const router = useRouter();
  const [isClient,       setIsClient      ] = useState(false);
  const [selectedStock,  setSelectedStock ] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('1d');
  const periodScrollRef = useRef<HTMLDivElement>(null);

  const token = useAuthStore(s => s.token);
  const { availableSymbols, fetchSymbols, error: symbolsError, isLoading: symbolsLoading } = useMarketDataStore();

  // ── 导航目标（来自信号明细点击）────────────────────────────────────────
  const { target, clearTarget } = useChartNavStore();
  const navAppliedRef = useRef(false);

  // [新增] 当前品种在本地 SQLite 中有数据的周期列表
  const [availablePeriods, setAvailablePeriods] = useState<string[]>([]);

  useEffect(() => { setIsClient(true); }, []);

  useEffect(() => {
    if (isClient && (token || isCapacitor)) fetchSymbols();
  }, [isClient, token, fetchSymbols]);

  // 品种列表就绪后：优先切换到导航目标品种，否则选第一支
  useEffect(() => {
    if (!availableSymbols.length) { setSelectedStock(''); return; }
    if (target && !navAppliedRef.current && availableSymbols.some(s => s.value === target.stockCode)) {
      setSelectedStock(target.stockCode);
      setSelectedPeriod(target.period);
      navAppliedRef.current = true;
      return;
    }
    if (!availableSymbols.some(s => s.value === selectedStock))
      setSelectedStock(availableSymbols[0].value);
  }, [availableSymbols]); // eslint-disable-line

  // target 变化时：重置标志，并在品种列表已就绪时立即切换
  useEffect(() => {
    navAppliedRef.current = false;
    if (!target || !availableSymbols.length) return;
    if (availableSymbols.some(s => s.value === target.stockCode)) {
      setSelectedStock(target.stockCode);
      setSelectedPeriod(target.period);
      navAppliedRef.current = true;
    }
  }, [target]); // eslint-disable-line

  // ────────────────────────────────────────────────────────────────────────
  // [新增] 品种切换时：查询该品种在本地库中有数据的周期，
  //         如果当前 selectedPeriod 没有数据，按优先级自动切换。
  // ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedStock) {
      setAvailablePeriods([]);
      return;
    }

    // Web 环境（非 Capacitor）不使用本地 DB，直接放行
    if (!isCapacitor) return;

    fetchAvailablePeriods(selectedStock).then(periods => {
      setAvailablePeriods(periods);

      // 如果有数据但当前选中的周期没有数据，按优先级自动切换
      if (periods.length > 0 && !periods.includes(selectedPeriod)) {
        const best = PERIOD_PRIORITY.find(p => periods.includes(p)) ?? periods[0];
        setSelectedPeriod(best);
      }
    });
  }, [selectedStock]); // eslint-disable-line react-hooks/exhaustive-deps
  // 注意：intentionally 不依赖 selectedPeriod，避免循环触发

  // 切换周期时把对应 Tab 滚动到可视区
  useEffect(() => {
    const el = periodScrollRef.current?.querySelector(
      `[data-period="${selectedPeriod}"]`
    ) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [selectedPeriod]);

  // ── 图表设置 ─────────────────────────────────────────────────────────────
  const [visibleMAs, setVisibleMAs] = useState<Record<string, boolean>>({
    ma5: true, ma10: true, ma20: true, ma60: true, ma120: false, ma250: false,
  });
  const [showDivergence, setShowDivergence] = useState(true);
  const [showTrixSignal, setShowTrixSignal] = useState(true);
  const [showDpoSignal,  setShowDpoSignal ] = useState(true);
  const [showBbiSignal,  setShowBbiSignal ] = useState(true);
  const [indicatorPanes, setIndicatorPanes] = useState<IndicatorType[]>(['Volume', 'MACD']);

  // ── AI 分析 ──────────────────────────────────────────────────────────────
  const [aiPanelOpen,  setAIPanelOpen ] = useState(false);
  const [chartContext, setChartContext] = useState<ChartContext | null>(null);
  const clearMessages = useAIStore(s => s.clearMessages);

  const prevKeyRef = useRef('');
  useEffect(() => {
    const key = `${selectedStock}__${selectedPeriod}`;
    if (prevKeyRef.current && prevKeyRef.current !== key) {
      clearMessages();
      setChartContext(null);
    }
    prevKeyRef.current = key;
  }, [selectedStock, selectedPeriod, clearMessages]);

  useEffect(() => {
    setChartContext(prev => prev ? { ...prev, activePanes: indicatorPanes } : prev);
  }, [indicatorPanes]);

  const addIndicator = () => {
    if (indicatorPanes.length >= 3) return;
    const used = new Set(indicatorPanes);
    setIndicatorPanes(p => [...p, indicatorList.find(i => !used.has(i.value))?.value ?? 'RSI']);
  };
  const removeIndicator = (idx: number) => setIndicatorPanes(p => p.filter((_, i) => i !== idx));
  const changeIndicator  = (idx: number, val: IndicatorType) =>
    setIndicatorPanes(p => { const n = [...p]; n[idx] = val; return n; });

  const handleDataReady = useCallback((data: FormattedChartData[]) => {
    const sym = availableSymbols.find(s => s.value === selectedStock);
    setChartContext({
      stockCode:   selectedStock,
      stockName:   sym?.label?.replace(` (${selectedStock})`, '') ?? selectedStock,
      period:      selectedPeriod,
      activePanes: indicatorPanes,
      bars: data.map(d => ({
        time: String(d.time), open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume,
        ma5: d.ma5, ma10: d.ma10, ma20: d.ma20, ma60: d.ma60,
        macd: d.macd, macd_signal: d.macd_signal, macd_hist: d.macd_hist,
        kdj_k: d.kdj_k, kdj_d: d.kdj_d, kdj_j: d.kdj_j,
        rsi_6: d.rsi_6, rsi_12: d.rsi_12, rsi_24: d.rsi_24,
        boll_upper: d.boll_upper, boll_middle: d.boll_middle, boll_lower: d.boll_lower,
        cci: d.cci, bias_6: d.bias_6, bias_12: d.bias_12,
      })),
    });
  }, [availableSymbols, selectedStock, selectedPeriod, indicatorPanes]);

  // ── 返回上一页 ─────────────────────────────────────────────────────────────
  const handleBack = useCallback(() => {
    clearTarget();
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.replace('/dashboard/backtest');
    }
  }, [clearTarget, router]);

  const currentSymbol = availableSymbols.find(s => s.value === selectedStock);

  if (!isClient || symbolsLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="animate-spin h-8 w-8 text-muted-foreground" />
      </div>
    );
  }
  if (symbolsError) {
    return (
      <Alert variant="destructive" className="m-4">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription>{symbolsError}</AlertDescription>
      </Alert>
    );
  }

  // 只有 target 已匹配到当前品种时才传 targetTime，避免品种未切换时错误定位
  const targetTime =
    target && target.stockCode === selectedStock ? target.time : undefined;

  // [新增] 周期是否有本地数据（Web 环境不做限制）
  const periodHasData = (period: string) =>
    !isCapacitor || availablePeriods.length === 0 || availablePeriods.includes(period);

  return (
    <div className="flex flex-col w-full flex-1 min-h-0 bg-background overflow-hidden">

      {/* ─── 返回条：从信号明细跳转时显示 ─────────────────────────────────── */}
      {target && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 border-b border-primary/20 flex-shrink-0">
          <button
            onClick={handleBack}
            className="flex items-center gap-1 text-xs font-semibold text-primary
                       px-2.5 py-1 rounded-lg bg-primary/15 hover:bg-primary/25
                       active:scale-95 transition-all shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回
          </button>

          <span className="text-primary text-xs font-medium">信号明细跳转</span>

          {target.time && (
            <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0">
              {target.time.slice(0, 10)}
            </Badge>
          )}
          {target.stockCode && (
            <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0">
              {target.stockCode}
            </Badge>
          )}

          <button
            onClick={() => clearTarget()}
            className="ml-auto text-muted-foreground hover:text-foreground text-[10px] underline shrink-0"
          >
            关闭
          </button>
        </div>
      )}

      {/* ─── 品种选择栏 ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1.5 flex-shrink-0 relative z-10 bg-[#17191C]">
        <div className="w-12 text-muted-foreground flex justify-start">
          <ChevronDown className="h-5 w-5 rotate-90" />
        </div>
        <div className="flex-1 flex justify-center items-center">
          <Select value={selectedStock} onValueChange={setSelectedStock} disabled={!availableSymbols.length}>
            <SelectTrigger className="h-10 w-auto bg-transparent border-0 gap-0 mx-auto shadow-none focus:ring-0 flex flex-col justify-center items-center px-0 hover:bg-transparent">
              <div className="flex items-center gap-1">
                <ChevronDown className="h-4 w-4 opacity-0" />
                <span className="text-base font-bold text-foreground">
                  {currentSymbol ? currentSymbol.label.replace(` (${selectedStock})`, '') : '选择品种'}
                </span>
                <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
              </div>
              {currentSymbol && (
                <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-1 mt-0.5">
                  {selectedStock}
                  <span className="bg-[#5A87F7]/20 text-[#5A87F7] px-1 rounded-[2px] leading-tight text-[8px] transform scale-90">L1</span>
                </div>
              )}
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {availableSymbols.map(s => (
                <SelectItem key={s.value} value={s.value} className="text-xs md:text-sm">
                  <span className="font-mono font-bold text-primary mr-2">{s.value}</span>
                  <span className="text-muted-foreground">{s.label.replace(` (${s.value})`, '')}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-12 flex justify-end text-muted-foreground" />
      </div>

      {/* ─── K 线图主体 ──────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
        <KlineChart
          stockCode={selectedStock}
          period={selectedPeriod}
          visibleMAs={visibleMAs}
          indicatorPanes={indicatorPanes}
          showDivergence={showDivergence}
          showTrixSignal={showTrixSignal}
          showDpoSignal={showDpoSignal}
          showBbiSignal={showBbiSignal}
          onChangeIndicator={changeIndicator}
          onDataReady={handleDataReady}
          {...(targetTime ? ({ targetTime } as any) : {})}

          toolbar={
            <div className="flex items-center px-1 h-8 shrink-0 border-b border-white/5 bg-[#17191C] w-full gap-1">
              <div
                ref={periodScrollRef}
                className="flex items-center flex-1 min-w-0 overflow-x-auto no-scrollbar scroll-smooth h-full space-x-1"
                style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
              >
                {PERIOD_TABS.map(p => {
                  const hasData   = periodHasData(p.value);
                  const isActive  = selectedPeriod === p.value;
                  return (
                    <button
                      key={p.value}
                      data-period={p.value}
                      onClick={() => setSelectedPeriod(p.value)}
                      title={!hasData ? `${p.label} 暂无本地数据，请先在"数据管理"同步` : undefined}
                      className={[
                        'shrink-0 px-3 h-full relative text-[13px] transition-colors whitespace-nowrap',
                        'flex items-center justify-center bg-transparent border-none appearance-none outline-none',
                        isActive
                          ? 'text-[#5A87F7] font-semibold'
                          : hasData
                            ? 'text-muted-foreground hover:text-foreground'
                            : 'text-muted-foreground/30 cursor-not-allowed',  // 无数据：置灰
                      ].join(' ')}
                    >
                      {p.label}
                      {/* 当前选中的下划线 */}
                      {isActive && (
                        <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-[#5A87F7] rounded-full" />
                      )}
                      {/* [新增] 无数据的小圆点提示 */}
                      {!hasData && isCapacitor && availablePeriods.length > 0 && (
                        <div className="absolute top-1 right-1 w-1 h-1 rounded-full bg-muted-foreground/30" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* AI 按钮 */}
              <div className="flex-shrink-0 ml-1 relative z-50">
                <button
                  onClick={() => setAIPanelOpen(true)}
                  className={`flex items-center justify-center h-7 w-7 rounded appearance-none outline-none border transition-colors
                    ${aiPanelOpen ? 'bg-primary/20 border-primary/50 text-primary' : 'bg-transparent border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5'}`}
                >
                  <Bot className="h-3.5 w-3.5 flex-shrink-0" />
                </button>
              </div>

              {/* 设置按钮 */}
              <div className="flex-shrink-0 ml-1 relative z-50">
                <Sheet>
                  <SheetTrigger asChild>
                    <button className="flex items-center justify-center h-7 w-7 rounded bg-transparent appearance-none outline-none text-muted-foreground hover:text-foreground border border-white/10 hover:bg-white/5 transition-colors">
                      <Settings2 className="h-3.5 w-3.5 flex-shrink-0" />
                    </button>
                  </SheetTrigger>
                  <SheetContent side="bottom" className="rounded-t-2xl max-h-[75vh] overflow-y-auto pb-8 z-[100]">
                    <SheetHeader className="mb-4"><SheetTitle className="text-sm">图表设置</SheetTitle></SheetHeader>

                    <section className="mb-5">
                      <p className="text-[11px] font-semibold text-muted-foreground mb-3 uppercase tracking-wider">均线显示</p>
                      <div className="grid grid-cols-3 gap-3">
                        {Object.entries(maConfig).map(([k, c]) => (
                          <label key={k} className="flex items-center gap-2 cursor-pointer">
                            <Checkbox checked={!!visibleMAs[k]} onCheckedChange={v => setVisibleMAs(p => ({ ...p, [k]: !!v }))} />
                            <span className="text-sm" style={{ color: c.color }}>{c.label}</span>
                          </label>
                        ))}
                      </div>
                    </section>

                    <section className="mb-5">
                      <p className="text-[11px] font-semibold text-muted-foreground mb-3 uppercase tracking-wider">信号标记</p>
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          ['MACD 背离', showDivergence, setShowDivergence],
                          ['TRIX 信号', showTrixSignal, setShowTrixSignal],
                          ['DPO 信号',  showDpoSignal,  setShowDpoSignal ],
                          ['BBI 信号',  showBbiSignal,  setShowBbiSignal ],
                        ] as [string, boolean, (v: boolean) => void][]).map(([label, val, setter]) => (
                          <label key={label} className="flex items-center gap-2 cursor-pointer">
                            <Checkbox checked={val} onCheckedChange={v => setter(!!v)} />
                            <span className="text-sm">{label}</span>
                          </label>
                        ))}
                      </div>
                    </section>

                    <section>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">副图指标（最多 3 个）</p>
                        {indicatorPanes.length < 3 && (
                          <button onClick={addIndicator} className="flex items-center gap-1 text-xs text-primary">
                            <Plus className="h-3.5 w-3.5" />添加
                          </button>
                        )}
                      </div>
                      <div className="space-y-2">
                        {indicatorPanes.map((ind, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Select value={ind} onValueChange={v => changeIndicator(i, v as IndicatorType)}>
                              <SelectTrigger className="flex-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {indicatorList.map(item => (
                                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <button onClick={() => removeIndicator(i)}
                              className="flex items-center justify-center h-9 w-9 rounded border border-destructive/40 text-destructive/70 hover:bg-destructive/10 hover:text-destructive transition-colors">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  </SheetContent>
                </Sheet>
              </div>
            </div>
          }
        />
      </div>

      <AIAnalysisPanel open={aiPanelOpen} onOpenChange={setAIPanelOpen} chartContext={chartContext} />
    </div>
  );
}
