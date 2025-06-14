
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import type { UserRole, UserStatus, UserProfile } from '@/types'; // UserProfile for Firestore data
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext'; // For signUp
import { firestore } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import type { AuthError, User as FirebaseUser } from 'firebase/auth';

const userSchema = z.object({
  name: z.string().min(3, { message: "O nome completo deve ter pelo menos 3 caracteres." }),
  email: z.string().email({ message: "Por favor, insira um email válido." }),
  password: z.string().min(6, { message: "A senha deve ter pelo menos 6 caracteres." }),
  confirmPassword: z.string().min(6, { message: "A confirmação da senha deve ter pelo menos 6 caracteres." }),
  role: z.enum(['admin', 'user'], { required_error: "O perfil do usuário é obrigatório." }),
  status: z.boolean(), // true for active, false for inactive
}).refine(data => data.password === data.confirmPassword, {
  message: "As senhas não coincidem.",
  path: ["confirmPassword"],
});

type UserFormData = z.infer<typeof userSchema>;

interface UserFormProps {
  // initialData for editing will be handled later
  // For now, this form is primarily for adding new users by an admin.
}

export default function UserForm({}: UserFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { signUpWithEmailAndPassword } = useAuth(); // Using this for user creation

  const form = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      role: 'user',
      status: true, // Default to active
    },
  });

  const onSubmit = async (data: UserFormData) => {
    form.clearErrors(); // Clear previous errors
    
    // Step 1: Create user in Firebase Authentication
    // Note: This will log in the new user and log out the current admin.
    // This is a limitation of using client-side SDK for this admin task.
    const authResult = await signUpWithEmailAndPassword(data.email, data.password);

    if ('code' in authResult) { // AuthError
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
      return; // Stop if Auth creation failed
    }

    // Step 2: Create user profile in Firestore
    const firebaseUser = authResult as FirebaseUser;
    const userProfileData: UserProfile = {
      name: data.name,
      email: data.email, // FirebaseUser.email should be the same, but using form data for consistency
      role: data.role as UserRole,
      status: data.status ? 'active' : 'inactive',
    };

    try {
      await setDoc(doc(firestore, "user_profiles", firebaseUser.uid), userProfileData);
      toast({
        title: "Usuário Adicionado",
        description: `${userProfileData.name} foi adicionado com sucesso. O novo usuário está logado.`,
      });
      router.push('/users'); // Redirect to users list (admin might need to log back in)
    } catch (firestoreError) {
      console.error("Erro ao salvar perfil do usuário no Firestore: ", firestoreError);
      toast({
        title: "Erro ao Salvar Perfil",
        description: "Usuário criado no sistema de autenticação, mas houve um erro ao salvar o perfil no banco de dados. Contate o suporte.",
        variant: "destructive",
      });
      // Consider if the Auth user should be deleted if Firestore profile creation fails (requires Admin SDK).
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
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
                        <SelectItem value="admin">Administrador</SelectItem>
                        <SelectItem value="user">Usuário Padrão</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm h-[calc(2.5rem+2px)]">
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
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancelar
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Adicionar Usuário
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
