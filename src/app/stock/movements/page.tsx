
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
  // PatientId is removed as it's not for entry/exit from central
}).refine(data => {
  if (data.type === 'exit' && data.hospitalId && data.hospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
    const isUbsGeneralStock = !data.unitId || data.unitId === GENERAL_STOCK_UNIT_ID_PLACEHOLDER;
    // If exiting to a specific hospital (not direct warehouse exit),
    // and that hospital is NOT a UBS being targeted for general stock,
    // then a specific unitId (not the placeholder) must be provided.
    // This check assumes `hospitals` array is available or this validation needs to happen elsewhere.
    // For schema, we ensure that if hospitalId is provided and is not for direct exit,
    // then unitId should exist or be the placeholder.
    // A more robust check would involve knowing if the hospital is a UBS here.
    // For now, if hospitalId is given (and not direct exit), unitId is expected (can be placeholder).
    if (!data.unitId && data.unitId !== GENERAL_STOCK_UNIT_ID_PLACEHOLDER) {
      // This condition is tricky to validate purely in Zod without access to hospital type.
      // The UI logic tries to enforce it. The transaction will ultimately fail if invalid.
      // The main purpose here is user feedback.
      // Let's assume for now that if a hospital is selected for exit, a unit (or placeholder) is needed.
      // return false; // Could enable this if we want strict unit selection for non-UBS or non-direct exits.
    }
  }
  return true;
}, {
  message: "Para Saída para um Hospital/UBS, a Unidade Servida (ou Estoque Geral da UBS) deve ser selecionada.",
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
  allMasterPatients: Patient[], // Keep for signature consistency, even if not used for entry/exit
  rowIndexForLog?: number,
  itemCodeForLog?: string,
  hospitalNameForLog?: string,
  unitNameForLog?: string,
  notesForLog?: string
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
        (movementData.type === 'exit' || movementData.type === 'consumption') && // Exit to UBS general or consumption from UBS general
        movementData.hospitalId &&
        !movementData.unitId && // unitId is undefined after placeholder processing
        (hospitalForMovement?.name.toLowerCase().includes('ubs') || false);

    if (movementData.hospitalId) { // True for exit to unit/UBS-general, or consumption from unit/UBS-general
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
         // This is when hospitalId was CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE in form, now undefined here.
         // And unitConfigDocId is null (because hospitalId is undefined or not UBS general, and unitId is undefined)
        if (!movementData.hospitalId && !unitConfigDocId) {
            let currentCentralQty = currentItemData.currentQuantityCentral || 0;
            if (currentCentralQty < movementData.quantity) {
                throw new Error(`Estoque insuficiente (${currentCentralQty}) no Armazém Central para ${currentItemData.name}. Necessário: ${movementData.quantity}`);
            }
            const newQuantityCentral = currentCentralQty - movementData.quantity;
            transaction.update(itemDocRef, { currentQuantityCentral: newQuantityCentral });
        }
        // Case 2: Transfer to a specific unit or to a UBS's general stock
        else if (movementData.hospitalId && unitConfigDocRef) {
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
            
            // Base data for target config
            const targetConfigData: Partial<FirestoreStockConfig> & { itemId: string; hospitalId: string; currentQuantity: number; unitId?: string } = {
                itemId: movementData.itemId,
                hospitalId: movementData.hospitalId,
                currentQuantity: newTargetQuantity,
                // minQuantity and strategicStockLevel are not set by transfers, only by config page
                // If config doesn't exist, they remain undefined and UI will show "Not Configured"
            };
            // Add unitId only if it was a specific unit, not UBS general stock
             if(movementData.unitId) { // This unitId would be the actual ID, not placeholder
                targetConfigData.unitId = movementData.unitId;
             }
            // Ensure minQuantity and strategicStockLevel from existing config are preserved if they exist
            if (unitConfigSnap && unitConfigSnap.exists()) {
                const existingConfig = unitConfigSnap.data();
                targetConfigData.minQuantity = existingConfig.minQuantity ?? 0;
                targetConfigData.strategicStockLevel = existingConfig.strategicStockLevel ?? 0;
            } else {
                targetConfigData.minQuantity = 0; // Default for new config
                targetConfigData.strategicStockLevel = 0; // Default for new config
            }

            transaction.set(unitConfigDocRef, targetConfigData, { merge: true });
        } else {
            throw new Error("Destino (Hospital e Unidade/Estoque Geral UBS, ou Baixa Direta) é obrigatório e deve ser válido para saída/transferência.");
        }
    } else if (movementData.type === 'consumption') {
        // This block handles consumption, typically called from the consumption page or by admin/central_op
        let consumedFromCentral = false;
        if (currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator') {
            // Admin/CentralOp consuming:
            // Case 1: Directly from Central Warehouse (hospitalId and unitId are undefined)
            if (!movementData.hospitalId && !unitConfigDocId) {
                let currentCentralQty = currentItemData.currentQuantityCentral || 0;
                if (currentCentralQty < movementData.quantity) {
                    throw new Error(`Estoque insuficiente (${currentCentralQty}) no Armazém Central para ${currentItemData.name}. Necessário: ${movementData.quantity}`);
                }
                const newCentralQuantity = currentCentralQty - movementData.quantity;
                transaction.update(itemDocRef, { currentQuantityCentral: newCentralQuantity });
                consumedFromCentral = true;
            }
            // Case 2: From a specific unit or UBS general stock (unitConfigDocRef is valid)
            else if (unitConfigDocRef) {
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
            // Hospital/UBS Operator consuming:
            if (!movementData.hospitalId || currentUserProfile.associatedHospitalId !== movementData.hospitalId) {
                throw new Error("Operador não autorizado para este hospital.");
            }
            if (currentUserProfile.associatedUnitId && currentUserProfile.associatedUnitId !== movementData.unitId) { // User tied to a specific unit
                 throw new Error("Operador não autorizado para esta unidade específica.");
            }
            // If user is general for hospital/UBS (no associatedUnitId)
            if (!currentUserProfile.associatedUnitId && movementData.unitId) { // And movement IS for a specific unit (not general UBS stock)
                const unit = allMasterServedUnits.find(u => u.id === movementData.unitId);
                if (!unit || unit.hospitalId !== currentUserProfile.associatedHospitalId) { // Unit must belong to their hospital
                     throw new Error("Operador geral não autorizado para consumir de unidade específica fora do seu hospital.");
                }
            }
            if (!unitConfigDocRef) { // Should always be true for operators as hospitalId is enforced by UI
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
        unitId: movementData.unitId || null, // Actual unitId if present, or null if general UBS stock or central
        unitName: unitDetailsForLog?.name || unitNameForLog || (isUbsGeneralStockMovement ? `Estoque Geral (${hospitalDetailsForLog?.name})` : (movementData.type === 'entry' || (!movementData.hospitalId && (movementData.type === 'exit' || movementData.type === 'consumption')) ? 'Armazém Central' : null)),
        patientId: movementData.patientId || null,
        patientName: patientDetailsForLog?.name || null,
        userId: currentUserProfile.id || "unknown_user_id", // Ensure UserProfile has an id (Firebase UID)
        userDisplayName: currentUserProfile.name || "Unknown User",
    };
    const stockMovementsCollectionRef = collection(firestore, "stockMovements");
    transaction.set(doc(stockMovementsCollectionRef), movementLog);
}


const ManualMovementForm = ({ items, servedUnits, hospitals, stockConfigs }: { items: Item[], servedUnits: ServedUnit[], hospitals: Hospital[], stockConfigs: FirestoreStockConfig[] }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { currentUserProfile, user: firebaseUser } = useAuth();
  const router = useRouter(); // Add router for redirection if needed


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

  // Role-based form setup and restrictions
  useEffect(() => {
    if (!currentUserProfile) return;

    if (currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator') {
      // Non-admin/central_op users should not be on this page for entry/exit.
      // The page itself should handle redirection or access denial.
      // This form component assumes it's rendered for an authorized user for entry/exit.
      return;
    }

    // For admin/central_op, no automatic form changes are needed here based on profile.
    // They control the type of movement.

  }, [currentUserProfile, form, router, toast]);


  // Reset unit if hospital changes or if type becomes 'entry'
 useEffect(() => {
    const currentType = form.getValues('type');
    const currentHospitalId = form.getValues('hospitalId');

    if (currentType === 'entry') {
        if (form.getValues('hospitalId') || form.getValues('unitId')) {
            form.setValue('hospitalId', undefined, { shouldValidate: false });
            form.setValue('unitId', undefined, { shouldValidate: false });
        }
    } else if (currentType === 'exit') {
        // If hospital changes, unitId should be reset
        // This relies on selectedHospitalIdForm being up-to-date from watch
        if (selectedHospitalIdForm !== currentHospitalId && form.getValues('unitId')) {
             form.setValue('unitId', undefined, { shouldValidate: true });
        }
    }
  }, [movementType, selectedHospitalIdForm, form]);


  const availableUnits = useMemo(() => {
    if (!selectedHospitalIdForm || selectedHospitalIdForm === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
      return [];
    }
    return servedUnits.filter(unit => unit.hospitalId === selectedHospitalIdForm);
  }, [selectedHospitalIdForm, servedUnits]);


  const getDisplayStockForItem = (item: Item): number | string => {
    if (!currentUserProfile) return item.currentQuantityCentral;

    const formValues = form.getValues();
    const currentMovementType = formValues.type;
    const currentHospitalId = formValues.hospitalId; // This is the ID from the form
    const currentUnitIdValue = formValues.unitId;   // This can be actual ID or placeholder

    // For Entry or Direct Exit/Write-off from Central by Admin/CentralOp
    if (currentMovementType === 'entry' || (currentMovementType === 'exit' && (!currentHospitalId || currentHospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE))) {
        return item.currentQuantityCentral;
    }

    // For Exit (Transfer) TO a specific unit/UBS general stock by Admin/CentralOp
    // We show the Central Warehouse stock as the SOURCE of the transfer.
    if (currentMovementType === 'exit' && currentHospitalId && currentHospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
         return item.currentQuantityCentral;
    }
    
    // Fallback or unexpected scenario, show central stock
    return item.currentQuantityCentral;
  };


  const onSubmit = async (data: MovementFormData) => {
    if (!currentUserProfile || !firebaseUser) {
        toast({ title: "Erro de Autenticação", description: "Usuário não autenticado.", variant: "destructive" });
        return;
    }
    if (currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator') {
        toast({ title: "Permissão Negada", description: "Apenas Administradores ou Operadores do Almoxarifado Central podem realizar entradas ou saídas.", variant: "destructive" });
        return;
    }

    setIsSubmitting(true);

    let processedData = {...data};
    if (data.hospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
        processedData.hospitalId = undefined;
        processedData.unitId = undefined;
    } else if (data.unitId === GENERAL_STOCK_UNIT_ID_PLACEHOLDER) {
        processedData.unitId = undefined; // unitId becomes undefined for general UBS stock
    }

    const movementForTransaction: Omit<StockMovement, 'id' | 'itemName' | 'hospitalName' | 'unitName' | 'patientName' | 'patientId' | 'userDisplayName' | 'userId'> & { itemId: string } = {
        itemId: processedData.itemId,
        type: processedData.type, // Will be 'entry' or 'exit'
        quantity: processedData.quantity,
        date: processedData.date,
        notes: processedData.notes,
        hospitalId: processedData.hospitalId, // undefined for entry or direct central exit
        unitId: processedData.unitId,         // undefined for entry, direct central exit, or general UBS stock exit
    };


    try {
      const dummyPatients: Patient[] = []; // Patients not relevant for entry/exit
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
          const unitDesc = processedData.unitId ? servedUnits.find(u => u.id === processedData.unitId) : null; // unitId is actual ID here if specific unit
          const hospitalForMovement = processedData.hospitalId ? hospitals.find(h => h.id === processedData.hospitalId) : null;
          // isUbsGeneralStockMovementForDesc needs to check if original form unitId was placeholder or if processedData.unitId is now undefined AND hospital is UBS
          const isUbsGeneralStockExit = processedData.hospitalId && !processedData.unitId && (hospitalForMovement?.name.toLowerCase().includes('ubs') || false);


          if (unitDesc && hospitalDesc) { // Exit to specific unit
              description += ` para ${unitDesc.name} (${hospitalDesc.name}).`;
          } else if (hospitalDesc && isUbsGeneralStockExit) { // Exit to general UBS stock
              description += ` para Estoque Geral (${hospitalDesc.name}).`;
          } else if (!processedData.hospitalId) { // Direct write-off from Central
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

  // This page is ONLY for admin and central_operator
  if (currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator') {
    // Redirection or access denied message should be handled by the main page component.
    // This form component should ideally not be rendered at all if the user is not authorized.
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
                        <FormLabel>Hospital de Destino (para Transferência/Baixa)</FormLabel>
                        <Select
                            onValueChange={field.onChange}
                            value={field.value ?? CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE} // Default to direct exit if nothing selected
                        >
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione um hospital ou baixa direta" /></SelectTrigger></FormControl>
                          <SelectContent>
                             <SelectItem value={CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE}>Nenhum (Baixa direta do Armazém Central)</SelectItem>
                            {hospitals.map(hospital => <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                         <FormDescription>
                            Selecione o hospital para transferir ou "Nenhum" para baixa direta do estoque central.
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
                            value={field.value ?? undefined} // Use undefined for placeholder if nothing selected initially
                            disabled={!selectedHospitalIdForm || (availableUnits.length === 0 && !hospitals.find(h=>h.id === selectedHospitalIdForm)?.name.toLowerCase().includes('ubs'))}
                          >
                            <FormControl><SelectTrigger>
                                <SelectValue placeholder={
                                    !selectedHospitalIdForm || selectedHospitalIdForm === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE
                                    ? "Selecione um hospital primeiro"
                                    : availableUnits.length > 0 || hospitals.find(h=>h.id === selectedHospitalIdForm)?.name.toLowerCase().includes('ubs')
                                    ? "Selecione unidade ou Estoque Geral UBS"
                                    : "Nenhuma unidade configurada para este hospital"
                                } />
                            </SelectTrigger></FormControl>
                            <SelectContent>
                              {/* Option for General UBS Stock if the selected hospital is a UBS */}
                              {hospitals.find(h=>h.id === selectedHospitalIdForm)?.name.toLowerCase().includes('ubs') &&
                                <SelectItem value={GENERAL_STOCK_UNIT_ID_PLACEHOLDER} >Estoque Geral da UBS</SelectItem>
                              }
                              {availableUnits.map(unit => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                           <FormDescription>
                                Unidade para a qual o item está sendo transferido. Se for uma UBS, pode ser "Estoque Geral da UBS". Obrigatório se hospital não for baixa direta.
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
    const csvExampleRow1 = "ITEM001,entrada,100,2024-01-15,,,,\n"; // Entrada
    const csvExampleRow2 = "ITEM002,saida,10,2024-01-16,Hospital Central,UTI Geral,Transferência urgente\n"; // Saída para unidade
    const csvExampleRow3 = "ITEM001,saida,5,2024-01-18,,,Baixa por ajuste de inventário\n"; // Saída como baixa direta
    const csvExampleRow4 = "ITEM004,saida,20,2024-01-19,UBS Vila Sol,,Transferência para estoque geral da UBS\n"; // Saída para Estoque Geral UBS

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

          const BATCH_SIZE_DOCS = 150; // Firestore transaction limit is around 500 writes. Each movement is 1 item update + 1 log write + potentially 1 stockConfig write.
          for (let i = 0; i < rows.length; i += BATCH_SIZE_DOCS) {
            const batchRows = rows.slice(i, i + BATCH_SIZE_DOCS);

            for (let j = 0; j < batchRows.length; j++) {
                const row = batchRows[j];
                const originalRowIndex = i + j + 2; // CSV row number (1-based for header, then data)
                let itemCodeForRow = row["Código do Item"]?.trim() || "N/A"; // For error logging

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

                    // Basic Validations
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
                    const parsedDate = new Date(dateStr + "T00:00:00Z"); // Treat as UTC to avoid timezone issues converting to ISO string
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

                    let hospitalId: string | undefined = undefined;
                    let unitId: string | undefined = undefined;

                    if (typeStr === 'saida') {
                        if (hospitalNameCsv) { // Saída para um hospital/UBS
                            const hospital = hospitals.find(h => h.name.toLowerCase() === hospitalNameCsv.toLowerCase());
                            if (!hospital) {
                                importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Hospital de destino '${hospitalNameCsv}' não encontrado.`);
                                continue;
                            }
                            hospitalId = hospital.id;
                            if (unitNameCsv) { // Saída para uma unidade específica dentro do hospital
                                const unit = servedUnits.find(u => u.name.toLowerCase() === unitNameCsv.toLowerCase() && u.hospitalId === hospitalId);
                                if (!unit) {
                                    importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Unidade de destino '${unitNameCsv}' não encontrada ou não pertence ao hospital '${hospitalNameCsv}'.`);
                                    continue;
                                }
                                unitId = unit.id;
                            } else { // Sem unidade específica, pode ser para o estoque geral de uma UBS
                                const hospitalIsUbs = hospital?.name.toLowerCase().includes('ubs');
                                if (!hospitalIsUbs) { // Se não for UBS, e não tiver unidade, é um erro de dados (a menos que seja uma baixa direta, que não teria hospitalNameCsv)
                                    importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Saída para Hospital ('${hospitalNameCsv}') que não é UBS requer uma unidade de destino específica.`);
                                    continue;
                                }
                                // Para UBS sem unitNameCsv, unitId fica undefined (general stock)
                            }
                        } // Se typeStr === 'saida' e hospitalNameCsv for vazio, é uma baixa direta do armazém central
                    }

                    const movementDataForTx: Omit<StockMovement, 'id' | 'itemName' | 'hospitalName' | 'unitName' | 'patientName' | 'patientId' | 'userDisplayName' | 'userId'> & { itemId: string } = {
                        itemId: item.id, type: typeStr as 'entry' | 'exit', quantity, date: formattedDate,
                        hospitalId, unitId, notes: notesCsv
                    };
                    
                    const dummyPatients: Patient[] = []; // Patients not relevant for entry/exit
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
    reader.readAsText(file, 'UTF-8'); // Specify UTF-8 encoding
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
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando dados de referência...
            </>
          ) : isProcessing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processando planilha...
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
  const [stockConfigs, setStockConfigs] = useState<FirestoreStockConfig[]>([]); // Adicionado
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
      { coll: "stockConfigs", setter: setStockConfigs, msg: "Configurações de Estoque", queryDirect: query(collection(firestore, "stockConfigs")) }, // Query direta para stockConfigs
    ];

    let loadedCount = 0;
    const unsubscribers: (()=>void)[] = [];

    listeners.forEach(config => {
      const queryToRun = config.queryDirect ? config.queryDirect : query(collection(firestore, config.coll), orderBy(config.orderByField!, "asc"));
      const unsubscribe = onSnapshot(queryToRun, (snapshot) => {
        config.setter(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
        
        // Evitar contagem dupla se já marcado
        const listenerConfig = listeners.find(l => l.coll === config.coll);
        if (listenerConfig && !listenerConfig.msg.startsWith("Loaded_")) {
            loadedCount++;
            listenerConfig.msg = "Loaded_" + listenerConfig.msg; 
        }
        if (loadedCount >= listeners.length) setIsLoadingData(false);

      }, (error) => {
        console.error(`Erro ao buscar ${config.msg.replace("Loaded_","")}: `, error);
        toast({ title: `Erro ao Carregar ${config.msg.replace("Loaded_","")}`, variant: "destructive" });
        
        const listenerConfig = listeners.find(l => l.coll === config.coll);
        if (listenerConfig && !listenerConfig.msg.startsWith("Loaded_")) {
            loadedCount++;
            listenerConfig.msg = "Loaded_" + listenerConfig.msg;
        }
        if (loadedCount >= listeners.length) setIsLoadingData(false);
      });
      unsubscribers.push(unsubscribe);
    });

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
    
