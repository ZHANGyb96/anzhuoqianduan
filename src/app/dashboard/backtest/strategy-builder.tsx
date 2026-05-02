'use client';

/**
 * strategy-builder.tsx
 *
 * 批量回测策略构建器 (移动端本地离线版)
 * ─────────────────────────────────────
 * 核心功能：
 *  1. 批量品种选择 —— 从本地SQLite已同步品种中多选，最多20支（股票+期货混合）
 *  2. 主回测周期选择
 *  3. 条件组构建 —— 每个条件支持独立指定「联动周期」，实现跨周期联动回测
 *     e.g. "主周期60m / 条件1：60m MACD金叉，条件2：1d MA5>MA20（日线趋势确认）"
 *  4. 智能防护：20支上限、条件不能为空、联动周期不得等于主周期
 */

import { useState, useEffect, useCallback } from 'react';
import { useBacktestTaskStore } from '@/store/useBacktestTaskStore';
import { useMarketDataStore } from '@/store/useMarketDataStore';
import { isCapacitor } from '@/config/platform';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  PlusCircle,
  Trash2,
  Play,
  ChevronDown,
  Info,
  Layers,
  Package,
} from 'lucide-react';

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export type ConditionRow = {
  id: string;
  left: string;
  operator: string;
  rightType: 'value' | 'line';
  rightValue: string;
  /** 该条件所用联动周期（留空 = 使用主周期） */
  period: string;
};

export type StrategyFormValues = {
  strategyName: string;
  /** 多品种批量回测（最多20支，支持股票+期货混合） */
  stockCodes: string[];
  /** 主回测周期 */
  period: string;
  /** 条件逻辑 */
  logic: 'AND' | 'OR';
  /** 策略预设（移动端离线模式仅支持 custom） */
  preset: string;
  /** 条件列表 */
  conditions: ConditionRow[];
  startTime?: string;
  endTime?: string;
};

// ─── 静态配置 ────────────────────────────────────────────────────────────────

const MAX_STOCKS = 20;

const PERIODS = [
  { value: '1m', label: '1分钟' },
  { value: '5m', label: '5分钟' },
  { value: '15m', label: '15分钟' },
  { value: '30m', label: '30分钟' },
  { value: '60m', label: '60分钟' },
  { value: '120m', label: '120分钟' },
  { value: '240m', label: '240分钟' },
  { value: '1d', label: '日线' },
  { value: '1w', label: '周线' },
  { value: '1M', label: '月线' },
];

// 联动周期选项（「不联动」= 使用主周期）
// 注意：Radix UI <SelectItem> 不允许 value=""，用哨兵值 '__main__' 代替空字符串
const LINK_PERIODS = [
  { value: '__main__', label: '跟随主周期' },
  { value: '5m', label: '5分钟' },
  { value: '15m', label: '15分钟' },
  { value: '30m', label: '30分钟' },
  { value: '60m', label: '60分钟' },
  { value: '120m', label: '120分钟' },
  { value: '240m', label: '240分钟' },
  { value: '1d', label: '日线' },
  { value: '1w', label: '周线' },
];

/** 内部状态 period='' 表示跟随主周期；渲染时与哨兵值互转 */
const toSelectVal = (period: string) => period === '' ? '__main__' : period;
const fromSelectVal = (val: string) => val === '__main__' ? '' : val;

