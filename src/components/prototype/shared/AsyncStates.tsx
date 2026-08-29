'use client';

import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Loading/error building blocks shared by the public catalog pages so every
 * surface degrades with the same visual language.
 */

/** Mirrors the CourseCard layout so the grid keeps its height while loading. */
export function CourseCardSkeleton() {
  return (
    <Card className='overflow-hidden p-0 gap-0'>
      <Skeleton className='h-44 w-full rounded-b-none' />
      <div className='p-4 flex flex-col gap-3'>
        <Skeleton className='h-3 w-20' />
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-4 w-2/3' />
        <Skeleton className='h-3 w-full' />
        <Skeleton className='h-3 w-4/5' />
        <div className='pt-1 border-t flex items-center justify-between'>
          <Skeleton className='h-3.5 w-24' />
          <Skeleton className='h-4 w-12' />
        </div>
      </div>
    </Card>
  );
}

interface FetchErrorStateProps {
  title?: string;
  message?: string;
  onRetry: () => void;
  className?: string;
}

/** Centered error panel with a retry action, used by every catalog fetch. */
export function FetchErrorState({ title = 'Something went wrong', message, onRetry, className }: FetchErrorStateProps) {
  return (
    <div className={cn('text-center py-16', className)}>
      <div className='size-16 mx-auto rounded-full bg-destructive/10 flex items-center justify-center mb-4'>
        <AlertCircle className='size-7 text-destructive' />
      </div>
      <h3 className='font-semibold text-lg mb-1'>{title}</h3>
      {message && (
        <p className='text-sm text-muted-foreground mb-4 max-w-sm mx-auto'>{message}</p>
      )}
      <Button variant='outline' onClick={onRetry} className='gap-1.5'>
        <RefreshCw className='size-4' /> Try Again
      </Button>
    </div>
  );
}
