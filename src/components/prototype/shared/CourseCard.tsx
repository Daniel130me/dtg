'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Clock, Users, Code, BarChart3, Smartphone, Cloud, Palette, BookOpen } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import StarRating from './StarRating';
import type { Course } from '@/lib/prototype/types';

interface CourseCardProps {
  course: Course;
  onCourseClick?: (courseId: string) => void;
}

const categoryIcons: Record<string, React.ReactNode> = {
  'Code': <Code className="size-12 text-white/80" />,
  'BarChart3': <BarChart3 className="size-12 text-white/80" />,
  'Smartphone': <Smartphone className="size-12 text-white/80" />,
  'Cloud': <Cloud className="size-12 text-white/80" />,
  'Palette': <Palette className="size-12 text-white/80" />,
};

const categoryGradients: Record<string, string> = {
  'Web Development': 'from-blue-600 to-blue-800',
  'Data Science': 'from-blue-600 to-blue-800',
  'Mobile Development': 'from-blue-500 to-sky-700',
  'DevOps & Cloud': 'from-blue-800 to-blue-950',
  'Design & UI/UX': 'from-blue-700 to-violet-600',
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

function getCategoryIcon(iconName: string, categoryName: string) {
  const icon = categoryIcons[iconName];
  if (icon) return icon;
  return <BookOpen className="size-12 text-white/80" />;
}

function getGradient(categoryName: string) {
  return categoryGradients[categoryName] || 'from-blue-600 to-blue-800';
}

function findCategoryIcon(categoryId: string, categories: { id: string; icon: string; name: string }[]): string {
  const cat = categories.find(c => c.id === categoryId);
  return cat?.icon || 'BookOpen';
}

export default function CourseCard({ course, onCourseClick }: CourseCardProps) {
  const gradient = getGradient(course.categoryName);
  const initials = getInitials(course.title);
  
  // We'll use the icon based on category name as fallback
  const iconMap: Record<string, string> = {
    'Web Development': 'Code',
    'Data Science': 'BarChart3',
    'Mobile Development': 'Smartphone',
    'DevOps & Cloud': 'Cloud',
    'Design & UI/UX': 'Palette',
  };
  const iconName = iconMap[course.categoryName] || 'BookOpen';

  return (
    <motion.div
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      whileTap={{ scale: 0.98 }}
    >
      <Card
        className="group cursor-pointer overflow-hidden p-0 gap-0 transition-shadow duration-300 hover:shadow-lg hover:shadow-primary/5"
        onClick={() => onCourseClick?.(course.id)}
      >
        {/* Thumbnail */}
        <div className={`relative h-44 bg-gradient-to-br ${gradient} flex items-center justify-center overflow-hidden`}>
          <div className="absolute inset-0 bg-black/10" />
          <div className="relative z-10 flex flex-col items-center gap-2">
            {getCategoryIcon(iconName, course.categoryName)}
            <span className="text-white/60 text-xs font-semibold tracking-wider uppercase">{initials}</span>
          </div>
          {/* Badges */}
          <div className="absolute top-3 left-3 flex gap-2 z-10">
            {course.badge === 'new' && (
              <Badge className="bg-amber-500 text-white border-amber-500 text-[10px] px-2 py-0.5">New</Badge>
            )}
            {course.badge === 'popular' && (
              <Badge className="bg-orange-500 text-white border-orange-500 text-[10px] px-2 py-0.5">Popular</Badge>
            )}
            {course.isFree && (
              <Badge className="bg-blue-500 text-white border-blue-500 text-[10px] px-2 py-0.5">Free</Badge>
            )}
          </div>
          <div className="absolute top-3 right-3 z-10">
            <Badge variant="secondary" className="bg-white/90 text-foreground text-[10px] backdrop-blur-sm">
              {course.level}
            </Badge>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col gap-3">
          <p className="text-xs font-medium text-primary uppercase tracking-wide">{course.categoryName}</p>
          <h3 className="font-semibold text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors">
            {course.title}
          </h3>
          <p className="text-muted-foreground text-xs leading-relaxed line-clamp-2">{course.shortDescription}</p>

          <div className="flex items-center gap-2">
            <div className="size-7 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-primary text-[10px] font-bold">{course.instructor.name.split(' ').map(n => n[0]).join('')}</span>
            </div>
            <span className="text-xs text-muted-foreground">{course.instructor.name}</span>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="size-3.5" />
              <span>{course.duration}</span>
            </div>
            <div className="flex items-center gap-1">
              <Users className="size-3.5" />
              <span>{course.studentsEnrolled.toLocaleString()}</span>
            </div>
          </div>

          <div className="pt-1 border-t flex items-center justify-between">
            <StarRating rating={course.rating} size="sm" showCount count={course.reviewCount} />
            <div className="font-bold text-primary">
              {course.isFree ? (
                <span className="text-blue-600 font-bold">Free</span>
              ) : (
                <span>${course.price}</span>
              )}
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}