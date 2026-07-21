import { useState } from 'react';
import { Plus, Search, FileText, Calendar, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const statusFilters = [
  { id: 'unpaid', label: 'Unpaid', color: 'bg-red-100 text-red-700' },
  { id: 'cancelled', label: 'Cancelled', color: 'bg-gray-100 text-gray-700' },
  { id: 'claimed', label: 'Claimed', color: 'bg-purple-100 text-purple-700' },
  { id: 'paid', label: 'Paid', color: 'bg-green-100 text-green-700' },
  { id: 'all', label: 'All', color: 'bg-blue-100 text-blue-700' },
];

export function InvoicesPage() {
  const [activeFilter, setActiveFilter] = useState('all');
  const [showCreateInvoice, setShowCreateInvoice] = useState(false);
  const [invoices] = useState<any[]>([]);

  const handleCreateInvoice = () => {
    setShowCreateInvoice(true);
  };

  return (
    <div className="space-y-6">
      {!showCreateInvoice ? (
        <>
          {/* Header */}
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
              <FileText className="w-5 h-5 text-gray-600" />
            </div>
            <h1 className="text-2xl font-semibold text-gray-900">Invoices</h1>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            {/* Status Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              {statusFilters.map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => setActiveFilter(filter.id)}
                  className={cn(
                    "px-4 py-2 rounded-full text-sm font-medium transition-all duration-200",
                    activeFilter === filter.id
                      ? "bg-blue-600 text-white"
                      : "bg-blue-100 text-blue-600 hover:bg-blue-200"
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <Button variant="ghost" className="text-blue-600">
                RESET
              </Button>
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                <Calendar className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-600">Date Range</span>
              </div>
              <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleCreateInvoice}>
                <Plus className="w-4 h-4 mr-2" />
                NEW INVOICE
              </Button>
            </div>
          </div>

          {/* Content */}
          {invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center mb-6">
                <svg className="w-12 h-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <p className="text-gray-500">No Invoices created yet</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Invoice #</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Patient</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Date</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Total</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b border-gray-100">
                      <td className="px-4 py-3 text-sm">{invoice.id}</td>
                      <td className="px-4 py-3 text-sm">{invoice.patientName}</td>
                      <td className="px-4 py-3 text-sm">{invoice.date}</td>
                      <td className="px-4 py-3 text-sm">{invoice.total}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                          {invoice.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        /* Create Invoice Form */
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setShowCreateInvoice(false)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-2xl font-semibold text-gray-900">Create Invoice</h1>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
            {/* Search Patient */}
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input placeholder="Search Patient's Name*" className="pr-10" />
            </div>
            <button className="text-blue-600 text-sm">+ Add new patient</button>

            {/* Empty State */}
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <p className="text-gray-500 mb-4">Patient not selected</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
