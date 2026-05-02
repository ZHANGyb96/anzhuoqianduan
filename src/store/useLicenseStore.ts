// src/store/useLicenseStore.ts
"use client";

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { API_URL } from '@/config/constants';
import { useAuthStore } from './useAuthStore';
import * as jose from 'jose';

export type LicenseTier = 'BASIC' | 'PRO' | 'ELITE' | 'NONE';

const OFFLINE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAk1wwVZ4O1SA9BL9Y2Wap
2q3aQzKw7CWMwoZNpMAP/7LwzsMpR/FnmX1fvcnbGdiS8u6/DBCKBUZcXUHtqkZS
Rju6W4y5AUH2KTZv2OmYnLZePU1/hB/AuBlTOASrUYkctbddAn66Lkl6qsgkRThp
R2G+EO3ahD/xG2al2bVXtC2rydiHB7SDpVkTi+GAeVHw3GBznEd/Un9kkOxjLVEm
9MNFpEeIUJbrzu9H5LhLqBxyQXqDYr4OgvvfLglSY6zqMi0z/UC/cNi0MKZez4Gn
85ehv9D2FJHoAnWT3Kju161bkhHJnWYRnCWR+Fj3DRSogMLBO3KoySqI3uxjOA9V
5QIDAQAB
-----END PUBLIC KEY-----`;

type LicenseState = {
    isValid:         boolean;
    tier:            LicenseTier;
    expiresAt:       string | null;
    isInitialized:   boolean;
    savedLicenseKey: string | null;
    lastVerifiedAt:  number | null;
};

type LicenseActions = {
    checkStatus:   () => Promise<void>;
    activate:      (key: string) => Promise<{ success: boolean; message: string }>;
    logoutLicense: () => void;
};

// ─── 平台感知 HTTP 封装 ────────────────────────────────────────────────
/**
 * Capacitor 环境：使用 CapacitorHttp 原生插件，绕过 WebView 混合内容拦截
 *   ( App 跑在 https://localhost，后端是 http://192.168.x.x，Android 会拦截 fetch )
 * 浏览器环境：回退到标准 fetch()，供本地 Web 开发调试
 */
async function platformFetch(
    url: string,
    options: {
        method:     'GET' | 'POST';
        headers?:   Record<string, string>;
        body?:      Record<string, any>;
        timeoutMs?: number;
    }
): Promise<{ ok: boolean; status: number; data: any }> {

    const isCapacitor =
        typeof window !== 'undefined' &&
        !!(window as any).Capacitor?.isNativePlatform?.();

    if (isCapacitor) {
        const { CapacitorHttp } = await import('@capacitor/core');
        const response = await CapacitorHttp.request({
            url,
            method:  options.method,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers ?? {}),
            },
            ...(options.body ? { data: options.body } : {}),
            connectTimeout: options.timeoutMs ?? 8000,
            readTimeout:    options.timeoutMs ?? 8000,
        });
        return {
            ok:     response.status >= 200 && response.status < 300,
            status: response.status,
            data:   response.data ?? {},
        };
    }

    // Web 浏览器
    const res = await fetch(url, {
        method:  options.method,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers ?? {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
    });
    let data: any;
    try { data = await res.json(); } catch { data = {}; }
    return { ok: res.ok, status: res.status, data };
}

// ─── 本地 RSA 离线验签 ────────────────────────────────────────────────
async function localVerify(key: string): Promise<{
    valid: boolean; tier: LicenseTier; expiresAt: string | null;
}> {
    try {
        const publicKey   = await jose.importSPKI(PUBLIC_KEY_PEM, 'RS256');
        const { payload } = await jose.jwtVerify(key, publicKey);
        const now         = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) {
            return { valid: false, tier: 'BASIC', expiresAt: null };
        }
        return {
            valid:     true,
            tier:      (payload.tier as LicenseTier) || 'ELITE',
            expiresAt: (payload.expiresAt as string) ?? null,
        };
    } catch {
        return { valid: false, tier: 'BASIC', expiresAt: null };
    }
}

// ─── Store ────────────────────────────────────────────────────────────
export const useLicenseStore = create<LicenseState & LicenseActions>()(
    persist(
        (set, get) => ({
            isValid:         false,
            tier:            'BASIC',
            expiresAt:       null,
            isInitialized:   false,
            savedLicenseKey: null,
            lastVerifiedAt:  null,

            checkStatus: async () => {
                const token = useAuthStore.getState().token;
                if (!token) {
                    set({ isValid: false, tier: 'BASIC', isInitialized: true });
                    return;
                }

                // ① 联网查后端
                try {
                    const res = await platformFetch(
                        `${API_URL}/api/v1/license/status`,
                        { method: 'GET', headers: { Authorization: `Bearer ${token}` }, timeoutMs: 5000 }
                    );
                    if (res.ok) {
                        set({
                            isValid:        res.data.isValid  ?? false,
                            tier:           res.data.tier     ?? 'BASIC',
                            expiresAt:      res.data.expiresAt ?? null,
                            isInitialized:  true,
                            lastVerifiedAt: res.data.isValid ? Date.now() : null,
                        });
                        return;
                    }
                    if (res.status === 401 || res.status === 403) {
                        set({ isValid: false, tier: 'BASIC', isInitialized: true, lastVerifiedAt: null });
                        return;
                    }
                } catch {
                    console.warn('[useLicenseStore] 后端不可达，检查离线缓存...');
                }

                // ② 离线降级：24h 窗口
                const { savedLicenseKey, lastVerifiedAt } = get();
                const now        = Date.now();
                const cacheAlive = lastVerifiedAt !== null &&
                    (now - lastVerifiedAt) < OFFLINE_CACHE_TTL_MS;

                if (cacheAlive && savedLicenseKey) {
                    const remaining = Math.ceil(
                        (OFFLINE_CACHE_TTL_MS - (now - lastVerifiedAt!)) / (60 * 60 * 1000)
                    );
                    console.warn(`[useLicenseStore] 离线缓存有效，剩余约 ${remaining} 小时`);
                    const { valid, tier, expiresAt } = await localVerify(savedLicenseKey);
                    set({ isValid: valid, tier: valid ? tier : 'BASIC', expiresAt, isInitialized: true });
                    return;
                }

                // ③ 过期或无 key → BASIC
                if (lastVerifiedAt !== null && !cacheAlive) {
                    console.warn('[useLicenseStore] 离线缓存已超过 24h，需联网重新验证');
                }
                set({ isValid: false, tier: 'BASIC', isInitialized: true, lastVerifiedAt: null });
            },

            activate: async (licenseKey: string) => {
                const token = useAuthStore.getState().token;
                if (!token) {
                    return { success: false, message: '请先登录账号后再进行激活' };
                }

                try {
                    const res = await platformFetch(
                        `${API_URL}/api/v1/license/activate`,
                        {
                            method:    'POST',
                            headers:   { Authorization: `Bearer ${token}` },
                            body:      { licenseKey },
                            timeoutMs: 8000,
                        }
                    );

                    if (res.ok) {
                        set({
                            isValid:         true,
                            tier:            res.data.tier      ?? 'ELITE',
                            expiresAt:       res.data.expiresAt ?? null,
                            savedLicenseKey: licenseKey,
                            lastVerifiedAt:  Date.now(),
                        });
                        return { success: true, message: res.data.message ?? '激活成功！' };
                    }

                    return {
                        success: false,
                        message: res.data.message ?? '激活失败，请检查激活码',
                    };
                } catch (e) {
                    console.warn('[useLicenseStore] 激活请求失败:', e);
                    return {
                        success: false,
                        message: '无法连接服务器，请确认：\n① 手机和电脑在同一 WiFi\n② 后端服务已启动（npm run dev）',
                    };
                }
            },

            logoutLicense: () => {
                set({
                    isValid:         false,
                    tier:            'BASIC',
                    expiresAt:       null,
                    savedLicenseKey: null,
                    lastVerifiedAt:  null,
                });
            },
        }),
        {
            name:    'alphascan-license',
            storage: createJSONStorage(() => localStorage),
            partialize: (s) => ({
                savedLicenseKey: s.savedLicenseKey,
                lastVerifiedAt:  s.lastVerifiedAt,
            }),
            onRehydrateStorage: () => (state) => {
                if (state) state.isInitialized = false;
            },
        }
    )
);