const INDICATORS: { label: string; value: string }[] = [
  // 价格
  { label: '开盘价 (open)', value: 'open' },
  { label: '最高价 (high)', value: 'high' },
  { label: '最低价 (low)', value: 'low' },
  { label: '收盘价 (close)', value: 'close' },
  { label: '成交量 (volume)', value: 'volume' },
  // MA
  { label: 'MA5', value: 'ma5' },
  { label: 'MA10', value: 'ma10' },
  { label: 'MA20', value: 'ma20' },
  { label: 'MA60', value: 'ma60' },
  { label: 'MA120', value: 'ma120' },
  { label: 'MA250', value: 'ma250' },
  { label: '量均5 (vol_ma5)', value: 'vol_ma5' },
  { label: '量均10(vol_ma10)', value: 'vol_ma10' },
  // MACD
  { label: 'MACD DIF', value: 'macd' },
  { label: 'MACD DEA', value: 'macd_signal' },
  { label: 'MACD HIST', value: 'macd_hist' },
  // KDJ
  { label: 'KDJ K', value: 'kdj_k' },
  { label: 'KDJ D', value: 'kdj_d' },
  { label: 'KDJ J', value: 'kdj_j' },
  // RSI
  { label: 'RSI6', value: 'rsi_6' },
  { label: 'RSI12', value: 'rsi_12' },
  { label: 'RSI24', value: 'rsi_24' },
  // BOLL
  { label: 'BOLL上轨', value: 'boll_upper' },
  { label: 'BOLL中轨', value: 'boll_middle' },
  { label: 'BOLL下轨', value: 'boll_lower' },
  // 其它
  { label: 'TRIX', value: 'trix' },
  { label: 'TRMA', value: 'trma' },
  { label: 'CCI', value: 'cci' },
  { label: 'BIAS6', value: 'bias_6' },
  { label: 'BIAS12', value: 'bias_12' },
  { label: 'BIAS24', value: 'bias_24' },
  { label: 'DPO', value: 'dpo' },
  { label: 'MA(DPO)', value: 'madpo' },
  { label: 'BBI', value: 'bbi' },
  { label: 'PDI(DMI)', value: 'pdi' },
  { label: 'MDI(DMI)', value: 'mdi' },
  { label: 'ADX', value: 'adx' },
  { label: 'ADXR', value: 'adxr' },
  { label: 'LON', value: 'lon' },
  { label: 'LONMA', value: 'lonma' },
];

const OPERATORS = [
  { value: '>', label: '大于 (>)' },
  { value: '<', label: '小于 (<)' },
  { value: '>=', label: '大于等于 (≥)' },
  { value: '<=', label: '小于等于 (≤)' },
  { value: '==', label: '等于 (=)' },
  { value: 'up_cross', label: '上穿 (↑×)' },
  { value: 'down_cross', label: '下穿 (↓×)' },
];

// ─── 工具 ────────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function defaultCondition(): ConditionRow {
  return {
    id: uid(),
    left: 'macd',
    operator: 'up_cross',
    rightType: 'line',
    rightValue: 'macd_signal',
    period: '',
  };
}

// ─── 品种多选面板 ─────────────────────────────────────────────────────────────

interface StockPickerProps {
  selected: string[];
  onChange: (codes: string[]) => void;
}

