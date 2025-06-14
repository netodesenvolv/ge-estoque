
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
import { mockServedUnits, mockHospitals, mockPatients } from '@/data/mockData'; // Itens serão buscados do Firestore
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';

const CENTRAL_WAREHOUSE_EXIT_VALUE = "CENTRAL_WAREHOUSE_DIRECT_EXIT";

const movementSchema = z.object({
  itemId: z.string().min(1, "A seleção do item é obrigatória."),
  type: z.enum(['entry', 'exit', 'consumption'], { required_error: "O tipo de movimentação é obrigatório." }),
  quantity: z.coerce.number().positive("A quantidade deve ser um número positivo."),
  hospitalId: z.string().optional(),
  unitId: z.string().optional(),
  patientId: z.string().optional(),
  date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Data inválida." }),
  notes: z.string().optional(),
}).refine(data => {
  if (data.type === 'consumption' && data.unitId && !data.patientId) {
    // Para consumo em unidade, o paciente pode ser obrigatório dependendo da regra de negócio.
  }
  // Se é saída ou consumo E um hospital REAL foi selecionado (não baixa direta do armazém) E não há unidade, então é erro.
  if ((data.type === 'exit' || data.type === 'consumption') &&
      data.hospitalId && data.hospitalId !== CENTRAL_WAREHOUSE_EXIT_VALUE &&
      !data.unitId) {
    return false;
  }
  return true;
}, {
  message: "Para Saída ou Consumo com um Hospital específico selecionado, a Unidade Servida também deve ser selecionada.",
  path: ["unitId"],
}).refine(data => {
    // Não pode ter unidade sem hospital (a menos que hospitalId seja CENTRAL_WAREHOUSE_EXIT_VALUE, mas nesse caso unitId deveria ser undefined)
    if((data.type === 'exit' || data.type === 'consumption') && !data.hospitalId && data.unitId && data.hospitalId !== CENTRAL_WAREHOUSE_EXIT_VALUE){
        return false; 
    }
    return true;
}, {
    message: "A Unidade Servida não pode ser selecionada sem um Hospital.",
    path: ["hospitalId"], // Ou unitId, dependendo do foco da mensagem
});


type MovementFormData = z.infer<typeof movementSchema>;

const NO_PATIENT_ID = "__NO_PATIENT__";

export default function StockMovementsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const { toast } = useToast();

  const form = useForm<MovementFormData>({
    resolver: zodResolver(movementSchema),
    defaultValues: {
      type: 'entry',
      quantity: 1,
      date: new Date().toISOString().split('T')[0],
      notes: '',
      hospitalId: undefined,
      unitId: undefined,
      patientId: undefined,
      itemId: undefined,
    },
  });

  const movementType = form.watch('type');
  const selectedHospitalId = form.watch('hospitalId');
  const selectedUnitId = form.watch('unitId');

  useEffect(() => {
    // Buscar Itens
    const itemsCollectionRef = collection(firestore, "items");
    const qItems = query(itemsCollectionRef, orderBy("name", "asc"));
    const unsubscribeItems = onSnapshot(qItems, (querySnapshot) => {
      const itemsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item));
      setItems(itemsData);
    }, (error) => {
      console.error("Erro ao buscar itens: ", error);
      toast({ title: "Erro ao Carregar Itens", description: "Não foi possível carregar a lista de itens.", variant: "destructive" });
    });

    // Mock data para outras entidades (serão substituídas por chamadas ao Firestore conforme necessário)
    setServedUnits(mockServedUnits); // Manter mock ou buscar do Firestore se já implementado
    setHospitals(mockHospitals);     // Manter mock ou buscar do Firestore se já implementado
    setPatients(mockPatients);       // Manter mock ou buscar do Firestore se já implementado
    
    return () => {
      unsubscribeItems();
      // Adicionar unsubscribes para outras coleções se forem adicionados listeners
    };
  }, [toast]);

  useEffect(() => {
    if (movementType === 'entry') {
        form.setValue('hospitalId', undefined);
        form.setValue('unitId', undefined);
        form.setValue('patientId', undefined);
    } else if (movementType === 'exit') {
        form.setValue('patientId', undefined);
    }
  }, [movementType, form]);

   useEffect(() => {
    form.setValue('unitId', undefined, { shouldValidate: true });
    form.setValue('patientId', undefined);
  }, [selectedHospitalId, form]);


  const availableUnits = selectedHospitalId && selectedHospitalId !== CENTRAL_WAREHOUSE_EXIT_VALUE
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
    
    let processedData = {...data};
    if (data.hospitalId === CENTRAL_WAREHOUSE_EXIT_VALUE) {
        processedData.hospitalId = undefined;
    }

    let description = `Movimentação de ${processedData.quantity} unidade(s) do item ${item?.name || processedData.itemId} registrada como ${processedData.type}.`;

    if (processedData.type !== 'entry') {
        const hospital = hospitals.find(h => h.id === processedData.hospitalId);
        const unit = servedUnits.find(u => u.id === processedData.unitId);
        if (unit && hospital) {
            description += ` para ${unit.name} (${hospital.name}).`;
        } else if (processedData.hospitalId === undefined) { 
            description += ` (Baixa direta do Armazém Central).`;
        }
    }
    if (patient) {
      description += ` Paciente: ${patient.name}.`;
    }

    console.log('Movimentação de estoque submetida:', processedData);
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
                    <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecione um item" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {items.length === 0 && <SelectItem value="loading" disabled>Carregando itens...</SelectItem>}
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
                                field.onChange(value === CENTRAL_WAREHOUSE_EXIT_VALUE ? undefined : value);
                            }}
                            value={field.value ?? undefined} 
                        >
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione um hospital ou baixa direta" /></SelectTrigger></FormControl>
                          <SelectContent>
                             {movementType === 'exit' && <SelectItem value={CENTRAL_WAREHOUSE_EXIT_VALUE}>Nenhum (Baixa do Armazém Central)</SelectItem>}
                            {hospitals.map(hospital => <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                         <FormDescription>
                            {movementType === 'exit' && "Selecione 'Nenhum' para baixa direta do Armazém Central. Para transferir, selecione o hospital."}
                            {movementType === 'consumption' && "Selecione o hospital onde o item foi consumido."}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {selectedHospitalId && selectedHospitalId !== CENTRAL_WAREHOUSE_EXIT_VALUE && (movementType === 'exit' || movementType === 'consumption') && (
                    <FormField
                      control={form.control}
                      name="unitId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Unidade Servida de Destino/Consumo</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value ?? undefined}
                            disabled={!selectedHospitalId || availableUnits.length === 0 || selectedHospitalId === CENTRAL_WAREHOUSE_EXIT_VALUE}
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
                            <Select
                                onValueChange={(value) => field.onChange(value === NO_PATIENT_ID ? undefined : value)}
                                value={field.value || NO_PATIENT_ID}
                            >
                            <FormControl><SelectTrigger>
                                <SelectValue placeholder="Selecione um paciente (se aplicável)" />
                            </SelectTrigger></FormControl>
                            <SelectContent>
                                <SelectItem value={NO_PATIENT_ID}>Nenhum paciente específico</SelectItem>
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

