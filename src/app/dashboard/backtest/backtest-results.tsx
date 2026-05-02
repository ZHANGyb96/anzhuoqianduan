'use client';

import { useMemo, useState } from 'react';
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, BarChart, Clock, TrendingUp, TrendingDown, Settings, Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useBacktestTaskStore } from '@/store/useBacktestTaskStore';
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';

// 周期级别：N根K线后，语义随主周期变化（日线=N天，60分钟=N×60分钟）
const cycleHoldingPeriods =[
  { id: 'c_3',  value: 3,  label: '3个周期'  },
  { id: 'c_6',  value: 6,  label: '6个周期'  },
  { id: 'c_9',  value: 9,  label: '9个周期'  },
  { id: 'c_12', value: 12, label: '12个周期' },
  { id: 'c_15', value: 15, label: '15个周期' },
  { id: 'c_18', value: 18, label: '18个周期' },
  { id: 'c_24', value: 24, label: '24个周期' },
  { id: 'c_30', value: 30, label: '30个周期' },
];

// 分钟级别：固定N分钟后（仅在主周期≤1分钟时精确，其余视为约N分钟后）
const minuteHoldingPeriods =[
  { id: 'm_5',   value: 5,   label: '5分钟内'   },
  { id: 'm_15',  value: 15,  label: '15分钟内'  },
  { id: 'm_30',  value: 30,  label: '30分钟内'  },
  { id: 'm_60',  value: 60,  label: '60分钟内'  },
  { id: 'm_120', value: 120, label: '120分钟内' },
  { id: 'm_240', value: 240, label: '240分钟内' },
];

// 合并，用于设置面板
const allHoldingPeriods =[
  ...cycleHoldingPeriods.map(p => ({ ...p, type: 'cycle' as const })),
  ...minuteHoldingPeriods.map(p => ({ ...p, type: 'minute' as const })),
];

// 定义后端返回的结果接口
interface BacktestResult {
  total_signals: number;
  // 周期级别 key：c3/c6/c9/c12/c15/c18/c24/c30[key: `win_rate_c${number}`]:     number;
  [key: `win_count_c${number}`]:    number;
  [key: `avg_win_pnl_c${number}`]:  number | null;[key: `loss_count_c${number}`]:   number;[key: `avg_loss_pnl_c${number}`]: number | null;[key: `avg_mfe_c${number}`]:      number | null;[key: `avg_mae_c${number}`]:      number | null;
  // 分钟级别 key：m5/m15/m30/m60/m120/m240[key: `win_rate_m${number}`]:     number;
  [key: `win_count_m${number}`]:    number;
  [key: `avg_win_pnl_m${number}`]:  number | null;
  [key: `loss_count_m${number}`]:   number;[key: `avg_loss_pnl_m${number}`]: number | null;[key: `avg_mfe_m${number}`]:      number | null;[key: `avg_mae_m${number}`]:      number | null;
  signal_times?: string[];
}

