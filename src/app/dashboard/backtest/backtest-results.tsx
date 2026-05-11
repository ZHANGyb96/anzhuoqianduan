'use client';

import { useMemo, useState } from 'react';
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
    AlertCircle, BarChart2, Clock, TrendingUp, TrendingDown,
    Settings, Info, Layers, Eye, EyeOff,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBacktestTaskStore } from '@/store/useBacktestTaskStore';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { getBarWindows, getMinuteWindows } from '@/utils/mobile-backtest-engine';

// ─── 结果接口 ─────────────────────────────────────────────────────────────────

interface BacktestResult {
    total_signals:         number;
    stocks_with_data:      number;
    has_minute_stats:      boolean;
    main_period:           string;
    bar_windows:           number[];
    minute_windows:        number[];
    survivorship_warning:  boolean;
    data_disclaimer:       string;
    signal_details_capped: boolean;
    signal_details_total:  number;
    batch_info: {
        requested: number; processed: number; skipped: number;
        cross_periods: string[]; main_period: string;
    };
    [key: string]: any;
}

// ─── 单窗口结果卡片 ───────────────────────────────────────────────────────────

const WindowCard = ({
    label, prefix, result, lowSample,
}: {
    label:     string;
    prefix:    string;  // 'c3' | 'm60' 等
    result:    BacktestResult;
    lowSample: boolean;
}) => {
    const winRate   = result[`win_rate_${prefix}`]   as number;
    const winCount  = result[`win_count_${prefix}`]  as number;
    const lossCount = result[`loss_count_${prefix}`] as number;
    const avgMfe    = result[`avg_mfe_${prefix}`]    as number | null;
    const avgMae    = result[`avg_mae_${prefix}`]    as number | null;
    const ciLow     = result[`win_rate_ci_low_${prefix}`]  as number | null;
    const ciHigh    = result[`win_rate_ci_high_${prefix}`] as number | null;

    if (winRate == null) return null;

    const lossRate = Math.round((100 - winRate) * 10) / 10;
    const total    = winCount + lossCount;

    return (
        <div className={`rounded-xl border p-3 space-y-2.5 ${lowSample ? 'border-yellow-500/30 bg-yellow-500/5' : 'bg-card'}`}>
            {/* 标题 */}
            <div className="flex items-center justify-between">
                <span className="text-xs font-bold">{label}</span>
                <div className="flex items-center gap-1">
                    {lowSample && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 text-yellow-600 border-yellow-500/40">
                            样本少
                        </Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground">{total} 次</span>
                </div>
            </div>

            {/* 涨跌进度条 */}
            <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                    <span className="text-red-500 font-semibold">↑ {winRate.toFixed(1)}%</span>
                    <span className="text-green-600 font-semibold">↓ {lossRate.toFixed(1)}%</span>
                </div>
                <Progress value={winRate} className="h-2 [&>div]:bg-red-500" />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{winCount} 次</span>
                    <span>{lossCount} 次</span>
                </div>
            </div>

            {/* MFE / MAE */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t text-[10px]">
                <div>
                    <span className="text-muted-foreground block">最高涨幅(均)</span>
                    <p className="font-semibold text-red-500">+{(avgMfe ?? 0).toFixed(2)}%</p>
                </div>
                <div className="text-right">
                    <span className="text-muted-foreground block">最大跌幅(均)</span>
                    <p className="font-semibold text-green-600">{(avgMae ?? 0).toFixed(2)}%</p>
                </div>
            </div>

            {/* Wilson CI */}
            {ciLow != null && ciHigh != null && (
                <p className="text-[9px] text-muted-foreground text-center">
                    95% 置信区间 [{ciLow.toFixed(1)}%, {ciHigh.toFixed(1)}%]
                </p>
            )}
        </div>
    );
};

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export default function BacktestResults() {
    const { task, error, taskId, progress } = useBacktestTaskStore();

    const [showSettings, setShowSettings] = useState(false);
    const [hiddenKeys,   setHiddenKeys  ] = useState<Set<string>>(new Set());

    const isLoading = task?.status === 'PENDING' || task?.status === 'RUNNING';

    const toggleKey = (key: string) =>
        setHiddenKeys(prev => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });

    const renderContent = () => {
        if (!taskId) return (
            <div className="text-center text-muted-foreground py-12">
                <BarChart2 className="mx-auto h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm">提交策略后，回测结果将在此显示</p>
            </div>
        );

        if (error) return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>错误</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        );

        if (isLoading) return (
            <div className="space-y-4">
                <div className="flex items-center gap-2 text-primary text-sm font-semibold">
                    <Clock className="h-4 w-4 animate-spin" />
                    <span>
                        {progress
                            ? `正在回测 ${progress.done} / ${progress.total} 支品种...`
                            : '正在执行回测，请稍候...'}
                    </span>
                </div>
                {progress && (
                    <Progress
                        value={(progress.done / progress.total) * 100}
                        className="h-1.5"
                    />
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
                    {[...Array(6)].map((_, i) => (
                        <Skeleton key={i} className="h-40 w-full rounded-xl" />
                    ))}
                </div>
            </div>
        );

        if (task?.status === 'FAILED') return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>任务执行失败</AlertTitle>
                <AlertDescription>
                    {task.result_summary?.error || '未知错误'}
                </AlertDescription>
            </Alert>
        );

        if (task?.status !== 'COMPLETED' || !task.result_summary) return null;

        const res = task.result_summary as BacktestResult;

        if (res.total_signals === 0) return (
            <div className="text-center text-muted-foreground py-12">
                <BarChart2 className="mx-auto h-10 w-10 mb-3 opacity-30" />
                <p className="font-semibold">未触发任何信号</p>
                <p className="text-sm mt-1">请尝试调整策略条件或扩大数据范围</p>
            </div>
        );

        // 从结果里读实际窗口配置（若旧格式没有则降级到自适应计算）
        const mainPeriod    = res.main_period    || task.strategy_params?.mainPeriod || '1d';
        const barWindows    = res.bar_windows    || getBarWindows(mainPeriod);
        const minuteWindows = res.minute_windows || getMinuteWindows(mainPeriod);
        const batchInfo     = res.batch_info;

        // 周期标签映射
        const PERIOD_LABEL: Record<string, string> = {
            '1m':'1分钟','5m':'5分钟','15m':'15分钟','30m':'30分钟',
            '60m':'60分钟','120m':'120分钟','240m':'240分钟',
            '1d':'日线','1w':'周线','1M':'月线',
        };
        const periodLabel = PERIOD_LABEL[mainPeriod] ?? mainPeriod;

        return (
            <div className="space-y-5">

                {/* ── 汇总条 ── */}
                <div className="flex flex-wrap gap-2 items-center text-xs">
                    <Badge variant="secondary" className="gap-1 text-xs">
                        <Layers className="h-3 w-3" />
                        {periodLabel} 主周期
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                        信号总数 {res.total_signals}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                        覆盖品种 {res.stocks_with_data}
                    </Badge>
                    {batchInfo?.cross_periods?.length > 0 && (
                        <Badge className="text-xs bg-primary/20 text-primary border-primary/30">
                            联动周期 {batchInfo.cross_periods.join(' + ')}
                        </Badge>
                    )}
                    {!res.has_minute_stats && minuteWindows.length > 0 && (
                        <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-500/30">
                            无1分钟数据，分钟级统计不可用
                        </Badge>
                    )}
                    {res.signal_details_capped && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                            明细仅显示前 2000 条
                        </Badge>
                    )}
                </div>

                <Alert className="py-2 bg-blue-500/5 border-blue-500/20">
                    <Info className="h-3.5 w-3.5 text-blue-400" />
                    <AlertDescription className="text-[10px] text-blue-400/90 ml-1">
                        <strong>K线级</strong>：信号触发后 N 根{periodLabel}K线内的最高价、最低价及涨跌统计。
                        {res.has_minute_stats && <><br /><strong>分钟级</strong>：信号触发后 N 分钟（真实时钟时间）内的最高价、最低价及涨跌统计。</>}
                    </AlertDescription>
                </Alert>

                {/* ── K线级统计 ── */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <TrendingUp className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-semibold">K线级统计（{periodLabel}）</span>
                        <span className="text-[10px] text-muted-foreground">— 信号触发后 N 根K线内</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
                        {barWindows.map(w => {
                            const prefix = `c${w}`;
                            const hidden = hiddenKeys.has(prefix);
                            if (hidden) return (
                                <button
                                    key={prefix}
                                    onClick={() => toggleKey(prefix)}
                                    className="rounded-xl border border-dashed h-10 text-[10px] text-muted-foreground hover:bg-accent transition-colors"
                                >
                                    {w} 根 (隐藏)
                                </button>
                            );
                            return (
                                <div key={prefix} className="relative">
                                    <WindowCard
                                        label={`${w} 根K线`}
                                        prefix={prefix}
                                        result={res}
                                        lowSample={!!res[`low_sample_${prefix}`]}
                                    />
                                    <button
                                        onClick={() => toggleKey(prefix)}
                                        className="absolute top-2 right-2 text-muted-foreground/40 hover:text-muted-foreground"
                                    >
                                        <EyeOff className="h-3 w-3" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* ── 分钟级统计 ── */}
                {res.has_minute_stats && minuteWindows.length > 0 && (
                    <div className="space-y-2">
                        <Separator />
                        <div className="flex items-center gap-2 pt-1">
                            <Clock className="h-3.5 w-3.5 text-primary" />
                            <span className="text-xs font-semibold">分钟级统计</span>
                            <span className="text-[10px] text-muted-foreground">— 信号触发后 N 分钟（真实时钟）内</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
                            {minuteWindows.map(m => {
                                const prefix = `m${m}`;
                                const hidden = hiddenKeys.has(prefix);
                                if (hidden) return (
                                    <button
                                        key={prefix}
                                        onClick={() => toggleKey(prefix)}
                                        className="rounded-xl border border-dashed h-10 text-[10px] text-muted-foreground hover:bg-accent transition-colors"
                                    >
                                        {m} 分 (隐藏)
                                    </button>
                                );
                                return (
                                    <div key={prefix} className="relative">
                                        <WindowCard
                                            label={`${m} 分钟`}
                                            prefix={prefix}
                                            result={res}
                                            lowSample={!!res[`low_sample_${prefix}`]}
                                        />
                                        <button
                                            onClick={() => toggleKey(prefix)}
                                            className="absolute top-2 right-2 text-muted-foreground/40 hover:text-muted-foreground"
                                        >
                                            <EyeOff className="h-3 w-3" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* 免责声明 */}
                <p className="text-[10px] text-muted-foreground/60 pt-2">
                    ⚠ {res.data_disclaimer}
                </p>
            </div>
        );
    };

    return (
        <div className="space-y-4">
            {/* 标题栏 */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-sm font-semibold">回测结果</h2>
                    {task && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                            {task.strategy_name}
                        </p>
                    )}
                </div>
                <button
                    onClick={() => setShowSettings(v => !v)}
                    className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground border rounded-md px-2 py-1 hover:bg-accent transition-colors"
                >
                    <Settings className="h-3 w-3" />
                    {showSettings ? '收起' : '显示设置'}
                </button>
            </div>

            {/* 快速隐藏面板 */}
            {showSettings && task?.result_summary && (
                <div className="rounded-lg border p-3 bg-muted/20 space-y-2">
                    <p className="text-[10px] text-muted-foreground font-semibold">点击卡片右上角 👁 可隐藏，此处可批量恢复</p>
                    {hiddenKeys.size > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                            {[...hiddenKeys].map(key => (
                                <button
                                    key={key}
                                    onClick={() => toggleKey(key)}
                                    className="text-[10px] px-2 py-0.5 border rounded-full hover:bg-accent"
                                >
                                    恢复 {key}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <p className="text-[10px] text-muted-foreground">当前无隐藏的窗口</p>
                    )}
                </div>
            )}

            {renderContent()}
        </div>
    );
}
