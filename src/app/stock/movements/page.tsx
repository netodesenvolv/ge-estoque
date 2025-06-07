'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ArrowRightLeft } from 'lucide-react';
import type { Item, ServedUnit, StockMovementType } from '@/types';
import { mockItems, mockServedUnits } from '@/data/mockData';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';

const movementSchema = z.object({
  itemId: z.string().min(1, "A seleção do item é obrigatória."),
  type: z.enum(['entry', 'exit', 'consumption'], { required_error: "O tipo de movimentação é obrigatório." }),
  quantity: z.coerce.number().positive("A quantidade deve ser um número positivo."),
  unitId: z.string().optional(), 
  date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Data inválida." }),
  notes: z.string().optional(),
});

type MovementFormData = z.infer<typeof movementSchema>;

export default function StockMovementsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    setItems(mockItems);
    setServedUnits(mockServedUnits);
  }, []);

  const form = useForm<MovementFormData>({
    resolver: zodResolver(movementSchema),
    defaultValues: {
      type: 'entry',
      quantity: 1,
      date: new Date().toISOString().split('T')[0], 
      notes: '',
    },
  });

  const movementType = form.watch('type');

  const onSubmit = (data: MovementFormData) => {
    console.log('Movimentação de estoque submetida:', data);
    toast({
      title: "Movimentação de Estoque Registrada",
      description: `Movimentação de ${data.quantity} unidade(s) do item ID ${data.itemId} foi registrada como ${data.type}.`,
    });
    form.reset();
  };

  return (
    <div>
      <PageHeader title="Registrar Movimentação de Estoque" description="Registre entradas, saídas ou consumos de itens de estoque." icon={ArrowRightLeft} />
      <Card className="max-w-2xl mx-auto shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Nova Movimentação de Estoque</CardTitle>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Tipo de Movimentação</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex flex-col space-y-1 md:flex-row md:space-y-0 md:space-x-4"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="entry" />
                          </FormControl>
                          <FormLabel className="font-normal">Entrada de Estoque</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="exit" />
                          </FormControl>
                          <FormLabel className="font-normal">Saída de Estoque (Transferência)</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="consumption" />
                          </FormControl>
                          <FormLabel className="font-normal">Consumo</FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
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
              
              {(movementType === 'exit' || movementType === 'consumption') && (
                 <FormField
                    control={form.control}
                    name="unitId"
                    render={({ field }) => (
                    <FormItem>
                        <FormLabel>
                        {movementType === 'exit' ? 'Unidade de Destino (Opcional - para saída de transferência do Armazém Central)' : 'Consumido Em (Unidade Servida)'}
                        </FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                            <SelectTrigger>
                            <SelectValue placeholder={movementType === 'exit' ? "Selecione o destino ou deixe em branco para saída do Armazém Central" : "Selecione a unidade servida"} />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            <SelectItem value="">Armazém Central (se aplicável para saída)</SelectItem>
                            {servedUnits.map(unit => (
                            <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>
                            ))}
                        </SelectContent>
                        </Select>
                        <FormDescription>
                          {movementType === 'exit' && "Se estiver transferindo do Armazém Central para uma unidade servida, selecione a unidade. Se for apenas reduzir o estoque Central, deixe em branco."}
                          {movementType === 'consumption' && "Selecione a unidade onde o item foi consumido."}
                        </FormDescription>
                        <FormMessage />
                    </FormItem>
                    )}
                />
              )}

              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantidade</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="ex: 10" {...field} />
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
                    <FormLabel>Data da Movimentação</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Observações (Opcional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="ex: Motivo da movimentação, número do lote" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex justify-end">
              <Button type="submit">Registrar Movimentação</Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
