/**
 * ai-caller.ts
 * 统一的 AI API 调用层，支持 Anthropic / OpenAI / DeepSeek
 * Capacitor Android 下禁用流式输出（CapacitorHttp 不支持 ReadableStream）
 */

import { AIModel, ChatMessage } from '@/store/useAIStore';
import { isCapacitor } from '@/config/platform';

export type AIRequestOptions = {
  model: AIModel;
  apiKey: string;
  messages: ChatMessage[];
  systemPrompt: string;
  onChunk?: (delta: string) => void;  // 流式回调（Capacitor 下自动忽略）
};

// ─── Anthropic ────────────────────────────────────────────────────────────────

async function callAnthropic(opts: AIRequestOptions): Promise<string> {
  const { model, apiKey, messages, systemPrompt, onChunk } = opts;
  // Capacitor CapacitorHttp 拦截 fetch 后不支持 ReadableStream，强制非流式
  const useStream = !!onChunk && !isCapacitor;

  const body = {
    model:      model.id,
    max_tokens: model.maxTokens,
    system:     systemPrompt,
    stream:     useStream,
    messages:   messages.map(m => ({ role: m.role, content: m.content })),
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':         'application/json',
      'x-api-key':            apiKey,
      'anthropic-version':    '2023-06-01',
      'anthropic-dangerous-direct-browser-ipc': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Anthropic API 错误 ${res.status}`);
  }

  // 非流式（含 Capacitor 降级路径）
  if (!useStream) {
    const data = await res.json();
    const text = data.content?.[0]?.text ?? '';
    onChunk?.(text); // Capacitor：一次性把全文推给 onChunk，保持 UI 一致
    return text;
  }

  // 流式解析（仅 Web）
  const reader  = res.body!.getReader();
  const decoder = new TextDecoder();
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (json === '[DONE]') continue;
      try {
        const evt   = JSON.parse(json);
        const delta = evt?.delta?.text ?? '';
        if (delta) { full += delta; onChunk(delta); }
      } catch { /* skip malformed SSE */ }
    }
  }
  return full;
}

// ─── OpenAI / DeepSeek（同一接口格式） ───────────────────────────────────────

async function callOpenAICompat(opts: AIRequestOptions, baseUrl: string): Promise<string> {
  const { model, apiKey, messages, systemPrompt, onChunk } = opts;
  const useStream = !!onChunk && !isCapacitor;

  const body = {
    model:      model.id,
    max_tokens: model.maxTokens,
    stream:     useStream,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ],
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `API 错误 ${res.status}`);
  }

  if (!useStream) {
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? '';
    onChunk?.(text);
    return text;
  }

  const reader  = res.body!.getReader();
  const decoder = new TextDecoder();
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (json === '[DONE]') continue;
      try {
        const evt   = JSON.parse(json);
        const delta = evt?.choices?.[0]?.delta?.content ?? '';
        if (delta) { full += delta; onChunk(delta); }
      } catch { /* skip */ }
    }
  }
  return full;
}

// ─── 统一调用入口 ─────────────────────────────────────────────────────────────

export async function callAI(opts: AIRequestOptions): Promise<string> {
  const { provider } = opts.model;
  if (provider === 'anthropic') return callAnthropic(opts);
  if (provider === 'openai')    return callOpenAICompat(opts, 'https://api.openai.com/v1');
  if (provider === 'deepseek')  return callOpenAICompat(opts, 'https://api.deepseek.com/v1');
  if (provider === 'google')    return callGoogle(opts);
  throw new Error('未知的 AI 提供商');
}

// ─── Google Gemini（generateContent / streamGenerateContent） ─────────────────

async function callGoogle(opts: AIRequestOptions): Promise<string> {
  const { model, apiKey, messages, systemPrompt, onChunk } = opts;
  const useStream = !!onChunk && !isCapacitor;

  // Gemini API 将 system prompt 作为独立字段，history 为 user/model 交替格式
  const contents = messages.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      maxOutputTokens: model.maxTokens,
      temperature:     0.7,
    },
  };

  const endpoint = useStream ? 'streamGenerateContent' : 'generateContent';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:${endpoint}?key=${apiKey}${useStream ? '&alt=sse' : ''}`;

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message ?? `Google API 错误 ${res.status}`;
    throw new Error(msg);
  }

  // 非流式
  if (!useStream) {
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    onChunk?.(text);
    return text;
  }

  // 流式 SSE（&alt=sse 模式下每行是 data: {...}）
  const reader  = res.body!.getReader();
  const decoder = new TextDecoder();
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json || json === '[DONE]') continue;
      try {
        const evt   = JSON.parse(json);
        const delta = evt?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (delta) { full += delta; onChunk(delta); }
      } catch { /* skip */ }
    }
  }
  return full;
}

// ─── 构建 K 线分析的 System Prompt ───────────────────────────────────────────

