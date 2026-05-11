'use client';

/**
 * strategy-builder.tsx
 * 批量回测策略构建器（移动端本地离线版）
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
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { PlusCircle, Trash2, Play, ChevronDown, ChevronUp, Info, Layers, Package } from 'lucide-react';

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export type IndicatorKey =
  | 'price' | 'MA' | 'MACD' | 'KDJ' | 'RSI' | 'BOLL'
  | 'TRIX' | 'DMI' | 'BIAS' | 'BBI' | 'CCI' | 'DPO' | 'LON';

export type ConditionRow = {
  id: string;
  /** 联动周期（'' = 跟随主周期） */
  period: string;
  /** 指标分类 */
  indicator: IndicatorKey;
  /** 左值 */
  left: string;
  /** 运算符 */
  operator: string;
  /** 右值类型 */
  rightType: 'value' | 'line';
  /** 右值 */
  rightValue: string;
};

export type StrategyFormValues = {
  strategyName: string;
  stockCodes: string[];
  period: string;
  logic: 'AND' | 'OR';
  preset: string;
  conditions: ConditionRow[];
  startTime?: string;
  endTime?: string;
};

// ─── 指标分组配置 ────────────────────────────────────────────────────────────

const INDICATOR_GROUPS: Record<IndicatorKey, { label: string; lines: { value: string; label: string }[] }> = {
  price: {
    label: '价格/量',
    lines: [
      { value: 'open',   label: '开盘价' },
      { value: 'high',   label: '最高价' },
      { value: 'low',    label: '最低价' },
      { value: 'close',  label: '收盘价' },
      { value: 'volume', label: '成交量' },
    ],
  },
  MA: {
    label: '均线 MA',
    lines: [
      { value: 'ma5',      label: 'MA5'     },
      { value: 'ma10',     label: 'MA10'    },
      { value: 'ma20',     label: 'MA20'    },
      { value: 'ma60',     label: 'MA60'    },
      { value: 'ma120',    label: 'MA120'   },
      { value: 'ma250',    label: 'MA250'   },
      { value: 'vol_ma5',  label: '量均MA5' },
      { value: 'vol_ma10', label: '量均MA10'},
    ],
  },
  MACD: {
    label: 'MACD',
    lines: [
      { value: 'macd',        label: 'DIF'  },
      { value: 'macd_signal', label: 'DEA'  },
      { value: 'macd_hist',   label: 'HIST' },
    ],
  },
  KDJ: {
    label: 'KDJ',
    lines: [
      { value: 'kdj_k', label: 'K' },
      { value: 'kdj_d', label: 'D' },
      { value: 'kdj_j', label: 'J' },
    ],
  },
  RSI: {
    label: 'RSI',
    lines: [
      { value: 'rsi_6',  label: 'RSI6'  },
      { value: 'rsi_12', label: 'RSI12' },
      { value: 'rsi_24', label: 'RSI24' },
    ],
  },
  BOLL: {
    label: 'BOLL',
    lines: [
      { value: 'boll_upper',  label: '上轨' },
      { value: 'boll_middle', label: '中轨' },
      { value: 'boll_lower',  label: '下轨' },
    ],
  },
  TRIX: {
    label: 'TRIX',
    lines: [
      { value: 'trix', label: 'TRIX' },
      { value: 'trma', label: 'TRMA' },
    ],
  },
  DMI: {
    label: 'DMI',
    lines: [
      { value: 'pdi',  label: 'PDI'  },
      { value: 'mdi',  label: 'MDI'  },
      { value: 'adx',  label: 'ADX'  },
      { value: 'adxr', label: 'ADXR' },
    ],
  },
  BIAS: {
    label: 'BIAS',
    lines: [
      { value: 'bias_6',  label: 'BIAS6'  },
      { value: 'bias_12', label: 'BIAS12' },
      { value: 'bias_24', label: 'BIAS24' },
    ],
  },
  BBI: {
    label: 'BBI',
    lines: [{ value: 'bbi', label: 'BBI' }],
  },
  CCI: {
    label: 'CCI',
    lines: [{ value: 'cci', label: 'CCI' }],
  },
  DPO: {
    label: 'DPO',
    lines: [
      { value: 'dpo',   label: 'DPO'     },
      { value: 'madpo', label: 'MA(DPO)' },
    ],
  },
  LON: {
    label: 'LON',
    lines: [
      { value: 'lon',   label: 'LON'   },
      { value: 'lonma', label: 'LONMA' },
    ],
  },
};

