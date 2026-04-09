
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, PlusCircle, Edit3, Trash2, Search, Phone, Home, MapPin, X, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import type { Patient, PatientSex } from '@/types';
import { Input } from '@/components/ui/input';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, doc, deleteDoc, getDocs, limit, startAfter, endBefore, limitToLast, where, type Query, type DocumentSnapshot, writeBatch } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

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
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<{ processed: number; updated: number } | null>(null);
  
  const router = useRouter();
  const { toast } = useToast();
  const { currentUserProfile } = useAuth();
  const isAdmin = currentUserProfile?.role === 'admin';

  const buildQuery = (direction: 'first' | 'next' | 'prev', term: string): Query => {
    const patientsCollectionRef = collection(firestore, "patients");
    const constraints: any[] = [];
    
    if (term) {
      if (/^\d{15}$/.test(term)) {
        // Query for exact SUS card number match.
        constraints.push(where("susCardNumber", "==", term));
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
    
    try {
      if (term && !/^\d{15}$/.test(term)) {
        // Fallback Search Mode (bypasses regular pagination)
        const termLower = term.toLowerCase();
        const termUpper = term.toUpperCase();
        const termTitle = term.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

        const q1 = query(collection(firestore, "patients"), where("name_lowercase", ">=", termLower), where("name_lowercase", "<=", termLower + '\uf8ff'), orderBy("name_lowercase", "asc"), limit(PATIENTS_PER_PAGE));
        const q2 = query(collection(firestore, "patients"), where("name", ">=", termUpper), where("name", "<=", termUpper + '\uf8ff'), orderBy("name", "asc"), limit(PATIENTS_PER_PAGE));
        const q3 = query(collection(firestore, "patients"), where("name", ">=", termTitle), where("name", "<=", termTitle + '\uf8ff'), orderBy("name", "asc"), limit(PATIENTS_PER_PAGE));

        const [snap1, snap2, snap3] = await Promise.all([getDocs(q1), getDocs(q2), getDocs(q3)]);
        
        const allDocs = new Map();
        snap1.docs.forEach(doc => allDocs.set(doc.id, { id: doc.id, ...doc.data() }));
        snap2.docs.forEach(doc => allDocs.set(doc.id, { id: doc.id, ...doc.data() }));
        snap3.docs.forEach(doc => allDocs.set(doc.id, { id: doc.id, ...doc.data() }));
        
        const patientsData = Array.from(allDocs.values()) as Patient[];
        patientsData.sort((a, b) => a.name.localeCompare(b.name));
        
        const finalResults = patientsData.slice(0, PATIENTS_PER_PAGE * 2); // Show up to 30 items for fallback
        
        setPatients(finalResults);
        setFirstVisible(null);
        setLastVisible(null);
        setIsLastPage(true); // Don't allow Next for multi-query fallback

        if (finalResults.length === 0) {
          toast({ title: "Nenhum resultado", description: "Paciente não encontrado." });
        }
      } else {
        const q = buildQuery(direction, term);
        const documentSnapshots = await getDocs(q);
        let patientsData = documentSnapshots.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        } as Patient));
        
        if (direction === 'prev') {
          patientsData = patientsData.reverse();
        }
        
        if (patientsData.length > 0) {
          setPatients(patientsData);
          setFirstVisible(documentSnapshots.docs[0]);
          setLastVisible(documentSnapshots.docs[documentSnapshots.docs.length - 1]);
          setIsLastPage(documentSnapshots.docs.length < PATIENTS_PER_PAGE);
        } else {
          setPatients([]);
          setIsLastPage(true);
        }
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

  const handleMigrateSearchData = async () => {
    if (!isAdmin) return;
    setIsMigrating(true);
    setMigrationProgress({ processed: 0, updated: 0 });
    
    try {
      let isDone = false;
      let lastVisibleDoc: DocumentSnapshot | null = null;
      let totalProcessed = 0;
      let totalUpdated = 0;

      while (!isDone) {
        const constraints: any[] = [orderBy("__name__", "asc"), limit(500)];
        if (lastVisibleDoc) {
           constraints.push(startAfter(lastVisibleDoc));
        }
        
        const q = query(collection(firestore, "patients"), ...constraints);
        const snap = await getDocs(q);
        
        if (snap.empty) {
          isDone = true;
          break;
        }

        const batch = writeBatch(firestore);
        let currentBatchUpdates = 0;

        snap.docs.forEach((docSnap) => {
          const data = docSnap.data();
          if (!data.name_lowercase && data.name) {
            batch.update(docSnap.ref, { name_lowercase: data.name.toLowerCase() });
            currentBatchUpdates++;
          }
          totalProcessed++;
        });

        if (currentBatchUpdates > 0) {
          await batch.commit();
          totalUpdated += currentBatchUpdates;
        }

        lastVisibleDoc = snap.docs[snap.docs.length - 1];
        setMigrationProgress({ processed: totalProcessed, updated: totalUpdated });

        // Dá um pequeno respiro para o navegador não travar e atualizar a UI
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      toast({ title: "Busca Sincronizada", description: `Processados: ${totalProcessed}. Atualizados: ${totalUpdated}.` });
      handleClearSearch();
    } catch (error) {
       console.error("Erro na migração: ", error);
       toast({ title: "Erro na Sincronização", variant: "destructive" });
    } finally {
      setIsMigrating(false);
      setMigrationProgress(null);
    }
  };

  const showMigrationWarning = isAdmin && patients.length > 0 && !patients.some(p => p.name_lowercase) && activeSearchTerm === '';

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

      {showMigrationWarning && (
        <Alert className="mb-6 border-orange-200 bg-orange-50 text-orange-800">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Busca Flexível Disponível</AlertTitle>
          <AlertDescription className="flex flex-col md:flex-row md:items-center justify-between gap-4 mt-2">
            <div>Alguns pacientes antigos precisam ser sincronizados para aparecerem na pesquisa por texto. Dependendo do tamanho da base, isso pode levar alguns minutos. Recomendado executar em horários de menor acesso.</div>
            <div className="flex flex-col gap-2 items-end shrink-0">
                <Button size="sm" onClick={handleMigrateSearchData} disabled={isMigrating} variant="outline" className="border-orange-300 text-orange-800 hover:bg-orange-100">
                  {isMigrating ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <RefreshCw className="mr-2 h-4 w-4"/>}
                  {isMigrating ? 'Sincronizando...' : 'Sincronizar Pacientes'}
                </Button>
                {isMigrating && migrationProgress && (
                    <span className="text-xs font-semibold">
                      Processados: {migrationProgress.processed} / Atualizados: {migrationProgress.updated}
                    </span>
                )}
            </div>
          </AlertDescription>
        </Alert>
      )}

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
