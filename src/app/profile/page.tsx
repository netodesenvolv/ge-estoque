
'use client';

import PageHeader from '@/components/PageHeader';
import { UserCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ProfilePage() {
  return (
    <div>
      <PageHeader
        title="Perfil do Usuário"
        description="Gerencie suas informações de perfil e preferências."
        icon={UserCircle}
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Minhas Informações</CardTitle>
          <CardDescription>
            Esta é uma página de perfil de exemplo. Em uma aplicação real, você poderia editar seus dados aqui.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-medium">Nome</h3>
              <p className="text-muted-foreground">Usuário Exemplo</p>
            </div>
            <div>
              <h3 className="text-lg font-medium">Email</h3>
              <p className="text-muted-foreground">usuario.exemplo@email.com</p>
            </div>
            <div>
              <h3 className="text-lg font-medium">Preferências</h3>
              <p className="text-muted-foreground">Notificações: Ativadas</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
