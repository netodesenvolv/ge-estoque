
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
import { UserCheck, CalendarIcon, Filter, Printer } from 'lucide-react';
import type { Patient, StockMovement, Item } from '@/types';
import { mockPatients, mockStockMovements, mockItems } from '@/data/mockData';
import { format, parseISO } from 'date-fns';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

const reportFiltersSchema = z.object({
  patientId: z.string().min(1, "Selecione um paciente."),
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

export default function PatientConsumptionReportPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [reportData, setReportData] = useState<PatientConsumptionReportData[]>([]);
  const [selectedPatientName, setSelectedPatientName] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);

  const form = useForm<ReportFiltersFormData>({
    resolver: zodResolver(reportFiltersSchema),
  });

  useEffect(() => {
    setPatients(mockPatients);
    setItems(mockItems);
  }, []);

  const onSubmit = (filters: ReportFiltersFormData) => {
    setIsGenerating(true);
    console.log("Gerando relatório de consumo por paciente com filtros:", filters);
    const patient = patients.find(p => p.id === filters.patientId);
    setSelectedPatientName(patient?.name || 'Desconhecido');

    const filteredMovements = mockStockMovements.filter(m => {
      if (m.type !== 'consumption' || m.patientId !== filters.patientId) return false;
      if (filters.startDate && parseISO(m.date) < filters.startDate) return false;
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999); 
        if (parseISO(m.date) > endDate) return false;
      }
      return true;
    }).map(m => {
      const itemDetail = items.find(i => i.id === m.itemId);
      return {
        ...m,
        itemName: itemDetail?.name || 'Item Desconhecido',
        itemCode: itemDetail?.code || 'N/A',
      };
    }).sort((a,b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());
    
    setReportData(filteredMovements);
    setIsGenerating(false);
  };
  
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatório de Consumo por Paciente"
        description="Detalhe o consumo de itens para um paciente específico."
        icon={UserCheck}
        actions={<Button onClick={handlePrint} variant="outline"><Printer className="mr-2 h-4 w-4" /> Imprimir</Button>}
        className="no-print"
      />

      <Card className="shadow-lg no-print">
        <CardHeader>
          <CardTitle className="font-headline flex items-center gap-2"><Filter className="h-5 w-5 text-primary"/> Filtros do Relatório</CardTitle>
          <CardDescription>Selecione o paciente e o período para gerar o relatório.</CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <FormField
                control={form.control}
                name="patientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Paciente</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecione um paciente" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {patients.map(p => <SelectItem key={p.id} value={p.id}>{p.name} (SUS: {p.susCardNumber})</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Data Inicial</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button variant="outline" className="font-normal justify-start">
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
                          <Button variant="outline" className="font-normal justify-start">
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
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={isGenerating}>
                {isGenerating ? "Gerando..." : "Gerar Relatório"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

      {reportData.length > 0 && (
        <Card className="shadow-lg mt-6 printable-content">
          <CardHeader>
            <CardTitle className="font-headline">Consumo de Itens para: {selectedPatientName}</CardTitle>
            <CardDescription>
              Período: {form.getValues("startDate") ? format(form.getValues("startDate")!, 'dd/MM/yy') : 'N/A'} a {form.getValues("endDate") ? format(form.getValues("endDate")!, 'dd/MM/yy') : 'N/A'}
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
                {reportData.map((data) => (
                  <TableRow key={data.id}>
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
      {!isGenerating && form.formState.isSubmitted && reportData.length === 0 && (
         <Card className="mt-6 shadow-lg">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Nenhum dado de consumo encontrado para este paciente nos filtros selecionados.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

