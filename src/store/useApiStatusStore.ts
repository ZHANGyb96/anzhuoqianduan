"use client";

import { create } from 'zustand';
import { API_URL } from '@/config/constants';

type ApiStatus = 'pending' | 'online' | 'offline';

type ApiStatusState = {
  status: ApiStatus;
  checkApiStatus: () => Promise<void>;
};

export const useApiStatusStore = create<ApiStatusState>((set) => ({
  status: 'pending',
  checkApiStatus: async () => {
    try {
      const response = await fetch(`${API_URL}/api/v1/health`);
      if (response.ok) {
        set({ status: 'online' });
      } else {
        set({ status: 'offline' });
      }
    } catch (error) {
      // This catch block is crucial for network errors like CONNECTION_REFUSED
      set({ status: 'offline' });
    }
  },
}));
