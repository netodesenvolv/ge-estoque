
'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { ListChecks, Filter, Printer, Download, Package as PackageIcon, Loader2, CheckCircle } from 'lucide-react';
import type { Item } from '@/types';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Badge } from '@/components/ui/badge';
import { firestore } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

// Interface para configurações de estoque do Firestore
interface FirestoreStockConfig {
  id?: string; // ID do documento do Firestore (itemId_central)
  itemId: string;
  strategicStockLevel: number;
  minQuantity: number;
  // unitId e hospitalId não são usados neste relatório, pois focamos no central
}

// Interface para exibição no relatório
interface LowStockReportItem extends Item {
  strategicStockLevel?: number;
  effectiveMinQuantity?: number; // minQuantity da config ou do item
  statusLabel: 'Ótimo' | 'Baixo' | 'Alerta' | 'Não Configurado';
  statusVariant: 'default' | 'secondary' | 'destructive' | 'outline';
}


const reportFiltersSchema = z.object({
  status: z.enum(['all', 'low', 'alert', 'not_configured']).optional().default('all'),
  itemId: z.string().optional().default('all'),
});

type ReportFiltersFormData = z.infer<typeof reportFiltersSchema>;


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

const convertToCSV = (data: LowStockReportItem[]): string => {
  const BOM = "\uFEFF"; // Byte Order Mark for UTF-8
  const headers = [
    { key: 'name', label: 'Item' },
    { key: 'code', label: 'Código' },
    { key: 'currentQuantityCentral', label: 'Qtde. Atual (Central)' },
    { key: 'effectiveMinQuantity', label: 'Mínimo Configurado' },
    { key: 'strategicStockLevel', label: 'Estratégico Configurado' },
    { key: 'statusLabel', label: 'Status' },
  ];
  const headerRow = headers.map(h => h.label).join(',');
  const dataRows = data.map(row =>
    headers.map(header => escapeCsvValue(row[header.key as keyof LowStockReportItem])).join(',')
  );
  return BOM + [headerRow, ...dataRows].join('\n');
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
    URL.revokeObjectURL(url);
  }
};

