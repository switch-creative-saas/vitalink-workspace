import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Barcode,
  CheckCircle2,
  Download,
  FileText,
  MoreHorizontal,
  Package,
  Pill,
  Plus,
  Search,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { SENTINEL_PHARMACY_EVENT, type SentinelPharmacyPayload } from '@/lib/sentinel/events';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { allergyConflicts } from '@/lib/allergyCheck';
import {
  cancelPrescription,
  createPurchaseOrder,
  deleteStock,
  dispensePrescription,
  listInventory,
  listPrescriptions,
  listPurchaseOrders,
  receiveStock,
  setPurchaseOrderStatus,
  updateStock,
  type PrescriptionItem,
  type StockItem,
} from '@/lib/supabase/pharmacy';

type PharmacyTab = 'inventory' | 'dispensations' | 'orders';
type MedicationStatus = 'available' | 'low' | 'out-of-stock' | 'expiring' | 'expired';
type PurchaseOrderStatus = 'pending' | 'approved' | 'delivered';
type ExportType = 'csv' | 'excel' | 'pdf';

type Medication = {
  id: string;
  name: string;
  category: string;
  stock: number;
  unit_price: number;
  expiry_date: string;
  batch_no: string;
  supplier: string;
  reorder_threshold: number;
  status: MedicationStatus;
};

type Dispensation = {
  id: string;
  patient_id: string;
  patient_name: string;
  doctor_id: string;
  doctor_name: string;
  medication_id: string;
  medication_name: string;
  quantity: number;
  date: string;
  pharmacist_id: string;
  pharmacist_name: string;
  status: 'dispensed' | 'pending';
};

type PurchaseOrder = {
  id: string;
  poNumber?: string;
  supplier: string;
  drugItems: { medicationId: string; medicationName: string; quantity: number }[];
  status: PurchaseOrderStatus | 'cancelled';
  createdAt: string;
};

const seedMedications: Medication[] = [
  { id: 'med-1', name: 'Paracetamol 500mg', category: 'Analgesic', stock: 245, unit_price: 250, expiry_date: '2027-06-15', batch_no: 'BCH-123-A', supplier: 'MediCore Supplies', reorder_threshold: 50, status: 'available' },
  { id: 'med-2', name: 'Amoxicillin 250mg', category: 'Antibiotic', stock: 32, unit_price: 450, expiry_date: '2026-06-20', batch_no: 'BCH-229-Z', supplier: 'Nova Drugs Ltd', reorder_threshold: 40, status: 'low' },
  { id: 'med-3', name: 'Metformin 500mg', category: 'Antidiabetic', stock: 189, unit_price: 380, expiry_date: '2027-03-10', batch_no: 'BCH-881-J', supplier: 'Wellness Pharma', reorder_threshold: 60, status: 'available' },
  { id: 'med-4', name: 'Amlodipine 5mg', category: 'Antihypertensive', stock: 0, unit_price: 520, expiry_date: '2026-11-05', batch_no: 'BCH-004-C', supplier: 'Prime Therapeutics', reorder_threshold: 30, status: 'out-of-stock' },
  { id: 'med-5', name: 'Ibuprofen 400mg', category: 'NSAID', stock: 156, unit_price: 280, expiry_date: '2026-05-22', batch_no: 'BCH-772-Q', supplier: 'MediCore Supplies', reorder_threshold: 40, status: 'expiring' },
];

const seedDispensations: Dispensation[] = [
  { id: 'disp-1', patient_id: 'p1', patient_name: 'Adebayo Johnson', doctor_id: 'd1', doctor_name: 'Dr. Sarah Johnson', medication_id: 'med-3', medication_name: 'Metformin 500mg', quantity: 30, date: '2026-04-27', pharmacist_id: 'ph1', pharmacist_name: 'Pharm. Amina', status: 'dispensed' },
  { id: 'disp-2', patient_id: 'p2', patient_name: 'Chioma Okonkwo', doctor_id: 'd2', doctor_name: 'Dr. Michael Chen', medication_id: 'med-1', medication_name: 'Paracetamol 500mg', quantity: 20, date: '2026-04-27', pharmacist_id: 'ph1', pharmacist_name: 'Pharm. Amina', status: 'dispensed' },
];

const seedPOs: PurchaseOrder[] = [
  { id: 'PO-2026-0001', supplier: 'Nova Drugs Ltd', drugItems: [{ medicationId: 'med-2', medicationName: 'Amoxicillin 250mg', quantity: 300 }], status: 'approved', createdAt: '2026-04-20' },
  { id: 'PO-2026-0002', supplier: 'Prime Therapeutics', drugItems: [{ medicationId: 'med-4', medicationName: 'Amlodipine 5mg', quantity: 500 }], status: 'pending', createdAt: '2026-04-25' },
];

const prescriptions = [
  { patient_id: 'p1', patient_name: 'Adebayo Johnson', doctor_id: 'd1', doctor_name: 'Dr. Sarah Johnson', medication_id: 'med-3', medication_name: 'Metformin 500mg', quantity: 30 },
  { patient_id: 'p3', patient_name: 'Emmanuel Adeyemi', doctor_id: 'd2', doctor_name: 'Dr. Michael Chen', medication_id: 'med-2', medication_name: 'Amoxicillin 250mg', quantity: 14 },
];

const tabs = [
  { id: 'inventory', label: 'Inventory' },
  { id: 'dispensations', label: 'Dispensation' },
  { id: 'orders', label: 'Purchase Orders' },
] as const;

const toMedication = (item: StockItem): Medication => ({
  id: item.id,
  name: item.name,
  category: item.category,
  stock: item.stock,
  unit_price: item.unitPrice,
  expiry_date: item.expiryDate,
  batch_no: item.batchNo,
  supplier: item.supplier,
  reorder_threshold: item.reorderThreshold,
  status: 'available',
});

