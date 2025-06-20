
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
import { ArrowRightLeft, Loader2, Upload, Download, ShieldAlert } from 'lucide-react';
import type { Item, ServedUnit, Hospital, Patient, StockMovement, UserProfile, StockMovementType, FirestoreStockConfig } from '@/types';
import { useState, useEffect, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, runTransaction, Transaction } from 'firebase/firestore';
import Papa, { type ParseError } from 'papaparse';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useRouter } from 'next/navigation';


const CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE = "CENTRAL_WAREHOUSE_DIRECT_EXIT";
const UBS_GENERAL_STOCK_SUFFIX = "UBSGENERAL";


// Schema for Entry/Exit movements only
const movementSchema = z.object({
  itemId: z.string().min(1, "A seleção do item é obrigatória."),
  type: z.enum(['entry', 'exit'], { required_error: "O tipo de movimentação é obrigatório." }),
  quantity: z.coerce.number().positive("A quantidade deve ser um número positivo."),
  hospitalId: z.string().optional(), // For exit to hospital/unit
  unitId: z.string().optional(),     // For exit to unit
  date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Data inválida." }),
  notes: z.string().optional(),
}).refine(data => {
  if (data.type === 'exit' && data.hospitalId && data.hospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE && !data.unitId) {
    // If exiting to a specific hospital (not direct warehouse exit), and that hospital is a UBS, unitId is not strictly required (implies general stock)
    // However, if it's a regular hospital, unitId should be there.
    // This check is now simpler as 'consumption' is out.
    // For 'exit' to a specific hospital, unit must be provided or it's a direct exit/baixa
    // For now, let's assume if hospitalId is given for 'exit', unitId is expected unless it's a UBS general stock (handled by placeholder)
    // Or, if hospitalId is CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE, then unitId must NOT be present.
    // This schema does not use GENERAL_STOCK_UNIT_ID_PLACEHOLDER, that's UI only.
    // The transaction logic will infer general UBS stock if hospital is UBS and unitId is undefined.
  }
  return true;
}, {
  message: "Para Saída para um Hospital específico, a Unidade Servida deve ser selecionada (ou ser baixa direta).",
  path: ["unitId"],
});


type MovementFormData = z.infer<typeof movementSchema>;

