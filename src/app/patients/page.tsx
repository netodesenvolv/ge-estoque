
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, PlusCircle, Edit3, Trash2, Search } from 'lucide-react';
import type { Patient } from '@/types';
import { Input } from '@/components/ui/input';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { firestore } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy, doc, deleteDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    const patientsCollectionRef = collection(firestore, "patients");
    const q = query(patientsCollectionRef, orderBy("name", "asc"));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const patientsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as Patient));
      setPatients(patientsData);
    }, (error) => {
      console.error("Erro ao buscar pacientes: ", error);
      toast({
        title: "Erro ao Carregar Pacientes",
        description: "Não foi possível carregar os pacientes do banco de dados.",
        variant: "destructive",
      });
    });

    return () => unsubscribe();
  }, [toast]);

  const filteredPatients = patients.filter(patient =>
    patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    patient.susCardNumber.includes(searchTerm)
  );

  const handleEdit = (id: string) => {
    router.push(`/patients/${id}/edit`);
  };

  const handleDelete = async (id: string) => {
    const patientDocRef = doc(firestore, "patients", id);
    try {
      await deleteDoc(patientDocRef);
      toast({
        title: "Paciente Excluído",
        description: "Paciente foi removido do banco de dados.",
        variant: "default",
      });
    } catch (error) {
      console.error("Erro ao excluir paciente: ", error);
      toast({
        title: "Erro ao Excluir Paciente",
        description: "Não foi possível excluir o paciente. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const formatBirthDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      const date = parseISO(dateString);
      if (isValid(date)) {
        return format(date, 'dd/MM/yyyy', { locale: ptBR });
      }
      return 'Data Inválida';
    } catch (error) {
      return 'Data Inválida';
    }
  };


  return (
    <div>
      <PageHeader
        title="Pacientes"
        description="Gerencie os pacientes cadastrados no sistema."
        icon={Users}
        actions={
          <Button asChild>
            <Link href="/patients/add">
              <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Novo Paciente
            </Link>
          </Button>
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Todos os Pacientes</CardTitle>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar por nome ou Cartão SUS..."
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
                  <TableHead>Data de Nascimento</TableHead>
                  <TableHead>Cartão SUS</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPatients.length > 0 ? (
                  filteredPatients.map((patient) => (
                    <TableRow key={patient.id}>
                      <TableCell className="font-medium">{patient.name}</TableCell>
                      <TableCell>
                        {formatBirthDate(patient.birthDate)}
                      </TableCell>
                      <TableCell>{patient.susCardNumber}</TableCell>
                      <TableCell className="text-center">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(patient.id)} className="hover:text-primary mr-2">
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(patient.id)} className="hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center h-24">
                      Nenhum paciente encontrado.
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