const toDispensation = (rx: PrescriptionItem): Dispensation => ({
  id: rx.id,
  patient_id: rx.patientId,
  patient_name: rx.patientName,
  doctor_id: '',
  doctor_name: rx.prescriberName,
  medication_id: '',
  medication_name: rx.dispensedFrom ? `${rx.drugName} (from ${rx.dispensedFrom})` : rx.drugName,
  quantity: rx.dispensedQuantity ?? 0,
  date: (rx.dispensedAt ?? rx.prescribedAt).slice(0, 10),
  pharmacist_id: '',
  pharmacist_name: rx.dispenserName,
  status: 'dispensed',
});

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

function medicationStatus(item: Medication): MedicationStatus {
  if (item.stock <= 0) return 'out-of-stock';
  if (item.stock <= item.reorder_threshold) return 'low';
  if (!item.expiry_date) return 'available';
  const days = Math.ceil((new Date(item.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return 'expired';
  if (days <= 60) return 'expiring';
  return 'available';
}

export function PharmacyPage() {
  const { currentRole, hasPermission, userName, organization } = useAuth();
  const { hasAccess } = useSubscription();
  const organizationId = organization.id;
  const [activeTab, setActiveTab] = useState<PharmacyTab>('inventory');
  // With Supabase these load from the workspace; the seeds are demo data for the offline mock.
  const [medications, setMedications] = useState<Medication[]>(isSupabaseConfigured ? [] : seedMedications);
  const [dispensations, setDispensations] = useState<Dispensation[]>(isSupabaseConfigured ? [] : seedDispensations);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(isSupabaseConfigured ? [] : seedPOs);
  const [rxQueue, setRxQueue] = useState<PrescriptionItem[]>([]);

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const [stock, rx, pos] = await Promise.all([
        listInventory(organizationId),
        listPrescriptions(organizationId),
        listPurchaseOrders(organizationId).catch(() => []),
      ]);
      setMedications(stock.map(toMedication));
      setRxQueue(rx.filter((item) => item.status === 'active'));
      setDispensations(rx.filter((item) => item.status === 'dispensed').map(toDispensation));
      setPurchaseOrders(pos.map((po) => ({
        id: po.id,
        poNumber: po.poNumber,
        supplier: po.supplier,
        drugItems: po.items.map((item) => ({ medicationId: item.inventoryId, medicationName: item.drugName, quantity: item.quantity })),
        status: po.status,
        createdAt: po.createdAt.slice(0, 10),
      })));
    } catch (error) {
      toast.error(errorText(error, 'Could not load pharmacy data'));
    }
  }, [organizationId]);

  useEffect(() => {
    void reload();
  }, [reload]);
  const [search, setSearch] = useState('');
  const [showLow, setShowLow] = useState(false);
  const [showExpiring, setShowExpiring] = useState(false);
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [showRecentDispensed, setShowRecentDispensed] = useState(false);
  const [addStockOpen, setAddStockOpen] = useState(false);
  const [dispenseOpen, setDispenseOpen] = useState(false);
  const [allergyChecked, setAllergyChecked] = useState(false);
  const [poOpen, setPoOpen] = useState(false);
  const [selectedExport, setSelectedExport] = useState<'inventory' | 'dispensations' | 'expiry'>('inventory');
  const [newStock, setNewStock] = useState({
    name: '',
    category: 'Analgesic',
    batch_no: '',
    supplier: '',
    quantity: 0,
    unit_price: 0,
    expiry_date: '',
    reorder_threshold: 10,
  });
  const [dispenseForm, setDispenseForm] = useState({
    patient_id: '',
    medication_id: '',
    quantity: 0,
  });
  const [poForm, setPoForm] = useState({
    supplier: '',
    medication_id: '',
    quantity: 0,
  });

  const canView = hasPermission('Pharmacy', 'view') || currentRole === 'doctor';
  const canCreate = hasPermission('Pharmacy', 'create');
  const canEdit = hasPermission('Pharmacy', 'edit');
  const canDelete = hasPermission('Pharmacy', 'delete') || currentRole === 'super-admin';
  const canExport = hasPermission('Pharmacy', 'export');
  const canApprove = hasPermission('Pharmacy', 'approve') || currentRole === 'super-admin';
  const isDoctor = currentRole === 'doctor';
  const isReception = currentRole === 'receptionist';
  const isLab = currentRole === 'lab-scientist' || currentRole === 'lab-technician';
  const isPharmacist = currentRole === 'pharmacist';
  const isHospitalAdmin = currentRole === 'hospital-admin';

  const filteredInventory = useMemo(() => {
    return medications
      .map((m) => ({ ...m, status: medicationStatus(m) }))
      .filter((m) => {
        const q = search.toLowerCase().trim();
        const matchSearch = !q || m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q) || m.batch_no.toLowerCase().includes(q);
        const matchLow = !showLow || m.status === 'low';
        const matchExpiring = !showExpiring || m.status === 'expiring' || m.status === 'expired';
        const matchOut = !showOutOfStock || m.status === 'out-of-stock';
        return matchSearch && matchLow && matchExpiring && matchOut;
      });
  }, [medications, search, showLow, showExpiring, showOutOfStock]);

  const filteredDispensations = useMemo(() => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 7);
    return dispensations.filter((d) => {
      const q = search.toLowerCase().trim();
      const matchSearch = !q || d.patient_name.toLowerCase().includes(q) || d.medication_name.toLowerCase().includes(q);
      const matchRecent = !showRecentDispensed || new Date(d.date) >= recentDate;
      return matchSearch && matchRecent;
    });
  }, [dispensations, search, showRecentDispensed]);

  const totalItems = medications.reduce((acc, med) => acc + med.stock, 0);
  const lowStockCount = medications.filter((m) => medicationStatus(m) === 'low').length;
  const expiringSoonCount = medications.filter((m) => medicationStatus(m) === 'expiring' || medicationStatus(m) === 'expired').length;
  const dispensedToday = dispensations.filter((d) => d.date === new Date().toISOString().slice(0, 10)).length;
  const alertRef = useRef({ low: '', expiry: '', daily: '' });

  function notify(type: 'low-stock' | 'new-prescription' | 'dispensed' | 'daily-summary', message: string) {
    window.dispatchEvent(new CustomEvent('vitalink:notify', { detail: { module: 'pharmacy', type, message } }));
  }

  useEffect(() => {
    const lowNames = medications
      .filter((m) => medicationStatus(m) === 'low' || medicationStatus(m) === 'out-of-stock')
      .map((m) => m.name)
      .slice(0, 3)
      .join(', ');
    if (lowNames && lowNames !== alertRef.current.low) {
      alertRef.current.low = lowNames;
      notify('low-stock', `Low stock alert: ${lowNames}`);
      medications
        .filter((m) => medicationStatus(m) === 'low' || medicationStatus(m) === 'out-of-stock')
        .slice(0, 6)
        .forEach((m) => {
          window.dispatchEvent(
            new CustomEvent<SentinelPharmacyPayload>(SENTINEL_PHARMACY_EVENT, {
              detail: {
                itemName: m.name,
                sku: m.id,
                quantityInStock: m.stock,
                reorderLevel: m.reorder_threshold,
                facilityName: organization.name,
              },
            }),
          );
        });
    }

    const expiryNames = medications
      .filter((m) => {
        const days = Math.ceil((new Date(m.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        return days <= 30;
      })
      .map((m) => m.name)
      .slice(0, 2)
      .join(', ');
    if (expiryNames && expiryNames !== alertRef.current.expiry) {
      alertRef.current.expiry = expiryNames;
      toast.warning(`Expiry alert: ${expiryNames}`);
    }
  }, [medications]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== alertRef.current.daily) {
      alertRef.current.daily = today;
      notify('daily-summary', `Daily pharmacy summary: ${dispensedToday} dispensed today`);
    }
  }, [dispensedToday]);

  function handleAddStock() {
    if (!canCreate) return toast.error('You do not have permission to add stock');
    if (!newStock.name || !newStock.batch_no || !newStock.supplier || !newStock.expiry_date) return toast.error('Complete required fields');
    if (isSupabaseConfigured) {
      if (Number(newStock.quantity) <= 0) return toast.error('Quantity must be at least 1');
      receiveStock(organizationId, {
        name: newStock.name,
        category: newStock.category,
        batchNo: newStock.batch_no,
        supplier: newStock.supplier,
        quantity: Number(newStock.quantity),
        unitPrice: Number(newStock.unit_price),
        expiryDate: newStock.expiry_date,
        reorderThreshold: Number(newStock.reorder_threshold),
      })
        .then(() => { toast.success('Stock added to inventory'); setAddStockOpen(false); void reload(); })
        .catch((error) => toast.error(errorText(error, 'Could not add stock')));
      return;
    }
    const id = `med-${Date.now()}`;
    const exists = medications.find((m) => m.name.toLowerCase() === newStock.name.toLowerCase() && m.batch_no === newStock.batch_no);
    if (exists) {
      setMedications((prev) =>
        prev.map((m) =>
          m.id === exists.id
            ? { ...m, stock: m.stock + Number(newStock.quantity), unit_price: Number(newStock.unit_price), expiry_date: newStock.expiry_date, reorder_threshold: Number(newStock.reorder_threshold), supplier: newStock.supplier }
            : m,
        ),
      );
    } else {
      setMedications((prev) => [
        ...prev,
        {
          id,
          name: newStock.name,
          category: newStock.category,
          stock: Number(newStock.quantity),
          unit_price: Number(newStock.unit_price),
          expiry_date: newStock.expiry_date,
          batch_no: newStock.batch_no,
          supplier: newStock.supplier,
          reorder_threshold: Number(newStock.reorder_threshold),
          status: 'available',
        },
      ]);
    }
    toast.success(isPharmacist ? 'Stock request recorded (await approval)' : 'Stock added to inventory');
    if (isPharmacist) notify('daily-summary', 'Stock addition pending admin approval');
    setAddStockOpen(false);
  }

  function handleDispense() {
    if (!(isPharmacist || currentRole === 'super-admin' || isHospitalAdmin)) return toast.error('Only pharmacy team can dispense medication');
    if (isSupabaseConfigured) {
      const rx = rxQueue.find((item) => item.id === dispenseForm.patient_id);
      if (!rx || !dispenseForm.medication_id || !dispenseForm.quantity) return toast.error('Choose a prescription, a stock batch and a quantity');
      const stockName = medications.find((m) => m.id === dispenseForm.medication_id)?.name ?? '';
      if (allergyConflicts(rx.patientAllergies, `${rx.drugName} ${stockName}`).length && !allergyChecked) {
        return toast.error('Confirm the allergy check before dispensing.');
      }
      dispensePrescription(rx.id, dispenseForm.medication_id, Number(dispenseForm.quantity))
        .then(() => {
          toast.success(`Dispensed for ${rx.patientName}`);
          notify('dispensed', `${rx.drugName} dispensed for ${rx.patientName}`);
          window.dispatchEvent(new CustomEvent('vitalink:training-action', { detail: { action: 'pharmacy:dispensed' } }));
          setDispenseOpen(false);
          setDispenseForm({ patient_id: '', medication_id: '', quantity: 0 });
          setAllergyChecked(false);
          void reload();
        })
        .catch((error) => toast.error(errorText(error, 'Could not dispense')));
      return;
    }
    const patientPrescription = prescriptions.find((p) => p.patient_id === dispenseForm.patient_id);
    const med = medications.find((m) => m.id === dispenseForm.medication_id);
    if (!patientPrescription || !med || !dispenseForm.quantity) return toast.error('Complete dispensation details');
    if (med.stock < dispenseForm.quantity) return toast.error('Insufficient stock');
    setMedications((prev) => prev.map((m) => (m.id === med.id ? { ...m, stock: m.stock - Number(dispenseForm.quantity) } : m)));
    const resultingStock = med.stock - Number(dispenseForm.quantity);
    setDispensations((prev) => [
      {
        id: `disp-${Date.now()}`,
        patient_id: patientPrescription.patient_id,
        patient_name: patientPrescription.patient_name,
        doctor_id: patientPrescription.doctor_id,
        doctor_name: patientPrescription.doctor_name,
        medication_id: med.id,
        medication_name: med.name,
        quantity: Number(dispenseForm.quantity),
        date: new Date().toISOString().slice(0, 10),
        pharmacist_id: 'ph1',
        pharmacist_name: userName,
        status: 'dispensed',
      },
      ...prev,
    ]);
    toast.success('Medication dispensed and synced to EMR + Billing');
    notify('dispensed', `${med.name} dispensed for ${patientPrescription.patient_name}`);
    window.dispatchEvent(new CustomEvent('vitalink:training-action', { detail: { action: 'pharmacy:dispensed' } }));
    window.dispatchEvent(new CustomEvent('vitalink:training-action', { detail: { action: 'pharmacy:inventory-updated' } }));
    if (resultingStock <= med.reorder_threshold) {
      window.dispatchEvent(new CustomEvent('vitalink:training-action', { detail: { action: 'pharmacy:low-stock-handled' } }));
    }
    setDispenseOpen(false);
  }

  function handleCreatePO() {
    if (!(canCreate || isHospitalAdmin || currentRole === 'super-admin')) return toast.error('Cannot create purchase orders');
    if (!poForm.supplier || !poForm.medication_id || !poForm.quantity) return toast.error('Complete purchase order form');
    const med = medications.find((m) => m.id === poForm.medication_id);
    if (!med) return toast.error('Medication not found');
    if (isSupabaseConfigured) {
      createPurchaseOrder(organizationId, poForm.supplier, [{ inventoryId: med.id, drugName: med.name, quantity: Number(poForm.quantity) }])
        .then(() => { toast.success('Purchase order created'); setPoOpen(false); void reload(); })
        .catch((error) => toast.error(errorText(error, 'Could not create the purchase order')));
      return;
    }
    setPurchaseOrders((prev) => [
      {
        id: `PO-${new Date().getFullYear()}-${String(prev.length + 1).padStart(4, '0')}`,
        supplier: poForm.supplier,
        drugItems: [{ medicationId: med.id, medicationName: med.name, quantity: Number(poForm.quantity) }],
        status: 'pending',
        createdAt: new Date().toISOString().slice(0, 10),
      },
      ...prev,
    ]);
    toast.success('Purchase order created');
    setPoOpen(false);
  }

  function setPOStatus(po: PurchaseOrder, status: PurchaseOrderStatus) {
    if (status !== 'pending' && !canApprove) return toast.error('Only admin roles can approve/deliver orders');
    if (isSupabaseConfigured) {
      if (status === 'pending') return;
      setPurchaseOrderStatus(po.id, status)
        .then(() => { toast.success(status === 'delivered' ? 'Delivered: stock added to inventory' : `PO marked ${status}`); void reload(); })
        .catch((error) => toast.error(errorText(error, 'Could not update the purchase order')));
      return;
    }
    setPurchaseOrders((prev) => prev.map((item) => (item.id === po.id ? { ...item, status } : item)));
    if (status === 'delivered') {
      setMedications((prev) =>
        prev.map((med) => {
          const line = po.drugItems.find((d) => d.medicationId === med.id);
          return line ? { ...med, stock: med.stock + line.quantity } : med;
        }),
      );
      toast.success('Delivered: inventory updated in real-time');
    } else {
      toast.success(`PO marked ${status}`);
    }
  }

  function rowAction(action: 'view' | 'edit' | 'adjust' | 'expire' | 'delete', med: Medication) {
    if (action === 'delete' && !canDelete) return toast.error('Only Super Admin can delete stock');
    if ((action === 'edit' || action === 'adjust' || action === 'expire') && !canEdit) return toast.error('You do not have edit permission');
    if (isSupabaseConfigured && action !== 'view') {
      const done = (message: string) => () => { toast.success(message); void reload(); };
      const fail = (error: unknown) => toast.error(errorText(error, 'Could not update stock'));
      if (action === 'delete') {
        if (!window.confirm(`Delete ${med.name} (batch ${med.batch_no || '-'}) from inventory?`)) return;
        deleteStock(med.id).then(done('Stock line deleted')).catch(fail);
      } else if (action === 'expire') {
        const date = new Date();
        date.setDate(date.getDate() - 1);
        const yesterday = date.toISOString().slice(0, 10);
        updateStock(med.id, { expiryDate: yesterday }).then(done(`${med.name} marked as expired`)).catch(fail);
      } else {
        const answer = window.prompt(`Counted stock for ${med.name} (currently ${med.stock}):`, String(med.stock));
        if (answer === null) return;
        const counted = Number(answer);
        if (!Number.isFinite(counted) || counted < 0) return toast.error('Enter a whole number of 0 or more');
        updateStock(med.id, { stock: counted }).then(done(`Stock for ${med.name} set to ${counted}`)).catch(fail);
      }
      return;
    }
    if (action === 'delete') setMedications((prev) => prev.filter((m) => m.id !== med.id));
    if (action === 'expire') setMedications((prev) => prev.map((m) => (m.id === med.id ? { ...m, expiry_date: '2024-01-01' } : m)));
    if (action === 'adjust') setMedications((prev) => prev.map((m) => (m.id === med.id ? { ...m, stock: Math.max(0, m.stock - 5) } : m)));
    if (action === 'view' || action === 'edit') toast.message(`${action === 'view' ? 'Viewing' : 'Editing'} ${med.name}`);
  }

  function doExport(format: ExportType) {
    if (!canExport) return toast.error('Export is restricted for your role');
    toast.success(`Exported ${selectedExport} as ${format.toUpperCase()}`);
  }

  if (!canView || isReception || isLab) {
    return (
      <div className="premium-card p-8 text-center page-transition">
        <h1 className="text-xl font-semibold text-gray-900">Pharmacy</h1>
        <p className="text-sm text-gray-500 mt-2">You do not have access to the Pharmacy core module for this role.</p>
      </div>
    );
  }
  if (!hasAccess('pharmacy')) {
    return (
      <div className="premium-card p-8 text-center page-transition">
        <h1 className="text-xl font-semibold text-gray-900">Pharmacy</h1>
        <p className="text-sm text-gray-500 mt-2">Pharmacy is locked on your plan. Upgrade to Pro.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 page-transition pb-12">
      <div className="sticky top-0 z-20 -mx-4 px-4 py-3 md:mx-0 md:px-0 bg-background/90 backdrop-blur-md border-b border-white/50 md:border-0">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#1E4ED8]">Pharmacy</h1>
            <p className="text-sm text-gray-500 mt-1">VitaLink iOS-glass pharmacy workflow with EMR/Billing integrations.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isDoctor && (
              <Button
                variant="outline"
                className="gap-2 rounded-xl border-[#1E4ED8]/20"
                onClick={() => toast.message('Prescription workflow', { description: 'Open EMR to prescribe medications' })}
              >
                <FileText className="w-4 h-4" />
                Prescribe (EMR)
              </Button>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2 rounded-xl border-[#1E4ED8]/20" disabled={!canExport}>
                  <Download className="w-4 h-4" />
                  Export
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 glass-panel border-white/60">
                <div className="space-y-3">
                  <div>
                    <Label>Data source</Label>
                    <select
                      className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm"
                      value={selectedExport}
                      onChange={(e) => setSelectedExport(e.target.value as 'inventory' | 'dispensations' | 'expiry')}
                    >
                      <option value="inventory">Inventory</option>
                      <option value="dispensations">Dispensation logs</option>
                      <option value="expiry">Expiry report</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Button size="sm" variant="outline" onClick={() => doExport('csv')}>CSV</Button>
                    <Button size="sm" variant="outline" onClick={() => doExport('excel')}>Excel</Button>
                    <Button size="sm" variant="outline" onClick={() => doExport('pdf')}>PDF</Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <Button className="gap-2 rounded-xl bg-gradient-to-r from-[#1E4ED8] to-[#1E3A8A] text-white hover:shadow-lg" onClick={() => setAddStockOpen(true)} disabled={!canCreate}>
              <Plus className="w-4 h-4" />
              Add Stock
            </Button>
            <Button className="gap-2 rounded-xl bg-emerald-600 text-white hover:shadow-lg" onClick={() => setDispenseOpen(true)} disabled={!(isPharmacist || currentRole === 'super-admin' || isHospitalAdmin)}>
              <ShoppingCart className="w-4 h-4" />
              Dispense
            </Button>
          </div>
        </div>
      </div>

      <div className="dashboard-stat-grid">
        <button type="button" className="glass-panel premium-card p-4 text-left hover:shadow-md transition-all card-equal-height h-full min-w-0 overflow-hidden" onClick={() => { setActiveTab('inventory'); setShowLow(false); setShowExpiring(false); setShowOutOfStock(false); }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center"><Package className="w-5 h-5 text-purple-600" /></div>
            <div className="min-w-0"><p className="text-xl font-bold text-gray-900 dark:text-slate-50 truncate tabular-nums">{totalItems}</p><p className="text-xs text-gray-500 dark:text-slate-400 truncate">Total Items</p></div>
          </div>
        </button>
        <button type="button" className="glass-panel premium-card p-4 text-left hover:shadow-md transition-all card-equal-height h-full min-w-0 overflow-hidden" onClick={() => { setActiveTab('inventory'); setShowLow(true); setShowExpiring(false); setShowOutOfStock(false); }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-red-600" /></div>
            <div className="min-w-0"><p className="text-xl font-bold text-red-600 truncate tabular-nums">{lowStockCount}</p><p className="text-xs text-gray-500 dark:text-slate-400 truncate">Low Stock</p></div>
          </div>
        </button>
        <button type="button" className="glass-panel premium-card p-4 text-left hover:shadow-md transition-all card-equal-height h-full min-w-0 overflow-hidden" onClick={() => { setActiveTab('inventory'); setShowExpiring(true); setShowLow(false); setShowOutOfStock(false); }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center"><TrendingDown className="w-5 h-5 text-amber-600" /></div>
            <div className="min-w-0"><p className="text-xl font-bold text-amber-600 truncate tabular-nums">{expiringSoonCount}</p><p className="text-xs text-gray-500 dark:text-slate-400 truncate">Expiring Soon</p></div>
          </div>
        </button>
        <button type="button" className="glass-panel premium-card p-4 text-left hover:shadow-md transition-all card-equal-height h-full min-w-0 overflow-hidden" onClick={() => { setActiveTab('dispensations'); setShowRecentDispensed(true); }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center"><ShoppingCart className="w-5 h-5 text-green-600" /></div>
            <div className="min-w-0"><p className="text-xl font-bold text-gray-900 dark:text-slate-50 truncate tabular-nums">{dispensedToday}</p><p className="text-xs text-gray-500 dark:text-slate-400 truncate">Dispensed Today</p></div>
          </div>
        </button>
      </div>

      <div className="flex flex-wrap gap-2 p-1 bg-white/70 dark:bg-slate-900/50 rounded-xl w-full max-w-full border border-white/60 dark:border-slate-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
              activeTab === tab.id ? 'bg-[#1E4ED8] text-white dark:text-white shadow-sm' : 'text-gray-600 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-200',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={activeTab === 'inventory' ? 'Search drug, category, batch...' : 'Search patient or medication...'} className="pl-11 rounded-xl bg-white/80 text-slate-900 dark:bg-slate-900/50 dark:text-slate-50 dark:placeholder:text-slate-400" />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="rounded-xl">Filter</Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 glass-panel border-white/60">
            <div className="space-y-2 text-sm">
              {activeTab === 'inventory' && (
                <>
                  <label className="flex items-center gap-2"><Checkbox checked={showLow} onCheckedChange={(v) => setShowLow(Boolean(v))} /> Low stock</label>
                  <label className="flex items-center gap-2"><Checkbox checked={showExpiring} onCheckedChange={(v) => setShowExpiring(Boolean(v))} /> Expiring soon</label>
                  <label className="flex items-center gap-2"><Checkbox checked={showOutOfStock} onCheckedChange={(v) => setShowOutOfStock(Boolean(v))} /> Out of stock</label>
                </>
              )}
              {activeTab === 'dispensations' && (
                <label className="flex items-center gap-2"><Checkbox checked={showRecentDispensed} onCheckedChange={(v) => setShowRecentDispensed(Boolean(v))} /> Recently dispensed</label>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {activeTab === 'inventory' && (
        <>
          {isSupabaseConfigured && medications.length === 0 ? (
            <p className="premium-card p-4 text-sm text-gray-500 dark:text-slate-400">No stock yet. Use “Add Stock” to record your first delivery.</p>
          ) : null}
          <div className="hidden md:block premium-card glass-panel overflow-hidden border border-white/60">
            <table className="w-full">
              <thead>
              <tr className="bg-gray-100 border-b border-gray-100 dark:bg-slate-800/80 dark:border-slate-700">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Medication</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Batch</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Stock</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Unit Price</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Expiry</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventory.map((item) => (
                  <tr key={item.id} className="border-b border-gray-50 dark:border-slate-700 hover:bg-white/70 dark:hover:bg-slate-800/60 transition-colors">
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><Pill className="w-4 h-4 text-indigo-500" /><span className="font-medium text-gray-900 dark:text-slate-50">{item.name}</span></div></td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400">{item.category}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400">{item.batch_no}</td>
                    <td className="px-4 py-3 text-sm text-gray-800 dark:text-slate-200">{item.stock}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-200">₦{item.unit_price.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400">{item.expiry_date}</td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium capitalize',
                        item.status === 'available' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
                        item.status === 'low' && 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
                        item.status === 'out-of-stock' && 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
                        item.status === 'expiring' && 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
                        item.status === 'expired' && 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
                      )}>{item.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => rowAction('view', item)}>View details</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => rowAction('edit', item)}>Edit stock</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => rowAction('adjust', item)}>Adjust quantity</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => rowAction('expire', item)}>Mark as expired</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => rowAction('delete', item)} className="text-red-600">Delete (Admin only)</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {filteredInventory.map((item) => (
              <div key={item.id} className="glass-panel premium-card p-4 border border-white/60">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-slate-50">{item.name}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{item.category} · {item.batch_no}</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-slate-50">{item.stock}</span>
                </div>
                <div className="mt-2 text-xs text-gray-600 dark:text-slate-400">Expiry: {item.expiry_date} · ₦{item.unit_price.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {activeTab === 'dispensations' && isSupabaseConfigured && (
        <div className="premium-card glass-panel overflow-hidden border border-white/60">
          <div className="flex items-center justify-between px-4 py-3">
            <h3 className="font-semibold text-gray-900 dark:text-slate-50">Waiting to be dispensed ({rxQueue.length})</h3>
          </div>
          {rxQueue.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-gray-500 dark:text-slate-400">No prescriptions waiting. Prescriptions appear here when a doctor signs a clinical note.</p>
          ) : (
            <table className="w-full">
              <tbody>
                {rxQueue.map((rx) => (
                  <tr key={rx.id} className="border-t border-gray-50 dark:border-slate-700">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-slate-50">{rx.patientName}<span className="block text-xs text-gray-500">{rx.patientSwitchId}</span></td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-200">{rx.drugName}{rx.quantity ? ` · qty ${rx.quantity}` : ''}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400">{rx.prescriberName} · {new Date(rx.prescribedAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" className="bg-emerald-600 text-white" disabled={!(isPharmacist || currentRole === 'super-admin' || isHospitalAdmin)} onClick={() => {
                          const firstWord = rx.drugName.split(/\s+/)[0]?.toLowerCase() ?? '';
                          const match = medications.find((m) => firstWord && m.name.toLowerCase().includes(firstWord) && m.stock > 0);
                          setDispenseForm({ patient_id: rx.id, medication_id: match?.id ?? '', quantity: rx.quantity ?? 0 });
                          setDispenseOpen(true);
                        }}>Dispense</Button>
                        <Button size="sm" variant="outline" disabled={!isDoctor && !isHospitalAdmin && currentRole !== 'super-admin'} onClick={() => {
                          if (!window.confirm(`Cancel ${rx.drugName} for ${rx.patientName}?`)) return;
                          cancelPrescription(rx.id).then(() => { toast.success('Prescription cancelled'); void reload(); }).catch((error) => toast.error(errorText(error, 'Could not cancel')));
                        }}>Cancel</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'dispensations' && (
        <div className="premium-card glass-panel overflow-hidden border border-white/60">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-100 border-b border-gray-100 dark:bg-slate-800/80 dark:border-slate-700">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Patient</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Prescription</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Quantity</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Pharmacist</th>
              </tr>
            </thead>
            <tbody>
              {filteredDispensations.map((disp) => (
                <tr key={disp.id} className="border-b border-gray-50 dark:border-slate-700 hover:bg-white/70 dark:hover:bg-slate-800/60">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-slate-50">{disp.patient_name}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-200">{disp.medication_name} · {disp.doctor_name}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-200">{disp.quantity} units</td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400">{disp.date}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400">{disp.pharmacist_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'orders' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button className="rounded-xl bg-[#1E4ED8] text-white" onClick={() => setPoOpen(true)} disabled={!(canCreate || isHospitalAdmin || currentRole === 'super-admin')}>Create Purchase Order</Button>
          </div>
          <div className="premium-card glass-panel overflow-hidden border border-white/60">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-100 border-b border-gray-100 dark:bg-slate-800/80 dark:border-slate-700">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">PO ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Supplier</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Drugs</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {purchaseOrders.map((po) => (
                  <tr key={po.id} className="border-b border-gray-50 dark:border-slate-700 hover:bg-white/70 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-3 text-sm font-medium text-[#1E4ED8]">{po.poNumber ?? po.id}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-200">{po.supplier}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-200">{po.drugItems.map((d) => `${d.medicationName} (${d.quantity})`).join(', ')}</td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium capitalize',
                        po.status === 'pending' && 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
                        po.status === 'approved' && 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
                        po.status === 'delivered' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
                        po.status === 'cancelled' && 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300',
                      )}>{po.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" variant="outline" disabled={!canApprove || po.status !== 'pending'} onClick={() => setPOStatus(po, 'approved')}>Approve</Button>
                        <Button size="sm" variant="outline" disabled={!canApprove || po.status !== 'approved'} onClick={() => setPOStatus(po, 'delivered')}>Deliver</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Offline demo only: these integrations are not connected in live workspaces. */}
      {!isSupabaseConfigured && (
      <div className="glass-panel premium-card p-4 border border-white/60">
        <h3 className="font-semibold text-[#1E4ED8] mb-2">Smart automation & integrations</h3>
        <div className="grid md:grid-cols-2 gap-3 text-sm text-gray-600 dark:text-slate-400">
          <p className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-indigo-500" /> VitaMind AI: low-stock and weekly high-usage insights.</p>
          <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> EMR: prescription pull + dispensed status updates.</p>
          <p className="flex items-center gap-2"><FileText className="w-4 h-4 text-blue-500" /> Billing: auto-generate medication bill on dispense.</p>
          <p className="flex items-center gap-2"><Barcode className="w-4 h-4 text-violet-500" /> Barcode + NFC + multi-branch + offline-first stubs active.</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast.message('Barcode scanner opened (demo)')}><Barcode className="w-4 h-4 mr-1" /> Scan drug</Button>
          <Button size="sm" variant="outline" onClick={() => toast.message('NFC linked to patient medication history (demo)')}>NFC Patient Link</Button>
          <Button size="sm" variant="outline" onClick={() => toast.message('Syncing across branches (demo)')}>Multi-branch sync</Button>
          <Button size="sm" variant="outline" onClick={() => toast.message('Offline mode enabled (demo)')}><WifiOff className="w-4 h-4 mr-1" /> Offline mode</Button>
        </div>
      </div>
      )}

      <Dialog open={addStockOpen} onOpenChange={setAddStockOpen}>
        <DialogContent className="glass-panel border-white/60 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add stock</DialogTitle>
            <DialogDescription>Drug intake updates inventory and low-stock tracking automatically.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <Label>Drug name</Label>
              <Input value={newStock.name} onChange={(e) => setNewStock((s) => ({ ...s, name: e.target.value }))} placeholder="Type medication name" className="mt-1" />
            </div>
            <div>
              <Label>Category</Label>
              <select className="mt-1 w-full rounded-md border border-input px-3 py-2 text-sm bg-white text-slate-900 dark:bg-slate-900/50 dark:text-slate-50 dark:border-slate-700" value={newStock.category} onChange={(e) => setNewStock((s) => ({ ...s, category: e.target.value }))}>
                <option>Analgesic</option><option>Antibiotic</option><option>Antidiabetic</option><option>Antihypertensive</option><option>NSAID</option>
              </select>
            </div>
            <div><Label>Batch number</Label><Input value={newStock.batch_no} onChange={(e) => setNewStock((s) => ({ ...s, batch_no: e.target.value }))} className="mt-1" /></div>
            <div><Label>Supplier</Label><Input value={newStock.supplier} onChange={(e) => setNewStock((s) => ({ ...s, supplier: e.target.value }))} className="mt-1" /></div>
            <div><Label>Quantity</Label><Input type="number" value={newStock.quantity} onChange={(e) => setNewStock((s) => ({ ...s, quantity: Number(e.target.value) }))} className="mt-1" /></div>
            <div><Label>Unit price</Label><Input type="number" value={newStock.unit_price} onChange={(e) => setNewStock((s) => ({ ...s, unit_price: Number(e.target.value) }))} className="mt-1" /></div>
            <div><Label>Expiry date</Label><Input type="date" value={newStock.expiry_date} onChange={(e) => setNewStock((s) => ({ ...s, expiry_date: e.target.value }))} className="mt-1" /></div>
            <div><Label>Reorder threshold</Label><Input type="number" value={newStock.reorder_threshold} onChange={(e) => setNewStock((s) => ({ ...s, reorder_threshold: Number(e.target.value) }))} className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddStockOpen(false)}>Cancel</Button>
            <Button className="bg-[#1E4ED8] text-white" onClick={handleAddStock}>Save stock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dispenseOpen} onOpenChange={setDispenseOpen}>
        <DialogContent className="glass-panel border-white/60 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Dispense medication</DialogTitle>
            <DialogDescription>
              {isSupabaseConfigured
                ? "Dispenses an active EMR prescription and deducts the batch; the drug is added to the patient's next invoice."
                : 'Pulling active prescription from EMR and posting to billing automatically.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{isSupabaseConfigured ? 'Prescription' : 'Patient'}</Label>
              {isSupabaseConfigured ? (
                <select className="mt-1 w-full rounded-md border border-input px-3 py-2 text-sm bg-white text-slate-900 dark:bg-slate-900/50 dark:text-slate-50 dark:border-slate-700" value={dispenseForm.patient_id} onChange={(e) => {
                  const rx = rxQueue.find((item) => item.id === e.target.value);
                  const firstWord = rx?.drugName.split(/\s+/)[0]?.toLowerCase() ?? '';
                  const match = medications.find((m) => firstWord && m.name.toLowerCase().includes(firstWord) && m.stock > 0);
                  setDispenseForm({ patient_id: e.target.value, medication_id: match?.id ?? '', quantity: rx?.quantity ?? 0 });
                  setAllergyChecked(false);
                }}>
                  <option value="">{rxQueue.length ? 'Select prescription' : 'No prescriptions waiting'}</option>
                  {rxQueue.map((rx) => <option key={rx.id} value={rx.id}>{rx.patientName} — {rx.drugName}</option>)}
                </select>
              ) : (
              <select className="mt-1 w-full rounded-md border border-input px-3 py-2 text-sm bg-white text-slate-900 dark:bg-slate-900/50 dark:text-slate-50 dark:border-slate-700" value={dispenseForm.patient_id} onChange={(e) => {
                const p = prescriptions.find((pr) => pr.patient_id === e.target.value);
                setDispenseForm((s) => ({ ...s, patient_id: e.target.value, medication_id: p?.medication_id ?? '', quantity: p?.quantity ?? 0 }));
                if (p) notify('new-prescription', `Prescription loaded for ${p.patient_name}`);
              }}>
                <option value="">Select patient</option>
                {prescriptions.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.patient_name}</option>)}
              </select>
              )}
            </div>
            {isSupabaseConfigured && (() => {
              const rx = rxQueue.find((item) => item.id === dispenseForm.patient_id);
              if (!rx) return null;
              const stockName = medications.find((m) => m.id === dispenseForm.medication_id)?.name ?? '';
              const conflicts = allergyConflicts(rx.patientAllergies, `${rx.drugName} ${stockName}`);
              return (
                <div className="space-y-2">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Recorded allergies: <span className="font-medium text-slate-900 dark:text-slate-50">{rx.patientAllergies.trim() || 'none recorded'}</span>
                  </p>
                  {conflicts.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      <p className="font-semibold">Possible allergy conflict</p>
                      <p className="text-xs mt-1">{rx.patientName} is recorded as allergic to {conflicts.join(', ')}. Check with the prescriber before dispensing.</p>
                      <label className="mt-2 flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={allergyChecked} onChange={(e) => setAllergyChecked(e.target.checked)} />
                        I have confirmed with the prescriber; dispense anyway
                      </label>
                    </div>
                  )}
                </div>
              );
            })()}
            <div>
              <Label>Medication</Label>
              <select
                className="mt-1 w-full rounded-md border border-input px-3 py-2 text-sm bg-white text-slate-900 dark:bg-slate-900/50 dark:text-slate-50 dark:border-slate-700"
                value={dispenseForm.medication_id}
                onChange={(e) => {
                  const selectedMed = medications.find((m) => m.id === e.target.value);
                  setDispenseForm((s) => ({ ...s, medication_id: e.target.value }));
                  if (selectedMed) {
                    window.dispatchEvent(new CustomEvent('vitalink:training-action', { detail: { action: 'pharmacy:stock-checked' } }));
                  }
                }}
              >
                <option value="">Select medication</option>
                {medications.map((m) => <option key={m.id} value={m.id}>{m.name}{m.batch_no ? ` · ${m.batch_no}` : ''} ({m.stock} in stock{m.expiry_date ? `, exp ${m.expiry_date}` : ''})</option>)}
              </select>
            </div>
            <div>
              <Label>Quantity</Label>
              <Input type="number" value={dispenseForm.quantity} onChange={(e) => setDispenseForm((s) => ({ ...s, quantity: Number(e.target.value) }))} className="mt-1" />
            </div>
            {isDoctor && <Textarea value="Doctor role: prescribing view only. Dispensing is disabled." readOnly className="bg-gray-50 text-slate-900 dark:bg-slate-900/50 dark:text-slate-200" />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDispenseOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 text-white" onClick={handleDispense}>Confirm dispense</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={poOpen} onOpenChange={setPoOpen}>
        <DialogContent className="glass-panel border-white/60 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create purchase order</DialogTitle>
            <DialogDescription>Supplier + item list, with pending → approved → delivered workflow.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Supplier</Label><Input value={poForm.supplier} onChange={(e) => setPoForm((s) => ({ ...s, supplier: e.target.value }))} className="mt-1" /></div>
            <div>
              <Label>Drug</Label>
              <select className="mt-1 w-full rounded-md border border-input px-3 py-2 text-sm bg-white text-slate-900 dark:bg-slate-900/50 dark:text-slate-50 dark:border-slate-700" value={poForm.medication_id} onChange={(e) => setPoForm((s) => ({ ...s, medication_id: e.target.value }))}>
                <option value="">Select medication</option>
                {medications.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div><Label>Quantity</Label><Input type="number" value={poForm.quantity} onChange={(e) => setPoForm((s) => ({ ...s, quantity: Number(e.target.value) }))} className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPoOpen(false)}>Cancel</Button>
            <Button className="bg-[#1E4ED8] text-white" onClick={handleCreatePO}>Create PO</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
