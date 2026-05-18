'use client';

/**
 * backtest-results.tsx
 *
 * 回测统计结果展示组件
 * ─────────────────────────────────────
 * 新增功能：
 *  1. 每个 K线/分钟 统计卡片可点击，触发 onWindowClick 跳转到信号明细
 *  2. 提供「保存到历史」按钮，将当前结果存入 useHistoryStore
 *  3. 顶部显示策略参数摘要（周期、信号数、覆盖品种）
 */

import { useMemo, useState } from 'react';
import { useBacktestTaskStore } from '@/store/useBacktestTaskStore';
import { useHistoryStore } from '@/store/useHistoryStore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  TrendingUp, TrendingDown, Info, Save, Check, ChevronRight, BarChart2, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── 胜率卡片 ─────────────────────────────────────────────────────────────────

interface WinRateCardProps {
  label:     string;
  winRate:   number;
  winCount:  number;
  lossCount: number;
  avgMfe:    number | null;    // 平均最高涨幅
  avgMae:    number | null;    // 平均最大跌幅
  ciLow:     number | null;
  ciHigh:    number | null;
  lowSample: boolean;
  onClick:   () => void;
}

function WinRateCard({
  label, winRate, winCount, lossCount,
  avgMfe, avgMae, ciLow, ciHigh, lowSample, onClick,
}: WinRateCardProps) {
  const total = winCount + lossCount;
  const winPct = total > 0 ? (winCount / total) * 100 : 0;
  const isWinning = winRate >= 50;

  return (
    <button
      onClick={onClick}
      className={cn(
        'relative w-full text-left rounded-2xl p-4 border transition-all duration-200 cursor-pointer',
        'bg-[#1e2128] border-white/8 hover:border-primary/40 hover:bg-[#22262e]',
        'active:scale-[0.98]',
      )}
    >
      {/* 右箭头提示可点击 */}
      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40" />

      {/* 标题行 */}
      <div className="flex items-start justify-between mb-2 pr-5">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        {lowSample && (
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/40 text-amber-500 shrink-0">
            小样本
          </Badge>
        )}
      </div>

      {/* 胜率大字 */}
      <div className={cn(
        'text-xl font-bold mb-2 flex items-center gap-1.5',
        isWinning ? 'text-[#26c26e]' : 'text-[#ef4444]',
      )}>
        {isWinning
          ? <TrendingUp className="h-4 w-4" />
          : <TrendingDown className="h-4 w-4" />
        }
        ↑ {winRate.toFixed(1)}%
      </div>

      {/* 进度条 */}
      <div className="relative h-1.5 rounded-full bg-white/8 mb-3 overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-[#ef4444]"
          style={{ width: `${winPct}%` }}
        />
      </div>

      {/* 次数 */}
      <div className="flex justify-between text-[11px] text-muted-foreground mb-3">
        <span>{winCount} 次</span>
        <span>{lossCount} 次</span>
      </div>

      {/* 涨跌幅 */}
      {(avgMfe !== null || avgMae !== null) && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <p className="text-[9px] text-muted-foreground leading-tight">最高涨幅（均）</p>
            <p className="text-[13px] font-semibold text-[#26c26e] mt-0.5">
              {avgMfe !== null ? `+${avgMfe.toFixed(2)}%` : '-'}
            </p>
          </div>
          <div>
            <p className="text-[9px] text-muted-foreground leading-tight">最大跌幅（均）</p>
            <p className="text-[13px] font-semibold text-[#ef4444] mt-0.5">
              {avgMae !== null ? `${avgMae.toFixed(2)}%` : '-'}
            </p>
          </div>
        </div>
      )}

      {/* 置信区间 */}
      {ciLow !== null && ciHigh !== null && (
        <p className="text-[10px] text-muted-foreground text-center">
          95% 置信区间 [{ciLow}%, {ciHigh}%]
        </p>
      )}
    </button>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

interface BacktestResultsProps {
  /** 点击某个统计窗口时的回调，windowKey 如 'c3'/'m60'，label 如 '3根K线' */
  onWindowClick?: (windowKey: string, windowLabel: string) => void;
  /** 外部传入的 task（用于历史记录回放） */
  overrideTask?: any;
}

export default function BacktestResults({ onWindowClick, overrideTask }: BacktestResultsProps) {
  const { task, taskId } = useBacktestTaskStore();
  const { saveRecord, records } = useHistoryStore();
  const [saved, setSaved] = useState(false);

  // 优先使用外部 override（历史记录回放模式）
  const activeTask = overrideTask ?? task;
  const result = activeTask?.result_summary;

  // ── 保存到历史 ──────────────────────────────────────────────────────────
  const alreadySaved = records.some(r => r.id === activeTask?.task_id);

  const handleSave = () => {
    if (!activeTask || alreadySaved) return;
    saveRecord(activeTask);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // ── 计算 K线级 + 分钟级窗口 ─────────────────────────────────────────────
  const barWindows: number[]    = result?.bar_windows    ?? [];
  const minuteWindows: number[] = result?.minute_windows ?? [];

  const barWindowLabels: Record<number, string> = {
    3: '3根K线', 5: '5根K线', 6: '6根K线', 9: '9根K线',
    10: '10根K线', 12: '12根K线', 15: '15根K线', 18: '18根K线',
    20: '20根K线', 24: '24根K线', 30: '30根K线', 40: '40根K线',
    60: '60根K线', 80: '80根K线', 120: '120根K线',
  };

  const minuteWindowLabels: Record<number, string> = {
    5: '5分钟', 15: '15分钟', 30: '30分钟', 60: '60分钟',
    120: '120分钟', 240: '240分钟',
  };

  // 无结果时的空状态
  if (!activeTask || !result) {
    return (
      <div className="text-center text-muted-foreground py-16">
        <BarChart2 className="mx-auto h-12 w-12 opacity-30" />
        <h3 className="mt-4 text-lg font-semibold">尚无回测结果</h3>
        <p className="text-sm mt-1">配置策略并运行回测后，此处将显示统计结果。</p>
      </div>
    );
  }

  const totalSignals: number   = result.total_signals        ?? 0;
  const stocksCount:  number   = result.stocks_with_data     ?? 0;
  const mainPeriod:   string   = result.main_period          ?? '1d';
  const disclaimer:   string   = result.data_disclaimer      ?? '';
  const hasSurvivor:  boolean  = result.survivorship_warning ?? false;

  // 周期中文
  const periodLabel: Record<string, string> = {
    '1d': '日线', '1w': '周线', '1M': '月线',
    '1m': '1分', '5m': '5分', '15m': '15分',
    '30m': '30分', '60m': '60分', '120m': '2时', '240m': '4时',
  };

  return (
    <div className="space-y-5">

      {/* ── 摘要信息条 ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary" className="gap-1 text-xs font-mono">
          <BarChart2 className="h-3 w-3" />
          {periodLabel[mainPeriod] ?? mainPeriod} 主周期
        </Badge>
        <Badge variant="secondary" className="gap-1 text-xs">
          信号总数 {totalSignals}
        </Badge>
        <Badge variant="secondary" className="gap-1 text-xs">
          覆盖品种 {stocksCount}
        </Badge>
        {!overrideTask && (
          <div className="ml-auto">
            <Button
              size="sm"
              variant={alreadySaved ? 'secondary' : 'outline'}
              className="h-7 text-xs gap-1"
              onClick={handleSave}
              disabled={alreadySaved}
            >
              {alreadySaved || saved
                ? <><Check className="h-3 w-3" />已保存</>
                : <><Save className="h-3 w-3" />保存记录</>
              }
            </Button>
          </div>
        )}
      </div>

      {/* ── 说明框 ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl bg-[#1e2128] border border-white/8 p-3">
        <div className="flex gap-2 text-[11px] text-muted-foreground leading-relaxed">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary/60" />
          <div>
            <p><span className="text-foreground font-medium">K线级：</span>信号触发后 N 根日线K线内的最高价、最低价及涨跌统计。</p>
            <p className="mt-0.5"><span className="text-foreground font-medium">分钟级：</span>信号触发后 N 分钟（真实时钟时间）内的最高价、最低价及涨跌统计。</p>
          </div>
        </div>
      </div>

      {/* ── K 线级统计卡片 ────────────────────────────────────────────────── */}
      {barWindows.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-primary" />
            K线级统计（{periodLabel[mainPeriod] ?? mainPeriod}）
            <span className="text-xs text-muted-foreground font-normal">— 信号触发后 N 根K线内</span>
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {barWindows.map(w => {
              const key      = `c${w}`;
              const winRate  = result[`win_rate_${key}`]  ?? 0;
              const winCount = result[`win_count_${key}`] ?? 0;
              const lossCount= result[`loss_count_${key}`]?? 0;
              const avgMfe   = result[`avg_mfe_${key}`]   ?? null;
              const avgMae   = result[`avg_mae_${key}`]   ?? null;
              const ciLow    = result[`win_rate_ci_low_${key}`]  ?? null;
              const ciHigh   = result[`win_rate_ci_high_${key}`] ?? null;
              const lowSample= result[`low_sample_${key}`]       ?? false;
              if (winCount + lossCount === 0) return null;
              return (
                <WinRateCard
                  key={key}
                  label={barWindowLabels[w] ?? `${w}根K线`}
                  winRate={winRate}
                  winCount={winCount}
                  lossCount={lossCount}
                  avgMfe={avgMfe}
                  avgMae={avgMae}
                  ciLow={ciLow}
                  ciHigh={ciHigh}
                  lowSample={lowSample}
                  onClick={() => onWindowClick?.(key, barWindowLabels[w] ?? `${w}根K线`)}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* ── 分钟级统计卡片 ────────────────────────────────────────────────── */}
      {minuteWindows.length > 0 && result.has_minute_stats && (
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-primary" />
            分钟级统计
            <span className="text-xs text-muted-foreground font-normal">— 信号触发后 N 分钟内</span>
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {minuteWindows.map(m => {
              const key      = `m${m}`;
              const winRate  = result[`win_rate_${key}`]  ?? 0;
              const winCount = result[`win_count_${key}`] ?? 0;
              const lossCount= result[`loss_count_${key}`]?? 0;
              const avgMfe   = result[`avg_mfe_${key}`]   ?? null;
              const avgMae   = result[`avg_mae_${key}`]   ?? null;
              const ciLow    = result[`win_rate_ci_low_${key}`]  ?? null;
              const ciHigh   = result[`win_rate_ci_high_${key}`] ?? null;
              const lowSample= result[`low_sample_${key}`]       ?? false;
              if (winCount + lossCount === 0) return null;
              return (
                <WinRateCard
                  key={key}
                  label={minuteWindowLabels[m] ?? `${m}分钟`}
                  winRate={winRate}
                  winCount={winCount}
                  lossCount={lossCount}
                  avgMfe={avgMfe}
                  avgMae={avgMae}
                  ciLow={ciLow}
                  ciHigh={ciHigh}
                  lowSample={lowSample}
                  onClick={() => onWindowClick?.(key, minuteWindowLabels[m] ?? `${m}分钟`)}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* ── 免责声明 ────────────────────────────────────────────────────── */}
      {(hasSurvivor || disclaimer) && (
        <Alert className="bg-amber-500/8 border-amber-500/20 text-amber-600 dark:text-amber-400">
          <Info className="h-3.5 w-3.5 text-amber-500" />
          <AlertDescription className="text-[11px] leading-relaxed">
            {disclaimer || '本统计仅供技术研究参考，不构成投资建议。'}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
