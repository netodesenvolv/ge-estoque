
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowRightLeft, User, Loader2, Upload, Download } from 'lucide-react';
import type { Item, ServedUnit, Hospital, Patient, StockMovement } from '@/types';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, runTransaction, addDoc, type Transaction, writeBatch } from 'firebase/firestore';
import Papa, { type ParseError } from 'papaparse';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";


function removeUndefinedFields<T extends object>(obj: T): Partial<T> {
  const newObj: Partial<T> = {};
  for (const key in obj) {
    if (obj[key] !== undefined && obj[key] !== null) {
      newObj[key] = obj[key];
    }
  }
  return newObj;
}

const CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE = "CENTRAL_WAREHOUSE_DIRECT_EXIT";
const UBS_GENERAL_STOCK_SUFFIX = "UBSGENERAL";


const createMovementSchema = (hospitalsList: Hospital[]) => z.object({
  itemId: z.string().min(1, "A seleção do item é obrigatória."),
  type: z.enum(['entry', 'exit', 'consumption'], { required_error: "O tipo de movimentação é obrigatório." }),
  quantity: z.coerce.number().positive("A quantidade deve ser um número positivo."),
  hospitalId: z.string().optional(),
  unitId: z.string().optional(),
  patientId: z.string().optional(),
  date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Data inválida." }),
  notes: z.string().optional(),
}).superRefine((data, ctx) => {
  if ((data.type === 'exit' || data.type === 'consumption') &&
      data.hospitalId && data.hospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
    
    const selectedHospital = hospitalsList.find(h => h.id === data.hospitalId);
    const isTargetUBS = selectedHospital?.name.toLowerCase().includes('ubs');

    if (data.type === 'consumption' && !data.unitId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Para Consumo em um Hospital/UBS específico, a Unidade Servida é obrigatória.",
            path: ["unitId"],
        });
    } else if (data.type === 'exit' && !isTargetUBS && !data.unitId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Para Saída para este tipo de Hospital, a Unidade Servida é obrigatória.",
            path: ["unitId"],
        });
    }
  }

  if (data.type === 'entry' && data.unitId) {
    ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unidade Servida não deve ser selecionada para movimentações de Entrada (direto no Armazém Central).",
        path: ["unitId"],
    });
  }
  if ((data.type === 'exit' || data.type === 'consumption') &&
      data.hospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE &&
      data.unitId) {
    ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unidade Servida não deve ser selecionada para Baixa/Consumo direto do Armazém Central.",
        path: ["unitId"],
    });
  }
});


type MovementFormData = z.infer<ReturnType<typeof createMovementSchema>>;

const NO_PATIENT_ID = "__NO_PATIENT__";


