import { BarChart3 } from 'lucide-react';

export function Logo() {
  return (
    <div className="flex items-center gap-2 font-headline text-lg font-semibold tracking-tighter">
      <BarChart3 className="h-7 w-7 text-primary" />
      <span>AlphaScan AI</span>
    </div>
  );
}
