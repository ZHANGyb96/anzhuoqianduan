'use client';
import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Settings2, Plus, Trash2, ChevronDown, AlertCircle, Star, Search } from 'lucide-react';
import { IndicatorType, indicatorList, maConfig } from '@/components/kline-chart';
import { useAuthStore } from '@/store/useAuthStore';
import { useMarketDataStore } from '@/store/useMarketDataStore';
import { isCapacitor } from '@/config/platform';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

// SSR 安全的动态加载（LightweightCharts 依赖 window）
const KlineChart = dynamic(
  () => import('@/components/kline-chart').then(m => m.KlineChart),
  { ssr: false, loading: () => <Skeleton className="h-full w-full bg-transparent" /> }
);

// ── 周期 Tab 配置 ────────────────────────────────────────────────────────────
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

export default function ChartView() {
  const [isClient,       setIsClient      ] = useState(false);
  const [selectedStock,  setSelectedStock ] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('1d');
  const periodScrollRef = useRef<HTMLDivElement>(null);

  const token = useAuthStore(s => s.token);
  const { availableSymbols, fetchSymbols, error: symbolsError, isLoading: symbolsLoading } = useMarketDataStore();

  useEffect(() => { setIsClient(true); }, []);

  useEffect(() => {
    if (isClient && (token || isCapacitor)) fetchSymbols();
  }, [isClient, token, fetchSymbols]);

  // 品种列表就绪后自动选第一支
  useEffect(() => {
    if (!availableSymbols.length) { setSelectedStock(''); return; }
    if (!availableSymbols.some(s => s.value === selectedStock))
      setSelectedStock(availableSymbols[0].value);
  }, [availableSymbols]); // eslint-disable-line

  // 切换周期时把对应 Tab 滚动到可视区
  useEffect(() => {
    const el = periodScrollRef.current?.querySelector(
      `[data-period="${selectedPeriod}"]`
    ) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [selectedPeriod]);

  // ── 图表设置状态 ─────────────────────────────────────────────────────────
  const [visibleMAs, setVisibleMAs] = useState<Record<string, boolean>>({
    ma5: true, ma10: true, ma20: true, ma60: true, ma120: false, ma250: false,
  });
  const [showDivergence, setShowDivergence] = useState(true);
  const [showTrixSignal, setShowTrixSignal] = useState(true);
  const [showDpoSignal,  setShowDpoSignal ] = useState(true);
  const [showBbiSignal,  setShowBbiSignal ] = useState(true);
  const [indicatorPanes, setIndicatorPanes] = useState<IndicatorType[]>(['Volume', 'MACD']);

  const addIndicator = () => {
    if (indicatorPanes.length >= 3) return;
    const used = new Set(indicatorPanes);
    const next = indicatorList.find(i => !used.has(i.value))?.value ?? 'RSI';
    setIndicatorPanes(p => [...p, next]);
  };
  const removeIndicator = (idx: number) =>
    setIndicatorPanes(p => p.filter((_, i) => i !== idx));
  const changeIndicator = (idx: number, val: IndicatorType) =>
    setIndicatorPanes(p => { const n = [...p]; n[idx] = val; return n; });

  // ── 当前品种显示名 ───────────────────────────────────────────────────────
  const currentSymbol = availableSymbols.find(s => s.value === selectedStock);

  // ── Loading / Error ──────────────────────────────────────────────────────
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

  return (
    <div className="flex flex-col w-full flex-1 min-h-0 bg-background overflow-hidden">

      {/* ══════════════════════════════════════════════════════════════
          核心需求1：股票名称单独置顶
          我们将把它作为顶部的标题栏，中间显示股票代码和名称
      ══════════════════════════════════════════════════════════════ */}
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
                              {selectedStock} <span className="bg-[#5A87F7]/20 text-[#5A87F7] px-1 rounded-[2px] leading-tight text-[8px] transform scale-90">L1</span>
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
          
          <div className="w-12 flex justify-end text-muted-foreground">
              {/* 取消了收藏和搜索图标 */}
          </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          K 线图主体 —— flex-1 + min-h-0 + flex flex-col 解决移动端高度塌陷问题
      ══════════════════════════════════════════════════════════════ */}
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
          
          // 核心需求2：顶部周期切换格局（把周期条放置在 K线行情报价下方）
          toolbar={
            <div className="flex items-center px-1 h-8 shrink-0 border-b border-white/5 bg-[#17191C] w-full">
              <div
                ref={periodScrollRef}
                className="flex items-center flex-1 min-w-0 overflow-x-auto no-scrollbar scroll-smooth h-full space-x-1"
                style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
              >
                {PERIOD_TABS.map(p => (
                  <button
                    key={p.value}
                    data-period={p.value}
                    onClick={() => setSelectedPeriod(p.value)}
                    className={`shrink-0 px-3 h-full relative text-[13px] transition-colors whitespace-nowrap flex items-center justify-center bg-transparent border-none appearance-none outline-none
                      ${selectedPeriod === p.value
                        ? 'text-[#5A87F7] font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                      }`}
                  >
                    {p.label}
                    {selectedPeriod === p.value && (
                      <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-[#5A87F7] rounded-full" />
                    )}
                  </button>
                ))}
              </div>

              {/* 设置按钮 → Bottom Sheet */}
              <div className="flex-shrink-0 ml-1 relative z-50">
                  <Sheet>
                    <SheetTrigger asChild>
                      <button className="flex items-center justify-center h-7 w-7 rounded bg-transparent appearance-none outline-none
                                         text-muted-foreground hover:text-foreground
                                         border border-white/10 hover:bg-white/5 transition-colors">
                        <Settings2 className="h-3.5 w-3.5 flex-shrink-0" />
                      </button>
                    </SheetTrigger>
                    <SheetContent side="bottom" className="rounded-t-2xl max-h-[75vh] overflow-y-auto pb-8 z-[100]">
                  <SheetHeader className="mb-4">
                    <SheetTitle className="text-sm">图表设置</SheetTitle>
                  </SheetHeader>

                  {/* 均线开关 */}
                  <section className="mb-5">
                    <p className="text-[11px] font-semibold text-muted-foreground mb-3 uppercase tracking-wider">均线显示</p>
                    <div className="grid grid-cols-3 gap-3">
                      {Object.entries(maConfig).map(([k, c]) => (
                        <label key={k} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={!!visibleMAs[k]}
                            onCheckedChange={v => setVisibleMAs(p => ({ ...p, [k]: !!v }))}
                          />
                          <span className="text-sm" style={{ color: c.color }}>{c.label}</span>
                        </label>
                      ))}
                    </div>
                  </section>

                  {/* 信号标记 */}
                  <section className="mb-5">
                    <p className="text-[11px] font-semibold text-muted-foreground mb-3 uppercase tracking-wider">信号标记</p>
                    <div className="grid grid-cols-2 gap-3">
                      {(
                        [
                          ['MACD 背离', showDivergence, setShowDivergence],
                          ['TRIX 信号', showTrixSignal, setShowTrixSignal],
                          ['DPO 信号',  showDpoSignal,  setShowDpoSignal ],
                          ['BBI 信号',  showBbiSignal,  setShowBbiSignal ],
                        ] as [string, boolean, (v: boolean) => void][]
                      ).map(([label, val, setter]) => (
                        <label key={label} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox checked={val} onCheckedChange={v => setter(!!v)} />
                          <span className="text-sm">{label}</span>
                        </label>
                      ))}
                    </div>
                  </section>

                  {/* 副图指标 */}
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        副图指标（最多 3 个）
                      </p>
                      {indicatorPanes.length < 3 && (
                        <button
                          onClick={addIndicator}
                          className="flex items-center gap-1 text-xs text-primary"
                        >
                          <Plus className="h-3.5 w-3.5" />添加
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {indicatorPanes.map((ind, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Select value={ind} onValueChange={v => changeIndicator(i, v as IndicatorType)}>
                            <SelectTrigger className="flex-1 h-9 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {indicatorList.map(item => (
                                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <button
                            onClick={() => removeIndicator(i)}
                            className="flex items-center justify-center h-9 w-9 rounded border
                                       border-destructive/40 text-destructive/70
                                       hover:bg-destructive/10 hover:text-destructive transition-colors"
                          >
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
    </div>
  );
}