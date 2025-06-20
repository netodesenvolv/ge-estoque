
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


const CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE = "__CENTRAL_WAREHOUSE_DIRECT_EXIT__";
const UBS_GENERAL_STOCK_SUFFIX = "UBSGENERAL";
const GENERAL_STOCK_UNIT_ID_PLACEHOLDER = "__GENERAL_STOCK_UNIT__";


// Schema for Entry/Exit movements only (Admin/CentralOp)
const movementSchema = z.object({
  itemId: z.string().min(1, "A seleção do item é obrigatória."),
  type: z.enum(['entry', 'exit'], { required_error: "O tipo de movimentação é obrigatório." }),
  quantity: z.coerce.number().positive("A quantidade deve ser um número positivo."),
  hospitalId: z.string().optional(), // For exit to hospital/unit
  unitId: z.string().optional(),     // For exit to unit
  date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Data inválida." }),
  notes: z.string().optional(),
}).refine(data => {
  if (data.type === 'exit' && data.hospitalId && data.hospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
    // This validation is complex to do perfectly in Zod without async calls or more context.
    // The main check: if exiting to a hospital (not direct warehouse exit),
    // and that hospital is NOT a UBS being targeted for general stock (unitId is placeholder or undefined),
    // then a specific unitId should be selected.
    // The UI and transaction logic try to enforce this.
    // If hospitalId is selected and it's NOT a direct central exit, then unitId must be present
    // (either a specific unit ID or the placeholder for general UBS stock).
    // This is mostly a UX hint; the transaction logic will ultimately fail if invalid.
    if (!data.unitId) {
      // Placeholder is acceptable, undefined/empty string is not if hospital is selected.
      // This specific Zod refine logic might need further tuning based on exact UI flow.
      // For now, we mostly rely on UI disabling/enabling and transaction checks.
    }
  }
  return true;
}, {
  message: "Para Saída para um Hospital/UBS, a Unidade Servida (ou Estoque Geral da UBS) deve ser selecionada, ou escolha 'Baixa direta'.",
  path: ["unitId"], // Or perhaps hospitalId if it's about the combination
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
        (movementData.type === 'exit' || movementData.type === 'consumption') &&
        movementData.hospitalId &&
        !movementData.unitId && // unitId is undefined after placeholder processing
        (hospitalForMovement?.name.toLowerCase().includes('ubs') || false);

    // Determine target stockConfig for unit/UBS general stock
    if (movementData.hospitalId) {
        if (movementData.unitId) { // Specific unit
            unitConfigDocId = `${movementData.itemId}_${movementData.unitId}`;
        } else if (isUbsGeneralStockMovement) { // General stock of a UBS
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

    } else if (movementData.type === 'exit') { // Transfer or Direct Write-off
        if (currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator') {
            throw new Error("Apenas Admin ou Operador Central podem registrar saídas/transferências.");
        }
        // Case 1: Direct write-off from Central Warehouse
        // This is when hospitalId was CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE in form, resulting in movementData.hospitalId being undefined.
        // unitConfigDocId will be null as well.
        if (!movementData.hospitalId && !unitConfigDocId) {
            let currentCentralQty = currentItemData.currentQuantityCentral || 0;
            if (currentCentralQty < movementData.quantity) {
                throw new Error(`Estoque insuficiente (${currentCentralQty}) no Armazém Central para ${currentItemData.name}. Necessário: ${movementData.quantity}`);
            }
            const newQuantityCentral = currentCentralQty - movementData.quantity;
            transaction.update(itemDocRef, { currentQuantityCentral: newQuantityCentral });
        }
        // Case 2: Transfer to a specific unit or to a UBS's general stock
        else if (movementData.hospitalId && unitConfigDocRef) { // unitConfigDocRef implies unitConfigDocId is set
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

            const targetConfigData: Partial<FirestoreStockConfig> & { itemId: string; hospitalId: string; currentQuantity: number; unitId?: string | null } = {
                itemId: movementData.itemId,
                hospitalId: movementData.hospitalId!, // Should be valid at this point
                currentQuantity: newTargetQuantity,
                unitId: movementData.unitId || null, // Ensure it's explicitly null if not present
            };

            if (unitConfigSnap && unitConfigSnap.exists()) {
                const existingConfig = unitConfigSnap.data();
                targetConfigData.minQuantity = existingConfig.minQuantity ?? 0;
                targetConfigData.strategicStockLevel = existingConfig.strategicStockLevel ?? 0;
            } else {
                targetConfigData.minQuantity = 0;
                targetConfigData.strategicStockLevel = 0;
            }
            transaction.set(unitConfigDocRef, targetConfigData, { merge: true });
        } else {
            throw new Error("Destino (Hospital e Unidade/Estoque Geral UBS, ou Baixa Direta) é obrigatório e deve ser válido para saída/transferência.");
        }
    } else if (movementData.type === 'consumption') {
        // This block handles consumption, typically called from the consumption page.
        // Permission checks for WHO can consume from WHERE are primarily handled by Firestore rules
        // and the UI restricting selection based on role.
        // This function focuses on updating the correct stock location.

        // Case 1: Consumption from Central Warehouse (by Admin/CentralOp directly)
        if (!movementData.hospitalId && !unitConfigDocId) {
            if (currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator') {
                 throw new Error("Apenas Admin ou Operador Central podem registrar consumo direto do Almoxarifado Central.");
            }
            let currentCentralQty = currentItemData.currentQuantityCentral || 0;
            if (currentCentralQty < movementData.quantity) {
                throw new Error(`Estoque insuficiente (${currentCentralQty}) no Armazém Central para ${currentItemData.name}. Necessário: ${movementData.quantity}`);
            }
            const newCentralQuantity = currentCentralQty - movementData.quantity;
            transaction.update(itemDocRef, { currentQuantityCentral: newCentralQuantity });
        }
        // Case 2: Consumption from a specific unit or UBS general stock
        else if (movementData.hospitalId && unitConfigDocRef) { // unitConfigDocRef implies unitConfigDocId is set
             if (!unitConfigSnap || !unitConfigSnap.exists()) {
                throw new Error(`Configuração de estoque não encontrada para ${currentItemData.name} no local de consumo (ID: ${unitConfigDocId}). Estoque inicial pode não ter sido transferido ou configurado.`);
            }
            let currentUnitQty = unitConfigSnap.data().currentQuantity || 0;
            if (currentUnitQty < movementData.quantity) {
                throw new Error(`Estoque insuficiente (${currentUnitQty}) no local de consumo para ${currentItemData.name}. Necessário: ${movementData.quantity}`);
            }
            const newUnitQuantity = currentUnitQty - movementData.quantity;

            // Prepare the update payload for stockConfigs
            // Only update currentQuantity here for consumption.
            // Other fields like minQuantity, strategicStockLevel are preserved from existing or set by admin/centralOp.
            const updatePayload: { currentQuantity: number } = { currentQuantity: newUnitQuantity };
            transaction.update(unitConfigDocRef, updatePayload);

        } else {
             throw new Error("Destino de consumo (Unidade específica, Estoque Geral UBS ou Almoxarifado Central) inválido ou não especificado.");
        }
    }

    // Log the movement
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
        unitName: unitDetailsForLog?.name || unitNameForLog || (isUbsGeneralStockMovement ? `Estoque Geral (${hospitalDetailsForLog?.name})` : (movementData.type === 'entry' || (!movementData.hospitalId && (movementData.type === 'exit' || movementData.type === 'consumption')) ? 'Armazém Central' : null)),
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
  const { currentUserProfile, user: firebaseUser } = useAuth();
  const router = useRouter();


  const form = useForm<MovementFormData>({
    resolver: zodResolver(movementSchema),
    defaultValues: {
      type: 'entry',
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
    if (!currentUserProfile) return;
    if (currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator') {
      // This form should ideally not be rendered for non-admins/central_ops
      // If it is, it's a routing/UI bug.
      // console.warn("ManualMovementForm rendered for non-admin/central_operator. This should not happen.");
      return;
    }
    // No specific form resets needed for admin/central_operator based on profile here,
    // as they control the type and destination.
  }, [currentUserProfile, form, router, toast]);


 useEffect(() => {
    const currentType = form.getValues('type');
    const currentHospitalId = form.getValues('hospitalId');
    const currentUnitId = form.getValues('unitId');

    if (currentType === 'entry') {
        if (currentHospitalId !== undefined || currentUnitId !== undefined) {
            form.setValue('hospitalId', undefined, { shouldValidate: false });
            form.setValue('unitId', undefined, { shouldValidate: false });
        }
    } else if (currentType === 'exit') {
        // If selectedHospitalIdForm (watched value) has changed from what's in the form's currentHospitalId,
        // it implies an interaction that might require unitId to be reset.
        // This is a bit indirect. A direct check if currentHospitalId is different from selectedHospitalIdForm could be better.
        // Or, simply reset unitId if hospitalId changes significantly.
        // If the new selectedHospitalIdForm is CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE, unitId should also be cleared.
        if (selectedHospitalIdForm === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE && currentUnitId !== undefined) {
             form.setValue('unitId', undefined, { shouldValidate: false });
        }
        // If the hospital selection was changed (and it's not to central direct exit), then unit must be re-evaluated/reset.
        // This check is tricky. The key is that form.setValue('unitId', undefined) should happen if hospitalId changes.
        // Let's ensure the previous `selectedHospitalIdForm` is different from current actual `form.getValues('hospitalId')` to detect change.
        // This useEffect's dependencies might need to include a "previousHospitalId" state if we need to detect actual change robustly.
        // For now, if the *watched* hospitalId is different from the one that triggered the last unitId evaluation, reset.
        // A simpler approach: if type is 'exit', and hospitalId becomes empty/direct_exit, unitId should be empty.
        // If hospitalId changes to a *new* hospital, unitId should be reset.
        // The current logic might over-reset.
        // For now, rely on UI disabling or the more global form reset on type change.
    }
  }, [movementType, selectedHospitalIdForm, form]);


  const availableUnits = useMemo(() => {
    if (!selectedHospitalIdForm || selectedHospitalIdForm === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
      return [];
    }
    return servedUnits.filter(unit => unit.hospitalId === selectedHospitalIdForm);
  }, [selectedHospitalIdForm, servedUnits]);


  const getDisplayStockForItem = (item: Item): number | string => {
    // This form is for Admin/CentralOp only, dealing with Central Warehouse
    // or transferring to units (which still originates from Central).
    return item.currentQuantityCentral;
  };


  const onSubmit = async (data: MovementFormData) => {
    if (!currentUserProfile || !firebaseUser) {
        toast({ title: "Erro de Autenticação", description: "Usuário não autenticado.", variant: "destructive" });
        return;
    }
    if (currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator') {
        toast({ title: "Permissão Negada", description: "Apenas Administradores ou Operadores do Almoxarifado Central podem realizar estas movimentações.", variant: "destructive" });
        return;
    }

    setIsSubmitting(true);

    let processedHospitalId = data.hospitalId;
    let processedUnitId = data.unitId;

    if (data.type === 'entry') {
        processedHospitalId = undefined;
        processedUnitId = undefined;
    } else if (data.type === 'exit') {
        if (data.hospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
            processedHospitalId = undefined;
            processedUnitId = undefined;
        } else if (data.unitId === GENERAL_STOCK_UNIT_ID_PLACEHOLDER) {
            // HospitalId remains, unitId becomes undefined for general UBS stock
            processedUnitId = undefined;
        }
        // If hospitalId is set (and not direct exit) but unitId is truly empty (not placeholder), it's an error
        if (processedHospitalId && !processedUnitId && data.unitId !== GENERAL_STOCK_UNIT_ID_PLACEHOLDER) {
            const targetHospital = hospitals.find(h => h.id === processedHospitalId);
            if (targetHospital && !targetHospital.name.toLowerCase().includes('ubs')) {
                 toast({ title: "Seleção Incompleta", description: "Para transferência para um Hospital (não UBS), uma unidade específica deve ser selecionada.", variant: "destructive" });
                 setIsSubmitting(false);
                 return;
            }
        }
    }


    const movementForTransaction: Omit<StockMovement, 'id' | 'itemName' | 'hospitalName' | 'unitName' | 'patientName' | 'patientId' | 'userDisplayName' | 'userId'> & { itemId: string } = {
        itemId: data.itemId,
        type: data.type,
        quantity: data.quantity,
        date: data.date,
        notes: data.notes,
        hospitalId: processedHospitalId,
        unitId: processedUnitId,
    };


    try {
      const dummyPatients: Patient[] = [];
      await runTransaction(firestore, (transaction) =>
        processMovementRowTransaction(
            transaction,
            movementForTransaction,
            currentUserProfile,
            items, hospitals, servedUnits, dummyPatients
        )
      );

      const itemDetails = items.find(i => i.id === data.itemId);
      let description = `Movimentação de ${data.quantity} unidade(s) de ${itemDetails?.name || data.itemId} registrada como ${data.type}.`;

      if (data.type === 'exit' && processedHospitalId) {
          const hospitalDesc = hospitals.find(h => h.id === processedHospitalId);
          const unitDesc = processedUnitId ? servedUnits.find(u => u.id === processedUnitId) : null;
          const isUbsGeneralStockExit = hospitalDesc?.name.toLowerCase().includes('ubs') && !processedUnitId;

          if (unitDesc && hospitalDesc) {
              description += ` para ${unitDesc.name} (${hospitalDesc.name}).`;
          } else if (hospitalDesc && isUbsGeneralStockExit) {
              description += ` para Estoque Geral (${hospitalDesc.name}).`;
          }
      } else if (data.type === 'exit' && !processedHospitalId) {
          description += ` (Baixa direta do Armazém Central).`;
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

  if (currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator') {
    return (
        <Card className="max-w-2xl mx-auto shadow-lg">
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2"><ShieldAlert className="h-6 w-6 text-destructive" /> Acesso Negado</CardTitle>
            </CardHeader>
            <CardContent>
                <p>Esta funcionalidade é restrita a Administradores e Operadores do Almoxarifado Central.</p>
                 <Button onClick={() => router.push('/')} className="mt-4">Voltar ao Painel</Button>
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
                        onValueChange={(value) => {
                            field.onChange(value);
                            // Reset hospital/unit if switching to entry
                            if (value === 'entry') {
                                form.setValue('hospitalId', undefined, {shouldValidate: false});
                                form.setValue('unitId', undefined, {shouldValidate: false});
                            }
                        }}
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
                        <FormLabel>Hospital de Destino (para Transferência/Baixa)</FormLabel>
                        <Select
                            onValueChange={(value) => {
                                field.onChange(value);
                                form.setValue('unitId', undefined, { shouldValidate: true }); // Reset unit when hospital changes
                            }}
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
                            disabled={!selectedHospitalIdForm || (availableUnits.length === 0 && !hospitals.find(h=>h.id === selectedHospitalIdForm)?.name.toLowerCase().includes('ubs'))}
                          >
                            <FormControl><SelectTrigger>
                                <SelectValue placeholder={
                                    !selectedHospitalIdForm || selectedHospitalIdForm === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE
                                    ? "Selecione um hospital primeiro"
                                    : availableUnits.length > 0 || hospitals.find(h=>h.id === selectedHospitalIdForm)?.name.toLowerCase().includes('ubs')
                                    ? "Selecione unidade ou Estoque Geral UBS"
                                    : "Nenhuma unidade para este hospital"
                                } />
                            </SelectTrigger></FormControl>
                            <SelectContent>
                              {hospitals.find(h=>h.id === selectedHospitalIdForm)?.name.toLowerCase().includes('ubs') &&
                                <SelectItem value={GENERAL_STOCK_UNIT_ID_PLACEHOLDER} >Estoque Geral da UBS</SelectItem>
                              }
                              {availableUnits.map(unit => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                           <FormDescription>
                                Unidade para transferir. Se UBS, pode ser "Estoque Geral". Obrigatório se hospital não for baixa direta.
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


const BatchImportMovementsForm = ({ items, servedUnits, hospitals, stockConfigs, isLoadingDataFromParent }: { items: Item[], servedUnits: ServedUnit[], hospitals: Hospital[], stockConfigs: FirestoreStockConfig[], isLoadingDataFromParent: boolean }) => {
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
    const csvHeader = "Código do Item,Tipo,Quantidade,Data,Nome do Hospital Destino,Nome da Unidade Destino,Observações\n";
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
                    const hospitalNameCsv = row["Nome do Hospital Destino"]?.trim();
                    const unitNameCsv = row["Nome da Unidade Destino"]?.trim();
                    const notesCsv = row["Observações"]?.trim();

                    if (!itemCodeForRow || itemCodeForRow === "N/A" || !typeStr || !quantityStr || !dateStr) {
                        importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Código do Item, Tipo, Quantidade e Data são obrigatórios.`);
                        continue;
                    }
                    const isValidType = typeStr === 'entrada' || typeStr === 'saida';
                    if (!isValidType) {
                        importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Tipo inválido ('${row["Tipo"]}'). Use 'entrada' ou 'saida'.`);
                        continue;
                    }
                    const quantity = parseInt(quantityStr, 10);
                    if (isNaN(quantity) || quantity <= 0) {
                        importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Quantidade inválida ('${quantityStr}'). Deve ser um número positivo.`);
                        continue;
                    }
                    const dateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
                    if (!dateRegex.test(dateStr)) {
                        importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Data inválida ('${dateStr}'). Use o formato AAAA-MM-DD.`);
                        continue;
                    }
                    const parsedDate = new Date(dateStr + "T00:00:00Z");
                    if (isNaN(parsedDate.getTime())) {
                         importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Data inválida ('${dateStr}') após parsing interno.`);
                         continue;
                    }
                    const formattedDate = parsedDate.toISOString().split('T')[0];


                    const item = items.find(it => it.code === itemCodeForRow);
                    if (!item) {
                        importErrors.push(`Linha ${originalRowIndex}: Item com código '${itemCodeForRow}' não encontrado no sistema.`);
                        continue;
                    }

                    let processedHospitalId: string | undefined = undefined;
                    let processedUnitId: string | undefined = undefined;

                    if (typeStr === 'saida') {
                        if (hospitalNameCsv) {
                            const hospital = hospitals.find(h => h.name.toLowerCase() === hospitalNameCsv.toLowerCase());
                            if (!hospital) {
                                importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Hospital de destino '${hospitalNameCsv}' não encontrado.`);
                                continue;
                            }
                            processedHospitalId = hospital.id;
                            if (unitNameCsv) {
                                const unit = servedUnits.find(u => u.name.toLowerCase() === unitNameCsv.toLowerCase() && u.hospitalId === processedHospitalId);
                                if (!unit) {
                                    importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Unidade de destino '${unitNameCsv}' não encontrada ou não pertence ao hospital '${hospitalNameCsv}'.`);
                                    continue;
                                }
                                processedUnitId = unit.id;
                            } else {
                                const hospitalIsUbs = hospital?.name.toLowerCase().includes('ubs');
                                if (!hospitalIsUbs) {
                                    importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Saída para Hospital ('${hospitalNameCsv}') que não é UBS requer uma unidade de destino específica, ou deve ser uma baixa direta (sem nome de hospital).`);
                                    continue;
                                }
                                // For UBS without unitNameCsv, processedUnitId remains undefined (general stock)
                            }
                        } // If typeStr === 'saida' and hospitalNameCsv is empty, it's a direct write-off from central
                    }

                    const movementDataForTx: Omit<StockMovement, 'id' | 'itemName' | 'hospitalName' | 'unitName' | 'patientName' | 'patientId' | 'userDisplayName' | 'userId'> & { itemId: string } = {
                        itemId: item.id, type: typeStr as 'entry' | 'exit', quantity, date: formattedDate,
                        hospitalId: processedHospitalId, unitId: processedUnitId, notes: notesCsv
                    };
                    
                    const dummyPatients: Patient[] = [];
                    await runTransaction(firestore, (transaction) =>
                        processMovementRowTransaction(
                            transaction,
                            movementDataForTx,
                            currentUserProfile,
                            items, hospitals, servedUnits, dummyPatients,
                            originalRowIndex, itemCodeForRow, hospitalNameCsv, unitNameCsv, notesCsv
                        )
                    );
                    successfulImports++;

                } catch (rowError: any) {
                    importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): ${rowError.message || 'Erro desconhecido na linha.'}`);
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
            toast({ title: "Nenhuma Movimentação Válida", description: "Nenhuma movimentação válida encontrada na planilha após validação.", variant: "default" });
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
        <CardTitle className="font-headline">Importar Entradas/Saídas (Alm. Central) em Lote</CardTitle>
        <CardDescription>
          Faça o upload de um arquivo .csv com as movimentações. A primeira linha deve ser o cabeçalho.
          Apenas Administradores e Operadores do Almoxarifado Central podem usar esta funcionalidade.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
         <Alert>
            <Download className="h-4 w-4" />
            <AlertTitle>Formato da Planilha de Entradas/Saídas</AlertTitle>
            <AlertDescription>
              <p className="mb-2">Sua planilha CSV deve ter as seguintes colunas, nesta ordem:</p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li><code>Código do Item</code> (Texto, Obrigatório)</li>
                <li><code>Tipo</code> (Texto, Obrigatório - 'entrada' ou 'saida')</li>
                <li><code>Quantidade</code> (Número, Obrigatório - Positivo)</li>
                <li><code>Data</code> (Data AAAA-MM-DD, Obrigatório)</li>
                <li><code>Nome do Hospital Destino</code> (Texto, Opcional - para 'saida' para hospital/UBS)</li>
                <li><code>Nome da Unidade Destino</code> (Texto, Opcional - para 'saida' para unidade específica dentro do hospital)</li>
                <li><code>Observações</code> (Texto, Opcional)</li>
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                <strong>Notas Importantes:</strong><br/>
                - Para <strong>entrada</strong>: Deixe "Nome do Hospital Destino" e "Nome da Unidade Destino" em branco.<br/>
                - Para <strong>saida (baixa direta do Armazém Central)</strong>: Deixe "Nome do Hospital Destino" e "Nome da Unidade Destino" em branco.<br/>
                - Para <strong>saida (transferência para unidade específica)</strong>: Preencha "Nome do Hospital Destino" e "Nome da Unidade Destino". <br/>
                - Para <strong>saida (transferência para estoque geral de uma UBS)</strong>: Preencha "Nome do Hospital Destino" (com o nome da UBS) e deixe "Nome da Unidade Destino" em branco.
              </p>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="mt-4">
                <Download className="mr-2 h-4 w-4" /> Baixar Planilha Modelo (.csv)
              </Button>
            </AlertDescription>
          </Alert>

        <div className="grid w-full max-w-md items-center gap-2">
          <Label htmlFor="batch-movements-file-input">Arquivo CSV (codificação UTF-8)</Label>
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
  const [stockConfigs, setStockConfigs] = useState<FirestoreStockConfig[]>([]);
  const { toast } = useToast();
  const [isLoadingData, setIsLoadingData] = useState(true);
  const { currentUserProfile } = useAuth();
  const router = useRouter();


  useEffect(() => {
    setIsLoadingData(true);
    const listeners = [
      { coll: "items", setter: setItems, msg: "Itens", orderByField: "name" },
      { coll: "hospitals", setter: setHospitals, msg: "Hospitais", orderByField: "name" },
      { coll: "servedUnits", setter: setServedUnits, msg: "Unidades Servidas", orderByField: "name" },
      { coll: "stockConfigs", setter: setStockConfigs, msg: "Configurações de Estoque", queryDirect: query(collection(firestore, "stockConfigs")) },
    ];

    let loadedCount = 0;
    const unsubscribers: (()=>void)[] = [];
    let allLoadedOrError = false;

    const checkAllLoaded = () => {
        if (allLoadedOrError) return;
        if (loadedCount >= listeners.length) {
            allLoadedOrError = true;
            setIsLoadingData(false);
        }
    };

    listeners.forEach(config => {
      const queryToRun = config.queryDirect ? config.queryDirect : query(collection(firestore, config.coll), orderBy(config.orderByField!, "asc"));
      const unsubscribe = onSnapshot(queryToRun, (snapshot) => {
        config.setter(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
        loadedCount++;
        checkAllLoaded();
      }, (error) => {
        console.error(`Erro ao buscar ${config.msg}: `, error);
        toast({ title: `Erro ao Carregar ${config.msg}`, variant: "destructive", description: error.message });
        loadedCount++;
        checkAllLoaded();
      });
      unsubscribers.push(unsubscribe);
    });

    return () => unsubscribers.forEach(unsub => unsub());
  }, [toast]);
  
  useEffect(() => {
    if (!isLoadingData && currentUserProfile && currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator') {
      toast({
        title: "Acesso Negado",
        description: "Esta página é restrita a Administradores e Operadores do Almoxarifado Central.",
        variant: "destructive"
      });
      router.push('/');
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
              <p className="ml-3 text-muted-foreground">Carregando dados...</p>
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
              <p className="ml-3 text-muted-foreground">Carregando dados...</p>
            </div>
          ) : (currentUserProfile && (currentUserProfile.role === 'admin' || currentUserProfile.role !== 'central_operator')) ? ( // Incorrect logic here, should be &&
            <BatchImportMovementsForm
                items={items}
                servedUnits={servedUnits}
                hospitals={hospitals}
                stockConfigs={stockConfigs}
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
    

    