
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import { Button, buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Users as UsersIcon, PlusCircle, Edit3, Trash2, Search, Loader2, ShieldAlert } from 'lucide-react';
import type { UserProfile, User } from '@/types';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { firestore } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy, doc, deleteDoc } from 'firebase/firestore';
import type { FirestoreError } from 'firebase/firestore';

export default function UsersPage() {
  const [userProfiles, setUserProfiles] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [permissionDeniedError, setPermissionDeniedError] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    setIsLoading(true);
    setPermissionDeniedError(false); // Reset on each load attempt
    const usersCollectionRef = collection(firestore, "user_profiles");
    const q = query(usersCollectionRef, orderBy("name", "asc"));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const profilesData = querySnapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data(),
      } as User));
      setUserProfiles(profilesData);
      setIsLoading(false);
    }, (error: FirestoreError) => {
      console.error("Firestore onSnapshot error in UsersPage. Code:", error.code, "Message:", error.message, "Stack:", error.stack);
      toast({
        title: "Erro ao Carregar Usuários",
        description: `Não foi possível carregar os perfis: ${error.message}`,
        variant: "destructive",
      });
      if (error.code === 'permission-denied') {
        setPermissionDeniedError(true);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [toast]);

  const filteredUsers = userProfiles.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleEdit = (id: string) => {
    toast({
      title: "Funcionalidade Pendente",
      description: `A edição do usuário com ID: ${id} ainda não foi implementada.`,
    });
    // router.push(`/users/${id}/edit`); // Futuramente
  };

  const handleDelete = async (userId: string, userName: string) => {
    const userProfileDocRef = doc(firestore, "user_profiles", userId);
    try {
      await deleteDoc(userProfileDocRef);
      toast({
        title: "Perfil de Usuário Excluído",
        description: `O perfil de ${userName} foi removido do banco de dados. A conta de autenticação do Firebase permanece.`,
      });
    } catch (error) {
      console.error("Erro ao excluir perfil de usuário: ", error);
      toast({
        title: "Erro ao Excluir Perfil",
        description: "Não foi possível excluir o perfil do usuário. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const getRoleText = (role: User['role']) => {
    return role === 'admin' ? 'Administrador' : 'Usuário';
  }

  const getStatusVariant = (status: User['status']): 'default' | 'secondary' => {
    return status === 'active' ? 'default' : 'secondary';
  }
   const getStatusText = (status: User['status']): string => {
    return status === 'active' ? 'Ativo' : 'Inativo';
  }


  return (
    <div>
      <PageHeader
        title="Gerenciamento de Usuários"
        description="Adicione, edite e gerencie usuários do sistema."
        icon={UsersIcon}
        actions={
          <Button asChild>
            <Link href="/users/add">
              <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Novo Usuário
            </Link>
          </Button>
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Todos os Usuários</CardTitle>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar por nome ou email..."
              className="pl-10 w-full md:w-1/2"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
             <div className="flex items-center justify-center h-24">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="ml-2 text-muted-foreground">Carregando usuários...</p>
            </div>
          ) : permissionDeniedError ? (
            <div className="flex flex-col items-center justify-center h-40 text-center p-4">
              <ShieldAlert className="h-12 w-12 text-destructive mb-3" />
              <h3 className="text-lg font-semibold text-destructive">Acesso Negado</h3>
              <p className="text-muted-foreground">
                Você não tem permissão para visualizar a lista de usuários.
                Verifique se sua conta possui o perfil de 'Administrador' e se as regras de segurança do Firestore estão configuradas corretamente para permitir a leitura da coleção 'user_profiles'.
              </p>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Perfil</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.length > 0 ? (
                  filteredUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{getRoleText(user.role)}</TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(user.status)}>{getStatusText(user.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(user.id)} className="hover:text-primary mr-2">
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
                              <AlertDialogDescription>
                                Tem certeza que deseja excluir o perfil de {user.name}? Esta ação removerá o perfil do banco de dados, mas não a conta de autenticação do Firebase.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(user.id, user.name)} className={buttonVariants({variant: "destructive"})}>
                                Excluir Perfil
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center h-24">
                      Nenhum usuário encontrado. Verifique se há usuários cadastrados ou se há permissão para listá-los.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

