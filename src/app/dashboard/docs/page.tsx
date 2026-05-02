import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FileText } from "lucide-react";

export default function DocsPage() {
  return (
    <div className="flex flex-1 flex-col">
       <div className="mb-4">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          文档中心
        </h1>
        <p className="text-muted-foreground">
          查找关于系统架构、API和使用方法的详细文档。
        </p>
      </div>
      <Card>
        <CardHeader>
            <CardTitle>系统文档</CardTitle>
            <CardDescription>我们正在整理详细的开发与使用文档。</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="text-center text-muted-foreground py-20">
                <FileText className="mx-auto h-12 w-12" />
                <h3 className="mt-4 text-lg font-semibold">功能正在开发中</h3>
                <p>详细的系统和API文档即将上线。</p>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
