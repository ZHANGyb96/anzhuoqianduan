"use client";

import { create } from 'zustand';
import { API_URL } from '@/config/constants';
import { useAuthStore } from './useAuthStore';
import { isCapacitor } from '@/config/platform';
import { getMobileDB } from '@/lib/mobile-db';

type Symbol = {
  value: string;
  label: string;
};

type MarketDataState = {
  availableSymbols: Symbol[];
  isLoading: boolean;
  error: string | null;
  fetchSymbols: () => Promise<void>;
};

export const useMarketDataStore = create<MarketDataState>((set, get) => ({
  availableSymbols:[],
  isLoading: false,
  error: null,
  
  fetchSymbols: async () => {
    // 防止重复触发并发请求
    if (get().isLoading) return;

    // ============================================
    // 📱 安卓移动端(Capacitor) 拦截逻辑：走本地 SQLite
    // ============================================
    if (isCapacitor) {
      set({ isLoading: true, error: null });
      try {
        const db = await getMobileDB();
        // 在本地查出已被用户同步过的独立品种及其名称
        const res = await db.query(
          `SELECT stock_code, MAX(stock_name) as stock_name 
           FROM kline_metrics GROUP BY stock_code ORDER BY stock_code`
        );
        const symbols = (res.values ??[]).map((r: any) => ({
          value: r.stock_code,
          label: r.stock_name ? `${r.stock_name} (${r.stock_code})` : r.stock_code
        }));
        set({ availableSymbols: symbols, isLoading: false });
      } catch (e: any) {
        set({ error: "读取本地数据库出错: " + e.message, isLoading: false });
      }
      return; // ✨✨✨ 数据拿到后立刻停止运行，杜绝执行下方的服务端抓取
    }

    // ============================================
    // 🌐 Web桌面端 云端接口拉取逻辑 (保留原有，不动)
    // ============================================
    const token = useAuthStore.getState().token;

    if (!token) {
        set({
            error: "用户未认证，无法加载数据。",
            isLoading: false,
            availableSymbols:[],
        });
        return;
    }

    set({ isLoading: true, error: null });

    try {
        const res = await fetch(`${API_URL}/api/v1/market-data/symbols`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            let errorMsg = '获取品种列表时发生未知错误';
            try {
               const errorBody = await res.json();
               errorMsg = errorBody.message || errorMsg;
            } catch(e){} // 忽略格式解析报错
            throw new Error(errorMsg);
        }

        const fetchedSymbols: { stock_code: string, stock_name: string | null }[] = await res.json();

        if (!Array.isArray(fetchedSymbols)) {
            throw new Error("API返回的品种列表格式不正确。");
        }

        const allSymbols = fetchedSymbols.map(s => ({ 
            value: s.stock_code, 
            label: s.stock_name ? `${s.stock_name} (${s.stock_code})` : s.stock_code 
        })).sort((a, b) => a.label.localeCompare(b.label));

        set({ availableSymbols: allSymbols, isLoading: false });

    } catch (error: any) {
        const errorMessage = String(error.message).includes('Failed to fetch') || String(error.message).includes('ERR_CONNECTION_REFUSED')
          ? "无法连接到后端API服务。请确认 Node.js 服务正在运行并且地址已填写正确。"
          : (error.message || "获取品种列表时发生未知错误");
        set({ error: errorMessage, isLoading: false, availableSymbols: [] 
        });
    }  

  }    

}));   