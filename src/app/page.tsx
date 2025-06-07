'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, CheckCircle, Package, Warehouse, Users, TrendingUpIcon } from 'lucide-react';
import { mockItems, mockServedUnits, mockStockConfigs } from '@/data/mockData';
import type { Item, ServedUnit, StockItemConfig } from '@/types';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function DashboardPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);
  const [stockConfigs, setStockConfigs] = useState<StockItemConfig[]>([]);
  const [alerts, setAlerts] = useState<StockItemConfig[]>([]);

  useEffect(() => {
    // Simulate data fetching
    setItems(mockItems);
    setServedUnits(mockServedUnits);
    setStockConfigs(mockStockConfigs);
  }, []);

  useEffect(() => {
    const currentAlerts = stockConfigs.filter(config => {
      const itemInCentral = items.find(i => i.id === config.itemId);
      const currentQty = config.unitId ? config.currentQuantity : itemInCentral?.currentQuantityCentral;
      return typeof currentQty === 'number' && currentQty < config.strategicStockLevel;
    });
    setAlerts(currentAlerts);
  }, [items, stockConfigs]);

  const summaryStats = [
    { title: 'Total Items', value: items.length, icon: Package, color: 'text-blue-500', href: '/items' },
    { title: 'Served Units', value: servedUnits.length, icon: Users, color: 'text-green-500', href: '/served-units' },
    { title: 'Stock Alerts', value: alerts.length, icon: AlertTriangle, color: alerts.length > 0 ? 'text-red-500' : 'text-green-500', href: '#alerts' },
  ];

  return (
    <div className="container mx-auto py-2">
      <PageHeader title="Dashboard" description="Overview of your stock management system." icon={HomeIcon} />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-8">
        {summaryStats.map((stat) => (
          <Card key={stat.title} className="shadow-lg hover:shadow-xl transition-shadow duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium font-body">{stat.title}</CardTitle>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold font-headline">{stat.value}</div>
              <Link href={stat.href || '#'} className="text-xs text-muted-foreground hover:text-primary transition-colors">
                View details
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
      
      <div className="grid gap-8 md:grid-cols-2">
        <Card id="alerts" className="shadow-lg">
          <CardHeader>
            <CardTitle className="font-headline flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              Strategic Stock Alerts
            </CardTitle>
            <CardDescription>Items that have reached or fallen below their strategic stock levels.</CardDescription>
          </CardHeader>
          <CardContent>
            {alerts.length > 0 ? (
              <ul className="space-y-3">
                {alerts.map((alert) => {
                  const item = items.find(i => i.id === alert.itemId);
                  const currentQty = alert.unitId ? alert.currentQuantity : item?.currentQuantityCentral;
                  return (
                    <li key={alert.id} className="flex items-center justify-between p-3 bg-destructive/10 rounded-md">
                      <div>
                        <p className="font-semibold">{alert.itemName || item?.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {alert.unitName || 'Central Warehouse'}: Current {currentQty}, Strategic {alert.strategicStockLevel}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <Link href="/stock/movements">Reorder</Link>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
                <p className="font-semibold">All stock levels are optimal.</p>
                <p className="text-sm text-muted-foreground">No items are currently below strategic levels.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="font-headline flex items-center gap-2">
              <TrendingUpIcon className="h-6 w-6 text-primary" />
              Quick Actions
            </CardTitle>
             <CardDescription>Access common tasks quickly.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Button asChild variant="outline" className="w-full justify-center py-6 text-base">
              <Link href="/items/add"><Package className="mr-2 h-5 w-5" />Add New Item</Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-center py-6 text-base">
              <Link href="/stock/movements"><Warehouse className="mr-2 h-5 w-5" />Record Stock Movement</Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-center py-6 text-base">
              <Link href="/served-units/add"><Users className="mr-2 h-5 w-5" />Register Served Unit</Link>
            </Button>
             <Button asChild variant="outline" className="w-full justify-center py-6 text-base">
              <Link href="/trends"><TrendingUpIcon className="mr-2 h-5 w-5" />Analyze Trends</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function HomeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}
