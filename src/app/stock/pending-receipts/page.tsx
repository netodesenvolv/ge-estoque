'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, XCircle, Inbox, Loader2, PackageCheck, Pencil, Eye, Trash2, PlusCircle, Printer, ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';
import type { PendingTransfer, FirestoreStockConfig, Item, Hospital, ServedUnit, ShipmentItem } from '@/types';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { firestore } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  runTransaction,
  doc,
} from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

const UBS_GENERAL_STOCK_SUFFIX = "UBSGENERAL";
const GENERAL_STOCK_UNIT_ID_PLACEHOLDER = "__GENERAL_STOCK_UNIT__";

export default function PendingReceiptsPage() {
  const { toast } = useToast();
  const { currentUserProfile, user } = useAuth();

  const [pendingShipments, setPendingShipments] = useState<PendingTransfer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  // Master Data
  const [items, setItems] = useState<Item[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);

  // Dialog states
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<PendingTransfer | null>(null);
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, number>>({});
  const [isConfirming, setIsConfirming] = useState(false);

  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<PendingTransfer | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PendingTransfer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PendingTransfer | null>(null);
  const [editItems, setEditItems] = useState<ShipmentItem[]>([]);
  const [editDate, setEditDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [newItemSelection, setNewItemSelection] = useState('');

  const isAdmin = currentUserProfile?.role === 'admin';
  const isCentralOp = currentUserProfile?.role === 'central_operator';
  const isDestinationOp = currentUserProfile?.role === 'hospital_operator' || currentUserProfile?.role === 'ubs_operator';

  // Fetch Master Data
  useEffect(() => {
    if (!isAdmin && !isCentralOp) return;
    const unsubItems = onSnapshot(collection(firestore, 'items'), (snap) => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Item[]);
    });
    return () => unsubItems();
  }, [isAdmin, isCentralOp]);

  // Fetch Shipments
  useEffect(() => {
    if (!currentUserProfile) return;
    const hospitalId = currentUserProfile.associatedHospitalId;
    let q;
    if (isAdmin || isCentralOp) {
      q = query(collection(firestore, 'pendingTransfers'), where('status', '==', 'pending_receipt'));
    } else if (isDestinationOp && hospitalId) {
      q = query(collection(firestore, 'pendingTransfers'), where('status', '==', 'pending_receipt'), where('destinationHospitalId', '==', hospitalId));
    } else {
      setIsLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const shipments = snapshot.docs.map(d => {
        const data = d.data() as any;
        // If it already has the 'items' array, it's the new format
        if (Array.isArray(data.items)) {
          return { id: d.id, ...data } as PendingTransfer;
        }
        
        // Otherwise, it's a legacy document - convert to new format on-the-fly
        return {
          id: d.id,
          ...data,
          items: [{
            itemId: data.itemId,
            itemName: data.itemName,
            quantitySent: data.quantity,
            notes: data.notes || null,
          }],
          shipmentNumber: data.shipmentNumber || 'LEGADO'
        } as PendingTransfer;
      });

      shipments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setPendingShipments(shipments);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, [currentUserProfile, isAdmin, isCentralOp, isDestinationOp]);

  // Actions
  const toggleExpand = (id: string) => {
    setExpandedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const openConfirmDialog = (shipment: PendingTransfer) => {
    setConfirmTarget(shipment);
    const initialQtys: Record<string, number> = {};
    shipment.items.forEach(item => {
      initialQtys[item.itemId] = item.quantitySent;
    });
    setReceivedQuantities(initialQtys);
    setConfirmDialogOpen(true);
  };

  const handleConfirmReceipt = async () => {
    if (!confirmTarget || !user || !currentUserProfile) return;
    setIsConfirming(true);
    try {
      await runTransaction(firestore, async (transaction) => {
        const shipmentRef = doc(firestore, 'pendingTransfers', confirmTarget.id);
        const resolvedItems = confirmTarget.items.map(item => ({
          ...item,
          quantityReceived: receivedQuantities[item.itemId] ?? 0
        }));

        // 1. COLLECT ALL READS FIRST
        const unitConfigRefs: Record<string, any> = {};
        const itemRefs: Record<string, any> = {};

        for (const item of resolvedItems) {
          const unitConfigDocId = confirmTarget.destinationUnitId
            ? `${item.itemId}_${confirmTarget.destinationUnitId}`
            : `${item.itemId}_${confirmTarget.destinationHospitalId}_${UBS_GENERAL_STOCK_SUFFIX}`;
          
          unitConfigRefs[item.itemId] = doc(firestore, 'stockConfigs', unitConfigDocId);
          
          const diff = item.quantitySent - item.quantityReceived;
          if (diff > 0) {
            itemRefs[item.itemId] = doc(firestore, 'items', item.itemId);
          }
        }

        // Execute all reads
        const unitConfigSnaps: Record<string, any> = {};
        const itemSnaps: Record<string, any> = {};

        for (const itemId in unitConfigRefs) {
          unitConfigSnaps[itemId] = await transaction.get(unitConfigRefs[itemId]);
        }
        for (const itemId in itemRefs) {
          itemSnaps[itemId] = await transaction.get(itemRefs[itemId]);
        }

        // 2. PERFORM ALL WRITES SECOND
        for (const item of resolvedItems) {
          const diff = item.quantitySent - item.quantityReceived;
          
          // Destination stock update
          const unitConfigSnap = unitConfigSnaps[item.itemId];
          const currentUnitQty = unitConfigSnap.exists() ? (unitConfigSnap.data().currentQuantity ?? 0) : 0;
          
          transaction.set(unitConfigRefs[item.itemId], {
            itemId: item.itemId,
            hospitalId: confirmTarget.destinationHospitalId,
            currentQuantity: currentUnitQty + item.quantityReceived,
            unitId: confirmTarget.destinationUnitId ?? null,
          }, { merge: true });

          // Discrepancy return to Central
          if (diff > 0) {
            const itemSnap = itemSnaps[item.itemId];
            const centralQty = (itemSnap.data()?.currentQuantityCentral ?? 0) as number;
            transaction.update(itemRefs[item.itemId], { currentQuantityCentral: centralQty + diff });
          }

          // Log Movement
          const movRef = doc(collection(firestore, 'stockMovements'));
          transaction.set(movRef, {
            itemId: item.itemId,
            itemName: item.itemName,
            type: diff === 0 ? 'receipt_confirmed' : 'receipt_partially_confirmed',
            quantity: item.quantityReceived,
            date: new Date().toISOString().split('T')[0],
            hospitalId: confirmTarget.destinationHospitalId,
            hospitalName: confirmTarget.destinationHospitalName,
            unitId: confirmTarget.destinationUnitId ?? null,
            unitName: confirmTarget.destinationUnitName,
            notes: diff === 0 ? `Recebimento total (Guia ${confirmTarget.shipmentNumber})` : `Recebimento parcial. Divergência de ${diff} devolvida ao Central.`,
            userId: user.uid,
            userDisplayName: currentUserProfile.name,
          });
        }

        transaction.update(shipmentRef, {
          status: 'completed',
          items: resolvedItems,
          resolvedAt: new Date().toISOString(),
          resolvedByUserId: user.uid,
          resolvedByUserName: currentUserProfile.name,
        });
      });

      toast({ title: '✅ Remessa Confirmada!', description: `A remessa ${confirmTarget.shipmentNumber} foi processada.` });
      setConfirmDialogOpen(false);
    } catch (error: any) {
      toast({ title: 'Erro ao Confirmar', description: error.message, variant: 'destructive' });
    } finally {
      setIsConfirming(false);
    }
  };

  const handleRejectShipment = async () => {
    if (!rejectTarget || !user || !currentUserProfile) return;
    setProcessingId(rejectTarget.id);
    setRejectDialogOpen(false);
    try {
      await runTransaction(firestore, async (transaction) => {
        for (const item of rejectTarget.items) {
          const itemRef = doc(firestore, 'items', item.itemId);
          const itemSnap = await transaction.get(itemRef);
          const centralQty = (itemSnap.data()?.currentQuantityCentral ?? 0) as number;
          transaction.update(itemRef, { currentQuantityCentral: centralQty + item.quantitySent });
        }
        transaction.update(doc(firestore, 'pendingTransfers', rejectTarget.id), {
          status: 'rejected',
          resolvedAt: new Date().toISOString(),
          resolvedByUserId: user.uid,
          resolvedByUserName: currentUserProfile.name,
          notes: rejectNotes || 'Rejeitado pelo destino.'
        });
      });
      toast({ title: '❌ Remessa Rejeitada', description: 'Todos os itens voltaram ao Almoxarifado Central.' });
    } catch (error: any) {
      toast({ title: 'Erro ao Rejeitar', description: error.message, variant: 'destructive' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleSaveEdit = async () => {
    if (!editTarget || !user || !currentUserProfile) return;
    setIsSavingEdit(true);
    try {
      await runTransaction(firestore, async (transaction) => {
        const shipmentRef = doc(firestore, 'pendingTransfers', editTarget.id);
        const oldItems = editTarget.items;
        const newItems = editItems;

        // Inventory reconcile
        // 1. Items removed from list: return their stock to Central
        const removed = oldItems.filter(oi => !newItems.find(ni => ni.itemId === oi.itemId));
        for (const item of removed) {
          const itemRef = doc(firestore, 'items', item.itemId);
          const itemSnap = await transaction.get(itemRef);
          const qty = (itemSnap.data()?.currentQuantityCentral ?? 0) as number;
          transaction.update(itemRef, { currentQuantityCentral: qty + item.quantitySent });
        }

        // 2. Items added or quantity changed
        for (const ni of newItems) {
          const oi = oldItems.find(x => x.itemId === ni.itemId);
          const diff = ni.quantitySent - (oi?.quantitySent ?? 0);
          if (diff !== 0) {
            const itemRef = doc(firestore, 'items', ni.itemId);
            const itemSnap = await transaction.get(itemRef);
            const centralQty = (itemSnap.data()?.currentQuantityCentral ?? 0) as number;
            if (centralQty < diff) throw new Error(`Estoque insuficiente de "${ni.itemName}" no Central.`);
            transaction.update(itemRef, { currentQuantityCentral: centralQty - diff });
          }
        }

        transaction.update(shipmentRef, {
          items: newItems,
          transferDate: editDate,
          notes: editNotes || null
        });
      });
      toast({ title: '✏️ Remessa Atualizada', description: 'Modificações salvas com sucesso.' });
      setEditDialogOpen(false);
    } catch (error: any) {
      toast({ title: 'Erro ao Salvar', description: error.message, variant: 'destructive' });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const addItemToEdit = () => {
    if (!newItemSelection) return;
    const itemMaster = items.find(i => i.id === newItemSelection);
    if (!itemMaster) return;
    if (editItems.find(i => i.itemId === newItemSelection)) {
      toast({ title: 'Item já existe', description: 'Este item já está na lista.' });
      return;
    }
    setEditItems([...editItems, { itemId: itemMaster.id, itemName: itemMaster.name, quantitySent: 1, notes: '' }]);
    setNewItemSelection('');
  };

  const handlePrint = (shipment: PendingTransfer) => {
    // Basic browser printing - ideally this would open a new window with PrintableShipment
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    const itemsHtml = shipment.items.map(i => `
      <tr>
        <td style="border: 1px solid #ddd; padding: 10px;">${i.itemName}</td>
        <td style="border: 1px solid #ddd; padding: 10px; text-align: center; font-weight: bold;">${i.quantitySent}</td>
        <td style="border: 1px solid #ddd; padding: 10px; width: 100px;"></td>
        <td style="border: 1px solid #ddd; padding: 10px; color: #666; font-size: 11px;">${i.notes || ''}</td>
      </tr>
    `).join('');

    const shipmentNum = shipment.shipmentNumber || 'RM-XXXX';

    printWindow.document.write(`
      <html>
        <head>
          <title>Guia de Remessa - ${shipmentNum}</title>
          <style>
            @page { size: A4; margin: 10mm 15mm; }
            body { font-family: 'Segoe UI', system-ui, sans-serif; color: #1a1a1a; margin: 0; padding: 0; line-height: 1.3; }
            .container { max-width: 100%; }
            
            .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 15px; border-bottom: 2px solid #000; padding-bottom: 10px; }
            .header-info h1 { margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 0.5px; }
            .header-info p { margin: 2px 0 0 0; font-size: 11px; color: #444; }
            .header-info b { color: #000; font-size: 13px; }
            
            .meta-info { text-align: right; font-size: 11px; }
            .meta-info p { margin: 1px 0; }
            .meta-info b { font-size: 12px; }
            
            table { width: 100%; border-collapse: collapse; margin-top: 10px; table-layout: fixed; }
            thead { display: table-header-group; } /* Makes header repeat on pages */
            th { border: 1.5px solid #000; padding: 6px 8px; background: #f0f0f0; font-size: 10px; text-transform: uppercase; font-weight: bold; text-align: left; }
            td { border: 1px solid #666; padding: 4px 8px; font-size: 11px; word-wrap: break-word; vertical-align: middle; }
            
            .footer { margin-top: 30px; display: flex; justify-content: space-between; gap: 30px; page-break-inside: avoid; }
            .signature-box { flex: 1; text-align: center; }
            .line { border-top: 1px solid #000; margin-bottom: 5px; }
            .signature-box p { margin: 0; font-size: 10px; font-weight: bold; text-transform: uppercase; color: #333; }
            
            .timestamp { margin-top: 20px; font-size: 9px; color: #777; text-align: right; }
          </style>
        </head>
        <body onload="window.setTimeout(() => { window.print(); window.close(); }, 500)">
          <div class="container">
            <div class="header">
              <div class="header-info">
                <h1>Guia de Remessa</h1>
                <p><b>Nº:</b> ${shipmentNum} &nbsp; | &nbsp; <b>Destino:</b> ${shipment.destinationHospitalName} - ${shipment.destinationUnitName}</p>
              </div>
              <div class="meta-info">
                <p>Data: <b>${format(parseISO(shipment.transferDate), 'dd/MM/yyyy')}</b></p>
                <p>Emissor: <b>${shipment.transferredByUserName}</b></p>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th style="width: 45%;">Descrição do Item</th>
                  <th style="width: 10%; text-align: center;">Qtd Env.</th>
                  <th style="width: 12%; text-align: center;">Qtd Rec.</th>
                  <th style="width: 33%;">Observações</th>
                </tr>
              </thead>
              <tbody>${itemsHtml}</tbody>
            </table>

            <div class="footer">
              <div class="signature-box">
                <div class="line" style="margin-top: 30px;"></div>
                <p>Enviado por (Saída)</p>
              </div>
              <div class="signature-box">
                <div class="line" style="margin-top: 30px;"></div>
                <p>Recebido por (Conferência)</p>
              </div>
            </div>

            <div class="timestamp">
              Emissão: ${format(new Date(), 'dd/MM/yyyy HH:mm:ss')} • GESTÃO DE ESTOQUE
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Remessas Pendentes" description="Gestão de entregas e conferência de estoque entre unidades." icon={PackageCheck} />

      <Card className="shadow-lg">
        <CardHeader className="bg-muted/10">
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-5 w-5 text-primary" />
            Acompanhamento de Remessas
            {pendingShipments.length > 0 && <Badge variant="destructive" className="ml-2">{pendingShipments.length}</Badge>}
          </CardTitle>
          <CardDescription>Visualize as guias enviadas pelo Almoxarifado e confirme o recebimento físico.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : pendingShipments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">Nenhuma remessa pendente.</div>
          ) : (
            <div className="space-y-4">
              {pendingShipments.map(s => (
                <Card key={s.id} className="overflow-hidden border-muted/50">
                  <div className="flex flex-wrap items-center justify-between p-4 bg-muted/5 gap-4">
                    <div className="flex items-center gap-4">
                      <div className="bg-primary/10 p-2 rounded-lg">
                        <PackageCheck className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-bold text-lg">{s.shipmentNumber}</h3>
                        <p className="text-sm text-muted-foreground font-medium">{s.destinationHospitalName} — {s.destinationUnitName}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Badge variant="outline" className="bg-white">{format(parseISO(s.transferDate), 'dd/MM/yyyy')}</Badge>
                      <span className="hidden sm:inline">• por {s.transferredByUserName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                       <Button size="sm" variant="ghost" onClick={() => toggleExpand(s.id)}>
                        {expandedIds.includes(s.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        <span className="ml-1 hidden sm:inline">{expandedIds.includes(s.id) ? 'Recolher' : 'Ver Itens'}</span>
                      </Button>
                      {isAdmin || isCentralOp ? (
                        <>
                          <Button size="sm" variant="outline" onClick={() => { setEditTarget(s); setEditItems([...(s.items || [])]); setEditDate(s.transferDate); setEditNotes(s.notes || ''); setEditDialogOpen(true); }}>
                            <Pencil className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Editar</span>
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handlePrint(s)}>
                             <Printer className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Guia</span>
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => openConfirmDialog(s)}>
                          <CheckCircle2 className="h-4 w-4 mr-1" /> Receber
                        </Button>
                      )}
                    </div>
                  </div>

                  {expandedIds.includes(s.id) && (
                    <div className="border-t p-0">
                      <Table>
                        <TableHeader className="bg-muted/30">
                          <TableRow>
                            <TableHead className="pl-6">Item</TableHead>
                            <TableHead className="text-center">Qtd Enviada</TableHead>
                            <TableHead>Observações</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(s.items || []).map((item, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="pl-6 font-medium">{item.itemName}</TableCell>
                              <TableCell className="text-center font-bold text-primary">{item.quantitySent}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{item.notes || '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- CONFIRM DIALOG (RECEIVER) --- */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Conferência de Recebimento — {confirmTarget?.shipmentNumber}</DialogTitle><DialogDescription>Confirme as quantidades recebidas fisicamente para atualizar o estoque local.</DialogDescription></DialogHeader>
          <div className="py-4">
             <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-center">Qtd. Enviada</TableHead>
                    <TableHead className="w-[150px]">Qtd. Recebida</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(confirmTarget?.items || []).map(item => (
                    <TableRow key={item.itemId}>
                      <TableCell className="font-medium">{item.itemName}</TableCell>
                      <TableCell className="text-center">{item.quantitySent}</TableCell>
                      <TableCell>
                        <Input 
                          type="number" 
                          value={receivedQuantities[item.itemId] ?? 0} 
                          onChange={e => setReceivedQuantities(prev => ({ ...prev, [item.itemId]: Number(e.target.value) }))}
                          className={receivedQuantities[item.itemId] !== item.quantitySent ? 'border-amber-500 bg-amber-50' : ''}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
             </Table>
             {confirmTarget?.items.some(i => (receivedQuantities[i.itemId] ?? 0) < i.quantitySent) && (
               <div className="mt-4 p-3 bg-amber-100 border border-amber-200 rounded-md text-sm text-amber-800 flex gap-2">
                 <ShieldAlert className="h-5 w-5 flex-shrink-0" />
                 <p><strong>Atenção:</strong> Foram detectadas divergências. As quantidades faltantes serão automaticamente devolvidas ao Almoxarifado Central.</p>
               </div>
             )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setRejectTarget(confirmTarget); setRejectDialogOpen(true); setConfirmDialogOpen(false); }} className="text-red-600 hover:bg-red-50 sm:mr-auto">Rejeitar Guia Toda</Button>
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleConfirmReceipt} disabled={isConfirming} className="bg-green-600 hover:bg-green-700">
              {isConfirming ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />} Confirmar Recebimento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- EDIT DIALOG (SENDER) --- */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader><DialogTitle>Editar Remessa {editTarget?.shipmentNumber}</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto pr-2 space-y-6 py-4">
             <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2"><Label>Data de Envio</Label><Input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} /></div>
               <div className="space-y-2"><Label>Observações Gerais</Label><Input value={editNotes} onChange={e => setEditNotes(e.target.value)} /></div>
             </div>
             
             <div className="space-y-3">
               <Label className="text-base font-bold">Itens da Remessa</Label>
               <Table>
                 <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="w-24">Qtd</TableHead><TableHead>Obs. Item</TableHead><TableHead className="w-12"></TableHead></TableRow></TableHeader>
                 <TableBody>
                   {(editItems || []).map((item, idx) => (
                     <TableRow key={idx}>
                       <TableCell className="font-medium">{item.itemName}</TableCell>
                       <TableCell><Input type="number" value={item.quantitySent} onChange={e => {
                         const copy = [...editItems]; copy[idx].quantitySent = Number(e.target.value); setEditItems(copy);
                       }} /></TableCell>
                       <TableCell><Input value={item.notes || ''} onChange={e => {
                          const copy = [...editItems]; copy[idx].notes = e.target.value; setEditItems(copy);
                       }} /></TableCell>
                       <TableCell><Button variant="ghost" size="icon" onClick={() => setEditItems(editItems.filter((_, i) => i !== idx))}><Trash2 className="h-4 w-4 text-red-500" /></Button></TableCell>
                     </TableRow>
                   ))}
                   <TableRow className="bg-muted/20">
                     <TableCell colSpan={3}>
                        <Select onValueChange={setNewItemSelection} value={newItemSelection}>
                          <SelectTrigger className="border-dashed"><SelectValue placeholder="Adicionar outro item à remessa..." /></SelectTrigger>
                          <SelectContent className="max-h-[300px]">
                            {items.map(i => <SelectItem key={i.id} value={i.id}>{i.name} ({i.code})</SelectItem>)}
                          </SelectContent>
                        </Select>
                     </TableCell>
                     <TableCell><Button type="button" size="icon" onClick={addItemToEdit} className="rounded-full"><PlusCircle className="h-5 w-5" /></Button></TableCell>
                   </TableRow>
                 </TableBody>
               </Table>
             </div>
          </div>
          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveEdit} disabled={isSavingEdit}>
              {isSavingEdit ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Pencil className="h-4 w-4 mr-1" />} Atualizar Remessa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- REJECT DIALOG --- */}
       <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-red-600">Rejeitar Remessa Completa</DialogTitle><DialogDescription>Todos os itens serão devolvidos ao Almoxarifado Central.</DialogDescription></DialogHeader>
          <Textarea placeholder="Motivo da rejeição..." value={rejectNotes} onChange={e => setRejectNotes(e.target.value)} rows={3} />
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>Voltar</Button>
            <Button variant="destructive" onClick={handleRejectShipment}>Confirmar Rejeição de Todos</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
