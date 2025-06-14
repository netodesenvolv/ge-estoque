
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import type { Hospital } from '@/types';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { firestore } from '@/lib/firebase';
import { collection, addDoc, doc, setDoc } from 'firebase/firestore';
import { useEffect } from 'react';

const hospitalSchema = z.object({
  name: z.string().min(3, { message: "O nome do hospital/UBS deve ter pelo menos 3 caracteres." }),
  address: z.string().optional(),
});

type HospitalFormData = z.infer<typeof hospitalSchema>;

interface HospitalFormProps {
  initialData?: Hospital;
  hospitalId?: string; // ID do hospital para modo de edição
  onSubmitSuccess?: (data: Hospital) => void;
}

export default function HospitalForm({ initialData, hospitalId, onSubmitSuccess }: HospitalFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const form = useForm<HospitalFormData>({
    resolver: zodResolver(hospitalSchema),
    defaultValues: initialData || {
      name: '',
      address: '',
    },
  });

  useEffect(() => {
    if (initialData) {
      form.reset(initialData);
    }
  }, [initialData, form]);

  const onSubmit = async (data: HospitalFormData) => {
    const hospitalDataToSave: Omit<Hospital, 'id'> = {
      name: data.name,
      address: data.address || '', // Garante que address seja uma string
    };

    try {
      if (hospitalId) {
        // Modo de Edição
        const hospitalDocRef = doc(firestore, "hospitals", hospitalId);
        await setDoc(hospitalDocRef, hospitalDataToSave, { merge: true });
        toast({
          title: "Hospital Atualizado",
          description: `${hospitalDataToSave.name} foi atualizado com sucesso.`,
        });
      } else {
        // Modo de Adição
        const hospitalsCollectionRef = collection(firestore, "hospitals");
        await addDoc(hospitalsCollectionRef, hospitalDataToSave);
        toast({
          title: "Hospital Adicionado",
          description: `${hospitalDataToSave.name} foi adicionado com sucesso ao banco de dados.`,
        });
      }
      
      if (onSubmitSuccess) {
        // @ts-ignore
        onSubmitSuccess({ ...hospitalDataToSave, id: hospitalId || 'new_id_placeholder' });
      } else {
        router.push('/hospitals'); 
      }
    } catch (error) {
      console.error("Erro ao salvar hospital: ", error);
      toast({
        title: `Erro ao ${hospitalId ? 'Atualizar' : 'Adicionar'} Hospital`,
        description: `Não foi possível ${hospitalId ? 'atualizar' : 'adicionar'} o hospital/UBS. Verifique o console.`,
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="max-w-lg mx-auto shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">{hospitalId ? 'Editar Hospital/UBS' : 'Adicionar Novo Hospital/UBS'}</CardTitle>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome do Hospital/UBS</FormLabel>
                  <FormControl>
                    <Input placeholder="ex: Hospital Central da Cidade" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Endereço (Opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="ex: Rua Principal, 123, Centro" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancelar
            </Button>
            <Button type="submit">
              {hospitalId ? 'Salvar Alterações' : 'Adicionar Hospital/UBS'}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
