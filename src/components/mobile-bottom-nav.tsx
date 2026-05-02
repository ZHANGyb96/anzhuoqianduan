'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AreaChart,
  BarChart,
  Database,
  History,
  LayoutDashboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { href: '/dashboard',             label: '首页',   icon: LayoutDashboard },
  { href: '/dashboard/charts',      label: '图表',   icon: AreaChart       },
  { href: '/dashboard/backtest',    label: '回测',   icon: BarChart        },
  { href: '/dashboard/history',     label: '历史',   icon: History         },
  { href: '/dashboard/data-management', label: '数据', icon: Database      },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    // fixed 固定在底部，z-50 覆盖页面内容，安全区内边距适配手势条
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur-sm bottom-nav-safe"
      style={{ height: 'calc(64px + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="flex h-16 items-center justify-around px-2">
        {tabs.map(({ href, label, icon: Icon }) => {
          const isActive =
            pathname === href ||
            (href !== '/dashboard' && pathname.startsWith(href));

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 rounded-xl px-3 py-2 transition-colors',
                'min-w-[52px] min-h-[44px]', // 保证触控热区
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon
                className={cn(
                  'h-5 w-5 transition-transform',
                  isActive && 'scale-110'
                )}
                strokeWidth={isActive ? 2.5 : 1.8}
              />
              <span
                className={cn(
                  'text-[10px] leading-tight font-medium',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
