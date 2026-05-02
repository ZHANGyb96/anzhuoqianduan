'use client';

import { useEffect, useState } from 'react';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, ServerCrash, Zap, Trash2, RefreshCcw, Lock } from "lucide-react";
import { useLicenseStore } from '@/store/useLicenseStore';
import { useAuthStore } from '@/store/useAuthStore';
import { API_URL } from '@/config/constants';
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useMarketDataStore } from '@/store/useMarketDataStore';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

// 引入移动端处理所需的包
import { isCapacitor } from '@/config/platform';
import { syncStockToMobile } from '@/lib/mobile-market-data';
import { getMobileDB } from '@/lib/mobile-db';

const periodsOptions =[
    { id: '1m', label: '1分钟', minTier: 'PRO' },
    { id: '5m', label: '5分钟', minTier: 'PRO' },
    { id: '15m', label: '15分钟', minTier: 'PRO' },
    { id: '30m', label: '30分钟', minTier: 'PRO' },
    { id: '60m', label: '60分钟', minTier: 'PRO' },
    { id: '120m', label: '120分钟', minTier: 'PRO' },
    { id: '240m', label: '240分钟', minTier: 'PRO' },
    { id: '1d', label: '日线', minTier: 'BASIC' },
    { id: '1w', label: '周线', minTier: 'BASIC' },
    { id: '1M', label: '月线', minTier: 'BASIC' },
];

const dataSyncSchema = z.object({
  symbol: z.string().min(1, "品种代码不能为空").max(20, "代码过长"),
  name: z.string().optional(),
  duration: z.string().min(1, "必须选择一个数据时长"),
  periods: z.array(z.string()).refine((value) => value.length > 0, {
    message: "你必须至少选择一个时间周期。",
  }),
});
type DataSyncFormValues = z.infer<typeof dataSyncSchema>;


