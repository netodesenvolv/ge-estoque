
'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { BarChart3, CalendarIcon, Filter, Printer, Download, Loader2 } from 'lucide-react';
import type { Item, ServedUnit, Hospital, StockMovement } from '@/types';
import { format, parseISO } from 'date-fns';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { firestore } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

const reportFiltersSchema = z.object({
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  itemId: z.string().optional(),
  hospitalId: z.string().optional(),
  unitId: z.string().optional(),
}).refine(data => !data.startDate || !data.endDate || data.endDate >= data.startDate, {
  message: "Data final deve ser igual ou posterior à data inicial.",
  path: ["endDate"],
});

type ReportFiltersFormData = z.infer<typeof reportFiltersSchema>;

interface ReportData {
  itemName: string;
  itemCode: string;
  unitName?: string;
  hospitalName?: string;
  totalConsumed: number;
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

const convertToCSV = (data: ReportData[]): string => {
  const headers = [
    { key: 'itemName', label: 'Nome do Item' },
    { key: 'itemCode', label: 'Código' },
    { key: 'unitName', label: 'Unidade/Local' },
    { key: 'hospitalName', label: 'Hospital' },
    { key: 'totalConsumed', label: 'Total Consumido' },
  ];
  const headerRow = headers.map(h => h.label).join(',');
  const dataRows = data.map(row =>
    headers.map(header => escapeCsvValue(row[header.key as keyof ReportData])).join(',')
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


export default function GeneralConsumptionReportPage() {
  const [dbItems, setDbItems] = useState<Item[]>([]);
  const [dbServedUnits, setDbServedUnits] = useState<ServedUnit[]>([]);
  const [dbHospitals, setDbHospitals] = useState<Hospital[]>([]);
  const [dbMovements, setDbMovements] = useState<StockMovement[]>([]);

  const [reportData, setReportData] = useState<ReportData[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const form = useForm<ReportFiltersFormData>({
    resolver: zodResolver(reportFiltersSchema),
    defaultValues: {
      itemId: 'all',
      hospitalId: 'all',
      unitId: 'all',
    },
  });

  const selectedHospitalId = form.watch('hospitalId');

  useEffect(() => {
    setIsLoading(true);

    const createListener = (collectionName: string, setter: React.Dispatch<React.SetStateAction<any[]>>, orderField: string = "name") => {
        const q = query(collection(firestore, collectionName), orderBy(orderField, "asc"));
        return onSnapshot(q, 
            (snapshot) => {
                setter(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
            },
            (error) => {
                console.error(`Erro ao buscar ${collectionName}:`, error);
                toast({ title: `Erro ao carregar ${collectionName}`, variant: "destructive", description: error.message });
            }
        );
    };

    const unsubscribers = [
        createListener("items", setDbItems),
        createListener("hospitals", setDbHospitals),
        createListener("servedUnits", setDbServedUnits),
        createListener("stockMovements", setDbMovements, "date"),
    ];

    // This is a simple way to remove the loading spinner.
    // It assumes all snapshots will fire at least once relatively quickly.
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2500);

    return () => {
      unsubscribers.forEach(unsub => unsub());
      clearTimeout(timer);
    };
  }, [toast]);
  
  useEffect(() => {
    form.setValue('unitId', 'all');
  }, [selectedHospitalId, form]);

  const availableUnits = selectedHospitalId && selectedHospitalId !== 'all'
    ? dbServedUnits.filter(unit => unit.hospitalId === selectedHospitalId)
    : dbServedUnits;

  const onSubmit = (filters: ReportFiltersFormData) => {
    setIsGenerating(true);

    const filteredMovements = dbMovements.filter(m => {
      if (m.type !== 'consumption') return false;
      if (filters.startDate && parseISO(m.date) < filters.startDate) return false;
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        if (parseISO(m.date) > endDate) return false;
      }
      if (filters.itemId && filters.itemId !== 'all' && m.itemId !== filters.itemId) return false;
      if (filters.hospitalId && filters.hospitalId !== 'all' && m.hospitalId !== filters.hospitalId) return false;
      if (filters.unitId && filters.unitId !== 'all' && m.unitId !== filters.unitId) return false;
      return true;
    });

    const groupedData: { [key: string]: ReportData } = {};

    filteredMovements.forEach(m => {
      const itemDetail = dbItems.find(i => i.id === m.itemId);
      const key = `${m.itemId}-${m.unitId || 'central'}-${m.hospitalId || 'none'}`;
      if (!groupedData[key]) {
        groupedData[key] = {
          itemName: itemDetail?.name || 'Desconhecido',
          itemCode: itemDetail?.code || 'N/A',
          unitName: m.unitName || 'Armazém Central',
          hospitalName: m.hospitalName || (m.unitId ? 'Hospital N/A' : '-'),
          totalConsumed: 0,
        };
      }
      groupedData[key].totalConsumed += m.quantity;
    });
    
    setReportData(Object.values(groupedData).sort((a,b) => a.itemName.localeCompare(b.itemName)));
    setIsGenerating(false);
  };
  
  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    if (reportData.length === 0) return;
    const csvString = convertToCSV(reportData);
    downloadCSV(csvString, 'relatorio_consumo_geral.csv');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatório de Consumo Geral"
        description="Analise o consumo agregado de itens por diferentes filtros."
        icon={BarChart3}
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
          <CardDescription>Selecione os filtros para gerar o relatório de consumo.</CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Data Inicial</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button variant="outline" className="font-normal justify-start" disabled={isLoading}>
                            {field.value ? format(field.value, "dd/MM/yyyy") : <span>Selecione uma data</span>}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Data Final</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button variant="outline" className="font-normal justify-start" disabled={isLoading}>
                            {field.value ? format(field.value, "dd/MM/yyyy") : <span>Selecione uma data</span>}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus disabled={(date) => form.getValues("startDate") ? date < form.getValues("startDate")! : false }/>
                      </PopoverContent>
                    </Popover>
                     <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="itemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoading}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Todos os Itens" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="all">Todos os Itens</SelectItem>
                        {dbItems.map(item => <SelectItem key={item.id} value={item.id}>{item.name} ({item.code})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="hospitalId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hospital</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoading}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Todos os Hospitais" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="all">Todos os Hospitais</SelectItem>
                        {dbHospitals.map(hospital => <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="unitId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unidade Servida</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || 'all'} disabled={isLoading || !selectedHospitalId || selectedHospitalId === 'all' && availableUnits.length === dbServedUnits.length && availableUnits.length === 0}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Todas as Unidades" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="all">Todas as Unidades</SelectItem>
                        {availableUnits.map(unit => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={isGenerating || isLoading}>
                {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/> Carregando...</> : isGenerating ? "Gerando..." : "Gerar Relatório"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

      {reportData.length > 0 && (
        <Card className="shadow-lg mt-6 printable-content">
          <CardHeader>
            <CardTitle className="font-headline">Resultados do Relatório de Consumo Geral</CardTitle>
            <CardDescription>
              Período: {form.getValues("startDate") ? format(form.getValues("startDate")!, 'dd/MM/yy') : 'N/A'} a {form.getValues("endDate") ? format(form.getValues("endDate")!, 'dd/MM/yy') : 'N/A'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome do Item</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Unidade/Local</TableHead>
                  <TableHead>Hospital</TableHead>
                  <TableHead className="text-right">Total Consumido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.map((data, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{data.itemName}</TableCell>
                    <TableCell>{data.itemCode}</TableCell>
                    <TableCell>{data.unitName}</TableCell>
                    <TableCell>{data.hospitalName}</TableCell>
                    <TableCell className="text-right">{data.totalConsumed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
       { !isGenerating && form.formState.isSubmitted && reportData.length === 0 && (
        <Card className="mt-6 shadow-lg">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Nenhum dado de consumo encontrado para os filtros selecionados.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
