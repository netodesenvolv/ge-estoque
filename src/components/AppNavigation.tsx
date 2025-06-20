
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Package,
  Archive,
  ArrowRightLeft,
  Warehouse,
  Users,
  Settings2,
  TrendingUp,
  ShoppingCart,
  ClipboardList,
  Building,
  UserPlus,
  Contact,
  FileText,
  BarChart3,
  UserCheck,
  CalendarClock,
  History,
  ChevronDown,
  ListChecks,
  PlusCircle,
  Users2, 
  LogIn, // Ícone para Entradas/Saídas
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebar } from '@/components/ui/sidebar';
import { useAuth } from '@/contexts/AuthContext'; // Import useAuth

const navItemsBase = [
  { href: '/', label: 'Painel', icon: Home, roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator', 'user'] },
  {
    label: 'Catálogo',
    icon: Package,
    roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator', 'user'],
    subItems: [
      { href: '/items', label: 'Ver Itens', icon: Archive, roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator', 'user'] },
      { href: '/items/add', label: 'Adicionar Item', icon: PlusCircle, roles: ['admin', 'central_operator'] },
    ],
  },
  {
    label: 'Estoque',
    icon: Warehouse,
    roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator', 'user'],
    subItems: [
      { href: '/stock', label: 'Estoque Atual', icon: ClipboardList, roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator', 'user'] },
      { href: '/stock/movements', label: 'Entradas/Saídas (Central)', icon: LogIn, roles: ['admin', 'central_operator'] },
      { href: '/stock/consumption', label: 'Registrar Consumo', icon: ShoppingCart, roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator'] },
    ],
  },
  {
    label: 'Pacientes',
    icon: Contact,
    roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator'], 
    subItems: [
      { href: '/patients', label: 'Ver Pacientes', icon: Users, roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator'] },
      { href: '/patients/add', label: 'Adicionar Paciente', icon: UserPlus, roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator'] },
    ],
  },
  {
    label: 'Hospitais e UBS',
    icon: Building,
    roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator'],
    subItems: [
      { href: '/hospitals', label: 'Ver Hospitais/UBS', icon: Building, roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator'] },
      { href: '/hospitals/add', label: 'Adicionar Hospital/UBS', icon: PlusCircle, roles: ['admin', 'central_operator'] },
    ],
  },
  {
    label: 'Unidades Servidas',
    icon: Users, 
    roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator'],
    subItems: [
      { href: '/served-units', label: 'Ver Unidades', icon: Users, roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator'] },
      { href: '/served-units/add', label: 'Adicionar Unidade', icon: PlusCircle, roles: ['admin', 'central_operator'] },
    ],
  },
  { href: '/trends', label: 'Tendências IA', icon: TrendingUp, roles: ['admin', 'central_operator'] },
  {
    label: 'Relatórios',
    icon: FileText,
    roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator'],
    subItems: [
      { href: '/reports/general-consumption', label: 'Consumo Geral', icon: BarChart3, roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator'] },
      { href: '/reports/patient-consumption', label: 'Consumo por Paciente', icon: UserCheck, roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator'] },
      { href: '/reports/expiring-items', label: 'Itens a Vencer', icon: CalendarClock, roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator'] },
      { href: '/reports/consumption-history', label: 'Histórico de Consumo', icon: History, roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator'] },
      { href: '/reports/low-stock-levels', label: 'Níveis Baixos/Alerta', icon: ListChecks, roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator'] },
    ],
  },
   {
    label: 'Usuários',
    icon: Users2,
    roles: ['admin'], 
    subItems: [
      { href: '/users', label: 'Ver Usuários', icon: Users, roles: ['admin'] },
      { href: '/users/add', label: 'Adicionar Usuário', icon: UserPlus, roles: ['admin'] },
    ],
  },
  {
    label: 'Configuração',
    icon: Settings2,
    roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator'],
    subItems: [
      { href: '/config/stock-levels', label: 'Níveis Estratégicos', icon: ShoppingCart, roles: ['admin', 'central_operator', 'hospital_operator', 'ubs_operator'] },
    ],
  },
];

export default function AppNavigation() {
  const pathname = usePathname();
  const { state: sidebarState, isMobile } = useSidebar();
  const { currentUserProfile } = useAuth();
  const userRole = currentUserProfile?.role;

  const filteredNavItems = navItemsBase.filter(item => 
    item.roles.includes(userRole || 'user') 
  ).map(item => ({
    ...item,
    subItems: item.subItems ? item.subItems.filter(subItem => subItem.roles.includes(userRole || 'user')) : undefined,
  })).filter(item => item.href || (item.subItems && item.subItems.length > 0)); 

  const defaultOpenAccordionItems = filteredNavItems.reduce<string[]>((acc, item, index) => {
    if (item.subItems && item.subItems.some(sub => pathname.startsWith(sub.href))) {
      acc.push(`item-${index}`);
    }
    return acc;
  }, []);

  const baseLinkStyles = "flex items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2";
  const activeLinkStyles = "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 font-medium";

  return (
    <nav className="flex flex-col p-2">
      <Accordion type="multiple" className="w-full" defaultValue={defaultOpenAccordionItems}>
        {filteredNavItems.map((item, index) => {
          const isDirectActive = !item.subItems && pathname === item.href;
          
          const isCurrentPathExactlySubItem = item.subItems?.some(sub => sub.href === pathname);
          const isCurrentPathStartsWithSubItem = item.subItems?.some(sub => pathname.startsWith(sub.href) && sub.href !== '/');
          
          let isSubItemActive = false;
          if (item.subItems) {
            if (item.label === 'Estoque' && pathname.startsWith('/stock/consumption')) {
                 isSubItemActive = true; // Explicitamente ativa "Estoque" para "/stock/consumption"
            } else if (item.subItems.some(sub => pathname.startsWith(sub.href) && (sub.href === '/' ? pathname === '/' : true))) {
                 isSubItemActive = true;
            }
          }
          const isActive = isDirectActive || isSubItemActive;

          if (item.subItems) {
            return (
              <AccordionItem value={`item-${index}`} key={item.label} className="border-none">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AccordionTrigger
                      className={cn(
                        baseLinkStyles,
                        "w-full justify-between group",
                        (isSubItemActive && !isDirectActive) && activeLinkStyles
                      )}
                      data-active={(isSubItemActive && !isDirectActive)}
                    >
                      <span className="flex w-full items-center justify-between">
                        <span className="flex items-center gap-2 truncate">
                          <item.icon className="h-5 w-5" />
                          {(sidebarState === 'expanded' || isMobile) && <span className="truncate">{item.label}</span>}
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                      </span>
                    </AccordionTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="right" align="center" hidden={sidebarState === "expanded" || isMobile}>
                    {item.label}
                  </TooltipContent>
                </Tooltip>
                <AccordionContent className="pb-0 pl-4 border-l border-sidebar-border ml-[18px]">
                  <ul className="flex w-full min-w-0 flex-col gap-1 pt-1">
                    {item.subItems.map((subItem) => {
                      let currentSubItemIsActive = false;
                      if (subItem.href === '/stock/consumption' && pathname.startsWith('/stock/consumption')) {
                          currentSubItemIsActive = true;
                      } else if (pathname.startsWith(subItem.href) && (subItem.href === '/' ? pathname === '/' : true)) {
                          currentSubItemIsActive = true;
                      }
                      
                      return (
                      <li key={subItem.href}>
                        <Link
                          href={subItem.href}
                          className={cn(
                            baseLinkStyles,
                            "text-xs",
                            currentSubItemIsActive && activeLinkStyles
                          )}
                          data-active={currentSubItemIsActive}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <subItem.icon className="h-4 w-4" />
                            <span className="truncate">{subItem.label}</span>
                          </span>
                        </Link>
                      </li>
                    );
                    })}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            );
          }

          return (
            <li key={item.href} className="relative">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    className={cn(
                      baseLinkStyles,
                      "w-full justify-start",
                      isActive && activeLinkStyles
                    )}
                    data-active={isActive}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <item.icon className="h-5 w-5" />
                      {(sidebarState === 'expanded' || isMobile) && (
                        <span className="truncate">{item.label}</span>
                      )}
                    </span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" align="center" hidden={sidebarState === "expanded" || isMobile}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </Accordion>
    </nav>
  );
}
        