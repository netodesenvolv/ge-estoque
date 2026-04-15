
'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { CalendarClock, Filter, Printer, AlertTriangle, Download } from 'lucide-react';
import type { Item } from '@/types';
import { mockItems } from '@/data/mockData';
import { format, parseISO, differenceInDays, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { firestore } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

const reportFiltersSchema = z.object({
  daysThreshold: z.coerce.number().int().min(0).optional().default(30),
  showExpired: z.boolean().default(true),
  showNearExpiration: z.boolean().default(true),
});

type ReportFiltersFormData = z.infer<typeof reportFiltersSchema>;

interface ExpiringItemReportData extends Item {
  daysToExpire: number | null;
  status: 'Vencido' | 'Próximo do Vencimento' | 'Válido';
}

const escapeCsvValue = (value: any): string => {
  if (value === null || value === undefined) {
    return '';
  }
  const stringValue = String(value);
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const convertToCSV = (data: ExpiringItemReportData[]): string => {
  const headers = [
    { key: 'name', label: 'Nome do Item' },
    { key: 'code', label: 'Código' },
    { key: 'currentQuantityCentral', label: 'Qtde. (Central)' },
    { key: 'expirationDate', label: 'Data de Validade' },
    { key: 'daysToExpire', label: 'Dias Restantes/Vencido Há' },
    { key: 'status', label: 'Status' },
  ];
  const headerRow = headers.map(h => h.label).join(',');
  const dataRows = data.map(row =>
    headers.map(header => {
      if (header.key === 'expirationDate' && row.expirationDate) {
        return escapeCsvValue(format(parseISO(row.expirationDate), 'yyyy-MM-dd'));
      }
      if (header.key === 'daysToExpire' && row.daysToExpire !== null) {
        return escapeCsvValue(row.daysToExpire < 0 ? `Vencido há ${Math.abs(row.daysToExpire)}d` : `${row.daysToExpire +1}d`);
      }
      return escapeCsvValue(row[header.key as keyof ExpiringItemReportData]);
    }).join(',')
  );
  return [headerRow, ...dataRows].join('\n');
};

const downloadCSV = (csvString: string, filename: string) => {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

export default function ExpiringItemsReportPage() {
  const { currentUserProfile } = useAuth();
  const { toast } = useToast();
  const [dbItems, setDbItems] = useState<Item[]>([]);
  const [dbStockLevels, setDbStockLevels] = useState<any[]>([]); // simplified for scoping
  const [reportData, setReportData] = useState<ExpiringItemReportData[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const isRestricted = currentUserProfile?.role === 'hospital_operator' || currentUserProfile?.role === 'ubs_operator';
  const isUbsOnly = currentUserProfile?.role === 'ubs_operator';

  const form = useForm<ReportFiltersFormData>({
    resolver: zodResolver(reportFiltersSchema),
    defaultValues: {
      daysThreshold: 30,
      showExpired: true,
      showNearExpiration: true,
    },
  });

  useEffect(() => {
    setIsLoading(true);
    const unsubItems = onSnapshot(query(collection(firestore, "items"), orderBy("name")), (snap) => {
      setDbItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item)));
    });

    const unsubStock = onSnapshot(collection(firestore, "stockLevels"), (snap) => {
      setDbStockLevels(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const timer = setTimeout(() => setIsLoading(false), 2000);

    return () => {
      unsubItems();
      unsubStock();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!isLoading && dbItems.length > 0) {
      onSubmit(form.getValues());
    }
  }, [isLoading, dbItems, dbStockLevels]); // Refilter if data changes

  const onSubmit = (filters: ReportFiltersFormData) => {
    setIsGenerating(true);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const processedItems = dbItems
      .map(item => {
        let quantity = item.currentQuantityCentral;
        
        if (isRestricted) {
           const levels = dbStockLevels.filter(sl => sl.itemId === item.id);
           if (isUbsOnly) {
             quantity = levels.find(sl => sl.unitId === currentUserProfile?.associatedUnitId)?.currentQuantity || 0;
           } else {
             // Sum of all units in hospital
             quantity = levels
               .filter(sl => sl.hospitalId === currentUserProfile?.associatedHospitalId)
               .reduce((acc, curr) => acc + curr.currentQuantity, 0);
           }
        }

        if (!item.expirationDate) {
          return { ...item, quantityAtLocation: quantity, daysToExpire: null, status: 'Válido' as const };
        }
        const expDate = parseISO(item.expirationDate);
        if (!isValid(expDate)) {
            return { ...item, quantityAtLocation: quantity, daysToExpire: null, status: 'Válido' as const };
        }
        const diff = differenceInDays(expDate, today);
        let status: ExpiringItemReportData['status'] = 'Válido';
        if (diff < 0) {
          status = 'Vencido';
        } else if (diff <= (filters.daysThreshold || 30)) {
          status = 'Próximo do Vencimento';
        }
        return { ...item, quantityAtLocation: quantity, daysToExpire: diff, status };
      })
      .filter(item => {
        if (!item.expirationDate) return false;
        if (item.quantityAtLocation <= 0) return false; // Don't show expiring items if we don't have stock
        if (item.status === 'Vencido' && filters.showExpired) return true;
        if (item.status === 'Próximo do Vencimento' && filters.showNearExpiration) return true;
        return false;
      })
      .sort((a, b) => (a.daysToExpire ?? Infinity) - (b.daysToExpire ?? Infinity));
    
    setReportData(processedItems as any);
    setIsGenerating(false);
  };
  
  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    if (reportData.length === 0) return;
    const csvString = convertToCSV(reportData);
    downloadCSV(csvString, 'relatorio_itens_a_vencer.csv');
  };
  
  const getStatusBadgeVariant = (status: ExpiringItemReportData['status']): "destructive" | "secondary" | "default" => {
    if (status === 'Vencido') return 'destructive';
    if (status === 'Próximo do Vencimento') return 'secondary';
    return 'default';
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isRestricted ? "Itens a Vencer (Estoque Local)" : "Relatório de Itens a Vencer (Geral)"}
        description={isRestricted ? "Identifique itens no seu estoque próximos da validade ou já vencidos." : "Identifique itens no estoque central ou global próximos da validade ou já vencidos."}
        icon={CalendarClock}
        actions={
          <div className="flex gap-2">
            <Button onClick={handlePrint} variant="outline" className="no-print"><Printer className="mr-2 h-4 w-4" /> Imprimir</Button>
            <Button onClick={handleExportCSV} variant="outline" className="no-print" disabled={reportData.length === 0}>
              <Download className="mr-2 h-4 w-4" /> Exportar CSV
            </Button>
          </div>
        }
        className="no-print"
      />

      <Card className="shadow-lg no-print">
        <CardHeader>
          <CardTitle className="font-headline flex items-center gap-2"><Filter className="h-5 w-5 text-primary"/> Filtros do Relatório</CardTitle>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="daysThreshold"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dias para Alerta de Vencimento</FormLabel>
                    <Select onValueChange={(val) => field.onChange(parseInt(val))} defaultValue={String(field.value)}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Ex: 30 dias" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="15">15 dias</SelectItem>
                        <SelectItem value="30">30 dias</SelectItem>
                        <SelectItem value="60">60 dias</SelectItem>
                        <SelectItem value="90">90 dias</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {/* Checkboxes para mostrar/ocultar são implicitamente tratados pela lógica de filtro agora.
                  Poderíamos adicionar checkboxes explícitos se a UI precisar deles.
                  Para simplificar, a lógica atual já filtra por 'Vencido' e 'Próximo do Vencimento'. */}
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={isGenerating || isLoading}>
                {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/> Carregando...</> : isGenerating ? "Gerando..." : "Atualizar Relatório"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

       <Alert variant="default" className="mt-4 no-print bg-blue-500/10 border-blue-500/50 text-blue-700">
        <AlertTriangle className="h-4 w-4 !text-blue-700" />
        <AlertTitle>Escopo do Relatório</AlertTitle>
        <AlertDescription>
          {isRestricted 
            ? `Exibindo itens com validade crítica presentes no estoque de: ${currentUserProfile?.associatedHospitalName}${currentUserProfile?.associatedUnitId ? ' - Setor Local' : ''}.`
            : "Este relatório exibe itens do catálogo com validades críticas em todo o sistema, com foco nas quantidades centrais."}
        </AlertDescription>
      </Alert>

      {reportData.length > 0 && (
        <Card className="shadow-lg mt-6 printable-content">
          <CardHeader>
            <CardTitle className="font-headline">Itens a Vencer/Vencidos no Estoque Central</CardTitle>
            <CardDescription>
              Alerta para itens vencendo em até {form.getValues("daysThreshold")} dias.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome do Item</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead className="text-right">Qtde. (Central)</TableHead>
                  <TableHead>Data de Validade</TableHead>
                  <TableHead className="text-right">Dias Restantes</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.code}</TableCell>
                    <TableCell className="text-right">{(item as any).quantityAtLocation}</TableCell>
                    <TableCell>{item.expirationDate ? format(parseISO(item.expirationDate), 'dd/MM/yyyy', {locale: ptBR}) : 'N/A'}</TableCell>
                    <TableCell className="text-right">
                      {item.daysToExpire !== null ? (item.daysToExpire < 0 ? `Vencido há ${Math.abs(item.daysToExpire)}d` : `${item.daysToExpire +1}d`) : 'N/A'}
                    </TableCell>
                    <TableCell className="text-center">
                       <Badge variant={getStatusBadgeVariant(item.status)}>{item.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {!isGenerating && form.formState.isSubmitted && reportData.length === 0 && (
         <Card className="mt-6 shadow-lg">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Nenhum item vencido ou próximo ao vencimento encontrado para os filtros atuais.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}


    
