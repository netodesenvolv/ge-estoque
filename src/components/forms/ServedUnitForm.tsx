
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import type { ServedUnit, Hospital } from '@/types';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useEffect, useState } from 'react';
import { mockHospitals } from '@/data/mockData'; // Import mockHospitals

const servedUnitSchema = z.object({
  name: z.string().min(2, { message: "O nome da unidade deve ter pelo menos 2 caracteres." }),
  location: z.string().min(2, { message: "A localização é obrigatória." }),
  hospitalId: z.string().min(1, { message: "A seleção do hospital é obrigatória." }),
});

type ServedUnitFormData = z.infer<typeof servedUnitSchema>;

interface ServedUnitFormProps {
  initialData?: ServedUnit;
  onSubmitSuccess?: (data: ServedUnit) => void;
}

export default function ServedUnitForm({ initialData, onSubmitSuccess }: ServedUnitFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);

  useEffect(() => {
    setHospitals(mockHospitals);
  }, []);

  const form = useForm<ServedUnitFormData>({
    resolver: zodResolver(servedUnitSchema),
    defaultValues: initialData ? {
      name: initialData.name,
      location: initialData.location,
      hospitalId: initialData.hospitalId,
    } : {
      name: '',
      location: '',
      hospitalId: '',
    },
  });

  const onSubmit = (data: ServedUnitFormData) => {
    console.log('Formulário de unidade servida submetido:', data);
    const unitId = initialData?.id || Math.random().toString(36).substring(2, 15);
    const hospitalName = hospitals.find(h => h.id === data.hospitalId)?.name;
    const submittedUnit: ServedUnit = { ...data, id: unitId, hospitalName };
    
    if (onSubmitSuccess) {
      onSubmitSuccess(submittedUnit);
    } else {
      toast({
        title: initialData ? "Unidade Servida Atualizada" : "Unidade Servida Adicionada",
        description: `${data.name} (${hospitalName}) foi ${initialData ? 'atualizada' : 'adicionada'} com sucesso.`,
      });
      router.push('/served-units');
    }
  };

  return (
    <Card className="max-w-lg mx-auto shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">{initialData ? 'Editar Unidade Servida' : 'Adicionar Nova Unidade Servida'}</CardTitle>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="hospitalId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Hospital</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um hospital" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {hospitals.map(hospital => (
                        <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome da Unidade (Setor)</FormLabel>
                  <FormControl>
                    <Input placeholder="ex: Sala de Emergência, Ala Pediátrica" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Localização (dentro do hospital)</FormLabel>
                  <FormControl>
                    <Input placeholder="ex: Piso 1, Ala A" {...field} />
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
              {initialData ? 'Salvar Alterações' : 'Adicionar Unidade'}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