// This transaction function is now more generic and used by both movement and consumption pages
export async function processMovementRowTransaction(
  transaction: Transaction,
  movementData: Omit<StockMovement, 'id' | 'itemName' | 'hospitalName' | 'unitName' | 'patientName' | 'userDisplayName' | 'userId'> & { itemId: string },
  currentUserProfile: UserProfile,
  allMasterItems: Item[],
  allMasterHospitals: Hospital[],
  allMasterServedUnits: ServedUnit[],
  allMasterPatients: Patient[],
  rowIndexForLog?: number, // For batch import logging
  itemCodeForLog?: string, // For batch import logging
  hospitalNameForLog?: string, // For batch import logging
  unitNameForLog?: string, // For batch import logging
  notesForLog?: string // For batch import logging
) {
    const itemDocRef = doc(firestore, "items", movementData.itemId);
    const itemSnap = await transaction.get(itemDocRef);
    if (!itemSnap.exists()) {
        throw new Error(`Item ${movementData.itemId} (Código: ${itemCodeForLog || 'N/A'}) não encontrado (linha ${rowIndexForLog || 'manual'}).`);
    }
    const currentItemData = itemSnap.data() as Item;

    let unitConfigDocRef = null;
    let unitConfigSnap = null;
    let unitConfigDocId: string | null = null;

    const hospitalForMovement = movementData.hospitalId ? allMasterHospitals.find(h => h.id === movementData.hospitalId) : null;
    const isUbsGeneralStockMovement =
        (movementData.type === 'consumption' || movementData.type === 'exit') && // Exit to UBS general is also possible
        movementData.hospitalId &&
        !movementData.unitId &&
        (hospitalForMovement?.name.toLowerCase().includes('ubs') || false);

    if (movementData.hospitalId) {
        if (movementData.unitId) {
            unitConfigDocId = `${movementData.itemId}_${movementData.unitId}`;
        } else if (isUbsGeneralStockMovement) {
            unitConfigDocId = `${movementData.itemId}_${movementData.hospitalId}_${UBS_GENERAL_STOCK_SUFFIX}`;
        }
        if (unitConfigDocId) {
            unitConfigDocRef = doc(firestore, "stockConfigs", unitConfigDocId);
            unitConfigSnap = await transaction.get(unitConfigDocRef);
        }
    }

    if (movementData.type === 'entry') {
        if (currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator') {
            throw new Error("Apenas Admin ou Operador Central podem registrar entradas.");
        }
        let currentCentralQty = currentItemData.currentQuantityCentral || 0;
        const newQuantityCentral = currentCentralQty + movementData.quantity;
        transaction.update(itemDocRef, { currentQuantityCentral: newQuantityCentral });
    } else if (movementData.type === 'exit') {
        if (currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator') {
            throw new Error("Apenas Admin ou Operador Central podem registrar saídas/transferências.");
        }
         if (!movementData.hospitalId && !unitConfigDocId) { // Baixa direta do Central (hospitalId is falsy, e.g. CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE was selected and processed)
            let currentCentralQty = currentItemData.currentQuantityCentral || 0;
            if (currentCentralQty < movementData.quantity) {
                throw new Error(`Estoque insuficiente (${currentCentralQty}) no Armazém Central para ${currentItemData.name}. Necessário: ${movementData.quantity}`);
            }
            const newQuantityCentral = currentCentralQty - movementData.quantity;
            transaction.update(itemDocRef, { currentQuantityCentral: newQuantityCentral });
        } else if (movementData.hospitalId && unitConfigDocRef) { // Transferência para unidade/UBS Geral
            let currentCentralQty = currentItemData.currentQuantityCentral || 0;
            if (currentCentralQty < movementData.quantity) {
                throw new Error(`Estoque insuficiente (${currentCentralQty}) no Armazém Central para ${currentItemData.name}. Necessário: ${movementData.quantity}`);
            }
            const newCentralQuantityAfterTransfer = currentCentralQty - movementData.quantity;
            transaction.update(itemDocRef, { currentQuantityCentral: newCentralQuantityAfterTransfer });

            let currentTargetQty = 0;
            if (unitConfigSnap && unitConfigSnap.exists()) {
                currentTargetQty = unitConfigSnap.data().currentQuantity || 0;
            }
            const newTargetQuantity = currentTargetQty + movementData.quantity;
            const targetConfigData: Partial<FirestoreStockConfig> & { itemId: string; hospitalId: string; currentQuantity: number; unitId?: string } = {
                itemId: movementData.itemId,
                hospitalId: movementData.hospitalId,
                currentQuantity: newTargetQuantity,
            };
             if(movementData.unitId) targetConfigData.unitId = movementData.unitId;
            transaction.set(unitConfigDocRef, targetConfigData, { merge: true });
        } else {
            throw new Error("Destino (Hospital e Unidade/Estoque Geral UBS, ou Baixa Direta) é obrigatório para saída/transferência.");
        }
    } else if (movementData.type === 'consumption') {
        // This part of the transaction is primarily for the consumption page or admin/centralOp doing consumption
        if (currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator') {
            if (!movementData.hospitalId && !unitConfigDocRef) { // Consumo direto do Central
                let currentCentralQty = currentItemData.currentQuantityCentral || 0;
                if (currentCentralQty < movementData.quantity) {
                    throw new Error(`Estoque insuficiente (${currentCentralQty}) no Armazém Central para ${currentItemData.name}. Necessário: ${movementData.quantity}`);
                }
                const newCentralQuantity = currentCentralQty - movementData.quantity;
                transaction.update(itemDocRef, { currentQuantityCentral: newCentralQuantity });
            } else if (unitConfigDocRef) { // Consumo de uma unidade/UBS Geral por Admin/Central
                 if (!unitConfigSnap || !unitConfigSnap.exists()) {
                    throw new Error(`Configuração de estoque não encontrada para ${currentItemData.name} no local de consumo (ID: ${unitConfigDocId}). Estoque inicial pode não ter sido transferido.`);
                }
                let currentUnitQty = unitConfigSnap.data().currentQuantity || 0;
                if (currentUnitQty < movementData.quantity) {
                    throw new Error(`Estoque insuficiente (${currentUnitQty}) no local de consumo para ${currentItemData.name}. Necessário: ${movementData.quantity}`);
                }
                const newUnitQuantity = currentUnitQty - movementData.quantity;
                transaction.update(unitConfigDocRef, { currentQuantity: newUnitQuantity });
            } else {
                 throw new Error("Destino de consumo inválido para Admin/Operador Central.");
            }
        } else if (currentUserProfile.role === 'hospital_operator' || currentUserProfile.role === 'ubs_operator') {
            // This specific block will be more relevant for the dedicated consumption page
            if (!movementData.hospitalId || currentUserProfile.associatedHospitalId !== movementData.hospitalId) {
                throw new Error("Operador não autorizado para este hospital.");
            }
             // Check if unitId is required based on user's associatedUnitId
            if (currentUserProfile.associatedUnitId && currentUserProfile.associatedUnitId !== movementData.unitId) {
                 throw new Error("Operador não autorizado para esta unidade específica.");
            }
             // If user is a general UBS operator (no associatedUnitId) but unitId is provided in movement (not placeholder)
            if (!currentUserProfile.associatedUnitId && movementData.unitId) {
                // Allow if unitId belongs to the operator's hospital
                const unit = allMasterServedUnits.find(u => u.id === movementData.unitId);
                if (!unit || unit.hospitalId !== currentUserProfile.associatedHospitalId) {
                     throw new Error("Operador UBS geral não autorizado para esta unidade específica fora do seu hospital.");
                }
            }


            if (!unitConfigDocRef) {
                 throw new Error("Local de consumo (unidade ou estoque geral UBS) não especificado ou inválido para operador.");
            }
            if (!unitConfigSnap || !unitConfigSnap.exists()) {
                throw new Error(`Configuração de estoque não encontrada para ${currentItemData.name} no local de consumo do operador (ID: ${unitConfigDocId}). Estoque inicial pode não ter sido transferido.`);
            }
            let currentUnitQty = unitConfigSnap.data().currentQuantity || 0;
            if (currentUnitQty < movementData.quantity) {
                throw new Error(`Estoque insuficiente (${currentUnitQty}) no local para ${currentItemData.name}. Necessário: ${movementData.quantity}`);
            }
            const newUnitQuantity = currentUnitQty - movementData.quantity;
            transaction.update(unitConfigDocRef, { currentQuantity: newUnitQuantity });
        } else {
            throw new Error("Tipo de usuário não autorizado para registrar consumo por esta via.");
        }
    }

    const itemDetailsForLog = allMasterItems.find(i => i.id === movementData.itemId);
    const hospitalDetailsForLog = movementData.hospitalId ? allMasterHospitals.find(h => h.id === movementData.hospitalId) : null;
    const unitDetailsForLog = movementData.unitId ? allMasterServedUnits.find(u => u.id === movementData.unitId) : null;
    const patientDetailsForLog = movementData.patientId ? allMasterPatients.find(p => p.id === movementData.patientId) : null;

    const movementLog: Omit<StockMovement, 'id'> = {
        itemId: movementData.itemId,
        itemName: itemDetailsForLog?.name || itemCodeForLog || "Item Desconhecido",
        type: movementData.type as StockMovementType,
        quantity: movementData.quantity,
        date: movementData.date,
        notes: movementData.notes || notesForLog || null,
        hospitalId: movementData.hospitalId || null,
        hospitalName: hospitalDetailsForLog?.name || hospitalNameForLog || null,
        unitId: movementData.unitId || null,
        unitName: unitDetailsForLog?.name || unitNameForLog || (isUbsGeneralStockMovement ? `Estoque Geral (${hospitalDetailsForLog?.name})` : null),
        patientId: movementData.patientId || null,
        patientName: patientDetailsForLog?.name || null,
        userId: currentUserProfile.id || "unknown_user_id",
        userDisplayName: currentUserProfile.name || "Unknown User",
    };
    const stockMovementsCollectionRef = collection(firestore, "stockMovements");
    transaction.set(doc(stockMovementsCollectionRef), movementLog);
}


