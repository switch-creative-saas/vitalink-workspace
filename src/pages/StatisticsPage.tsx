import { useState } from 'react';
import { BarChart3, Calendar } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const activityFilters = [
  { id: 'all', label: 'All Activities' },
  { id: 'admissions', label: 'Admissions' },
  { id: 'visits', label: 'Visits' },
];

const genderFilters = [
  { id: 'all', label: 'All Genders' },
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'other', label: 'Other' },
];

const ageFilters = [
  { id: 'all', label: 'All Ages' },
  { id: '0-17', label: '0-17' },
  { id: '18-34', label: '18-34' },
  { id: '35-49', label: '35-49' },
  { id: '50-64', label: '50-64' },
  { id: '65+', label: '65+' },
];

const genderDistribution = [
  { label: 'Male', color: 'bg-blue-500' },
  { label: 'Female', color: 'bg-pink-500' },
  { label: 'Other', color: 'bg-green-500' },
];

const ageDistribution = [
  { label: '0-17', color: 'bg-red-500' },
  { label: '18-34', color: 'bg-yellow-500' },
  { label: '35-49', color: 'bg-green-500' },
  { label: '50-64', color: 'bg-blue-500' },
  { label: '65+', color: 'bg-purple-500' },
];

export function StatisticsPage() {
  const [activityFilter, setActivityFilter] = useState('all');
  const [genderFilter, setGenderFilter] = useState('all');
  const [ageFilter, setAgeFilter] = useState('all');

  return (
    <div className="space-y-6 contain-layout min-w-0">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-gray-600" />
        </div>
        <h1 className="text-2xl font-semibold text-gray-900">Statistics</h1>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={activityFilter} onValueChange={setActivityFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {activityFilters.map((f) => (
              <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={genderFilter} onValueChange={setGenderFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {genderFilters.map((f) => (
              <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={ageFilter} onValueChange={setAgeFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ageFilters.map((f) => (
              <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
          <Calendar className="w-4 h-4 text-gray-500" />
          <span className="text-sm text-gray-600">2/23/2026 – 2/23/2026</span>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="dashboard-card-grid">
        {/* Admissions & Visits */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 min-w-0 overflow-hidden card-equal-height">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Admissions & Visits</h3>
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-amber-500"></div>
              <span className="text-xs text-gray-600">Admissions</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
              <span className="text-xs text-gray-600">Visits</span>
            </div>
          </div>
          <div className="h-32 flex items-center justify-center">
            <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center">
              <span className="text-2xl font-semibold text-gray-400">0</span>
            </div>
          </div>
        </div>

        {/* Gender Distribution */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 min-w-0 overflow-hidden card-equal-height">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Gender Distribution</h3>
          <div className="flex flex-wrap gap-2 mb-4">
            {genderDistribution.map((g) => (
              <div key={g.label} className="flex items-center gap-1">
                <div className={cn("w-3 h-3 rounded-full", g.color)}></div>
                <span className="text-xs text-gray-600">{g.label}</span>
              </div>
            ))}
          </div>
          <div className="h-32 flex items-center justify-center">
            <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center">
              <span className="text-2xl font-semibold text-gray-400">0</span>
            </div>
          </div>
        </div>

        {/* Age Distribution */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 min-w-0 overflow-hidden card-equal-height">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Age Distribution</h3>
          <div className="flex flex-wrap gap-2 mb-4">
            {ageDistribution.map((a) => (
              <div key={a.label} className="flex items-center gap-1">
                <div className={cn("w-3 h-3 rounded-full", a.color)}></div>
                <span className="text-xs text-gray-600">{a.label}</span>
              </div>
            ))}
          </div>
          <div className="h-32 flex items-center justify-center">
            <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center">
              <span className="text-2xl font-semibold text-gray-400">0</span>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="dashboard-stat-grid">
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center min-w-0 overflow-hidden card-equal-height">
          <p className="text-sm text-gray-500 mb-2">Total Activities</p>
          <p className="text-4xl font-semibold text-gray-400">0</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-500 mb-2">Total Patients</p>
          <p className="text-4xl font-semibold text-gray-400">0</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-500 mb-2">Total Patients</p>
          <p className="text-4xl font-semibold text-gray-400">0</p>
        </div>
      </div>

      {/* Patient Flow Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Patient Flow by Age and Gender</h3>
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-gray-500">No records here yet</p>
        </div>
      </div>
    </div>
  );
}