const ManualMovementForm = ({ items, servedUnits, hospitals, patients }: { items: Item[], servedUnits: ServedUnit[], hospitals: Hospital[], patients: Patient[] }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const movementSchema = createMovementSchema(hospitals); 

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
    if (movementType === 'entry') {
        form.setValue('hospitalId', undefined, { shouldValidate: true });
        form.setValue('unitId', undefined, { shouldValidate: true });
        form.setValue('patientId', undefined, { shouldValidate: true });
    } else if (movementType === 'exit') {
        form.setValue('patientId', undefined, { shouldValidate: true }); 
    }
    if (selectedHospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
        form.setValue('unitId', undefined, { shouldValidate: true });
    }
  }, [movementType, form, selectedHospitalId]);

   useEffect(() => {
    if (selectedHospitalId && selectedHospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
        form.setValue('unitId', undefined, { shouldValidate: true });
    }
  }, [selectedHospitalId, form]);


  const availableUnits = selectedHospitalId && selectedHospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE
    ? servedUnits.filter(unit => unit.hospitalId === selectedHospitalId)
    : [];

  const isConsumptionInSelectedUnit = () => {
    if (movementType !== 'consumption' || !selectedUnitId) return false;
    const unit = servedUnits.find(u => u.id === selectedUnitId);
    if (!unit) return false;
    const hospital = hospitals.find(h => h.id === unit.hospitalId);
    return hospital?.name.toLowerCase().includes('ubs') || false;
  };

  const getUnitFormFieldDescription = () => {
    if (movementType === 'exit' && selectedHospitalId && selectedHospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
        const hospital = hospitals.find(h => h.id === selectedHospitalId);
        if (hospital?.name.toLowerCase().includes('ubs')) {
            return "Unidade para qual o item está sendo transferido (Opcional se transferindo para a UBS como um todo).";
        }
        return "Unidade para a qual o item está sendo transferido (Obrigatório para este tipo de hospital).";
    }
    if (movementType === 'consumption' && selectedHospitalId && selectedHospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
        return "Unidade onde o item foi consumido (Obrigatório).";
    }
    return "Selecione uma unidade de destino ou consumo.";
  };


  const onSubmit = async (data: MovementFormData) => {
    setIsSubmitting(true);
    
    let processedData = {...data};
    if (data.hospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
        processedData.hospitalId = undefined;
        processedData.unitId = undefined;
    }
    
    if (data.type === 'exit' && data.hospitalId && data.hospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
        const hospital = hospitals.find(h => h.id === data.hospitalId);
        if (hospital && !hospital.name.toLowerCase().includes('ubs') && !data.unitId) {
            toast({
                title: "Erro de Validação",
                description: `Para transferências para '${hospital.name}', uma Unidade Servida específica deve ser selecionada.`,
                variant: "destructive",
            });
            setIsSubmitting(false);
            return;
        }
    }
    if (data.type === 'consumption' && data.hospitalId && data.hospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE && !data.unitId) {
         toast({
            title: "Erro de Validação",
            description: `Para consumo em um Hospital/UBS, uma Unidade Servida específica deve ser selecionada.`,
            variant: "destructive",
        });
        setIsSubmitting(false);
        return;
    }


    try {
      await runTransaction(firestore, async (transaction) => {
        const itemDocRef = doc(firestore, "items", processedData.itemId);
        
        const itemSnap = await transaction.get(itemDocRef);
        if (!itemSnap.exists()) {
          throw new Error("Item não encontrado no banco de dados.");
        }
        const currentItemData = itemSnap.data() as Item;
        
        if ((processedData.type === 'exit' || processedData.type === 'consumption') && 
            processedData.hospitalId && processedData.unitId) { 
          const unitConfigDocId = `${processedData.itemId}_${processedData.unitId}`;
          const unitConfigDocRef = doc(firestore, "stockConfigs", unitConfigDocId);
          const unitConfigSnap = await transaction.get(unitConfigDocRef); 

          let currentCentralQty = currentItemData.currentQuantityCentral;
          if (typeof currentCentralQty !== 'number' || isNaN(currentCentralQty)) currentCentralQty = 0;
          if (currentCentralQty < processedData.quantity) {
            throw new Error(`Estoque insuficiente (${currentCentralQty}) no Armazém Central para ${currentItemData.name}. Necessário: ${processedData.quantity}`);
          }
          const newCentralQuantityAfterTransfer = currentCentralQty - processedData.quantity;
          transaction.update(itemDocRef, { currentQuantityCentral: newCentralQuantityAfterTransfer });

          if (unitConfigSnap && unitConfigSnap.exists()) {
            const currentUnitConfigData = unitConfigSnap.data();
            let currentUnitQty = currentUnitConfigData.currentQuantity || 0;
            if (typeof currentUnitQty !== 'number' || isNaN(currentUnitQty)) currentUnitQty = 0;
            const newUnitQuantity = currentUnitQty + processedData.quantity;
            transaction.update(unitConfigDocRef, { currentQuantity: newUnitQuantity });
          } else {
            const unitDetails = servedUnits.find(u => u.id === processedData.unitId);
            transaction.set(unitConfigDocRef, {
              itemId: processedData.itemId,
              unitId: processedData.unitId,
              hospitalId: unitDetails?.hospitalId || null, 
              currentQuantity: processedData.quantity,
              strategicStockLevel: 0, 
              minQuantity: 0, 
            });
          }
        } 
        else if (processedData.type === 'exit' && processedData.hospitalId && !processedData.unitId) {
            const selectedHospital = hospitals.find(h => h.id === processedData.hospitalId);
            if (!selectedHospital) throw new Error("Hospital de destino não encontrado.");
            if (!selectedHospital.name.toLowerCase().includes('ubs')) {
                 throw new Error("Saída para hospital sem unidade especificada só é permitida para UBS.");
            }
            
            let currentCentralQty = currentItemData.currentQuantityCentral;
            if (typeof currentCentralQty !== 'number' || isNaN(currentCentralQty)) currentCentralQty = 0;
            if (currentCentralQty < processedData.quantity) {
                throw new Error(`Estoque insuficiente (${currentCentralQty}) no Arm. Central para ${currentItemData.name} (transferência para ${selectedHospital.name}). Necessário: ${processedData.quantity}`);
            }
            const newCentralQty = currentCentralQty - processedData.quantity;
            transaction.update(itemDocRef, { currentQuantityCentral: newCentralQty });

            const ubsGeneralStockConfigId = `${processedData.itemId}_${processedData.hospitalId}_${UBS_GENERAL_STOCK_SUFFIX}`;
            const ubsStockConfigDocRef = doc(firestore, "stockConfigs", ubsGeneralStockConfigId);
            const ubsStockConfigSnap = await transaction.get(ubsStockConfigDocRef);

            if (ubsStockConfigSnap.exists()) {
                const currentUbsConfigData = ubsStockConfigSnap.data();
                let currentUbsQty = currentUbsConfigData.currentQuantity || 0;
                if (typeof currentUbsQty !== 'number' || isNaN(currentUbsQty)) currentUbsQty = 0;
                const newUbsQuantity = currentUbsQty + processedData.quantity;
                transaction.update(ubsStockConfigDocRef, { currentQuantity: newUbsQuantity });
            } else {
                transaction.set(ubsStockConfigDocRef, {
                    itemId: processedData.itemId,
                    hospitalId: processedData.hospitalId,
                    // unitId é omitido ou null aqui para indicar estoque geral da UBS
                    currentQuantity: processedData.quantity,
                    strategicStockLevel: 0, 
                    minQuantity: 0, 
                });
            }
        }
        else if (processedData.type === 'entry' || (!processedData.hospitalId && !processedData.unitId)) {
          let currentCentralQty = currentItemData.currentQuantityCentral;
          if (typeof currentCentralQty !== 'number' || isNaN(currentCentralQty)) currentCentralQty = 0;
          
          let newQuantityCentral: number;
          if (processedData.type === 'entry') {
            newQuantityCentral = currentCentralQty + processedData.quantity;
          } else { 
            if (currentCentralQty < processedData.quantity) {
              throw new Error(`Estoque insuficiente (${currentCentralQty}) no Armazém Central para ${currentItemData.name} para baixa/consumo direto. Necessário: ${processedData.quantity}`);
            }
            newQuantityCentral = currentCentralQty - processedData.quantity;
          }
          transaction.update(itemDocRef, { currentQuantityCentral: newQuantityCentral });
        } else {
          throw new Error("Configuração de movimentação inválida ou não tratada.");
        }

        const itemDetailsForLog = items.find(i => i.id === processedData.itemId);
        const hospitalDetailsForLog = processedData.hospitalId ? hospitals.find(h => h.id === processedData.hospitalId) : null;
        const unitDetailsForLog = processedData.unitId ? servedUnits.find(u => u.id === processedData.unitId) : null;
        const patientDetailsForLog = processedData.patientId ? patients.find(p => p.id === processedData.patientId) : null;

        const movementLogPayload: Partial<StockMovement> = {
          itemId: processedData.itemId,
          itemName: itemDetailsForLog?.name,
          type: processedData.type,
          quantity: processedData.quantity,
          date: processedData.date,
          notes: processedData.notes || undefined, 
          hospitalId: hospitalDetailsForLog?.id,
          hospitalName: hospitalDetailsForLog?.name,
          unitId: unitDetailsForLog?.id,
          unitName: unitDetailsForLog?.name,
          patientId: patientDetailsForLog?.id,
          patientName: patientDetailsForLog?.name,
        };
        
        const cleanedMovementLog = removeUndefinedFields(movementLogPayload) as Omit<StockMovement, 'id'>;
        const stockMovementsCollectionRef = collection(firestore, "stockMovements");
        transaction.set(doc(stockMovementsCollectionRef), cleanedMovementLog);
      });
      
      const item = items.find(i => i.id === processedData.itemId);
      let description = `Movimentação de ${processedData.quantity} unidade(s) do item ${item?.name || processedData.itemId} registrada como ${processedData.type}.`;
      
      if (processedData.type !== 'entry') {
          const hospitalDesc = processedData.hospitalId ? hospitals.find(h => h.id === processedData.hospitalId) : null;
          const unitDesc = processedData.unitId ? servedUnits.find(u => u.id === processedData.unitId) : null;
          
          if (unitDesc && hospitalDesc) { 
              description += ` para ${unitDesc.name} (${hospitalDesc.name}).`;
          } else if (hospitalDesc && !unitDesc && processedData.type === 'exit' && hospitalDesc.name.toLowerCase().includes('ubs')) {
              description += ` para ${hospitalDesc.name} (estoque geral da UBS).`;
          } else if (!processedData.hospitalId && !processedData.unitId) { 
              description += ` (Baixa/Consumo direto do Armazém Central).`;
          }
      }
      if (processedData.patientId && patients.find(p => p.id === processedData.patientId)) {
        description += ` Paciente: ${patients.find(p => p.id === processedData.patientId)?.name}.`;
      }

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

    } catch (error: any) {
      console.error('Erro ao registrar movimentação de estoque:', error);
      toast({
        title: "Erro ao Registrar Movimentação",
        description: error.message || "Não foi possível concluir a operação.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
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
                        {items.map(item => <SelectItem key={item.id} value={item.id}>{item.name} ({item.code}) - Atual Central: {item.currentQuantityCentral}</SelectItem>)}
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
                            onValueChange={field.onChange}
                            value={field.value ?? CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE} 
                        >
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione um hospital ou baixa direta" /></SelectTrigger></FormControl>
                          <SelectContent>
                             <SelectItem value={CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE}>Nenhum (Baixa/Consumo direto do Armazém Central)</SelectItem>
                            {hospitals.map(hospital => <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                         <FormDescription>
                            {movementType === 'exit' && "Para transferir, selecione o hospital. Para baixa direta do Armazém Central, escolha 'Nenhum'."}
                            {movementType === 'consumption' && "Selecione o hospital onde o item foi consumido. Para consumo direto do Armazém Central, escolha 'Nenhum'."}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {selectedHospitalId && selectedHospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE && (
                    <FormField
                      control={form.control}
                      name="unitId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Unidade Servida de Destino/Consumo</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value ?? undefined}
                            disabled={!selectedHospitalId || availableUnits.length === 0}
                          >
                            <FormControl><SelectTrigger>
                                <SelectValue placeholder={availableUnits.length > 0 ? "Selecione uma unidade" : "Nenhuma unidade para este hospital"} />
                            </SelectTrigger></FormControl>
                            <SelectContent>
                              {availableUnits.map(unit => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                           <FormDescription>{getUnitFormFieldDescription()}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  {movementType === 'consumption' && selectedUnitId && isConsumptionInSelectedUnit() && (
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
                            <FormDescription>Selecione o paciente se o consumo for individualizado (comum em UBSs).</FormDescription>
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
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Registrar Movimentação
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
  );
};

async function processMovementRowTransaction(
    transaction: Transaction,
    movementData: {
        itemId: string;
        type: 'entry' | 'exit' | 'consumption';
        quantity: number;
        date: string;
        hospitalId?: string;
        unitId?: string;
        patientId?: string;
        notes?: string;
    },
    itemForRow: Item,
    rowIndex: number,
    itemCodeForRow: string,
    allItemsMaster: Item[],
    allHospitalsMaster: Hospital[],
    allServedUnitsMaster: ServedUnit[],
    allPatientsMaster: Patient[],
    hospitalNameCsv?: string,
    unitNameCsv?: string,
    notesCsv?: string
) {
    console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): DENTRO da transação Firestore.`);
    const itemDocRef = doc(firestore, "items", movementData.itemId);
    
    const itemSnap = await transaction.get(itemDocRef);
    if (!itemSnap.exists()) {
        console.error(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION ERROR - Item ID '${movementData.itemId}' não encontrado.`);
        throw new Error(`Item ID '${movementData.itemId}' (Código: ${itemCodeForRow}) não encontrado (linha ${rowIndex}).`);
    }
    
    const currentItemData = itemSnap.data() as Item;
    let newQuantityCentralCalculated: number;

    console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION - Detalhes para decisão: type='${movementData.type}', hospitalId='${movementData.hospitalId}', unitId='${movementData.unitId}'`);
    const isTargetUBS = movementData.hospitalId ? allHospitalsMaster.find(h => h.id === movementData.hospitalId)?.name.toLowerCase().includes('ubs') : false;

    if ((movementData.type === 'exit' || movementData.type === 'consumption') && 
        movementData.hospitalId && movementData.unitId) {
      console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION (SAÍDA/CONSUMO P/ UNIDADE ESPECÍFICA) - Entrou no bloco.`);
      const unitConfigDocId = `${movementData.itemId}_${movementData.unitId}`;
      const unitConfigDocRef = doc(firestore, "stockConfigs", unitConfigDocId);
      const unitConfigSnap = await transaction.get(unitConfigDocRef);

      let currentCentralQtyForUnitExit = currentItemData.currentQuantityCentral;
      if (typeof currentCentralQtyForUnitExit !== 'number' || isNaN(currentCentralQtyForUnitExit)) currentCentralQtyForUnitExit = 0;
      
      if (currentCentralQtyForUnitExit < movementData.quantity) {
        throw new Error(`Estoque insuficiente (${currentCentralQtyForUnitExit}) no Arm. Central para ${itemForRow.name} (transferência para unidade). Necessário: ${movementData.quantity}`);
      }
      const newCentralQuantityAfterTransfer = currentCentralQtyForUnitExit - movementData.quantity;
      transaction.update(itemDocRef, { currentQuantityCentral: newCentralQuantityAfterTransfer });

      if (unitConfigSnap && unitConfigSnap.exists()) {
        const currentUnitConfigData = unitConfigSnap.data();
        let currentUnitQty = currentUnitConfigData.currentQuantity || 0;
        if (typeof currentUnitQty !== 'number' || isNaN(currentUnitQty)) currentUnitQty = 0;
        const newUnitQuantity = currentUnitQty + movementData.quantity;
        transaction.update(unitConfigDocRef, { currentQuantity: newUnitQuantity });
      } else {
        const unitDetails = allServedUnitsMaster.find(u => u.id === movementData.unitId);
        transaction.set(unitConfigDocRef, {
          itemId: movementData.itemId,
          unitId: movementData.unitId,
          hospitalId: unitDetails?.hospitalId || null,
          currentQuantity: movementData.quantity,
          strategicStockLevel: 0,
          minQuantity: 0,
        });
      }
    } 
    else if (movementData.type === 'exit' && movementData.hospitalId && !movementData.unitId && isTargetUBS) {
        console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION (SAÍDA P/ UBS s/ Unidade) - Entrou no bloco.`);
        const selectedHospital = allHospitalsMaster.find(h => h.id === movementData.hospitalId);
        
        let currentCentralQtyForUbsExit = currentItemData.currentQuantityCentral;
        console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION (SAÍDA P/ UBS s/ Unidade) - currentCentralQty (ANTES coerção): ${currentCentralQtyForUbsExit}`);
        if (typeof currentCentralQtyForUbsExit !== 'number' || isNaN(currentCentralQtyForUbsExit)) currentCentralQtyForUbsExit = 0;
        console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION (SAÍDA P/ UBS s/ Unidade) - currentCentralQty (APÓS coerção): ${currentCentralQtyForUbsExit}, mov.qty: ${movementData.quantity}`);
        
        if (currentCentralQtyForUbsExit < movementData.quantity) {
            throw new Error(`Estoque insuficiente (${currentCentralQtyForUbsExit}) no Arm. Central para ${itemForRow.name} (transferência para ${selectedHospital?.name}). Necessário: ${movementData.quantity}`);
        }
        newQuantityCentralCalculated = currentCentralQtyForUbsExit - movementData.quantity;
        transaction.update(itemDocRef, { currentQuantityCentral: newQuantityCentralCalculated });
        console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION (SAÍDA P/ UBS s/ Unidade) - Update para item ${itemDocRef.path} com Qtd Central: ${newQuantityCentralCalculated}`);

        const ubsGeneralStockConfigId = `${movementData.itemId}_${movementData.hospitalId}_${UBS_GENERAL_STOCK_SUFFIX}`;
        const ubsStockConfigDocRef = doc(firestore, "stockConfigs", ubsGeneralStockConfigId);
        const ubsStockConfigSnap = await transaction.get(ubsStockConfigDocRef);
        console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION (SAÍDA P/ UBS s/ Unidade) - Verificando config de estoque da UBS: ${ubsGeneralStockConfigId}`);

        if (ubsStockConfigSnap.exists()) {
            const currentUbsStockConfigData = ubsStockConfigSnap.data();
            let currentUbsQty = currentUbsStockConfigData.currentQuantity || 0;
            if (typeof currentUbsQty !== 'number' || isNaN(currentUbsQty)) currentUbsQty = 0;
            const newUbsQuantity = currentUbsQty + movementData.quantity;
            transaction.update(ubsStockConfigDocRef, { currentQuantity: newUbsQuantity });
            console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION (SAÍDA P/ UBS s/ Unidade) - Atualizando estoque da UBS para: ${newUbsQuantity}`);
        } else {
            transaction.set(ubsStockConfigDocRef, {
                itemId: movementData.itemId,
                hospitalId: movementData.hospitalId,
                currentQuantity: movementData.quantity,
                strategicStockLevel: 0, 
                minQuantity: 0,
            });
            console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION (SAÍDA P/ UBS s/ Unidade) - Criando config de estoque da UBS com quantidade: ${movementData.quantity}`);
        }
    }
    else if (movementData.type === 'entry' || (!movementData.hospitalId && !movementData.unitId)) {
      const isDirectCentralExit = !movementData.hospitalId && !movementData.unitId;
      console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION (${movementData.type === 'entry' ? 'ENTRADA' : 'BAIXA DIRETA'}) - Entrou no bloco. É baixa direta? ${isDirectCentralExit}`);
      
      let currentCentralQtyForEntryOrDirect = currentItemData.currentQuantityCentral;
      console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION (${movementData.type}) - currentCentralQty (ANTES coerção): ${currentCentralQtyForEntryOrDirect}`);
      if (typeof currentCentralQtyForEntryOrDirect !== 'number' || isNaN(currentCentralQtyForEntryOrDirect)) currentCentralQtyForEntryOrDirect = 0;
      console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION (${movementData.type}) - currentCentralQty (APÓS coerção): ${currentCentralQtyForEntryOrDirect}, mov.qty: ${movementData.quantity}`);
      
      if (movementData.type === 'entry') {
        newQuantityCentralCalculated = currentCentralQtyForEntryOrDirect + movementData.quantity;
      } else { 
        if (currentCentralQtyForEntryOrDirect < movementData.quantity) {
          throw new Error(`Estoque insuficiente (${currentCentralQtyForEntryOrDirect}) no Arm. Central para ${itemForRow.name} para baixa/consumo direto. Necessário: ${movementData.quantity}`);
        }
        newQuantityCentralCalculated = currentCentralQtyForEntryOrDirect - movementData.quantity;
      }
      console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION (${movementData.type}) - Nova Qtd Central Calculada: ${newQuantityCentralCalculated}`);
      transaction.update(itemDocRef, { currentQuantityCentral: newQuantityCentralCalculated });
      console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION (${movementData.type}) - Update para item ${itemDocRef.path} com Qtd Central: ${newQuantityCentralCalculated}`);
    } else {
      throw new Error(`Configuração de movimentação inválida ou não tratada na linha ${rowIndex}. Tipo: ${movementData.type}, Hospital: ${movementData.hospitalId}, Unidade: ${movementData.unitId}`);
    }

    const patientDetailsForLog = movementData.patientId ? allPatientsMaster.find(p => p.id === movementData.patientId) : null;
    const movementLog: Partial<StockMovement> = {
        itemId: movementData.itemId, 
        itemName: itemForRow.name,
        type: movementData.type,
        quantity: movementData.quantity,
        date: movementData.date,
        notes: notesCsv,
        hospitalId: movementData.hospitalId, 
        hospitalName: hospitalNameCsv,
        unitId: movementData.unitId,
        unitName: unitNameCsv,
        patientId: movementData.patientId,
        patientName: patientDetailsForLog?.name, 
    };
    console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION - Criando log de movimentação (antes de remover undefined):`, JSON.stringify(movementLog));
    const movementLogClean = removeUndefinedFields(movementLog);
    console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION - Log de movimentação (depois de remover undefined):`, JSON.stringify(movementLogClean));
    transaction.set(doc(collection(firestore, "stockMovements")), movementLogClean as Omit<StockMovement, 'id'>);
    console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): DENTRO DA TRANSAÇÃO - Todas as operações da transação foram adicionadas. Preparando para commit implícito.`);
};


const BatchImportMovementsForm = ({ items, servedUnits, hospitals, patients, isLoadingDataFromParent }: { items: Item[], servedUnits: ServedUnit[], hospitals: Hospital[], patients: Patient[], isLoadingDataFromParent: boolean }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const selectedFile = event.target.files[0];
      if (selectedFile.type === 'text/csv' || selectedFile.name.endsWith('.csv')) {
        setFile(selectedFile);
      } else {
        toast({
          title: "Tipo de Arquivo Inválido",
          description: "Por favor, selecione um arquivo .csv.",
          variant: "destructive",
        });
        setFile(null);
        if (event.target) event.target.value = ""; 
      }
    } else {
      setFile(null);
    }
  };

  const handleDownloadTemplate = () => {
    const BOM = "\uFEFF";
    const csvHeader = "Código do Item,Tipo,Quantidade,Data,Nome do Hospital Destino/Consumo,Nome da Unidade Destino/Consumo,Cartão SUS Paciente,Observações\n";
    const csvExampleRow1 = "ITEM001,entrada,100,2024-01-15,,,,,\n"; 
    const csvExampleRow2 = "ITEM002,saida,10,2024-01-16,Hospital Central,UTI Geral,,Transferência urgente\n";
    const csvExampleRow3 = "ITEM003,consumo,2,2024-01-17,UBS Vila Nova,Consultório 1,700123456789012,Consumo paciente Maria\n";
    const csvExampleRow4 = "ITEM001,saida,5,2024-01-18,UBS ABC,,,,Baixa para UBS ABC (geral)\n"; // Exemplo de saída para UBS sem unidade


    const csvContent = BOM + csvHeader + csvExampleRow1 + csvExampleRow2 + csvExampleRow3 + csvExampleRow4;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");

    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", "modelo_importacao_movimentacoes.csv");
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({ title: "Download Iniciado", description: "O arquivo modelo_importacao_movimentacoes.csv está sendo baixado." });
    } else {
      toast({ title: "Erro no Download", description: "Seu navegador não suporta o download automático.", variant: "destructive" });
    }
  };

  const handleSubmit = async () => {
    if (!file) {
      toast({ title: "Erro", description: "Por favor, selecione um arquivo CSV para importar.", variant: "destructive" });
      return;
    }
    
    setIsProcessing(true);
    console.log("BATCH IMPORT: Iniciando processamento do CSV...");
    const reader = new FileReader();

    reader.onload = async (e) => {
      const csvText = e.target?.result as string;
      if (!csvText) {
        toast({ title: "Erro", description: "Não foi possível ler o arquivo.", variant: "destructive" });
        setIsProcessing(false);
        return;
      }

      Papa.parse<Record<string, string>>(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          console.log("BATCH IMPORT: PapaParse 'complete' callback iniciado.");
          const { data: rows, errors: parseErrors } = results;

          if (parseErrors.length > 0) {
            console.error("BATCH IMPORT: Erros de parsing do CSV (objetos completos):", JSON.stringify(parseErrors, null, 2));
            const errorMessages = parseErrors.map((err: Papa.ParseError, index: number) => {
              const rowInfo = typeof err.row === 'number' ? `Linha CSV ${err.row + 2} (dados linha ${err.row +1}): ` : `Erro genérico ${index + 1}: `;
              const message = err.message || "Mensagem de erro não disponível";
              const type = err.type ? ` (Tipo: ${err.type}` : "";
              const code = err.code ? `, Código: ${err.code})` : (type ? ")" : "");
              return `${rowInfo}${message}${type}${code}`;
            });
            toast({ 
                title: "Erro ao Processar CSV", 
                description: (
                    <div className="max-h-60 overflow-y-auto text-xs">
                        <p className="font-semibold mb-1">Houve {parseErrors.length} erro(s) ao ler o arquivo:</p>
                        {errorMessages.map((msg, i) => <p key={i}>{msg}</p>)}
                        <p className="mt-2">Verifique o console para mais detalhes técnicos e o formato JSON dos erros.</p>
                    </div>
                ), 
                variant: "destructive",
                duration: 20000 
            });
            setIsProcessing(false);
            console.log("BATCH IMPORT: Processamento interrompido devido a erros de parsing.");
            return;
          }
          if (rows.length === 0) {
            toast({ title: "Arquivo Vazio", description: "O arquivo CSV não contém dados.", variant: "destructive" });
            setIsProcessing(false);
            console.log("BATCH IMPORT: Arquivo CSV vazio.");
            return;
          }

          let successfulImports = 0;
          const importErrors: string[] = [];
          console.log(`BATCH IMPORT: Iniciando processamento de ${rows.length} linhas do CSV.`);

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowIndex = i + 2; 
            let itemCodeForRow = "N/A"; 
            console.log(`BATCH IMPORT: Linha ${rowIndex} do CSV:`, JSON.stringify(row));
            
            try {
                const itemCode = row["Código do Item"]?.trim();
                itemCodeForRow = itemCode || "N/A";
                
                let typeStrRaw = row["Tipo"];
                let typeStrSanitized: string;
                let mappedType: 'entry' | 'exit' | 'consumption';

                if (typeof typeStrRaw === 'string') {
                    typeStrSanitized = typeStrRaw.charCodeAt(0) === 0xFEFF ? typeStrRaw.substring(1) : typeStrRaw;
                    typeStrSanitized = typeStrSanitized.replace(/\s+/g, ' ').trim().toLowerCase();
                } else {
                    typeStrSanitized = ""; 
                }
                
                console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): Tipo lido (original): '${row["Tipo"]}', Sanitizado: '${typeStrSanitized}', Tipo JS: ${typeof typeStrSanitized}`);
                console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): typeStr length: ${typeStrSanitized.length}`);
                for (let k=0; k < typeStrSanitized.length; k++) {
                     console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): CHAR_CODE_LOG charCodeAt(${k}) ('${typeStrSanitized[k]}'): ${typeStrSanitized.charCodeAt(k)}`);
                }
                
                switch (typeStrSanitized) {
                    case 'entrada': mappedType = 'entry'; break;
                    case 'saida': mappedType = 'exit'; break;
                    case 'consumo': mappedType = 'consumption'; break;
                    default:
                        importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Tipo de movimentação inválido ('${row["Tipo"] || 'VAZIO'}'). Use 'entrada', 'saida' ou 'consumo'.`);
                        continue; 
                }
                console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): Tipo sanitizado '${typeStrSanitized}' mapeado para tipo de schema '${mappedType}'`);

                const quantityStr = row["Quantidade"]?.trim();
                const dateStr = row["Data"]?.trim(); 
                const hospitalNameCsv = row["Nome do Hospital Destino/Consumo"]?.trim() || undefined; 
                const unitNameCsv = row["Nome da Unidade Destino/Consumo"]?.trim() || undefined; 
                const patientSUS = row["Cartão SUS Paciente"]?.trim() || undefined; 
                const notesCsv = row["Observações"]?.trim() || undefined; 

                if (!itemCode || !quantityStr || !dateStr) {
                  importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Código do Item, Quantidade e Data são obrigatórios.`);
                  continue;
                }

                const quantity = parseInt(quantityStr, 10);
                if (isNaN(quantity) || quantity <= 0) {
                  importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Quantidade inválida ('${quantityStr}'). Deve ser um número positivo.`);
                  continue;
                }

                const dateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
                let formattedDate = dateStr;
                if (!dateRegex.test(dateStr)) {
                    importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Data inválida ('${dateStr}'). Use o formato AAAA-MM-DD e uma data válida.`);
                    continue;
                }
                try {
                    const parsedDate = new Date(dateStr + "T00:00:00Z"); 
                    if (isNaN(parsedDate.getTime())) throw new Error("Data resultou em NaN após parsing.");
                    const [inputYear, inputMonth, inputDay] = dateStr.split('-').map(Number);
                    if (parsedDate.getUTCFullYear() !== inputYear || (parsedDate.getUTCMonth() + 1) !== inputMonth || parsedDate.getUTCDate() !== inputDay) {
                         throw new Error(`Data inválida (ex: dia inexistente para o mês).`);
                    }
                    formattedDate = parsedDate.toISOString().split('T')[0];
                    console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): Data CSV '${dateStr}' formatada para '${formattedDate}'`);
                } catch (dateParseError: any) {
                    importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Data inválida ('${dateStr}'). Erro: ${dateParseError.message}`);
                    continue;
                }


                const item = items.find(it => it.code === itemCode);
                if (!item) {
                  importErrors.push(`Linha ${rowIndex}: Item com código '${itemCode}' não encontrado.`);
                  continue;
                }

                let hospitalId: string | undefined = undefined;
                let unitId: string | undefined = undefined;
                let patientIdCsv: string | undefined = undefined;

                if (mappedType === 'exit' || mappedType === 'consumption') {
                    if (hospitalNameCsv) {
                        const selectedHospital = hospitals.find(h => h.name.toLowerCase() === hospitalNameCsv.toLowerCase());
                        if (!selectedHospital) {
                            importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Hospital '${hospitalNameCsv}' não encontrado.`);
                            continue; 
                        }
                        hospitalId = selectedHospital.id;
                        const isTargetUBS = selectedHospital.name.toLowerCase().includes('ubs');

                        if (unitNameCsv) {
                            const selectedUnit = servedUnits.find(u => u.name.toLowerCase() === unitNameCsv.toLowerCase() && u.hospitalId === hospitalId);
                            if (!selectedUnit) {
                                importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Unidade '${unitNameCsv}' não encontrada ou não pertence ao hospital '${hospitalNameCsv}'.`);
                                continue; 
                            }
                            unitId = selectedUnit.id;
                        } else { 
                             if (mappedType === 'consumption') {
                                importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Nome da Unidade é obrigatório para tipo 'consumo' se um hospital foi especificado.`);
                                continue;
                             }
                             if (mappedType === 'exit' && !isTargetUBS) {
                                importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Nome da Unidade é obrigatório para tipo 'saida' para o hospital '${hospitalNameCsv}' (que não é UBS).`);
                                continue;
                             }
                        }
                    }
                }
                
                if (mappedType === 'consumption' && patientSUS) {
                    const patient = patients.find(p => p.susCardNumber === patientSUS);
                    if (!patient) {
                        importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Paciente com Cartão SUS '${patientSUS}' não encontrado.`);
                        continue;
                    }
                    patientIdCsv = patient.id;
                }
                
                const movementDataForTransaction = {
                    itemId: item.id,
                    type: mappedType, 
                    quantity: quantity,
                    date: formattedDate, 
                    hospitalId: hospitalId,
                    unitId: unitId,
                    patientId: patientIdCsv,
                    notes: notesCsv,
                };

                console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): PRÉ-TRANSAÇÃO - Dados para movimentação:`, JSON.stringify(movementDataForTransaction));
                
                try {
                    console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): Iniciando runTransaction.`);
                    await runTransaction(firestore, (transaction) => 
                        processMovementRowTransaction(
                            transaction,
                            movementDataForTransaction,
                            item, 
                            rowIndex,
                            itemCodeForRow,
                            items, hospitals, servedUnits, patients,
                            hospitalNameCsv, unitNameCsv, notesCsv
                        )
                    );
                    console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): PÓS-TRANSAÇÃO - runTransaction CONCLUÍDO com sucesso (resolved). successfulImports antes: ${successfulImports}`);
                    successfulImports++;
                    console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): PÓS-TRANSAÇÃO - successfulImports depois: ${successfulImports}`);
                } catch (transactionError: any) { 
                    console.error(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): ERRO NA TRANSAÇÃO - `, transactionError.message, transactionError.stack);
                    importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Erro ao processar no banco: ${transactionError.message}`);
                }

            } catch (syncError: any) { 
                console.error(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): Erro de preparação/validação da linha - `, syncError.message, syncError.stack);
                importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Erro de preparação/validação - ${syncError.message}`);
            }
          } 
          console.log("BATCH IMPORT: Processamento de todas as linhas concluído.");

          if (importErrors.length > 0) {
            toast({
              title: `Erros na Importação (${importErrors.length} falhas de ${rows.length} linhas)`,
              description: (
                <div className="max-h-60 overflow-y-auto text-xs">
                  {importErrors.map((err, i) => <p key={i}>{err}</p>)}
                </div>
              ),
              variant: "destructive",
              duration: successfulImports > 0 ? 15000 : 20000, 
            });
          }
          if (successfulImports > 0) {
            toast({
              title: "Importação Parcial/Total Concluída",
              description: `${successfulImports} de ${rows.length} movimentaçõe(s) importada(s) com sucesso.`,
              variant: "default",
              duration: 10000,
            });
          }
          if (successfulImports === 0 && importErrors.length === 0 && rows.length > 0) { 
            toast({ title: "Nenhuma Movimentação Válida", description: "Nenhuma movimentação válida encontrada na planilha ou todas falharam na validação inicial.", variant: "default" });
          }
          
          setIsProcessing(false);
          console.log("BATCH IMPORT: Estado isProcessing definido como false.");
          setFile(null);
          const fileInput = document.getElementById('batch-movements-file-input') as HTMLInputElement | null;
          if (fileInput) fileInput.value = "";
        },
        error: (err: any) => { 
          toast({ title: "Erro Crítico de Leitura do CSV", description: `Não foi possível processar o arquivo CSV: ${err.message}. Verifique o formato do arquivo e o console.`, variant: "destructive" });
          console.error("BATCH IMPORT: Erro crítico de parsing PapaParse:", err);
          setIsProcessing(false);
        }
      });
    };
    reader.readAsText(file, 'UTF-8'); 
  };


  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">Importar Movimentações em Lote</CardTitle>
        <CardDescription>
          Faça o upload de um arquivo .csv contendo os dados das movimentações.
          A primeira linha da planilha deve ser o cabeçalho.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
         <Alert>
            <Download className="h-4 w-4" />
            <AlertTitle>Formato da Planilha de Movimentações</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                Sua planilha CSV deve ter as seguintes colunas, nesta ordem:
              </p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li><code>Código do Item</code> (Texto, Obrigatório)</li>
                <li><code>Tipo</code> (Texto, Obrigatório - 'entrada', 'saida' ou 'consumo')</li>
                <li><code>Quantidade</code> (Número, Obrigatório - Positivo)</li>
                <li><code>Data</code> (Data AAAA-MM-DD, Obrigatório)</li>
                <li><code>Nome do Hospital Destino/Consumo</code> (Texto, Opcional/Condicional)</li>
                <li><code>Nome da Unidade Destino/Consumo</code> (Texto, Opcional/Condicional)</li>
                <li><code>Cartão SUS Paciente</code> (Texto, Opcional - 15 dígitos numéricos, apenas para 'consumo')</li>
                <li><code>Observações</code> (Texto, Opcional)</li>
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                <strong>Notas sobre Hospitais/Unidades:</strong><br/>
                - Para <strong>entrada</strong>: Deixe 'Nome do Hospital' e 'Nome da Unidade' em branco (entrada é sempre no Armazém Central).<br/>
                - Para <strong>saida</strong> ou <strong>consumo</strong> que seja uma <strong>baixa direta do Armazém Central</strong>: Deixe 'Nome do Hospital' e 'Nome da Unidade' em branco.<br/>
                - Para <strong>saida (transferência) para uma UBS</strong> como um todo: Preencha 'Nome do Hospital' (com o nome da UBS) e deixe 'Nome da Unidade' em branco.<br/>
                - Para <strong>saida (transferência) para um Hospital (não UBS) ou para um setor específico de uma UBS</strong>: Preencha 'Nome do Hospital' e 'Nome da Unidade'.<br/>
                - Para <strong>consumo</strong>: Se ocorrer em um hospital/UBS, preencha 'Nome do Hospital' e 'Nome da Unidade'.<br/>
                Os nomes de hospital e unidade devem corresponder exatamente aos cadastrados no sistema.
              </p>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="mt-4">
                <Download className="mr-2 h-4 w-4" /> Baixar Planilha Modelo (.csv)
              </Button>
            </AlertDescription>
          </Alert>

        <div className="grid w-full max-w-md items-center gap-2">
          <Label htmlFor="batch-movements-file-input">Arquivo CSV</Label>
          <Input
            id="batch-movements-file-input"
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="cursor-pointer file:cursor-pointer file:font-semibold file:text-primary"
            disabled={isProcessing || isLoadingDataFromParent}
          />
          {file && <p className="text-sm text-muted-foreground mt-2">Arquivo selecionado: {file.name}</p>}
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleSubmit} disabled={!file || isProcessing || isLoadingDataFromParent}>
          {isLoadingDataFromParent ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando dados...
            </>
          ) : isProcessing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processando...
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" /> Processar Planilha
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
};


