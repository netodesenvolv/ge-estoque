
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
import { ArrowRightLeft, User } from 'lucide-react';
import type { Item, ServedUnit, Hospital, Patient } from '@/types';
import { mockItems, mockServedUnits, mockHospitals, mockPatients } from '@/data/mockData';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

const movementSchema = z.object({
  itemId: z.string().min(1, "A seleção do item é obrigatória."),
  type: z.enum(['entry', 'exit', 'consumption'], { required_error: "O tipo de movimentação é obrigatório." }),
  quantity: z.coerce.number().positive("A quantidade deve ser um número positivo."),
  hospitalId: z.string().optional(),
  unitId: z.string().optional(),
  patientId: z.string().optional(), // Novo campo
  date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Data inválida." }),
  notes: z.string().optional(),
}).refine(data => {
  if (data.type === 'consumption' && data.unitId && !data.patientId) {
    // Para consumo em unidade, o paciente pode ser obrigatório dependendo da regra de negócio.
    // Aqui, estamos tornando opcional, mas em UBS seria mais comum.
    // Se for uma UBS (identificado pelo nome do hospital/unidade), paciente é mais relevante.
  }
  if ((data.type === 'exit' || data.type === 'consumption')) {
    return data.unitId ? !!data.hospitalId : true;
  }
  return true;
}, {
  message: "Para Saída ou Consumo em unidade específica, o Hospital é obrigatório.",
  path: ["hospitalId"],
}).refine(data => {
    if ((data.type === 'exit' || data.type === 'consumption') && data.hospitalId && !data.unitId) {
        // Não permitiremos mais saída para hospital sem unidade, apenas para unidade ou geral do armazém.
        // Se a intenção for uma baixa genérica de um hospital, isso deve ser feito de outra forma ou não é suportado aqui.
        // Esta validação previne hospitalId sem unitId para exit/consumption.
        // No entanto, uma saída do armazém central (sem hospitalId e sem unitId) é permitida.
        // A regra é: se tem hospitalId, precisa de unitId para exit/consumption.
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
  const [patients, setPatients] = useState<Patient[]>([]); // Novo estado
  const { toast } = useToast();

  const form = useForm<MovementFormData>({
    resolver: zodResolver(movementSchema),
    defaultValues: {
      type: 'entry',
      quantity: 1,
      date: new Date().toISOString().split('T')[0],
      notes: '',
      patientId: '',
    },
  });

  const movementType = form.watch('type');
  const selectedHospitalId = form.watch('hospitalId');
  const selectedUnitId = form.watch('unitId'); // Para verificar se é UBS

  useEffect(() => {
    setItems(mockItems);
    setServedUnits(mockServedUnits);
    setHospitals(mockHospitals);
    setPatients(mockPatients); // Carregar pacientes
  }, []);

  useEffect(() => {
    if (movementType === 'entry') {
        form.setValue('hospitalId', undefined);
        form.setValue('unitId', undefined);
        form.setValue('patientId', undefined);
    } else if (movementType === 'exit') {
        form.setValue('patientId', undefined); // Saída não tem paciente
    }
    // Reset unitId se hospitalId mudar
    form.setValue('unitId', undefined);

  }, [movementType, form]);

   useEffect(() => {
    // Reset unitId if hospitalId changes (para garantir que unitId seja resetado mesmo que não seja explicitamente)
    // E resetar patientId se unitId for resetado ou se o tipo mudar para algo que não seja consumo.
    if (movementType !== 'consumption' || !selectedUnitId) {
        form.setValue('patientId', undefined);
    }
     form.setValue('unitId', undefined, { shouldValidate: true });

  }, [selectedHospitalId, movementType, form]);


  const availableUnits = selectedHospitalId
    ? servedUnits.filter(unit => unit.hospitalId === selectedHospitalId)
    : [];

  const isConsumptionInUBS = () => {
    if (movementType !== 'consumption' || !selectedUnitId) return false;
    const unit = servedUnits.find(u => u.id === selectedUnitId);
    if (!unit) return false;
    const hospital = hospitals.find(h => h.id === unit.hospitalId);
    return hospital?.name.toLowerCase().includes('ubs') || false;
  };


  const onSubmit = (data: MovementFormData) => {
    const item = items.find(i => i.id === data.itemId);
    const patient = data.patientId ? patients.find(p => p.id === data.patientId) : null;

    let description = `Movimentação de ${data.quantity} unidade(s) do item ${item?.name || data.itemId} registrada como ${data.type}.`;

    if (data.type !== 'entry') {
        const hospital = hospitals.find(h => h.id === data.hospitalId);
        const unit = servedUnits.find(u => u.id === data.unitId);
        if (unit && hospital) {
            description += ` para ${unit.name} (${hospital.name}).`;
        } else {
            description += ` (Armazém Central).`; // Saída geral do armazém
        }
    }
    if (patient) {
      description += ` Paciente: ${patient.name}.`;
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
        patientId: undefined,
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
                        onValueChange={field.onChange}
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
                        <Select
                            onValueChange={(value) => {
                                field.onChange(value);
                                form.setValue('unitId', undefined); // Reset unit when hospital changes
                                form.setValue('patientId', undefined); // Reset patient when hospital changes
                            }}
                            value={field.value || ""}
                            defaultValue={field.value}
                        >
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione um hospital" /></SelectTrigger></FormControl>
                          <SelectContent>
                             {movementType === 'exit' && <SelectItem value="">Nenhum (Baixa do Armazém Central)</SelectItem>}
                            {hospitals.map(hospital => <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                         <FormDescription>
                            {movementType === 'exit' && "Se for uma baixa direta do Armazém Central sem unidade de destino, deixe em branco. Para transferir para uma unidade, selecione o hospital."}
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
                          <Select
                            onValueChange={(value) => {
                                field.onChange(value);
                                if (movementType !== 'consumption' || !isConsumptionInUBS()) {
                                    form.setValue('patientId', undefined); // Reset patient if not UBS consumption
                                }
                            }}
                            value={field.value || ""}
                            defaultValue={field.value}
                            disabled={!selectedHospitalId || availableUnits.length === 0}
                          >
                            <FormControl><SelectTrigger>
                                <SelectValue placeholder={availableUnits.length > 0 ? "Selecione uma unidade" : "Nenhuma unidade para este hospital"} />
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
                  {movementType === 'consumption' && selectedUnitId && isConsumptionInUBS() && (
                     <FormField
                        control={form.control}
                        name="patientId"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel className="flex items-center gap-1">
                                <User className="h-4 w-4 text-muted-foreground"/> Paciente (Opcional)
                            </FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || ""} defaultValue={field.value}>
                            <FormControl><SelectTrigger>
                                <SelectValue placeholder="Selecione um paciente (se aplicável)" />
                            </SelectTrigger></FormControl>
                            <SelectContent>
                                <SelectItem value="">Nenhum paciente específico</SelectItem>
                                {patients.map(patient => (
                                <SelectItem key={patient.id} value={patient.id}>{patient.name} - SUS: {patient.susCardNumber}</SelectItem>
                                ))}
                            </SelectContent>
                            </Select>
                            <FormDescription>Selecione o paciente se o consumo for individualizado (comum em UBS).</FormDescription>
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
                    <FormControl><Input type="number" placeholder="ex: 10" {...field} min="1" /></FormControl>
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
