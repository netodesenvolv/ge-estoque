
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import type { Patient } from '@/types';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { CalendarIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { firestore } from '@/lib/firebase';
import { collection, addDoc, doc, setDoc } from 'firebase/firestore';
import { useEffect } from 'react';

const patientSchema = z.object({
  name: z.string().min(3, { message: "O nome do paciente deve ter pelo menos 3 caracteres." }),
  birthDate: z.date({ required_error: "A data de nascimento é obrigatória.", invalid_type_error: "Data de nascimento inválida."}),
  susCardNumber: z.string()
    .min(15, { message: "O número do Cartão SUS deve ter 15 dígitos." })
    .max(15, { message: "O número do Cartão SUS deve ter 15 dígitos." })
    .regex(/^\d{15}$/, { message: "O Cartão SUS deve conter apenas números." }),
});

type PatientFormData = z.infer<typeof patientSchema>;

interface PatientFormProps {
  initialData?: Patient;
  patientId?: string; // ID do paciente para modo de edição
  onSubmitSuccess?: (data: Patient) => void;
}

export default function PatientForm({ initialData, patientId, onSubmitSuccess }: PatientFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const form = useForm<PatientFormData>({
    resolver: zodResolver(patientSchema),
    defaultValues: initialData ? {
      ...initialData,
      birthDate: initialData.birthDate ? new Date(initialData.birthDate) : new Date(), // Garante que seja um objeto Date
    } : {
      name: '',
      susCardNumber: '',
      birthDate: undefined,
    },
  });

  useEffect(() => {
    if (initialData) {
      form.reset({
        ...initialData,
        birthDate: initialData.birthDate ? new Date(initialData.birthDate) : new Date(),
      });
    }
  }, [initialData, form]);

  const onSubmit = async (data: PatientFormData) => {
    const patientDataToSave = {
      ...data,
      birthDate: format(data.birthDate, 'yyyy-MM-dd'), // Formata para string ISO antes de salvar
    };

    try {
      if (patientId) {
        // Modo de Edição
        const patientDocRef = doc(firestore, "patients", patientId);
        await setDoc(patientDocRef, patientDataToSave, { merge: true });
        toast({
          title: "Paciente Atualizado",
          description: `${data.name} foi atualizado(a) com sucesso.`,
          variant: "default",
        });
      } else {
        // Modo de Adição
        const patientsCollectionRef = collection(firestore, "patients");
        await addDoc(patientsCollectionRef, patientDataToSave);
        toast({
          title: "Paciente Adicionado",
          description: `${data.name} foi adicionado(a) com sucesso ao banco de dados.`,
          variant: "default",
        });
      }
      
      if (onSubmitSuccess) {
        // @ts-ignore
        onSubmitSuccess({ ...patientDataToSave, id: patientId || 'new_id_placeholder' });
      } else {
        router.push('/patients'); 
      }
    } catch (error) {
      console.error("Erro ao salvar paciente: ", error);
      toast({
        title: `Erro ao ${patientId ? 'Atualizar' : 'Adicionar'} Paciente`,
        description: `Não foi possível ${patientId ? 'atualizar' : 'adicionar'} o paciente. Verifique o console.`,
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="max-w-lg mx-auto shadow-lg">
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
                  <FormControl>
                    <Input placeholder="ex: Maria da Silva" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="birthDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Data de Nascimento</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant={"outline"}
                          className={cn(
                            "w-full pl-3 text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value ? (
                            format(field.value, "dd/MM/yyyy")
                          ) : (
                            <span>Selecione uma data</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) =>
                          date > new Date() || date < new Date("1900-01-01")
                        }
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="susCardNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Número do Cartão SUS</FormLabel>
                  <FormControl>
                    <Input placeholder="700000000000000" {...field} maxLength={15} />
                  </FormControl>
                  <FormDescription>Digite os 15 dígitos do Cartão Nacional de Saúde.</FormDescription>
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
              {patientId ? 'Salvar Alterações' : 'Adicionar Paciente'}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
