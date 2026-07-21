import { Shield, ChevronRight, Crown, Stethoscope, UserCircle, Pill, FlaskConical, Microscope, CreditCard, FileCheck2, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const roles = [
  { id: 'super-admin' as const, label: 'Super Admin', icon: Crown, color: 'bg-purple-100 text-purple-700', description: 'Full system access' },
  { id: 'hospital-admin' as const, label: 'Hospital Admin', icon: Shield, color: 'bg-blue-100 text-blue-700', description: 'Hospital management' },
  { id: 'doctor' as const, label: 'Doctor', icon: Stethoscope, color: 'bg-green-100 text-green-700', description: 'Patient care & EMR' },
  { id: 'nurse' as const, label: 'Nurse', icon: UserCircle, color: 'bg-pink-100 text-pink-700', description: 'Patient care & vitals' },
  { id: 'receptionist' as const, label: 'Receptionist', icon: UserCircle, color: 'bg-amber-100 text-amber-700', description: 'Appointments & registration' },
  { id: 'lab-scientist' as const, label: 'Lab Scientist', icon: FlaskConical, color: 'bg-indigo-100 text-indigo-700', description: 'Laboratory management' },
  { id: 'lab-technician' as const, label: 'Lab Technician', icon: Microscope, color: 'bg-violet-100 text-violet-700', description: 'Samples & raw data entry' },
  { id: 'pharmacist' as const, label: 'Pharmacist', icon: Pill, color: 'bg-teal-100 text-teal-700', description: 'Pharmacy & inventory' },
  { id: 'billing-officer' as const, label: 'Billing Officer', icon: CreditCard, color: 'bg-orange-100 text-orange-700', description: 'Billing & insurance' },
  { id: 'insurance-officer' as const, label: 'Insurance Officer', icon: FileCheck2, color: 'bg-cyan-100 text-cyan-700', description: 'Claims processing' },
  { id: 'it-officer' as const, label: 'IT Officer', icon: Monitor, color: 'bg-slate-100 text-slate-700', description: 'System & security' },
  { id: 'support-agent' as const, label: 'Support Agent', icon: Shield, color: 'bg-fuchsia-100 text-fuchsia-700', description: 'Support tickets & user assistance' },
];

export function RoleSwitcher() {
  const { currentRole, setCurrentRole, userName } = useAuth();

  const handleRoleChange = (roleId: typeof roles[0]['id']) => {
    setCurrentRole(roleId);
    const role = roles.find(r => r.id === roleId);
    toast.success(`Switched to ${role?.label}`, {
      description: `Dashboard will update based on ${role?.label} permissions`,
    });
    // Reload to apply changes
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  return (
    <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl p-6 shadow-soft">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-[#1E4ED8]/10 flex items-center justify-center">
          <Shield className="w-5 h-5 text-[#1E4ED8]" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">Role Simulation</h3>
          <p className="text-sm text-gray-500">Change roles to test RBAC</p>
        </div>
      </div>

      <div className="space-y-2">
        {roles.map((role) => {
          const Icon = role.icon;
          const isActive = currentRole === role.id;
          
          return (
            <button
              key={role.id}
              onClick={() => handleRoleChange(role.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200",
                isActive 
                  ? "bg-[#1E4ED8]/10 border-2 border-[#1E4ED8]/30" 
                  : "hover:bg-gray-50 border-2 border-transparent"
              )}
            >
              <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0", role.color)}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{role.label}</span>
                  {isActive && (
                    <span className="px-2 py-0.5 rounded-full bg-[#1E4ED8] text-white text-[10px] font-medium">
                      Active
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-500">{role.description}</span>
              </div>
              <ChevronRight className={cn(
                "w-4 h-4 transition-colors",
                isActive ? "text-[#1E4ED8]" : "text-gray-300"
              )} />
            </button>
          );
        })}
      </div>

      <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-100">
        <p className="text-xs text-amber-700">
          <strong>Current:</strong> {userName} ({roles.find(r => r.id === currentRole)?.label})
        </p>
        <p className="text-xs text-amber-600 mt-1">
          Page will reload to apply new role permissions.
        </p>
      </div>
    </div>
  );
}
