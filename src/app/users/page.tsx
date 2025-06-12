
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users as UsersIcon, PlusCircle, Edit3, Trash2, Search } from 'lucide-react'; // Renomeado Users para UsersIcon
import type { User } from '@/types';
import { mockUsers } from '@/data/mockData';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    // Em uma aplicação real, você buscaria isso de uma API
    setUsers(mockUsers);
  }, []);

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleEdit = (id: string) => {
    toast({
      title: "Ação Simulada",
      description: `Editar usuário com ID: ${id}. Funcionalidade de edição não implementada.`,
    });
    // router.push(`/users/${id}/edit`); // Futuramente
  };

  const handleDelete = (id: string) => {
    // Simulação de exclusão
    setUsers(prevUsers => prevUsers.filter(user => user.id !== id));
    toast({
      title: "Usuário Excluído (Simulado)",
      description: `Usuário com ID: ${id} foi excluído da lista.`,
    });
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
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(user.id)} className="hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center h-24">
                      Nenhum usuário encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
