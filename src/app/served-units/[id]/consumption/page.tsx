
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { TrendingDown, CheckCircle } from 'lucide-react';
import type { Item, ServedUnit, Hospital } from '@/types';
import { mockItems, mockServedUnits, mockHospitals } from '@/data/mockData';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useParams, useRouter } from 'next/navigation';

const consumptionSchema = z.object({
  itemId: z.string().min(1, "A seleção do item é obrigatória."),
  quantityConsumed: z.coerce.number().positive("A quantidade deve ser um número positivo."),
  date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Data inválida." }),
});

type ConsumptionFormData = z.infer<typeof consumptionSchema>;

export default function RecordConsumptionPage() {
  const params = useParams();
  const unitId = params.id as string;
  const [items, setItems] = useState<Item[]>([]);
  const [servedUnit, setServedUnit] = useState<ServedUnit | null>(null);
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    setItems(mockItems);
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
    },
  });

  const onSubmit = (data: ConsumptionFormData) => {
    console.log('Consumo de estoque submetido:', { ...data, servedUnitId: unitId, hospitalId: servedUnit?.hospitalId });
    toast({
      title: "Consumo Registrado",
      description: `${data.quantityConsumed} unidade(s) do item ID ${data.itemId} consumido(s) em ${servedUnit?.name} (${hospital?.name}).`,
      action: <CheckCircle className="text-green-500" />,
    });
    form.reset({ 
        quantityConsumed: 1, 
        date: new Date().toISOString().split('T')[0],
        itemId: '' 
    });
  };

  if (!servedUnit || !hospital) {
    return <PageHeader title="Erro" description="Unidade servida ou hospital não encontrado." />;
  }

  return (
    <div className="container mx-auto py-2 max-w-md">
      <PageHeader 
        title={`Registrar Consumo`} 
        description={`Unidade: ${servedUnit.name} (${servedUnit.location}) - Hospital: ${hospital.name}`} 
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
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                      <Input type="number" placeholder="ex: 1" {...field} />
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

