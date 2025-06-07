
import PageHeader from '@/components/PageHeader';
import HospitalForm from '@/components/forms/HospitalForm';
import { Building } from 'lucide-react';

export default function AddHospitalPage() {
  return (
    <div>
      <PageHeader title="Adicionar Novo Hospital" description="Cadastre um novo hospital que será atendido pelo almoxarifado." icon={Building} />
      <HospitalForm />
    </div>
  );
}
