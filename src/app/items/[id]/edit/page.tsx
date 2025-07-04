
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '@/lib/firebase';
import ItemForm, { type ItemFormData } from '@/components/forms/ItemForm';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader';
import { Edit3, Loader2, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Item } from '@/types';
import { useAuth } from '@/contexts/AuthContext';

export default function EditItemPage() {
  const params = useParams();
  const router = useRouter();
  const itemId = params.id as string;
  const { currentUserProfile, loading: authLoading } = useAuth();

  const [itemData, setItemData] = useState<Partial<ItemFormData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!itemId) {
      setError("ID do item não fornecido.");
      setLoading(false);
      return;
    }

    if (!authLoading) {
      if (!currentUserProfile || (currentUserProfile.role !== 'admin' && currentUserProfile.role !== 'central_operator')) {
        setError('Você não tem permissão para editar itens.');
        setLoading(false);
        return;
      }
    }

    const fetchItem = async () => {
      setLoading(true);
      try {
        const itemDocRef = doc(firestore, 'items', itemId);
        const itemSnap = await getDoc(itemDocRef);

        if (itemSnap.exists()) {
          const data = itemSnap.data() as Item;
          setItemData({
            ...data,
            minQuantity: data.minQuantity ?? 0,
            currentQuantityCentral: data.currentQuantityCentral ?? 0,
            supplier: data.supplier ?? '',
            expirationDate: data.expirationDate ?? null,
          });
        } else {
          setError('Item não encontrado.');
        }
      } catch (err) {
        console.error("Erro ao buscar item:", err);
        setError('Falha ao carregar o item.');
      } finally {
        setLoading(false);
      }
    };
    
    // Fetch only if user has potential access
    if (!authLoading && currentUserProfile && (currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator')) {
        fetchItem();
    } else if (!authLoading) {
        // Handle cases where user is loaded but not authorized
        setLoading(false);
    }

  }, [itemId, authLoading, currentUserProfile]);

  if (loading || authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg text-muted-foreground">Carregando dados do item...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <PageHeader title="Erro" description={error} icon={error === 'Você não tem permissão para editar itens.' ? ShieldAlert : Edit3} />
        <Button onClick={() => router.push('/items')}>Voltar para a Lista de Itens</Button>
      </div>
    );
  }

  if (!itemData) {
     return (
      <div className="container mx-auto py-8">
        <PageHeader title="Erro" description="Dados do item não puderam ser carregados ou acesso negado." icon={ShieldAlert} />
        <Button onClick={() => router.push('/items')}>Voltar para a Lista de Itens</Button>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Editar Item"
        description={`Modificando detalhes para o item: ${itemData?.name || 'Carregando...'}`}
        icon={Edit3}
      />
      <ItemForm initialData={itemData} itemId={itemId} />
    </div>
  );
}
