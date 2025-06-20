
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
import type { Item, ServedUnit, Hospital, Patient, StockMovement, UserProfile, StockMovementType, FirestoreStockConfig } from '@/types';
import { useState, useEffect, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, runTransaction, addDoc, getDocs, writeBatch, Transaction } from 'firebase/firestore';
import Papa, { type ParseError } from 'papaparse';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";


const CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE = "CENTRAL_WAREHOUSE_DIRECT_EXIT";
const GENERAL_STOCK_UNIT_ID_PLACEHOLDER = "__GENERAL_STOCK__";
const UBS_GENERAL_STOCK_SUFFIX = "UBSGENERAL";


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
  if ((data.type === 'exit' || data.type === 'consumption') &&
      data.hospitalId && data.hospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE &&
      !data.unitId && data.unitId !== GENERAL_STOCK_UNIT_ID_PLACEHOLDER) { 
    return false;
  }
  return true;
}, {
  message: "Para Saída ou Consumo com um Hospital específico (que não seja baixa direta), a Unidade Servida (ou Estoque Geral da UBS) deve ser selecionada.",
  path: ["unitId"],
}).refine(data => {
  if ((data.type === 'exit' || data.type === 'consumption') &&
      data.hospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE &&
      data.unitId && data.unitId !== GENERAL_STOCK_UNIT_ID_PLACEHOLDER) {
    return false;
  }
  return true;
}, {
  message: "Unidade Servida não deve ser selecionada para Baixa/Consumo direto do Armazém Central.",
  path: ["unitId"],
});


type MovementFormData = z.infer<typeof movementSchema>;

const NO_PATIENT_ID = "__NO_PATIENT__";

