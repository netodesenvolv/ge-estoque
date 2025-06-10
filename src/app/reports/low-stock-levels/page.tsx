
'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { ListChecks, Filter, Printer, AlertTriangle, CheckCircle, Download } from 'lucide-react';
import type { Item, ServedUnit, StockItemConfig, Hospital } from '@/types';
import { mockItems, mockServedUnits, mockStockConfigs, mockHospitals } from '@/data/mockData';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Badge } from '@/components/ui/badge';

const reportFiltersSchema = z.object({
  hospitalId: z.string().optional(),
  unitId: z.string().optional(),
  status: z.enum(['all', 'low', 'alert']).optional().default('all'),
});

type ReportFiltersFormData = z.infer<typeof reportFiltersSchema>;

interface DisplayStockItem extends StockItemConfig {
  itemCode?: string;
  statusLabel: 'Ótimo' | 'Baixo' | 'Alerta';
  statusVariant: 'default' | 'secondary' | 'destructive';
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

const convertToCSV = (data: DisplayStockItem[]): string => {
  const headers = [
    { key: 'itemName', label: 'Item' },
    { key: 'itemCode', label: 'Código' },
    { key: 'unitName', label: 'Localização' },
    { key: 'hospitalName', label: 'Hospital' },
    { key: 'currentQuantity', label: 'Atual' },
    { key: 'minQuantity', label: 'Mínimo' },
    { key: 'strategicStockLevel', label: 'Estratégico' },
    { key: 'statusLabel', label: 'Status' },
  ];
  const headerRow = headers.map(h => h.label).join(',');
  const dataRows = data.map(row =>
    headers.map(header => escapeCsvValue(row[header.key as keyof DisplayStockItem])).join(',')
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

export default function LowStockLevelsReportPage() {
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [allServedUnits, setAllServedUnits] = useState<ServedUnit[]>([]);
  const [allHospitals, setAllHospitals] = useState<Hospital[]>([]);
  const [stockData, setStockData] = useState<DisplayStockItem[]>([]);
  const [reportData, setReportData] = useState<DisplayStockItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const form = useForm<ReportFiltersFormData>({
    resolver: zodResolver(reportFiltersSchema),
    defaultValues: {
      hospitalId: 'all',
      unitId: 'all',
      status: 'all',
    },
  });
  
  const selectedHospitalId = form.watch('hospitalId');

  useEffect(() => {
    setAllItems(mockItems);
    const enrichedServedUnits = mockServedUnits.map(su => ({
        ...su,
        hospitalName: mockHospitals.find(h => h.id === su.hospitalId)?.name || 'N/A'
    }));
    setAllServedUnits(enrichedServedUnits);
    setAllHospitals(mockHospitals);

    // Prepare base stock data
    const getUnitDetails = (unitId?: string) => {
        if (!unitId) return { unitName: 'Armazém Central', hospitalId: undefined, hospitalName: undefined };
        const unit = enrichedServedUnits.find(u => u.id === unitId);
        return { 
          unitName: unit?.name || 'Unidade Desconhecida', 
          hospitalId: unit?.hospitalId, 
          hospitalName: unit?.hospitalName 
        };
    };

    const centralStock: DisplayStockItem[] = mockItems.map(item => {
      const config = mockStockConfigs.find(sc => sc.itemId === item.id && !sc.unitId);
      const currentQuantity = item.currentQuantityCentral;
      let statusLabel: DisplayStockItem['statusLabel'] = 'Ótimo';
      let statusVariant: DisplayStockItem['statusVariant'] = 'default';
      if (config) {
        if (config.minQuantity > 0 && currentQuantity < config.minQuantity) {
            statusLabel = 'Baixo'; statusVariant = 'secondary';
        } else if (currentQuantity < config.strategicStockLevel) {
            statusLabel = 'Alerta'; statusVariant = 'destructive';
        }
      }
      return {
        id: `central-${item.id}`,
        itemId: item.id,
        itemName: item.name,
        itemCode: item.code,
        ...getUnitDetails(undefined),
        strategicStockLevel: config?.strategicStockLevel || 0,
        minQuantity: config?.minQuantity || item.minQuantity,
        currentQuantity: currentQuantity,
        statusLabel,
        statusVariant,
      };
    });

    const unitStock: DisplayStockItem[] = mockStockConfigs
      .filter(config => config.unitId)
      .map(config => {
        const itemDetail = mockItems.find(i => i.id === config.itemId);
        let statusLabel: DisplayStockItem['statusLabel'] = 'Ótimo';
        let statusVariant: DisplayStockItem['statusVariant'] = 'default';
        const unitDetails = getUnitDetails(config.unitId);
        if (typeof config.currentQuantity === 'number') {
           if (config.minQuantity > 0 && config.currentQuantity < config.minQuantity) {
             statusLabel = 'Baixo'; statusVariant = 'secondary';
           } else if (config.currentQuantity < config.strategicStockLevel) {
             statusLabel = 'Alerta'; statusVariant = 'destructive';
           }
        }
        return {
          ...config,
          itemName: config.itemName || itemDetail?.name,
          itemCode: itemDetail?.code,
          ...unitDetails,
          statusLabel,
          statusVariant,
        };
      });
    
    const combinedStock = [...centralStock, ...unitStock].sort((a, b) => 
      (a.hospitalName || '').localeCompare(b.hospitalName || '') || 
      a.unitName!.localeCompare(b.unitName!) ||
      (a.itemName || '').localeCompare(b.itemName || '')
    );
    setStockData(combinedStock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  useEffect(() => {
    // Auto-generate report when stockData is ready or filters change
    if (stockData.length > 0) {
      onSubmit(form.getValues());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockData, form.watch('hospitalId'), form.watch('unitId'), form.watch('status')]);


  useEffect(() => {
    form.setValue('unitId', 'all');
  }, [selectedHospitalId, form]);

  const availableUnits = selectedHospitalId && selectedHospitalId !== 'all'
    ? allServedUnits.filter(unit => unit.hospitalId === selectedHospitalId)
    : allServedUnits;

  const onSubmit = (filters: ReportFiltersFormData) => {
    setIsGenerating(true);
    console.log("Gerando relatório de níveis de estoque com filtros:", filters);

    const filtered = stockData.filter(item => {
      const hospitalMatch = filters.hospitalId === 'all' || !filters.hospitalId || 
                           (filters.hospitalId === 'central' && !item.unitId) || 
                           item.hospitalId === filters.hospitalId;
      
      const unitMatch = filters.unitId === 'all' || !filters.unitId || 
                       (filters.hospitalId === 'central') || // If central is chosen, unit filter is irrelevant for central items
                       item.unitId === filters.unitId;

      const statusMatch = filters.status === 'all' || 
                         (filters.status === 'low' && item.statusLabel === 'Baixo') ||
                         (filters.status === 'alert' && item.statusLabel === 'Alerta');
      
      // Logic to ensure "Armazém Central" is only shown if hospitalId is 'central' or 'all'
      if (filters.hospitalId !== 'central' && filters.hospitalId !== 'all' && !item.unitId) {
        return false;
      }

      return hospitalMatch && unitMatch && statusMatch;
    });
    
    setReportData(filtered);
    setIsGenerating(false);
  };
  
  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    if (reportData.length === 0) return;
    const csvString = convertToCSV(reportData);
    downloadCSV(csvString, 'relatorio_niveis_estoque.csv');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatório de Níveis de Estoque Baixos/Alerta"
        description="Identifique itens que necessitam de atenção devido a níveis de estoque críticos."
        icon={ListChecks}
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
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <FormField
                control={form.control}
                name="hospitalId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hospital/Local</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="all">Todos Hospitais e Armazém</SelectItem>
                        <SelectItem value="central">Apenas Armazém Central</SelectItem>
                        {allHospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
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
                    <Select onValueChange={field.onChange} value={field.value || 'all'} disabled={selectedHospitalId === 'central'}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="all">Todas as Unidades</SelectItem>
                        {availableUnits.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status do Estoque</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="all">Todos (Baixo e Alerta)</SelectItem>
                        <SelectItem value="low">Apenas Baixo (Abaixo do Mínimo)</SelectItem>
                        <SelectItem value="alert">Apenas Alerta (Abaixo do Estratégico)</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={isGenerating}>
                {isGenerating ? "Atualizando..." : "Atualizar Relatório"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
      
      {reportData.length > 0 && (
        <Card className="shadow-lg mt-6 printable-content">
          <CardHeader>
            <CardTitle className="font-headline">Itens com Nível de Estoque Baixo ou em Alerta</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Localização</TableHead>
                  <TableHead>Hospital</TableHead>
                  <TableHead className="text-right">Atual</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead className="text-right">Estratégico</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.map((item) => (
                  <TableRow key={item.id} className={item.statusVariant === 'destructive' ? 'bg-red-500/5' : item.statusVariant === 'secondary' ? 'bg-yellow-500/5' : ''}>
                    <TableCell className="font-medium">{item.itemName}</TableCell>
                    <TableCell>{item.itemCode}</TableCell>
                    <TableCell>{item.unitName}</TableCell>
                    <TableCell>{item.hospitalName || '-'}</TableCell>
                    <TableCell className="text-right">{item.currentQuantity}</TableCell>
                    <TableCell className="text-right">{item.minQuantity}</TableCell>
                    <TableCell className="text-right">{item.strategicStockLevel}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={item.statusVariant}>{item.statusLabel}</Badge>
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
          <CardContent className="pt-6 flex flex-col items-center justify-center text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
            <p className="text-lg font-semibold">Nenhum item em alerta ou com estoque baixo encontrado.</p>
            <p className="text-sm text-muted-foreground">Todos os níveis de estoque estão adequados para os filtros selecionados.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}


    