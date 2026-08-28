import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="min-h-[50vh] grid place-items-center px-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-muted-foreground">The page may have moved or is no longer available.</p>
        <Button asChild><Link href="/">Return home</Link></Button>
      </div>
    </main>
  );
}
