'use client';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import ChartView from "./chart-view";

import { isCapacitor } from "@/config/platform";

export default function ChartsPage() {
  if (isCapacitor) {
    return <ChartView />;
  }

  return (
    <div className="flex flex-1 flex-col h-full min-h-0">
      <div className="mb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          图表分析
        </h1>
        <p className="text-muted-foreground">
          交互式 K 线图与技术指标分析。
        </p>
      </div>
      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="shrink-0">
            <CardTitle>市场数据</CardTitle>
            <CardDescription>选择一个标的以查看其详细的K线和指标数据。</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 p-0 sm:p-6 overflow-hidden">
          <ChartView />
        </CardContent>
      </Card>
    </div>
  );
}
