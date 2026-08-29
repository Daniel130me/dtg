'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Clock, Users, Code, BarChart3, Smartphone, Cloud, Palette, BookOpen } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import StarRating from './StarRating';
import { formatCount, formatDuration, formatLevel, formatPrice } from '@/lib/client/format';
import type { CourseBadge, CourseListItemDto } from '@/contracts/catalog';

interface CourseCardProps {
  course: CourseListItemDto;
}

/**
 * Gradient placeholder thumbnails keyed by category slug. Courses without a
 * real thumbnailUrl get these; unknown slugs fall back to the default navy
 * gradient and a generic book icon.
 */
const categoryGradients: Record<string, string> = {
  'web-development': 'from-[#1d4ed8] to-[#0a1a3e]',
  'data-science': 'from-[#2563eb] to-[#0f2847]',
  'mobile-development': 'from-[#3b82f6] to-[#1e3a8a]',
  'devops-and-cloud': 'from-[#0f2847] to-[#0a1a3e]',
  'design-and-ui-ux': 'from-[#4338ca] to-[#0a1a3e]',
};

const categoryIconNames: Record<string, string> = {
  'web-development': 'Code',
  'data-science': 'BarChart3',
  'mobile-development': 'Smartphone',
  'devops-and-cloud': 'Cloud',
  'design-and-ui-ux': 'Palette',
};

const DEFAULT_GRADIENT = 'from-[#1d4ed8] to-[#0a1a3e]';
const DEFAULT_ICON_NAME = 'BookOpen';

const iconNodes: Record<string, React.ReactNode> = {
  'Code': <Code className='size-12 text-white/80' />,
  'BarChart3': <BarChart3 className='size-12 text-white/80' />,
  'Smartphone': <Smartphone className='size-12 text-white/80' />,
  'Cloud': <Cloud className='size-12 text-white/80' />,
  'Palette': <Palette className='size-12 text-white/80' />,
  'BookOpen': <BookOpen className='size-12 text-white/80' />,
};

const badgeStyles: Record<CourseBadge & string, { label: string; className: string }> = {
  new: { label: 'New', className: 'bg-amber-500 text-white border-amber-500 text-[10px] px-2 py-0.5' },
  popular: { label: 'Popular', className: 'bg-orange-500 text-white border-orange-500 text-[10px] px-2 py-0.5' },
  free: { label: 'Free', className: 'bg-[#1d4ed8] text-white border-[#1d4ed8] text-[10px] px-2 py-0.5' },
};

function getInitials(title: string): string {
  return title
    .split(/\s+/)
    .filter((w) => !['for', 'and', 'with', 'the', 'to', 'in', 'of', 'a', 'an'].includes(w.toLowerCase()))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export default function CourseCard({ course }: CourseCardProps) {
  const gradient = categoryGradients[course.categorySlug] ?? DEFAULT_GRADIENT;
  const iconName = categoryIconNames[course.categorySlug] ?? DEFAULT_ICON_NAME;
  const initials = getInitials(course.title);
  const badge = course.badge ? badgeStyles[course.badge] : null;

  return (
    <motion.div
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      whileTap={{ scale: 0.98 }}
    >
      <Link
        href={`/courses/${course.slug}`}
        className='block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
      >
        <Card className='group h-full cursor-pointer overflow-hidden p-0 gap-0 transition-shadow duration-300 hover:shadow-lg hover:shadow-primary/5'>
          {/* Thumbnail */}
          <div className={`relative h-44 bg-gradient-to-br ${gradient} flex items-center justify-center overflow-hidden`}>
            {course.thumbnailUrl ? (
              <img
                src={course.thumbnailUrl}
                alt={course.title}
                className='absolute inset-0 size-full object-cover'
              />
            ) : (
              <>
                <div className='absolute inset-0 bg-black/10' />
                <div className='relative z-10 flex flex-col items-center gap-2'>
                  {iconNodes[iconName]}
                  <span className='text-white/60 text-xs font-semibold tracking-wider uppercase'>{initials}</span>
                </div>
              </>
            )}
            {/* Badges */}
            <div className='absolute top-3 left-3 flex gap-2 z-10'>
              {badge && (
                <Badge className={badge.className}>{badge.label}</Badge>
              )}
            </div>
            <div className='absolute top-3 right-3 z-10'>
              <Badge variant='secondary' className='bg-white/90 text-foreground text-[10px] backdrop-blur-sm'>
                {formatLevel(course.level)}
              </Badge>
            </div>
          </div>

          {/* Content */}
          <div className='p-4 flex flex-col gap-3'>
            <p className='text-xs font-medium text-primary uppercase tracking-wide'>{course.categoryName}</p>
            <h3 className='font-semibold text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors'>
              {course.title}
            </h3>
            <p className='text-muted-foreground text-xs leading-relaxed line-clamp-2'>{course.shortDescription}</p>

            <div className='flex items-center gap-3 text-xs text-muted-foreground'>
              <div className='flex items-center gap-1'>
                <Clock className='size-3.5' />
                <span>{formatDuration(course.totalMinutes)}</span>
              </div>
              <div className='flex items-center gap-1'>
                <Users className='size-3.5' />
                <span>{formatCount(course.enrollmentCount)}</span>
              </div>
            </div>

            <div className='pt-1 border-t flex items-center justify-between'>
              {/* ratingAverage is null until the first review lands — hide the stars then */}
              {course.ratingAverage !== null ? (
                <StarRating rating={course.ratingAverage} size='sm' showCount count={course.ratingCount} />
              ) : (
                <span className='text-xs text-muted-foreground'>No ratings yet</span>
              )}
              <div className={`font-bold text-sm ${course.isFree ? 'text-[#1d4ed8]' : 'text-primary'}`}>
                {formatPrice(course.priceMinor, course.currency)}
              </div>
            </div>
          </div>
        </Card>
      </Link>
    </motion.div>
  );
}
