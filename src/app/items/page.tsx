
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, PlusCircle, Edit3, Trash2, Search, CalendarClock, ShieldAlert, Loader2, X, ChevronLeft, ChevronRight, RefreshCw, AlertCircle } from 'lucide-react';
import type { Item } from '@/types';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { format, parseISO, isBefore, differenceInDays, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, doc, deleteDoc, getDocs, limit, startAfter, endBefore, limitToLast, where, type Query, type DocumentSnapshot, writeBatch } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const NEARING_EXPIRATION_DAYS = 30;
const ITEMS_PER_PAGE = 15;

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearchTerm, setActiveSearchTerm] = useState('');
  
  const [lastVisible, setLastVisible] = useState<DocumentSnapshot | null>(null);
  const [firstVisible, setFirstVisible] = useState<DocumentSnapshot | null>(null);
  const [page, setPage] = useState(1);
  const [isLastPage, setIsLastPage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);

  const { toast } = useToast();
  const router = useRouter();
  const { currentUserProfile, loading: authLoading } = useAuth();

  const canManageItems = currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'central_operator';
  const isAdmin = currentUserProfile?.role === 'admin';

  const buildQuery = (direction: 'first' | 'next' | 'prev', term: string): Query => {
    const itemsCollectionRef = collection(firestore, "items");
    const constraints: any[] = [];
    
    if (term) {
      const lowerTerm = term.toLowerCase();
      // Use name_lowercase for flexible search
      constraints.push(where("name_lowercase", ">=", lowerTerm), where("name_lowercase", "<=", lowerTerm + '\uf8ff'));
      constraints.push(orderBy("name_lowercase", "asc"));
    } else {
      constraints.push(orderBy("name", "asc"));
    }
    
    if (direction === 'next' && lastVisible) {
      constraints.push(startAfter(lastVisible));
    } else if (direction === 'prev' && firstVisible) {
      constraints.push(endBefore(firstVisible), limitToLast(ITEMS_PER_PAGE));
      return query(itemsCollectionRef, ...constraints);
    }
    
    constraints.push(limit(ITEMS_PER_PAGE));
    return query(itemsCollectionRef, ...constraints);
  };

  const fetchItems = useCallback(async (direction: 'first' | 'next' | 'prev', term: string) => {
    setIsLoading(true);
    const q = buildQuery(direction, term);
    
    try {
      const documentSnapshots = await getDocs(q);
      let itemsData = documentSnapshots.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as Item));
      
      if (direction === 'prev') {
        itemsData = itemsData.reverse();
      }
      
      if (itemsData.length > 0) {
        setItems(itemsData);
        setFirstVisible(documentSnapshots.docs[0]);
        setLastVisible(documentSnapshots.docs[documentSnapshots.docs.length - 1]);
        setIsLastPage(documentSnapshots.docs.length < ITEMS_PER_PAGE);
      } else {
        if (direction === 'first' && term) {
          toast({ title: "Nenhum resultado", description: "Experimente sincronizar os dados se o item for antigo." });
        }
        setItems([]);
        setIsLastPage(true);
      }
    } catch (error: any) {
      console.error("Erro ao buscar itens: ", error);
      toast({ title: "Erro ao Carregar Itens", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!authLoading && currentUserProfile) {
      fetchItems('first', '');
    }
  }, [authLoading, currentUserProfile, fetchItems]);

  const handleSearch = () => {
    setPage(1);
    setFirstVisible(null);
    setLastVisible(null);
    setActiveSearchTerm(searchTerm);
    fetchItems('first', searchTerm);
  };
  
  const handleClearSearch = () => {
    setSearchTerm('');
    setActiveSearchTerm('');
    setPage(1);
    setFirstVisible(null);
    setLastVisible(null);
    fetchItems('first', '');
  };

  const handleNextPage = () => { if (!isLastPage) { setPage(p => p + 1); fetchItems('next', activeSearchTerm); } };
  const handlePrevPage = () => { if (page > 1) { setPage(p => p - 1); fetchItems('prev', activeSearchTerm); } };

  const handleMigrateSearchData = async () => {
    if (!isAdmin) return;
    setIsMigrating(true);
    try {
      const q = query(collection(firestore, "items"));
      const snap = await getDocs(q);
      const batch = writeBatch(firestore);
      let count = 0;
      
      snap.docs.forEach(docSnap => {
        const data = docSnap.data();
        if (!data.name_lowercase && data.name) {
          batch.update(docSnap.ref, { name_lowercase: data.name.toLowerCase() });
          count++;
        }
      });
      
      if (count > 0) {
        await batch.commit();
        toast({ title: "Busca Sincronizada", description: `${count} itens foram atualizados para busca flexível.` });
      } else {
        toast({ title: "Tudo em ordem", description: "Todos os itens já possuem suporte a busca flexível." });
      }
      handleClearSearch();
    } catch (error) {
      console.error("Erro na migração: ", error);
      toast({ title: "Erro na Sincronização", variant: "destructive" });
    } finally {
      setIsMigrating(false);
    }
  };

  const showMigrationWarning = useMemo(() => {
    return isAdmin && items.length > 0 && !items.some(i => i.name_lowercase);
  }, [isAdmin, items]);

  const handleEdit = (id: string) => router.push(`/items/${id}/edit`);
  const handleDelete = async (id: string) => {
    if (!canManageItems) return;
    try {
      await deleteDoc(doc(firestore, "items", id));
      toast({ title: "Item Excluído" });
      handleSearch();
    } catch (error) {
      toast({ title: "Erro ao Excluir", variant: "destructive" });
    }
  };

  const getExpirationStatus = (expirationDate?: string | null) => {
    if (!expirationDate) return { text: 'N/A', variant: 'default' as const };
    const expDate = parseISO(expirationDate);
    if (!isValid(expDate)) return { text: 'Inválida', variant: 'destructive' as const };
    const today = new Date(); today.setHours(0,0,0,0);
    if (isBefore(expDate, today)) return { text: `Vencido (${format(expDate, 'dd/MM/yy')})`, variant: 'destructive' as const, icon: <CalendarClock className="h-3 w-3 mr-1 inline-block" /> };
    const daysDiff = differenceInDays(expDate, today);
    if (daysDiff <= NEARING_EXPIRATION_DAYS) return { text: `Vence em ${daysDiff + 1}d`, variant: 'secondary' as const, icon: <CalendarClock className="h-3 w-3 mr-1 inline-block" /> };
    return { text: format(expDate, 'dd/MM/yyyy'), variant: 'default' as const };
  };

  if (authLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div>
      <PageHeader title="Catálogo de Itens" description="Gerencie seus itens de inventário." icon={Package} 
                  actions={canManageItems && <Button asChild><Link href="/items/add"><PlusCircle className="mr-2 h-4 w-4" /> Adicionar Novo Item</Link></Button>} />
      
      {showMigrationWarning && (
        <Alert className="mb-6 border-orange-200 bg-orange-50 text-orange-800">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Atualização Necessária</AlertTitle>
          <AlertDescription className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            Para habilitar a busca flexível (maiúsculas/minúsculas) nos itens existentes, é necessário sincronizar os dados.
            <Button size="sm" onClick={handleMigrateSearchData} disabled={isMigrating} variant="outline" className="border-orange-300 text-orange-800 hover:bg-orange-100">
              {isMigrating ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <RefreshCw className="mr-2 h-4 w-4"/>}
              Sincronizar Busca Agora
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Todos os Itens</CardTitle>
          <div className="flex flex-col md:flex-row gap-2 mt-4">
            <div className="relative flex-grow">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input type="search" placeholder="Buscar por NOME (qualquer caixa)..." className="pl-10 w-full"
                     value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
            </div>
            <div className="flex gap-2">
                <Button onClick={handleSearch} disabled={isLoading}>{isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Search className="mr-2 h-4 w-4"/>} Buscar</Button>
                <Button onClick={handleClearSearch} variant="outline" disabled={isLoading}><X className="mr-2 h-4 w-4"/> Limpar</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead className="text-right">Qtde. Mín.</TableHead>
                  <TableHead className="text-right">Qtde. Atual</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  {canManageItems && <TableHead className="text-center">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center h-24"><Loader2 className="h-6 w-6 animate-spin text-primary inline mr-2" />Buscando itens...</TableCell></TableRow>
                ) : items.length > 0 ? (
                  items.map((item) => {
                    const exp = getExpirationStatus(item.expirationDate);
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>{item.code}</TableCell>
                        <TableCell>{item.category}</TableCell>
                        <TableCell>{item.unitOfMeasure}</TableCell>
                        <TableCell><Badge variant={exp.variant}>{exp.icon}{exp.text}</Badge></TableCell>
                        <TableCell className="text-right">{item.minQuantity}</TableCell>
                        <TableCell className="text-right">{item.currentQuantityCentral}</TableCell>
                        <TableCell>{item.supplier || 'N/A'}</TableCell>
                        {canManageItems && (
                          <TableCell className="text-center">
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(item.id)} className="hover:text-primary mr-2"><Edit3 className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)} className="hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                ) : <TableRow><TableCell colSpan={9} className="text-center h-24">Nenhum item encontrado.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
          {items.length > 0 && (
            <div className="flex justify-between items-center mt-4 border-t pt-4">
              <Button onClick={handlePrevPage} disabled={page <= 1 || isLoading} variant="outline" size="sm"><ChevronLeft className="h-4 w-4 mr-1" /> Anterior</Button>
              <span className="text-sm font-medium">Página {page}</span>
              <Button onClick={handleNextPage} disabled={isLastPage || isLoading} variant="outline" size="sm">Próxima <ChevronRight className="h-4 w-4 ml-1" /></Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
