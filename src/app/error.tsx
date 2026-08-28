'use client';

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Route rendering failed", { digest: error.digest });
  }, [error]);

  return (
    <main className="min-h-[50vh] grid place-items-center px-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-semibold">We couldn’t load this page</h1>
        <p className="text-muted-foreground">Please retry. If the problem continues, contact support.</p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
