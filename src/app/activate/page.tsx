'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Logo } from '@/components/logo';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ShieldCheck, Key, AlertCircle, LogOut, Loader2 } from 'lucide-react';
import { useLicenseStore } from '@/store/useLicenseStore';
import { useAuthStore } from '@/store/useAuthStore';

export default function ActivationPage() {
    const router = useRouter();
    const { toast } = useToast();

    const { activate, checkStatus, isValid, isInitialized } = useLicenseStore();
    const { user, logout } = useAuthStore();

    const [licenseKey, setLicenseKey] = useState('');
    const [isLoading,  setIsLoading]  = useState(false);
    const [isChecking, setIsChecking] = useState(true);
    const [error,      setError]      = useState<string | null>(null);

    // 未登录直接跳走
    useEffect(() => {
        if (!user) router.replace('/login');
    }, [user, router]);

    // 启动时向后端查一次授权状态（重装后自动恢复的核心）
    useEffect(() => {
        if (!user) return;
        const check = async () => {
            setIsChecking(true);
            await checkStatus();
            setIsChecking(false);
        };
        check();
    }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

    // 已激活（含重装后自动恢复）→ 直接进 Dashboard
    useEffect(() => {
        if (isInitialized && isValid) {
            router.replace('/dashboard');
        }
    }, [isInitialized, isValid, router]);

    const handleActivate = async () => {
        const trimmed = licenseKey.trim();
        if (!trimmed) return;

        setIsLoading(true);
        setError(null);

        const result = await activate(trimmed);

        if (result.success) {
            toast({ title: '激活成功 ✅', description: result.message });
            router.replace('/dashboard');
        } else {
            setError(result.message);
            setIsLoading(false);
        }
    };

    const handleLogout = () => {
        logout();
        router.replace('/login');
    };

    // 启动检查中：全屏 Loading
    if (!user || isChecking) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center bg-[#17191C] gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">正在验证授权状态...</p>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#17191C] p-4 font-body">
            <div className="mb-10 text-center">
                <Logo />
                <p className="text-muted-foreground mt-2">AlphaScan AI 授权中心</p>
            </div>

            <Card className="w-full max-w-lg border-primary/20 bg-card/50 backdrop-blur-xl">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                        <Key className="h-6 w-6 text-primary" />
                    </div>
                    <CardTitle className="text-2xl font-headline">软件激活</CardTitle>
                    <CardDescription>
                        当前账号：<span className="text-primary font-bold">{user.email}</span>
                        <br />
                        请输入您的 License Key 以解锁专业量化功能
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                    {error && (
                        <Alert variant="destructive" className="bg-destructive/10">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>激活失败</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <Textarea
                        placeholder="请粘贴完整的 License Key..."
                        className="min-h-[130px] font-mono text-xs leading-relaxed bg-background/50 border-primary/10"
                        value={licenseKey}
                        onChange={e => setLicenseKey(e.target.value)}
                    />

                    <Button
                        className="w-full h-12 text-base font-bold"
                        onClick={handleActivate}
                        disabled={isLoading || !licenseKey.trim()}
                    >
                        {isLoading
                            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在验证...</>
                            : '立即激活'
                        }
                    </Button>
                </CardContent>

                <CardFooter className="flex items-center justify-between border-t pt-5">
                    <p className="text-xs text-muted-foreground">
                        激活后绑定此账号<br />
                        重装 App 登录即可自动恢复授权
                    </p>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-muted-foreground"
                        onClick={handleLogout}
                    >
                        <LogOut className="h-3.5 w-3.5" />
                        更换账号
                    </Button>
                </CardFooter>
            </Card>

            <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-green-500" />
                RSA-2048 验签 · 激活码与账号绑定存储于私有服务器
            </div>
        </div>
    );
}
