'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Award,
  BookOpen,
  Calendar,
  CalendarX,
  Copy,
  Download,
  Loader2,
  LogIn,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import StudentLayout from '@/components/prototype/layout/StudentLayout';
import { FetchErrorState } from '@/components/prototype/shared/AsyncStates';
import { ApiClientError } from '@/lib/client/api-client';
import {
  certificateDownloadUrl,
  certificateVerifyUrl,
  claimCertificate,
  fetchMyCertificates,
} from '@/features/learning/certificates-api';
import type { CertificateDto, CertificateStatusValue, MyCertificatesDto } from '@/contracts/certificates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

// --- Display helpers ----------------------------------------------------------

/** Status -> Badge mapping (Active/Revoked), mirroring MyLearningPage's enrolment map. */
const STATUS_BADGE: Record<CertificateStatusValue, { label: string; variant: 'default' | 'destructive' }> = {
  ACTIVE: { label: 'Active', variant: 'default' },
  REVOKED: { label: 'Revoked', variant: 'destructive' },
};

const ISSUE_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "2026-08-29T10:00:00.000Z" -> "29 Aug 2026" (date-only, house convention). */
function formatIssueDate(iso: string): string {
  return ISSUE_DATE_FORMAT.format(new Date(iso));
}

/** Skeleton count fills the md:grid-cols-2 grid twice while loading. */
const SKELETON_CARD_COUNT = 4;

// --- Skeletons ----------------------------------------------------------------

/** Mirrors a certificate card (gradient header + detail rows) so the grid keeps its height. */
function CertificateCardSkeleton() {
  return (
    <Card className='overflow-hidden'>
      <Skeleton className='h-32 w-full rounded-b-none' />
      <CardContent className='p-4 sm:p-6 space-y-4'>
        <div className='space-y-3'>
          <div className='flex items-center justify-between'>
            <Skeleton className='h-3.5 w-20' />
            <Skeleton className='h-4 w-24' />
          </div>
          <Separator />
          <div className='flex items-center justify-between'>
            <Skeleton className='h-3.5 w-24' />
            <Skeleton className='h-6 w-32' />
          </div>
        </div>
        <div className='flex gap-3 pt-2'>
          <Skeleton className='h-8 flex-1' />
          <Skeleton className='h-8 flex-1' />
        </div>
      </CardContent>
    </Card>
  );
}

// --- Claimable strip -----------------------------------------------------------

/**
 * Completed-but-unclaimed courses. The list scrolls at max-h-96 so a long
 * back-catalogue never pushes the certificate grid out of view.
 */
