'use client';
 
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/store/useAuthStore';
import { Logo } from '@/components/logo';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, LogIn, UserPlus, ShieldCheck } from 'lucide-react';
 
const BACKEND_URL = 'http://192.168.0.109:3001';
 
const authSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
  password: z.string().min(6, '密码至少需要6位'),
});
 
type AuthFormValues = z.infer<typeof authSchema>;
 
export default function LoginPage() {
  const router = useRouter();
  const { login: storeLogin, user } = useAuthStore();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
 
  useEffect(() => {
    if (user) router.push('/dashboard');
  }, [user, router]);
 
  const form = useForm<AuthFormValues>({
    resolver: zodResolver(authSchema),
    defaultValues: { email: '', password: '' },
  });
 
  const { isSubmitting } = form.formState;
 
  const onSubmit = async (data: AuthFormValues) => {
    setError(null);
    const endpoint = isRegistering ? 'register' : 'login';
    const url = `${BACKEND_URL}/api/v1/auth/${endpoint}`;
 
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email, password: data.password }),
      });
 
      let result;
      const text = await response.text();
      try {
        result = text ? JSON.parse(text) : {};
      } catch (e) {
        throw new Error('服务器响应异常，请检查后端服务是否正常启动。');
      }
 
      if (!response.ok) {
        throw new Error(result.message || `${isRegistering ? '注册' : '登录'}失败`);
      }
 
      if (isRegistering) {
        toast({ title: '注册成功', description: '现在您可以使用新账户登录了。' });
        setIsRegistering(false);
        form.reset();
      } else {
        storeLogin(result.token, result.user);
        toast({ title: '登录成功', description: '欢迎回来！' });
        router.push('/dashboard');
      }
    } catch (err: any) {
      if (
        err.message === 'Failed to fetch' ||
        err.message.includes('Network Error') ||
        err.message.includes('JSON')
      ) {
        setError(`无法连接到服务器 (${BACKEND_URL})。请检查手机网络或服务器是否开启。`);
      } else {
        setError(err.message);
      }
    }
  };
 
  const toggleMode = () => {
    setIsRegistering(!isRegistering);
    setError(null);
    form.reset();
  };
 
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#17191C] p-4 font-body">
      <div className="mb-10 text-center">
        <Logo />
        <p className="text-muted-foreground mt-2">AlphaScan AI 身份中心</p>
      </div>
 
      <Card className="w-full max-w-md border-primary/20 bg-card/50 backdrop-blur-xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-headline flex items-center justify-center gap-2">
            {isRegistering ? <UserPlus className="h-6 w-6 text-primary" /> : <LogIn className="h-6 w-6 text-primary" />}
            {isRegistering ? '创建量化账户' : '欢迎回来'}
          </CardTitle>
          <CardDescription>
            {isRegistering ? '只需几秒，开启您的专业量化之旅。' : '请输入您的凭据以访问您的仪表盘。'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {error && (
                <Alert variant="destructive" className="bg-destructive/10">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{isRegistering ? '注册' : '登录'}出错</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>电子邮箱</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="user@example.com"
                        className="bg-background/50 border-primary/10"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>访问密码</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        className="bg-background/50 border-primary/10"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full h-11 font-bold text-base mt-2"
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? isRegistering ? '正在创建...' : '正在验证...'
                  : isRegistering ? '立即注册' : '安全登录'}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex flex-col border-t pt-4">
          <Button variant="link" className="text-primary" onClick={toggleMode}>
            {isRegistering ? '已经有账户了？点此登录' : '还没有账户？点此注册'}
          </Button>
        </CardFooter>
      </Card>
      <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-green-500" />
        云端网络安全校验护航
      </div>
    </div>
  );
}