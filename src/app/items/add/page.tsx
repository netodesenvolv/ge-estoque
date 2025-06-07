import PageHeader from '@/components/PageHeader';
import ItemForm from '@/components/forms/ItemForm';
import { PackagePlus } from 'lucide-react';

export default function AddItemPage() {
  return (
    <div>
      <PageHeader title="Adicionar Novo Item" description="Insira os detalhes do novo item de inventário." icon={PackagePlus} />
      <ItemForm />
    </div>
  );
}
