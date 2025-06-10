
'use client';

import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { FileText, BarChart3, UserCheck, CalendarClock, History, ListChecks } from 'lucide-react';

const reportTypes = [
  {
    title: 'Consumo Geral de Itens',
    description: 'Visualize o consumo agregado de itens por período, hospital ou unidade.',
    href: '/reports/general-consumption',
    icon: BarChart3,
  },
  {
    title: 'Consumo por Paciente',
    description: 'Rastreie o consumo de itens específico para cada paciente.',
    href: '/reports/patient-consumption',
    icon: UserCheck,
  },
  {
    title: 'Itens Próximos ao Vencimento',
    description: 'Identifique itens no estoque central que estão próximos da data de validade ou já venceram.',
    href: '/reports/expiring-items',
    icon: CalendarClock,
  },
  {
    title: 'Histórico Detalhado de Consumo',
    description: 'Consulte um log detalhado de todas as movimentações de consumo.',
    href: '/reports/consumption-history',
    icon: History,
  },
  {
    title: 'Níveis de Estoque Baixos/Alerta',
    description: 'Verifique itens que estão abaixo do nível mínimo ou estratégico em todas as localizações.',
    href: '/reports/low-stock-levels',
    icon: ListChecks,
  }
];

export default function ReportsPage() {
  return (
    <div>
      <PageHeader
        title="Central de Relatórios"
        description="Acesse e gere relatórios detalhados sobre a gestão de estoque."
        icon={FileText}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {reportTypes.map((report) => (
          <Card key={report.href} className="shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col">
            <CardHeader>
              <div className="flex items-start gap-4">
                <report.icon className="h-8 w-8 text-primary mt-1" />
                <div>
                  <CardTitle className="font-headline text-xl">{report.title}</CardTitle>
                  <CardDescription className="mt-1">{report.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-grow">
              {/* Pode adicionar mais informações ou um preview aqui se necessário */}
            </CardContent>
            <CardFooter>
              <Button asChild className="w-full">
                <Link href={report.href}>Abrir Relatório</Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
