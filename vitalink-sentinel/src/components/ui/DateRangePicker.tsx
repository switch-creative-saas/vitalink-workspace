import { useSentinelStore } from '@/store/useSentinelStore';
import { SSelect as Select } from '@/components/standalone/SSelect';

export function DateRangePicker() {
  const { timeRange, setTimeRange } = useSentinelStore();
  return (
    <Select value={timeRange} onChange={(event) => setTimeRange(event.target.value as typeof timeRange)}>
      <option value="7d">Last 7 days</option>
      <option value="30d">Last 30 days</option>
      <option value="90d">Last 90 days</option>
      <option value="1y">Last year</option>
    </Select>
  );
}

