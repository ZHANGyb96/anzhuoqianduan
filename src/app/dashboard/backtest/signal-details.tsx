'use client';

/**
 * signal-details.tsx
 *
 * 信号明细组件
 * ─────────────────────────────────────
 * 新增功能：
 *  1. filterWindow prop：只显示特定窗口（如 c3 / m60）的列，实现精准筛选
 *  2. onBack prop：返回上一层（回测结果列表）
 *  3. onGoToChart prop：点击某行跳转到图表对应时间 K 线
 *  4. 历史模式（overrideTask）：从历史记录回放时使用
 */

import { useEffect, useState, useMemo } from 'react';
import { useBacktestTaskStore } from '@/store/useBacktestTaskStore';
import { useAuthStore } from '@/store/useAuthStore';
import { API_URL } from '@/config/constants';
import { isCapacitor } from '@/config/platform';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChevronLeft, ChevronRight, FileSearch, TrendingUp, TrendingDown, LineChart } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ─── 持仓周期配置（保持原有，兼容 Web 端）────────────────────────────────────

const holdingPeriodsConfig = [
  { value: 1,   label: '1周期',   type: 'cycle'  },
  { value: 3,   label: '3周期',   type: 'cycle'  },
  { value: 6,   label: '6周期',   type: 'cycle'  },
  { value: 9,   label: '9周期',   type: 'cycle'  },
  { value: 12,  label: '12周期',  type: 'cycle'  },
  { value: 5,   label: '5分钟',   type: 'minute' },
  { value: 10,  label: '10分钟',  type: 'minute' },
  { value: 15,  label: '15分钟',  type: 'minute' },
  { value: 30,  label: '30分钟',  type: 'minute' },
  { value: 60,  label: '60分钟',  type: 'minute' },
  { value: 120, label: '120分钟', type: 'minute' },
  { value: 240, label: '240分钟', type: 'minute' },
].sort((a, b) => {
  if (a.type === 'cycle' && b.type === 'minute') return -1;
  if (a.type === 'minute' && b.type === 'cycle') return 1;
  return a.value - b.value;
});

type Signal = { time: string; [key: string]: any };
type Pagination = { page: number; limit: number; total: number; totalPages: number };

const formatRawDbTime = (timeStr: string) => {
  if (!timeStr) return '-';
  return timeStr.replace('T', ' ').replace(/\..+/, '').replace('Z', '');
};

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface FilterWindow {
  key:   string;  // e.g. 'c3' or 'm60'
  label: string;  // e.g. '3根K线' or '60分钟'
}

interface SignalDetailsProps {
  /** 当设置时，只显示该窗口的信号列 */
  filterWindow?: FilterWindow;
  /** 点击返回键 */
  onBack?: () => void;
  /** 点击某条信号跳转到图表 */
  onGoToChart?: (stockCode: string, period: string, time: string) => void;
  /** 历史模式：外部传入 task（不从 store 读取） */
  overrideTask?: any;
}

// ─── 主组件 ─────────────────────────────────────────────────────────────────────

