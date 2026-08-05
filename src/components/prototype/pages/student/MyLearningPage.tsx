'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  CheckCircle2,
  Award,
  Clock,
  PlayCircle,
  ArrowRight,
  CircleDot,
} from 'lucide-react';
import { useNav } from '@/lib/prototype/navigation';
import { enrolments, certificates, courses } from '@/lib/prototype/mock-data';
import StudentLayout from '@/components/prototype/layout/StudentLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const categoryGradients: Record<string, string> = {
  'Web Development': 'from-teal-500 to-emerald-600',
  'Data Science': 'from-amber-500 to-orange-600',
  'Mobile Development': 'from-violet-500 to-purple-600',
  'DevOps & Cloud': 'from-slate-500 to-slate-700',
  'Design & UI/UX': 'from-pink-500 to-rose-600',
};

export default function MyLearningPage() {
  const { navigate } = useNav();

  const inProgress = enrolments.filter((e) => e.status === 'active');
  const completed = enrolments.filter((e) => e.status === 'completed');

  // Map completed courses to their certificate if exists
  const certMap = new Map(certificates.map((c) => [c.courseId, c]));

  return (
    <StudentLayout>
      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-bold">My Learning</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Track your enrolled courses and progress
          </p>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="in-progress" className="w-full">
          <TabsList>
            <TabsTrigger value="in-progress" className="gap-1.5">
              <CircleDot className="size-3.5" />
              In Progress
              {inProgress.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0 h-5">
                  {inProgress.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="completed" className="gap-1.5">
              <CheckCircle2 className="size-3.5" />
              Completed
              {completed.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0 h-5">
                  {completed.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="not-started" className="gap-1.5">
              <PlayCircle className="size-3.5" />
              Not Started
            </TabsTrigger>
          </TabsList>

          {/* In Progress Tab */}
          <TabsContent value="in-progress">
            <AnimatePresence mode="wait">
              <motion.div
                key="in-progress"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
              >
                {inProgress.length === 0 ? (
                  <EmptyState
                    icon={<CircleDot className="size-12" />}
                    title="No courses in progress"
                    description="Start learning by enrolling in a course!"
                    actionLabel="Browse Courses"
                    onAction={() => navigate('courses')}
                  />
                ) : (
                  <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 mt-2">
                    {inProgress.map((enrolment, idx) => {
                      const course = courses.find((c) => c.id === enrolment.courseId);
                      const gradient = course
                        ? categoryGradients[course.categoryName] || 'from-teal-500 to-emerald-600'
                        : 'from-teal-500 to-emerald-600';

                      return (
                        <motion.div
                          key={enrolment.id}
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05, duration: 0.3 }}
                        >
                          <Card className="overflow-hidden hover:shadow-lg transition-shadow group">
                            {/* Thumbnail Placeholder */}
                            <div className={`h-32 bg-gradient-to-br ${gradient} flex items-center justify-center relative`}>
                              <BookOpen className="size-10 text-white/40" />
                              <div className="absolute bottom-2 right-2">
                                <Badge className="bg-black/40 text-white border-0 text-xs">
                                  {course?.level || 'Intermediate'}
                                </Badge>
                              </div>
                            </div>
                            <CardContent className="p-4 space-y-3">
                              <div>
                                <h3 className="font-semibold text-sm line-clamp-2 leading-snug">
                                  {enrolment.courseName}
                                </h3>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {enrolment.currentLessonTitle}
                                </p>
                              </div>

                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">Progress</span>
                                  <span className="font-semibold text-primary">{enrolment.progress}%</span>
                                </div>
                                <Progress value={enrolment.progress} className="h-2" />
                              </div>

                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Clock className="size-3.5" />
                                  {course?.duration || '42 hours'}
                                </div>
                                <Button
                                  size="sm"
                                  className="h-8 text-xs"
                                  onClick={() =>
                                    navigate('learning-player', {
                                      courseId: enrolment.courseId,
                                      lessonId: enrolment.currentLessonId || '',
                                    })
                                  }
                                >
                                  Continue
                                  <ArrowRight className="size-3.5 ml-1" />
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </TabsContent>

          {/* Completed Tab */}
          <TabsContent value="completed">
            <AnimatePresence mode="wait">
              <motion.div
                key="completed"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
              >
                {completed.length === 0 ? (
                  <EmptyState
                    icon={<CheckCircle2 className="size-12" />}
                    title="No completed courses yet"
                    description="Keep going! You'll complete your first course soon."
                    actionLabel="Go to My Learning"
                    onAction={() => navigate('my-learning')}
                  />
                ) : (
                  <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 mt-2">
                    {completed.map((enrolment, idx) => {
                      const course = courses.find((c) => c.id === enrolment.courseId);
                      const cert = certMap.get(enrolment.courseId);
                      const gradient = course
                        ? categoryGradients[course.categoryName] || 'from-teal-500 to-emerald-600'
                        : 'from-teal-500 to-emerald-600';

                      return (
                        <motion.div
                          key={enrolment.id}
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05, duration: 0.3 }}
                        >
                          <Card className="overflow-hidden hover:shadow-lg transition-shadow">
                            <div className={`h-32 bg-gradient-to-br ${gradient} flex items-center justify-center relative`}>
                              <CheckCircle2 className="size-10 text-white/60" />
                              <div className="absolute top-2 right-2">
                                <Badge className="bg-emerald-500 text-white border-0 text-xs">
                                  Completed
                                </Badge>
                              </div>
                              {cert && (
                                <div className="absolute bottom-2 right-2">
                                  <Badge className="bg-amber-500 text-white border-0 text-xs gap-1">
                                    <Award className="size-3" />
                                    Certificate
                                  </Badge>
                                </div>
                              )}
                            </div>
                            <CardContent className="p-4 space-y-3">
                              <div>
                                <h3 className="font-semibold text-sm line-clamp-2 leading-snug">
                                  {enrolment.courseName}
                                </h3>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Completed on {enrolment.lastAccessed}
                                </p>
                              </div>

                              <Progress value={100} className="h-2" />

                              <div className="flex items-center gap-2">
                                {cert && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 text-xs flex-1"
                                    onClick={() => navigate('certificates')}
                                  >
                                    <Award className="size-3.5 mr-1" />
                                    View Certificate
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 text-xs"
                                  onClick={() =>
                                    navigate('learning-player', {
                                      courseId: enrolment.courseId,
                                    })
                                  }
                                >
                                  Review
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </TabsContent>

          {/* Not Started Tab */}
          <TabsContent value="not-started">
            <AnimatePresence mode="wait">
              <motion.div
                key="not-started"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
              >
                <EmptyState
                  icon={<PlayCircle className="size-12" />}
                  title="All caught up!"
                  description="You don't have any courses that haven't been started yet."
                  actionLabel="Browse Courses"
                  onAction={() => navigate('courses')}
                />
              </motion.div>
            </AnimatePresence>
          </TabsContent>
        </Tabs>
      </div>
    </StudentLayout>
  );
}

function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <Card className="mt-4">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="size-16 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground/50">
          {icon}
        </div>
        <h3 className="text-lg font-semibold mt-4">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-sm">{description}</p>
        <Button className="mt-4" onClick={onAction}>
          {actionLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