export async function processMovementRowTransaction(
  transaction: Transaction,
  movementData: MovementFormData & { itemId: string }, 
  currentUserProfile: UserProfile, 
  allMasterItems: Item[],
  allMasterHospitals: Hospital[],
  allMasterServedUnits: ServedUnit[],
  allMasterPatients: Patient[],
  rowIndexForLog?: number,
  itemCodeForLog?: string,
  hospitalNameForLog?: string,
  unitNameForLog?: string,
  notesForLog?: string
) {
    const itemDocRef = doc(firestore, "items", movementData.itemId);
    const itemSnap = await transaction.get(itemDocRef);
    if (!itemSnap.exists()) {
        throw new Error(`Item ${movementData.itemId} não encontrado (linha ${rowIndexForLog || 'manual'}).`);
    }
    const currentItemData = itemSnap.data() as Item;

    let unitConfigDocRef = null;
    let unitConfigSnap = null;
    let unitConfigDocId: string | null = null;

    const hospitalForMovement = movementData.hospitalId ? allMasterHospitals.find(h => h.id === movementData.hospitalId) : null;
    const isUbsGeneralStockConsumption =
        movementData.type === 'consumption' &&
        movementData.hospitalId &&
        !movementData.unitId && 
        (hospitalForMovement?.name.toLowerCase().includes('ubs') || false);

    if (movementData.hospitalId) {
        if (movementData.unitId) { 
            unitConfigDocId = `${movementData.itemId}_${movementData.unitId}`;
        } else if (isUbsGeneralStockConsumption) { 
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
         if (!movementData.hospitalId && !unitConfigDocId) { // Baixa direta do Central
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
            const targetConfigData: Partial<FirestoreStockConfig> = { // Usar Partial para permitir merge
                itemId: movementData.itemId,
                hospitalId: movementData.hospitalId,
                currentQuantity: newTargetQuantity,
            };
             if(movementData.unitId) targetConfigData.unitId = movementData.unitId;
            // Níveis estratégicos/mínimos são definidos em outra tela, não aqui.
            // Apenas criamos/atualizamos a quantidade.
            transaction.set(unitConfigDocRef, targetConfigData, { merge: true });
        } else {
            throw new Error("Destino (Hospital e Unidade/Estoque Geral UBS, ou Baixa Direta) é obrigatório para saída/transferência.");
        }
    } else if (movementData.type === 'consumption') {
        if (currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator') {
            if (!movementData.hospitalId && !unitConfigDocRef) { 
                let currentCentralQty = currentItemData.currentQuantityCentral || 0;
                if (currentCentralQty < movementData.quantity) {
                    throw new Error(`Estoque insuficiente (${currentCentralQty}) no Armazém Central para ${currentItemData.name}. Necessário: ${movementData.quantity}`);
                }
                const newCentralQuantity = currentCentralQty - movementData.quantity;
                transaction.update(itemDocRef, { currentQuantityCentral: newCentralQuantity });
            } else if (unitConfigDocRef) { 
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
            if (!movementData.hospitalId || currentUserProfile.associatedHospitalId !== movementData.hospitalId) {
                throw new Error("Operador não autorizado para este hospital.");
            }
            if (currentUserProfile.associatedUnitId && currentUserProfile.associatedUnitId !== movementData.unitId) {
                throw new Error("Operador não autorizado para esta unidade específica.");
            }
            if (!unitConfigDocRef) { // Deve sempre ter um unitConfigDocRef para operadores de unidade/UBS
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
            throw new Error("Tipo de usuário não autorizado para registrar consumo.");
        }
    }

    const itemDetailsForLog = allMasterItems.find(i => i.id === movementData.itemId);
    const hospitalDetailsForLog = movementData.hospitalId ? allMasterHospitals.find(h => h.id === movementData.hospitalId) : null;
    const unitDetailsForLog = movementData.unitId ? allMasterServedUnits.find(u => u.id === movementData.unitId) : null;
    const patientDetailsForLog = movementData.patientId ? allMasterPatients.find(p => p.id === movementData.patientId) : null;

    const movementLog: Omit<StockMovement, 'id'> = {
        itemId: movementData.itemId,
        itemName: itemDetailsForLog?.name || itemCodeForLog || null,
        type: movementData.type as StockMovementType,
        quantity: movementData.quantity,
        date: movementData.date,
        notes: movementData.notes || notesForLog || null,
        hospitalId: movementData.hospitalId || null,
        hospitalName: hospitalDetailsForLog?.name || hospitalNameForLog || null,
        unitId: movementData.unitId || null,
        unitName: unitDetailsForLog?.name || unitNameForLog || (isUbsGeneralStockConsumption ? `Estoque Geral (${hospitalDetailsForLog?.name})` : null),
        patientId: movementData.patientId || null,
        patientName: patientDetailsForLog?.name || null,
        userId: currentUserProfile.id || "unknown_user_id", 
        userDisplayName: currentUserProfile.name || "Unknown User", 
    };
    const stockMovementsCollectionRef = collection(firestore, "stockMovements");
    transaction.set(doc(stockMovementsCollectionRef), movementLog);
}


const ManualMovementForm = ({ items, servedUnits, hospitals, patients, stockConfigs }: { items: Item[], servedUnits: ServedUnit[], hospitals: Hospital[], patients: Patient[], stockConfigs: FirestoreStockConfig[] }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { currentUserProfile, user: firebaseUser } = useAuth();

  const userRole = currentUserProfile?.role;
  const userAssociatedHospitalId = currentUserProfile?.associatedHospitalId;
  const userAssociatedUnitId = currentUserProfile?.associatedUnitId;

  const isOperator = userRole === 'hospital_operator' || userRole === 'ubs_operator';
  const isAdminOrCentralOp = userRole === 'admin' || userRole === 'central_operator';

  const form = useForm<MovementFormData>({
    resolver: zodResolver(movementSchema),
    defaultValues: {
      type: (isOperator && userRole) ? 'consumption' : 'entry',
      quantity: 1,
      date: new Date().toISOString().split('T')[0],
      notes: '',
      hospitalId: isOperator ? userAssociatedHospitalId : undefined,
      unitId: (isOperator && userAssociatedUnitId) ? userAssociatedUnitId : undefined,
      patientId: undefined,
      itemId: undefined,
    },
  });
  
  const movementType = form.watch('type');
  const selectedItemId = form.watch('itemId');
  const selectedHospitalIdForm = form.watch('hospitalId'); 
  const selectedUnitIdForm = form.watch('unitId'); 

  useEffect(() => {
    if (!userRole || !currentUserProfile) return;
  
    const currentFormValues = form.getValues();
    let newType = currentFormValues.type;
    let newHospitalId = currentFormValues.hospitalId;
    let newUnitId = currentFormValues.unitId;
  
    let roleBasedType: StockMovementType = 'entry';
    let roleBasedHospitalId: string | undefined = undefined;
    let roleBasedUnitId: string | undefined = undefined;
  
    if (userRole === 'hospital_operator' || userRole === 'ubs_operator') {
      roleBasedType = 'consumption';
      roleBasedHospitalId = currentUserProfile.associatedHospitalId;
      if (currentUserProfile.associatedUnitId) {
        roleBasedUnitId = currentUserProfile.associatedUnitId;
      }
    }
    
    let needsReset = false;
    if (newType !== roleBasedType) {
        newType = roleBasedType;
        needsReset = true;
    }
    if (newHospitalId !== roleBasedHospitalId && (userRole === 'hospital_operator' || userRole === 'ubs_operator')) {
        newHospitalId = roleBasedHospitalId;
        needsReset = true;
    }
    if (newUnitId !== roleBasedUnitId && (userRole === 'hospital_operator' || userRole === 'ubs_operator') && currentUserProfile.associatedUnitId) {
        newUnitId = roleBasedUnitId;
        needsReset = true;
    }
    
    if (roleBasedType === 'entry' && (newHospitalId !== undefined || newUnitId !== undefined)) {
        newHospitalId = undefined;
        newUnitId = undefined;
        needsReset = true;
    }
  
    if (needsReset) {
      form.reset({
        type: newType,
        hospitalId: newHospitalId,
        unitId: newUnitId,
        // Preserve other user-entered values if they are not directly tied to role change
        itemId: currentFormValues.itemId, 
        quantity: currentFormValues.quantity || 1,
        date: currentFormValues.date || new Date().toISOString().split('T')[0],
        notes: currentFormValues.notes || '',
        patientId: currentFormValues.patientId,
      }, { keepDirtyValues: true });
    }
  
  }, [currentUserProfile?.role, currentUserProfile?.associatedHospitalId, currentUserProfile?.associatedUnitId, form, userRole, currentUserProfile]);
  

  useEffect(() => {
    if (movementType === 'entry') {
        form.setValue('hospitalId', undefined, { shouldValidate: false });
        form.setValue('unitId', undefined, { shouldValidate: false });
        form.setValue('patientId', undefined, { shouldValidate: false });
    } else if (movementType === 'exit') {
        form.setValue('patientId', undefined, { shouldValidate: false });
    }
  }, [movementType, form]);

   useEffect(() => {
    if (!(isOperator && userAssociatedUnitId)) {
        if(form.getValues('hospitalId') !== selectedHospitalIdForm && selectedHospitalIdForm !== form.getValues('hospitalId')) { 
             form.setValue('unitId', undefined, { shouldValidate: false });
        }
    }
  }, [selectedHospitalIdForm, form, isOperator, userAssociatedUnitId]);


  const availableUnits = useMemo(() => {
    if (!selectedHospitalIdForm || selectedHospitalIdForm === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
      return [];
    }
    return servedUnits.filter(unit => unit.hospitalId === selectedHospitalIdForm);
  }, [selectedHospitalIdForm, servedUnits]);

  const isConsumptionInSpecificUBS = useMemo(() => {
    if (movementType !== 'consumption' || !selectedUnitIdForm || selectedUnitIdForm === GENERAL_STOCK_UNIT_ID_PLACEHOLDER) return false;
    const unit = servedUnits.find(u => u.id === selectedUnitIdForm);
    if (!unit) return false;
    const hospital = hospitals.find(h => h.id === unit.hospitalId);
    return hospital?.name.toLowerCase().includes('ubs') || false;
  }, [movementType, selectedUnitIdForm, servedUnits, hospitals]);

  const isConsumptionInGeneralUBS = useMemo(() => {
    if (movementType !== 'consumption' || selectedUnitIdForm !== GENERAL_STOCK_UNIT_ID_PLACEHOLDER) return false;
    if (!selectedHospitalIdForm) return false;
    const hospital = hospitals.find(h => h.id === selectedHospitalIdForm);
    return hospital?.name.toLowerCase().includes('ubs') || false;
  }, [movementType, selectedHospitalIdForm, selectedUnitIdForm, hospitals]);

  const showPatientSelection = movementType === 'consumption' && (isConsumptionInSpecificUBS || isConsumptionInGeneralUBS || (isOperator && hospitals.find(h => h.id === userAssociatedHospitalId)?.name.toLowerCase().includes('ubs')));


  const getDisplayStockForItem = (item: Item): number | string => {
    if (!currentUserProfile) return item.currentQuantityCentral;
  
    const formValues = form.getValues();
    const currentMovementType = formValues.type;
    const currentHospitalId = formValues.hospitalId;
    const currentUnitIdValue = formValues.unitId; // This can be GENERAL_STOCK_UNIT_ID_PLACEHOLDER or an actual unitId
  
    if (isAdminOrCentralOp) {
      if (currentMovementType === 'entry' || (!currentHospitalId || currentHospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE)) {
        return item.currentQuantityCentral;
      }
      // Admin/Central Op targeting specific unit or UBS general stock
      let configId: string | undefined;
      if (currentUnitIdValue && currentUnitIdValue !== GENERAL_STOCK_UNIT_ID_PLACEHOLDER) {
        configId = `${item.id}_${currentUnitIdValue}`;
      } else if (currentUnitIdValue === GENERAL_STOCK_UNIT_ID_PLACEHOLDER && currentHospitalId) {
        const hospital = hospitals.find(h => h.id === currentHospitalId);
        if (hospital?.name.toLowerCase().includes('ubs')) {
          configId = `${item.id}_${currentHospitalId}_${UBS_GENERAL_STOCK_SUFFIX}`;
        }
      }
      if (configId) {
        const unitConfig = stockConfigs.find(sc => sc.id === configId);
        return unitConfig?.currentQuantity ?? 0;
      }
      return item.currentQuantityCentral; // Fallback for admin if specific target stock isn't clear
    }
  
    if (isOperator) { // Always 'consumption' for operators
      let configId: string | undefined;
      const operatorHospitalId = currentUserProfile.associatedHospitalId;
      const operatorUnitId = currentUserProfile.associatedUnitId;
  
      if (operatorUnitId) { // Operator tied to a specific unit
        configId = `${item.id}_${operatorUnitId}`;
      } else if (operatorHospitalId) { // Operator for a hospital/UBS generally
        // Use the form's current unitId selection to determine which stock to show
        if (currentUnitIdValue && currentUnitIdValue !== GENERAL_STOCK_UNIT_ID_PLACEHOLDER) {
            configId = `${item.id}_${currentUnitIdValue}`; // Operator selected a specific unit
        } else if (currentUnitIdValue === GENERAL_STOCK_UNIT_ID_PLACEHOLDER) { // Operator selected "General UBS Stock"
            const hospital = hospitals.find(h => h.id === operatorHospitalId);
            if (hospital?.name.toLowerCase().includes('ubs')) {
                configId = `${item.id}_${operatorHospitalId}_${UBS_GENERAL_STOCK_SUFFIX}`;
            }
        }
        // If currentUnitIdValue is undefined (e.g. hospital operator, no unit selected yet), configId remains undefined
      }
  
      if (configId) {
        const unitConfig = stockConfigs.find(sc => sc.id === configId);
        return unitConfig?.currentQuantity ?? 0;
      }
      // If no specific config found (e.g. hospital operator hasn't selected a unit), display 0 or a placeholder
      return 0; 
    }
  
    return item.currentQuantityCentral; // Fallback
  };


  const onSubmit = async (data: MovementFormData) => {
    if (!currentUserProfile || !firebaseUser) {
        toast({ title: "Erro de Autenticação", description: "Usuário não autenticado.", variant: "destructive" });
        return;
    }
    setIsSubmitting(true);

    let processedData = {...data};
    if (data.hospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
        processedData.hospitalId = undefined;
        processedData.unitId = undefined;
    }
    // Ensure unitId is undefined if GENERAL_STOCK_UNIT_ID_PLACEHOLDER was selected.
    // This is crucial for the transaction logic to correctly identify general UBS stock.
    if (data.unitId === GENERAL_STOCK_UNIT_ID_PLACEHOLDER) {
        processedData.unitId = undefined; 
    }
    if (data.patientId === NO_PATIENT_ID) {
        processedData.patientId = undefined;
    }

    try {
      await runTransaction(firestore, (transaction) =>
        processMovementRowTransaction(
            transaction,
            processedData,
            currentUserProfile,
            items, hospitals, servedUnits, patients 
        )
      );

      const itemDetails = items.find(i => i.id === processedData.itemId);
      const patientDetails = processedData.patientId ? patients.find(p => p.id === processedData.patientId) : null;
      let description = `Movimentação de ${processedData.quantity} unidade(s) de ${itemDetails?.name || processedData.itemId} registrada como ${processedData.type}.`;

      const hospitalDesc = processedData.hospitalId ? hospitals.find(h => h.id === processedData.hospitalId) : null;
      const unitDesc = processedData.unitId ? servedUnits.find(u => u.id === processedData.unitId) : null;
      
      const hospitalForMovement = processedData.hospitalId ? hospitals.find(h => h.id === processedData.hospitalId) : null;
      const isUbsGeneralStockConsumptionForDesc =
            processedData.type === 'consumption' &&
            processedData.hospitalId &&
            !processedData.unitId && // This condition will be true if GENERAL_STOCK_UNIT_ID_PLACEHOLDER was selected and processedData.unitId became undefined
            (hospitalForMovement?.name.toLowerCase().includes('ubs') || false);


      if (processedData.type !== 'entry') {
          if (unitDesc && hospitalDesc) {
              description += ` para ${unitDesc.name} (${hospitalDesc.name}).`;
          } else if (hospitalDesc && isUbsGeneralStockConsumptionForDesc) { 
              description += ` (Estoque Geral de ${hospitalDesc.name}).`;
          } else if (!processedData.hospitalId && !processedData.unitId) {
              description += ` (Baixa/Consumo direto do Armazém Central).`;
          }
      }
      if (patientDetails) {
        description += ` Paciente: ${patientDetails.name}.`;
      }

      toast({
        title: "Movimentação de Estoque Registrada",
        description: description,
      });
      
      let resetType: StockMovementType = 'entry';
      let resetHospitalId: string | undefined = undefined;
      let resetUnitId: string | undefined = undefined;

      if (userRole === 'hospital_operator' || userRole === 'ubs_operator') {
        resetType = 'consumption';
        resetHospitalId = userAssociatedHospitalId;
        if (userAssociatedUnitId) {
          resetUnitId = userAssociatedUnitId;
        }
      }

      form.reset({ 
          type: resetType,
          quantity: 1,
          date: new Date().toISOString().split('T')[0],
          notes: '',
          itemId: undefined,
          hospitalId: resetHospitalId,
          unitId: resetUnitId,
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

  if (!currentUserProfile) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="animate-spin h-8 w-8" /> <p className="ml-2">Carregando perfil...</p></div>;
  }
  
  return (
      <Card className="max-w-2xl mx-auto shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Nova Movimentação de Estoque Manual</CardTitle>
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
                        disabled={isOperator}
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
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecione um item" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {items.length === 0 && <SelectItem value="loading" disabled>Carregando itens...</SelectItem>}
                        {items.map(item => (
                            <SelectItem key={item.id} value={item.id}>
                                {item.name} ({item.code}) - Disponível: {getDisplayStockForItem(item)}
                            </SelectItem>
                        ))}
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
                            value={field.value ?? (isAdminOrCentralOp ? CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE : "")}
                            disabled={isOperator && !!userAssociatedHospitalId}
                        >
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione um hospital ou baixa direta" /></SelectTrigger></FormControl>
                          <SelectContent>
                             {isAdminOrCentralOp && <SelectItem value={CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE}>Nenhum (Baixa/Consumo direto do Armazém Central)</SelectItem>}
                            {hospitals
                                .filter(h => isAdminOrCentralOp || h.id === userAssociatedHospitalId)
                                .map(hospital => <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                         <FormDescription>
                            {movementType === 'exit' && "Para transferir, selecione o hospital. Para baixa direta do Armazém Central (Admin/Op.Central), escolha 'Nenhum'."}
                            {movementType === 'consumption' && (isOperator ? "Hospital de consumo (automático)." : "Selecione o hospital ou 'Nenhum' para consumo direto do Central.")}
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
                          <FormLabel>Unidade Servida de Destino/Consumo</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value ?? ((userRole === 'ubs_operator' && !userAssociatedUnitId && selectedHospitalIdForm === userAssociatedHospitalId) ? GENERAL_STOCK_UNIT_ID_PLACEHOLDER : undefined)}
                            disabled={
                                (isOperator && !!userAssociatedUnitId) ||
                                (!selectedHospitalIdForm || (availableUnits.length === 0 && !(userRole === 'ubs_operator' && !userAssociatedUnitId)))
                            }
                          >
                            <FormControl><SelectTrigger>
                                <SelectValue placeholder={
                                    (isOperator && userAssociatedUnitId) ? servedUnits.find(u=>u.id === userAssociatedUnitId)?.name :
                                    ((availableUnits.length > 0 || (userRole === 'ubs_operator' && !userAssociatedUnitId && hospitals.find(h => h.id === selectedHospitalIdForm)?.name.toLowerCase().includes('ubs'))) ? "Selecione uma unidade ou Estoque Geral UBS" : "Nenhuma unidade para este hospital")} />
                            </SelectTrigger></FormControl>
                            <SelectContent>
                              {userRole === 'ubs_operator' && !userAssociatedUnitId && selectedHospitalIdForm === userAssociatedHospitalId && hospitals.find(h => h.id === selectedHospitalIdForm)?.name.toLowerCase().includes('ubs') &&
                                <SelectItem value={GENERAL_STOCK_UNIT_ID_PLACEHOLDER}>Estoque Geral da UBS</SelectItem>
                              }
                              {availableUnits.map(unit => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                           <FormDescription>
                                {movementType === 'exit' && "Unidade para a qual o item está sendo transferido."}
                                {movementType === 'consumption' && "Unidade onde o item foi consumido. Para UBS, pode ser 'Estoque Geral da UBS'."}
                           </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  {movementType === 'consumption' && showPatientSelection && (
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
                            <FormDescription>Selecione o paciente se o consumo for individualizado.</FormDescription>
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


const BatchImportMovementsForm = ({ items, servedUnits, hospitals, patients, isLoadingDataFromParent }: { items: Item[], servedUnits: ServedUnit[], hospitals: Hospital[], patients: Patient[], isLoadingDataFromParent: boolean }) => {
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
    const csvHeader = "Código do Item,Tipo,Quantidade,Data,Nome do Hospital Destino/Consumo,Nome da Unidade Destino/Consumo,Cartão SUS Paciente,Observações\n";
    const csvExampleRow1 = "ITEM001,entrada,100,2024-01-15,,,,,\n";
    const csvExampleRow2 = "ITEM002,saida,10,2024-01-16,Hospital Central,UTI Geral,,Transferência urgente\n";
    const csvExampleRow3 = "ITEM003,consumo,2,2024-01-17,UBS Vila Nova,Consultório 1,700123456789012,Consumo paciente Maria\n";
    const csvExampleRow4 = "ITEM001,saida,5,2024-01-18,,,,Baixa por ajuste de inventário\n";


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
                    const hospitalNameCsv = row["Nome do Hospital Destino/Consumo"]?.trim();
                    const unitNameCsv = row["Nome da Unidade Destino/Consumo"]?.trim();
                    const patientSUS = row["Cartão SUS Paciente"]?.trim();
                    const notesCsv = row["Observações"]?.trim();

                    if (!itemCodeForRow || itemCodeForRow === "N/A" || !typeStr || !quantityStr || !dateStr) {
                        importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Código do Item, Tipo, Quantidade e Data são obrigatórios.`);
                        continue;
                    }
                    const isValidType = typeStr === 'entrada' || typeStr === 'saida' || typeStr === 'consumo';
                    if (!isValidType) {
                        importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Tipo inválido ('${row["Tipo"]}'). Use 'entrada', 'saida' ou 'consumo'.`);
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
                    const parsedDate = new Date(dateStr + "T00:00:00Z");
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
                    let patientId: string | undefined = undefined;

                    if (typeStr === 'saida' || typeStr === 'consumo') {
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
                                 const hospitalIsUbs = hospital?.name.toLowerCase().includes('ubs');
                                 if (typeStr === 'consumo' && hospitalIsUbs) {
                                     // This is consumption from general UBS stock, unitId remains undefined
                                 } else if (typeStr === 'saida' && !hospitalIsUbs) { 
                                     importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Saída para Hospital ('${hospitalNameCsv}') sem unidade específica não é um cenário padrão (exceto se for baixa direta do Central).`);
                                     continue;
                                 } else if (typeStr === 'consumo' && !hospitalIsUbs) {
                                    importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Consumo em Hospital ('${hospitalNameCsv}') requer uma unidade específica.`);
                                    continue;
                                 }
                            }
                        } else if (typeStr === 'saida' || typeStr === 'consumo') {
                            // This is direct exit/consumption from Central Warehouse
                        }
                    }
                    if (typeStr === 'consumo' && patientSUS) {
                        const patient = patients.find(p => p.susCardNumber === patientSUS);
                        if (!patient) {
                            importErrors.push(`Linha ${originalRowIndex} (${itemCodeForRow}): Paciente com SUS '${patientSUS}' não encontrado.`);
                            continue;
                        }
                        patientId = patient.id;
                    }
                    
                    const movementDataForTx: MovementFormData & { itemId: string } = {
                        itemId: item.id, type: typeStr as MovementFormData['type'], quantity, date: formattedDate,
                        hospitalId, unitId, patientId, notes: notesCsv
                    };
                    
                     await runTransaction(firestore, (transaction) =>
                        processMovementRowTransaction(
                            transaction,
                            movementDataForTx,
                            currentUserProfile,
                            items, hospitals, servedUnits, patients,
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
        <CardTitle className="font-headline">Importar Movimentações em Lote</CardTitle>
        <CardDescription>
          Faça o upload de um arquivo .csv. A primeira linha deve ser o cabeçalho. Apenas Admin/Op.Central.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
         <Alert>
            <Download className="h-4 w-4" />
            <AlertTitle>Formato da Planilha de Movimentações</AlertTitle>
            <AlertDescription>
              <p className="mb-2">Colunas (nesta ordem):</p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li><code>Código do Item</code> (Texto, Obrigatório)</li>
                <li><code>Tipo</code> (Texto, Obrigatório - 'entrada', 'saida' ou 'consumo')</li>
                <li><code>Quantidade</code> (Número, Obrigatório - Positivo)</li>
                <li><code>Data</code> (Data AAAA-MM-DD, Obrigatório)</li>
                <li><code>Nome do Hospital Destino/Consumo</code> (Texto, Opcional/Condicional)</li>
                <li><code>Nome da Unidade Destino/Consumo</code> (Texto, Opcional/Condicional)</li>
                <li><code>Cartão SUS Paciente</code> (Texto, Opcional - 15 dígitos)</li>
                <li><code>Observações</code> (Texto, Opcional)</li>
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                <strong>Notas:</strong><br/>
                - Para <strong>entrada</strong>: Deixe Hospital e Unidade em branco.<br/>
                - Para <strong>saida/consumo (baixa direta do Armazém Central)</strong>: Deixe Hospital e Unidade em branco.<br/>
                - Para <strong>saida/consumo (unidade específica)</strong>: Preencha Hospital e Unidade. <br/>
                - Para <strong>consumo (estoque geral de UBS)</strong>: Preencha Hospital (nome da UBS), deixe Unidade em branco.
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
  const [patients, setPatients] = useState<Patient[]>([]);
  const [stockConfigs, setStockConfigs] = useState<FirestoreStockConfig[]>([]); // Adicionado
  const { toast } = useToast();
  const [isLoadingData, setIsLoadingData] = useState(true);


  useEffect(() => {
    setIsLoadingData(true);
    const listeners = [
      { coll: "items", setter: setItems, msg: "Itens" },
      { coll: "hospitals", setter: setHospitals, msg: "Hospitais" },
      { coll: "servedUnits", setter: setServedUnits, msg: "Unidades Servidas" },
      { coll: "patients", setter: setPatients, msg: "Pacientes" },
      { coll: "stockConfigs", setter: setStockConfigs, msg: "Configurações de Estoque" }, // Adicionado
    ];
    
    let loadedCount = 0;
    const unsubscribers: (()=>void)[] = [];

    listeners.forEach(config => {
      const q = query(collection(firestore, config.coll), orderBy("name", "asc")); // Assumindo 'name' para orderBy, pode precisar de ajuste para stockConfigs
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
        // Se stockConfigs for o último a carregar, atualize loadedCount e setIsLoadingData
        const itemsListener = listeners.find(l => l.coll === "items"); // Exemplo, ajuste conforme sua lógica de contagem
        if (itemsListener && loadedCount >= listeners.length -1 ) { // Se todos os outros já carregaram
            const isStockConfigsTheLastToLoad = !listeners.find(l => l.coll === "stockConfigs")?.msg; // Lógica simplificada
            if (isStockConfigsTheLastToLoad) { // Este if pode precisar ser mais robusto
                 //loadedCount++; // se não estiver no array de listeners
                 //if (loadedCount === listeners.length +1) setIsLoadingData(false);
            }
        }
    }, (error) => {
         console.error(`Erro ao buscar Configurações de Estoque: `, error);
         toast({ title: `Erro ao Carregar Configurações de Estoque`, variant: "destructive" });
    });
    unsubscribers.push(unsubscribeStockConfigs);


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
            <ManualMovementForm 
                items={items} 
                servedUnits={servedUnits} 
                hospitals={hospitals} 
                patients={patients} 
                stockConfigs={stockConfigs} 
            />
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
    

