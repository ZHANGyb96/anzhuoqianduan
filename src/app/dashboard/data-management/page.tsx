'use client';

import { useEffect, useState, useCallback } from 'react';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, ServerCrash, Zap, Trash2, RefreshCcw, Lock,
  Database, BarChart2, AlertTriangle, ChevronDown, ChevronUp,
} from "lucide-react";
import { useLicenseStore } from '@/store/useLicenseStore';
import { useAuthStore } from '@/store/useAuthStore';
import { API_URL } from '@/config/constants';
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useMarketDataStore } from '@/store/useMarketDataStore';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { isCapacitor } from '@/config/platform';
import { syncStockToMobile } from '@/lib/mobile-market-data';
import { getMobileDB } from '@/lib/mobile-db';

// ── 周期配置 ────────────────────────────────────────────────────────────────
const periodsOptions = [
  { id: '1m',  label: '1分钟',  minTier: 'PRO'   },
  { id: '5m',  label: '5分钟',  minTier: 'PRO'   },
  { id: '15m', label: '15分钟', minTier: 'PRO'   },
  { id: '30m', label: '30分钟', minTier: 'PRO'   },
  { id: '60m', label: '60分钟', minTier: 'PRO'   },
  { id: '120m',label: '120分钟',minTier: 'PRO'   },
  { id: '240m',label: '240分钟',minTier: 'PRO'   },
  { id: '1d',  label: '日线',   minTier: 'BASIC' },
  { id: '1w',  label: '周线',   minTier: 'BASIC' },
  { id: '1M',  label: '月线',   minTier: 'BASIC' },
];

const dataSyncSchema = z.object({
  symbol:   z.string().min(1, "品种代码不能为空").max(20, "代码过长"),
  name:     z.string().optional(),
  duration: z.string().min(1, "必须选择一个数据时长"),
  periods:  z.array(z.string()).refine(v => v.length > 0, { message: "至少选择一个时间周期" }),
});
type DataSyncFormValues = z.infer<typeof dataSyncSchema>;

