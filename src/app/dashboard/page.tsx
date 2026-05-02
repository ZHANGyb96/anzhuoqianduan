import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DollarSign, BarChart, Users, Activity } from "lucide-react";

export default function DashboardPage() {
  return (
    <div>
      {/* 响应式标题：移动端 xl → 桌面端 3xl */}
      <h1 className="text-xl font-bold tracking-tight font-headline sm:text-3xl">
        仪表盘概览
      </h1>
      <p className="text-sm text-muted-foreground mt-1 sm:text-base">
        欢迎来到您的 AlphaScan AI 仪表盘。
      </p>

      {/* 
        移动端：2列网格（grid-cols-2）
        桌面端：4列网格（lg:grid-cols-4）
        gap 在移动端收紧为 3，桌面端放开为 8
      */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 sm:gap-4 md:gap-6 mt-4 sm:mt-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-3 sm:pb-2 sm:pt-4 sm:px-4">
            <CardTitle className="text-xs font-medium sm:text-sm">
              总回测次数
            </CardTitle>
            <BarChart className="h-3.5 w-3.5 text-muted-foreground sm:h-4 sm:w-4" />
          </CardHeader>
          <CardContent className="px-3 pb-3 sm:px-4 sm:pb-4">
            <div className="text-xl font-bold sm:text-2xl">0</div>
            <p className="text-[10px] text-muted-foreground sm:text-xs">
              无可用数据
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-3 sm:pb-2 sm:pt-4 sm:px-4">
            <CardTitle className="text-xs font-medium sm:text-sm">
              活跃策略
            </CardTitle>
            <Activity className="h-3.5 w-3.5 text-muted-foreground sm:h-4 sm:w-4" />
          </CardHeader>
          <CardContent className="px-3 pb-3 sm:px-4 sm:pb-4">
            <div className="text-xl font-bold sm:text-2xl">0</div>
            <p className="text-[10px] text-muted-foreground sm:text-xs">
              无可用数据
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-3 sm:pb-2 sm:pt-4 sm:px-4">
            <CardTitle className="text-xs font-medium sm:text-sm">
              数据源
            </CardTitle>
            <Users className="h-3.5 w-3.5 text-muted-foreground sm:h-4 sm:w-4" />
          </CardHeader>
          <CardContent className="px-3 pb-3 sm:px-4 sm:pb-4">
            <div className="text-xl font-bold sm:text-2xl">N/A</div>
            <p className="text-[10px] text-muted-foreground sm:text-xs">
              无可用数据
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-3 sm:pb-2 sm:pt-4 sm:px-4">
            <CardTitle className="text-xs font-medium sm:text-sm">
              任务队列
            </CardTitle>
            <DollarSign className="h-3.5 w-3.5 text-muted-foreground sm:h-4 sm:w-4" />
          </CardHeader>
          <CardContent className="px-3 pb-3 sm:px-4 sm:pb-4">
            <div className="text-xl font-bold sm:text-2xl">N/A</div>
            <p className="text-[10px] text-muted-foreground sm:text-xs">
              无可用数据
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 近期活动：全宽卡片，内边距移动端收紧 */}
      <div className="mt-4 sm:mt-8">
        <Card>
          <CardHeader className="px-3 pt-3 pb-2 sm:px-6 sm:pt-6 sm:pb-2">
            <CardTitle className="text-sm sm:text-base">近期活动</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              您最近的回测和数据导入概览。
            </CardDescription>
          </CardHeader>
          <CardContent className="px-3 pb-4 sm:px-6 sm:pb-6">
            <div className="text-center text-muted-foreground py-8 sm:py-12">
              <p className="text-sm">暂无近期活动记录。</p>
              <p className="text-xs sm:text-sm mt-1">运行一次新的回测来开始吧。</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
