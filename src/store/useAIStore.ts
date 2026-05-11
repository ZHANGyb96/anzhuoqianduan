/**
 * useAIStore.ts
 * 管理 AI 功能：API Key、模型选择、对话历史、分析状态
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AIModel = {
  id: string;
  label: string;
  provider: 'anthropic' | 'openai' | 'deepseek' | 'google';
  maxTokens: number;
};

export const AI_MODELS: AIModel[] = [
  { id: 'claude-sonnet-4-20250514',  label: 'Claude Sonnet 4',      provider: 'anthropic', maxTokens: 8000 },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',     provider: 'anthropic', maxTokens: 4000 },
  { id: 'gpt-4o',                    label: 'GPT-4o',                provider: 'openai',    maxTokens: 4000 },
  { id: 'gpt-4o-mini',               label: 'GPT-4o mini',           provider: 'openai',    maxTokens: 4000 },
  { id: 'gemini-2.5-pro',            label: 'Gemini 2.5 Pro',        provider: 'google',    maxTokens: 8000 },
  { id: 'gemini-2.5-flash',          label: 'Gemini 2.5 Flash',      provider: 'google',    maxTokens: 8000 },
  { id: 'gemini-2.0-flash',          label: 'Gemini 2.0 Flash',      provider: 'google',    maxTokens: 8000 },
  { id: 'deepseek-chat',             label: 'DeepSeek Chat',         provider: 'deepseek',  maxTokens: 4000 },
  { id: 'deepseek-reasoner',         label: 'DeepSeek Reasoner',     provider: 'deepseek',  maxTokens: 4000 },
];

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
};

export type AIState = {
  // 设置
  anthropicKey: string;
  openaiKey:    string;
  deepseekKey:  string;
  googleKey:    string;
  selectedModelId: string;

  // 对话
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;

  // Actions
  setAnthropicKey: (key: string) => void;
  setOpenaiKey:    (key: string) => void;
  setDeepseekKey:  (key: string) => void;
  setGoogleKey:    (key: string) => void;
  setModel:        (id: string)  => void;
  addMessage:      (msg: ChatMessage) => void;
  setLoading:      (v: boolean)  => void;
  setError:        (e: string | null) => void;
  clearMessages:   () => void;

  // Computed helpers
  getSelectedModel: () => AIModel;
  getApiKey:        () => string;
  isConfigured:     () => boolean;
};

export const useAIStore = create<AIState>()(
  persist(
    (set, get) => ({
      anthropicKey:    '',
      openaiKey:       '',
      deepseekKey:     '',
      googleKey:       '',
      selectedModelId: 'claude-sonnet-4-20250514',
      messages:        [],
      isLoading:       false,
      error:           null,

      setAnthropicKey: (key) => set({ anthropicKey: key }),
      setOpenaiKey:    (key) => set({ openaiKey: key }),
      setDeepseekKey:  (key) => set({ deepseekKey: key }),
      setGoogleKey:    (key) => set({ googleKey: key }),
      setModel:        (id)  => set({ selectedModelId: id }),
      addMessage:      (msg) => set(s => ({ messages: [...s.messages, msg] })),
      setLoading:      (v)   => set({ isLoading: v }),
      setError:        (e)   => set({ error: e }),
      clearMessages:   ()    => set({ messages: [] }),

      getSelectedModel: () =>
        AI_MODELS.find(m => m.id === get().selectedModelId) ?? AI_MODELS[0],

      getApiKey: () => {
        const { anthropicKey, openaiKey, deepseekKey, googleKey, getSelectedModel } = get();
        const provider = getSelectedModel().provider;
        if (provider === 'anthropic') return anthropicKey;
        if (provider === 'openai')    return openaiKey;
        if (provider === 'deepseek')  return deepseekKey;
        if (provider === 'google')    return googleKey;
        return '';
      },

      isConfigured: () => get().getApiKey().trim().length > 10,
    }),
    {
      name: 'ai-settings',
      // 只持久化设置，不持久化对话历史
      partialize: (s) => ({
        anthropicKey:    s.anthropicKey,
        openaiKey:       s.openaiKey,
        deepseekKey:     s.deepseekKey,
        googleKey:       s.googleKey,
        selectedModelId: s.selectedModelId,
      }),
    }
  )
);
