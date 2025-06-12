
'use client';

import PageHeader from '@/components/PageHeader';
import UserForm from '@/components/forms/UserForm';
import { UserPlus } from 'lucide-react';

export default function AddUserPage() {
  return (
    <div>
      <PageHeader
        title="Adicionar Novo Usuário"
        description="Preencha os dados abaixo para cadastrar um novo usuário no sistema."
        icon={UserPlus}
      />
      <UserForm />
    </div>
  );
}
