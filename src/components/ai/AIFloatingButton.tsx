import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AIFloatingButtonProps {
  onClick: () => void;
}

export function AIFloatingButton({ onClick }: AIFloatingButtonProps) {
  return (
    <button
      onClick={onClick}
      data-floating-scan-button="true"
      title="Open VitaMind AI"
      className={cn(
        "ai-float-btn fixed z-40 w-14 h-14 rounded-2xl flex items-center justify-center",
        "bg-gradient-to-br from-vitalink-500 to-vitalink-700",
        "shadow-lg shadow-vitalink-500/30",
        "border border-white/20",
        "transition-all duration-300 ease-out",
        "hover:scale-110 hover:shadow-xl hover:shadow-vitamind-500/30",
        "group"
      )}
    >
      <div className="absolute inset-0 rounded-2xl bg-vitamind-400/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="absolute w-full h-full rounded-2xl border border-vitamind-300/30 animate-ping" style={{ animationDuration: '2s' }} />
      </div>
      
      <Sparkles className="w-6 h-6 text-white relative z-10 group-hover:rotate-12 transition-transform duration-300" />
      
      <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-vitamind-500 text-[10px] font-bold text-white flex items-center justify-center border-2 border-white">
        3
      </div>
    </button>
  );
}