const INDICATOR_LIST = Object.entries(INDICATOR_GROUPS).map(([key, val]) => ({
  value: key as IndicatorKey,
  label: val.label,
}));

// ─── 静态配置 ────────────────────────────────────────────────────────────────

const MAX_STOCKS = 20;

const PERIODS = [
  { value: '1m',   label: '1分钟'  },
  { value: '5m',   label: '5分钟'  },
  { value: '15m',  label: '15分钟' },
  { value: '30m',  label: '30分钟' },
  { value: '60m',  label: '60分钟' },
  { value: '120m', label: '120分钟'},
  { value: '240m', label: '240分钟'},
  { value: '1d',   label: '日线'   },
  { value: '1w',   label: '周线'   },
  { value: '1M',   label: '月线'   },
];

const LINK_PERIODS = [
  { value: '__main__', label: '跟随主周期' },
  { value: '5m',   label: '5分钟'  },
  { value: '15m',  label: '15分钟' },
  { value: '30m',  label: '30分钟' },
  { value: '60m',  label: '60分钟' },
  { value: '120m', label: '120分钟'},
  { value: '240m', label: '240分钟'},
  { value: '1d',   label: '日线'   },
  { value: '1w',   label: '周线'   },
];

// 只保留 4 个运算符
const OPERATORS = [
  { value: '>',          label: '大于 (>)'  },
  { value: '<',          label: '小于 (<)'  },
  { value: 'up_cross',   label: '上穿 (↑×)' },
  { value: 'down_cross', label: '下穿 (↓×)' },
];

const toSelectVal  = (p: string) => p === '' ? '__main__' : p;
const fromSelectVal = (v: string) => v === '__main__' ? '' : v;

// ─── 工具 ────────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function defaultCondition(): ConditionRow {
  return {
    id:         uid(),
    period:     '',
    indicator:  'MACD',
    left:       'macd',
    operator:   'up_cross',
    rightType:  'line',
    rightValue: 'macd_signal',
  };
}

/** 切换指标时，自动重置 left / rightValue 到该指标的第一/第二条线 */
function resetLinesForIndicator(indicator: IndicatorKey): Pick<ConditionRow, 'left' | 'rightValue'> {
  const lines = INDICATOR_GROUPS[indicator].lines;
  return {
    left:       lines[0]?.value ?? '',
    rightValue: lines[1]?.value ?? lines[0]?.value ?? '',
  };
}

// ─── 品种多选面板（纯内联展开，无 Portal/Popover，兼容 Sheet/Sidebar 任意容器） ──

interface StockPickerProps {
  selected: string[];
  onChange: (codes: string[]) => void;
}