export default function SignalDetails({
  filterWindow,
  onBack,
  onGoToChart,
  overrideTask,
}: SignalDetailsProps) {
  const { task, taskId } = useBacktestTaskStore();
  const token = useAuthStore(state => state.token);

  const activeTask = overrideTask ?? task;
  const activeTaskId = activeTask?.task_id ?? taskId;

  const [signals,    setSignals]    = useState<Signal[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [isLoading,  setIsLoading]  = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [page,       setPage]       = useState(1);
  const limit = 20;

  const isTaskCompleted = activeTask?.status === 'COMPLETED';

  // taskId 变化时重置
  useEffect(() => {
    setSignals([]);
    setPagination(null);
    setPage(1);
    setError(null);
  }, [activeTaskId]);

  // 获取信号数据
  useEffect(() => {
    const fetchSignals = async () => {
      if (!isTaskCompleted || !activeTaskId || !token) return;
      setIsLoading(true);
      setError(null);
      try {
        if (isCapacitor || overrideTask) {
          // 移动端 / 历史模式：直接从 task 内存切片分页
          const allSignals = activeTask?.result_summary?.signal_details ?? [];
          const totalSignals = activeTask?.result_summary?.signal_details_total ?? allSignals.length;
          const totalPages = Math.ceil(totalSignals / limit) || 1;
          const offset = (page - 1) * limit;
          const paginatedData = allSignals.slice(offset, offset + limit);
          setSignals(paginatedData);
          setPagination({ page, limit, total: totalSignals, totalPages });
        } else {
          // Web 端：发送网络请求
          const res = await fetch(
            `${API_URL}/api/v1/tasks/${activeTaskId}/signals?page=${page}&limit=${limit}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!res.ok) {
            if (res.status === 401 || res.status === 403) useAuthStore.getState().logout();
            const body = await res.json();
            throw new Error(body.message || '获取信号详情失败');
          }
          const result = await res.json();
          setSignals(result.data);
          setPagination(result.pagination);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSignals();
  }, [isTaskCompleted, activeTaskId, page, token, activeTask, overrideTask]);

  // ── 推断当前 task 的主周期（用于图表跳转）──────────────────────────────
  const mainPeriod: string = useMemo(() => {
    return activeTask?.result_summary?.main_period
      ?? activeTask?.strategy_params?.mainPeriod
      ?? activeTask?.strategy_params?.period
      ?? '1d';
  }, [activeTask]);

  // ── 当有 filterWindow 时，筛选并决定展示哪些列 ─────────────────────────
  const isMinuteWindow = filterWindow?.key.startsWith('m');

  // 若有筛选窗口，只展示该窗口有数据的行
  const filteredSignals = useMemo(() => {
    if (!filterWindow) return signals;
    const pnlKey = `pnl_${filterWindow.key}`;
    return signals.filter(s => s[pnlKey] !== undefined);
  }, [signals, filterWindow]);

  // 无筛选时：推断可见周期（原有逻辑）
  const visiblePeriods = useMemo(() => {
    if (filterWindow || !signals.length) return [];
    const firstSignal = signals[0];
    return holdingPeriodsConfig.filter(p => {
      const key = `pnl_${p.type === 'cycle' ? 'c' : 'm'}${p.value}`;
      return key in firstSignal;
    });
  }, [signals, filterWindow]);

  // ── renderContent ────────────────────────────────────────────────────────

  const renderContent = () => {
    if (!activeTaskId || !isTaskCompleted) {
      return (
        <div className="text-center text-muted-foreground py-10">
          <FileSearch className="mx-auto h-12 w-12 opacity-30" />
          <h3 className="mt-4 text-lg font-semibold">无信号详情</h3>
          <p className="text-sm">完成一次回测后，此处将显示详细的信号触发记录。</p>
        </div>
      );
    }

    if (isLoading) {
      return (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      );
    }

    if (error) {
      return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;
    }

    if (filteredSignals.length === 0 && pagination?.total === 0) {
      return (
        <div className="text-center text-muted-foreground py-10">
          <FileSearch className="mx-auto h-12 w-12 opacity-30" />
          <h3 className="mt-4 text-lg font-semibold">无信号</h3>
          <p className="text-sm">该策略未触发任何入场信号。</p>
        </div>
      );
    }

    // ── 筛选窗口模式：只显示该窗口的 3 列 ────────────────────────────────
    if (filterWindow) {
      const pnlKey  = `pnl_${filterWindow.key}`;
      const highKey = `high_${filterWindow.key}`;
      const lowKey  = `low_${filterWindow.key}`;

      return (
        <>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs w-[38%]">时间</TableHead>
                  <TableHead className="text-xs w-[18%]">品种</TableHead>
                  <TableHead className="text-xs text-right w-[18%]">收益%</TableHead>
                  <TableHead className="text-xs text-right w-[14%]">最高涨%</TableHead>
                  <TableHead className="text-xs text-right w-[12%]">最大跌%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSignals.map((signal, i) => {
                  const pnl  = signal[pnlKey];
                  const high = signal[highKey];
                  const low  = signal[lowKey];
                  const isWin = typeof pnl === 'number' && pnl > 0;
                  return (
                    <TableRow
                      key={i}
                      className="cursor-pointer hover:bg-muted/30 active:bg-muted/50 transition-colors"
                      onClick={() => {
                        if (onGoToChart && signal.stock && signal.time) {
                          onGoToChart(signal.stock, mainPeriod, signal.time);
                        }
                      }}
                    >
                      <TableCell className="text-xs font-mono py-2.5">
                        <div className="flex items-center gap-1">
                          <LineChart className="h-3 w-3 text-primary/50 shrink-0" />
                          {formatRawDbTime(signal.time)}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono py-2.5">
                        {signal.stock ?? '-'}
                      </TableCell>
                      <TableCell className={cn(
                        'text-xs text-right font-semibold py-2.5',
                        isWin ? 'text-[#26c26e]' : 'text-[#ef4444]',
                      )}>
                        {typeof pnl === 'number'
                          ? `${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}%`
                          : '-'}
                      </TableCell>
                      <TableCell className="text-xs text-right py-2.5 text-[#26c26e]">
                        {typeof high === 'number' ? `+${high.toFixed(2)}%` : '-'}
                      </TableCell>
                      <TableCell className="text-xs text-right py-2.5 text-[#ef4444]">
                        {typeof low === 'number' ? `${low.toFixed(2)}%` : '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* 分页 */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline" size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="h-8 gap-1 text-xs"
              >
                <ChevronLeft className="h-3.5 w-3.5" />上一页
              </Button>
              <span className="text-xs text-muted-foreground">
                {page} / {pagination.totalPages}
              </span>
              <Button
                variant="outline" size="sm"
                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                disabled={page >= pagination.totalPages}
                className="h-8 gap-1 text-xs"
              >
                下一页<ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </>
      );
    }

    // ── 无筛选模式：原有宽表（所有周期列）────────────────────────────────
    return (
      <>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs sticky left-0 bg-card/90 z-10 min-w-[130px]">触发时间</TableHead>
                <TableHead className="text-xs min-w-[70px]">品种</TableHead>
                <TableHead className="text-xs text-right min-w-[70px]">收盘价</TableHead>
                {visiblePeriods.map(p => (
                  <TableHead key={`${p.type}${p.value}`} className="text-xs text-right min-w-[72px]">
                    {p.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {signals.map((signal, i) => (
                <TableRow
                  key={i}
                  className="cursor-pointer hover:bg-muted/30 active:bg-muted/50 transition-colors"
                  onClick={() => {
                    if (onGoToChart && signal.stock && signal.time) {
                      onGoToChart(signal.stock, mainPeriod, signal.time);
                    }
                  }}
                >
                  <TableCell className="text-xs font-mono py-2.5 sticky left-0 bg-card/90 z-10">
                    <div className="flex items-center gap-1">
                      <LineChart className="h-3 w-3 text-primary/50 shrink-0" />
                      {formatRawDbTime(signal.time)}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs font-mono py-2.5">{signal.stock ?? '-'}</TableCell>
                  <TableCell className="text-xs text-right py-2.5 font-mono">
                    {typeof signal.close === 'number' ? signal.close.toFixed(2) : '-'}
                  </TableCell>
                  {visiblePeriods.map(p => {
                    const pnlKey = `pnl_${p.type === 'cycle' ? 'c' : 'm'}${p.value}`;
                    const val = signal[pnlKey];
                    const isWin = typeof val === 'number' && val > 0;
                    return (
                      <TableCell
                        key={`${p.type}${p.value}`}
                        className={cn(
                          'text-xs text-right py-2.5 font-semibold',
                          typeof val === 'number'
                            ? isWin ? 'text-[#26c26e]' : 'text-[#ef4444]'
                            : 'text-muted-foreground'
                        )}
                      >
                        {typeof val === 'number'
                          ? `${val > 0 ? '+' : ''}${val.toFixed(2)}%`
                          : '-'}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* 分页 */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline" size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="h-8 gap-1 text-xs"
            >
              <ChevronLeft className="h-3.5 w-3.5" />上一页
            </Button>
            <span className="text-xs text-muted-foreground">
              第 {page} 页 · 共 {pagination.totalPages} 页 · {pagination.total} 条
            </span>
            <Button
              variant="outline" size="sm"
              onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
              disabled={page >= pagination.totalPages}
              className="h-8 gap-1 text-xs"
            >
              下一页<ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="space-y-4">
      {/* ── 返回键 + 标题 ──────────────────────────────────────────────── */}
      {(onBack || filterWindow) && (
        <div className="flex items-center gap-2">
          {onBack && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="h-8 gap-1 text-xs px-2 -ml-1"
            >
              <ChevronLeft className="h-4 w-4" />
              返回
            </Button>
          )}
          {filterWindow && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {filterWindow.label}
              </Badge>
              <span className="text-xs text-muted-foreground">
                — 点击信号行可跳转到对应K线图表
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── 信号列表 ─────────────────────────────────────────────────── */}
      {renderContent()}
    </div>
  );
}
