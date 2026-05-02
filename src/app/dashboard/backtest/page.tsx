
'use client';

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StrategyBuilder from './strategy-builder';
import BacktestResults from './backtest-results';
import SignalDetails from './signal-details';

export default function BacktestPage() {

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          策略回测
        </h1>
        <p className="text-muted-foreground">
          构建并测试您的量化交易策略。
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <div className="grid auto-rows-max items-start gap-6 lg:col-span-1">
            <Card>
                <CardHeader>
                    <CardTitle>回测配置</CardTitle>
                </CardHeader>
                <CardContent>
                    <StrategyBuilder />
                </CardContent>
            </Card>
        </div>
        
        <div className="grid auto-rows-max items-start gap-6 lg:col-span-1">
            <BacktestResults />
        </div>
      </div>

      <div className="mt-6">
        <SignalDetails />
      </div>
    </div>
  );
}
