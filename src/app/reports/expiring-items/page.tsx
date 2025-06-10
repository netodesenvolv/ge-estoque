
'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { CalendarClock, Filter, Printer, AlertTriangle } from 'lucide-react';
import type { Item } from '@/types';
import { mockItems } from '@/data/mockData';
import { format, parseISO, differenceInDays, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Badge } from '@/components/ui/badge';

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

export default function ExpiringItemsReportPage() {
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [reportData, setReportData] = useState<ExpiringItemReportData[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const form = useForm<ReportFiltersFormData>({
    resolver: zodResolver(reportFiltersSchema),
    defaultValues: {
      daysThreshold: 30,
      showExpired: true,
      showNearExpiration: true,
    },
  });

  useEffect(() => {
    setAllItems(mockItems);
    // Auto-generate report on initial load with default filters
    onSubmit(form.getValues());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // form.getValues is stable

  const onSubmit = (filters: ReportFiltersFormData) => {
    setIsGenerating(true);
    console.log("Gerando relatório de itens a vencer com filtros:", filters);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const processedItems = allItems
      .map(item => {
        if (!item.expirationDate) {
          return { ...item, daysToExpire: null, status: 'Válido' as const };
        }
        const expDate = parseISO(item.expirationDate);
        if (!isValid(expDate)) {
            return { ...item, daysToExpire: null, status: 'Válido' as const }; // Treat invalid dates as non-expiring for this report
        }
        const diff = differenceInDays(expDate, today);
        let status: ExpiringItemReportData['status'] = 'Válido';
        if (diff < 0) {
          status = 'Vencido';
        } else if (diff <= (filters.daysThreshold || 30)) {
          status = 'Próximo do Vencimento';
        }
        return { ...item, daysToExpire: diff, status };
      })
      .filter(item => {
        if (!item.expirationDate) return false; // Only show items with expiration dates
        if (item.status === 'Vencido' && filters.showExpired) return true;
        if (item.status === 'Próximo do Vencimento' && filters.showNearExpiration) return true;
        return false; // Default to not showing 'Válido' items unless explicitly requested by other filters
      })
      .sort((a, b) => (a.daysToExpire ?? Infinity) - (b.daysToExpire ?? Infinity));
    
    setReportData(processedItems);
    setIsGenerating(false);
  };
  
  const handlePrint = () => {
    window.print();
  };
  
  const getStatusBadgeVariant = (status: ExpiringItemReportData['status']): "destructive" | "secondary" | "default" => {
    if (status === 'Vencido') return 'destructive';
    if (status === 'Próximo do Vencimento') return 'secondary';
    return 'default';
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatório de Itens a Vencer (Estoque Central)"
        description="Identifique itens no estoque central próximos da validade ou já vencidos."
        icon={CalendarClock}
        actions={<Button onClick={handlePrint} variant="outline"><Printer className="mr-2 h-4 w-4" /> Imprimir</Button>}
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
              <Button type="submit" disabled={isGenerating}>
                {isGenerating ? "Gerando..." : "Atualizar Relatório"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

       <Alert variant="default" className="mt-4 no-print bg-blue-500/10 border-blue-500/50 text-blue-700">
        <AlertTriangle className="h-4 w-4 !text-blue-700" />
        <AlertTitle>Nota sobre o Relatório</AlertTitle>
        <AlertDescription>
          Este relatório exibe itens do catálogo e suas respectivas datas de validade e quantidades no <strong>Armazém Central</strong>.
          A rastreabilidade de lotes e validades específicas em unidades servidas individuais não está detalhada neste relatório.
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
                    <TableCell className="text-right">{item.currentQuantityCentral}</TableCell>
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
