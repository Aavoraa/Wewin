import { Link } from 'react-router';
import { useAuth } from '@/lib/auth';
import { NAV } from '@/nav';
import { PageHeader } from '@/components/states';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Management dashboard. Database-backed widgets are added with their modules (A§11 / Step 12);
 * until then it only offers navigation — no placeholder metrics.
 */
export function DashboardPage() {
  const { user, can } = useAuth();
  const links = NAV.flatMap((g) => g.items).filter((i) => i.to !== '/' && can(i.perm));
  return (
    <div>
      <PageHeader title={`Welcome, ${user?.fullName ?? ''}`} description="Wewin Knit Fashions — ERP" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {links.map((l) => (
          <Link key={l.to} to={l.to}>
            <Card className="transition-colors hover:border-primary/40 hover:bg-accent/40">
              <CardContent className="flex items-center gap-3">
                <l.icon className="size-5 text-primary" />
                <span className="text-sm font-medium">{l.label}</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
