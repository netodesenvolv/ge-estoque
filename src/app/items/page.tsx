
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, PlusCircle, Edit3, Trash2, Search, CalendarClock } from 'lucide-react';
import type { Item } from '@/types';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { format, parseISO, isBefore, differenceInDays, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { firestore } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy, doc, deleteDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation'; // Importar useRouter

const NEARING_EXPIRATION_DAYS = 30;

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();
  const router = useRouter(); // Inicializar useRouter

  useEffect(() => {
    const itemsCollectionRef = collection(firestore, "items");
    const q = query(itemsCollectionRef, orderBy("name", "asc"));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const itemsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as Item));
      setItems(itemsData);
    }, (error) => {
      console.error("Erro ao buscar itens: ", error);
      toast({
        title: "Erro ao Carregar Itens",
        description: "Não foi possível carregar os itens do banco de dados.",
        variant: "destructive",
      });
    });

    return () => unsubscribe();
  }, [toast]);

  const filteredItems = items.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.code && item.code.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (item.category && item.category.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleEdit = (id: string) => {
    router.push(`/items/${id}/edit`);
  };

  const handleDelete = async (id: string) => {
    const itemDocRef = doc(firestore, "items", id);
    try {
      await deleteDoc(itemDocRef);
      toast({
        title: "Item Excluído",
        description: `Item foi removido do banco de dados.`,
        variant: "default", 
      });
    } catch (error) {
      console.error("Erro ao excluir item: ", error);
      toast({
        title: "Erro ao Excluir Item",
        description: "Não foi possível excluir o item. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const getExpirationStatus = (expirationDate?: string | null): { text: string; variant: 'default' | 'secondary' | 'destructive'; icon?: React.ReactNode } => {
    if (!expirationDate) {
      return { text: 'N/A', variant: 'default' };
    }
    const expDate = parseISO(expirationDate);
    if (!isValid(expDate)) {
        return { text: 'Inválida', variant: 'destructive' };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isBefore(expDate, today)) {
      return { text: `Vencido (${format(expDate, 'dd/MM/yy', { locale: ptBR })})`, variant: 'destructive', icon: <CalendarClock className="h-3 w-3 mr-1 inline-block" /> };
    }
    const daysDiff = differenceInDays(expDate, today);
    if (daysDiff <= NEARING_EXPIRATION_DAYS) {
      return { text: `Vence em ${daysDiff +1}d (${format(expDate, 'dd/MM/yy', { locale: ptBR })})`, variant: 'secondary', icon: <CalendarClock className="h-3 w-3 mr-1 inline-block" /> };
    }
    return { text: format(expDate, 'dd/MM/yyyy', { locale: ptBR }), variant: 'default' };
  };


  return (
    <div>
      <PageHeader
        title="Catálogo de Itens"
        description="Gerencie seus itens de inventário."
        icon={Package}
        actions={
          <Button asChild>
            <Link href="/items/add">
              <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Novo Item
            </Link>
          </Button>
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Todos os Itens</CardTitle>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar itens por nome, código ou categoria..."
              className="pl-10 w-full md:w-1/3"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
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
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.length > 0 ? (
                  filteredItems.map((item) => {
                    const expStatus = getExpirationStatus(item.expirationDate);
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>{item.code}</TableCell>
                        <TableCell>{item.category}</TableCell>
                        <TableCell>{item.unitOfMeasure}</TableCell>
                        <TableCell>
                          <Badge variant={expStatus.variant} className="whitespace-nowrap">
                            {expStatus.icon}
                            {expStatus.text}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{item.minQuantity}</TableCell>
                        <TableCell className="text-right">{item.currentQuantityCentral}</TableCell>
                        <TableCell>{item.supplier || 'N/A'}</TableCell>
                        <TableCell className="text-center">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(item.id)} className="hover:text-primary mr-2">
                            <Edit3 className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)} className="hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center h-24">
                      Nenhum item encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
