
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
import { History, CalendarIcon, Filter, Printer } from 'lucide-react';
import type { Item, ServedUnit, Hospital, Patient, StockMovement } from '@/types';
import { mockItems, mockServedUnits, mockHospitals, mockPatients, mockStockMovements } from '@/data/mockData';
import { format, parseISO } from 'date-fns';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

const reportFiltersSchema = z.object({
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  itemId: z.string().optional(),
  hospitalId: z.string().optional(),
  unitId: z.string().optional(),
  patientId: z.string().optional(),
}).refine(data => !data.startDate || !data.endDate || data.endDate >= data.startDate, {
  message: "Data final deve ser igual ou posterior à data inicial.",
  path: ["endDate"],
});

type ReportFiltersFormData = z.infer<typeof reportFiltersSchema>;

interface ConsumptionHistoryData extends StockMovement {
  itemName: string;
  itemCode: string;
  patientName?: string;
}

export default function ConsumptionHistoryReportPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [reportData, setReportData] = useState<ConsumptionHistoryData[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const form = useForm<ReportFiltersFormData>({
    resolver: zodResolver(reportFiltersSchema),
    defaultValues: {
      itemId: 'all',
      hospitalId: 'all',
      unitId: 'all',
      patientId: 'all',
    },
  });
  
  const selectedHospitalId = form.watch('hospitalId');

  useEffect(() => {
    setItems(mockItems);
    setServedUnits(mockServedUnits);
    setHospitals(mockHospitals);
    setPatients(mockPatients);
  }, []);

  useEffect(() => {
    form.setValue('unitId', 'all');
  }, [selectedHospitalId, form]);

  const availableUnits = selectedHospitalId && selectedHospitalId !== 'all'
    ? servedUnits.filter(unit => unit.hospitalId === selectedHospitalId)
    : servedUnits;
  
  const onSubmit = (filters: ReportFiltersFormData) => {
    setIsGenerating(true);
    console.log("Gerando histórico de consumo com filtros:", filters);

    const filteredMovements = mockStockMovements.filter(m => {
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
      if (filters.patientId && filters.patientId !== 'all' && m.patientId !== filters.patientId) return false;
      return true;
    }).map(m => {
      const itemDetail = items.find(i => i.id === m.itemId);
      const patientDetail = patients.find(p => p.id === m.patientId);
      return {
        ...m,
        itemName: itemDetail?.name || 'Desconhecido',
        itemCode: itemDetail?.code || 'N/A',
        patientName: patientDetail?.name,
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
        title="Histórico Detalhado de Consumo"
        description="Consulte um log detalhado de todas as movimentações de consumo de itens."
        icon={History}
        actions={<Button onClick={handlePrint} variant="outline"><Printer className="mr-2 h-4 w-4" /> Imprimir</Button>}
        className="no-print"
      />

      <Card className="shadow-lg no-print">
        <CardHeader>
          <CardTitle className="font-headline flex items-center gap-2"><Filter className="h-5 w-5 text-primary"/> Filtros do Relatório</CardTitle>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
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
                            {field.value ? format(field.value, "dd/MM/yyyy") : <span>Selecione</span>}
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
                            {field.value ? format(field.value, "dd/MM/yyyy") : <span>Selecione</span>}
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
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="all">Todos os Itens</SelectItem>
                        {items.map(item => <SelectItem key={item.id} value={item.id}>{item.name} ({item.code})</SelectItem>)}
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
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="all">Todos os Hospitais</SelectItem>
                        {hospitals.map(hospital => <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>)}
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
                    <Select onValueChange={field.onChange} value={field.value || 'all'} disabled={!selectedHospitalId || selectedHospitalId === 'all' && availableUnits.length === mockServedUnits.length && availableUnits.length === 0}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="all">Todas as Unidades</SelectItem>
                        {availableUnits.map(unit => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="patientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Paciente</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="all">Todos os Pacientes</SelectItem>
                        {patients.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
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
            <CardTitle className="font-headline">Histórico Detalhado de Consumo</CardTitle>
             <CardDescription>
              Período: {form.getValues("startDate") ? format(form.getValues("startDate")!, 'dd/MM/yy') : 'N/A'} a {form.getValues("endDate") ? format(form.getValues("endDate")!, 'dd/MM/yy') : 'N/A'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead className="text-right">Qtd.</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Hospital</TableHead>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Observações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.map((data) => (
                  <TableRow key={data.id}>
                    <TableCell>{format(parseISO(data.date), 'dd/MM/yyyy HH:mm')}</TableCell>
                    <TableCell className="font-medium">{data.itemName}</TableCell>
                    <TableCell>{data.itemCode}</TableCell>
                    <TableCell className="text-right">{data.quantity}</TableCell>
                    <TableCell>{data.unitName || '-'}</TableCell>
                    <TableCell>{data.hospitalName || '-'}</TableCell>
                    <TableCell>{data.patientName || '-'}</TableCell>
                    <TableCell>{data.notes || '-'}</TableCell>
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
            <p className="text-center text-muted-foreground">Nenhum histórico de consumo encontrado para os filtros selecionados.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
