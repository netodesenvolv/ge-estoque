
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import type { Patient, Hospital, PatientSex } from '@/types';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { firestore } from '@/lib/firebase';
import { collection, addDoc, doc, setDoc, onSnapshot, query, orderBy } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

const patientSexOptions: { value: PatientSex; label: string }[] = [
  { value: 'masculino', label: 'Masculino' },
  { value: 'feminino', label: 'Feminino' },
  { value: 'outro', label: 'Outro' },
  { value: 'ignorado', label: 'Prefiro não informar / Ignorado' },
];

const patientSchema = z.object({
  name: z.string().min(3, { message: "O nome do paciente deve ter pelo menos 3 caracteres." }),
  birthDate: z.string().optional(),
  susCardNumber: z.string()
    .min(15, { message: "O número do Cartão SUS deve ter 15 dígitos." })
    .max(15, { message: "O número do Cartão SUS deve ter 15 dígitos." })
    .regex(/^\d{15}$/, { message: "O Cartão SUS deve conter apenas números." }),
  address: z.string().optional(),
  phone: z.string().optional(),
  sex: z.enum(['masculino', 'feminino', 'outro', 'ignorado']).optional(),
  healthAgentName: z.string().optional(),
  registeredUBSId: z.string().optional(),
});

type PatientFormData = z.infer<typeof patientSchema>;

interface PatientFormProps {
  initialData?: Patient;
  patientId?: string;
  onSubmitSuccess?: (data: Patient) => void;
}

const LOADING_UBS_VALUE = "__LOADING_UBS__";

export default function PatientForm({ initialData, patientId, onSubmitSuccess }: PatientFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [ubsList, setUbsList] = useState<Hospital[]>([]);
  const [isLoadingUbs, setIsLoadingUbs] = useState(true);

  useEffect(() => {
    setIsLoadingUbs(true);
    const hospitalsCollectionRef = collection(firestore, "hospitals");
    const q = query(hospitalsCollectionRef, orderBy("name", "asc"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const allHospitals = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hospital));
      // Simple filter for UBS - can be improved if there's a specific field
      setUbsList(allHospitals.filter(h => h.name.toLowerCase().includes('ubs')));
      setIsLoadingUbs(false);
    }, (error) => {
      console.error("Erro ao buscar UBSs: ", error);
      toast({
        title: "Erro ao Carregar UBSs",
        description: "Não foi possível carregar a lista de UBSs.",
        variant: "destructive",
      });
      setIsLoadingUbs(false);
    });
    return () => unsubscribe();
  }, [toast]);

  const form = useForm<PatientFormData>({
    resolver: zodResolver(patientSchema),
    defaultValues: initialData ? {
      ...initialData,
      birthDate: initialData.birthDate || '',
      address: initialData.address || '',
      phone: initialData.phone || '',
      sex: initialData.sex || undefined,
      healthAgentName: initialData.healthAgentName || '',
      registeredUBSId: initialData.registeredUBSId || undefined,
    } : {
      name: '',
      susCardNumber: '',
      birthDate: '',
      address: '',
      phone: '',
      sex: undefined,
      healthAgentName: '',
      registeredUBSId: undefined,
    },
  });

  useEffect(() => {
    if (initialData) {
      form.reset({
        ...initialData,
        birthDate: initialData.birthDate || '',
        address: initialData.address || '',
        phone: initialData.phone || '',
        sex: initialData.sex || undefined,
        healthAgentName: initialData.healthAgentName || '',
        registeredUBSId: initialData.registeredUBSId || undefined,
      });
    }
  }, [initialData, form]);

  const onSubmit = async (data: PatientFormData) => {
    const selectedUBS = ubsList.find(ubs => ubs.id === data.registeredUBSId);

    const patientDataToSave: Omit<Patient, 'id'> = {
      name: data.name,
      susCardNumber: data.susCardNumber,
      birthDate: data.birthDate || undefined,
      address: data.address || undefined,
      phone: data.phone || undefined,
      sex: data.sex || undefined,
      healthAgentName: data.healthAgentName || undefined,
      registeredUBSId: data.registeredUBSId || undefined,
      registeredUBSName: selectedUBS?.name || undefined,
    };

    try {
      if (patientId) {
        const patientDocRef = doc(firestore, "patients", patientId);
        await setDoc(patientDocRef, patientDataToSave, { merge: true });
        toast({
          title: "Paciente Atualizado",
          description: `${patientDataToSave.name} foi atualizado(a) com sucesso.`,
        });
      } else {
        const patientsCollectionRef = collection(firestore, "patients");
        await addDoc(patientsCollectionRef, patientDataToSave);
        toast({
          title: "Paciente Adicionado",
          description: `${patientDataToSave.name} foi adicionado(a) com sucesso.`,
        });
      }

      if (onSubmitSuccess) {
        onSubmitSuccess({ ...patientDataToSave, id: patientId || 'new_id_placeholder' });
      } else {
        router.push('/patients');
      }
    } catch (error) {
      console.error("Erro ao salvar paciente: ", error);
      toast({
        title: `Erro ao ${patientId ? 'Atualizar' : 'Adicionar'} Paciente`,
        description: "Não foi possível salvar o paciente.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="max-w-2xl mx-auto shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">{patientId ? 'Editar Paciente' : 'Adicionar Novo Paciente'}</CardTitle>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome Completo</FormLabel>
                  <FormControl><Input placeholder="ex: Maria da Silva" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="birthDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Data de Nascimento (Opcional)</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormDescription>Formato AAAA-MM-DD.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="susCardNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Número do Cartão SUS (CNS)</FormLabel>
                    <FormControl><Input placeholder="700000000000000" {...field} maxLength={15} /></FormControl>
                    <FormDescription>15 dígitos.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Endereço (Opcional)</FormLabel>
                  <FormControl><Textarea placeholder="ex: Rua das Flores, 123, Bairro, Cidade - UF, CEP" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone (Opcional)</FormLabel>
                    <FormControl><Input type="tel" placeholder="ex: (XX) XXXXX-XXXX" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sex"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sexo (Opcional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecione o sexo" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {patientSexOptions.map(option => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="healthAgentName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Agente de Saúde (Opcional)</FormLabel>
                    <FormControl><Input placeholder="Nome do agente de saúde" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="registeredUBSId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>UBS de Cadastro (Opcional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value} disabled={isLoadingUbs}>
                      <FormControl><SelectTrigger>
                        <SelectValue placeholder={isLoadingUbs ? "Carregando UBSs..." : "Selecione a UBS"} />
                      </SelectTrigger></FormControl>
                      <SelectContent>
                        {isLoadingUbs && <SelectItem value={LOADING_UBS_VALUE} disabled>Carregando...</SelectItem>}
                        {!isLoadingUbs && ubsList.length === 0 && <SelectItem value="__NO_UBS__" disabled>Nenhuma UBS encontrada</SelectItem>}
                        {!isLoadingUbs && ubsList.map(ubs => (
                          <SelectItem key={ubs.id} value={ubs.id}>{ubs.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Unidade Básica de Saúde onde o paciente é cadastrado.</FormDescription>
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
            <Button type="submit" disabled={form.formState.isSubmitting || isLoadingUbs}>
              {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {patientId ? 'Salvar Alterações' : 'Adicionar Paciente'}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
