
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
import { firestore } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy, addDoc } from 'firebase/firestore';

const servedUnitSchema = z.object({
  name: z.string().min(2, { message: "O nome da unidade deve ter pelo menos 2 caracteres." }),
  location: z.string().min(2, { message: "A localização é obrigatória." }),
  hospitalId: z.string().min(1, { message: "A seleção do hospital é obrigatória." }),
});

type ServedUnitFormData = z.infer<typeof servedUnitSchema>;

interface ServedUnitFormProps {
  initialData?: ServedUnit; // ID será usado para edição no futuro
  onSubmitSuccess?: (data: ServedUnit) => void;
}

const LOADING_HOSPITALS_VALUE = "__LOADING_HOSPITALS__"; // Unique non-empty value

export default function ServedUnitForm({ initialData, onSubmitSuccess }: ServedUnitFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [isLoadingHospitals, setIsLoadingHospitals] = useState(true);

  useEffect(() => {
    setIsLoadingHospitals(true);
    const hospitalsCollectionRef = collection(firestore, "hospitals");
    const q = query(hospitalsCollectionRef, orderBy("name", "asc"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      setHospitals(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hospital)));
      setIsLoadingHospitals(false);
    }, (error) => {
      console.error("Erro ao buscar hospitais: ", error);
      toast({
        title: "Erro ao Carregar Hospitais",
        description: "Não foi possível carregar a lista de hospitais.",
        variant: "destructive",
      });
      setIsLoadingHospitals(false);
    });
    return () => unsubscribe();
  }, [toast]);

  const form = useForm<ServedUnitFormData>({
    resolver: zodResolver(servedUnitSchema),
    defaultValues: initialData ? {
      name: initialData.name,
      location: initialData.location,
      hospitalId: initialData.hospitalId,
    } : {
      name: '',
      location: '',
      hospitalId: undefined, // Use undefined for no selection
    },
  });

  const onSubmit = async (data: ServedUnitFormData) => {
    const hospital = hospitals.find(h => h.id === data.hospitalId);
    const servedUnitDataToSave: Omit<ServedUnit, 'id' | 'hospitalName'> = {
      name: data.name,
      location: data.location,
      hospitalId: data.hospitalId,
    };

    try {
      // TODO: Adicionar lógica de edição se initialData.id estiver presente
      const servedUnitsCollectionRef = collection(firestore, "servedUnits");
      await addDoc(servedUnitsCollectionRef, servedUnitDataToSave);
      
      toast({
        title: initialData ? "Unidade Servida Atualizada" : "Unidade Servida Adicionada",
        description: `${data.name} (${hospital?.name || 'Hospital não encontrado'}) foi ${initialData ? 'atualizada' : 'adicionada'} com sucesso.`,
      });

      if (onSubmitSuccess) {
        // @ts-ignore
        onSubmitSuccess({ ...servedUnitDataToSave, id: 'new_id_placeholder', hospitalName: hospital?.name });
      } else {
        router.push('/served-units');
      }
    } catch (error) {
      console.error("Erro ao salvar unidade servida: ", error);
      toast({
        title: `Erro ao ${initialData ? 'Atualizar' : 'Adicionar'} Unidade`,
        description: "Não foi possível salvar a unidade servida. Verifique o console.",
        variant: "destructive",
      });
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
                  <Select
                    onValueChange={field.onChange}
                    value={field.value} // Use field.value directly
                    disabled={isLoadingHospitals}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um hospital" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {isLoadingHospitals && <SelectItem value={LOADING_HOSPITALS_VALUE} disabled>Carregando hospitais...</SelectItem>}
                      {!isLoadingHospitals && hospitals.length === 0 && <SelectItem value="__NO_HOSPITALS__" disabled>Nenhum hospital cadastrado</SelectItem>}
                      {!isLoadingHospitals && hospitals.map(hospital => (
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
            <Button type="submit" disabled={isLoadingHospitals || hospitals.length === 0 && !isLoadingHospitals}>
              {initialData ? 'Salvar Alterações' : 'Adicionar Unidade'}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
