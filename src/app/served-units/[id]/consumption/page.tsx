
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { TrendingDown, CheckCircle, User } from 'lucide-react';
import type { Item, ServedUnit, Hospital, Patient } from '@/types';
import { mockItems, mockServedUnits, mockHospitals, mockPatients } from '@/data/mockData';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useParams, useRouter } from 'next/navigation';

const consumptionSchema = z.object({
  itemId: z.string().min(1, "A seleção do item é obrigatória."),
  quantityConsumed: z.coerce.number().positive("A quantidade deve ser um número positivo."),
  date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Data inválida." }),
  patientId: z.string().optional(),
});

type ConsumptionFormData = z.infer<typeof consumptionSchema>;

const NO_PATIENT_ID = "__NO_PATIENT__";

export default function RecordConsumptionPage() {
  const params = useParams();
  const unitId = params.id as string;
  const [items, setItems] = useState<Item[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [servedUnit, setServedUnit] = useState<ServedUnit | null>(null);
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    setItems(mockItems);
    setPatients(mockPatients);
    const unit = mockServedUnits.find(u => u.id === unitId);
    setServedUnit(unit || null);
    if (unit) {
      const hosp = mockHospitals.find(h => h.id === unit.hospitalId);
      setHospital(hosp || null);
    }
  }, [unitId]);

  const form = useForm<ConsumptionFormData>({
    resolver: zodResolver(consumptionSchema),
    defaultValues: {
      quantityConsumed: 1,
      date: new Date().toISOString().split('T')[0],
      patientId: undefined, // Changed from ''
    },
  });

  const onSubmit = (data: ConsumptionFormData) => {
    const patient = data.patientId ? patients.find(p => p.id === data.patientId) : null;
    let description = `${data.quantityConsumed} unidade(s) do item ID ${data.itemId} consumido(s) em ${servedUnit?.name} (${hospital?.name}).`;
    if (patient) {
      description += ` Paciente: ${patient.name}.`;
    }

    console.log('Consumo de estoque submetido:', { ...data, servedUnitId: unitId, hospitalId: servedUnit?.hospitalId });
    toast({
      title: "Consumo Registrado",
      description: description,
      action: <CheckCircle className="text-green-500" />,
    });
    form.reset({
        quantityConsumed: 1,
        date: new Date().toISOString().split('T')[0],
        itemId: '',
        patientId: undefined, // Changed from ''
    });
  };

  if (!servedUnit || !hospital) {
    return <PageHeader title="Erro" description="Unidade servida ou hospital não encontrado." />;
  }

  const isUBS = hospital?.name.toLowerCase().includes('ubs');


  return (
    <div className="container mx-auto py-2 max-w-md">
      <PageHeader
        title={`Registrar Consumo`}
        description={`Unidade: ${servedUnit.name} (${servedUnit.location}) - ${hospital.name}`}
        icon={TrendingDown}
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline text-xl">Registrar Consumo de Item</CardTitle>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="itemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item Consumido</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um item" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {items.map(item => (
                          <SelectItem key={item.id} value={item.id}>{item.name} ({item.code})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="quantityConsumed"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantidade Consumida</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="ex: 1" {...field} min="1"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data do Consumo</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {isUBS && (
                 <FormField
                  control={form.control}
                  name="patientId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1">
                        <User className="h-4 w-4 text-muted-foreground"/> Paciente (Opcional para UBS)
                      </FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(value === NO_PATIENT_ID ? undefined : value)}
                        value={field.value || NO_PATIENT_ID}
                        defaultValue={field.value || NO_PATIENT_ID}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione um paciente (se aplicável)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={NO_PATIENT_ID}>Nenhum paciente específico</SelectItem>
                          {patients.map(patient => (
                            <SelectItem key={patient.id} value={patient.id}>{patient.name} - SUS: {patient.susCardNumber}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Selecione o paciente se o consumo for individualizado.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full">Registrar Consumo</Button>
              <Button type="button" variant="outline" onClick={() => router.back()} className="w-full">
                Voltar
            </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
