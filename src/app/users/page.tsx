
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
import type { User } from '@/types'; 
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { firestore } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy, doc, deleteDoc } from 'firebase/firestore';
import type { FirestoreError } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext'; 

export default function UsersPage() {
  const [userProfiles, setUserProfiles] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [permissionDeniedError, setPermissionDeniedError] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const { currentUserProfile } = useAuth(); 

  useEffect(() => {
    if (!currentUserProfile) {
      setIsLoading(false);
      return; 
    }

    if (currentUserProfile.role !== 'admin') {
      setIsLoading(false);
      setPermissionDeniedError(true); // Explicitly set permission denied for non-admins
      toast({
        title: "Acesso Restrito",
        description: "A visualização da lista de usuários é permitida apenas para administradores.",
        variant: "default", 
      });
      return;
    }

    setIsLoading(true);
    setPermissionDeniedError(false); 
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
  }, [toast, currentUserProfile]);

  const filteredUsers = userProfiles.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (user.associatedHospitalName && user.associatedHospitalName.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleEdit = (id: string) => {
    router.push(`/users/${id}/edit`);
  };

  const handleDelete = async (userId: string, userName: string) => {
     if (currentUserProfile?.role !== 'admin') {
      toast({ title: "Permissão Negada", description: "Apenas administradores podem excluir usuários.", variant: "destructive" });
      return;
    }
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
    const roleMap: Record<User['role'], string> = {
        admin: 'Administrador',
        central_operator: 'Op. Almox. Central',
        hospital_operator: 'Op. Hospital',
        ubs_operator: 'Op. UBS',
        user: 'Usuário Padrão'
    };
    return roleMap[role] || role;
  }

  const getStatusVariant = (status: User['status']): 'default' | 'secondary' => {
    return status === 'active' ? 'default' : 'secondary';
  }
   const getStatusText = (status: User['status']): string => {
    return status === 'active' ? 'Ativo' : 'Inativo';
  }

  const canAddUsers = currentUserProfile?.role === 'admin';

  return (
    <div>
      <PageHeader
        title="Gerenciamento de Usuários"
        description="Adicione, edite e gerencie usuários do sistema."
        icon={UsersIcon}
        actions={
          canAddUsers ? (
            <Button asChild>
              <Link href="/users/add">
                <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Novo Usuário
              </Link>
            </Button>
          ) : null
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Todos os Usuários</CardTitle>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar por nome, email, perfil ou hospital..."
              className="pl-10 w-full md:w-1/2"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={permissionDeniedError || isLoading} // Disable search if permission denied or loading
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
            <div className="flex flex-col items-center justify-center h-auto text-center p-4 rounded-md bg-destructive/10 border border-destructive/50 my-6">
              <ShieldAlert className="h-12 w-12 text-destructive mb-3" />
              <h3 className="text-lg font-semibold text-destructive">Acesso Negado à Lista de Usuários</h3>
              <p className="text-muted-foreground mt-1">
                Apenas administradores podem visualizar esta lista.
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Se você é um administrador e está vendo esta mensagem, verifique suas Regras de Segurança do Firestore.
                A regra para listar a coleção <code className="bg-muted px-1 py-0.5 rounded text-xs">user_profiles</code> deve permitir acesso ao seu UID de administrador.
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
                  <TableHead>Local Associado</TableHead>
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
                      <TableCell>
                        <Badge variant={user.role === 'admin' ? "destructive" : "secondary"} className="whitespace-nowrap">
                            {getRoleText(user.role)}
                        </Badge>
                        </TableCell>
                      <TableCell>
                        {user.associatedHospitalName || '-'}
                        {user.associatedUnitName && ` (${user.associatedUnitName})`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(user.status)}>{getStatusText(user.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {currentUserProfile?.role === 'admin' && (
                          <>
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(user.id)} className="hover:text-primary mr-2">
                              <Edit3 className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="hover:text-destructive" disabled={user.id === currentUserProfile.id}>
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
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">
                      Nenhum usuário encontrado.
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
    
