import { useState } from 'react';
import { Plus, Calendar, ChevronLeft, ChevronRight, Search, Bed, CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const statusFilters = [
  { id: 'unconfirmed', label: 'Unconfirmed', color: 'bg-amber-100 text-amber-700' },
  { id: 'confirmed', label: 'Confirmed', color: 'bg-blue-100 text-blue-700' },
  { id: 'waiting', label: 'Waiting', color: 'bg-purple-100 text-purple-700' },
  { id: 'ongoing', label: 'OnGoing', color: 'bg-indigo-100 text-indigo-700' },
  { id: 'completed', label: 'Completed', color: 'bg-green-100 text-green-700' },
  { id: 'conflict', label: 'Conflict Found', color: 'bg-red-100 text-red-700' },
  { id: 'unavailable', label: 'Unavailable', color: 'bg-gray-100 text-gray-700' },
];

const timeSlots = ['07:00', '07:15', '07:30', '07:45', '08:00', '08:15', '08:30', '08:45', '09:00', '09:15', '09:30'];

const doctors = [
  { id: '1', name: 'Doctor' },
  { id: '2', name: 'Admin (Owner)' },
];

export function SchedulePage() {
  const [showActionModal, setShowActionModal] = useState(false);
  const [showAdmissionModal, setShowAdmissionModal] = useState(false);
  const [showVisitModal, setShowVisitModal] = useState(false);
  const [selectedDate] = useState('2/23/2026');
  const [selectedDepartment, setSelectedDepartment] = useState('All Departments');

  const handleNewVisit = () => {
    setShowActionModal(true);
  };

  const handleInpatientAdmission = () => {
    setShowActionModal(false);
    setShowAdmissionModal(true);
  };

  const handleOutpatientVisit = () => {
    setShowActionModal(false);
    setShowVisitModal(true);
  };

  const handleCreate = () => {
    toast.success('Successfully created!');
    setShowAdmissionModal(false);
    setShowVisitModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Controls */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" className="text-blue-600 border-blue-200 bg-blue-50">
            TODAY
          </Button>
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium">{selectedDate}</span>
          </div>
          <Button variant="ghost" size="icon">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All Departments">All Departments</SelectItem>
              <SelectItem value="General">General</SelectItem>
              <SelectItem value="Cardiology">Cardiology</SelectItem>
              <SelectItem value="Pediatrics">Pediatrics</SelectItem>
            </SelectContent>
          </Select>

          <Button 
            className="bg-blue-600 hover:bg-blue-700"
            onClick={handleNewVisit}
          >
            <Plus className="w-4 h-4 mr-2" />
            NEW VISIT
          </Button>
        </div>
      </div>

      {/* Status Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {statusFilters.map((filter) => (
          <button
            key={filter.id}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200",
              filter.color
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="responsive-table-wrap">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-32">Doctor</th>
                {timeSlots.map((time) => (
                  <th key={time} className="px-2 py-3 text-center text-sm font-medium text-gray-700 min-w-[80px]">
                    {time}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {doctors.map((doctor) => (
                <tr key={doctor.id} className="border-b border-gray-100">
                  <td className="px-4 py-4 text-sm font-medium text-gray-900">{doctor.name}</td>
                  {timeSlots.map((time) => (
                    <td key={time} className="px-1 py-1">
                      <button 
                        className="w-full h-10 rounded border border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition-all duration-200 flex items-center justify-center"
                        onClick={handleNewVisit}
                      >
                        <Plus className="w-4 h-4 text-gray-400 hover:text-blue-500" />
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Choose an Action Modal */}
      <Dialog open={showActionModal} onOpenChange={setShowActionModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">Choose an Action</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <button
              onClick={handleInpatientAdmission}
              className="flex flex-col items-center gap-4 p-8 rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all duration-200"
            >
              <Bed className="w-12 h-12 text-blue-500" />
              <span className="text-sm font-medium text-blue-600">INPATIENT ADMISSION</span>
            </button>
            <button
              onClick={handleOutpatientVisit}
              className="flex flex-col items-center gap-4 p-8 rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all duration-200"
            >
              <CalendarPlus className="w-12 h-12 text-blue-500" />
              <span className="text-sm font-medium text-blue-600">OUTPATIENT VISIT</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Admission Modal */}
      <Dialog open={showAdmissionModal} onOpenChange={setShowAdmissionModal}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">New Admission</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 mt-4">
            {/* Search Patient */}
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input placeholder="Search Patient's Name*" className="pr-10" />
            </div>

            {/* Patient Information */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Patient Information</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-gray-500">ID*</Label>
                  <Input placeholder="Auto-generated" disabled className="bg-gray-50" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Gender*</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Birthday*</Label>
                  <Input type="date" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Phone*</Label>
                  <Input placeholder="Phone number" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Email</Label>
                  <Input type="email" placeholder="Email" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">City</Label>
                  <Input placeholder="City" />
                </div>
              </div>
            </div>

            {/* Emergency Contact */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Emergency Contact</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-gray-500">Name</Label>
                  <Input placeholder="Name" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Relation</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="father">Father</SelectItem>
                      <SelectItem value="mother">Mother</SelectItem>
                      <SelectItem value="spouse">Spouse</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Phone</Label>
                  <Input placeholder="Phone" />
                </div>
              </div>
            </div>

            {/* Admission Information */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Admission Information</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-gray-500">Doctor*</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select doctor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="doctor1">Doctor 1</SelectItem>
                      <SelectItem value="doctor2">Doctor 2</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Department</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General</SelectItem>
                      <SelectItem value="cardiology">Cardiology</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Room</Label>
                  <Input placeholder="Room" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Bed</Label>
                  <Input placeholder="Bed" />
                </div>
              </div>
            </div>

            {/* Insurance */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Insurance</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-gray-500">Billing Type</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="insurance">Insurance</SelectItem>
                      <SelectItem value="self">Self Pay</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Insurance Provider / Company*</Label>
                  <div className="relative">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input placeholder="Search" className="pr-10" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Insurance Number</Label>
                  <Input placeholder="Number" />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => setShowAdmissionModal(false)}>
                CANCEL
              </Button>
              <Button className="bg-gray-300 hover:bg-gray-400 text-gray-700" onClick={handleCreate}>
                CREATE
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Visit Modal */}
      <Dialog open={showVisitModal} onOpenChange={setShowVisitModal}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">New Visit</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 mt-4">
            {/* Search Patient */}
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input placeholder="Search Patient's Name*" className="pr-10" />
            </div>

            {/* Patient Information */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Patient Information</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-gray-500">ID*</Label>
                  <Input placeholder="Auto-generated" disabled className="bg-gray-50" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Gender*</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Birthday*</Label>
                  <Input type="date" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Phone*</Label>
                  <Input placeholder="Phone number" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Email</Label>
                  <Input type="email" placeholder="Email" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">City</Label>
                  <Input placeholder="City" />
                </div>
              </div>
            </div>

            {/* Emergency Contact */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Emergency Contact</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-gray-500">Name</Label>
                  <Input placeholder="Name" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Relation</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="father">Father</SelectItem>
                      <SelectItem value="mother">Mother</SelectItem>
                      <SelectItem value="spouse">Spouse</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Phone</Label>
                  <Input placeholder="Phone" />
                </div>
              </div>
            </div>

            {/* Visit Information */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Visit Information</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-gray-500">Doctor*</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select doctor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="doctor1">Doctor 1</SelectItem>
                      <SelectItem value="doctor2">Doctor 2</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Date*</Label>
                  <Input type="date" defaultValue="2026-02-23" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Service Name*</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select service" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="consultation">Consultation</SelectItem>
                      <SelectItem value="followup">Follow-up</SelectItem>
                      <SelectItem value="ecg">Electrocardiogram (ECG)</SelectItem>
                      <SelectItem value="vaccination">Vaccination & Immunization</SelectItem>
                      <SelectItem value="minor">Minor Surgical Procedure</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Timeslot*</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select time" />
                    </SelectTrigger>
                    <SelectContent>
                      {timeSlots.map((time) => (
                        <SelectItem key={time} value={time}>{time}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Price</Label>
                  <Input placeholder="Price" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Visit Type</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New Visit</SelectItem>
                      <SelectItem value="followup">Follow-up</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Reason / Purpose</Label>
                  <Input placeholder="Reason" />
                </div>
              </div>
            </div>

            {/* Insurance */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Insurance</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-gray-500">Billing Type</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="insurance">Insurance</SelectItem>
                      <SelectItem value="self">Self Pay</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Insurance Provider / Company*</Label>
                  <div className="relative">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input placeholder="Search" className="pr-10" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Insurance Number</Label>
                  <Input placeholder="Number" />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => setShowVisitModal(false)}>
                CANCEL
              </Button>
              <Button className="bg-gray-300 hover:bg-gray-400 text-gray-700" onClick={handleCreate}>
                CREATE
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