function StockPicker({ selected, onChange }: StockPickerProps) {
  const { availableSymbols, fetchSymbols, isLoading } = useMarketDataStore();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open && availableSymbols.length === 0) fetchSymbols();
  }, [open, availableSymbols.length, fetchSymbols]);

  const filtered = availableSymbols.filter(s =>
    s.label.toLowerCase().includes(search.toLowerCase()) ||
    s.value.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = useCallback((code: string) => {
    if (selected.includes(code)) {
      onChange(selected.filter(c => c !== code));
    } else {
      if (selected.length >= MAX_STOCKS) return;
      onChange([...selected, code]);
    }
  }, [selected, onChange]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5" />
          批量品种选择
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {selected.length}/{MAX_STOCKS}
          </Badge>
        </Label>
        {selected.length > 0 && (
          <button
            onClick={() => onChange([])}
            className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
          >
            清空
          </button>
        )}
      </div>

      {/* 已选标签区 */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 p-2 rounded-md border bg-muted/30 min-h-[36px]">
          {selected.map(code => {
            const sym = availableSymbols.find(s => s.value === code);
            return (
              <Badge
                key={code}
                variant="secondary"
                className="text-[10px] gap-1 cursor-pointer hover:bg-destructive/20 transition-colors"
                onClick={() => toggle(code)}
              >
                {sym?.value ?? code}
                <span className="text-[9px] opacity-60">×</span>
              </Badge>
            );
          })}
        </div>
      )}

      {/* 选择器弹出 */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-between text-xs h-8">
            <span className="text-muted-foreground">
              {selected.length === 0 ? '点击选择品种（支持股票+期货混合）' : `已选 ${selected.length} 支品种`}
            </span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <div className="p-2 border-b">
            <Input
              placeholder="搜索代码或名称..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          {selected.length >= MAX_STOCKS && (
            <div className="px-3 py-1.5 text-[10px] text-yellow-600 dark:text-yellow-400 bg-yellow-500/10">
              已达上限 {MAX_STOCKS} 支，请先移除再添加
            </div>
          )}
          <ScrollArea className="h-52">
            {isLoading ? (
              <div className="text-center text-xs text-muted-foreground py-6">加载本地品种...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-6">
                {availableSymbols.length === 0 ? '本地暂无已同步品种，请先在「数据管理」同步' : '无匹配品种'}
              </div>
            ) : (
              <div className="p-1">
                {filtered.map(sym => {
                  const isSelected = selected.includes(sym.value);
                  const disabled = !isSelected && selected.length >= MAX_STOCKS;
                  return (
                    <div
                      key={sym.value}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs transition-colors
                        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-accent'}`}
                      onClick={() => !disabled && toggle(sym.value)}
                    >
                      <Checkbox
                        checked={isSelected}
                        disabled={disabled}
                        className="h-3.5 w-3.5 pointer-events-none"
                      />
                      <span className="font-mono text-primary">{sym.value}</span>
                      <span className="text-muted-foreground truncate flex-1">{sym.label.replace(` (${sym.value})`, '')}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─── 单条件行 ─────────────────────────────────────────────────────────────────

interface ConditionRowProps {
  cond: ConditionRow;
  mainPeriod: string;
  onChange: (c: ConditionRow) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function ConditionRowEditor({ cond, mainPeriod, onChange, onRemove, canRemove }: ConditionRowProps) {
  const update = (patch: Partial<ConditionRow>) => onChange({ ...cond, ...patch });

  // 联动周期选项：过滤掉与主周期相同的项，避免无意义设置
  const linkPeriodOptions = LINK_PERIODS.filter(p => p.value === '__main__' || p.value !== mainPeriod);
  const isLinked = cond.period !== '' && cond.period !== mainPeriod;

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${isLinked ? 'border-primary/40 bg-primary/5' : 'bg-muted/20'}`}>
      {/* 联动周期标签 */}
      {isLinked && (
        <div className="flex items-center gap-1 text-[10px] text-primary font-semibold">
          <Layers className="h-3 w-3" />
          联动周期: {LINK_PERIODS.find(p => p.value === cond.period)?.label ?? cond.period}
        </div>
      )}

      {/* 第一行: Left 指标 + 联动周期 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">左侧指标</Label>
          <Select value={cond.left} onValueChange={v => update({ left: v })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <ScrollArea className="h-52">
                {INDICATORS.map(ind => (
                  <SelectItem key={ind.value} value={ind.value} className="text-xs">
                    {ind.label}
                  </SelectItem>
                ))}
              </ScrollArea>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">
            联动周期
            <span className="ml-1 text-primary/70">(跨周期)</span>
          </Label>
          <Select value={toSelectVal(cond.period)} onValueChange={v => update({ period: fromSelectVal(v) })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {linkPeriodOptions.map(p => (
                <SelectItem key={p.value} value={p.value} className="text-xs">
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 第二行: 运算符 */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">运算符</Label>
        <Select value={cond.operator} onValueChange={v => update({ operator: v })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPERATORS.map(op => (
              <SelectItem key={op.value} value={op.value} className="text-xs">
                {op.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 第三行: 右侧类型 + 值/指标 + 删除按钮 */}
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2 mb-1">
            <Label className="text-[10px] text-muted-foreground">右侧</Label>
            <div className="flex gap-1">
              {(['value', 'line'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => update({ rightType: t, rightValue: t === 'value' ? '0' : 'ma20' })}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors
                    ${cond.rightType === t ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:border-primary'}`}
                >
                  {t === 'value' ? '数值' : '指标线'}
                </button>
              ))}
            </div>
          </div>
          {cond.rightType === 'value' ? (
            <Input
              type="number"
              value={cond.rightValue}
              onChange={e => update({ rightValue: e.target.value })}
              className="h-8 text-xs"
              placeholder="输入数值..."
            />
          ) : (
            <Select value={cond.rightValue} onValueChange={v => update({ rightValue: v })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <ScrollArea className="h-52">
                  {INDICATORS.map(ind => (
                    <SelectItem key={ind.value} value={ind.value} className="text-xs">
                      {ind.label}
                    </SelectItem>
                  ))}
                </ScrollArea>
              </SelectContent>
            </Select>
          )}
        </div>

        {canRemove && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10 shrink-0"
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export default function StrategyBuilder() {
  const { submitTask, isSubmitting, error } = useBacktestTaskStore();

  const [strategyName, setStrategyName] = useState('自定义策略');
  const [stockCodes, setStockCodes] = useState<string[]>([]);
  const [mainPeriod, setMainPeriod] = useState('1d');
  const [logic, setLogic] = useState<'AND' | 'OR'>('AND');
  const [conditions, setConditions] = useState<ConditionRow[]>([defaultCondition()]);

  const addCondition = () => setConditions(prev => [...prev, defaultCondition()]);

  const updateCondition = (idx: number, c: ConditionRow) =>
    setConditions(prev => prev.map((old, i) => (i === idx ? c : old)));

  const removeCondition = (idx: number) =>
    setConditions(prev => prev.filter((_, i) => i !== idx));

  // 检测是否有跨周期条件
  const crossPeriods = [...new Set(
    conditions.filter(c => c.period !== '' && c.period !== mainPeriod).map(c => c.period)
  )];

  const handleSubmit = () => {
    if (stockCodes.length === 0) {
      alert('请至少选择1支品种进行回测');
      return;
    }
    if (conditions.length === 0) {
      alert('请至少添加一个策略条件');
      return;
    }

    submitTask({
      strategyName,
      stockCodes,
      period: mainPeriod,
      logic,
      preset: 'custom',
      conditions,
    });
  };

  return (
    <div className="space-y-4">
      {/* 策略名称 */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">策略名称</Label>
        <Input
          value={strategyName}
          onChange={e => setStrategyName(e.target.value)}
          className="h-8 text-sm"
          placeholder="给你的策略起个名字..."
        />
      </div>

      <Separator />

      {/* 批量品种选择 */}
      <StockPicker selected={stockCodes} onChange={setStockCodes} />

      <Separator />

      {/* 主回测周期 */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">主回测周期</Label>
        <Select value={mainPeriod} onValueChange={setMainPeriod}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map(p => (
              <SelectItem key={p.value} value={p.value} className="text-xs">
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {crossPeriods.length > 0 && (
          <div className="flex items-start gap-1.5 text-[10px] text-primary/80 mt-1">
            <Layers className="h-3 w-3 mt-0.5 shrink-0" />
            <span>
              已启用跨周期联动：主周期 <strong>{mainPeriod}</strong>，联动读取{' '}
              {crossPeriods.map(p => <strong key={p}>[{p}]</strong>).reduce((a, b) => <>{a}、{b}</>)}
              的指标数据
            </span>
          </div>
        )}
      </div>

      <Separator />

      {/* 条件逻辑 */}
      <div className="flex items-center gap-3">
        <Label className="text-xs font-semibold shrink-0">条件逻辑</Label>
        <div className="flex gap-2">
          {(['AND', 'OR'] as const).map(l => (
            <button
              key={l}
              onClick={() => setLogic(l)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors
                ${logic === l ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:border-primary'}`}
            >
              {l === 'AND' ? '全部满足 (AND)' : '任一满足 (OR)'}
            </button>
          ))}
        </div>
      </div>

      {/* 条件列表 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">入场条件</Label>
          <span className="text-[10px] text-muted-foreground">{conditions.length} 个条件</span>
        </div>

        {/* 跨周期说明 */}
        <Alert className="py-2 px-3 bg-blue-500/5 border-blue-500/20">
          <Info className="h-3.5 w-3.5 text-blue-400" />
          <AlertDescription className="text-[10px] text-blue-400/90 ml-1">
            每个条件可单独设置「联动周期」——用高周期数据过滤低周期信号，实现跨周期共振策略
          </AlertDescription>
        </Alert>

        {conditions.map((cond, idx) => (
          <ConditionRowEditor
            key={cond.id}
            cond={cond}
            mainPeriod={mainPeriod}
            onChange={c => updateCondition(idx, c)}
            onRemove={() => removeCondition(idx)}
            canRemove={conditions.length > 1}
          />
        ))}

        <Button
          variant="outline"
          size="sm"
          className="w-full h-8 text-xs border-dashed"
          onClick={addCondition}
        >
          <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
          添加条件
        </Button>
      </div>

      {/* 错误提示 */}
      {error && (
        <Alert variant="destructive" className="py-2 px-3">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      {/* 提交按钮 */}
      <Button
        className="w-full"
        onClick={handleSubmit}
        disabled={isSubmitting || stockCodes.length === 0}
      >
        {isSubmitting ? (
          <>
            <span className="animate-spin mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full inline-block" />
            本地回测运行中...
          </>
        ) : (
          <>
            <Play className="mr-2 h-4 w-4" />
            开始批量回测
            {stockCodes.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {stockCodes.length} 支
              </Badge>
            )}
          </>
        )}
      </Button>

      {isCapacitor && (
        <p className="text-center text-[10px] text-muted-foreground">
          📱 离线模式 · 数据仅读取本地SQLite · 最多 {MAX_STOCKS} 支品种
        </p>
      )}
    </div>
  );
}
