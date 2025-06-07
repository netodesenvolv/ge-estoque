import PageHeader from '@/components/PageHeader';
import ItemForm from '@/components/forms/ItemForm';
import { PackagePlus } from 'lucide-react';

export default function AddItemPage() {
  return (
    <div>
      <PageHeader title="Add New Item" description="Enter the details for the new inventory item." icon={PackagePlus} />
      <ItemForm />
    </div>
  );
}
