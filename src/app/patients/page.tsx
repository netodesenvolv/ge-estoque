
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, PlusCircle, Edit3, Trash2, Search, Phone, Home, MapPin, X, Loader2 } from 'lucide-react';
import type { Patient, PatientSex } from '@/types';
import { Input } from '@/components/ui/input';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, doc, deleteDoc, getDocs, limit, startAfter, endBefore, limitToLast, where, type Query, type DocumentSnapshot } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';

const patientSexDisplay: Record<PatientSex, string> = {
  masculino: 'M',
  feminino: 'F',
  outro: 'O',
  ignorado: 'N/I',
};

const PATIENTS_PER_PAGE = 15;

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearchTerm, setActiveSearchTerm] = useState('');
  
  const [lastVisible, setLastVisible] = useState<DocumentSnapshot | null>(null);
  const [firstVisible, setFirstVisible] = useState<DocumentSnapshot | null>(null);
  const [page, setPage] = useState(1);
  const [isLastPage, setIsLastPage] = useState(false);
  
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const buildQuery = (direction: 'first' | 'next' | 'prev', term: string): Query => {
    const patientsCollectionRef = collection(firestore, "patients");
    const constraints: any[] = [];
    
    if (term) {
      if (/^\d{15}$/.test(term)) {
        // Query for exact SUS card number match.
        constraints.push(where("susCardNumber", "==", term));
      } else {
        // Case-sensitive prefix search on name.
        constraints.push(where("name", ">=", term), where("name", "<=", term + '\uf8ff'));
        constraints.push(orderBy("name", "asc"));
      }
    } else {
      // Default query without any search term.
      constraints.push(orderBy("name", "asc"));
    }
    
    if (direction === 'next' && lastVisible) {
      constraints.push(startAfter(lastVisible));
    } else if (direction === 'prev' && firstVisible) {
      constraints.push(endBefore(firstVisible), limitToLast(PATIENTS_PER_PAGE));
      // Reversing order for 'prev' is handled by Firestore's limitToLast
      return query(patientsCollectionRef, ...constraints);
    }
    
    constraints.push(limit(PATIENTS_PER_PAGE));
    return query(patientsCollectionRef, ...constraints);
  };

  const fetchPatients = useCallback(async (direction: 'first' | 'next' | 'prev', term: string) => {
    setIsLoading(true);
    const q = buildQuery(direction, term);
    
    try {
      const documentSnapshots = await getDocs(q);
      let patientsData = documentSnapshots.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as Patient));
      
      // The 'prev' query with limitToLast returns docs in reverse order. We need to flip them back.
      if (direction === 'prev') {
        patientsData = patientsData.reverse();
      }
      
      if (patientsData.length > 0) {
        setPatients(patientsData);
        setFirstVisible(documentSnapshots.docs[0]);
        setLastVisible(documentSnapshots.docs[documentSnapshots.docs.length - 1]);
        setIsLastPage(documentSnapshots.docs.length < PATIENTS_PER_PAGE);
      } else {
        if (direction === 'first' && term) {
          toast({ title: "Nenhum resultado", description: "Nenhum paciente encontrado para a busca." });
        }
        setPatients([]);
        setIsLastPage(true);
      }
    } catch (error: any) {
      console.error("Erro ao buscar pacientes: ", error);
       if (error.code === 'failed-precondition') {
          toast({
            title: "Índice do Banco de Dados Necessário",
            description: "A busca pode não funcionar corretamente sem um índice no banco de dados. Verifique o console para um link de criação.",
            variant: "destructive",
            duration: 10000,
          });
      } else {
        toast({
          title: "Erro ao Carregar Pacientes",
          description: "Não foi possível carregar os pacientes. Verifique o console.",
          variant: "destructive",
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  // Initial fetch
  useEffect(() => {
    fetchPatients('first', '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const handleSearch = () => {
    setPage(1);
    setFirstVisible(null);
    setLastVisible(null);
    setActiveSearchTerm(searchTerm);
    fetchPatients('first', searchTerm);
  };
  
  const handleClearSearch = () => {
    setSearchTerm('');
    setActiveSearchTerm('');
    setPage(1);
    setFirstVisible(null);
    setLastVisible(null);
    fetchPatients('first', '');
  };

  const handleNextPage = () => {
    if (isLastPage) return;
    setPage(p => p + 1);
    fetchPatients('next', activeSearchTerm);
  };

  const handlePrevPage = () => {
    if (page <= 1) return;
    setPage(p => p - 1);
    fetchPatients('prev', activeSearchTerm);
  };

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
      });
      // Re-fetch the first page of the current view after deletion
      handleClearSearch();
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
      return isValid(date) ? format(date, 'dd/MM/yyyy', { locale: ptBR }) : 'Inválida';
    } catch (error) {
      return 'Inválida';
    }
  };

  const getSexDisplay = (sex?: PatientSex) => {
    return sex ? patientSexDisplay[sex] || 'N/A' : 'N/A';
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
          <div className="flex flex-col md:flex-row gap-2 mt-4">
            <div className="relative flex-grow">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Buscar por nome ou Cartão SUS..."
                  className="pl-10 w-full"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
            </div>
            <div className="flex gap-2">
                <Button onClick={handleSearch} disabled={isLoading}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Search className="mr-2 h-4 w-4"/>}
                    Buscar
                </Button>
                <Button onClick={handleClearSearch} variant="outline" disabled={isLoading}>
                    <X className="mr-2 h-4 w-4"/>
                    Limpar
                </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Data de Nasc.</TableHead>
                  <TableHead>Sexo</TableHead>
                  <TableHead>Cartão SUS</TableHead>
                  <TableHead><MapPin className="inline h-4 w-4 mr-1"/>Endereço</TableHead> 
                  <TableHead><Phone className="inline h-4 w-4 mr-1"/>Telefone</TableHead>
                  <TableHead><Home className="inline h-4 w-4 mr-1"/>UBS de Cadastro</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                    <TableRow>
                        <TableCell colSpan={8} className="text-center h-24">
                           <div className="flex justify-center items-center">
                             <Loader2 className="h-6 w-6 animate-spin text-primary" />
                             <p className="ml-2">Buscando pacientes...</p>
                           </div>
                        </TableCell>
                    </TableRow>
                ) : patients.length > 0 ? (
                  patients.map((patient) => (
                    <TableRow key={patient.id}>
                      <TableCell className="font-medium">{patient.name}</TableCell>
                      <TableCell>{formatBirthDate(patient.birthDate)}</TableCell>
                      <TableCell>
                        <Badge variant={patient.sex === 'feminino' ? "secondary" : patient.sex === 'masculino' ? "outline" : "default"} className="text-xs">
                          {getSexDisplay(patient.sex)}
                        </Badge>
                      </TableCell>
                      <TableCell>{patient.susCardNumber}</TableCell>
                      <TableCell>{patient.address || 'N/A'}</TableCell>
                      <TableCell>{patient.phone || 'N/A'}</TableCell>
                      <TableCell>{patient.registeredUBSName || 'N/A'}</TableCell>
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
                    <TableCell colSpan={8} className="text-center h-24"> 
                      Nenhum paciente encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {patients.length > 0 && (
            <div className="flex justify-between items-center mt-4">
              <Button onClick={handlePrevPage} disabled={page <= 1 || isLoading}>
                Anterior
              </Button>
              <span>Página {page}</span>
              <Button onClick={handleNextPage} disabled={isLoading || isLastPage}>
                Próxima
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
