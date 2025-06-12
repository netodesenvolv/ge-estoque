
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
import type { User, UserRole, UserStatus } from '@/types';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

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
  initialData?: User & { password?: string; confirmPassword?: string }; // Password fields for form only
  onSubmitSuccess?: (data: User) => void;
}

export default function UserForm({ initialData, onSubmitSuccess }: UserFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const form = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: initialData ? {
      ...initialData,
      status: initialData.status === 'active',
      password: initialData.password || '', // Initialize for edit if provided, but usually for new
      confirmPassword: initialData.confirmPassword || '',
    } : {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      role: 'user',
      status: true, // Default to active
    },
  });

  const onSubmit = (data: UserFormData) => {
    // Em uma aplicação real, a senha seria hasheada no backend.
    // Não armazenamos senha ou confirmPassword no mockUser.
    const submittedUser: User = {
      id: initialData?.id || Math.random().toString(36).substring(2, 15),
      name: data.name,
      email: data.email,
      role: data.role as UserRole,
      status: data.status ? 'active' : 'inactive',
    };
    
    console.log('Formulário de usuário submetido (dados para API/mock):', submittedUser);
    console.log('Senha (não armazenar em mock):', data.password);


    if (onSubmitSuccess) {
      onSubmitSuccess(submittedUser);
    } else {
      // Aqui você adicionaria o usuário à lista mock (ou faria uma chamada de API)
      // mockUsers.push(submittedUser); // Exemplo, precisa de estado global ou API
      toast({
        title: initialData ? "Usuário Atualizado" : "Usuário Adicionado",
        description: `${submittedUser.name} foi ${initialData ? 'atualizado(a)' : 'adicionado(a)'} com sucesso.`,
      });
      router.push('/users');
    }
  };

  return (
    <Card className="max-w-xl mx-auto shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">{initialData ? 'Editar Usuário' : 'Adicionar Novo Usuário'}</CardTitle>
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
            <Button type="submit">
              {initialData ? 'Salvar Alterações' : 'Adicionar Usuário'}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
