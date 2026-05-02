export const isCapacitor = 
    typeof window !== 'undefined' && !!(window as any).Capacitor;

export const isMobile = 
    typeof window !== 'undefined' && 
    /Android|iPhone|iPad/i.test(navigator.userAgent);