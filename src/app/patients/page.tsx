
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, PlusCircle, Edit3, Trash2, Search, Phone, Home, MapPin } from 'lucide-react';
import type { Patient, PatientSex } from '@/types';
import { Input } from '@/components/ui/input';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { firestore } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy, doc, deleteDoc, getDocs, limit, startAfter, endBefore, limitToLast } from 'firebase/firestore';
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
  const [lastVisible, setLastVisible] = useState<any>(null);
  const [firstVisible, setFirstVisible] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);

  const router = useRouter();
  const { toast } = useToast();

  const fetchPatients = useCallback(async (nextPage = true) => {
    setIsLoading(true);
    const patientsCollectionRef = collection(firestore, "patients");
    let q;

    if (nextPage) {
        q = query(patientsCollectionRef, orderBy("name", "asc"), startAfter(lastVisible), limit(PATIENTS_PER_PAGE));
    } else {
        q = query(patientsCollectionRef, orderBy("name", "asc"), endBefore(firstVisible), limitToLast(PATIENTS_PER_PAGE));
    }
    
    if(page === 1 && !lastVisible) {
        q = query(patientsCollectionRef, orderBy("name", "asc"), limit(PATIENTS_PER_PAGE));
    }

    try {
        const documentSnapshots = await getDocs(q);
        const patientsData = documentSnapshots.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        } as Patient));

        if(patientsData.length > 0) {
            setPatients(patientsData);
            setFirstVisible(documentSnapshots.docs[0]);
            setLastVisible(documentSnapshots.docs[documentSnapshots.docs.length - 1]);
        } else {
            // Se não houver mais dados, voltamos para a página anterior
            if(nextPage && page > 1) { // Apenas decrementar se nextPage for true e não estiver na primeira página
                setPage(page -1);
            } else if (!nextPage && page ===1 && patientsData.length === 0) {
                // Se está na primeira página e não há resultados, não faz nada ou poderia limpar a lista
            }
        }
    } catch (error) {
        console.error("Erro ao buscar pacientes: ", error);
        toast({
            title: "Erro ao Carregar Pacientes",
            description: "Não foi possível carregar os pacientes do banco de dados.",
            variant: "destructive",
        });
    } finally {
        setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastVisible, firstVisible, page, toast]); // Removido 'page' da dependência explícita para evitar loop com setPage

  useEffect(() => {
    // Fetch inicial
    setIsLoading(true);
    const patientsCollectionRef = collection(firestore, "patients");
    const q = query(patientsCollectionRef, orderBy("name", "asc"), limit(PATIENTS_PER_PAGE));
    const unsubscribe = onSnapshot(q, (documentSnapshots) => {
        const patientsData = documentSnapshots.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        } as Patient));
        setPatients(patientsData);
        if (documentSnapshots.docs.length > 0) {
            setFirstVisible(documentSnapshots.docs[0]);
            setLastVisible(documentSnapshots.docs[documentSnapshots.docs.length - 1]);
        } else {
            setFirstVisible(null);
            setLastVisible(null);
        }
        setIsLoading(false);
    }, (error) => {
        console.error("Erro ao buscar pacientes (onSnapshot): ", error);
        toast({
            title: "Erro ao Carregar Pacientes",
            description: "Não foi possível carregar os pacientes do banco de dados.",
            variant: "destructive",
        });
        setIsLoading(false);
    });
     return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]); // Dependência apenas no toast para o listener inicial


  const fetchNextPage = () => {
    if (!lastVisible) return; // Não buscar se não houver último visível (fim da lista)
    setPage(prev => prev + 1);
    fetchPatients(true);
  };

  const fetchPrevPage = () => {
    if (page <= 1 || !firstVisible) return; // Não buscar se estiver na primeira página ou sem primeiro visível
    setPage(prev => prev - 1);
    fetchPatients(false);
  };


  const filteredPatients = patients.filter(patient =>
    patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (patient.susCardNumber && patient.susCardNumber.includes(searchTerm)) ||
    (patient.address && patient.address.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (patient.phone && patient.phone.includes(searchTerm)) ||
    (patient.registeredUBSName && patient.registeredUBSName.toLowerCase().includes(searchTerm.toLowerCase()))
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
      });
      // Re-fetch a primeira página após a exclusão para atualizar a lista
      setPage(1);
      setLastVisible(null); 
      setFirstVisible(null);
      // A chamada inicial do useEffect (onSnapshot) deve pegar a atualização.
      // Se for necessário um refetch mais direto:
      // const patientsCollectionRef = collection(firestore, "patients");
      // const q = query(patientsCollectionRef, orderBy("name", "asc"), limit(PATIENTS_PER_PAGE));
      // const documentSnapshots = await getDocs(q);
      // const patientsData = documentSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() } as Patient));
      // setPatients(patientsData);
      // if (documentSnapshots.docs.length > 0) {
      //     setFirstVisible(documentSnapshots.docs[0]);
      //     setLastVisible(documentSnapshots.docs[documentSnapshots.docs.length - 1]);
      // } else {
      //     setFirstVisible(null);
      //     setLastVisible(null);
      // }

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
      // Tentar parsear AAAA-MM-DD. Se falhar, pode ser DD/MM/AAAA do CSV
      let date = parseISO(dateString); // parseISO espera AAAA-MM-DD
      if (!isValid(date) && dateString.includes('/')) {
        const parts = dateString.split('/');
        if (parts.length === 3) {
          date = parseISO(`${parts[2]}-${parts[1]}-${parts[0]}`);
        }
      }
      if (isValid(date)) {
        return format(date, 'dd/MM/yyyy', { locale: ptBR });
      }
      return 'Data Inválida';
    } catch (error) {
      return 'Data Inválida';
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
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar por nome, Cartão SUS, endereço, telefone ou UBS..."
              className="pl-10 w-full md:w-2/3"
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
                {isLoading && patients.length === 0 ? ( // Mostra carregando apenas se a lista estiver vazia
                    <TableRow>
                        <TableCell colSpan={8} className="text-center h-24">
                            Carregando pacientes...
                        </TableCell>
                    </TableRow>
                ) : filteredPatients.length > 0 ? (
                  filteredPatients.map((patient) => (
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
          {filteredPatients.length > 0 && ( // Mostrar paginação apenas se houver itens filtrados
            <div className="flex justify-between items-center mt-4">
              <Button onClick={fetchPrevPage} disabled={page <= 1 || isLoading}>
                Anterior
              </Button>
              <span>Página {page}</span>
              <Button onClick={fetchNextPage} disabled={isLoading || patients.length < PATIENTS_PER_PAGE || !lastVisible}>
                Próxima
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
