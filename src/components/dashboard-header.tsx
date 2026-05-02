'use client';

import { SidebarTrigger } from './ui/sidebar';
import { Logo } from './logo';
import { useAuthStore } from '@/store/useAuthStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { LogOut, User as UserIcon } from 'lucide-react';

interface DashboardHeaderProps {
  /** 移动端紧凑模式：隐藏 SidebarTrigger，降低 Header 高度 */
  compact?: boolean;
}

export function DashboardHeader({ compact = false }: DashboardHeaderProps) {
  const { user, logout } = useAuthStore();

  return (
    <header
      className={`sticky top-0 z-10 flex items-center gap-4 border-b bg-background/80 px-4 backdrop-blur-sm ${
        compact ? 'h-12' : 'h-16'
      }`}
    >
      {/* 桌面端：侧边栏触发按钮 + Logo */}
      {!compact && (
        <div className="flex items-center gap-4">
          <SidebarTrigger className="md:hidden" />
          <div className="hidden md:block">
            <Logo />
          </div>
        </div>
      )}

      {/* 移动端（compact）：直接显示 Logo 在左侧 */}
      {compact && (
        <div className="flex items-center">
          <Logo />
        </div>
      )}

      {/* 右侧用户菜单 */}
      <div className="flex flex-1 items-center justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-8 w-8 rounded-full">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">
                  {user?.email ? user.email.charAt(0).toUpperCase() : <UserIcon className="h-4 w-4" />}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">你好,</p>
                <p className="text-xs leading-none text-muted-foreground truncate max-w-[200px]">
                  {user?.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => logout()}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>登出</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
