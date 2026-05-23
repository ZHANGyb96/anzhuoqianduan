'use client';

/**
 * strategy-builder.tsx
 * 批量回测策略构建器（移动端本地离线版）
 *
 * v2 更新：
 *  - 新增 TROC_S（TROC短期）和 TROC_L（TROC长期）两个指标分组
 *  - TROC_S 可用字段：troc_osc / troc_osc_ma / troc_trix_s / troc_adx_s
 *  - TROC_L 可用字段：troc_osc_l / troc_osc_ma_l / troc_trix_l / troc_phase /
 *                     troc_acc / troc_dist / troc_pct / troc_chop /
 *                     troc_swing_lo / troc_swing_hi / troc_ob_dyn / troc_os_dyn
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
import { cn } from '@/lib/utils';

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export type IndicatorKey =
  | 'price' | 'MA' | 'MACD' | 'KDJ' | 'RSI' | 'BOLL'
  | 'TRIX' | 'DMI' | 'BIAS' | 'BBI' | 'CCI' | 'DPO' | 'LON'
  | 'TROC_S' | 'TROC_L';   // ← v2 新增

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
      { value: 'ma5',      label: 'MA5'      },
      { value: 'ma10',     label: 'MA10'     },
      { value: 'ma20',     label: 'MA20'     },
      { value: 'ma60',     label: 'MA60'     },
      { value: 'ma120',    label: 'MA120'    },
      { value: 'ma250',    label: 'MA250'    },
      { value: 'vol_ma5',  label: '量均MA5'  },
      { value: 'vol_ma10', label: '量均MA10' },
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

  // ── v2 新增：TROC 短期 ──────────────────────────────────────────────────────
  TROC_S: {
    label: 'TROC短期',
    lines: [
      { value: 'troc_osc',    label: 'OSC短期'   },   // Z-score合成振荡线（无量纲，超买>+1.5超卖<-1.5）
      { value: 'troc_osc_ma', label: 'OSC信号线'  },   // OSC 5周期EMA
      { value: 'troc_trix_s', label: 'TRIX短期'  },   // 短期TRIX归一化，>0多头<0空头
      { value: 'troc_adx_s',  label: 'ADX强度'   },   // ADX趋势强度（0~100，>25为趋势市）
    ],
  },

  // ── v2 新增：TROC 长期 ──────────────────────────────────────────────────────
  TROC_L: {
    label: 'TROC长期',
    lines: [
      { value: 'troc_osc_l',    label: 'OSC长期'    },  // 长期振荡主线（26周期参数）
      { value: 'troc_osc_ma_l', label: 'OSC长期信号' },  // 长期OSC 5周期EMA
      { value: 'troc_trix_l',   label: 'TRIX长期'   },  // 长期TRIX归一化（18周期）
      { value: 'troc_phase',    label: 'PHASE状态'  },  // +1吸筹 / 0中性 / -1派筹
      { value: 'troc_acc',      label: '吸筹强度'   },  // 吸筹得分归一化（0~1）
      { value: 'troc_dist',     label: '派筹强度'   },  // 派筹得分（0~-1，负向）
      { value: 'troc_pct',      label: '价格分位'   },  // 历史分位 0~1（<0.3低位,>0.7高位）
      { value: 'troc_chop',     label: '震荡指数'   },  // <38.2趋势 >61.8震荡
      { value: 'troc_swing_lo', label: '摆动低点'   },  // 最近摆动低点（结构判断用）
      { value: 'troc_swing_hi', label: '摆动高点'   },  // 最近摆动高点
      { value: 'troc_ob_dyn',   label: '动态超买线' },  // 自适应超买阈值（≈+1.5~+2.5）
      { value: 'troc_os_dyn',   label: '动态超卖线' },  // 自适应超卖阈值（≈-1.5~-2.5）
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
  { value: '1m',   label: '1分钟'   },
  { value: '5m',   label: '5分钟'   },
  { value: '15m',  label: '15分钟'  },
  { value: '30m',  label: '30分钟'  },
  { value: '60m',  label: '60分钟'  },
  { value: '120m', label: '120分钟' },
  { value: '240m', label: '240分钟' },
  { value: '1d',   label: '日线'    },
  { value: '1w',   label: '周线'    },
  { value: '1M',   label: '月线'    },
];

const LINK_PERIODS = [
  { value: '__main__', label: '跟随主周期' },
  { value: '5m',   label: '5分钟'   },
  { value: '15m',  label: '15分钟'  },
  { value: '30m',  label: '30分钟'  },
  { value: '60m',  label: '60分钟'  },
  { value: '120m', label: '120分钟' },
  { value: '240m', label: '240分钟' },
  { value: '1d',   label: '日线'    },
  { value: '1w',   label: '周线'    },
];

const OPERATORS = [
  { value: '>',          label: '>'   },
  { value: '<',          label: '<'   },
  { value: 'up_cross',   label: '上穿' },
  { value: 'down_cross', label: '下穿' },
];

const toSelectVal   = (p: string) => p === '' ? '__main__' : p;
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

// ─── 品种多选面板 ──────────────────────────────────────────────────────────────

interface StockPickerProps {
  selected: string[];
  onChange: (codes: string[]) => void;
}

function StockPicker({ selected, onChange }: StockPickerProps) {
  const { availableSymbols, fetchSymbols, isLoading } = useMarketDataStore();
  const [open, setOpen]     = useState(false);
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

      {open && (
        <div className="rounded-md border bg-background shadow-sm overflow-hidden">
          <div className="p-2 border-b">
            <Input
              placeholder="搜索代码或名称..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-7 text-xs"
              autoFocus={false}
            />
          </div>

          {selected.length >= MAX_STOCKS && (
            <div className="px-3 py-1.5 text-[10px] text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 border-b">
              已达上限 {MAX_STOCKS} 支，请先点击标签移除再添加
            </div>
          )}

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

interface ConditionRowEditorProps {
  cond: ConditionRow;
  mainPeriod: string;
  onChange: (c: ConditionRow) => void;
  onRemove: () => void;
  canRemove: boolean;
  index: number;
}

function ConditionRowEditor({ cond, mainPeriod, onChange, onRemove, canRemove, index }: ConditionRowEditorProps) {
  const update = (patch: Partial<ConditionRow>) => onChange({ ...cond, ...patch });

  const handleIndicatorChange = (indicator: IndicatorKey) => {
    const defaults = resetLinesForIndicator(indicator);
    update({ indicator, ...defaults, rightType: 'line' });
  };

  const lines = INDICATOR_GROUPS[cond.indicator]?.lines ?? [];

  const linkPeriodOptions = LINK_PERIODS.filter(p =>
    p.value === '__main__' || p.value !== mainPeriod
  );

  // TROC 字段提示标签（显示在指标名旁，提示用户该字段的数值含义）
  const trocHintMap: Record<string, string> = {
    troc_phase:    '(+1/0/-1)',
    troc_pct:      '(0~1)',
    troc_chop:     '(0~100)',
    troc_acc:      '(0~1)',
    troc_dist:     '(0~-1)',
    troc_ob_dyn:   '(≈+1.5~2.5)',
    troc_os_dyn:   '(≈-2.5~-1.5)',
    troc_adx_s:    '(0~100)',
    troc_adx_l:    '(0~100)',
  };

  const isTroc = cond.indicator === 'TROC_S' || cond.indicator === 'TROC_L';

  return (
    <div className={cn(
      'rounded-lg border p-3 space-y-2.5 bg-card/40',
      isTroc && 'border-blue-500/30 bg-blue-500/5',   // TROC 条件高亮边框
    )}>
      {/* 顶部标题行 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground font-mono">#{index + 1}</span>
          {isTroc && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 border-blue-400/40 text-blue-400">
              TROC
            </Badge>
          )}
          {cond.period !== '' && (
            <span className="flex items-center gap-0.5 text-[10px] text-primary/70">
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

      {/* 联动周期 */}
      <div className="space-y-1">
        <div className="flex items-center gap-0.5">
          <Layers className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
          <span className="text-[9px] text-muted-foreground">联动周期</span>
        </div>
        <Select
          value={toSelectVal(cond.period)}
          onValueChange={v => update({ period: fromSelectVal(v) })}
        >
          <SelectTrigger className="h-8 text-xs bg-background/60 border-border/50 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="z-[999]">
            {linkPeriodOptions.map(p => (
              <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 5列条件行 */}
      <div className="grid grid-cols-5 gap-1">

        {/* ① 指标 */}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[9px] text-muted-foreground truncate px-0.5">指标</span>
          <Select value={cond.indicator} onValueChange={v => handleIndicatorChange(v as IndicatorKey)}>
            <SelectTrigger className="h-8 text-[11px] px-1.5 bg-background/60 border-border/50 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="z-[999]">
              {INDICATOR_LIST.map(ind => (
                <SelectItem key={ind.value} value={ind.value} className="text-xs">{ind.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ② 左值 */}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[9px] text-muted-foreground truncate px-0.5">左值</span>
          <Select value={cond.left} onValueChange={v => update({ left: v })}>
            <SelectTrigger className="h-8 text-[11px] px-1.5 bg-background/60 border-border/50 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="z-[999]">
              {lines.map(l => (
                <SelectItem key={l.value} value={l.value} className="text-xs">
                  {l.label}
                  {trocHintMap[l.value] && (
                    <span className="ml-1 text-[9px] text-muted-foreground">{trocHintMap[l.value]}</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ③ 运算符 */}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[9px] text-muted-foreground truncate px-0.5">运算符</span>
          <Select value={cond.operator} onValueChange={v => update({ operator: v })}>
            <SelectTrigger className="h-8 text-[11px] px-1.5 bg-background/60 border-border/50 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="z-[999]">
              {OPERATORS.map(op => (
                <SelectItem key={op.value} value={op.value} className="text-xs">{op.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ④ 右值类型 */}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[9px] text-muted-foreground truncate px-0.5">右值</span>
          <Select
            value={cond.rightType}
            onValueChange={v => {
              const t = v as 'value' | 'line';
              update({
                rightType:  t,
                rightValue: t === 'value'
                  ? '0'
                  : (lines[1]?.value ?? lines[0]?.value ?? ''),
              });
            }}
          >
            <SelectTrigger className="h-8 text-[11px] px-1.5 bg-background/60 border-border/50 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="z-[999]">
              <SelectItem value="value" className="text-xs">数值</SelectItem>
              <SelectItem value="line"  className="text-xs">指标线</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* ⑤ 具体右值 */}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[9px] text-transparent px-0.5 select-none">占位</span>
          {cond.rightType === 'value' ? (
            <input
              type="text"
              inputMode="decimal"
              value={cond.rightValue}
              onChange={e => update({ rightValue: e.target.value })}
              placeholder="0"
              className="h-8 w-full rounded-md border border-border/50
                         bg-background/60 px-1.5 py-0
                         text-[11px] leading-none text-center
                         text-foreground placeholder:text-muted-foreground
                         outline-none focus-visible:ring-2 focus-visible:ring-ring
                         [appearance:textfield]
                         [&::-webkit-outer-spin-button]:appearance-none
                         [&::-webkit-inner-spin-button]:appearance-none"
            />
          ) : (
            <Select value={cond.rightValue} onValueChange={v => update({ rightValue: v })}>
              <SelectTrigger className="h-8 text-[11px] px-1.5 bg-background/60 border-primary/40 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="z-[999]">
                {lines.map(l => (
                  <SelectItem key={l.value} value={l.value} className="text-xs">{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

      </div>

      {/* TROC 字段使用提示（仅 TROC 指标显示） */}
      {isTroc && (
        <div className="text-[9px] text-blue-400/70 leading-relaxed">
          {cond.indicator === 'TROC_S' && '短期振荡：OSC超买>+1.5 超卖<-1.5 · ADX>25为趋势市（信号有效区）'}
          {cond.indicator === 'TROC_L' && 'PHASE: +1=吸筹 0=中性 -1=派筹 · 分位<0.3为历史低位 · 震荡指数>61.8为震荡行情'}
        </div>
      )}
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
              className={cn(
                'text-xs px-3 py-1 rounded-full border transition-colors',
                logic === l
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'text-muted-foreground border-border hover:border-primary'
              )}
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
