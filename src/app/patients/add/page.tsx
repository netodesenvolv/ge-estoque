
'use client';

import PageHeader from '@/components/PageHeader';
import PatientForm from '@/components/forms/PatientForm';
import { UserPlus } from 'lucide-react';

export default function AddPatientPage() {
  return (
    <div>
      <PageHeader
        title="Adicionar Novo Paciente"
        description="Preencha os dados para cadastrar um novo paciente no sistema."
        icon={UserPlus}
      />
      <PatientForm />
    </div>
  );
}
