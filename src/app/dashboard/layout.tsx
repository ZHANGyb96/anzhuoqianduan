'use client';

import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { LoaderCircle, Settings, ShieldCheck } from 'lucide-react';
import { SidebarNav } from '@/components/sidebar-nav';
import { MobileBottomNav } from '@/components/mobile-bottom-nav'; // 新增
import { DashboardHeader } from '@/components/dashboard-header';
import { Logo } from '@/components/logo';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useLicenseStore } from '@/store/useLicenseStore';
import { useAuthStore } from '@/store/useAuthStore';
import { Badge } from '@/components/ui/badge';
import { isCapacitor } from '@/config/platform';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isValid, tier, isInitialized: licenseInit, checkStatus } = useLicenseStore();
  const { user, isInitialized: authInit } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const isChartPage = pathname.includes('/dashboard/charts');

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    if (authInit && !user) {
      router.push('/login');
      return;
    }
    if (authInit && user && licenseInit && !isValid) {
      router.push('/activate');
      return;
    }
  }, [authInit, user, licenseInit, isValid, router]);

  if (!authInit || !licenseInit || !user || !isValid) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#17191C]">
        <div className="text-center">
          <LoaderCircle className="h-10 w-10 animate-spin text-primary mx-auto" />
          <p className="mt-4 text-sm text-muted-foreground font-body">正在初始化量化分析环境...</p>
        </div>
      </div>
    );
  }

  // ===== 移动端（Capacitor Android）：底部 Tab 导航布局 =====
  if (isCapacitor) {
  return (
    // 改动：h-screen → height:100dvh（Android WebView 更精确）
    <div
      className="flex flex-col bg-background overflow-hidden"
      style={{ height: '100dvh' }}
    >
      {!isChartPage && <DashboardHeader compact />}

      {/* 改动1：加 min-h-0，防止 flex-1 子项无法收缩
          改动2：isChartPage 时加 paddingBottom，为固定底部导航留出 64px，
                 否则图表最下方会被导航栏遮住 */}
      <main
        className={`flex-1 min-h-0 flex flex-col overflow-x-hidden ${
          isChartPage
            ? 'overflow-y-hidden'
            : 'overflow-y-auto w-full mobile-main-content'
        }`}
        style={
          isChartPage
            ? { paddingBottom: 'calc(64px + env(safe-area-inset-bottom, 0px))' }
            : undefined
        }
      >
        {/* 改动3：图表页改为 flex flex-col，让 ChartView 能用 flex-1 填满剩余高度 */}
        <div
          className={
            isChartPage
              ? 'flex-1 min-h-0 flex flex-col overflow-hidden w-full'
              : 'p-3 pb-6'
          }
        >
          {children}
        </div>
      </main>

      <MobileBottomNav />
    </div>
  );
}

  // ===== 桌面端：保留原有侧边栏布局 =====
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <Logo />
          <div className="px-2 mt-2">
            <Badge variant="secondary" className="w-full justify-center py-1 gap-1 border-primary/20 font-headline">
              <ShieldCheck className="h-3 w-3 text-primary" />
              {tier} EDITION
            </Badge>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarNav />
        </SidebarContent>
        <SidebarFooter>
          <Button variant="ghost" className="justify-start gap-2">
            <Settings className="h-4 w-4" />
            <span>系统设置</span>
          </Button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <div className="flex min-h-screen w-full flex-col">
          <DashboardHeader />
          <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
            {children}
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