export default function LowStockLevelsReportPage() {
  const [firestoreItems, setFirestoreItems] = useState<Item[]>([]);
  const [firestoreStockConfigs, setFirestoreStockConfigs] = useState<FirestoreStockConfig[]>([]);
  const [processedReportItems, setProcessedReportItems] = useState<LowStockReportItem[]>([]);
  const [reportData, setReportData] = useState<LowStockReportItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const form = useForm<ReportFiltersFormData>({
    resolver: zodResolver(reportFiltersSchema),
    defaultValues: {
      status: 'all',
      itemId: 'all',
    },
  });

  useEffect(() => {
    setIsLoading(true);
    let itemsLoaded = false;
    let configsLoaded = false;

    const checkDoneLoading = () => {
      if (itemsLoaded && configsLoaded) {
        // O setIsLoading(false) será chamado no useEffect que processa os dados
      }
    };

    const itemsQuery = query(collection(firestore, "items"), orderBy("name", "asc"));
    const unsubscribeItems = onSnapshot(itemsQuery, (snapshot) => {
      setFirestoreItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item)));
      itemsLoaded = true;
      checkDoneLoading();
    }, (error) => {
      console.error("Erro ao buscar itens:", error);
      toast({ title: "Erro ao carregar itens", variant: "destructive" });
      itemsLoaded = true;
      checkDoneLoading();
    });

    const configsQuery = query(collection(firestore, "stockConfigs"));
    const unsubscribeConfigs = onSnapshot(configsQuery, (snapshot) => {
      // Filtramos aqui para pegar apenas configs do armazém central ou configs que tenham itemId
      // Na verdade, a lógica de combinação usará todas as configs e fará a correspondência
      setFirestoreStockConfigs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FirestoreStockConfig)));
      configsLoaded = true;
      checkDoneLoading();
    }, (error) => {
      console.error("Erro ao buscar configs de estoque:", error);
      toast({ title: "Erro ao carregar configs de estoque", variant: "destructive" });
      configsLoaded = true;
      checkDoneLoading();
    });

    return () => {
      unsubscribeItems();
      unsubscribeConfigs();
    };
  }, [toast]);

  useEffect(() => {
    if (firestoreItems.length > 0 || (firestoreItems.length === 0 && firestoreStockConfigs.length >=0 && !isLoading)) {
      setIsLoading(true); // Para fase de processamento
      const processed: LowStockReportItem[] = firestoreItems.map(item => {
        const centralConfigId = `${item.id}_central`;
        const config = firestoreStockConfigs.find(sc => sc.id === centralConfigId);

        let statusLabel: LowStockReportItem['statusLabel'] = 'Não Configurado';
        let statusVariant: LowStockReportItem['statusVariant'] = 'outline';
        const currentQuantity = item.currentQuantityCentral;
        const strategicLvl = config?.strategicStockLevel;
        const minQtyConfig = config?.minQuantity;
        // effectiveMinQuantity usa o minQuantity da config se existir, senão o minQuantity do item (do catálogo)
        const effectiveMinQuantity = minQtyConfig ?? item.minQuantity;


        if (config) { // Se existe uma configuração para o armazém central
          statusLabel = 'Ótimo'; // Default
          statusVariant = 'default';
          if (currentQuantity < effectiveMinQuantity) {
            statusLabel = 'Baixo'; // Abaixo do mínimo (configurado ou do item)
            statusVariant = 'secondary';
          } else if (strategicLvl !== undefined && currentQuantity < strategicLvl) {
            statusLabel = 'Alerta'; // Abaixo do estratégico, mas acima ou igual ao mínimo
            statusVariant = 'destructive';
          }
        }

        return {
          ...item,
          strategicStockLevel: strategicLvl,
          effectiveMinQuantity: effectiveMinQuantity,
          statusLabel,
          statusVariant,
        };
      });
      setProcessedReportItems(processed.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setIsLoading(false);
    } else if (!isLoading && firestoreItems.length === 0) {
        // Se não há itens, não há o que processar.
        setProcessedReportItems([]);
        setIsLoading(false);
    }

  }, [firestoreItems, firestoreStockConfigs, isLoading]);

  // Efeito para atualizar o relatório quando os filtros ou os itens processados mudam
  useEffect(() => {
    if (!isLoading) {
      onSubmit(form.getValues());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedReportItems, form.watch('status'), form.watch('itemId'), isLoading]);


  const onSubmit = (filters: ReportFiltersFormData) => {
    console.log("Gerando relatório de níveis de estoque baixos/alerta com filtros:", filters);
    if (isLoading) return; // Não gerar se ainda estiver carregando dados primários

    const filtered = processedReportItems.filter(item => {
      const itemMatch = filters.itemId === 'all' || !filters.itemId || item.id === filters.itemId;
      const statusMatch = filters.status === 'all' ||
                         (filters.status === 'low' && item.statusLabel === 'Baixo') ||
                         (filters.status === 'alert' && item.statusLabel === 'Alerta') ||
                         (filters.status === 'not_configured' && item.statusLabel === 'Não Configurado');
      return itemMatch && statusMatch;
    });
    setReportData(filtered);
  };
  
  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    if (reportData.length === 0) return;
    const csvString = convertToCSV(reportData);
    downloadCSV(csvString, 'relatorio_niveis_estoque_baixos.csv');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatório de Níveis de Estoque (Armazém Central)"
        description="Identifique itens no Armazém Central que necessitam de atenção devido a níveis de estoque baixos ou em alerta, ou que não estão configurados."
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
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="itemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1"><PackageIcon className="h-4 w-4 text-muted-foreground" />Item</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || 'all'}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Todos os Itens" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="all">Todos os Itens</SelectItem>
                        {firestoreItems.map(item => <SelectItem key={item.id} value={item.id}>{item.name} ({item.code})</SelectItem>)}
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
                    <FormLabel>Status do Estoque (Armazém Central)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || 'all'}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="all">Todos os Status</SelectItem>
                        <SelectItem value="low">Apenas Baixo (Abaixo do Mínimo)</SelectItem>
                        <SelectItem value="alert">Apenas Alerta (Abaixo do Estratégico)</SelectItem>
                        <SelectItem value="not_configured">Apenas Não Configurado</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando...</>) : "Atualizar Relatório"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
      
      {isLoading && reportData.length === 0 ? (
         <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-3 text-muted-foreground">Carregando dados do relatório...</p>
        </div>
      ) : reportData.length > 0 ? (
        <Card className="shadow-lg mt-6 printable-content">
          <CardHeader>
            <CardTitle className="font-headline">Itens com Nível de Estoque Baixo, em Alerta ou Não Configurado (Armazém Central)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead className="text-right">Qtde. Atual</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead className="text-right">Estratégico</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.map((item) => (
                  <TableRow key={item.id} className={item.statusVariant === 'destructive' ? 'bg-red-500/5' : item.statusVariant === 'secondary' ? 'bg-yellow-500/5' : ''}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.code}</TableCell>
                    <TableCell className="text-right">{item.currentQuantityCentral}</TableCell>
                    <TableCell className="text-right">{item.effectiveMinQuantity ?? 'N/A'}</TableCell>
                    <TableCell className="text-right">{item.strategicStockLevel ?? 'N/A'}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={item.statusVariant}>{item.statusLabel}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
         <Card className="mt-6 shadow-lg">
          <CardContent className="pt-6 flex flex-col items-center justify-center text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
            <p className="text-lg font-semibold">Nenhum item em alerta, baixo ou não configurado encontrado.</p>
            <p className="text-sm text-muted-foreground">Todos os níveis de estoque no Armazém Central estão adequados para os filtros selecionados, ou não há itens para exibir.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
    
