import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { History } from "lucide-react";

export default function HistoryPage() {
  return (
    <div className="flex flex-1 flex-col">
       <div className="mb-4">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          历史记录
        </h1>
        <p className="text-muted-foreground">
          查看您过往的回测任务和结果。
        </p>
      </div>
      <Card>
        <CardHeader>
            <CardTitle>回测历史</CardTitle>
            <CardDescription>您最近执行的所有回测任务列表。</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="text-center text-muted-foreground py-20">
                <History className="mx-auto h-12 w-12" />
                <h3 className="mt-4 text-lg font-semibold">功能正在开发中</h3>
                <p>历史回测记录功能即将上线。</p>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
