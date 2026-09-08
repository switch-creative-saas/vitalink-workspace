import { SButton as Button } from '@/components/standalone/SButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSentinelStore } from '@/store/useSentinelStore';

export function NotFoundPage() {
  const { navigate } = useSentinelStore();
  return <EmptyState title="Page not found" body="The requested Sentinel workspace could not be found." action={<Button onClick={() => navigate('dashboard')}>Return to Dashboard</Button>} />;
}

