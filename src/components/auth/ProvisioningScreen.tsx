import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';

const steps = [
  'Creating Workspace...',
  'Creating Database...',
  'Configuring Roles...',
  'Creating Default Departments...',
  'Setting Security...',
  'Done.',
];

export function ProvisioningScreen({ onComplete }: { onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (currentStep >= steps.length) {
      setTimeout(onComplete, 500);
      return;
    }
    
    const timer = setTimeout(() => {
      setCurrentStep(s => s + 1);
    }, currentStep === steps.length - 1 ? 500 : 800 + Math.random() * 800);
    
    return () => clearTimeout(timer);
  }, [currentStep, onComplete]);

  return (
    <div className="flex flex-col items-center justify-center py-12 animate-[auth-form-slide-up_0.5s_ease-out_both]">
      <div className="relative w-24 h-24 mb-8">
        <div className="absolute inset-0 border-4 border-white/10 rounded-full" />
        <div className="absolute inset-0 border-4 border-vitalink-500 rounded-full border-t-transparent animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <img src="/vitalink-icon.png" alt="Logo" className="w-8 h-8 object-contain opacity-90 animate-pulse" />
        </div>
      </div>
      
      <div className="w-full max-w-sm space-y-4">
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isDone = index < currentStep;
          
          return (
            <div 
              key={step} 
              className={`flex items-center gap-3 transition-all duration-300 ${
                isActive ? 'opacity-100 translate-x-2' : isDone ? 'opacity-60' : 'opacity-0'
              }`}
            >
              {isDone ? (
                <CheckCircle2 className="w-5 h-5 text-green-400" />
              ) : isActive ? (
                <Loader2 className="w-5 h-5 text-vitalink-400 animate-spin" />
              ) : (
                <div className="w-5 h-5 rounded-full border border-white/20" />
              )}
              <span className={`text-[15px] font-medium ${isActive ? 'text-white' : 'text-gray-400'}`}>
                {step}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
