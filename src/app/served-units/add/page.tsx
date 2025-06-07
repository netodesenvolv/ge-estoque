import PageHeader from '@/components/PageHeader';
import ServedUnitForm from '@/components/forms/ServedUnitForm';
import { UsersRound } from 'lucide-react';

export default function AddServedUnitPage() {
  return (
    <div>
      <PageHeader title="Adicionar Nova Unidade Servida" description="Cadastre um novo local ou departamento que consome estoque." icon={UsersRound} />
      <ServedUnitForm />
    </div>
  );
}