export default function DataManagementPage() {
  const { tier } = useLicenseStore();
  const isBasic = tier === 'BASIC';
  
  const [isClient, setIsClient] = useState(false);
  const[isProcessing, setIsProcessing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [symbolToDelete, setSymbolToDelete] = useState('');
  const [log, setLog] = useState('');
  const [error, setError] = useState('');
  const token = useAuthStore(state => state.token);
  const { toast } = useToast();
  const { availableSymbols, fetchSymbols, error: symbolsError, isLoading: symbolsLoading } = useMarketDataStore();

  useEffect(() => {
    setIsClient(true);
  },[]);

  useEffect(() => {
    if (isClient && (token || isCapacitor)) { // 修改点：移动端可能跳过远程Token检查
        fetchSymbols();
    }
  }, [isClient, token, fetchSymbols]);


  const stockSyncForm = useForm<DataSyncFormValues>({
    resolver: zodResolver(dataSyncSchema),
    defaultValues: {
      symbol: '002030',
      name: '',
      duration: '1y',
      periods: isBasic ? ['1d', '1w', '1M'] :['1m', '5m', '15m', '30m', '60m', '120m', '240m', '1d', '1w', '1M'],
    },
  });

  const futureSyncForm = useForm<DataSyncFormValues>({
    resolver: zodResolver(dataSyncSchema),
    defaultValues: {
      symbol: 'SA',
      name: '',
      duration: '1y',
      periods: isBasic ? ['1d', '1w', '1M'] :['1m', '5m', '15m', '30m', '60m', '120m', '240m', '1d', '1w', '1M'],
    },
  });

  const handleStreamingResponse = async (response: Response) => {
    if (!response.body) {
        throw new Error("响应体为空，无法读取流式数据。");
    }
    
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let accumulatedLog = '';
    
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        accumulatedLog += value;
        setLog(accumulatedLog);
    }
    
    if (accumulatedLog.includes('PYTHON_SCRIPT_FAILED_WITH_EXCEPTION') || accumulatedLog.includes('任务失败')) {
        setError("任务执行失败，请检查日志了解详情。");
    } else {
        toast({ title: "任务成功", description: "数据操作已成功完成。" });
        fetchSymbols(); 
    }
  };

  const onSyncSubmit = async (data: DataSyncFormValues) => {
    setIsProcessing(true);
    setLog('');
    setError('');
 
    // --- 移动端执行分支 ---
    if (isCapacitor) {
        let successCount = 0;
        let failCount = 0;
 
        try {
            for (const period of data.periods) {
                try {
                    await syncStockToMobile(
                        data.symbol,
                        data.name ?? '',
                        period,
                        (msg) => setLog(prev => prev + msg + '\n')
                    );
                    // ✅ 判断日志里是否有"写入成功"来统计
                    successCount++;
                } catch (err: any) {
                    failCount++;
                    setLog(prev => prev + `\n[ERROR] ${period}: ${err.message}\n`);
                }
            }
 
            await fetchSymbols();
 
            // ✅ 修复误导性 Toast：只有真的写入了数据才显示成功
            if (successCount > 0 && failCount === 0) {
                toast({ title: '同步完成', description: `已将 ${data.symbol} 数据写入移动端数据库。` });
            } else if (successCount > 0 && failCount > 0) {
                toast({ 
                    title: '部分成功', 
                    description: `成功 ${successCount} 个周期，失败 ${failCount} 个周期，请查看日志。`,
                    variant: 'default',
                });
            } else {
                // 全部无数据或失败
                setError(`所有周期均未获取到数据，请检查：1) 股票代码是否正确 2) 网络是否畅通 3) 查看日志中的响应预览`);
                toast({ 
                    title: '同步失败', 
                    description: '服务器未返回有效数据，详见运行日志。',
                    variant: 'destructive',
                });
            }
        } catch (err: any) {
            setError(err.message);
            setLog(prev => prev + `\n\n[ERROR] ${err.message}`);
        } finally {
            setIsProcessing(false);
        }
        return;
    }
    // ----------------------------

    // 以下为原有 Web 逻辑
    try {
      const response = await fetch(`${API_URL}/api/v1/data/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || '服务器返回了错误状态。');
      }

      await handleStreamingResponse(response);

    } catch (err: any) {
        let errorMessage = err.message;
        try {
            const errorJson = JSON.parse(err.message);
            errorMessage = errorJson.message || err.message;
        } catch (e) {}

        if (String(errorMessage).includes('Failed to fetch')) {
             errorMessage = '无法连接到后端服务。请确认 Node.js API 服务正在运行。';
        }
        setError(errorMessage);
        setLog(prev => prev + `\n\n[ERROR] ${errorMessage}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const onSyncAllSubmit = async () => {
    setIsProcessing(true);
    setLog('');
    setError('');

    // 💥[移动端本地拦截优化]
    if (isCapacitor) {
        try {
            if (availableSymbols.length === 0) {
                throw new Error("当前手机内并无任何品种基础包！无法一键顺移更新。请先新增！");
            }

            setLog("[开始脱壳本地一键热更队列]\n=====================\n");

            for (const sym of availableSymbols) {
                setLog(prev => prev + `\n--- 准备全局更新: ${sym.label} --- \n`);

                // 获取常规周期进行一键全洗覆盖
                const defaultPeriods = isBasic ? ['1d', '1w', '1M'] : ['1d', '60m', '30m', '15m'];

                for (const p of defaultPeriods) {
                    await syncStockToMobile(sym.value, '', p, (msg) => {
                        setLog(prev => prev + msg + '\n'); // 每个周期实时追加日志
                    });
                }

                // 每个符号同步完后即时刷新 symbol 列表和 toast 提示
                await fetchSymbols();
                toast({ 
                    title: `同步完成: ${sym.label}`, 
                    description: `已经完成 ${sym.label} 的本地更新。` 
                });
            }

            toast({ 
                title: "全局数据刷新完成", 
                description: "已经利用纯前端向公开接口完成了历史拼续。" 
            });
        } catch (e: any) {
            setError(e.message);
            setLog(prev => prev + `\n[ERROR] ${e.message}`);
            toast({ variant: 'destructive', title: '同步失败', description: e.message });
        } finally {
            setIsProcessing(false);
        }
        return; // 阻断 Web 端同步逻辑
    }

    // ▼ ▼ ▼ ▼ 下面的 Web 逻辑保持原样 ▼ ▼ ▼ ▼
    try {
        const response = await fetch(`${API_URL}/api/v1/data/sync-all`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-client-id': 'web-browser-v1'
            }
        });

        if (response.status === 429) {
            const data = await response.json();
            throw new Error(data.message);
        }

        if (!response.ok) {
            throw new Error('批量同步请求失败。');
        }

        await handleStreamingResponse(response);

    } catch (err: any) {
        setError(err.message);
        setLog(`[ERROR] ${err.message}`);
        toast({ variant: 'destructive', title: '限制提示', description: err.message });
    } finally {
        setIsProcessing(false);
    }
};


  const handleDeleteSymbol = async () => {
    if (!symbolToDelete) {
        toast({ variant: 'destructive', title: '错误', description: '请先选择一个要删除的品种。' });
        return;
    }
    
    // 如果是Web版要求提供token校验；若是Capacitor且只是全本地也可做绕过。这里做双相兼容：
    if (!token && !isCapacitor) {
        toast({ variant: 'destructive', title: '错误', description: '用户未登录' });
        return;
    }
    
    setIsDeleting(true);
    setLog('');
    setError('');

    // --- 新增：移动端 SQLite 物理删除分支 ---
    if (isCapacitor) {
      try {
        const db = await getMobileDB();
        await db.run(
            'DELETE FROM kline_metrics WHERE stock_code = ?', 
            [symbolToDelete]
        );
        toast({ title: '删除成功' });
        await fetchSymbols();
        setSymbolToDelete('');
      } catch (error: any) {
        setError(error.message);
        setLog(`[ERROR] ${error.message}`);
      } finally {
        setIsDeleting(false);
      }
      return; // 终止原有请求后端的操作
    }
    // ----------------------------------------

    // 原有后端 Web 删除请求逻辑
    try {
        const response = await fetch(`${API_URL}/api/v1/market-data/${symbolToDelete}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || '服务器返回了错误状态。');
        }

        setLog(`[SUCCESS] ${result.message}`);
        toast({ title: "删除成功", description: result.message });
        fetchSymbols(); 
        setSymbolToDelete(''); 

    } catch (error: any) {
        let errorMessage = error.message;
        if (String(errorMessage).includes('Failed to fetch')) {
             errorMessage = '无法连接到后端服务。请确认 Node.js API 服务正在运行。';
        }
        setError(errorMessage);
        setLog(`[ERROR] ${errorMessage}`);
    } finally {
        setIsDeleting(false);
    }
  };

  const renderContent = () => {
    if (!isClient) {
        return (
            <div className="flex h-[50vh] w-full flex-col items-center justify-center p-4 text-muted-foreground">
              <Loader2 className="h-12 w-12 animate-spin" />
              <h3 className="mt-4 text-lg font-semibold">
                正在加载数据管理模块...
              </h3>
            </div>
        );
    }
    
    if (symbolsLoading) {
        return (
            <div className="flex h-[50vh] w-full flex-col items-center justify-center p-4 text-muted-foreground">
              <Loader2 className="h-12 w-12 animate-spin" />
              <h3 className="mt-4 text-lg font-semibold">
                正在加载可用数据...
              </h3>
            </div>
        );
    }

    if (symbolsError) {
        return (
            <Alert variant="destructive" className="m-4 lg:m-0">
                <ServerCrash className="h-4 w-4" />
                <AlertTitle>数据加载失败</AlertTitle>
                <AlertDescription>
                    {symbolsError}
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
            <Card className={cn("border-primary/20 bg-primary/5", isBasic && "opacity-60 grayscale bg-muted/20")}>
                <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                            <RefreshCcw className="h-5 w-5 text-primary" />
                            全局一键增量更新
                        </span>
                        {isBasic && <Lock className="h-4 w-4 text-primary" />}
                    </CardTitle>
                    <CardDescription>自动读取库内所有品种，串行获取最新数据。{isBasic ? "升级 PRO 版解锁此功能。" : "上午/下午各限执行一次。"}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-4">
                        <div className="text-sm text-muted-foreground bg-background/50 p-3 rounded-md border border-dashed">
                            当前库内存有 <span className="font-bold text-primary">{availableSymbols.length}</span> 个品种。
                            点击下方按钮将开始自动化同步流程，期间请保持网络连接。
                        </div>
                        <Button 
                            size="lg" 
                            className="w-full font-bold" 
                            disabled={isBasic || isProcessing || isDeleting || availableSymbols.length === 0}
                            onClick={onSyncAllSubmit}
                        >
                            {isProcessing ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> 正在批量同步...</> : "一键更新库内所有品种"}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>同步股票数据 </CardTitle>
                    <CardDescription>自动获取A股数据。分钟线仅含近期数据，日线可获取更长历史。</CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...stockSyncForm}>
                        <form onSubmit={stockSyncForm.handleSubmit(onSyncSubmit)} className="space-y-6">
                            <FormField control={stockSyncForm.control} name="symbol" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>股票代码</FormLabel>
                                    <FormControl><Input placeholder="例如: 002030, 600519" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={stockSyncForm.control} name="name" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>股票名称 (可选)</FormLabel>
                                    <FormControl><Input placeholder="例如: 万科A, 达安基因" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={stockSyncForm.control} name="duration" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>日线数据时长</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                        <SelectContent>
                                            <SelectItem value="120d">近120天</SelectItem>
                                            <SelectItem value="1y">近1年</SelectItem>
                                            <SelectItem value="3y">近3年</SelectItem>
                                            <SelectItem value="all">全部历史</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )} />
                             <FormField
                                control={stockSyncForm.control}
                                name="periods"
                                render={() => (
                                    <FormItem>
                                        <div className="mb-4">
                                            <FormLabel>时间周期 (分钟线仅含近期数据)</FormLabel>
                                            <p className="text-sm text-muted-foreground">选择需要同步的时间周期。</p>
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                            {periodsOptions.map((item) => {
                                                const locked = item.minTier === 'PRO' && isBasic;
                                                return (
                                                    <FormField
                                                        key={item.id}
                                                        control={stockSyncForm.control}
                                                        name="periods"
                                                        render={({ field }) => {
                                                            return (
                                                                <FormItem
                                                                    key={item.id}
                                                                    className="flex flex-row items-center space-x-2 space-y-0"
                                                                >
                                                                    <FormControl>
                                                                        <Checkbox
                                                                            disabled={locked}
                                                                            checked={field.value?.includes(item.id)}
                                                                            onCheckedChange={(checked) => {
                                                                                const newPeriods = checked
                                                                                    ?[...field.value, item.id]
                                                                                    : field.value?.filter(
                                                                                        (value) => value !== item.id
                                                                                      );
                                                                                field.onChange(newPeriods);
                                                                            }}
                                                                        />
                                                                    </FormControl>
                                                                    <FormLabel className={cn("font-normal", locked && "text-muted-foreground line-through")}>
                                                                        {item.label} {locked && "🔒"}
                                                                    </FormLabel>
                                                                </FormItem>
                                                            )
                                                        }}
                                                    />
                                                );
                                            })}
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <Button type="submit" size="lg" className="w-full" disabled={isProcessing || isDeleting}>
                                {isProcessing ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> 正在同步...</> : <><Zap className="mr-2 h-5 w-5" /> 同步股票数据</>}
                            </Button>
                        </form>
                    </Form>
                </CardContent>
            </Card>

             <Card>
                <CardHeader>
                    <CardTitle>同步期货数据 </CardTitle>
                    <CardDescription>自动获取国内期货数据。分钟线仅含近期数据，日线可获取更长历史。</CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...futureSyncForm}>
                        <form onSubmit={futureSyncForm.handleSubmit(onSyncSubmit)} className="space-y-6">
                            <FormField control={futureSyncForm.control} name="symbol" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>期货代码</FormLabel>
                                    <FormControl><Input placeholder="例如: SA, m, rb" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={futureSyncForm.control} name="name" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>期货名称 (可选)</FormLabel>
                                    <FormControl><Input placeholder="例如: 纯碱, 豆粕, 螺纹钢" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={futureSyncForm.control} name="duration" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>日线数据时长</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                        <SelectContent>
                                            <SelectItem value="120d">近120天</SelectItem>
                                            <SelectItem value="1y">近1年</SelectItem>
                                            <SelectItem value="3y">近3年</SelectItem>
                                            <SelectItem value="all">全部历史</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )} />
                             <FormField
                                control={futureSyncForm.control}
                                name="periods"
                                render={() => (
                                    <FormItem>
                                        <div className="mb-4">
                                            <FormLabel>时间周期 (分钟线仅含近期数据)</FormLabel>
                                            <p className="text-sm text-muted-foreground">选择需要同步的时间周期。</p>
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                            {periodsOptions.map((item) => {
                                                const locked = item.minTier === 'PRO' && isBasic;
                                                return (
                                                    <FormField
                                                        key={item.id}
                                                        control={futureSyncForm.control}
                                                        name="periods"
                                                        render={({ field }) => {
                                                            return (
                                                                <FormItem
                                                                    key={item.id}
                                                                    className="flex flex-row items-center space-x-2 space-y-0"
                                                                >
                                                                    <FormControl>
                                                                        <Checkbox
                                                                            disabled={locked}
                                                                            checked={field.value?.includes(item.id)}
                                                                            onCheckedChange={(checked) => {
                                                                                const newPeriods = checked
                                                                                    ? [...field.value, item.id]
                                                                                    : field.value?.filter(
                                                                                        (value) => value !== item.id
                                                                                      );
                                                                                field.onChange(newPeriods);
                                                                            }}
                                                                        />
                                                                    </FormControl>
                                                                    <FormLabel className={cn("font-normal", locked && "text-muted-foreground line-through")}>
                                                                        {item.label} {locked && "🔒"}
                                                                    </FormLabel>
                                                                </FormItem>
                                                            )
                                                        }}
                                                    />
                                                );
                                            })}
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <Button type="submit" size="lg" className="w-full" disabled={isProcessing || isDeleting}>
                                {isProcessing ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> 正在同步...</> : <><Zap className="mr-2 h-5 w-5" /> 同步期货数据</>}
                            </Button>
                        </form>
                    </Form>
                </CardContent>
            </Card>
            
            <Card>
                <CardHeader>
                    <CardTitle className="text-destructive">危险区域</CardTitle>
                    <CardDescription>删除指定品种在数据库中的所有相关数据，此操作不可逆。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>选择要删除的品种</Label>
                         <Select onValueChange={setSymbolToDelete} value={symbolToDelete} disabled={availableSymbols.length === 0}>
                            <SelectTrigger>
                                <SelectValue placeholder="选择一个品种..."/>
                            </SelectTrigger>
                            <SelectContent>{availableSymbols.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive" className="w-full" disabled={!symbolToDelete || isProcessing || isDeleting}>
                                 {isDeleting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在删除...</> : <><Trash2 className="mr-2 h-5 w-5" /> 删除品种数据</>}
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>请确认操作</AlertDialogTitle>
                                <AlertDialogDescription>
                                    此操作将永久删除品种 <span className="font-bold text-foreground">{symbolToDelete}</span> 的所有K线和指标数据。此操作无法撤销。
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>取消</AlertDialogCancel>
                                <AlertDialogAction onClick={handleDeleteSymbol} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
                                     {isDeleting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在删除...</> : '确认删除'}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </CardContent>
            </Card>

        </div>
        
        <Card>
            <CardHeader>
                <CardTitle>运行日志</CardTitle>
                <CardDescription>数据引擎的实时输出日志。</CardDescription>
            </CardHeader>
            <CardContent>
                {error && (
                    <Alert variant="destructive">
                        <ServerCrash className="h-4 w-4" />
                        <AlertTitle>执行出错</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}
                 <ScrollArea className="h-[70rem] w-full rounded-md border bg-black mt-4">
                    <pre className="p-4 text-xs font-mono text-white whitespace-pre-wrap">
                        {log || (isProcessing || isDeleting ? '正在初始化并启动数据引擎...' : '等待任务启动...')}
                    </pre>
                 </ScrollArea>
            </CardContent>
        </Card>
      </div>
    );
  }


  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-4">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          数据管理
        </h1>
        <p className="text-muted-foreground">
          获取、处理、导入和删除量化数据。
        </p>
      </div>
      {renderContent()}
    </div>
  );
}