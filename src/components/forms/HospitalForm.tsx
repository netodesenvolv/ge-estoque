
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

const hospitalSchema = z.object({
  name: z.string().min(3, { message: "O nome do hospital deve ter pelo menos 3 caracteres." }),
  address: z.string().optional(),
});

type HospitalFormData = z.infer<typeof hospitalSchema>;

interface HospitalFormProps {
  initialData?: Hospital;
  onSubmitSuccess?: (data: Hospital) => void;
}

export default function HospitalForm({ initialData, onSubmitSuccess }: HospitalFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const form = useForm<HospitalFormData>({
    resolver: zodResolver(hospitalSchema),
    defaultValues: initialData || {
      name: '',
      address: '',
    },
  });

  const onSubmit = (data: HospitalFormData) => {
    console.log('Formulário de hospital submetido:', data);
    const hospitalId = initialData?.id || Math.random().toString(36).substring(2, 15);
    const submittedHospital: Hospital = { ...data, id: hospitalId };
    
    if (onSubmitSuccess) {
      onSubmitSuccess(submittedHospital);
    } else {
      toast({
        title: initialData ? "Hospital Atualizado" : "Hospital Adicionado",
        description: `${data.name} foi ${initialData ? 'atualizado' : 'adicionado'} com sucesso.`,
      });
      router.push('/hospitals');
    }
  };

  return (
    <Card className="max-w-lg mx-auto shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">{initialData ? 'Editar Hospital' : 'Adicionar Novo Hospital'}</CardTitle>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome do Hospital</FormLabel>
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
                    <Input placeholder="ex: Rua Principal, 123, Centro" {...field} />
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
              {initialData ? 'Salvar Alterações' : 'Adicionar Hospital'}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
