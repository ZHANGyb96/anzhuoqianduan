'use client';

/**
 * ai-analysis-panel.tsx
 * 右侧抽屉式 AI 分析面板：对话 + 设置 + 流式输出
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Bot, Send, Settings, Trash2, Eye, EyeOff,
  BarChart2, TrendingUp, Lightbulb, Loader2,
  CheckCircle2, X,
} from 'lucide-react';
import { useAIStore, AI_MODELS, ChatMessage } from '@/store/useAIStore';
import { callAI, buildSystemPrompt, ChartContext } from '@/lib/ai-caller';

// ─── 快捷问题模板 ─────────────────────────────────────────────────────────────

const QUICK_QUESTIONS = [
  { icon: TrendingUp,  label: '趋势分析',   text: '请分析当前趋势方向，判断是上涨、下跌还是震荡，并给出主要依据。' },
  { icon: BarChart2,   label: '指标信号',   text: '综合 MACD、KDJ、RSI 等指标，当前有哪些买入或卖出信号？' },
  { icon: Lightbulb,   label: '关键位置',   text: '当前关键支撑位和压力位在哪里？近期可能的突破方向是什么？' },
  { icon: Bot,         label: '综合建议',   text: '综合 K 线形态、成交量和各指标，给出当前操作建议（观望/轻仓/中仓/重仓）。' },
];

// ─── 单条消息气泡 ─────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage & { streaming?: boolean } }) {
  const isAI = msg.role === 'assistant';
  return (
    <div className={`flex gap-2.5 ${isAI ? '' : 'flex-row-reverse'}`}>
      {/* 头像 */}
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold mt-0.5
        ${isAI ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
        {isAI ? <Bot className="h-3.5 w-3.5" /> : '我'}
      </div>

      {/* 内容 */}
      <div className={`max-w-[82%] rounded-xl px-3 py-2 text-xs leading-relaxed
        ${isAI
          ? 'bg-muted/60 text-foreground rounded-tl-sm'
          : 'bg-primary text-primary-foreground rounded-tr-sm'}`}>
        {/* 简单的 markdown-like 渲染 */}
        {msg.content.split('\n').map((line, i) => {
          if (line.startsWith('## ')) return (
            <p key={i} className="font-bold text-[11px] mt-2 mb-0.5 opacity-80">{line.slice(3)}</p>
          );
          if (line.startsWith('- ') || line.startsWith('• ')) return (
            <p key={i} className="pl-2 before:content-['•'] before:mr-1.5 before:opacity-60">{line.slice(2)}</p>
          );
          if (line === '') return <div key={i} className="h-1.5" />;
          return <p key={i}>{line}</p>;
        })}
        {(msg as any).streaming && (
          <span className="inline-block w-1.5 h-3.5 bg-current opacity-70 animate-pulse ml-0.5 align-middle" />
        )}
      </div>
    </div>
  );
}

