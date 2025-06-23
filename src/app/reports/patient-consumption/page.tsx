
'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { UserCheck, CalendarIcon, Filter, Printer, Download, Search, X, Loader2 } from 'lucide-react';
import type { Patient, StockMovement, Item } from '@/types';
import { format, parseISO } from 'date-fns';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { firestore } from '@/lib/firebase';
import { collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

const reportFiltersSchema = z.object({
  startDate: z.date().optional(),
  endDate: z.date().optional(),
}).refine(data => !data.startDate || !data.endDate || data.endDate >= data.startDate, {
  message: "Data final deve ser igual ou posterior à data inicial.",
  path: ["endDate"],
});

type ReportFiltersFormData = z.infer<typeof reportFiltersSchema>;

interface PatientConsumptionReportData extends StockMovement {
  itemName: string;
  itemCode: string;
}

const escapeCsvValue = (value: any): string => {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const convertToCSV = (data: PatientConsumptionReportData[]): string => {
  const headers = [
    { key: 'date', label: 'Data' },
    { key: 'itemName', label: 'Item Consumido' },
    { key: 'itemCode', label: 'Código' },
    { key: 'quantity', label: 'Quantidade' },
    { key: 'unitName', label: 'Unidade' },
    { key: 'hospitalName', label: 'Hospital' },
  ];
  const headerRow = headers.map(h => h.label).join(',');
  const dataRows = data.map(row =>
    headers.map(header => {
      if (header.key === 'date') return escapeCsvValue(format(parseISO(row.date), 'yyyy-MM-dd'));
      return escapeCsvValue(row[header.key as keyof PatientConsumptionReportData]);
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

export default function PatientConsumptionReportPage() {
  const { toast } = useToast();
  
  // Master data state
  const [items, setItems] = useState<Item[]>([]);
  
  // Search and selection state
  const [patientSearchTerm, setPatientSearchTerm] = useState('');
  const [patientSearchResults, setPatientSearchResults] = useState<Patient[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  
  // Report state
  const [reportData, setReportData] = useState<PatientConsumptionReportData[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const form = useForm<ReportFiltersFormData>({
    resolver: zodResolver(reportFiltersSchema),
  });

  useEffect(() => {
    // Fetch items once on mount for enriching the report data
    const itemsQuery = query(collection(firestore, "items"), orderBy("name"));
    getDocs(itemsQuery)
      .then(snapshot => setItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item))))
      .catch(error => {
        console.error("Erro ao buscar itens: ", error);
        toast({ title: "Erro ao Carregar Itens", variant: "destructive" });
      });
  }, [toast]);

  const handlePatientSearch = async () => {
    if (patientSearchTerm.trim().length < 3) {
      toast({ title: "Busca Inválida", description: "Por favor, digite pelo menos 3 caracteres para buscar." });
      return;
    }
    setIsSearching(true);
    setPatientSearchResults([]);

    try {
      const patientsRef = collection(firestore, "patients");
      const queries = [];

      // Query for exact SUS card number match (if it's a number)
      if (/^\d+$/.test(patientSearchTerm)) {
        queries.push(getDocs(query(patientsRef, where("susCardNumber", "==", patientSearchTerm))));
      }

      // Query for name starts-with
      const nameQuery = query(
        patientsRef,
        where("name", ">=", patientSearchTerm.toUpperCase()),
        where("name", "<=", patientSearchTerm.toUpperCase() + '\uf8ff'),
        limit(10)
      );
      queries.push(getDocs(nameQuery));

      const snapshots = await Promise.all(queries);
      const results: { [id: string]: Patient } = {};
      
      snapshots.forEach(snapshot => {
        snapshot.docs.forEach(doc => {
          results[doc.id] = { id: doc.id, ...doc.data() } as Patient;
        });
      });
      
      const uniqueResults = Object.values(results);
      setPatientSearchResults(uniqueResults);
      if (uniqueResults.length === 0) {
        toast({ title: "Nenhum Paciente Encontrado", description: "Verifique os termos de busca e tente novamente." });
      }

    } catch (error) {
      console.error("Erro ao buscar pacientes: ", error);
      toast({ title: "Erro na Busca", description: "Não foi possível realizar a busca por pacientes.", variant: "destructive" });
    } finally {
      setIsSearching(false);
    }
  };
  
  const handleSelectPatient = (patient: Patient) => {
    setSelectedPatient(patient);
    setPatientSearchTerm(patient.name); // Display name in input
    setPatientSearchResults([]); // Hide search results
    setReportData([]); // Clear previous report
  };
  
  const handleClearSelection = () => {
    setSelectedPatient(null);
    setPatientSearchTerm('');
    setReportData([]);
  };

  const onSubmit = async (filters: ReportFiltersFormData) => {
    if (!selectedPatient) {
      toast({ title: "Paciente não selecionado", description: "Por favor, busque e selecione um paciente primeiro." });
      return;
    }
    setIsGenerating(true);
    
    try {
      let movementsQuery = query(
        collection(firestore, "stockMovements"),
        where("patientId", "==", selectedPatient.id),
        orderBy("date", "desc")
      );
      
      const docsSnap = await getDocs(movementsQuery);
      let movements = docsSnap.docs.map(doc => doc.data() as StockMovement);

      // Client-side date filtering
      if (filters.startDate) {
        movements = movements.filter(m => parseISO(m.date) >= filters.startDate!);
      }
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        movements = movements.filter(m => parseISO(m.date) <= endDate);
      }
      
      const enrichedData = movements.map(m => {
        const itemDetail = items.find(i => i.id === m.itemId);
        return {
          ...m,
          itemName: itemDetail?.name || 'Item Desconhecido',
          itemCode: itemDetail?.code || 'N/A',
        };
      });

      setReportData(enrichedData);
      
    } catch (error) {
       console.error("Erro ao gerar relatório: ", error);
       toast({ title: "Erro ao Gerar Relatório", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePrint = () => window.print();

  const handleExportCSV = () => {
    if (reportData.length === 0 || !selectedPatient) return;
    const csvString = convertToCSV(reportData);
    downloadCSV(csvString, `relatorio_consumo_${selectedPatient.name.replace(/\s+/g, '_').toLowerCase()}.csv`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatório de Consumo por Paciente"
        description="Busque por um paciente para detalhar seu consumo de itens."
        icon={UserCheck}
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
          <CardDescription>Primeiro, busque e selecione um paciente. Depois, defina o período e gere o relatório.</CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <FormLabel>Buscar Paciente</FormLabel>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Digite o nome ou nº do Cartão SUS"
                    value={patientSearchTerm}
                    onChange={(e) => setPatientSearchTerm(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handlePatientSearch()}
                    disabled={!!selectedPatient}
                  />
                  {!selectedPatient ? (
                    <Button type="button" onClick={handlePatientSearch} disabled={isSearching}>
                      {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      <span className="ml-2 hidden sm:inline">Buscar</span>
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" onClick={handleClearSelection}>
                      <X className="h-4 w-4" /><span className="ml-2 hidden sm:inline">Limpar</span>
                    </Button>
                  )}
                </div>
                {patientSearchResults.length > 0 && (
                  <Card className="mt-2 p-2 max-h-48 overflow-y-auto">
                    <ul className="space-y-1">
                      {patientSearchResults.map(p => (
                        <li key={p.id} onClick={() => handleSelectPatient(p)}
                            className="p-2 rounded-md hover:bg-accent cursor-pointer text-sm">
                          <p className="font-semibold">{p.name}</p>
                          <p className="text-muted-foreground">SUS: {p.susCardNumber}</p>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField control={form.control} name="startDate" render={({ field }) => (
                  <FormItem className="flex flex-col"><FormLabel>Data Inicial</FormLabel><Popover><PopoverTrigger asChild><FormControl>
                    <Button variant="outline" className="font-normal justify-start">{field.value ? format(field.value, "dd/MM/yyyy") : <span>Selecione</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button>
                  </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover><FormMessage /></FormItem>
                )}/>
                <FormField control={form.control} name="endDate" render={({ field }) => (
                  <FormItem className="flex flex-col"><FormLabel>Data Final</FormLabel><Popover><PopoverTrigger asChild><FormControl>
                    <Button variant="outline" className="font-normal justify-start">{field.value ? format(field.value, "dd/MM/yyyy") : <span>Selecione</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button>
                  </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus disabled={(date) => form.getValues("startDate") ? date < form.getValues("startDate")! : false }/></PopoverContent></Popover><FormMessage /></FormItem>
                )}/>
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={!selectedPatient || isGenerating}>
                {isGenerating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Gerar Relatório
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

      {reportData.length > 0 && selectedPatient && (
        <Card className="shadow-lg mt-6 printable-content">
          <CardHeader>
            <CardTitle className="font-headline">Consumo de Itens para: {selectedPatient.name}</CardTitle>
            <CardDescription>
              Período: {form.getValues("startDate") ? format(form.getValues("startDate")!, 'dd/MM/yy') : 'N/A'} a {form.getValues("endDate") ? format(form.getValues("endDate")!, 'dd/MM/yy') : 'Hoje'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Item Consumido</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                  <TableHead>Unidade (Hospital)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.map((data, index) => (
                  <TableRow key={data.id || index}>
                    <TableCell>{format(parseISO(data.date), 'dd/MM/yyyy')}</TableCell>
                    <TableCell className="font-medium">{data.itemName}</TableCell>
                    <TableCell>{data.itemCode}</TableCell>
                    <TableCell className="text-right">{data.quantity}</TableCell>
                    <TableCell>{data.unitName} ({data.hospitalName || 'N/A'})</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {form.formState.isSubmitted && reportData.length === 0 && selectedPatient && !isGenerating && (
         <Card className="mt-6 shadow-lg">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Nenhum dado de consumo encontrado para este paciente nos filtros selecionados.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

    