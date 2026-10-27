import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, User, Calendar, FlaskConical, Pill, Users, ArrowRight, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { LiveGlobalSearch } from './LiveGlobalSearch';

interface SearchResult {
  id: string;
  type: 'patient' | 'appointment' | 'lab' | 'prescription' | 'staff';
  title: string;
  subtitle: string;
  status?: string;
  date?: string;
  icon: React.ElementType;
  color: string;
  route: string;
}

const mockSearchData: SearchResult[] = [
  { id: 'P-001', type: 'patient', title: 'Adebayo Johnson', subtitle: 'UHIN: SH-NG-LAG-001 • Male, 45 yrs', status: 'Active', icon: User, color: 'text-blue-600', route: '/patients/P-001' },
  { id: 'P-002', type: 'patient', title: 'Chioma Okonkwo', subtitle: 'UHIN: SH-NG-LAG-002 • Female, 32 yrs', status: 'Active', icon: User, color: 'text-blue-600', route: '/patients/P-002' },
  { id: 'P-003', type: 'patient', title: 'Emmanuel Adeyemi', subtitle: 'UHIN: SH-NG-ABJ-003 • Male, 58 yrs', status: 'Active', icon: User, color: 'text-blue-600', route: '/patients/P-003' },
  { id: 'A-001', type: 'appointment', title: 'Adebayo Johnson', subtitle: 'Follow-up • Dr. Sarah Johnson • 09:00 AM', date: '2026-02-24', icon: Calendar, color: 'text-green-600', route: '/appointments/A-001' },
  { id: 'A-002', type: 'appointment', title: 'Chioma Okonkwo', subtitle: 'Consultation • Dr. Michael Chen • 09:30 AM', date: '2026-02-24', icon: Calendar, color: 'text-green-600', route: '/appointments/A-002' },
  { id: 'VLL-001', type: 'lab', title: 'Lab Order - CBC', subtitle: 'Adebayo Johnson • Routine • Pending', status: 'Pending', icon: FlaskConical, color: 'text-purple-600', route: '/laboratory/VLL-001' },
  { id: 'VLP-001', type: 'prescription', title: 'Metformin 500mg', subtitle: 'Adebayo Johnson • Dr. Sarah Johnson', icon: Pill, color: 'text-amber-600', route: '/pharmacy/VLP-001' },
  { id: 'S-001', type: 'staff', title: 'Dr. Sarah Johnson', subtitle: 'Doctor • General Medicine • Active', status: 'Active', icon: Users, color: 'text-royal-600', route: '/staff/S-001' },
  { id: 'S-002', type: 'staff', title: 'Nurse Amina Bello', subtitle: 'Nurse • Emergency • Active', status: 'Active', icon: Users, color: 'text-royal-600', route: '/staff/S-002' },
];

// Live workspaces search real records; the samples below only back the offline demo.
export function GlobalSearch() {
  return isSupabaseConfigured ? <LiveGlobalSearch /> : <DemoGlobalSearch />;
}

function DemoGlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { canView } = useAuth();

  const performSearch = useCallback((searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    
    // Simulate API delay (debounced 300ms)
    debounceTimer.current = setTimeout(() => {
      const lowerQuery = searchQuery.toLowerCase();
      const filtered = mockSearchData.filter(item => {
        // Check role-based access
        if (item.type === 'patient' && !canView('Patients')) return false;
        if (item.type === 'appointment' && !canView('Appointments')) return false;
        if (item.type === 'lab' && !canView('Laboratory')) return false;
        if (item.type === 'prescription' && !canView('Pharmacy')) return false;
        if (item.type === 'staff' && !canView('Human Resources')) return false;

        return (
          item.title.toLowerCase().includes(lowerQuery) ||
          item.subtitle.toLowerCase().includes(lowerQuery) ||
          item.id.toLowerCase().includes(lowerQuery)
        );
      });

      setResults(filtered);
      setIsLoading(false);
      setSelectedIndex(-1);
    }, 300);
  }, [canView]);

  useEffect(() => {
    performSearch(query);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, performSearch]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (isOpen) {
        if (e.key === 'Escape') {
          setIsOpen(false);
          inputRef.current?.blur();
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, -1));
        }
        if (e.key === 'Enter' && selectedIndex >= 0) {
          handleResultClick(results[selectedIndex]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, selectedIndex]);

  const handleResultClick = (result: SearchResult) => {
    setIsOpen(false);
    setQuery('');
    // In a real app, this would navigate using router
    console.log('Navigate to:', result.route);
    // Show success toast
    // toast.success(`Navigating to ${result.title}`);
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    inputRef.current?.focus();
  };

  const groupedResults = results.reduce((acc, result) => {
    if (!acc[result.type]) acc[result.type] = [];
    acc[result.type].push(result);
    return acc;
  }, {} as Record<string, SearchResult[]>);

  const typeLabels: Record<string, string> = {
    patient: 'Patients',
    appointment: 'Appointments',
    lab: 'Lab Orders',
    prescription: 'Prescriptions',
    staff: 'Staff',
  };

  const typeOrder = ['patient', 'appointment', 'lab', 'prescription', 'staff'];

  return (
    <div ref={containerRef} className="relative w-full min-w-0 max-w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search patients, appointments, records..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          className="w-full pl-10 pr-12 py-2.5 rounded-xl bg-gray-100/80 border-0 text-sm text-slate-900 placeholder:text-slate-500 focus:bg-white focus:ring-2 focus:ring-[#1E4ED8]/20 transition-all duration-200 outline-none dark:bg-slate-900/50 dark:text-slate-50 dark:placeholder:text-slate-400 dark:focus:bg-slate-800"
        />
        {query && (
          <button
            onClick={clearSearch}
            className="absolute right-10 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-gray-200 text-slate-400 transition-colors dark:hover:bg-slate-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 hidden lg:flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-200 rounded text-slate-600 dark:bg-slate-800 dark:text-slate-400">⌘K</kbd>
        </div>
      </div>

      {/* Dropdown Results */}
      {isOpen && (query || results.length > 0) && (
        <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-100/50 overflow-hidden animate-in slide-in-from-top-2 duration-200 dark:border-slate-700 dark:bg-slate-900/95">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="w-8 h-8 border-2 border-[#1E4ED8] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-slate-600 dark:text-slate-400">Searching...</p>
            </div>
          ) : results.length === 0 && query ? (
            <div className="p-8 text-center">
              <Search className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-slate-600 dark:text-slate-400">No results found for &quot;{query}&quot;</p>
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto py-2">
              {typeOrder.map((type) => {
                const typeResults = groupedResults[type];
                if (!typeResults?.length) return null;
                
                return (
                  <div key={type} className="mb-2">
                    <div className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      {typeLabels[type]}
                    </div>
                    {typeResults.map((result) => {
                      const globalIndex = results.indexOf(result);
                      const Icon = result.icon;
                      return (
                        <button
                          key={result.id}
                          onClick={() => handleResultClick(result)}
                          className={cn(
                            "w-full px-4 py-2.5 flex items-center gap-3 text-left transition-all duration-150",
                            selectedIndex === globalIndex 
                              ? "bg-[#1E4ED8]/5" 
                              : "hover:bg-gray-50 dark:hover:bg-slate-800"
                          )}
                        >
                          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", result.color.replace('text-', 'bg-').replace('600', '100'))}>
                            <Icon className={cn("w-4 h-4", result.color)} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-slate-50 truncate">{result.title}</p>
                            <p className="text-xs text-slate-600 dark:text-slate-400 truncate">{result.subtitle}</p>
                          </div>
                          {result.status && (
                            <span className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0",
                              result.status === 'Active' || result.status === 'Pending'
                                ? "bg-green-100 text-green-700"
                                : "bg-gray-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                            )}>
                              {result.status}
                            </span>
                          )}
                          {result.date && (
                            <span className="text-[10px] text-gray-400 flex items-center gap-1 flex-shrink-0">
                              <Clock className="w-3 h-3" />
                              {result.date}
                            </span>
                          )}
                          <ArrowRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
          
          {results.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-100 text-xs text-slate-500 flex items-center justify-between dark:border-slate-700 dark:text-slate-400">
              <span>{results.length} results found</span>
              <span>Use ↑↓ to navigate, Enter to select, Esc to close</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