function StockPicker({ selected, onChange }: StockPickerProps) {
  const { availableSymbols, fetchSymbols, isLoading } = useMarketDataStore();
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');

  // 第一次展开时加载本地品种
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

      {/* 标题栏 */}
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

      {/* 已选标签 */}
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

      {/* 展开/收起触发按钮 */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 h-8 rounded-md border
                   bg-background text-xs text-muted-foreground
                   hover:bg-accent hover:text-foreground transition-colors"
      >
        <span>
          {selected.length === 0
            ? '点击选择品种（支持股票+期货混合）'
            : `已选 ${selected.length} 支，点击继续添加`}
        </span>
        {open
          ? <ChevronUp  className="h-3.5 w-3.5 opacity-60 shrink-0" />
          : <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
        }
      </button>

      {/* 内联展开列表 —— 完全在普通文档流里，无 Portal，无 z-index 问题 */}
      {open && (
        <div className="rounded-md border bg-background shadow-sm overflow-hidden">

          {/* 搜索框 */}
          <div className="p-2 border-b">
            <Input
              placeholder="搜索代码或名称..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-7 text-xs"
              autoFocus={false}
            />
          </div>

          {/* 上限提示 */}
          {selected.length >= MAX_STOCKS && (
            <div className="px-3 py-1.5 text-[10px] text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 border-b">
              已达上限 {MAX_STOCKS} 支，请先点击标签移除再添加
            </div>
          )}

          {/* 品种列表 */}
          <ScrollArea className="h-52">
            {isLoading ? (
              <div className="text-center text-xs text-muted-foreground py-6">加载本地品种...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-6 px-4">
                {availableSymbols.length === 0
                  ? '本地暂无已同步品种，请先在「数据管理」同步数据'
                  : '无匹配品种'}
              </div>
            ) : (
              <div className="p-1">
                {filtered.map(sym => {
                  const isSelected = selected.includes(sym.value);
                  const disabled   = !isSelected && selected.length >= MAX_STOCKS;
                  return (
                    <div
                      key={sym.value}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs transition-colors select-none
                        ${disabled
                          ? 'opacity-40 cursor-not-allowed'
                          : 'cursor-pointer hover:bg-accent active:bg-accent/80'
                        }`}
                      onClick={() => !disabled && toggle(sym.value)}
                    >
                      <Checkbox
                        checked={isSelected}
                        disabled={disabled}
                        className="h-3.5 w-3.5 pointer-events-none shrink-0"
                      />
                      <span className="font-mono text-primary shrink-0">{sym.value}</span>
                      <span className="text-muted-foreground truncate">
                        {sym.label.replace(` (${sym.value})`, '')}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* 底部关闭条 */}
          <div
            className="flex items-center justify-center py-1.5 border-t bg-muted/30
                       text-[10px] text-muted-foreground cursor-pointer hover:bg-muted/60 transition-colors"
            onClick={() => setOpen(false)}
          >
            收起 ↑
          </div>
        </div>
      )}
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
  index: number;
}

function ConditionRowEditor({ cond, mainPeriod, onChange, onRemove, canRemove, index }: ConditionRowProps) {
  const update = (patch: Partial<ConditionRow>) => onChange({ ...cond, ...patch });

  const lines  = INDICATOR_GROUPS[cond.indicator].lines;
  const isLinked = cond.period !== '' && cond.period !== mainPeriod;
  const linkPeriodOptions = LINK_PERIODS.filter(p => p.value === '__main__' || p.value !== mainPeriod);

  const handleIndicatorChange = (val: IndicatorKey) => {
    const reset = resetLinesForIndicator(val);
    update({ indicator: val, ...reset, rightType: 'line' });
  };

  return (
    <div className={`rounded-lg border p-3 space-y-2.5 ${isLinked ? 'border-primary/40 bg-primary/5' : 'bg-muted/20'}`}>

      {/* 条件序号 + 联动标签 + 删除按钮 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-muted-foreground bg-muted rounded px-1.5 py-0.5">
            条件 {index + 1}
          </span>
          {isLinked && (
            <span className="flex items-center gap-0.5 text-[10px] text-primary font-semibold">
              <Layers className="h-2.5 w-2.5" />
              {LINK_PERIODS.find(p => p.value === cond.period)?.label}
            </span>
          )}
        </div>
        {canRemove && (
          <button
            onClick={onRemove}
            className="text-muted-foreground/50 hover:text-destructive transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ① 周期 + 指标（一行两列） */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Layers className="h-2.5 w-2.5" /> 联动周期
          </Label>
          <Select
            value={toSelectVal(cond.period)}
            onValueChange={v => update({ period: fromSelectVal(v) })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="z-[999]">
              {linkPeriodOptions.map(p => (
                <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">指标</Label>
          <Select value={cond.indicator} onValueChange={v => handleIndicatorChange(v as IndicatorKey)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="z-[999]">
              {INDICATOR_LIST.map(ind => (
                <SelectItem key={ind.value} value={ind.value} className="text-xs">{ind.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ② 左值 + 运算符（一行两列） */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">左值</Label>
          <Select value={cond.left} onValueChange={v => update({ left: v })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="z-[999]">
              {lines.map(l => (
                <SelectItem key={l.value} value={l.value} className="text-xs">{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">运算符</Label>
          <Select value={cond.operator} onValueChange={v => update({ operator: v })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="z-[999]">
              {OPERATORS.map(op => (
                <SelectItem key={op.value} value={op.value} className="text-xs">{op.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ③ 右值类型切换 + 右值（一行） */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label className="text-[10px] text-muted-foreground">右值</Label>
          <div className="flex gap-1">
            {(['value', 'line'] as const).map(t => (
              <button
                key={t}
                onClick={() => update({
                  rightType: t,
                  rightValue: t === 'value' ? '0' : (lines[1]?.value ?? lines[0]?.value ?? ''),
                })}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors
                  ${cond.rightType === t
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'text-muted-foreground border-border hover:border-primary'
                  }`}
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
            {/* 右值指标线：只显示当前指标的线 */}
            <SelectContent position="popper" className="z-[999]">
              {lines.map(l => (
                <SelectItem key={l.value} value={l.value} className="text-xs">{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export default function StrategyBuilder() {
  const { submitTask, isSubmitting, error } = useBacktestTaskStore();

  const [strategyName, setStrategyName] = useState('自定义策略');
  const [stockCodes, setStockCodes]     = useState<string[]>([]);
  const [mainPeriod, setMainPeriod]     = useState('1d');
  const [logic, setLogic]               = useState<'AND' | 'OR'>('AND');
  const [conditions, setConditions]     = useState<ConditionRow[]>([defaultCondition()]);

  const addCondition    = () => setConditions(prev => [...prev, defaultCondition()]);
  const updateCondition = (idx: number, c: ConditionRow) =>
    setConditions(prev => prev.map((old, i) => (i === idx ? c : old)));
  const removeCondition = (idx: number) =>
    setConditions(prev => prev.filter((_, i) => i !== idx));

  const crossPeriods = [...new Set(
    conditions.filter(c => c.period !== '' && c.period !== mainPeriod).map(c => c.period)
  )];

  const handleSubmit = () => {
    if (stockCodes.length === 0) { alert('请至少选择 1 支品种进行回测'); return; }
    if (conditions.length === 0)  { alert('请至少添加一个策略条件'); return; }
    submitTask({ strategyName, stockCodes, period: mainPeriod, logic, preset: 'custom', conditions });
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
          <SelectContent position="popper" className="z-[999]">
            {PERIODS.map(p => (
              <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {crossPeriods.length > 0 && (
          <div className="flex items-start gap-1.5 text-[10px] text-primary/80 mt-1">
            <Layers className="h-3 w-3 mt-0.5 shrink-0" />
            <span>
              已启用跨周期联动：主周期 <strong>{mainPeriod}</strong>，联动读取{' '}
              {crossPeriods.map((p, i) => (
                <span key={p}>{i > 0 ? '、' : ''}<strong>[{p}]</strong></span>
              ))}
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
                ${logic === l
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'text-muted-foreground border-border hover:border-primary'
                }`}
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

        <Alert className="py-2 px-3 bg-blue-500/5 border-blue-500/20">
          <Info className="h-3.5 w-3.5 text-blue-400" />
          <AlertDescription className="text-[10px] text-blue-400/90 ml-1">
            每个条件可单独设置联动周期，实现跨周期共振策略
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
            index={idx}
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
          📱 离线模式 · 数据仅读取本地 SQLite · 最多 {MAX_STOCKS} 支品种
        </p>
      )}
    </div>
  );
}