export type ChartContext = {
  stockCode:   string;
  stockName:   string;
  period:      string;
  activePanes: string[];
  bars: Array<{
    time: string;
    open: number; high: number; low: number; close: number; volume: number;
    ma5?: number; ma10?: number; ma20?: number; ma60?: number;
    macd?: number; macd_signal?: number; macd_hist?: number;
    kdj_k?: number; kdj_d?: number; kdj_j?: number;
    rsi_6?: number; rsi_12?: number; rsi_24?: number;
    boll_upper?: number; boll_middle?: number; boll_lower?: number;
    cci?: number; bias_6?: number; bias_12?: number;
  }>;
};

export function buildSystemPrompt(ctx: ChartContext): string {
  const latest  = ctx.bars[ctx.bars.length - 1];
  const prev5   = ctx.bars.slice(-6, -1);
  const prev20  = ctx.bars.slice(-20);

  const high20  = Math.max(...prev20.map(b => b.high));
  const low20   = Math.min(...prev20.map(b => b.low));
  const avgVol5 = prev5.reduce((s, b) => s + b.volume, 0) / (prev5.length || 1);

  const fmt  = (n?: number) => n != null ? n.toFixed(3) : 'N/A';
  const fmtP = (n?: number) => n != null ? n.toFixed(2)  : 'N/A';

  // 序列化最近 60 根 K 线为紧凑文本
  const recentBars = ctx.bars.slice(-60).map(b =>
    `${b.time} O:${fmtP(b.open)} H:${fmtP(b.high)} L:${fmtP(b.low)} C:${fmtP(b.close)} V:${Math.round(b.volume)}`
      + (b.ma5   != null ? ` MA5:${fmtP(b.ma5)}`  : '')
      + (b.ma20  != null ? ` MA20:${fmtP(b.ma20)}` : '')
      + (b.macd  != null ? ` MACD:${fmt(b.macd)} DEA:${fmt(b.macd_signal)} HIST:${fmt(b.macd_hist)}` : '')
      + (b.kdj_k != null ? ` K:${fmtP(b.kdj_k)} D:${fmtP(b.kdj_d)} J:${fmtP(b.kdj_j)}` : '')
      + (b.rsi_6 != null ? ` RSI6:${fmtP(b.rsi_6)} RSI12:${fmtP(b.rsi_12)}` : '')
      + (b.boll_upper != null ? ` BOLU:${fmtP(b.boll_upper)} BOLM:${fmtP(b.boll_middle)} BOLD:${fmtP(b.boll_lower)}` : '')
      + (b.cci   != null ? ` CCI:${fmtP(b.cci)}` : '')
  ).join('\n');

  return `你是一位专业的量化分析师，正在分析以下 A 股 / 期货品种的 K 线数据。

## 当前分析标的
- 品种代码：${ctx.stockCode}（${ctx.stockName}）
- K 线周期：${ctx.period}
- 已启用副图指标：${ctx.activePanes.join(', ') || '无'}

## 最新报价（最后一根 K 线）
- 时间：${latest?.time ?? 'N/A'}
- 开盘：${fmtP(latest?.open)}  最高：${fmtP(latest?.high)}  最低：${fmtP(latest?.low)}  收盘：${fmtP(latest?.close)}
- 成交量：${latest?.volume != null ? Math.round(latest.volume) : 'N/A'}（5周期均量：${Math.round(avgVol5)}）
- 近 20 周期区间：高点 ${fmtP(high20)}，低点 ${fmtP(low20)}

## 最新指标快照
- MA5/10/20/60：${fmtP(latest?.ma5)} / ${fmtP(latest?.ma10)} / ${fmtP(latest?.ma20)} / ${fmtP(latest?.ma60)}
- MACD(DIF/DEA/HIST)：${fmt(latest?.macd)} / ${fmt(latest?.macd_signal)} / ${fmt(latest?.macd_hist)}
- KDJ(K/D/J)：${fmtP(latest?.kdj_k)} / ${fmtP(latest?.kdj_d)} / ${fmtP(latest?.kdj_j)}
- RSI(6/12)：${fmtP(latest?.rsi_6)} / ${fmtP(latest?.rsi_12)}
- BOLL(上/中/下)：${fmtP(latest?.boll_upper)} / ${fmtP(latest?.boll_middle)} / ${fmtP(latest?.boll_lower)}
- CCI：${fmtP(latest?.cci)}  BIAS6/12：${fmtP(latest?.bias_6)} / ${fmtP(latest?.bias_12)}

## 最近 60 根 K 线原始数据（从旧到新）
\`\`\`
${recentBars}
\`\`\`

## 分析要求
1. 优先根据用户提问进行针对性分析
2. 结合多个指标综合判断，不单一依赖某一指标
3. 明确指出关键支撑/压力位
4. 对趋势、动量、量价关系给出具体观点
5. 若数据不足以判断，明确告知
6. 回答使用中文，语言专业简练`;
}


