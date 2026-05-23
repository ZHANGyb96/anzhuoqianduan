'use client';

/**
 * backtest-results.tsx
 *
 * 回测统计结果展示组件
 *
 * 修复记录：
 *  [FIX-7] WinRateCard 进度条颜色逻辑错误
 *    v1 问题：进度条填充宽度为胜率（winPct%），但颜色是红色 #ef4444，
 *             视觉上"胜率越高红色越多"，与直觉完全相反。
 *    修复：左侧绿色填充胜率，右侧红色作为底色（败率），颜色与方向一致。
 *
 *  [新增] MFE/MAE 方向质量比
 *    在胜率卡片中补充 MFE/MAE 比值（方向质量），
 *    > 2.0 说明信号后顺势空间是逆势回撤的 2 倍以上，形态质量高。
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
    avgMfe:    number | null;
    avgMae:    number | null;
    ciLow:     number | null;
    ciHigh:    number | null;
    lowSample: boolean;
    onClick:   () => void;
}

function WinRateCard({
    label, winRate, winCount, lossCount,
    avgMfe, avgMae, ciLow, ciHigh, lowSample, onClick,
}: WinRateCardProps) {
    const total  = winCount + lossCount;
    const winPct = total > 0 ? (winCount / total) * 100 : 0;
    const isWinning = winRate >= 50;

    // [新增] MFE/MAE 方向质量比
    // avgMae 在存储时已经是负值（最大跌幅为负），取绝对值计算比率
    const mfeMaeRatio: number | null =
        avgMfe != null && avgMae != null && avgMae !== 0
            ? parseFloat((avgMfe / Math.abs(avgMae)).toFixed(2))
            : null;

    const ratioColor =
        mfeMaeRatio == null   ? 'text-muted-foreground' :
        mfeMaeRatio >= 2.0    ? 'text-[#26c26e]' :
        mfeMaeRatio >= 1.2    ? 'text-yellow-400' :
                                'text-[#ef4444]';

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

            {/* [FIX-7] 进度条：左绿（胜率）+ 右红底色（败率），颜色方向正确 */}
            <div className="relative h-1.5 rounded-full bg-[#ef4444]/40 mb-3 overflow-hidden">
                <div
                    className="absolute left-0 top-0 h-full rounded-full bg-[#26c26e] transition-all duration-500"
                    style={{ width: `${winPct}%` }}
                />
            </div>

            {/* 次数 */}
            <div className="flex justify-between text-[11px] text-muted-foreground mb-3">
                <span className="text-[#26c26e]/80">↑ {winCount} 次</span>
                <span className="text-[#ef4444]/80">↓ {lossCount} 次</span>
            </div>

            {/* MFE / MAE 统计 */}
            {(avgMfe !== null || avgMae !== null) && (
                <div className="grid grid-cols-3 gap-1.5 mb-3">
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
                    {/* [新增] MFE/MAE 方向质量比 */}
                    <div>
                        <p className="text-[9px] text-muted-foreground leading-tight">方向质量</p>
                        <p className={cn('text-[13px] font-semibold mt-0.5', ratioColor)}>
                            {mfeMaeRatio !== null ? `${mfeMaeRatio}x` : '-'}
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
    onWindowClick?: (windowKey: string, windowLabel: string) => void;
    overrideTask?: any;
}

export default function BacktestResults({ onWindowClick, overrideTask }: BacktestResultsProps) {
    const { task, taskId } = useBacktestTaskStore();
    const { saveRecord, records } = useHistoryStore();
    const [saved, setSaved] = useState(false);

    const activeTask = overrideTask ?? task;
    const result     = activeTask?.result_summary;

    const alreadySaved = records.some(r => r.id === activeTask?.task_id);

    const handleSave = () => {
        if (!activeTask || alreadySaved) return;
        saveRecord(activeTask);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const barWindows:    number[] = result?.bar_windows    ?? [];
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

    if (!activeTask || !result) {
        return (
            <div className="text-center text-muted-foreground py-16">
                <BarChart2 className="mx-auto h-12 w-12 opacity-30" />
                <h3 className="mt-4 text-lg font-semibold">尚无回测结果</h3>
                <p className="text-sm mt-1">配置策略并运行回测后，此处将显示统计结果。</p>
            </div>
        );
    }

    const totalSignals: number  = result.total_signals        ?? 0;
    const stocksCount:  number  = result.stocks_with_data     ?? 0;
    const mainPeriod:   string  = result.main_period          ?? '1d';
    const disclaimer:   string  = result.data_disclaimer      ?? '';
    const hasSurvivor:  boolean = result.survivorship_warning ?? false;

    // 历史回放模式下，signal_details 可能已被剥离
    const isStripped: boolean = result._signal_details_stripped ?? false;

    const periodLabel: Record<string, string> = {
        '1d': '日线', '1w': '周线', '1M': '月线',
        '1m': '1分', '5m': '5分', '15m': '15分',
        '30m': '30分', '60m': '60分', '120m': '2时', '240m': '4时',
    };

    return (
        <div className="space-y-5">

            {/* 摘要信息条 */}
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

            {/* 历史记录剥离提示 */}
            {isStripped && (
                <Alert className="py-2 px-3 bg-blue-500/5 border-blue-500/20">
                    <Info className="h-3.5 w-3.5 text-blue-400" />
                    <AlertDescription className="text-[10px] text-blue-400/90 ml-1">
                        历史记录模式：信号明细已移除以节省存储空间，统计数据完整保留。
                    </AlertDescription>
                </Alert>
            )}

            {/* 说明框 */}
            <div className="rounded-xl bg-[#1e2128] border border-white/8 p-3">
                <div className="flex gap-2 text-[11px] text-muted-foreground leading-relaxed">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary/60" />
                    <div>
                        <p><span className="text-foreground font-medium">K线级：</span>信号触发后 N 根K线内的最高、最低及涨跌统计。</p>
                        <p className="mt-0.5"><span className="text-foreground font-medium">分钟级：</span>信号触发后 N 分钟（真实时钟）内的最高、最低及涨跌统计。</p>
                        <p className="mt-0.5"><span className="text-foreground font-medium">方向质量：</span>MFE/|MAE| 比值，&gt; 2.0 表示顺势空间是逆势回撤的 2 倍以上。</p>
                    </div>
                </div>
            </div>

            {/* K线级统计卡片 */}
            {barWindows.length > 0 && (
                <section>
                    <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                        <TrendingUp className="h-4 w-4 text-primary" />
                        K线级统计（{periodLabel[mainPeriod] ?? mainPeriod}）
                        <span className="text-xs text-muted-foreground font-normal">— 信号触发后 N 根K线内</span>
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                        {barWindows.map(w => {
                            const key       = `c${w}`;
                            const winRate   = result[`win_rate_${key}`]        ?? 0;
                            const winCount  = result[`win_count_${key}`]       ?? 0;
                            const lossCount = result[`loss_count_${key}`]      ?? 0;
                            const avgMfe    = result[`avg_mfe_${key}`]         ?? null;
                            const avgMae    = result[`avg_mae_${key}`]         ?? null;
                            const ciLow     = result[`win_rate_ci_low_${key}`] ?? null;
                            const ciHigh    = result[`win_rate_ci_high_${key}`]?? null;
                            const lowSample = result[`low_sample_${key}`]      ?? false;
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

            {/* 分钟级统计卡片 */}
            {minuteWindows.length > 0 && result.has_minute_stats && (
                <section>
                    <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                        <Clock className="h-4 w-4 text-primary" />
                        分钟级统计
                        <span className="text-xs text-muted-foreground font-normal">— 信号触发后 N 分钟内</span>
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                        {minuteWindows.map(m => {
                            const key       = `m${m}`;
                            const winRate   = result[`win_rate_${key}`]        ?? 0;
                            const winCount  = result[`win_count_${key}`]       ?? 0;
                            const lossCount = result[`loss_count_${key}`]      ?? 0;
                            const avgMfe    = result[`avg_mfe_${key}`]         ?? null;
                            const avgMae    = result[`avg_mae_${key}`]         ?? null;
                            const ciLow     = result[`win_rate_ci_low_${key}`] ?? null;
                            const ciHigh    = result[`win_rate_ci_high_${key}`]?? null;
                            const lowSample = result[`low_sample_${key}`]      ?? false;
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

            {/* 免责声明 */}
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
