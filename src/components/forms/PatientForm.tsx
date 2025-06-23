
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

// Schema para validação do formulário
const patientFormSchema = z.object({
  name: z.string().min(3, { message: "O nome do paciente deve ter pelo menos 3 caracteres." }),
  birthDate: z.string().optional().refine(val => !val || /^\d{4}-\d{2}-\d{2}$/.test(val), {
    message: "Data de Nascimento deve estar no formato AAAA-MM-DD ou ser deixada em branco.",
  }),
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

export type PatientFormData = z.infer<typeof patientFormSchema>;

interface PatientFormProps {
  initialData?: Partial<PatientFormData>; // Em edição, virá da página de edição.
  patientId?: string; // Presente apenas no modo de edição.
  onSubmitSuccess?: (data: Patient) => void; // Callback opcional
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
    // Filtra para mostrar apenas entidades que são UBS (ajustar lógica se necessário)
    const q = query(hospitalsCollectionRef, orderBy("name", "asc"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const allHospitals = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hospital));
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
    resolver: zodResolver(patientFormSchema),
    defaultValues: initialData ? {
        name: initialData.name || '',
        susCardNumber: initialData.susCardNumber || '',
        birthDate: initialData.birthDate || '', // Deve ser string AAAA-MM-DD
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

  // Reset form when initialData changes (e.g., data fetched for editing)
  useEffect(() => {
    if (initialData) {
      form.reset({
        name: initialData.name || '',
        susCardNumber: initialData.susCardNumber || '',
        birthDate: initialData.birthDate || '', // Garanta que seja string ou undefined
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

    const patientDataToSave: Partial<Omit<Patient, 'id'>> = {
      name: data.name,
      name_lowercase: data.name.toLowerCase(),
      susCardNumber: data.susCardNumber,
    };

    if (data.birthDate) patientDataToSave.birthDate = data.birthDate; // AAAA-MM-DD string
    if (data.address) patientDataToSave.address = data.address;
    if (data.phone) patientDataToSave.phone = data.phone;
    if (data.sex) patientDataToSave.sex = data.sex;
    if (data.healthAgentName) patientDataToSave.healthAgentName = data.healthAgentName;
    if (data.registeredUBSId && data.registeredUBSId !== LOADING_UBS_VALUE) {
        patientDataToSave.registeredUBSId = data.registeredUBSId;
        if (selectedUBS) {
            patientDataToSave.registeredUBSName = selectedUBS.name;
        }
    } else {
      // Se registeredUBSId for undefined, LOADING_UBS_VALUE ou não encontrado,
      // garantir que os campos relacionados à UBS sejam removidos ou definidos como null.
      // Firestore não aceita 'undefined', mas aceita 'null' ou omissão do campo.
      // Para consistência, podemos omitir ou definir como null.
      // A omissão é mais limpa se o campo não é obrigatório.
      // No entanto, se queremos explicitamente 'limpar' o campo no update, null seria melhor.
      // A lógica atual de não incluir se `data.registeredUBSId` for falsy já cobre isso para omissão.
      // Se for um update e queremos remover o valor, o `setDoc` com `merge:true` não remove campos que não estão no objeto.
      // Seria necessário passar explicitamente `registeredUBSId: null, registeredUBSName: null`.
      // Para este caso, a omissão (não incluir no objeto) é suficiente se o campo for novo ou se `merge:true`
      // não for usado de forma que sobrescreva todo o documento.
      // Com merge:true, campos não presentes no objeto de atualização são deixados como estão no Firestore.
      // Se queremos *remover* um campo, precisamos passar `{fieldName: firebase.firestore.FieldValue.delete()}`.
      // Isso está fora do escopo atual.
    }


    try {
      if (patientId) { // Modo de Edição
        const patientDocRef = doc(firestore, "patients", patientId);
        await setDoc(patientDocRef, patientDataToSave as Omit<Patient, 'id'>, { merge: true });
        toast({
          title: "Paciente Atualizado",
          description: `${patientDataToSave.name} foi atualizado(a) com sucesso.`,
        });
      } else { // Modo de Adição
        const patientsCollectionRef = collection(firestore, "patients");
        await addDoc(patientsCollectionRef, patientDataToSave as Omit<Patient, 'id'>);
        toast({
          title: "Paciente Adicionado",
          description: `${patientDataToSave.name} foi adicionado(a) com sucesso.`,
        });
      }

      if (onSubmitSuccess) {
        onSubmitSuccess({ ...patientDataToSave, id: patientId || 'new_id_placeholder' } as Patient);
      } else {
        router.push('/patients'); // Redireciona para a página de listagem
      }
    } catch (error) {
      console.error("Erro ao salvar paciente: ", error);
      toast({
        title: `Erro ao ${patientId ? 'Atualizar' : 'Adicionar'} Paciente`,
        description: "Não foi possível salvar os dados do paciente. Verifique o console.",
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
            <Button type="button" variant="outline" onClick={() => router.push('/patients')}>
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