export default function StockMovementsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const { toast } = useToast();
  const [isLoadingData, setIsLoadingData] = useState(true);


  useEffect(() => {
    setIsLoadingData(true);
    const listeners = [
      { coll: "items", setter: setItems, msg: "Itens" },
      { coll: "hospitals", setter: setHospitals, msg: "Hospitais" },
      { coll: "servedUnits", setter: setServedUnits, msg: "Unidades Servidas" },
      { coll: "patients", setter: setPatients, msg: "Pacientes" },
    ];
    
    let loadedCount = 0;
    const unsubscribers: (()=>void)[] = [];

    listeners.forEach(config => {
      const q = query(collection(firestore, config.coll), orderBy("name", "asc"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        config.setter(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
        loadedCount++;
        if (loadedCount === listeners.length) setIsLoadingData(false);
      }, (error) => {
        console.error(`Erro ao buscar ${config.msg}: `, error);
        toast({ title: `Erro ao Carregar ${config.msg}`, variant: "destructive" });
        loadedCount++; 
        if (loadedCount === listeners.length) setIsLoadingData(false);
      });
      unsubscribers.push(unsubscribe);
    });
    
    return () => unsubscribers.forEach(unsub => unsub());
  }, [toast]);

  return (
    <div>
      <PageHeader title="Registrar Movimentação de Estoque" description="Registre entradas, saídas ou consumos de itens, manualmente ou via planilha." icon={ArrowRightLeft} />
      <Tabs defaultValue="manual" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:w-1/2 lg:w-1/3 mb-6">
          <TabsTrigger value="manual" disabled={isLoadingData}>
            {isLoadingData && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Registrar Manualmente
          </TabsTrigger>
          <TabsTrigger value="import" disabled={isLoadingData}>
            {isLoadingData && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Importar Planilha CSV
          </TabsTrigger>
        </TabsList>
        <TabsContent value="manual">
          {isLoadingData ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-3 text-muted-foreground">Carregando dados para o formulário...</p>
            </div>
          ) : (
            <ManualMovementForm items={items} servedUnits={servedUnits} hospitals={hospitals} patients={patients} />
          )}
        </TabsContent>
        <TabsContent value="import">
         {isLoadingData ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-3 text-muted-foreground">Carregando dados de referência para importação...</p>
            </div>
          ) : (
            <BatchImportMovementsForm 
                items={items} 
                servedUnits={servedUnits} 
                hospitals={hospitals} 
                patients={patients} 
                isLoadingDataFromParent={isLoadingData}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
    
