
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import { Button, buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Users as UsersIcon, PlusCircle, Edit3, Trash2, Search, Loader2, ShieldAlert, X, ChevronLeft, ChevronRight, RefreshCw, AlertCircle } from 'lucide-react';
import type { User } from '@/types'; 
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, doc, deleteDoc, getDocs, limit, startAfter, endBefore, limitToLast, where, type Query, type DocumentSnapshot, writeBatch } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext'; 
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const USERS_PER_PAGE = 15;

export default function UsersPage() {
  const [userProfiles, setUserProfiles] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearchTerm, setActiveSearchTerm] = useState('');
  const [permissionDeniedError, setPermissionDeniedError] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  
  // Pagination
  const [page, setPage] = useState(1);
  const [lastVisible, setLastVisible] = useState<DocumentSnapshot | null>(null);
  const [firstVisible, setFirstVisible] = useState<DocumentSnapshot | null>(null);
  const [isLastPage, setIsLastPage] = useState(false);

  const { toast } = useToast();
  const router = useRouter();
  const { currentUserProfile, user: authUser } = useAuth(); 

  const isAdmin = currentUserProfile?.role === 'admin';

  const buildQuery = (direction: 'first' | 'next' | 'prev', term: string): Query => {
    const usersCollectionRef = collection(firestore, "user_profiles");
    const constraints: any[] = [];
    
    if (term) {
      const lowerTerm = term.toLowerCase();
      constraints.push(where("name_lowercase", ">=", lowerTerm), where("name_lowercase", "<=", lowerTerm + '\uf8ff'));
      constraints.push(orderBy("name_lowercase", "asc"));
    } else {
      constraints.push(orderBy("name", "asc"));
    }
    
    if (direction === 'next' && lastVisible) {
      constraints.push(startAfter(lastVisible));
    } else if (direction === 'prev' && firstVisible) {
      constraints.push(endBefore(firstVisible), limitToLast(USERS_PER_PAGE));
      return query(usersCollectionRef, ...constraints);
    }
    
    constraints.push(limit(USERS_PER_PAGE));
    return query(usersCollectionRef, ...constraints);
  };

  const fetchUsers = useCallback(async (direction: 'first' | 'next' | 'prev', term: string) => {
    if (!currentUserProfile || currentUserProfile.role !== 'admin') return;

    setIsLoading(true);
    const q = buildQuery(direction, term);
    
    try {
      const snap = await getDocs(q);
      let profilesData = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as User));
      
      if (direction === 'prev') profilesData = profilesData.reverse();
      
      if (profilesData.length > 0) {
        setUserProfiles(profilesData);
        setFirstVisible(snap.docs[0]);
        setLastVisible(snap.docs[snap.docs.length - 1]);
        setIsLastPage(snap.docs.length < USERS_PER_PAGE);
      } else {
        if (direction === 'first' && term) {
          toast({ title: "Nenhum resultado", description: "Experimente sincronizar os dados se o usuário for antigo." });
        }
        setUserProfiles([]);
        setIsLastPage(true);
      }
      setPermissionDeniedError(false);
    } catch (error: any) {
      console.error("Erro ao buscar usuários: ", error);
      if (error.code === 'permission-denied') setPermissionDeniedError(true);
      toast({ title: "Erro ao Carregar Usuários", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [currentUserProfile, toast]);

  const handleMigrateSearchData = async () => {
    if (!isAdmin) return;
    setIsMigrating(true);
    try {
      const q = query(collection(firestore, "user_profiles"));
      const snap = await getDocs(q);
      const batch = writeBatch(firestore);
      let count = 0;
      
      snap.docs.forEach(docSnap => {
        const data = docSnap.data();
        if (!data.name_lowercase && data.name) {
          batch.update(docSnap.ref, { name_lowercase: data.name.toLowerCase() });
          count++;
        }
      });
      
      if (count > 0) {
        await batch.commit();
        toast({ title: "Usuários Sincronizados", description: `${count} perfis atualizados.` });
      } else {
        toast({ title: "Tudo em ordem" });
      }
      handleClearSearch();
    } catch (error) {
      console.error("Erro na migração: ", error);
      toast({ title: "Erro na Sincronização", variant: "destructive" });
    } finally {
      setIsMigrating(false);
    }
  };

  const showMigrationWarning = isAdmin && userProfiles.length > 0 && !userProfiles.some(u => u.name_lowercase) && activeSearchTerm === '';

  useEffect(() => {
    if (currentUserProfile) {
      if (currentUserProfile.role === 'admin') {
        fetchUsers('first', '');
      } else {
        setIsLoading(false);
        setPermissionDeniedError(true);
      }
    }
  }, [currentUserProfile, fetchUsers]);

  const handleSearch = () => {
    setPage(1);
    setFirstVisible(null);
    setLastVisible(null);
    setActiveSearchTerm(searchTerm);
    fetchUsers('first', searchTerm);
  };
  
  const handleClearSearch = () => {
    setSearchTerm('');
    setActiveSearchTerm('');
    setPage(1);
    setFirstVisible(null);
    setLastVisible(null);
    fetchUsers('first', '');
  };

  const handleNextPage = () => { if (!isLastPage) { setPage(p => p + 1); fetchUsers('next', activeSearchTerm); } };
  const handlePrevPage = () => { if (page > 1) { setPage(p => p - 1); fetchUsers('prev', activeSearchTerm); } };

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
        description: `O perfil de ${userName} foi removido do banco de dados.`,
      });
      handleSearch();
    } catch (error) {
      console.error("Erro ao excluir perfil de usuário: ", error);
      toast({ title: "Erro ao Excluir Perfil", variant: "destructive" });
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

  return (
    <div>
      <PageHeader
        title="Gerenciamento de Usuários"
        description="Adicione, edite e gerencie usuários do sistema."
        icon={UsersIcon}
        actions={
          currentUserProfile?.role === 'admin' ? (
            <Button asChild>
              <Link href="/users/add">
                <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Novo Usuário
              </Link>
            </Button>
          ) : null
        }
      />

      {showMigrationWarning && (
        <Alert className="mb-6 border-orange-200 bg-orange-50 text-orange-800">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Sincronização Necessária</AlertTitle>
          <AlertDescription className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            Para habilitar a busca flexível nos usuários antigos, é necessário atualizar os registros.
            <Button size="sm" onClick={handleMigrateSearchData} disabled={isMigrating} variant="outline" className="border-orange-300 text-orange-800 hover:bg-orange-100">
              {isMigrating ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <RefreshCw className="mr-2 h-4 w-4"/>}
              Sincronizar Usuários
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Todos os Usuários</CardTitle>
          <div className="flex flex-col md:flex-row gap-2 mt-4">
            <div className="relative flex-grow">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Buscar por NOME do usuário (inicia com)..."
                className="pl-10 w-full"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                disabled={permissionDeniedError || isLoading}
              />
            </div>
            <div className="flex gap-2">
                <Button onClick={handleSearch} disabled={isLoading || permissionDeniedError}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Search className="mr-2 h-4 w-4"/>}
                    Buscar
                </Button>
                <Button onClick={handleClearSearch} variant="outline" disabled={isLoading || permissionDeniedError}>
                    <X className="mr-2 h-4 w-4"/>
                    Limpar
                </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
             <div className="flex items-center justify-center h-24">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="ml-2 text-muted-foreground">Buscando usuários...</p>
            </div>
          ) : permissionDeniedError ? (
            <div className="flex flex-col items-center justify-center h-auto text-center p-4 rounded-md bg-destructive/10 border border-destructive/50 my-6">
              <ShieldAlert className="h-12 w-12 text-destructive mb-3" />
              <h3 className="text-lg font-semibold text-destructive">Acesso Negado</h3>
              <p className="text-muted-foreground mt-1">Apenas administradores podem visualizar esta lista.</p>
            </div>
          ) : (
          <>
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
                {userProfiles.length > 0 ? (
                  userProfiles.map((user) => (
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
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(user.id)} className="hover:text-primary mr-2">
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="hover:text-destructive" disabled={user.id === authUser?.uid}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
                              <AlertDialogDescription>Tem certeza que deseja excluir o perfil de {user.name}?</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(user.id, user.name)} className={buttonVariants({variant: "destructive"})}>Excluir</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={6} className="text-center h-24">Nenhum usuário encontrado.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {userProfiles.length > 0 && (
            <div className="flex justify-between items-center mt-4 border-t pt-4">
              <Button onClick={handlePrevPage} disabled={page === 1 || isLoading} variant="outline" size="sm">
                <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
              </Button>
              <span className="text-sm font-medium">Página {page}</span>
              <Button onClick={handleNextPage} disabled={isLastPage || isLoading} variant="outline" size="sm">
                Próxima <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
          </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
    