function ClaimableStrip({
  courses,
  claimingSlug,
  onClaim,
}: {
  courses: MyCertificatesDto['eligibleCourses'];
  claimingSlug: string | null;
  onClaim: (slug: string) => void;
}) {
  return (
    <Card>
      <CardHeader className='pb-3'>
        <CardTitle className='text-lg font-semibold flex items-center gap-2'>
          <span className='size-8 rounded-lg bg-amber-500/10 flex items-center justify-center'>
            <Award className='size-4 text-amber-600' />
          </span>
          Ready to claim
        </CardTitle>
        <p className='text-sm text-muted-foreground mt-1'>
          You completed these courses — claim your certificates.
        </p>
      </CardHeader>
      <CardContent className='pt-0'>
        <ul className='max-h-96 overflow-y-auto divide-y'>
          {courses.map((course) => (
            <li key={course.courseId} className='flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0'>
              <span className='text-sm font-medium line-clamp-2 min-w-0'>{course.title}</span>
              <Button
                size='sm'
                className='gap-1.5 shrink-0'
                onClick={() => onClaim(course.slug)}
                disabled={claimingSlug !== null}
              >
                {claimingSlug === course.slug ? (
                  <Loader2 className='size-3.5 animate-spin' aria-hidden />
                ) : (
                  <Award className='size-3.5' aria-hidden />
                )}
                Claim certificate
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// --- Certificate card -----------------------------------------------------------

/**
 * One issued certificate. The amber gradient header is kept from the prototype
 * design; the download is a plain authenticated GET (browser handles the PDF
 * attachment), and "Verify" deep-links to the public verification page.
 */
function CertificateCard({ certificate }: { certificate: CertificateDto }) {
  const badge = STATUS_BADGE[certificate.status];
  const revoked = certificate.status === 'REVOKED';

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(certificate.code);
      toast.success('Code copied');
    } catch {
      toast.error("Couldn't copy the code. Copy it manually instead.");
    }
  }

  return (
    <Card className='overflow-hidden'>
      {/* Certificate preview header (prototype design, kept) */}
      <div className='relative bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500 p-6 text-white'>
        <div className='absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2' />
        <div className='absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2' />
        <div className='relative z-10'>
          <div className='flex items-center gap-2 mb-3'>
            <div className='size-10 rounded-xl bg-white/20 flex items-center justify-center'>
              <Award className='size-5' aria-hidden />
            </div>
            <div>
              <p className='text-xs font-medium text-white/70'>Certificate of Completion</p>
              <p className='text-sm font-bold'>DTG Academy</p>
            </div>
          </div>
          <h3 className='text-lg sm:text-xl font-bold leading-snug line-clamp-2'>
            <Link
              href={`/courses/${certificate.courseSlug}`}
              className='outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded-sm hover:underline underline-offset-4'
            >
              {certificate.courseTitle}
            </Link>
          </h3>
        </div>
      </div>

      {/* Details */}
      <CardContent className='p-4 sm:p-6 space-y-4'>
        <div className='space-y-3'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Calendar className='size-4' aria-hidden />
              Issued
            </div>
            <span className='text-sm font-medium'>{formatIssueDate(certificate.issuedAt)}</span>
          </div>

          {revoked && (
            <>
              <Separator />
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                  <CalendarX className='size-4' aria-hidden />
                  Revoked
                </div>
                <span className='text-sm font-medium text-destructive'>
                  {certificate.revokedAt ? formatIssueDate(certificate.revokedAt) : '—'}
                </span>
              </div>
            </>
          )}

          <Separator />

          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              {revoked ? <ShieldAlert className='size-4' aria-hidden /> : <ShieldCheck className='size-4' aria-hidden />}
              Status
            </div>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>

          <Separator />

          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <ShieldCheck className='size-4' aria-hidden />
              Verification code
            </div>
            <div className='flex items-center gap-1.5'>
              <code className='text-xs bg-muted px-2 py-1 rounded font-mono'>{certificate.code}</code>
              <Button
                variant='ghost'
                size='icon'
                className='size-7 shrink-0'
                aria-label='Copy certificate code'
                onClick={handleCopyCode}
              >
                <Copy className='size-3.5' aria-hidden />
              </Button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className='flex gap-3 pt-2'>
          {revoked ? (
            /* The download endpoint refuses revoked certificates (422), so the
               action is disabled instead of navigating to an error page. */
            <Button className='flex-1 gap-2' size='sm' disabled title='Downloads are unavailable for revoked certificates'>
              <Download className='size-4' aria-hidden />
              Download PDF
            </Button>
          ) : (
            <Button className='flex-1 gap-2' size='sm' asChild>
              <a href={certificateDownloadUrl(certificate.id)} download>
                <Download className='size-4' aria-hidden />
                Download PDF
              </a>
            </Button>
          )}
          <Button variant='outline' className='flex-1 gap-2' size='sm' asChild>
            <Link href={certificateVerifyUrl(certificate.code)}>
              <ShieldCheck className='size-4' aria-hidden />
              Verify
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Page ---------------------------------------------------------------------

interface ListError {
  message: string;
  /** 401 gets its own "Session expired" panel with a sign-in link. */
  sessionExpired: boolean;
}

export default function CertificatesPage() {
  const [data, setData] = useState<MyCertificatesDto | null>(null);
  const [error, setError] = useState<ListError | null>(null);
  const [retrySeed, setRetrySeed] = useState(0);
  // Claim pending guard: the slug being claimed, or null when idle. Any
  // non-null value disables every claim button (duplicate-submit guard).
  const [claimingSlug, setClaimingSlug] = useState<string | null>(null);

  // Loading is DERIVED from the request key (see StudentDashboard/CoursesPage)
  // so effects never call setState synchronously; all state writes happen in
  // async callbacks.
  const [loadedKey, setLoadedKey] = useState<number | null>(null);
  const requestKey = retrySeed;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    fetchMyCertificates()
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setError(null);
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData(null);
        setError({
          message: err instanceof Error ? err.message : 'Failed to load your certificates.',
          sessionExpired: err instanceof ApiClientError && err.status === 401,
        });
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  /** Claim -> toast -> refetch the whole list (the claim may also clear eligibility). */
  async function handleClaim(slug: string) {
    if (claimingSlug !== null) return;
    setClaimingSlug(slug);
    try {
      await claimCertificate(slug);
      toast.success('Certificate issued');
      setClaimingSlug(null);
      setRetrySeed((s) => s + 1);
    } catch (err) {
      setClaimingSlug(null);
      toast.error(
        err instanceof ApiClientError ? err.message : 'Could not issue the certificate. Please try again.',
      );
    }
  }

  const certificates = data?.certificates ?? [];
  const eligibleCourses = data?.eligibleCourses ?? [];
  const isEmpty = !loading && !error && certificates.length === 0 && eligibleCourses.length === 0;

  return (
    <StudentLayout>
      <div className='max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6'>
        {/* Page header */}
        <div>
          <h1 className='text-2xl font-bold'>Certificates</h1>
          <p className='text-muted-foreground mt-1 text-sm'>
            Your earned certificates and credentials
          </p>
        </div>

        {loading ? (
          /* Skeleton grid mirrors the final certificate cards */
          <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
            {Array.from({ length: SKELETON_CARD_COUNT }).map((_, i) => (
              <CertificateCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          error.sessionExpired ? (
            /* 401 — the route guard redirects on hard navigation; this panel
               covers an expired session while the page is already open. */
            <div className='text-center py-16'>
              <div className='size-16 mx-auto rounded-full bg-amber-500/10 flex items-center justify-center mb-4'>
                <LogIn className='size-7 text-amber-600' />
              </div>
              <h2 className='font-semibold text-lg mb-1'>Session expired</h2>
              <p className='text-sm text-muted-foreground mb-4 max-w-sm mx-auto'>
                Your session has expired. Sign in again to see your certificates.
              </p>
              <Button asChild>
                <Link href='/login'>Sign in</Link>
              </Button>
            </div>
          ) : (
            <FetchErrorState
              title="Couldn't load your certificates"
              message={error.message}
              onRetry={() => setRetrySeed((s) => s + 1)}
            />
          )
        ) : isEmpty ? (
          /* Empty state — amber design kept from the prototype */
          <Card>
            <CardContent className='flex flex-col items-center justify-center py-20 text-center'>
              <div className='size-20 rounded-2xl bg-amber-500/10 flex items-center justify-center'>
                <Award className='size-10 text-amber-500/50' aria-hidden />
              </div>
              <h2 className='text-lg font-semibold mt-4'>No Certificates Yet</h2>
              <p className='text-sm text-muted-foreground mt-1.5 max-w-sm'>
                Complete a course to earn your first certificate. Keep learning and achieve your goals!
              </p>
              <Button className='mt-6' asChild>
                <Link href='/courses'>
                  <BookOpen className='size-4 mr-2' aria-hidden />
                  Browse Courses
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {eligibleCourses.length > 0 && (
              <section aria-label='Certificates ready to claim'>
                <ClaimableStrip courses={eligibleCourses} claimingSlug={claimingSlug} onClaim={handleClaim} />
              </section>
            )}

            {certificates.length > 0 && (
              <section aria-label='Issued certificates'>
                <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
                  {certificates.map((certificate, index) => (
                    <motion.div
                      key={certificate.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(index * 0.05, 0.4), duration: 0.35 }}
                    >
                      <CertificateCard certificate={certificate} />
                    </motion.div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </StudentLayout>
  );
}
