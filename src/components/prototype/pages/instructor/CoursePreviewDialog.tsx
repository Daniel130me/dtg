'use client';

import React from 'react';
import { BookOpen, Clock3, GraduationCap } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { formatLevel } from '@/lib/client/format';

export interface PreviewSection {
  title: string;
  lessons: { title: string; durationMinutes?: string | number; isPreview?: boolean }[];
}

interface CoursePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  shortDescription: string;
  description: string;
  categoryName: string;
  level: string;
  language: string;
  sections: PreviewSection[];
}

export default function CoursePreviewDialog({
  open,
  onOpenChange,
  title,
  shortDescription,
  description,
  categoryName,
  level,
  language,
  sections,
}: CoursePreviewDialogProps) {
  const lessonCount = sections.reduce((total, section) => total + section.lessons.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title.trim() || 'Untitled course'}</DialogTitle>
          <DialogDescription>This private preview shows how the course currently reads to students.</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <div className="rounded-xl bg-foreground p-5 text-background">
            <div className="flex flex-wrap items-center gap-2 text-xs text-background/70">
              <Badge variant="secondary">Draft preview</Badge>
              {categoryName && <span>{categoryName}</span>}
              {level && <span>{formatLevel(level)}</span>}
              {language && <span>{language}</span>}
            </div>
            <h2 className="mt-4 text-2xl font-semibold">{title.trim() || 'Untitled course'}</h2>
            <p className="mt-2 max-w-2xl text-background/80">
              {shortDescription.trim() || 'Add a short description to introduce this course.'}
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-[1fr_0.85fr]">
            <section className="space-y-3">
              <h3 className="text-lg font-semibold">About this course</h3>
              <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {description.trim() || 'Add a course description to tell students what they will learn.'}
              </p>
            </section>
            <section className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <GraduationCap className="size-4 text-primary" /> Course outline
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {sections.length} section{sections.length === 1 ? '' : 's'} · {lessonCount} lesson{lessonCount === 1 ? '' : 's'}
              </p>
            </section>
          </div>

          <section className="space-y-3">
            <h3 className="text-lg font-semibold">Curriculum</h3>
            {sections.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No lessons have been added yet.</p>
            ) : (
              sections.map((section, sectionIndex) => (
                <div key={`${section.title}-${sectionIndex}`} className="rounded-lg border p-4">
                  <h4 className="font-medium">{section.title.trim() || `Section ${sectionIndex + 1}`}</h4>
                  <div className="mt-3 divide-y">
                    {section.lessons.map((lesson, lessonIndex) => (
                      <div key={`${lesson.title}-${lessonIndex}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2 truncate">
                          <BookOpen className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{lesson.title.trim() || `Lesson ${lessonIndex + 1}`}</span>
                          {lesson.isPreview && <Badge variant="outline">Preview</Badge>}
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <Clock3 className="size-3" /> {lesson.durationMinutes || 0} min
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
