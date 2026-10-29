import { useState, useEffect } from 'react';
import { 
  Nfc, 
  QrCode, 
  Search, 
  User, 
  Droplets, 
  AlertTriangle, 
  Shield, 
  Wifi, 
  WifiOff,
  CheckCircle2,
  Clock,
  FileText,
  CreditCard,
  Plus,
  RefreshCw,
  Smartphone,
  CalendarDays,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { PatientOnboardingWizard } from '@/components/patients/PatientOnboardingWizard';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { LiveHealthIdentity } from '@/components/identity/LiveHealthIdentity';

// Offline demo registry tenant; with Supabase the signed-in workspace is used.
const DEMO_TENANT_ID = 'lagos-central-hospital';

interface PatientCard {
  id: string;
  uhin: string;
  nfcId?: string;
  name: string;
  photo?: string;
  age: number;
  gender: string;
  bloodType: string;
  allergies: string[];
  conditions: string[];
  insuranceStatus: 'active' | 'expired' | 'pending';
  lastVisit: string;
  isOffline: boolean;
}

const mockPatient: PatientCard = {
  id: 'P-2026-001',
  uhin: 'SH-NG-LAG-001-2026',
  nfcId: 'VLC-A7B3-9X2K',
  name: 'Adebayo Johnson',
  age: 45,
  gender: 'Male',
  bloodType: 'O+',
  allergies: ['Penicillin', 'Sulfa drugs'],
  conditions: ['Hypertension', 'Type 2 Diabetes'],
  insuranceStatus: 'active',
  lastVisit: '2026-02-20',
  isOffline: false,
};

export function PatientIdentityPage() {
  return isSupabaseConfigured ? <LiveHealthIdentity /> : <DemoPatientIdentityPage />;
}

/** Offline demo (no Supabase): simulated scans against a sample patient. */
function DemoPatientIdentityPage() {
  const { canCreate, userName, organization } = useAuth();
  const [scanMode, setScanMode] = useState<'nfc' | 'qr' | 'manual'>('nfc');
  const [isScanning, setIsScanning] = useState(false);
  const [scannedPatient, setScannedPatient] = useState<PatientCard | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleScan = () => {
    setIsScanning(true);
    
    // Simulate scan
    setTimeout(() => {
      setIsScanning(false);
      setScannedPatient(mockPatient);
      toast.success('Patient identity verified!', {
        description: `${mockPatient.name} - ${mockPatient.uhin}`,
      });
    }, 2500);
  };

  const handleRegisterNew = () => {
    setShowOnboarding(true);
  };

  return (
    <div className="space-y-6 page-transition">
      <PatientOnboardingWizard
        open={showOnboarding}
        onOpenChange={setShowOnboarding}
        tenantId={isSupabaseConfigured ? organization.id : DEMO_TENANT_ID}
        creatorName={userName}
        canCreate={canCreate('Patients')}
      />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 truncate">Digital Health Identity</h1>
          <p className="text-sm text-gray-500 mt-1 truncate">
            Identify patients by VitaCard, QR code or search
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium shrink-0",
            isOnline 
              ? "bg-green-100 text-green-700" 
              : "bg-amber-100 text-amber-700"
          )}>
            {isOnline ? <Wifi className="w-4 h-4 shrink-0" /> : <WifiOff className="w-4 h-4 shrink-0" />}
            <span className="truncate">{isOnline ? 'Online Mode' : 'Offline Mode'}</span>
          </div>
          <Button 
            onClick={handleRegisterNew}
            className="bg-gradient-to-r from-royal-500 to-royal-700 text-white min-w-0"
          >
            <Plus className="w-4 h-4 mr-2 shrink-0" />
            <span className="truncate">Register New Patient</span>
          </Button>
        </div>
      </div>

      {/* Scan Modes */}
      <div className="flex flex-wrap gap-2 p-1 bg-gray-100 rounded-xl min-w-0">
        {[
          { id: 'nfc', label: 'NFC Card', icon: Nfc },
          { id: 'qr', label: 'QR Code', icon: QrCode },
          { id: 'manual', label: 'Manual Search', icon: Search },
        ].map((mode) => (
          <button
            key={mode.id}
            onClick={() => {
              setScanMode(mode.id as any);
              setScannedPatient(null);
            }}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 min-w-0",
              scanMode === mode.id
                ? "bg-white text-royal-600 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <mode.icon className="w-4 h-4 shrink-0" />
            <span className="truncate">{mode.label}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Scan Area */}
        <div className="space-y-6 min-w-0">
          {scanMode === 'nfc' && (
            <div className="premium-card p-8 min-w-0 overflow-hidden">
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-2xl bg-royal-100 flex items-center justify-center mx-auto mb-4 shrink-0">
                  <Nfc className="w-8 h-8 text-royal-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 truncate">Tap NFC Card</h2>
                <p className="text-sm text-gray-500 mt-1 truncate">
                  Hold the patient's VitaCard near the reader
                </p>
              </div>

              {/* Scan Animation */}
              <div className="relative w-64 h-64 mx-auto mb-6 shrink-0">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-royal-500/10 to-royal-700/10" />
                
                {/* Ripple Effect */}
                {isScanning && (
                  <>
                    <div className="absolute inset-0 rounded-3xl border-2 border-royal-400 animate-[nfc-ripple_1.5s_ease-out_infinite]" />
                    <div className="absolute inset-0 rounded-3xl border-2 border-royal-400 animate-[nfc-ripple_1.5s_ease-out_infinite]" style={{ animationDelay: '0.5s' }} />
                    <div className="absolute inset-0 rounded-3xl border-2 border-royal-400 animate-[nfc-ripple_1.5s_ease-out_infinite]" style={{ animationDelay: '1s' }} />
                  </>
                )}
                
                {/* Card Icon */}
                <div className={cn(
                  "absolute inset-8 rounded-2xl flex flex-col items-center justify-center transition-all duration-300",
                  isScanning 
                    ? "bg-royal-500 shadow-lg shadow-royal-500/30" 
                    : "bg-white shadow-xl"
                )}>
                  <CreditCard className={cn("w-12 h-12 mb-2", isScanning ? "text-white" : "text-royal-600")} />
                  <span className={cn("text-xs font-medium", isScanning ? "text-white/80" : "text-gray-400")}>
                    {isScanning ? 'Scanning...' : 'Ready to Scan'}
                  </span>
                </div>
              </div>

              <Button 
                onClick={handleScan}
                disabled={isScanning}
                className="w-full bg-gradient-to-r from-royal-500 to-royal-700 text-white py-6 min-w-0"
              >
                {isScanning ? (
                  <>
                    <RefreshCw className="w-5 h-5 mr-2 animate-spin shrink-0" />
                    <span className="truncate">Scanning...</span>
                  </>
                ) : (
                  <>
                    <Nfc className="w-5 h-5 mr-2 shrink-0" />
                    <span className="truncate">Simulate NFC Scan</span>
                  </>
                )}
              </Button>
            </div>
          )}

          {scanMode === 'qr' && (
            <div className="premium-card p-8 min-w-0 overflow-hidden">
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-2xl bg-purple-100 flex items-center justify-center mx-auto mb-4 shrink-0">
                  <QrCode className="w-8 h-8 text-purple-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 truncate">Scan QR Code</h2>
                <p className="text-sm text-gray-500 mt-1 truncate">
                  Position the QR code within the frame
                </p>
              </div>

              <div className="relative w-64 h-64 mx-auto mb-6 bg-gray-900 rounded-3xl overflow-hidden shrink-0">
                {/* Camera Frame */}
                <div className="absolute inset-4 border-2 border-white/30 rounded-2xl">
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-vitalink-400 rounded-tl-lg" />
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-vitalink-400 rounded-tr-lg" />
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-vitalink-400 rounded-bl-lg" />
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-vitalink-400 rounded-br-lg" />
                </div>
                
                {/* Scan Line */}
                <div className="absolute left-4 right-4 h-0.5 bg-vitalink-400 animate-[shimmer_2s_infinite]" />
                
                {/* Placeholder */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <QrCode className="w-24 h-24 text-white/20" />
                </div>
              </div>

              <Button 
                onClick={handleScan}
                className="w-full bg-gradient-to-r from-purple-500 to-purple-700 text-white py-6 min-w-0"
              >
                <Smartphone className="w-5 h-5 mr-2 shrink-0" />
                <span className="truncate">Open Camera</span>
              </Button>
            </div>
          )}

          {scanMode === 'manual' && (
            <div className="premium-card p-8 min-w-0 overflow-hidden">
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-4 shrink-0">
                  <Search className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 truncate">Manual Search</h2>
                <p className="text-sm text-gray-500 mt-1 truncate">
                  Search by UHIN, name, or phone number
                </p>
              </div>

              <div className="space-y-4">
                <div className="relative min-w-0">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 shrink-0" />
                  <Input 
                    placeholder="Enter UHIN, name, or phone..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-12 py-6 text-lg rounded-xl min-w-0"
                  />
                </div>
                
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 min-w-0">
                  <p className="text-sm text-gray-500 mb-2 truncate">Example searches:</p>
                  <div className="flex flex-wrap gap-2">
                    {['SH-NG-LAG-001', 'Adebayo Johnson', '08012345678'].map((example) => (
                      <button
                        key={example}
                        onClick={() => setSearchQuery(example)}
                        className="px-3 py-1.5 rounded-lg bg-white text-sm text-gray-600 hover:text-royal-600 border border-gray-200 hover:border-royal-300 transition-colors min-w-0"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>

                <Button 
                  onClick={handleScan}
                  className="w-full bg-gradient-to-r from-green-500 to-green-700 text-white py-6 min-w-0"
                >
                  <Search className="w-5 h-5 mr-2 shrink-0" />
                  <span className="truncate">Search Patient</span>
                </Button>
              </div>
            </div>
          )}

          {/* Recent Scans */}
          <div className="premium-card p-6 min-w-0 overflow-hidden">
            <h3 className="font-semibold text-gray-900 mb-4 truncate">Recent Scans</h3>
            <div className="space-y-3">
              {[
                { name: 'Chioma Okonkwo', uhin: 'SH-NG-LAG-042', time: '2 min ago', method: 'nfc' },
                { name: 'Emmanuel Adeyemi', uhin: 'SH-NG-LAG-038', time: '15 min ago', method: 'qr' },
                { name: 'Fatima Abdullahi', uhin: 'SH-NG-LAG-055', time: '32 min ago', method: 'nfc' },
              ].map((scan, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-royal-100 flex items-center justify-center shrink-0">
                    <User className="w-5 h-5 text-royal-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{scan.name}</p>
                    <p className="text-xs text-gray-500 truncate">{scan.uhin}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-400 truncate">{scan.time}</p>
                    <span className={cn(
                      "text-[10px] px-2 py-0.5 rounded-full uppercase",
                      scan.method === 'nfc' ? "bg-blue-100 text-blue-600" : "bg-purple-100 text-purple-600"
                    )}>
                      {scan.method}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Patient Profile */}
        <div className="min-w-0">
          {scannedPatient ? (
            <div className="premium-card overflow-hidden min-w-0">
              {/* Profile Header */}
              <div className="p-6 bg-gradient-to-br from-royal-500 to-royal-700 text-white min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-20 h-20 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/30 shrink-0">
                      <User className="w-10 h-10 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-2xl font-bold truncate">{scannedPatient.name}</h2>
                      <p className="text-white/70 truncate">{scannedPatient.uhin}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className="px-2 py-0.5 rounded-full bg-white/20 text-xs">
                          {scannedPatient.gender}, {scannedPatient.age} years
                        </span>
                        {scannedPatient.nfcId && (
                          <span className="px-2 py-0.5 rounded-full bg-vitamind-500/30 text-violet-200 text-xs flex items-center gap-1">
                            <Nfc className="w-3 h-3 shrink-0" />
                            <span className="truncate">NFC Linked</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 shrink-0",
                    scannedPatient.insuranceStatus === 'active' 
                      ? "bg-green-500/30 text-green-300" 
                      : "bg-red-500/30 text-red-300"
                  )}>
                    <Shield className="w-3 h-3 shrink-0" />
                    <span className="truncate">Insurance {scannedPatient.insuranceStatus}</span>
                  </div>
                </div>
              </div>

              {/* Profile Details */}
              <div className="p-6 space-y-6">
                {/* Quick Stats */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-center min-w-0">
                    <Droplets className="w-6 h-6 text-red-500 mx-auto mb-2 shrink-0" />
                    <p className="text-lg font-bold text-red-700 truncate">{scannedPatient.bloodType}</p>
                    <p className="text-xs text-red-600 truncate">Blood Type</p>
                  </div>
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 text-center min-w-0">
                    <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto mb-2 shrink-0" />
                    <p className="text-lg font-bold text-amber-700 truncate">{scannedPatient.allergies.length}</p>
                    <p className="text-xs text-amber-600 truncate">Allergies</p>
                  </div>
                  <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-center min-w-0">
                    <FileText className="w-6 h-6 text-blue-500 mx-auto mb-2 shrink-0" />
                    <p className="text-lg font-bold text-blue-700 truncate">{scannedPatient.conditions.length}</p>
                    <p className="text-xs text-blue-600">Conditions</p>
                  </div>
                </div>

                {/* Allergies */}
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2 truncate">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="truncate">Allergies</span>
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {scannedPatient.allergies.map((allergy) => (
                      <span 
                        key={allergy}
                        className="px-3 py-1.5 rounded-lg bg-red-100 text-red-700 text-sm font-medium min-w-0"
                      >
                        {allergy}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Conditions */}
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2 truncate">
                    <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                    <span className="truncate">Medical Conditions</span>
                  </h3>
                  <div className="space-y-2">
                    {scannedPatient.conditions.map((condition) => (
                      <div 
                        key={condition}
                        className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 min-w-0"
                      >
                        <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                        <span className="text-sm text-gray-700 truncate">{condition}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Last Visit */}
                <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 min-w-0">
                  <Clock className="w-5 h-5 text-gray-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-gray-500 truncate">Last Visit</p>
                    <p className="font-medium text-gray-900 truncate">{scannedPatient.lastVisit}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-3">
                  <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white py-5 min-w-0">
                    <FileText className="w-4 h-4 mr-2 shrink-0" />
                    <span className="truncate">View Full Record</span>
                  </Button>
                  <Button variant="outline" className="border-royal-200 text-royal-600 hover:bg-royal-50 py-5 min-w-0">
                    <CalendarDays className="w-4 h-4 mr-2 shrink-0" />
                    <span className="truncate">Book Appointment</span>
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="premium-card p-12 text-center min-w-0 overflow-hidden">
              <div className="w-24 h-24 rounded-3xl bg-gray-100 flex items-center justify-center mx-auto mb-6 shrink-0">
                <Nfc className="w-12 h-12 text-gray-300" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2 truncate">No Patient Scanned</h3>
              <p className="text-gray-500 max-w-sm mx-auto truncate">
                Use NFC tap, QR scan, or manual search to retrieve patient information
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
