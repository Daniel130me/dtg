'use client';

import React from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StarRatingProps {
  rating: number;
  size?: 'sm' | 'md' | 'lg';
  showCount?: boolean;
  count?: number;
  className?: string;
}

const sizeMap = {
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-5',
};

const textSizeMap = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

export default function StarRating({ rating, size = 'md', showCount = false, count, className }: StarRatingProps) {
  const stars = [];
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.25 && rating - fullStars < 0.75;
  const hasRoundUp = rating - fullStars >= 0.75;
  const displayFull = hasRoundUp ? fullStars + 1 : fullStars;

  for (let i = 0; i < 5; i++) {
    if (i < displayFull) {
      stars.push(
        <Star
          key={i}
          className={cn(sizeMap[size], 'fill-amber-400 text-amber-400')}
        />
      );
    } else if (i === displayFull && hasHalf) {
      stars.push(
        <div key={i} className="relative">
          <Star className={cn(sizeMap[size], 'text-muted-foreground/30')} />
          <div className="absolute inset-0 overflow-hidden w-1/2">
            <Star className={cn(sizeMap[size], 'fill-amber-400 text-amber-400')} />
          </div>
        </div>
      );
    } else {
      stars.push(
        <Star
          key={i}
          className={cn(sizeMap[size], 'text-muted-foreground/30')}
        />
      );
    }
  }

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <div className="flex items-center gap-0.5">{stars}</div>
      {showCount && count !== undefined && (
        <span className={cn('text-muted-foreground font-medium', textSizeMap[size])}>
          ({count.toLocaleString()})
        </span>
      )}
    </div>
  );
}