const ManualMovementForm = ({ items, servedUnits, hospitals, stockConfigs }: { items: Item[], servedUnits: ServedUnit[], hospitals: Hospital[], stockConfigs: FirestoreStockConfig[] }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { currentUserProfile, user: firebaseUser } = useAuth(); // Not using firebaseUser directly here

  const form = useForm<MovementFormData>({
    resolver: zodResolver(movementSchema),
    defaultValues: {
      type: 'entry', // Default for this page
      quantity: 1,
      date: new Date().toISOString().split('T')[0],
      notes: '',
      hospitalId: undefined,
      unitId: undefined,
      itemId: undefined,
    },
  });

  const movementType = form.watch('type');
  const selectedHospitalIdForm = form.watch('hospitalId');

  useEffect(() => {
    // This form is only for entry/exit, patientId is not relevant here.
    // Reset hospital/unit if type is entry
    if (movementType === 'entry') {
        form.setValue('hospitalId', undefined, { shouldValidate: false });
        form.setValue('unitId', undefined, { shouldValidate: false });
    }
  }, [movementType, form]);

   useEffect(() => {
     // Reset unit if hospital changes
    if(form.getValues('hospitalId') !== selectedHospitalIdForm && selectedHospitalIdForm !== form.getValues('hospitalId')) {
        form.setValue('unitId', undefined, { shouldValidate: true }); // Validate as unit might become required
    }
  }, [selectedHospitalIdForm, form]);


  const availableUnits = useMemo(() => {
    if (!selectedHospitalIdForm || selectedHospitalIdForm === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
      return [];
    }
    return servedUnits.filter(unit => unit.hospitalId === selectedHospitalIdForm);
  }, [selectedHospitalIdForm, servedUnits]);


  const getDisplayStockForItem = (item: Item): number | string => {
    if (!currentUserProfile) return item.currentQuantityCentral; // Fallback, though profile should exist

    const formValues = form.getValues();
    const currentMovementType = formValues.type;
    const currentHospitalId = formValues.hospitalId;
    const currentUnitIdValue = formValues.unitId;

    // For this form (entry/exit by admin/central_op)
    if (currentMovementType === 'entry' || (!currentHospitalId || currentHospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE)) {
        // If entry, or if exit is direct from central, show central stock
        return item.currentQuantityCentral;
    }

    // If exiting TO a specific unit/UBS general stock, we still show Central stock as source
    // because the transfer reduces central stock. The target stock is not the primary concern for this form's "available" display.
    return item.currentQuantityCentral;
  };


  const onSubmit = async (data: MovementFormData) => {
    if (!currentUserProfile || !firebaseUser) { // firebaseUser needed for UID in transaction
        toast({ title: "Erro de Autenticação", description: "Usuário não autenticado.", variant: "destructive" });
        return;
    }
    if (currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator') {
        toast({ title: "Permissão Negada", description: "Apenas Administradores ou Operadores do Almoxarifado Central podem realizar esta operação.", variant: "destructive" });
        return;
    }

    setIsSubmitting(true);

    let processedData = {...data};
    if (data.hospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
        processedData.hospitalId = undefined; // Process CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE to undefined
        processedData.unitId = undefined;
    }

    const movementForTransaction: Omit<StockMovement, 'id' | 'itemName' | 'hospitalName' | 'unitName' | 'patientName' | 'userDisplayName' | 'userId' | 'patientId'> & { itemId: string } = {
        itemId: processedData.itemId,
        type: processedData.type,
        quantity: processedData.quantity,
        date: processedData.date,
        notes: processedData.notes,
        hospitalId: processedData.hospitalId,
        unitId: processedData.unitId,
    };


    try {
      // Dummy patients array for processMovementRowTransaction as it's not used for entry/exit
      const dummyPatients: Patient[] = [];
      await runTransaction(firestore, (transaction) =>
        processMovementRowTransaction(
            transaction,
            movementForTransaction,
            currentUserProfile,
            items, hospitals, servedUnits, dummyPatients
        )
      );

      const itemDetails = items.find(i => i.id === processedData.itemId);
      let description = `Movimentação de ${processedData.quantity} unidade(s) de ${itemDetails?.name || processedData.itemId} registrada como ${processedData.type}.`;

      if (processedData.type === 'exit') {
          const hospitalDesc = processedData.hospitalId ? hospitals.find(h => h.id === processedData.hospitalId) : null;
          const unitDesc = processedData.unitId ? servedUnits.find(u => u.id === processedData.unitId) : null;
          const hospitalForMovement = processedData.hospitalId ? hospitals.find(h => h.id === processedData.hospitalId) : null;
          const isUbsGeneralStockMovementForDesc = processedData.hospitalId && !processedData.unitId && (hospitalForMovement?.name.toLowerCase().includes('ubs') || false);


          if (unitDesc && hospitalDesc) {
              description += ` para ${unitDesc.name} (${hospitalDesc.name}).`;
          } else if (hospitalDesc && isUbsGeneralStockMovementForDesc) {
              description += ` para Estoque Geral (${hospitalDesc.name}).`;
          } else if (!processedData.hospitalId) { // Implies CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE was chosen
              description += ` (Baixa direta do Armazém Central).`;
          }
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

  if (!currentUserProfile) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="animate-spin h-8 w-8" /> <p className="ml-2">Carregando perfil...</p></div>;
  }

  // This page is now only for admin and central_operator
  if (currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator') {
    return (
        <Card className="max-w-2xl mx-auto shadow-lg">
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2"><ShieldAlert className="h-6 w-6 text-destructive" /> Acesso Negado</CardTitle>
            </CardHeader>
            <CardContent>
                <p>Esta funcionalidade é restrita a Administradores e Operadores do Almoxarifado Central.</p>
            </CardContent>
        </Card>
    );
  }

  return (
      <Card className="max-w-2xl mx-auto shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Nova Entrada/Saída (Alm. Central)</CardTitle>
          <CardDescription>Operador: {currentUserProfile.name} ({currentUserProfile.role})</CardDescription>
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
                        value={field.value}
                        className="flex flex-col space-y-1 md:flex-row md:space-y-0 md:space-x-4"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl><RadioGroupItem value="entry" /></FormControl>
                          <FormLabel className="font-normal">Entrada (Almoxarifado Central)</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl><RadioGroupItem value="exit" /></FormControl>
                          <FormLabel className="font-normal">Saída (Transferência/Baixa)</FormLabel>
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
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecione um item" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {items.length === 0 && <SelectItem value="loading" disabled>Carregando itens...</SelectItem>}
                        {items.map(item => (
                            <SelectItem key={item.id} value={item.id}>
                                {item.name} ({item.code}) - Disponível Central: {getDisplayStockForItem(item)}
                            </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {movementType === 'exit' && (
                <>
                  <FormField
                    control={form.control}
                    name="hospitalId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Hospital de Destino (para Transferência)</FormLabel>
                        <Select
                            onValueChange={field.onChange}
                            value={field.value ?? CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE}
                        >
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione um hospital ou baixa direta" /></SelectTrigger></FormControl>
                          <SelectContent>
                             <SelectItem value={CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE}>Nenhum (Baixa direta do Armazém Central)</SelectItem>
                            {hospitals.map(hospital => <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                         <FormDescription>
                            Selecione o hospital para transferir ou "Nenhum" para baixa direta.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {selectedHospitalIdForm && selectedHospitalIdForm !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE && (
                    <FormField
                      control={form.control}
                      name="unitId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Unidade Servida de Destino</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value ?? undefined}
                            disabled={!selectedHospitalIdForm || availableUnits.length === 0 && !hospitals.find(h=>h.id === selectedHospitalIdForm)?.name.toLowerCase().includes('ubs')}
                          >
                            <FormControl><SelectTrigger>
                                <SelectValue placeholder={
                                    availableUnits.length > 0 || hospitals.find(h=>h.id === selectedHospitalIdForm)?.name.toLowerCase().includes('ubs')
                                    ? "Selecione unidade ou Estoque Geral UBS"
                                    : "Nenhuma unidade/Estoque Geral p/ este hospital"
                                } />
                            </SelectTrigger></FormControl>
                            <SelectContent>
                              {hospitals.find(h=>h.id === selectedHospitalIdForm)?.name.toLowerCase().includes('ubs') &&
                                <SelectItem value={""} >Estoque Geral da UBS</SelectItem>
                              }
                              {availableUnits.map(unit => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                           <FormDescription>
                                Unidade para a qual o item está sendo transferido. Se for uma UBS, pode ser "Estoque Geral da UBS".
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


const BatchImportMovementsForm = ({ items, servedUnits, hospitals, isLoadingDataFromParent }: { items: Item[], servedUnits: ServedUnit[], hospitals: Hospital[], isLoadingDataFromParent: boolean }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { currentUserProfile, user: firebaseUser } = useAuth();

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
    const csvHeader = "Código do Item,Tipo,Quantidade,Data,Nome do Hospital Destino,Nome da Unidade Destino,Observações\n"; // Sem Paciente
    const csvExampleRow1 = "ITEM001,entrada,100,2024-01-15,,,,\n";
    const csvExampleRow2 = "ITEM002,saida,10,2024-01-16,Hospital Central,UTI Geral,Transferência urgente\n";
    const csvExampleRow3 = "ITEM001,saida,5,2024-01-18,,,Baixa por ajuste de inventário\n";
    const csvExampleRow4 = "ITEM004,saida,20,2024-01-19,UBS Vila Sol,,Transferência para estoque geral da UBS\n";


    const csvContent = BOM + csvHeader + csvExampleRow1 + csvExampleRow2 + csvExampleRow3 + csvExampleRow4;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");

    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", "modelo_importacao_entradas_saidas.csv");
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({ title: "Download Iniciado", description: "O arquivo modelo_importacao_entradas_saidas.csv está sendo baixado." });
    } else {
      toast({ title: "Erro no Download", description: "Seu navegador não suporta o download automático.", variant: "destructive" });
    }
  };

  const handleSubmit = async () => {
    if (!file) {
      toast({ title: "Erro", description: "Por favor, selecione um arquivo CSV para importar.", variant: "destructive" });
      return;
    }
    if (!currentUserProfile || !firebaseUser) {
        toast({ title: "Erro de Autenticação", description: "Perfil do usuário não carregado.", variant: "destructive" });
        return;
    }
     if (currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator') {
        toast({ title: "Permissão Negada", description: "Apenas Administradores ou Operadores do Almoxarifado Central podem importar movimentações em lote.", variant: "destructive" });
        return;
    }

    setIsProcessing(true);
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
          const { data: rows, errors: parseErrors } = results;

          if (parseErrors.length > 0) {
            const errorMessages = parseErrors.map((err: Papa.ParseError, index: number) => {
              const rowInfo = typeof err.row === 'number' ? `Linha CSV ${err.row + 2} (dados linha ${err.row +1}): ` : `Erro genérico ${index + 1}: `;
              return `${rowInfo}${err.message || "Erro desconhecido"}`;
            });
            toast({
                title: "Erro ao Processar CSV",
                description: <div className="max-h-60 overflow-y-auto text-xs">{errorMessages.map((msg, i) => <p key={i}>{msg}</p>)}</div>,
                variant: "destructive", duration: 20000
            });
            setIsProcessing(false);
            return;
          }
          if (rows.length === 0) {
            toast({ title: "Arquivo Vazio", description: "O arquivo CSV não contém dados.", variant: "destructive" });
            setIsProcessing(false);
            return;
          }

          let successfulImports = 0;
          const importErrors: string[] = [];

          const BATCH_SIZE_DOCS = 150;
          for (let i = 0; i < rows.length; i += BATCH_SIZE_DOCS) {
            const batchRows = rows.slice(i, i + BATCH_SIZE_DOCS);

            for (let j = 0; j < batchRows.length; j++) {
                const row = batchRows[j];
                const originalRowIndex = i + j + 2;
                let itemCodeForRow = row["Código do Item"]?.trim() || "N/A";

                try {
                    let typeStrRaw = row["Tipo"];
                    let typeStr: string;
                    if (typeof typeStrRaw === 'string') {
                        typeStr = typeStrRaw.replace(/\s+/g, ' ').trim().toLowerCase();
                    } else { typeStr = ""; }

                    const quantityStr = row["Quantidade"]?.trim();
                    const dateStr = row["Data"]?.trim();
                    const hospitalNameCsv = row["Nome do Hospital Destino"]?.trim(); // Nome da coluna ajustado
                    const unitNameCsv = row["Nome da Unidade Destino"]?.trim();   // Nome da coluna ajustado
                    const notesCsv = row["Observações"]?.trim();

                    if (!itemCodeForRow || itemCodeForRow === "N/A" || !typeStr || !quantityStr || !dateStr) {
                        importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Código do Item, Tipo, Quantidade e Data são obrigatórios.`);
                        continue;
                    }
                    const isValidType = typeStr === 'entrada' || typeStr === 'saida'; // Apenas entrada ou saida
                    if (!isValidType) {
                        importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Tipo inválido ('${row["Tipo"]}'). Use 'entrada' ou 'saida'.`);
                        continue;
                    }
                    const quantity = parseInt(quantityStr, 10);
                    if (isNaN(quantity) || quantity <= 0) {
                        importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Quantidade inválida ('${quantityStr}').`);
                        continue;
                    }
                    const dateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
                    if (!dateRegex.test(dateStr)) {
                        importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Data inválida ('${dateStr}'). Use AAAA-MM-DD.`);
                        continue;
                    }
                     const parsedDate = new Date(dateStr + "T00:00:00Z"); // Assegurar que é tratado como UTC para evitar problemas de fuso
                    if (isNaN(parsedDate.getTime())) {
                         importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Data inválida ('${dateStr}') após parsing.`);
                         continue;
                    }
                    const formattedDate = parsedDate.toISOString().split('T')[0];


                    const item = items.find(it => it.code === itemCodeForRow);
                    if (!item) {
                        importErrors.push(`Linha ${originalRowIndex}: Item com código '${itemCodeForRow}' não encontrado.`);
                        continue;
                    }

                    let hospitalId: string | undefined = undefined;
                    let unitId: string | undefined = undefined;

                    if (typeStr === 'saida') {
                        if (hospitalNameCsv) {
                            const hospital = hospitals.find(h => h.name.toLowerCase() === hospitalNameCsv.toLowerCase());
                            if (!hospital) {
                                importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Hospital '${hospitalNameCsv}' não encontrado.`);
                                continue;
                            }
                            hospitalId = hospital.id;
                            if (unitNameCsv) {
                                const unit = servedUnits.find(u => u.name.toLowerCase() === unitNameCsv.toLowerCase() && u.hospitalId === hospitalId);
                                if (!unit) {
                                    importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Unidade '${unitNameCsv}' não encontrada ou não pertence ao hospital '${hospitalNameCsv}'.`);
                                    continue;
                                }
                                unitId = unit.id;
                            } else {
                                 // Se hospitalNameCsv está presente mas unitNameCsv não,
                                 // pode ser uma transferência para o estoque geral de uma UBS.
                                 // A lógica em processMovementRowTransaction tratará unitId como undefined para este caso.
                                 const hospitalIsUbs = hospital?.name.toLowerCase().includes('ubs');
                                 if (!hospitalIsUbs && typeStr === 'saida') { // Saída para hospital não-UBS requer unidade
                                     importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Saída para Hospital ('${hospitalNameCsv}') que não é UBS requer uma unidade específica.`);
                                     continue;
                                 }
                            }
                        } // Se hospitalNameCsv não estiver presente para 'saida', é uma baixa direta do central.
                    }

                    const movementDataForTx: Omit<StockMovement, 'id' | 'itemName' | 'hospitalName' | 'unitName' | 'patientName' | 'patientId' | 'userDisplayName' | 'userId'> & { itemId: string } = {
                        itemId: item.id, type: typeStr as 'entry' | 'exit', quantity, date: formattedDate,
                        hospitalId, unitId, notes: notesCsv
                    };

                    // Dummy patients array for processMovementRowTransaction as it's not used for entry/exit
                    const dummyPatients: Patient[] = [];
                    await runTransaction(firestore, (transaction) =>
                        processMovementRowTransaction(
                            transaction,
                            movementDataForTx,
                            currentUserProfile,
                            items, hospitals, servedUnits, dummyPatients, // Pass dummy patients
                            originalRowIndex, itemCodeForRow, hospitalNameCsv, unitNameCsv, notesCsv
                        )
                    );
                    successfulImports++;

                } catch (rowError: any) {
                    importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): ${rowError.message}`);
                }
            }
          }


          if (importErrors.length > 0) {
            toast({
              title: `Erros na Importação (${importErrors.length} falhas de ${rows.length} linhas)`,
              description: <div className="max-h-60 overflow-y-auto text-xs">{importErrors.map((err, i) => <p key={i}>{err}</p>)}</div>,
              variant: "destructive", duration: successfulImports > 0 ? 15000 : 20000,
            });
          }
          if (successfulImports > 0) {
            toast({ title: "Importação Concluída", description: `${successfulImports} de ${rows.length} movimentaçõe(s) processada(s) com sucesso.`, variant: "default", duration: 10000 });
          }
          if (successfulImports === 0 && importErrors.length === 0 && rows.length > 0) {
            toast({ title: "Nenhuma Movimentação Válida", description: "Nenhuma movimentação válida encontrada.", variant: "default" });
          }

          setIsProcessing(false);
          setFile(null);
          const fileInput = document.getElementById('batch-movements-file-input') as HTMLInputElement | null;
          if (fileInput) fileInput.value = "";
        },
        error: (err) => {
          toast({ title: "Erro Crítico de Leitura do CSV", description: `Não foi possível processar o arquivo CSV: ${err.message}. Verifique o formato.`, variant: "destructive" });
          setIsProcessing(false);
        }
      });
    };
    reader.readAsText(file, 'UTF-8');
  };


  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">Importar Entradas/Saídas em Lote</CardTitle>
        <CardDescription>
          Faça o upload de um arquivo .csv. A primeira linha deve ser o cabeçalho. Apenas Admin/Op.Central.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
         <Alert>
            <Download className="h-4 w-4" />
            <AlertTitle>Formato da Planilha de Entradas/Saídas</AlertTitle>
            <AlertDescription>
              <p className="mb-2">Colunas (nesta ordem):</p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li><code>Código do Item</code> (Texto, Obrigatório)</li>
                <li><code>Tipo</code> (Texto, Obrigatório - 'entrada' ou 'saida')</li>
                <li><code>Quantidade</code> (Número, Obrigatório - Positivo)</li>
                <li><code>Data</code> (Data AAAA-MM-DD, Obrigatório)</li>
                <li><code>Nome do Hospital Destino</code> (Texto, Opcional - para 'saida')</li>
                <li><code>Nome da Unidade Destino</code> (Texto, Opcional - para 'saida' para unidade específica)</li>
                <li><code>Observações</code> (Texto, Opcional)</li>
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                <strong>Notas:</strong><br/>
                - Para <strong>entrada</strong>: Deixe Hospital e Unidade em branco.<br/>
                - Para <strong>saida (baixa direta do Armazém Central)</strong>: Deixe Hospital e Unidade em branco.<br/>
                - Para <strong>saida (transferência para unidade específica)</strong>: Preencha Hospital e Unidade. <br/>
                - Para <strong>saida (transferência para estoque geral de UBS)</strong>: Preencha Hospital (nome da UBS), deixe Unidade em branco.
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
        <Button onClick={handleSubmit} disabled={!file || isProcessing || isLoadingDataFromParent || (currentUserProfile?.role !== 'admin' && currentUserProfile?.role !== 'central_operator')}>
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
  // Patients state not needed here as this page is for entry/exit, not consumption directly
  const [stockConfigs, setStockConfigs] = useState<FirestoreStockConfig[]>([]);
  const { toast } = useToast();
  const [isLoadingData, setIsLoadingData] = useState(true);
  const { currentUserProfile } = useAuth();
  const router = useRouter();


  useEffect(() => {
    setIsLoadingData(true);
    const listeners = [
      { coll: "items", setter: setItems, msg: "Itens" },
      { coll: "hospitals", setter: setHospitals, msg: "Hospitais" },
      { coll: "servedUnits", setter: setServedUnits, msg: "Unidades Servidas" },
      { coll: "stockConfigs", setter: setStockConfigs, msg: "Configurações de Estoque" },
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

    // Ajuste para stockConfigs que não tem campo 'name' para orderBy padrão
    const stockConfigsQuery = query(collection(firestore, "stockConfigs"));
    const unsubscribeStockConfigs = onSnapshot(stockConfigsQuery, (snapshot) => {
        setStockConfigs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FirestoreStockConfig)));
        const stockConfigsListener = listeners.find(l => l.coll === "stockConfigs");
        if (stockConfigsListener && !stockConfigsListener.msg.startsWith("Loaded_")) { // Evitar contagem dupla
            loadedCount++;
            stockConfigsListener.msg = "Loaded_" + stockConfigsListener.msg; // Marcar como carregado
        }
        if (loadedCount >= listeners.length) setIsLoadingData(false);

    }, (error) => {
         console.error(`Erro ao buscar Configurações de Estoque: `, error);
         toast({ title: `Erro ao Carregar Configurações de Estoque`, variant: "destructive" });
         const stockConfigsListener = listeners.find(l => l.coll === "stockConfigs");
         if (stockConfigsListener && !stockConfigsListener.msg.startsWith("Loaded_")) {
            loadedCount++;
            stockConfigsListener.msg = "Loaded_" + stockConfigsListener.msg;
         }
         if (loadedCount >= listeners.length) setIsLoadingData(false);
    });
    unsubscribers.push(unsubscribeStockConfigs);


    return () => unsubscribers.forEach(unsub => unsub());
  }, [toast]);
  
  useEffect(() => {
    // Redirect if user is not admin or central_operator and data has loaded
    if (!isLoadingData && currentUserProfile && currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator') {
      toast({
        title: "Acesso Negado",
        description: "Esta página é restrita a Administradores e Operadores do Almoxarifado Central.",
        variant: "destructive"
      });
      router.push('/'); // Redirect to dashboard or another appropriate page
    }
  }, [isLoadingData, currentUserProfile, router, toast]);


  return (
    <div>
      <PageHeader title="Registrar Entradas/Saídas (Almoxarifado Central)" description="Registre entradas de itens no sistema ou saídas para unidades/baixas." icon={ArrowRightLeft} />
      <Tabs defaultValue="manual" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:w-1/2 lg:w-1/3 mb-6">
          <TabsTrigger value="manual" disabled={isLoadingData || (currentUserProfile && currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator')}>
            {isLoadingData && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Registrar Manualmente
          </TabsTrigger>
          <TabsTrigger value="import" disabled={isLoadingData || (currentUserProfile && currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator')}>
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
          ) : (currentUserProfile && (currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator')) ? (
            <ManualMovementForm
                items={items}
                servedUnits={servedUnits}
                hospitals={hospitals}
                stockConfigs={stockConfigs}
            />
          ) : (
             <Card className="max-w-2xl mx-auto shadow-lg">
                <CardHeader><CardTitle className="font-headline text-destructive flex items-center gap-2"><ShieldAlert /> Acesso Negado</CardTitle></CardHeader>
                <CardContent><p>Você não tem permissão para acessar esta funcionalidade.</p></CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="import">
         {isLoadingData ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-3 text-muted-foreground">Carregando dados de referência para importação...</p>
            </div>
          ) : (currentUserProfile && (currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator')) ? (
            <BatchImportMovementsForm
                items={items}
                servedUnits={servedUnits}
                hospitals={hospitals}
                isLoadingDataFromParent={isLoadingData}
            />
          ) : (
             <Card className="max-w-2xl mx-auto shadow-lg">
                <CardHeader><CardTitle className="font-headline text-destructive flex items-center gap-2"><ShieldAlert />Acesso Negado</CardTitle></CardHeader>
                <CardContent><p>Você não tem permissão para acessar esta funcionalidade.</p></CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
    
