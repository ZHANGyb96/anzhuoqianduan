"use client"
 
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
 
type User = {
    id: number;
    email: string;
    role: 'user' | 'admin';
};
 
type AuthState = {
    user: User | null;
    token: string | null;
    isInitialized: boolean;
};
 
type AuthActions = {
    login: (token: string, user: User) => void;
    logout: () => void;
};
 
const initialState: AuthState = {
    user: null,
    token: null,
    isInitialized: false,
};
 
// 无效 token 特征：硬编码假 token 或非 JWT 格式（JWT 必须包含两个 "."）
const isValidToken = (token: string | null): boolean => {
    if (!token) return false;
    if (token === 'offline-local-token') return false;
    return token.split('.').length === 3;
};
 
export const useAuthStore = create<AuthState & AuthActions>()(
    persist(
        (set) => ({
            ...initialState,
            login: (token, user) => set({ token, user }),
            logout: () => set({ user: null, token: null, isInitialized: true }),
        }),
        {
            name: 'auth-storage',
            storage: createJSONStorage(() => localStorage),
            onRehydrateStorage: () => (state) => {
                if (state) {
                    // 检测到无效/假 token，直接清除，强制重新登录
                    if (!isValidToken(state.token)) {
                        state.token = null;
                        state.user = null;
                    }
                    state.isInitialized = true;
                }
            },
        }
    )
);