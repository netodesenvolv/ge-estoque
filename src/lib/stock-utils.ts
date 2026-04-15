
import { firestore } from '@/lib/firebase';
import { collection, Transaction, doc } from 'firebase/firestore';
import type { Item, ServedUnit, Hospital, Patient, StockMovement, UserProfile, StockMovementType, PendingTransfer } from '@/types';

const UBS_GENERAL_STOCK_SUFFIX = "UBSGENERAL";

/**
 * Generic transaction function for processing stock movements (entry, exit/transfer, consumption).
 * This is used by both the central warehouse movements page and the hospital/unit consumption pages.
 */
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
    let unitConfigSnap: any = null;
    let unitConfigDocId: string | null = null;

    const hospitalForMovement = movementData.hospitalId ? allMasterHospitals.find(h => h.id === movementData.hospitalId) : null;
    const isUbsGeneralStockMovement =
        (movementData.type === 'exit' || movementData.type === 'consumption') &&
        movementData.hospitalId &&
        !movementData.unitId && 
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
            // Deduct from Central immediately
            const newCentralQuantityAfterTransfer = currentCentralQty - movementData.quantity;
            transaction.update(itemDocRef, { currentQuantityCentral: newCentralQuantityAfterTransfer });

            // Resolve destination names
            const destHospital = allMasterHospitals.find(h => h.id === movementData.hospitalId);
            const destUnit = movementData.unitId ? allMasterServedUnits.find(u => u.id === movementData.unitId) : null;
            const destUnitName = destUnit?.name
                ?? unitNameForLog
                ?? (isUbsGeneralStockMovement ? `Estoque Geral (${destHospital?.name ?? hospitalNameForLog ?? ''})` : 'Destino Desconhecido');

            // --- SHIPMENT GROUPING LOGIC ---
            const userId = (currentUserProfile as any).id || "unknown";
            const shipmentIdSlug = `shipment_${movementData.hospitalId}_${movementData.unitId || 'general'}_${movementData.date}_${userId}`.replace(/[^a-z0-9_]/gi, '_');
            const shipmentRef = doc(firestore, 'pendingTransfers', shipmentIdSlug);
            const shipmentSnap = await transaction.get(shipmentRef);

            if (!shipmentSnap.exists()) {
                const counterRef = doc(firestore, 'counters', 'shipments');
                const counterSnap = await transaction.get(counterRef);
                const currentYear = new Date().getFullYear();
                let nextValue = 1;
                
                if (counterSnap.exists()) {
                    const data = counterSnap.data() as { year: number, lastValue: number };
                    if (data.year === currentYear) {
                        nextValue = (data.lastValue || 0) + 1;
                    }
                }
                
                transaction.set(counterRef, { year: currentYear, lastValue: nextValue }, { merge: true });
                const shipmentNumber = `RM-${currentYear}-${String(nextValue).padStart(4, '0')}`;

                const initialItems: any[] = [{
                    itemId: movementData.itemId,
                    itemName: currentItemData.name,
                    quantitySent: movementData.quantity,
                    notes: movementData.notes ?? notesForLog ?? null
                }];

                const newShipmentData: Omit<PendingTransfer, 'id'> = {
                    items: initialItems,
                    shipmentNumber,
                    sourceType: 'central_warehouse',
                    destinationHospitalId: movementData.hospitalId!,
                    destinationHospitalName: destHospital?.name ?? hospitalNameForLog ?? 'Desconhecido',
                    destinationUnitId: movementData.unitId ?? null,
                    destinationUnitName: destUnitName,
                    status: 'pending_receipt',
                    transferDate: movementData.date,
                    transferredByUserId: userId,
                    transferredByUserName: currentUserProfile.name ?? 'Desconhecido',
                    notes: null,
                    createdAt: new Date().toISOString(),
                };
                transaction.set(shipmentRef, newShipmentData);
            } else {
                const shipmentData = shipmentSnap.data() as PendingTransfer;
                const items = [...(shipmentData.items || [])];
                const existingItemIndex = items.findIndex(i => i.itemId === movementData.itemId);

                if (existingItemIndex > -1) {
                    items[existingItemIndex].quantitySent += movementData.quantity;
                } else {
                    items.push({
                        itemId: movementData.itemId,
                        itemName: currentItemData.name,
                        quantitySent: movementData.quantity,
                        notes: movementData.notes ?? notesForLog ?? null
                    });
                }
                transaction.update(shipmentRef, { items });
            }

            movementData = { ...movementData, type: 'transfer' as StockMovementType };
        } else {
            throw new Error("Destino (Hospital e Unidade/Estoque Geral UBS, ou Baixa Direta) é obrigatório e deve ser válido para saída/transferência.");
        }
    } else if (movementData.type === 'consumption') {
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
        else if (movementData.hospitalId && unitConfigDocRef) {
             if (!unitConfigSnap || !unitConfigSnap.exists()) {
                throw new Error(`Configuração de estoque não encontrada para ${currentItemData.name} no local de consumo (ID: ${unitConfigDocId}). Estoque inicial pode não ter sido transferido ou configurado.`);
            }
            let currentUnitQty = unitConfigSnap.data().currentQuantity || 0;
            if (currentUnitQty < movementData.quantity) {
                throw new Error(`Estoque insuficiente (${currentUnitQty}) no local de consumo para ${currentItemData.name}. Necessário: ${movementData.quantity}`);
            }
            const newUnitQuantity = currentUnitQty - movementData.quantity;
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
        notes: movementData.notes ?? notesForLog ?? undefined,
        hospitalId: movementData.hospitalId ?? undefined,
        hospitalName: hospitalDetailsForLog?.name ?? hospitalNameForLog ?? undefined,
        unitId: movementData.unitId ?? undefined,
        unitName: unitDetailsForLog?.name ?? unitNameForLog ?? (isUbsGeneralStockMovement ? `Estoque Geral (${hospitalDetailsForLog?.name})` : (movementData.type === 'entry' || (!movementData.hospitalId && (movementData.type === 'exit' || movementData.type === 'consumption')) ? 'Armazém Central' : undefined)),
        patientId: movementData.patientId ?? undefined,
        patientName: patientDetailsForLog?.name ?? undefined,
        userId: (currentUserProfile as any).id || "unknown_user_id",
        userDisplayName: currentUserProfile.name ?? "Unknown User",
    };
    
    // Remove undefined fields
    Object.keys(movementLog).forEach(
      key => (movementLog as any)[key] === undefined && delete (movementLog as any)[key]
    );

    const stockMovementsCollectionRef = collection(firestore, "stockMovements");
    transaction.set(doc(stockMovementsCollectionRef), movementLog);
}
