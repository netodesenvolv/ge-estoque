'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Package,
  PlusCircle,
  Archive,
  ArrowRightLeft,
  Warehouse,
  Users,
  Settings2,
  TrendingUp,
  ShoppingCart,
  ClipboardList,
  Truck
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from '@/components/ui/sidebar';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";


const navItems = [
  { href: '/', label: 'Dashboard', icon: Home },
  {
    label: 'Catalog',
    icon: Package,
    subItems: [
      { href: '/items', label: 'View Items', icon: Archive },
      { href: '/items/add', label: 'Add Item', icon: PlusCircle },
    ],
  },
  {
    label: 'Stock',
    icon: Warehouse,
    subItems: [
      { href: '/stock', label: 'Current Stock', icon: ClipboardList },
      { href: '/stock/movements', label: 'Record Movement', icon: ArrowRightLeft },
    ],
  },
  {
    label: 'Served Units',
    icon: Users,
    subItems: [
      { href: '/served-units', label: 'View Units', icon: Users },
      { href: '/served-units/add', label: 'Add Unit', icon: PlusCircle },
      // Consumption link might be per unit, not general
    ],
  },
  {
    label: 'Configuration',
    icon: Settings2,
    subItems: [
      { href: '/config/stock-levels', label: 'Strategic Levels', icon: ShoppingCart },
    ],
  },
  { href: '/trends', label: 'Consumption Trends', icon: TrendingUp },
];

export default function AppNavigation() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col p-2">
      <Accordion type="multiple" className="w-full">
        {navItems.map((item, index) =>
          item.subItems ? (
            <AccordionItem value={`item-${index}`} key={item.label} className="border-none">
              <AccordionTrigger className="hover:no-underline py-0">
                 <SidebarMenuButton
                    asChild={false}
                    className={cn(
                      "w-full justify-start text-base",
                      item.subItems.some(sub => pathname.startsWith(sub.href)) && "bg-sidebar-accent text-sidebar-accent-foreground"
                    )}
                    isActive={item.subItems.some(sub => pathname.startsWith(sub.href))}
                    tooltip={{ children: item.label, side:'right', align:'center' }}
                  >
                    <item.icon className="h-5 w-5" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
              </AccordionTrigger>
              <AccordionContent className="pb-0 pl-4 border-l border-sidebar-border ml-[18px]">
                <SidebarMenuSub className="border-none p-0 m-0">
                  {item.subItems.map((subItem) => (
                    <SidebarMenuSubItem key={subItem.href}>
                      <Link href={subItem.href} passHref legacyBehavior>
                        <SidebarMenuSubButton
                          className={cn(
                            "w-full justify-start text-sm",
                            pathname === subItem.href && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
                          )}
                          isActive={pathname === subItem.href}
                        >
                          <subItem.icon className="h-4 w-4 mr-2" />
                          {subItem.label}
                        </SidebarMenuSubButton>
                      </Link>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </AccordionContent>
            </AccordionItem>
          ) : (
            <SidebarMenuItem key={item.href}>
              <Link href={item.href} passHref legacyBehavior>
                <SidebarMenuButton
                  className={cn(
                    "w-full justify-start text-base",
                     pathname === item.href && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
                  )}
                  isActive={pathname === item.href}
                  tooltip={{ children: item.label, side:'right', align:'center' }}
                >
                  <item.icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          )
        )}
      </Accordion>
    </nav>
  );
}
