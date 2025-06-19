
'use client';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import type { UserRole, UserStatus, UserProfile, Hospital, ServedUnit } from '@/types';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext'; 
import { firestore } from '@/lib/firebase';
import { doc, setDoc, collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import type { AuthError, User as FirebaseUser } from 'firebase/auth';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

const userSchema = z.object({
  name: z.string().min(3, { message: "O nome completo deve ter pelo menos 3 caracteres." }),
  email: z.string().email({ message: "Por favor, insira um email válido." }),
  password: z.string().min(6, { message: "A senha deve ter pelo menos 6 caracteres." }),
  confirmPassword: z.string().min(6, { message: "A confirmação da senha deve ter pelo menos 6 caracteres." }),
  role: z.enum(['admin', 'central_operator', 'hospital_operator', 'ubs_operator', 'user'], { required_error: "O perfil do usuário é obrigatório." }),
  status: z.boolean(),
  associatedHospitalId: z.string().optional(),
  associatedUnitId: z.string().optional(),
}).refine(data => data.password === data.confirmPassword, {
  message: "As senhas não coincidem.",
  path: ["confirmPassword"],
}).refine(data => {
  if ((data.role === 'hospital_operator' || data.role === 'ubs_operator') && !data.associatedHospitalId) {
    return false;
  }
  return true;
}, {
  message: "Hospital associado é obrigatório para operadores de hospital/UBS.",
  path: ["associatedHospitalId"],
});

type UserFormData = z.infer<typeof userSchema>;

interface UserFormProps {
  // initialData for editing will be handled later
}

const LOADING_VALUE = "__LOADING__";

export default function UserForm({}: UserFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { signUpWithEmailAndPassword } = useAuth(); 
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);
  const [isLoadingHospitals, setIsLoadingHospitals] = useState(true);
  const [isLoadingUnits, setIsLoadingUnits] = useState(false);


  const form = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      role: 'user',
      status: true, 
      associatedHospitalId: undefined,
      associatedUnitId: undefined,
    },
  });

  const selectedRole = form.watch('role');
  const selectedHospitalForUnits = form.watch('associatedHospitalId');

  useEffect(() => {
    setIsLoadingHospitals(true);
    const hospitalsQuery = query(collection(firestore, "hospitals"), orderBy("name", "asc"));
    const unsubscribeHospitals = onSnapshot(hospitalsQuery, (snapshot) => {
      setHospitals(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hospital)));
      setIsLoadingHospitals(false);
    }, (error) => {
      console.error("Erro ao buscar hospitais:", error);
      toast({ title: "Erro ao carregar hospitais", variant: "destructive" });
      setIsLoadingHospitals(false);
    });

    return () => unsubscribeHospitals();
  }, [toast]);

  useEffect(() => {
    if (selectedHospitalForUnits && (selectedRole === 'hospital_operator')) {
      setIsLoadingUnits(true);
      const unitsQuery = query(collection(firestore, "servedUnits"), orderBy("name", "asc"));
      const unsubscribeUnits = onSnapshot(unitsQuery, (snapshot) => {
        setServedUnits(
          snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as ServedUnit))
            .filter(unit => unit.hospitalId === selectedHospitalForUnits)
        );
        setIsLoadingUnits(false);
      }, (error) => {
        console.error("Erro ao buscar unidades servidas:", error);
        toast({ title: "Erro ao carregar unidades servidas", variant: "destructive" });
        setIsLoadingUnits(false);
      });
      return () => unsubscribeUnits();
    } else {
      setServedUnits([]);
    }
  }, [selectedHospitalForUnits, selectedRole, toast]);
  
   useEffect(() => {
    // Reset associatedUnitId if hospital changes or role no longer requires it
    if (selectedRole !== 'hospital_operator') {
         form.setValue('associatedUnitId', undefined);
    }
  }, [selectedRole, selectedHospitalForUnits, form]);


  const onSubmit = async (data: UserFormData) => {
    form.clearErrors(); 
    
    const authResult = await signUpWithEmailAndPassword(data.email, data.password);

    if ('code' in authResult) { 
      const authError = authResult as AuthError;
      if (authError.code === 'auth/email-already-in-use') {
        form.setError("email", { type: "manual", message: "Este email já está em uso." });
      } else if (authError.code === 'auth/weak-password') {
        form.setError("password", { type: "manual", message: "Senha muito fraca. Tente uma senha mais forte." });
      } else {
        toast({
          title: "Erro ao Criar Usuário no Auth",
          description: authError.message,
          variant: "destructive",
        });
      }
      return; 
    }

    const firebaseUser = authResult as FirebaseUser;
    const hospital = data.associatedHospitalId ? hospitals.find(h => h.id === data.associatedHospitalId) : undefined;
    const unit = data.associatedUnitId ? servedUnits.find(u => u.id === data.associatedUnitId) : undefined;

    const userProfileData: UserProfile = {
      name: data.name,
      email: data.email, 
      role: data.role as UserRole,
      status: data.status ? 'active' : 'inactive',
      associatedHospitalId: data.associatedHospitalId || undefined,
      associatedHospitalName: hospital?.name || undefined,
      associatedUnitId: data.associatedUnitId || undefined,
      associatedUnitName: unit?.name || undefined,
    };

    try {
      await setDoc(doc(firestore, "user_profiles", firebaseUser.uid), userProfileData);
      toast({
        title: "Usuário Adicionado",
        description: `${userProfileData.name} foi adicionado com sucesso. O novo usuário está logado. O administrador precisará logar novamente.`,
      });
      router.push('/users'); 
    } catch (firestoreError) {
      console.error("Erro ao salvar perfil do usuário no Firestore: ", firestoreError);
      toast({
        title: "Erro ao Salvar Perfil",
        description: "Usuário criado no sistema de autenticação, mas houve um erro ao salvar o perfil no banco de dados.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="max-w-xl mx-auto shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">Adicionar Novo Usuário</CardTitle>
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
                    <Input placeholder="ex: João da Silva" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="ex: joao.silva@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senha</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Mínimo 6 caracteres" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirmar Senha</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Repita a senha" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Perfil</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um perfil" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="user">Usuário Básico (Padrão Signup)</SelectItem>
                      <SelectItem value="admin">Administrador</SelectItem>
                      <SelectItem value="central_operator">Operador do Almoxarifado Central</SelectItem>
                      <SelectItem value="hospital_operator">Operador de Hospital</SelectItem>
                      <SelectItem value="ubs_operator">Operador de UBS</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {(selectedRole === 'hospital_operator' || selectedRole === 'ubs_operator') && (
              <FormField
                control={form.control}
                name="associatedHospitalId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hospital/UBS Associado</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value} disabled={isLoadingHospitals}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={isLoadingHospitals ? "Carregando..." : "Selecione Hospital/UBS"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {isLoadingHospitals ? (
                          <SelectItem value={LOADING_VALUE} disabled>Carregando...</SelectItem>
                        ) : hospitals.length === 0 ? (
                          <SelectItem value={LOADING_VALUE} disabled>Nenhum hospital/UBS cadastrado</SelectItem>
                        ) : (
                          hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {selectedRole === 'hospital_operator' && selectedHospitalForUnits && (
              <FormField
                control={form.control}
                name="associatedUnitId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unidade Servida Associada (Opcional para Operador de Hospital)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value} disabled={isLoadingUnits || !selectedHospitalForUnits}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={isLoadingUnits ? "Carregando unidades..." : "Todas as unidades do hospital ou uma específica"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {isLoadingUnits ? (
                           <SelectItem value={LOADING_VALUE} disabled>Carregando...</SelectItem>
                        ) : servedUnits.length === 0 ? (
                           <SelectItem value={LOADING_VALUE} disabled>Nenhuma unidade para este hospital</SelectItem>
                        ) : (
                          <>
                            <SelectItem value="">Nenhuma específica (acesso a todas do hospital)</SelectItem>
                            {servedUnits.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    <FormDescription>Se não selecionada, o operador terá acesso para registrar consumo em qualquer unidade do hospital associado.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm h-[calc(2.5rem+2px)] mt-4">
                  <div className="space-y-0.5">
                    <FormLabel>Status</FormLabel>
                     <FormDescription>
                       {field.value ? "Ativo" : "Inativo"}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
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
            <Button type="submit" disabled={form.formState.isSubmitting || isLoadingHospitals}>
              {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Adicionar Usuário
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
