import PageHeader from '@/components/PageHeader';
import ServedUnitForm from '@/components/forms/ServedUnitForm';
import { UsersRound } from 'lucide-react';

export default function AddServedUnitPage() {
  return (
    <div>
      <PageHeader title="Add New Served Unit" description="Register a new location or department that consumes stock." icon={UsersRound} />
      <ServedUnitForm />
    </div>
  );
}
