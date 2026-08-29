'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Printer, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { apiRequest, ApiClientError } from '@/lib/client/api-client';
import type { PublicCertificateDto } from '@/contracts/certificates';
import { FetchErrorState } from '@/components/prototype/shared/AsyncStates';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// --- Display helpers ----------------------------------------------------------

const VERIFY_BASE_PATH = '/api/v1/certificates';

const ISSUE_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "2026-08-29T10:00:00.000Z" -> "29 Aug 2026" (date-only, house convention). */
function formatIssueDate(iso: string): string {
  return ISSUE_DATE_FORMAT.format(new Date(iso));
}

// --- Skeleton -------------------------------------------------------------------

/** Mirrors the verification card so the layout keeps its height while loading. */
function VerifyCardSkeleton() {
  return (
    <Card className='w-full max-w-lg'>
      <Skeleton className='h-12 w-full rounded-b-none' />
      <CardContent className='p-6 sm:p-8 flex flex-col items-center gap-4'>
        <Skeleton className='size-16 rounded-full' />
        <Skeleton className='h-5 w-48' />
        <Skeleton className='h-8 w-56' />
        <Skeleton className='h-4 w-64' />
        <Skeleton className='h-4 w-40' />
        <Skeleton className='h-8 w-44 rounded-md' />
        <Skeleton className='h-9 w-40' />
      </CardContent>
    </Card>
  );
}

// --- Page -----------------------------------------------------------------------

interface VerifyError {
  message: string;
  /** Unknown code (404 CERTIFICATE_NOT_FOUND) or malformed code (422). */
  notFound: boolean;
}

/**
 * Public certificate verification: anyone holding a code (e.g. an employer)
 * can confirm authenticity. Deliberately no download button here — the PDF
 * endpoint requires the learner's own session.
 */
export default function CertificateVerifyPage() {
  // Route param is [code].
  const params = useParams<{ code: string }>();
  const code = params.code ?? '';

  const [payload, setPayload] = useState<PublicCertificateDto | null>(null);
  const [error, setError] = useState<VerifyError | null>(null);
  const [retrySeed, setRetrySeed] = useState(0);

  // Loading is DERIVED from the request key (house pattern): the effect only
  // writes state inside async callbacks, never synchronously.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const requestKey = `${code}#${retrySeed}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    apiRequest<PublicCertificateDto>(`${VERIFY_BASE_PATH}/${encodeURIComponent(code)}`)
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setError(null);
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPayload(null);
        setError({
          message: err instanceof Error ? err.message : 'Verification failed. Please try again.',
          notFound:
            err instanceof ApiClientError &&
            (err.status === 404 || err.status === 422),
        });
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [code, requestKey]);

  const revoked = payload?.status === 'REVOKED';

  return (
    <div className='flex-1 w-full flex items-center justify-center px-4 py-12 sm:py-16'>
      {loading ? (
        <VerifyCardSkeleton />
      ) : error ? (
        error.notFound ? (
          /* Unknown or malformed code — honest, no hints about the code format. */
          <div className='text-center py-16 max-w-md'>
            <div className='size-16 mx-auto rounded-full bg-destructive/10 flex items-center justify-center mb-4'>
              <ShieldX className='size-7 text-destructive' aria-hidden />
            </div>
            <h1 className='font-semibold text-xl mb-1'>No certificate matches this code</h1>
            <p className='text-sm text-muted-foreground mb-4'>
              Double-check the verification code with the issuer, then try again.
            </p>
            <Button variant='outline' className='gap-1.5' onClick={() => setRetrySeed((s) => s + 1)}>
              Try Again
            </Button>
          </div>
        ) : (
          /* Any other failure (network/server) — generic retry. */
          <FetchErrorState
            title="Couldn't verify this certificate"
            message={error.message}
            onRetry={() => setRetrySeed((s) => s + 1)}
          />
        )
      ) : payload ? (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className='w-full max-w-lg'
        >
          <Card className='overflow-hidden'>
            {/* Issuing brand */}
            <div className='bg-gradient-to-br from-primary to-[#0a1a3e] px-6 py-4 text-center'>
              <p className='text-sm font-semibold text-white tracking-wide'>{payload.brandName}</p>
            </div>

            <CardContent className='p-6 sm:p-8 text-center space-y-5'>
              {/* Status-driven headline */}
              <div className='flex flex-col items-center gap-3'>
                <div
                  className={cn(
                    'size-16 rounded-full flex items-center justify-center',
                    revoked ? 'bg-amber-500/10' : 'bg-emerald-500/10',
                  )}
                >
                  {revoked ? (
                    <ShieldAlert className='size-8 text-amber-600' aria-hidden />
                  ) : (
                    <ShieldCheck className='size-8 text-emerald-600' aria-hidden />
                  )}
                </div>
                <div className='flex items-center justify-center gap-2'>
                  <h1 className={cn('text-xl font-bold', revoked ? 'text-amber-600' : 'text-emerald-600')}>
                    {revoked ? 'Certificate Revoked' : 'Certificate Verified'}
                  </h1>
                  <Badge variant={revoked ? 'destructive' : 'default'}>{revoked ? 'Revoked' : 'Active'}</Badge>
                </div>
                {revoked && (
                  <p className='text-sm text-muted-foreground max-w-sm'>
                    This certificate has been revoked by {payload.brandName} and is no longer valid.
                  </p>
                )}
              </div>

              {/* Learner + course */}
              <div>
                <p className='text-xs font-medium uppercase tracking-wider text-muted-foreground'>Awarded to</p>
                <p className='text-2xl font-semibold mt-1'>{payload.learnerName}</p>
                <p className='text-sm text-muted-foreground mt-1.5'>
                  for completing <span className='font-medium text-foreground'>{payload.courseTitle}</span>
                </p>
              </div>

              {/* Code + issue date */}
              <div className='space-y-2'>
                <p className='text-xs font-medium uppercase tracking-wider text-muted-foreground'>
                  Issued {formatIssueDate(payload.issuedAt)}
                </p>
                <code className='inline-block rounded bg-muted px-3 py-1.5 font-mono text-sm tracking-wider'>
                  {payload.code}
                </code>
              </div>

              <Separator />

              {/* How verification works */}
              <p className='text-xs leading-relaxed text-muted-foreground'>
                <span className='font-medium text-foreground'>How verification works:</span> anyone holding this code
                can confirm the certificate&apos;s authenticity. This page carries no personal data beyond the
                learner&apos;s display name.
              </p>

              <Button variant='secondary' className='gap-1.5' onClick={() => window.print()}>
                <Printer className='size-4' aria-hidden />
                Print this page
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : null}
    </div>
  );
}
