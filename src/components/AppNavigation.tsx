
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
  Users2, // Ícone para o menu principal de Usuários
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebar } from '@/components/ui/sidebar';

const navItems = [
  { href: '/', label: 'Painel', icon: Home },
  {
    label: 'Catálogo',
    icon: Package,
    subItems: [
      { href: '/items', label: 'Ver Itens', icon: Archive },
      { href: '/items/add', label: 'Adicionar Item', icon: PlusCircle },
    ],
  },
  {
    label: 'Estoque',
    icon: Warehouse,
    subItems: [
      { href: '/stock', label: 'Estoque Atual', icon: ClipboardList },
      { href: '/stock/movements', label: 'Registrar Movimentação', icon: ArrowRightLeft },
    ],
  },
  {
    label: 'Pacientes',
    icon: Contact,
    subItems: [
      { href: '/patients', label: 'Ver Pacientes', icon: Users },
      { href: '/patients/add', label: 'Adicionar Paciente', icon: UserPlus },
    ],
  },
  {
    label: 'Hospitais e UBS',
    icon: Building,
    subItems: [
      { href: '/hospitals', label: 'Ver Hospitais/UBS', icon: Building },
      { href: '/hospitals/add', label: 'Adicionar Hospital/UBS', icon: PlusCircle },
    ],
  },
  {
    label: 'Unidades Servidas',
    icon: Users, // Manter Users para unidades, usar Users2 para gerenciamento de usuários
    subItems: [
      { href: '/served-units', label: 'Ver Unidades', icon: Users },
      { href: '/served-units/add', label: 'Adicionar Unidade', icon: PlusCircle },
    ],
  },
  { href: '/trends', label: 'Tendências de Consumo', icon: TrendingUp },
  {
    label: 'Relatórios',
    icon: FileText,
    subItems: [
      { href: '/reports/general-consumption', label: 'Consumo Geral', icon: BarChart3 },
      { href: '/reports/patient-consumption', label: 'Consumo por Paciente', icon: UserCheck },
      { href: '/reports/expiring-items', label: 'Itens a Vencer', icon: CalendarClock },
      { href: '/reports/consumption-history', label: 'Histórico de Consumo', icon: History },
      { href: '/reports/low-stock-levels', label: 'Níveis Baixos/Alerta', icon: ListChecks },
    ],
  },
   {
    label: 'Usuários',
    icon: Users2, // Novo ícone para o menu de Usuários
    subItems: [
      { href: '/users', label: 'Ver Usuários', icon: Users },
      { href: '/users/add', label: 'Adicionar Usuário', icon: UserPlus },
    ],
  },
  {
    label: 'Configuração',
    icon: Settings2,
    subItems: [
      { href: '/config/stock-levels', label: 'Níveis Estratégicos', icon: ShoppingCart },
    ],
  },
];

export default function AppNavigation() {
  const pathname = usePathname();
  const { state: sidebarState, isMobile } = useSidebar();

  const defaultOpenAccordionItems = navItems.reduce<string[]>((acc, item, index) => {
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
        {navItems.map((item, index) => {
          const isDirectActive = !item.subItems && pathname === item.href;
          const isSubItemActive = item.subItems && item.subItems.some(sub => pathname.startsWith(sub.href) && sub.href !== '/'); // Evitar que '/' ative todos os submenus
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
                    {item.subItems.map((subItem) => (
                      <li key={subItem.href}>
                        <Link
                          href={subItem.href}
                          className={cn(
                            baseLinkStyles,
                            "text-xs", 
                            pathname.startsWith(subItem.href) && (subItem.href !== '/' || pathname === '/') && activeLinkStyles
                          )}
                          data-active={pathname.startsWith(subItem.href) && (subItem.href !== '/' || pathname === '/')}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <subItem.icon className="h-4 w-4" />
                            <span className="truncate">{subItem.label}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
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