// ── 已有品种列表（可折叠） ───────────────────────────────────────────────────
function SymbolList({ symbols }: { symbols: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  if (symbols.length === 0) return null;
  return (
    <div className="rounded-lg border bg-muted/20">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/30 transition-colors"
      >
        <span className="font-medium flex items-center gap-2">
          <Database className="h-3.5 w-3.5 text-muted-foreground" />
          本地已有品种
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{symbols.length}</Badge>
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 pb-3 flex flex-wrap gap-1.5 border-t pt-2.5">
          {symbols.map(s => (
            <Badge key={s.value} variant="outline" className="text-xs font-mono">
              {s.value}
              {s.label.replace(` (${s.value})`, '') && (
                <span className="ml-1 text-muted-foreground font-normal">
                  {s.label.replace(` (${s.value})`, '')}
                </span>
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 通用同步表单（股票 & 期货共用） ─────────────────────────────────────────
interface SyncFormProps {
  type: 'stock' | 'future';
  form: ReturnType<typeof useForm<DataSyncFormValues>>;
  isProcessing: boolean;
  isDeleting: boolean;
  isBasic: boolean;
  onSubmit: (data: DataSyncFormValues) => void;
}

function SyncForm({ type, form, isProcessing, isDeleting, isBasic, onSubmit }: SyncFormProps) {
  const isStock = type === 'stock';
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

        {/* 代码 + 名称：同行两列 */}
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="symbol" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">{isStock ? '股票代码' : '期货代码'}</FormLabel>
              <FormControl>
                <Input placeholder={isStock ? '如 002030' : '如 SA, rb'} className="h-8 text-sm" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">名称 <span className="text-muted-foreground font-normal">(可选)</span></FormLabel>
              <FormControl>
                <Input placeholder={isStock ? '如 达安基因' : '如 纯碱'} className="h-8 text-sm" {...field} />
              </FormControl>
            </FormItem>
          )} />
        </div>

        {/* 日线时长 */}
        <FormField control={form.control} name="duration" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">日线数据时长</FormLabel>
            <Select onValueChange={field.onChange} defaultValue={field.value}>
              <FormControl>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="120d">近 120 天</SelectItem>
                <SelectItem value="1y">近 1 年</SelectItem>
                <SelectItem value="3y">近 3 年</SelectItem>
                <SelectItem value="all">全部历史</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        {/* 周期多选 */}
        <FormField control={form.control} name="periods" render={() => (
          <FormItem>
            <FormLabel className="text-xs">同步周期</FormLabel>
            <p className="text-[11px] text-muted-foreground -mt-1">分钟线仅含近期数据，日线可获取更长历史</p>
            <div className="grid grid-cols-5 gap-2 mt-2">
              {periodsOptions.map(item => {
                const locked = item.minTier === 'PRO' && isBasic;
                return (
                  <FormField
                    key={item.id}
                    control={form.control}
                    name="periods"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-1.5 space-y-0">
                        <FormControl>
                          <Checkbox
                            disabled={locked}
                            checked={field.value?.includes(item.id)}
                            onCheckedChange={checked => {
                              const next = checked
                                ? [...field.value, item.id]
                                : field.value?.filter(v => v !== item.id);
                              field.onChange(next);
                            }}
                          />
                        </FormControl>
                        <FormLabel className={cn("text-xs font-normal cursor-pointer select-none", locked && "text-muted-foreground line-through")}>
                          {item.label}{locked && ' 🔒'}
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                );
              })}
            </div>
            <FormMessage />
          </FormItem>
        )} />

        <Button type="submit" size="sm" className="w-full" disabled={isProcessing || isDeleting}>
          {isProcessing
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在同步...</>
            : <><Zap className="mr-2 h-4 w-4" />{isStock ? '同步股票数据' : '同步期货数据'}</>}
        </Button>
      </form>
    </Form>
  );
}

// ── 主页面 ───────────────────────────────────────────────────────────────────
export default function DataManagementPage() {
  const { tier } = useLicenseStore();
  const isBasic = tier === 'BASIC';

  const [isClient,     setIsClient]     = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDeleting,   setIsDeleting]   = useState(false);
  const [symbolToDelete, setSymbolToDelete] = useState('');
  const [log,   setLog]   = useState('');
  const [error, setError] = useState('');

  const token = useAuthStore(state => state.token);
  const { toast } = useToast();
  const { availableSymbols, fetchSymbols, error: symbolsError, isLoading: symbolsLoading } = useMarketDataStore();

  useEffect(() => { setIsClient(true); }, []);
  useEffect(() => {
    if (isClient && (token || isCapacitor)) fetchSymbols();
  }, [isClient, token, fetchSymbols]);

  const defaultPeriods = isBasic
    ? ['1d', '1w', '1M']
    : ['1m', '5m', '15m', '30m', '60m', '120m', '240m', '1d', '1w', '1M'];

  const stockForm  = useForm<DataSyncFormValues>({
    resolver: zodResolver(dataSyncSchema),
    defaultValues: { symbol: '002030', name: '', duration: '1y', periods: defaultPeriods },
  });
  const futureForm = useForm<DataSyncFormValues>({
    resolver: zodResolver(dataSyncSchema),
    defaultValues: { symbol: 'SA',     name: '', duration: '1y', periods: defaultPeriods },
  });

  // ── 流式日志处理 ──
  const handleStreamingResponse = useCallback(async (response: Response) => {
    if (!response.body) throw new Error("响应体为空");
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let acc = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += value;
      setLog(acc);
    }
    if (acc.includes('PYTHON_SCRIPT_FAILED_WITH_EXCEPTION') || acc.includes('任务失败')) {
      setError("任务执行失败，请检查日志了解详情。");
    } else {
      toast({ title: "任务成功", description: "数据操作已成功完成。" });
      fetchSymbols();
    }
  }, [toast, fetchSymbols]);

  // ── 同步提交（股票 & 期货共用） ──
  const onSyncSubmit = useCallback(async (data: DataSyncFormValues) => {
    setIsProcessing(true);
    setLog('');
    setError('');

    if (isCapacitor) {
      let ok = 0, fail = 0;
      try {
        for (const period of data.periods) {
          try {
            await syncStockToMobile(data.symbol, data.name ?? '', period, msg => setLog(p => p + msg + '\n'));
            ok++;
          } catch (e: any) {
            fail++;
            setLog(p => p + `\n[ERROR] ${period}: ${e.message}\n`);
          }
        }
        await fetchSymbols();
        if (ok > 0 && fail === 0) {
          toast({ title: '同步完成', description: `已将 ${data.symbol} 写入本地数据库。` });
        } else if (ok > 0) {
          toast({ title: '部分成功', description: `成功 ${ok} 个，失败 ${fail} 个，请查看日志。` });
        } else {
          setError('所有周期均无数据，请检查代码是否正确及网络连接。');
          toast({ title: '同步失败', description: '服务器未返回有效数据。', variant: 'destructive' });
        }
      } catch (e: any) {
        setError(e.message);
        setLog(p => p + `\n[ERROR] ${e.message}`);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/v1/data/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text() || '服务器返回了错误状态。');
      await handleStreamingResponse(res);
    } catch (e: any) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).message || msg; } catch {}
      if (msg.includes('Failed to fetch')) msg = '无法连接到后端服务。请确认 Node.js API 服务正在运行。';
      setError(msg);
      setLog(p => p + `\n[ERROR] ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  }, [token, handleStreamingResponse, fetchSymbols, toast]);

  // ── 一键全量更新 ──
  const onSyncAllSubmit = useCallback(async () => {
    setIsProcessing(true);
    setLog('');
    setError('');

    if (isCapacitor) {
      try {
        if (availableSymbols.length === 0) throw new Error("本地无品种，请先新增品种数据。");
        setLog("[开始一键热更队列]\n=====================\n");
        const periods = isBasic ? ['1d', '1w', '1M'] : ['1d', '60m', '30m', '15m'];
        for (const sym of availableSymbols) {
          setLog(p => p + `\n--- 更新: ${sym.label} ---\n`);
          for (const period of periods) {
            await syncStockToMobile(sym.value, '', period, msg => setLog(p => p + msg + '\n'));
          }
          await fetchSymbols();
          toast({ title: `已更新: ${sym.label}` });
        }
        toast({ title: "全部品种更新完成" });
      } catch (e: any) {
        setError(e.message);
        setLog(p => p + `\n[ERROR] ${e.message}`);
        toast({ variant: 'destructive', title: '同步失败', description: e.message });
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/v1/data/sync-all`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'x-client-id': 'web-browser-v1' },
      });
      if (res.status === 429) { const d = await res.json(); throw new Error(d.message); }
      if (!res.ok) throw new Error('批量同步请求失败。');
      await handleStreamingResponse(res);
    } catch (e: any) {
      setError(e.message);
      setLog(`[ERROR] ${e.message}`);
      toast({ variant: 'destructive', title: '限制提示', description: e.message });
    } finally {
      setIsProcessing(false);
    }
  }, [availableSymbols, isBasic, token, handleStreamingResponse, fetchSymbols, toast]);

  // ── 删除品种 ──
  const handleDeleteSymbol = useCallback(async () => {
    if (!symbolToDelete) {
      toast({ variant: 'destructive', title: '错误', description: '请先选择要删除的品种。' });
      return;
    }
    if (!token && !isCapacitor) {
      toast({ variant: 'destructive', title: '错误', description: '用户未登录' });
      return;
    }
    setIsDeleting(true);
    setLog('');
    setError('');

    if (isCapacitor) {
      try {
        const db = await getMobileDB();
        await db.run('DELETE FROM kline_metrics WHERE stock_code = ?', [symbolToDelete]);
        toast({ title: '删除成功' });
        await fetchSymbols();
        setSymbolToDelete('');
      } catch (e: any) {
        setError(e.message);
        setLog(`[ERROR] ${e.message}`);
      } finally {
        setIsDeleting(false);
      }
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/v1/market-data/${symbolToDelete}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || '服务器返回了错误状态。');
      setLog(`[SUCCESS] ${result.message}`);
      toast({ title: "删除成功", description: result.message });
      fetchSymbols();
      setSymbolToDelete('');
    } catch (e: any) {
      let msg = e.message;
      if (String(msg).includes('Failed to fetch')) msg = '无法连接到后端服务。请确认 Node.js API 服务正在运行。';
      setError(msg);
      setLog(`[ERROR] ${msg}`);
    } finally {
      setIsDeleting(false);
    }
  }, [symbolToDelete, token, fetchSymbols, toast]);

  // ── 加载中 / 错误状态 ──
  if (!isClient || symbolsLoading) {
    return (
      <div className="flex h-[50vh] w-full flex-col items-center justify-center text-muted-foreground">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="mt-3 text-sm">{!isClient ? '正在加载模块...' : '正在加载品种列表...'}</p>
      </div>
    );
  }
  if (symbolsError) {
    return (
      <Alert variant="destructive">
        <ServerCrash className="h-4 w-4" />
        <AlertTitle>数据加载失败</AlertTitle>
        <AlertDescription>{symbolsError}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">

      {/* 顶部标题 */}
      <div className="mb-4 flex-shrink-0">
        <h1 className="text-2xl font-bold tracking-tight font-headline">数据管理</h1>
        <p className="text-sm text-muted-foreground mt-0.5">获取、同步、更新并管理本地量化数据</p>
      </div>

      {/* 主体 */}
      <div className="flex flex-1 min-h-0 gap-4 overflow-hidden">

        {/* 左侧：操作区 */}
        <div className="flex flex-col gap-4 w-full lg:w-[420px] xl:w-[460px] shrink-0 overflow-y-auto">

          {/* 已有品种 */}
          <SymbolList symbols={availableSymbols} />

          {/* 一键更新 */}
          <Card className={cn("border-primary/20 bg-primary/5", isBasic && "opacity-60 grayscale bg-muted/20")}>
            <CardHeader className="pb-3 pt-4 px-4">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <RefreshCcw className="h-4 w-4 text-primary" />
                  一键增量更新全部品种
                </span>
                {isBasic && <Lock className="h-4 w-4 text-muted-foreground" />}
              </CardTitle>
              <CardDescription className="text-xs">
                {isBasic ? '升级 PRO 版解锁此功能' : `库内 ${availableSymbols.length} 个品种，自动串行获取最新数据`}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <Button
                size="sm" className="w-full"
                disabled={isBasic || isProcessing || isDeleting || availableSymbols.length === 0}
                onClick={onSyncAllSubmit}
              >
                {isProcessing
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在批量同步...</>
                  : '一键更新库内所有品种'}
              </Button>
            </CardContent>
          </Card>

          {/* 股票 / 期货 Tab 同步表单 */}
          <Card>
            <CardHeader className="pb-3 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-primary" />
                新增 / 更新品种
              </CardTitle>
              <CardDescription className="text-xs">
                输入代码后自动拉取历史数据并写入本地
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <Tabs defaultValue="stock">
                <TabsList className="h-8 mb-4 w-full">
                  <TabsTrigger value="stock"  className="flex-1 text-xs h-7">A 股</TabsTrigger>
                  <TabsTrigger value="future" className="flex-1 text-xs h-7">期货</TabsTrigger>
                </TabsList>
                <TabsContent value="stock"  className="m-0">
                  <SyncForm type="stock"  form={stockForm}  isProcessing={isProcessing} isDeleting={isDeleting} isBasic={isBasic} onSubmit={onSyncSubmit} />
                </TabsContent>
                <TabsContent value="future" className="m-0">
                  <SyncForm type="future" form={futureForm} isProcessing={isProcessing} isDeleting={isDeleting} isBasic={isBasic} onSubmit={onSyncSubmit} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* 删除品种 */}
          <Card className="border-destructive/20">
            <CardHeader className="pb-3 pt-4 px-4">
              <CardTitle className="text-sm text-destructive flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                删除品种数据
              </CardTitle>
              <CardDescription className="text-xs">
                删除后无法撤销，请谨慎操作
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">选择要删除的品种</Label>
                <Select onValueChange={setSymbolToDelete} value={symbolToDelete} disabled={availableSymbols.length === 0}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="选择品种..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSymbols.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="w-full"
                    disabled={!symbolToDelete || isProcessing || isDeleting}>
                    {isDeleting
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在删除...</>
                      : <><Trash2 className="mr-2 h-4 w-4" />删除品种数据</>}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                      此操作将永久删除品种 <span className="font-bold text-foreground">{symbolToDelete}</span> 的全部K线数据，无法撤销。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteSymbol}
                      disabled={isDeleting}
                      className="bg-destructive hover:bg-destructive/90"
                    >
                      {isDeleting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />删除中...</> : '确认删除'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

        </div>

        {/* 右侧：运行日志 */}
        <div className="hidden lg:flex flex-1 flex-col min-h-0">
          <Card className="flex flex-col flex-1 min-h-0">
            <CardHeader className="pb-3 pt-4 px-4 flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm">运行日志</CardTitle>
                  <CardDescription className="text-xs">数据引擎的实时输出</CardDescription>
                </div>
                {log && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
                    onClick={() => { setLog(''); setError(''); }}>
                    清空
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col flex-1 min-h-0 px-4 pb-4">
              {error && (
                <Alert variant="destructive" className="mb-3 flex-shrink-0">
                  <ServerCrash className="h-4 w-4" />
                  <AlertTitle className="text-sm">执行出错</AlertTitle>
                  <AlertDescription className="text-xs">{error}</AlertDescription>
                </Alert>
              )}
              <div className="flex-1 min-h-0 rounded-md border bg-black overflow-hidden">
                <ScrollArea className="h-full w-full">
                  <pre className="p-4 text-xs font-mono text-white whitespace-pre-wrap leading-relaxed">
                    {log || (isProcessing || isDeleting ? '正在初始化数据引擎...' : '等待任务启动...')}
                  </pre>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 移动端日志（折叠区） */}
        {(log || error) && (
          <div className="lg:hidden w-full mt-0">
            <Card>
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm">运行日志</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {error && (
                  <Alert variant="destructive" className="mb-3">
                    <ServerCrash className="h-4 w-4" />
                    <AlertDescription className="text-xs">{error}</AlertDescription>
                  </Alert>
                )}
                <ScrollArea className="h-48 w-full rounded-md border bg-black">
                  <pre className="p-3 text-xs font-mono text-white whitespace-pre-wrap">{log}</pre>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        )}

      </div>
    </div>
  );
}
