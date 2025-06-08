
'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, CheckCircle, Package, Warehouse, Users, TrendingUpIcon, CalendarClock, HomeIcon as HomeIconLucide } from 'lucide-react';
import { mockItems, mockServedUnits, mockStockConfigs } from '@/data/mockData';
import type { Item, ServedUnit, StockItemConfig } from '@/types';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format, parseISO, isBefore, differenceInDays, isValid, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const NEARING_EXPIRATION_DAYS_DASHBOARD = 30;


export default function DashboardPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);
  const [stockConfigs, setStockConfigs] = useState<StockItemConfig[]>([]);
  const [stockLevelAlerts, setStockLevelAlerts] = useState<StockItemConfig[]>([]);
  const [expirationAlertItems, setExpirationAlertItems] = useState<Item[]>([]);

  useEffect(() => {
    setItems(mockItems);
    setServedUnits(mockServedUnits);
    setStockConfigs(mockStockConfigs);
  }, []);

  useEffect(() => {
    // Alertas de Nível de Estoque
    const currentStockAlerts = stockConfigs.filter(config => {
      const itemInCentral = items.find(i => i.id === config.itemId);
      const currentQty = config.unitId ? config.currentQuantity : itemInCentral?.currentQuantityCentral;
      return typeof currentQty === 'number' && currentQty < config.strategicStockLevel;
    });
    setStockLevelAlerts(currentStockAlerts);

    // Alertas de Validade
    const today = new Date();
    today.setHours(0,0,0,0);
    const thresholdDate = addDays(today, NEARING_EXPIRATION_DAYS_DASHBOARD);

    const currentExpirationAlerts = items.filter(item => {
      if (!item.expirationDate) return false;
      const expDate = parseISO(item.expirationDate);
      if (!isValid(expDate)) return false;
      // Inclui itens já vencidos e aqueles que vencerão nos próximos NEARING_EXPIRATION_DAYS_DASHBOARD dias
      return isBefore(expDate, thresholdDate); 
    });
    // Ordena por data de validade, os mais próximos primeiro
    setExpirationAlertItems(currentExpirationAlerts.sort((a, b) => {
        const dateA = a.expirationDate ? parseISO(a.expirationDate).getTime() : Infinity;
        const dateB = b.expirationDate ? parseISO(b.expirationDate).getTime() : Infinity;
        return dateA - dateB;
    }));

  }, [items, stockConfigs]);

  const summaryStats = [
    { title: 'Total de Itens', value: items.length, icon: Package, color: 'text-blue-500', href: '/items' },
    { title: 'Unidades Servidas', value: servedUnits.length, icon: Users, color: 'text-green-500', href: '/served-units' },
    { title: 'Alertas de Nível Baixo', value: stockLevelAlerts.length, icon: AlertTriangle, color: stockLevelAlerts.length > 0 ? 'text-orange-500' : 'text-green-500', href: '#stock-alerts' },
    { title: 'Alertas de Validade', value: expirationAlertItems.length, icon: CalendarClock, color: expirationAlertItems.length > 0 ? 'text-red-500' : 'text-green-500', href: '#expiration-alerts' },
  ];

  const getExpirationStatusForDashboard = (expirationDate?: string): { text: string; variant: 'default' | 'secondary' | 'destructive'; shortText: string; } => {
    if (!expirationDate) {
      return { text: 'N/A', variant: 'default', shortText: 'N/A' };
    }
    const expDate = parseISO(expirationDate);
     if (!isValid(expDate)) {
        return { text: 'Data Inválida', variant: 'destructive', shortText: 'Inválida' };
    }
    const today = new Date();
    today.setHours(0,0,0,0);

    if (isBefore(expDate, today)) {
      return { text: `Vencido em ${format(expDate, 'dd/MM/yy', { locale: ptBR })}`, variant: 'destructive', shortText: `Vencido ${format(expDate, 'dd/MM/yy')}`};
    }
    const daysDiff = differenceInDays(expDate, today);
    if (daysDiff <= NEARING_EXPIRATION_DAYS_DASHBOARD) {
      return { text: `Vence em ${daysDiff +1} dia(s) (${format(expDate, 'dd/MM/yy', { locale: ptBR })})`, variant: 'secondary', shortText: `Vence ${format(expDate, 'dd/MM/yy')}` };
    }
    return { text: `Válido até ${format(expDate, 'dd/MM/yy', { locale: ptBR })}`, variant: 'default', shortText: `Válido ${format(expDate, 'dd/MM/yy')}` };
  };

  return (
    <div className="container mx-auto py-2">
      <PageHeader title="Painel" description="Visão geral do seu sistema de gestão de estoque." icon={HomeIconLucide} />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
        {summaryStats.map((stat) => (
          <Card key={stat.title} className="shadow-lg hover:shadow-xl transition-shadow duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium font-body">{stat.title}</CardTitle>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold font-headline">{stat.value}</div>
              <Link href={stat.href || '#'} className="text-xs text-muted-foreground hover:text-primary transition-colors">
                Ver detalhes
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
      
      <div className="grid gap-8 md:grid-cols-1 lg:grid-cols-2">
        <Card id="stock-alerts" className="shadow-lg">
          <CardHeader>
            <CardTitle className="font-headline flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-orange-500" />
              Alertas de Estoque Estratégico
            </CardTitle>
            <CardDescription>Itens que atingiram ou caíram abaixo de seus níveis estratégicos de estoque.</CardDescription>
          </CardHeader>
          <CardContent>
            {stockLevelAlerts.length > 0 ? (
              <ul className="space-y-3 max-h-96 overflow-y-auto">
                {stockLevelAlerts.map((alert) => {
                  const item = items.find(i => i.id === alert.itemId);
                  const currentQty = alert.unitId ? alert.currentQuantity : item?.currentQuantityCentral;
                  return (
                    <li key={alert.id} className="flex items-center justify-between p-3 bg-orange-500/10 rounded-md">
                      <div>
                        <p className="font-semibold">{alert.itemName || item?.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {alert.unitName || 'Armazém Central'}: Atual {currentQty}, Estratégico {alert.strategicStockLevel}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <Link href="/stock/movements">Reabastecer</Link>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
                <p className="font-semibold">Todos os níveis de estoque estão ótimos.</p>
                <p className="text-sm text-muted-foreground">Nenhum item está atualmente abaixo dos níveis estratégicos.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card id="expiration-alerts" className="shadow-lg">
          <CardHeader>
            <CardTitle className="font-headline flex items-center gap-2">
              <CalendarClock className="h-6 w-6 text-red-500" />
              Alertas de Validade
            </CardTitle>
            <CardDescription>Itens vencidos ou próximos do vencimento (próximos {NEARING_EXPIRATION_DAYS_DASHBOARD} dias).</CardDescription>
          </CardHeader>
          <CardContent>
            {expirationAlertItems.length > 0 ? (
              <ul className="space-y-3 max-h-96 overflow-y-auto">
                {expirationAlertItems.map((item) => {
                  const expStatus = getExpirationStatusForDashboard(item.expirationDate);
                  return (
                    <li key={item.id} className={`flex items-center justify-between p-3 rounded-md ${expStatus.variant === 'destructive' ? 'bg-red-500/10' : 'bg-yellow-500/10'}`}>
                      <div>
                        <p className="font-semibold">{item.name} ({item.code})</p>
                        <p className="text-sm text-muted-foreground">
                          Validade: <Badge variant={expStatus.variant} className="ml-1">{expStatus.shortText}</Badge>
                        </p>
                        <p className="text-xs text-muted-foreground">Qtde. Central: {item.currentQuantityCentral}</p>
                      </div>
                       <Button variant="outline" size="sm" asChild>
                        <Link href={`/items?search=${item.code}`}>Ver Item</Link>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
                <p className="font-semibold">Nenhum item vencido ou próximo ao vencimento.</p>
                <p className="text-sm text-muted-foreground">Todos os itens estão com boa validade.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-lg lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-headline flex items-center gap-2">
              <TrendingUpIcon className="h-6 w-6 text-primary" />
              Ações Rápidas
            </CardTitle>
             <CardDescription>Acesse tarefas comuns rapidamente.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <Button asChild variant="outline" className="w-full justify-center py-6 text-base whitespace-normal h-auto text-center">
              <Link href="/items/add"><Package className="h-5 w-5" />Adicionar Novo Item</Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-center py-6 text-base whitespace-normal h-auto text-center">
              <Link href="/stock/movements"><Warehouse className="h-5 w-5" />Registrar Movimentação</Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-center py-6 text-base whitespace-normal h-auto text-center">
              <Link href="/served-units/add"><Users className="h-5 w-5" />Cadastrar Unidade</Link>
            </Button>
             <Button asChild variant="outline" className="w-full justify-center py-6 text-base whitespace-normal h-auto text-center">
              <Link href="/trends"><TrendingUpIcon className="h-5 w-5" />Analisar Tendências</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// HomeIconLucide is already imported as HomeIconLucide, no need for this duplicate
// function HomeIcon(props: React.SVGProps<SVGSVGElement>) {
//   return (
//     <svg
//       {...props}
//       xmlns="http://www.w3.org/2000/svg"
//       width="24"
//       height="24"
//       viewBox="0 0 24 24"
//       fill="none"
//       stroke="currentColor"
//       strokeWidth="2"
//       strokeLinecap="round"
//       strokeLinejoin="round"
//     >
//       <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
//       <polyline points="9 22 9 12 15 12 15 22" />
//     </svg>
//   )
// }
