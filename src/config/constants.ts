export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://192.168.0.109:3001';

// This list is now populated dynamically from the backend. 
// Keeping the constant here to avoid breaking imports, but it should be empty.
export const STOCKS: { value: string; label: string; }[] = [];

export const TIME_PERIODS = [
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