// ─── 设置面板 ─────────────────────────────────────────────────────────────────

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const {
    anthropicKey, openaiKey, deepseekKey, googleKey, selectedModelId,
    setAnthropicKey, setOpenaiKey, setDeepseekKey, setGoogleKey, setModel,
  } = useAIStore();

  const [showKeys, setShowKeys] = useState(false);

  const KeyInput = ({ label, value, onChange, placeholder }: {
    label: string; value: string;
    onChange: (v: string) => void; placeholder: string;
  }) => (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <div className="relative">
        <Input
          type={showKeys ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 text-xs pr-8 font-mono"
        />
        {value && (
          <CheckCircle2 className="absolute right-2.5 top-2 h-3.5 w-3.5 text-green-500" />
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4 p-1">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">AI 配置</h3>
        <button
          onClick={() => setShowKeys(v => !v)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {showKeys ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {showKeys ? '隐藏' : '显示'} Key
        </button>
      </div>

      {/* 模型选择 */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">选择模型</Label>
        <Select value={selectedModelId} onValueChange={setModel}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="z-[999]">
            {Object.entries(
              AI_MODELS.reduce((g, m) => {
                (g[m.provider] = g[m.provider] || []).push(m);
                return g;
              }, {} as Record<string, typeof AI_MODELS>)
            ).map(([provider, models]) => (
              <div key={provider}>
                <div className="px-2 py-1 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                  {provider}
                </div>
                {models.map(m => (
                  <SelectItem key={m.id} value={m.id} className="text-xs pl-4">
                    {m.label}
                  </SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {/* API Keys */}
      <KeyInput
        label="Anthropic API Key"
        value={anthropicKey}
        onChange={setAnthropicKey}
        placeholder="sk-ant-..."
      />
      <KeyInput
        label="Google AI Studio API Key"
        value={googleKey}
        onChange={setGoogleKey}
        placeholder="AIza..."
      />
      <KeyInput
        label="OpenAI API Key"
        value={openaiKey}
        onChange={setOpenaiKey}
        placeholder="sk-..."
      />
      <KeyInput
        label="DeepSeek API Key"
        value={deepseekKey}
        onChange={setDeepseekKey}
        placeholder="sk-..."
      />

      <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-2.5">
        <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed">
          API Key 仅存储在本地设备，不上传任何服务器。
          请确保 App 网络权限已允许访问 AI API 域名。
        </p>
      </div>

      <Button size="sm" className="w-full" onClick={onClose}>
        保存并返回
      </Button>
    </div>
  );
}

// ─── 主面板 ───────────────────────────────────────────────────────────────────

interface AIAnalysisPanelProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  chartContext: ChartContext | null;
}

export function AIAnalysisPanel({ open, onOpenChange, chartContext }: AIAnalysisPanelProps) {
  const {
    messages, isLoading, error,
    addMessage, setLoading, setError, clearMessages,
    isConfigured, getSelectedModel, getApiKey,
    selectedModelId,
  } = useAIStore();

  const [input,       setInput      ] = useState('');
  const [showSettings,setShowSettings] = useState(false);
  const [streamBuf,   setStreamBuf  ] = useState('');   // 正在流式输出的内容
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamBuf]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
    if (!isConfigured()) {
      setShowSettings(true);
      return;
    }
    if (!chartContext) {
      setError('请先在图表页面选择一支品种');
      return;
    }

    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
    addMessage(userMsg);
    setInput('');
    setLoading(true);
    setError(null);
    setStreamBuf('');

    try {
      const systemPrompt = buildSystemPrompt(chartContext);
      const model        = getSelectedModel();
      const apiKey       = getApiKey();

      let accumulated = '';

      await callAI({
        model,
        apiKey,
        systemPrompt,
        messages: [...messages, userMsg],
        onChunk: (delta) => {
          accumulated += delta;
          setStreamBuf(accumulated);
          // 自动滚底
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        },
      });

      addMessage({
        role:      'assistant',
        content:   accumulated,
        timestamp: Date.now(),
      });
    } catch (e: any) {
      setError(e?.message ?? 'AI 请求失败，请检查 API Key 和网络');
    } finally {
      setLoading(false);
      setStreamBuf('');
    }
  }, [isLoading, isConfigured, chartContext, messages, addMessage, setLoading, setError, getSelectedModel, getApiKey]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const selectedModel = AI_MODELS.find(m => m.id === selectedModelId);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        className="w-[360px] sm:w-[420px] p-0 flex flex-col gap-0 z-[500]
                   [&>button.absolute]:hidden"
      >
        {/* ── 头部 ── */}
        <SheetHeader className="flex-row items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
              <Bot className="h-3.5 w-3.5 text-primary" />
            </div>
            <div>
              <SheetTitle className="text-sm">AI 分析助手</SheetTitle>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">
                {chartContext
                  ? `${chartContext.stockCode} · ${chartContext.period} · ${chartContext.bars.length} 根`
                  : '未选择品种'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {isConfigured() && selectedModel && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 hidden sm:flex">
                {selectedModel.label}
              </Badge>
            )}
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7"
              onClick={() => setShowSettings(v => !v)}
              title="设置 API Key"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
            {messages.length > 0 && (
              <Button
                variant="ghost" size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={clearMessages}
                title="清空对话"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            {/* 显式关闭按钮，替代被隐藏的默认 × */}
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground ml-0.5"
              onClick={() => onOpenChange(false)}
              title="关闭"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </SheetHeader>

        {/* ── 设置面板（内联，非 Portal） ── */}
        {showSettings && (
          <div className="border-b bg-muted/20 px-4 py-4 shrink-0 overflow-y-auto max-h-[60vh]">
            <SettingsPanel onClose={() => setShowSettings(false)} />
          </div>
        )}

        {/* ── 未配置提示 ── */}
        {!isConfigured() && !showSettings && (
          <div className="px-4 py-3 shrink-0">
            <Alert className="bg-amber-500/10 border-amber-500/30">
              <AlertDescription className="text-xs text-amber-600 dark:text-amber-400">
                请先点击右上角 <Settings className="h-3 w-3 inline mx-0.5" /> 配置 API Key
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* ── 对话区 ── */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0"
        >
          {/* 欢迎语 */}
          {messages.length === 0 && !showSettings && (
            <div className="text-center py-8 space-y-2">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <p className="text-sm font-medium">你好，我是 AI 分析助手</p>
              <p className="text-xs text-muted-foreground px-4">
                我已读取当前品种的 K 线和所有指标数据，可以帮你分析行情
              </p>
            </div>
          )}

          {/* 历史消息 */}
          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}

          {/* 流式输出 */}
          {isLoading && streamBuf && (
            <MessageBubble
              msg={{ role: 'assistant', content: streamBuf, timestamp: Date.now(), streaming: true } as any}
            />
          )}

          {/* Loading 占位 */}
          {isLoading && !streamBuf && (
            <div className="flex gap-2.5">
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="bg-muted/60 rounded-xl rounded-tl-sm px-3 py-2 flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">正在分析...</span>
              </div>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
        </div>

        {/* ── 快捷问题 ── */}
        {messages.length === 0 && !showSettings && isConfigured() && chartContext && (
          <div className="px-4 pb-2 shrink-0">
            <p className="text-[10px] text-muted-foreground mb-2">快捷分析</p>
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_QUESTIONS.map(q => (
                <button
                  key={q.label}
                  onClick={() => send(q.text)}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[10px]
                             bg-muted/30 hover:bg-accent hover:border-primary/40
                             transition-colors text-left disabled:opacity-50"
                >
                  <q.icon className="h-3 w-3 text-primary shrink-0" />
                  <span>{q.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── 输入框 ── */}
        <div className="px-4 pb-4 pt-2 border-t shrink-0">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isConfigured() ? '输入问题，Enter 发送...' : '请先配置 API Key'}
              className="h-9 text-xs flex-1"
              disabled={isLoading || !isConfigured()}
            />
            <Button
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => send(input)}
              disabled={isLoading || !input.trim() || !isConfigured()}
            >
              {isLoading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />
              }
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
