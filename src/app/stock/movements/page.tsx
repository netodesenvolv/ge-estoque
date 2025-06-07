
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { ArrowRightLeft } from 'lucide-react';
import type { Item, ServedUnit, Hospital } from '@/types';
import { mockItems, mockServedUnits, mockHospitals } from '@/data/mockData';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

const movementSchema = z.object({
  itemId: z.string().min(1, "A seleção do item é obrigatória."),
  type: z.enum(['entry', 'exit', 'consumption'], { required_error: "O tipo de movimentação é obrigatório." }),
  quantity: z.coerce.number().positive("A quantidade deve ser um número positivo."),
  hospitalId: z.string().optional(), // Obrigatório para 'exit' e 'consumption' se não for Armazém Central
  unitId: z.string().optional(), // Obrigatório para 'exit' e 'consumption' se hospitalId for selecionado
  date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Data inválida." }),
  notes: z.string().optional(),
}).refine(data => {
  if ((data.type === 'exit' || data.type === 'consumption')) {
    // Se for para uma unidade, o hospital é obrigatório
    // Se unitId estiver preenchido, hospitalId também deve estar.
    // Se unitId não estiver preenchido (saída do armazém central sem destino específico), hospitalId pode ser opcional.
    return data.unitId ? !!data.hospitalId : true;
  }
  return true;
}, {
  message: "Para Saída ou Consumo em unidade específica, o Hospital é obrigatório.",
  path: ["hospitalId"],
}).refine(data => {
    if ((data.type === 'exit' || data.type === 'consumption') && data.hospitalId && !data.unitId) {
        // Se hospital é selecionado, mas unidade não (para saída/consumo), isso é um problema
        // A menos que a intenção seja uma saída/consumo "do hospital" em geral, o que não está modelado.
        // Por ora, se tem hospital, deve ter unidade para saída/consumo específico de unidade.
        // Ou, se a saída é do armazém central, não precisa de hospital/unidade.
        return false; 
    }
    if((data.type === 'exit' || data.type === 'consumption') && !data.hospitalId && data.unitId){
        return false; // Não pode ter unidade sem hospital
    }
    return true;
}, {
    message: "Para Saída ou Consumo com Hospital selecionado, a Unidade Servida também deve ser selecionada.",
    path: ["unitId"],
});


type MovementFormData = z.infer<typeof movementSchema>;

export default function StockMovementsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const { toast } = useToast();

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
  const selectedHospitalId = form.watch('hospitalId');

  useEffect(() => {
    setItems(mockItems);
    setServedUnits(mockServedUnits);
    setHospitals(mockHospitals);
  }, []);

  useEffect(() => {
    // Reset unitId if hospitalId changes and it's for exit/consumption
    if (movementType === 'exit' || movementType === 'consumption') {
        form.setValue('unitId', undefined);
    }
  }, [selectedHospitalId, movementType, form]);

  const availableUnits = selectedHospitalId 
    ? servedUnits.filter(unit => unit.hospitalId === selectedHospitalId)
    : [];

  const onSubmit = (data: MovementFormData) => {
    let description = `Movimentação de ${data.quantity} unidade(s) do item ID ${data.itemId} registrada como ${data.type}.`;
    if (data.type !== 'entry') {
        const hospital = hospitals.find(h => h.id === data.hospitalId);
        const unit = servedUnits.find(u => u.id === data.unitId);
        if (unit && hospital) {
            description += ` para ${unit.name} (${hospital.name}).`;
        } else if (hospital) {
             description += ` relacionada ao ${hospital.name} (sem unidade específica).`;
        } else {
            description += ` (Armazém Central).`;
        }
    }

    console.log('Movimentação de estoque submetida:', data);
    toast({
      title: "Movimentação de Estoque Registrada",
      description: description,
    });
    form.reset({
        type: 'entry',
        quantity: 1,
        date: new Date().toISOString().split('T')[0],
        notes: '',
        itemId: undefined,
        hospitalId: undefined,
        unitId: undefined,
    });
  };

  return (
    <div>
      <PageHeader title="Registrar Movimentação de Estoque" description="Registre entradas, saídas ou consumos de itens." icon={ArrowRightLeft} />
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
                        onValueChange={(value) => {
                            field.onChange(value);
                            // Reset hospital and unit if switching to 'entry'
                            if (value === 'entry') {
                                form.setValue('hospitalId', undefined);
                                form.setValue('unitId', undefined);
                            }
                        }}
                        defaultValue={field.value}
                        className="flex flex-col space-y-1 md:flex-row md:space-y-0 md:space-x-4"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl><RadioGroupItem value="entry" /></FormControl>
                          <FormLabel className="font-normal">Entrada (Armazém Central)</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl><RadioGroupItem value="exit" /></FormControl>
                          <FormLabel className="font-normal">Saída (Transferência/Baixa)</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl><RadioGroupItem value="consumption" /></FormControl>
                          <FormLabel className="font-normal">Consumo (Unidade Servida)</FormLabel>
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
                    <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value || ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecione um item" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {items.map(item => <SelectItem key={item.id} value={item.id}>{item.name} ({item.code})</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              {(movementType === 'exit' || movementType === 'consumption') && (
                <>
                  <FormField
                    control={form.control}
                    name="hospitalId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Hospital de Destino/Consumo</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione um hospital" /></SelectTrigger></FormControl>
                          <SelectContent>
                             {movementType === 'exit' && <SelectItem value="">Nenhum (Saída do Armazém Central sem destino específico)</SelectItem>}
                            {hospitals.map(hospital => <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                         <FormDescription>
                            {movementType === 'exit' && "Se for uma baixa direta do Armazém Central, deixe em branco. Para transferir para uma unidade, selecione o hospital."}
                            {movementType === 'consumption' && "Selecione o hospital onde o item foi consumido."}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {selectedHospitalId && (movementType === 'exit' || movementType === 'consumption') && (
                    <FormField
                      control={form.control}
                      name="unitId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Unidade Servida de Destino/Consumo</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""} defaultValue={field.value} disabled={!selectedHospitalId || availableUnits.length === 0}>
                            <FormControl><SelectTrigger>
                                <SelectValue placeholder={availableUnits.length > 0 ? "Selecione uma unidade" : "Nenhuma unidade disponível para este hospital"} />
                            </SelectTrigger></FormControl>
                            <SelectContent>
                              {availableUnits.map(unit => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                           <FormDescription>
                                {movementType === 'exit' && "Unidade para a qual o item está sendo transferido."}
                                {movementType === 'consumption' && "Unidade onde o item foi consumido."}
                           </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </>
              )}

              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantidade</FormLabel>
                    <FormControl><Input type="number" placeholder="ex: 10" {...field} /></FormControl>
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
                    <FormControl><Input type="date" {...field} /></FormControl>
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
                    <FormControl><Textarea placeholder="ex: Motivo da movimentação, número do lote" {...field} /></FormControl>
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
