'use client';

import { useEffect, useState, useMemo } from 'react';
import { useBacktestTaskStore } from '@/store/useBacktestTaskStore';
import { useAuthStore } from '@/store/useAuthStore';
import { API_URL } from '@/config/constants';
import { isCapacitor } from '@/config/platform'; // 【新增】引入环境变量
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChevronLeft, ChevronRight, FileSearch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const holdingPeriodsConfig =[
  { value: 1, label: '1周期', type: 'cycle' },
  { value: 3, label: '3周期', type: 'cycle' },
  { value: 6, label: '6周期', type: 'cycle' },
  { value: 9, label: '9周期', type: 'cycle' },
  { value: 12, label: '12周期', type: 'cycle' },
  { value: 5, label: '5分钟', type: 'minute' },
  { value: 10, label: '10分钟', type: 'minute' },
  { value: 15, label: '15分钟', type: 'minute' },
  { value: 30, label: '30分钟', type: 'minute' },
  { value: 60, label: '60分钟', type: 'minute' },
  { value: 120, label: '120分钟', type: 'minute' },
  { value: 240, label: '240分钟', type: 'minute' },
].sort((a, b) => {
    if (a.type === 'cycle' && b.type === 'minute') return -1;
    if (a.type === 'minute' && b.type === 'cycle') return 1;
    return a.value - b.value;
});

type Signal = {
  time: string;
  [key: string]: any;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const formatRawDbTime = (timeStr: string) => {
  if (!timeStr) return '-';
  return timeStr
    .replace('T', ' ')      
    .replace(/\..+/, '')    
    .replace('Z', '');      
};

export default function SignalDetails() {
  const { task, taskId } = useBacktestTaskStore();
  const token = useAuthStore(state => state.token);

  const [signals, setSignals] = useState<Signal[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const[error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const limit = 10;

  const isTaskCompleted = task?.status === 'COMPLETED';

  useEffect(() => {
    setSignals([]);
    setPagination(null);
    setPage(1);
    setError(null);
  }, [taskId]);

  useEffect(() => {
    const fetchSignals = async () => {
      // 移动端即便不需要token发起请求，但为了保持逻辑严密，依旧保留这些基础校验
      if (!isTaskCompleted || !taskId || !token) return;

      setIsLoading(true);
      setError(null);

      try {
        // 👇 【核心修改区：加入智能分流】
        if (isCapacitor) {
          // 📱 移动端逻辑：直接从内存 Store 切片分页
          const allSignals = task?.result_summary?.signal_details ||[];
          const totalSignals = task?.result_summary?.signal_details_total || allSignals.length;
          
          const totalPages = Math.ceil(totalSignals / limit) || 1;
          const offset = (page - 1) * limit;
          const paginatedData = allSignals.slice(offset, offset + limit);

          setSignals(paginatedData);
          setPagination({
            page: page,
            limit: limit,
            total: totalSignals,
            totalPages: totalPages
          });
        } else {
          // 💻 原有电脑端逻辑：发送网络请求
          const res = await fetch(`${API_URL}/api/v1/tasks/${taskId}/signals?page=${page}&limit=${limit}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (!res.ok) {
            if (res.status === 401 || res.status === 403) useAuthStore.getState().logout();
            const errorBody = await res.json();
            throw new Error(errorBody.message || '获取信号详情失败');
          }

          const result = await res.json();
          setSignals(result.data);
          setPagination(result.pagination);
        }
        // 👆 【核心修改区结束】
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSignals();
  }, [isTaskCompleted, taskId, page, token, task]); // 添加了 task 作为依赖项

  const visiblePeriods = useMemo(() => {
    if (!signals || signals.length === 0) {
      return [];
    }
    const firstSignal = signals[0];
    
    return holdingPeriodsConfig.filter(p => {
        const key = `pnl_${p.type === 'cycle' ? 'c' : 'm'}${p.value}`;
        return key in firstSignal;
    });
  }, [signals]);

  // 下面的 renderContent 没有任何修改，完美复用你原有的逻辑
  const renderContent = () => {
    if (!taskId || !isTaskCompleted) {
      return (
        <div className="text-center text-muted-foreground py-10">
          <FileSearch className="mx-auto h-12 w-12" />
          <h3 className="mt-4 text-lg font-semibold">无信号详情</h3>
          <p className="text-sm">完成一次回测后，此处将显示详细的信号触发记录。</p >
        </div>
      );
    }
    
    if (isLoading) {
      return (
        <div className="space-y-2">
            {[...Array(limit)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      );
    }

    if (error) {
      return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;
    }
    
    if (signals.length === 0 && pagination?.total === 0) {
      return (
        <div className="text-center text-muted-foreground py-10">
            <FileSearch className="mx-auto h-12 w-12" />
            <h3 className="mt-4 text-lg font-semibold">无信号</h3>
            <p className="text-sm">在历史数据中，该策略未触发任何入场信号。</p >
        </div>
      );
    }

    return (
      <>
        <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead className="w-[200px]">触发时间</TableHead>
                    {visiblePeriods.map(p => (
                        <TableHead key={p.value} className="text-right">{p.label}后</TableHead>
                    ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {signals.map((signal, index) => (
                    <TableRow key={`${signal.time}-${index}`}>
                        <TableCell className="font-medium font-mono text-blue-400">
                            {formatRawDbTime(signal.time)}
                        </TableCell>
                        {visiblePeriods.map(p => {
                            const key = `pnl_${p.type === 'cycle' ? 'c' : 'm'}${p.value}`;
                            const pnl = signal[key];
                            return (
                                <TableCell key={p.value} className={`text-right font-mono ${pnl === null || pnl === undefined ? 'text-muted-foreground' : pnl > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                    {pnl !== null && pnl !== undefined ? `${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}%` : '-'}
                                </TableCell>
                            );
                        })}
                    </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
        <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-muted-foreground">
                总计 <Badge variant="secondary">{pagination?.total ?? 0}</Badge> 条信号
            </div>
            <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(page - 1)} disabled={!pagination || page <= 1}>
                    <ChevronLeft className="h-4 w-4" />
                    <span className="ml-1">上一页</span>
                </Button>
                <span className="text-sm text-muted-foreground">
                    第 {pagination?.page ?? '-'} / {pagination?.totalPages ?? '-'} 页
                </span>
                <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={!pagination || page >= pagination.totalPages}>
                    <span className="mr-1">下一页</span>
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
      </>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>信号详情</CardTitle>
        <CardDescription>每次策略条件被满足时的详细涨跌幅记录。</CardDescription>
      </CardHeader>
      <CardContent>
        {renderContent()}
      </CardContent>
    </Card>
  );
}