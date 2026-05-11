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
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { DashboardHeader } from '@/components/dashboard-header';
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

  // ===== 移动端（Capacitor）：底部 Tab 导航布局 =====
  if (isCapacitor) {
    return (
      <div
        className="flex flex-col bg-background overflow-hidden"
        style={{ height: '100dvh' }}
      >
        {/* 图表页不显示顶部 header，节省空间 */}
        {!isChartPage && <DashboardHeader compact />}

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

  // ===== 桌面端：侧边栏布局（无 Logo 标题） =====
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          {/* Logo 已移除，仅保留版本 Badge */}
          <div className="px-2 pt-3 pb-1">
            <Badge variant="secondary" className="w-full justify-center py-1.5 gap-1 border-primary/20 font-headline">
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
