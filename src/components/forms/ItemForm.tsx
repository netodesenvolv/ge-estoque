
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import type { Item } from '@/types';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { firestore } from '@/lib/firebase';
import { collection, addDoc, doc, setDoc } from 'firebase/firestore'; // Importar doc e setDoc para atualização
import { useEffect } from 'react';

const itemSchema = z.object({
  name: z.string().min(2, { message: "O nome deve ter pelo menos 2 caracteres." }),
  code: z.string().min(1, { message: "O código é obrigatório." }),
  category: z.string().min(2, { message: "A categoria é obrigatória." }),
  unitOfMeasure: z.string().min(1, { message: "A unidade de medida é obrigatória." }),
  minQuantity: z.coerce.number().min(0, { message: "A quantidade mínima não pode ser negativa." }),
  currentQuantityCentral: z.coerce.number().min(0, { message: "A quantidade atual não pode ser negativa." }),
  supplier: z.string().optional(),
  expirationDate: z.string().refine((val) => val === "" || !isNaN(Date.parse(val)) || val === null, { message: "Data de validade inválida. Use o formato AAAA-MM-DD ou deixe em branco." }).optional().nullable(),
});

export type ItemFormData = z.infer<typeof itemSchema>;

interface ItemFormProps {
  initialData?: Partial<ItemFormData>; // Para edição, pode vir com dados parciais ou completos
  itemId?: string; // ID do item para modo de edição
  onSubmitSuccess?: (data: Item) => void;
}

export default function ItemForm({ initialData, itemId, onSubmitSuccess }: ItemFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const form = useForm<ItemFormData>({
    resolver: zodResolver(itemSchema),
    defaultValues: initialData ? {
        ...initialData,
        minQuantity: initialData.minQuantity ?? 0,
        currentQuantityCentral: initialData.currentQuantityCentral ?? 0,
        expirationDate: initialData.expirationDate === '' ? null : initialData.expirationDate,
    } : {
      name: '',
      code: '',
      category: '',
      unitOfMeasure: '',
      minQuantity: 0,
      currentQuantityCentral: 0,
      supplier: '',
      expirationDate: null,
    },
  });

  useEffect(() => {
    if (initialData) {
      form.reset({
        ...initialData,
        minQuantity: initialData.minQuantity ?? 0,
        currentQuantityCentral: initialData.currentQuantityCentral ?? 0,
        expirationDate: initialData.expirationDate === '' ? null : initialData.expirationDate,
      });
    }
  }, [initialData, form]);

  const onSubmit = async (data: ItemFormData) => {
    const itemDataToSave = {
      ...data,
      expirationDate: data.expirationDate || null,
    };

    try {
      if (itemId) {
        // Modo de Edição
        const itemDocRef = doc(firestore, "items", itemId);
        await setDoc(itemDocRef, itemDataToSave, { merge: true }); // Usar setDoc com merge para atualizar ou criar se não existir (embora devêssemos ter certeza que existe)
        toast({
          title: "Item Atualizado",
          description: `${data.name} foi atualizado com sucesso.`,
          variant: "default",
        });
      } else {
        // Modo de Adição
        const itemsCollectionRef = collection(firestore, "items");
        await addDoc(itemsCollectionRef, itemDataToSave);
        toast({
          title: "Item Adicionado",
          description: `${data.name} foi adicionado com sucesso ao banco de dados.`,
          variant: "default",
        });
      }
      
      if (onSubmitSuccess) {
        // @ts-ignore // O ID será gerado pelo Firestore ou já existe
        onSubmitSuccess({ ...itemDataToSave, id: itemId || 'new_id_placeholder' });
      } else {
        router.push('/items'); // Redireciona para a página de listagem
      }
    } catch (error) {
      console.error("Erro ao salvar item: ", error);
      toast({
        title: `Erro ao ${itemId ? 'Atualizar' : 'Adicionar'} Item`,
        description: `Não foi possível ${itemId ? 'atualizar' : 'adicionar'} o item. Verifique o console para mais detalhes.`,
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="max-w-2xl mx-auto shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">{itemId ? 'Editar Item' : 'Adicionar Novo Item'}</CardTitle>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome do Item</FormLabel>
                  <FormControl>
                    <Input placeholder="ex: Paracetamol 500mg" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Código do Item</FormLabel>
                    <FormControl>
                      <Input placeholder="ex: PARA500" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoria</FormLabel>
                    <FormControl>
                      <Input placeholder="ex: Analgésico" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="unitOfMeasure"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unidade de Medida</FormLabel>
                    <FormControl>
                      <Input placeholder="ex: Comprimido, Caixa, Peça" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="supplier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fornecedor (Opcional)</FormLabel>
                    <FormControl>
                      <Input placeholder="ex: Pharma Inc." {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <FormField
                control={form.control}
                name="minQuantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantidade Mínima (Central)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="ex: 100" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currentQuantityCentral"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantidade Atual (Central)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="ex: 500" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="expirationDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de Validade (Opcional)</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ''}/>
                    </FormControl>
                    <FormDescription>Formato: AAAA-MM-DD</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancelar
            </Button>
            <Button type="submit">
              {itemId ? 'Salvar Alterações' : 'Adicionar Item'}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
