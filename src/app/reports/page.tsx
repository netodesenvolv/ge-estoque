
'use client';

import PageHeader from '@/components/PageHeader';
import { FileText } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ReportsPage() {
  return (
    <div>
      <PageHeader
        title="Relatórios"
        description="Visualize e exporte relatórios do sistema de gestão de estoque."
        icon={FileText}
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Relatórios Disponíveis</CardTitle>
          <CardDescription>
            Esta seção está em desenvolvimento. Futuramente, você poderá gerar diversos relatórios aqui.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Nenhum relatório disponível no momento.</p>
        </CardContent>
      </Card>
    </div>
  );
}