const PeriodResultCard = ({
    period,
    winRate,
    winCount,
    avgWinPnl,
    lossCount,
    avgLossPnl,
    avgMfe,
    avgMae,
}: {
    period: string;
    winRate: number;
    winCount: number;
    avgWinPnl: number | null;
    lossCount: number;
    avgLossPnl: number | null;
    avgMfe: number | null;
    avgMae: number | null;
}) => {
    const lossRate = 100 - winRate;
    const avgWinPnlDisplay = avgWinPnl ?? 0;
    const avgLossPnlDisplay = avgLossPnl ?? 0;
    const avgMfeDisplay = avgMfe ?? 0;
    const avgMaeDisplay = avgMae ?? 0;

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base font-bold">{period}</CardTitle>
                <BarChart className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-3">
                {/* Up section */}
                <div className="bg-red-500/5 dark:bg-red-500/10 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-red-500" />
                        <span className="font-semibold text-red-500">上涨 {winRate.toFixed(1)}%</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
                        <div>
                            <span className="text-muted-foreground">次数:</span>
                            <p className="font-semibold text-foreground">{winCount}</p>
                        </div>
                        <div className="text-right">
                            <span className="text-muted-foreground">平均:</span>
                            <p className="font-semibold text-red-500">{avgWinPnlDisplay.toFixed(2)}%</p>
                        </div>
                    </div>
                </div>

                {/* Down section */}
                <div className="bg-green-500/5 dark:bg-green-500/10 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                        <TrendingDown className="h-5 w-5 text-green-500" />
                        <span className="font-semibold text-green-500">下跌 {lossRate.toFixed(1)}%</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
                         <div>
                            <span className="text-muted-foreground">次数:</span>
                            <p className="font-semibold text-foreground">{lossCount}</p>
                        </div>
                        <div className="text-right">
                            <span className="text-muted-foreground">平均:</span>
                            <p className="font-semibold text-green-500">{avgLossPnlDisplay.toFixed(2)}%</p>
                        </div>
                    </div>
                </div>
                
                {/* Progress Bar */}
                <div className="pt-1">
                    <Progress value={winRate} className="h-2 [&>div]:bg-red-500" />
                </div>

                {/* Risk Metrics */}
                <div className="grid grid-cols-2 gap-2 mt-2 pt-3 border-t text-xs">
                    <div>
                        <span className="text-muted-foreground block mb-0.5">最大潜在盈利 (MFE)</span>
                        <p className="font-semibold text-red-500">+{avgMfeDisplay.toFixed(2)}%</p>
                    </div>
                    <div className="text-right">
                        <span className="text-muted-foreground block mb-0.5">最大潜在亏损 (MAE)</span>
                        <p className="font-semibold text-green-500">{avgMaeDisplay.toFixed(2)}%</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

export default function BacktestResults() {
  const { task, error, taskId } = useBacktestTaskStore();

  const [visiblePeriods, setVisiblePeriods] = useState<Record<string, boolean>>({
    'c_3': true, 'c_6': true, 'c_9': true, 'c_12': true,
    'c_15': true, 'c_18': true, 'c_24': true, 'c_30': true,
    'm_5': true, 'm_15': true, 'm_30': true,
    'm_60': true, 'm_120': true, 'm_240': true,
  });

  const handleVisibilityChange = (id: string, checked: boolean) => {
    setVisiblePeriods(prev => ({ ...prev, [id]: checked }));
  };

  const isLoading = useMemo(() => {
    return task?.status === 'PENDING' || task?.status === 'RUNNING';
  }, [task?.status]);
  
  const renderContent = () => {
    if (!taskId) {
        return <div className="text-center text-muted-foreground py-10">提交一个策略以查看其历史表现统计。</div>;
    }
    
    if (error) {
        return (
        <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>错误</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
        </Alert>
        );
    }

    if (isLoading) {
        return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 text-primary">
            <Clock className="h-5 w-5 animate-spin" />
            <p className="font-semibold">正在执行回测，请稍候...</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-80 w-full" />)}
            </div>
        </div>
        );
    }

    if (task?.status === 'FAILED') {
        return (
        <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>任务执行失败</AlertTitle>
            <AlertDescription>{task.result_summary?.error || '未知错误，请检查后端日志。'}</AlertDescription>
        </Alert>
        );
    }

    if (task?.status === 'COMPLETED' && task.result_summary) {
        const results = task.result_summary as unknown as BacktestResult;
        
        if (results.total_signals === 0) {
            return (
                <div className="text-center text-muted-foreground pt-10">
                    <BarChart className="mx-auto h-12 w-12 text-muted-foreground" />
                    <h3 className="mt-4 text-lg font-semibold">沒有找到信号</h3>
                    <p>在历史数据中，该策略未触发任何入场信号。请尝试调整您的策略条件。</p>
                </div>
            )
        }

        // 分别构建周期级和分钟级数据，key格式与Python保持一致：c3/m5 等
        const buildPeriodData = (periods: typeof allHoldingPeriods, prefix: 'c' | 'm') =>
            periods
                .filter(p => p.type === (prefix === 'c' ? 'cycle' : 'minute'))
                .map(p => {
                    const key = `${prefix}${p.value}`;
                    const winRate = results[`win_rate_${key}` as keyof BacktestResult] as number;
                    if (winRate == null) return null;
                    return {
                        ...p,
                        winRate,
                        winCount:    results[`win_count_${key}`   as keyof BacktestResult] as number,
                        avgWinPnl:   results[`avg_win_pnl_${key}` as keyof BacktestResult] as number | null,
                        lossCount:   results[`loss_count_${key}`  as keyof BacktestResult] as number,
                        avgLossPnl:  results[`avg_loss_pnl_${key}`as keyof BacktestResult] as number | null,
                        avgMfe:      results[`avg_mfe_${key}`     as keyof BacktestResult] as number | null,
                        avgMae:      results[`avg_mae_${key}`     as keyof BacktestResult] as number | null,
                    };
                })
                .filter((p): p is NonNullable<typeof p> => p !== null && visiblePeriods[p.id]);

        const cycleData  = buildPeriodData(allHoldingPeriods, 'c');
        const minuteData = buildPeriodData(allHoldingPeriods, 'm');

        return (
          <div className="space-y-6">
            <div className="text-sm text-muted-foreground font-semibold">
              {task.strategy_params.stockCode} - {task.strategy_params.period} | 总信号数: {results.total_signals}
            </div>
            <Alert className="bg-blue-500/5 border-blue-500/30 text-blue-900/80 dark:text-blue-300/80">
              <Info className="h-4 w-4 text-blue-500" />
              <AlertDescription className="text-xs">
                <strong>周期级</strong>：N个周期后的收益（日线=N天，60分钟线=N×60分钟）。<br />
                <strong>分钟级</strong>：固定N分钟后的收益（当主周期为1分钟时最精确）。
              </AlertDescription>
            </Alert>

            {cycleData.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3">周期级持仓</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  {cycleData.map(p => (
                    <PeriodResultCard key={p.id} period={p.label} winRate={p.winRate}
                      winCount={p.winCount} avgWinPnl={p.avgWinPnl} lossCount={p.lossCount}
                      avgLossPnl={p.avgLossPnl} avgMfe={p.avgMfe} avgMae={p.avgMae} />
                  ))}
                </div>
              </div>
            )}

            {minuteData.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3">分钟级持仓</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  {minuteData.map(p => (
                    <PeriodResultCard key={p.id} period={p.label} winRate={p.winRate}
                      winCount={p.winCount} avgWinPnl={p.avgWinPnl} lossCount={p.lossCount}
                      avgLossPnl={p.avgLossPnl} avgMfe={p.avgMfe} avgMae={p.avgMae} />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
    }
    return null;
  }

  return (
      <Card className="min-h-[400px]">
        <CardHeader className="flex-row items-center justify-between">
            <div>
                <CardTitle>回测结果</CardTitle>
                {task && <CardDescription>正在分析任务 #{task.task_id} ({task.strategy_name})</CardDescription>}
            </div>
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
                        <Settings className="h-4 w-4" />
                        <span>设置显示周期</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80">
                    <div className="grid gap-4">
                        <div className="space-y-2">
                            <h4 className="font-medium leading-none">选择周期</h4>
                            <p className="text-sm text-muted-foreground">
                                选择您想在结果中看到的持仓周期。
                            </p>
                        </div>
                        <ScrollArea className="h-48">
                            <div className="grid grid-cols-2 gap-4 p-1">
                                {allHoldingPeriods.map(p => (
                                    <div key={p.id} className="flex items-center space-x-2">
                                        <Checkbox 
                                            id={`period-${p.id}`}
                                            checked={!!visiblePeriods[p.id]}
                                            onCheckedChange={(checked) => handleVisibilityChange(p.id, !!checked)}
                                        />
                                        <Label htmlFor={`period-${p.id}`} className="text-sm font-normal">{p.label}</Label>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>
                </PopoverContent>
            </Popover>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
  )
}