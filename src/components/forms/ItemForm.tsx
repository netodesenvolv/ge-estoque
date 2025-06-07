'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import type { Item } from '@/types';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

const itemSchema = z.object({
  name: z.string().min(2, { message: "O nome deve ter pelo menos 2 caracteres." }),
  code: z.string().min(1, { message: "O código é obrigatório." }),
  category: z.string().min(2, { message: "A categoria é obrigatória." }),
  unitOfMeasure: z.string().min(1, { message: "A unidade de medida é obrigatória." }),
  minQuantity: z.coerce.number().min(0, { message: "A quantidade mínima não pode ser negativa." }),
  currentQuantityCentral: z.coerce.number().min(0, { message: "A quantidade atual não pode ser negativa." }),
  supplier: z.string().optional(),
});

type ItemFormData = z.infer<typeof itemSchema>;

interface ItemFormProps {
  initialData?: Item;
  onSubmitSuccess?: (data: Item) => void;
}

export default function ItemForm({ initialData, onSubmitSuccess }: ItemFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const form = useForm<ItemFormData>({
    resolver: zodResolver(itemSchema),
    defaultValues: initialData || {
      name: '',
      code: '',
      category: '',
      unitOfMeasure: '',
      minQuantity: 0,
      currentQuantityCentral: 0,
      supplier: '',
    },
  });

  const onSubmit = (data: ItemFormData) => {
    console.log('Formulário de item submetido:', data);
    const newItemId = initialData?.id || Math.random().toString(36).substring(2, 15);
    const submittedItem: Item = { ...data, id: newItemId };
    
    if (onSubmitSuccess) {
      onSubmitSuccess(submittedItem);
    } else {
      toast({
        title: initialData ? "Item Atualizado" : "Item Adicionado",
        description: `${data.name} foi ${initialData ? 'atualizado' : 'adicionado'} com sucesso.`,
        variant: "default",
      });
      router.push('/items');
    }
  };

  return (
    <Card className="max-w-2xl mx-auto shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">{initialData ? 'Editar Item' : 'Adicionar Novo Item'}</CardTitle>
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
                      <Input placeholder="ex: Pharma Inc." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancelar
            </Button>
            <Button type="submit">
              {initialData ? 'Salvar Alterações' : 'Adicionar Item'}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
