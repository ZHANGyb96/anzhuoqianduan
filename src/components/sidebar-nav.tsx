'use client';

import {
  AreaChart,
  BarChart,
  Database,
  FileText,
  History,
  LayoutDashboard,
  ShieldEllipsis,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { isCapacitor } from '@/config/platform';

import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '@/components/ui/sidebar';

const links =[
  { href: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
  { href: '/dashboard/charts', label: '图表分析', icon: AreaChart },
  { href: '/dashboard/backtest', label: '策略回测', icon: BarChart },
  { href: '/dashboard/history', label: '历史记录', icon: History },
  { href: '/dashboard/data-management', label: '数据管理', icon: Database },
  { href: '/dashboard/docs', label: '文档', icon: FileText },
];

export function SidebarNav() {
  const pathname = usePathname();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  return (
    <SidebarMenu>
      {links.map((link) => (
        <SidebarMenuItem key={link.href}>
          <SidebarMenuButton
            asChild
            isActive={pathname.startsWith(link.href) && (link.href !== '/dashboard' || pathname === '/dashboard')}
            tooltip={link.label}
          >
            <Link href={link.href}>
              <link.icon />
              <span>{link.label}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}

      {/* 管理员专属菜单，同时判断如果当前为 Capacitor(移动端) 环境则将其隐藏 */}
      {isAdmin && !isCapacitor && (
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={pathname === '/dashboard/admin'}
            tooltip="系统管理"
            className="text-primary font-bold hover:bg-primary/10"
          >
            <Link href="/dashboard/admin">
              <ShieldEllipsis />
              <span>系统管理</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}
    </SidebarMenu>
  );
}