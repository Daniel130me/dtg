'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  BookOpen,
  CheckCircle2,
  Award,
  Clock,
  Bell,
  ArrowRight,
  PlayCircle,
  Megaphone,
  ClipboardCheck,
  AlertCircle,
  Info,
} from 'lucide-react';
import { useNav } from '@/lib/prototype/navigation';
import { currentUser, enrolments, notifications, certificates } from '@/lib/prototype/mock-data';
import StudentLayout from '@/components/prototype/layout/StudentLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

const notifIcon: Record<string, React.ReactNode> = {
  announcement: <Megaphone className="size-4 text-primary" />,
  grade: <ClipboardCheck className="size-4 text-emerald-500" />,
  enrollment: <BookOpen className="size-4 text-amber-500" />,
  reminder: <AlertCircle className="size-4 text-orange-500" />,
  system: <Info className="size-4 text-slate-400" />,
};

export default function StudentDashboard() {
  const { navigate } = useNav();

  const activeEnrolments = enrolments.filter((e) => e.status === 'active');
  const completedEnrolments = enrolments.filter((e) => e.status === 'completed');
  const totalHoursLearned = 87;

  const stats = [
    {
      label: 'Active Courses',
      value: activeEnrolments.length,
      icon: <BookOpen className="size-5" />,
      color: 'bg-primary/10 text-primary',
    },
    {
      label: 'Completed',
      value: completedEnrolments.length,
      icon: <CheckCircle2 className="size-5" />,
      color: 'bg-emerald-500/10 text-emerald-600',
    },
    {
      label: 'Certificates',
      value: certificates.length,
      icon: <Award className="size-5" />,
      color: 'bg-amber-500/10 text-amber-600',
    },
    {
      label: 'Hours Learned',
      value: totalHoursLearned,
      icon: <Clock className="size-5" />,
      color: 'bg-rose-500/10 text-rose-500',
    },
  ];

  const recentNotifications = notifications.slice(0, 4);

  const firstName = currentUser.name.split(' ')[0];

  return (
    <StudentLayout>
      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Welcome Banner */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-teal-600 to-emerald-700 p-6 sm:p-8 text-white"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-40 h-40 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
          <div className="relative z-10">
            <p className="text-sm font-medium text-white/80">Welcome back,</p>
            <h1 className="text-2xl sm:text-3xl font-bold mt-1">{firstName} 👋</h1>
            <p className="text-white/80 mt-2 max-w-lg text-sm sm:text-base">
              You&apos;re making great progress! Continue where you left off or explore new courses.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                variant="secondary"
                className="bg-white/20 hover:bg-white/30 text-white border-0"
                onClick={() => navigate('my-learning')}
              >
                Continue Learning
                <ArrowRight className="size-4 ml-1.5" />
              </Button>
              <Button
                variant="outline"
                className="border-white/30 text-white hover:bg-white/10"
                onClick={() => navigate('courses')}
              >
                Browse Courses
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Stats Cards */}
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 lg:grid-cols-4 gap-4"
        >
          {stats.map((stat) => (
            <motion.div key={stat.label} variants={item}>
              <Card className="p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                    <p className="text-2xl font-bold mt-1">{stat.value}</p>
                  </div>
                  <div className={`size-10 rounded-xl flex items-center justify-center ${stat.color}`}>
                    {stat.icon}
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>

        {/* Continue Learning + Notifications */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Continue Learning */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.35 }}
            className="lg:col-span-2"
          >
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold flex items-center gap-2">
                    <PlayCircle className="size-5 text-primary" />
                    Continue Learning
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground"
                    onClick={() => navigate('my-learning')}
                  >
                    View All
                    <ArrowRight className="size-3.5 ml-1" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {activeEnrolments.length === 0 ? (
                  <div className="text-center py-8">
                    <BookOpen className="size-10 text-muted-foreground/50 mx-auto" />
                    <p className="text-sm text-muted-foreground mt-2">No active courses</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => navigate('courses')}
                    >
                      Browse Courses
                    </Button>
                  </div>
                ) : (
                  activeEnrolments.map((enrolment) => (
                    <div
                      key={enrolment.id}
                      className="flex items-center gap-4 p-3 rounded-xl hover:bg-muted/50 transition-colors group"
                    >
                      <div className="size-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <BookOpen className="size-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {enrolment.courseName}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <Progress value={enrolment.progress} className="h-1.5 flex-1" />
                          <span className="text-xs font-medium text-muted-foreground shrink-0">
                            {enrolment.progress}%
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {enrolment.currentLessonTitle}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() =>
                          navigate('learning-player', {
                            courseId: enrolment.courseId,
                            lessonId: enrolment.currentLessonId || '',
                          })
                        }
                      >
                        Continue
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Recent Notifications */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.35 }}
          >
            <Card className="h-full">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold flex items-center gap-2">
                    <Bell className="size-5 text-primary" />
                    Notifications
                  </CardTitle>
                  <Badge variant="secondary" className="text-xs">
                    {notifications.filter((n) => !n.isRead).length} new
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recentNotifications.map((notif, idx) => (
                    <React.Fragment key={notif.id}>
                      <div className="flex gap-3">
                        <div className="size-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                          {notifIcon[notif.type] || <Info className="size-4 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium leading-tight">{notif.title}</p>
                            {!notif.isRead && (
                              <span className="size-2 rounded-full bg-primary shrink-0 mt-1.5" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {notif.message}
                          </p>
                          <p className="text-xs text-muted-foreground/60 mt-1">{notif.createdAt}</p>
                        </div>
                      </div>
                      {idx < recentNotifications.length - 1 && <Separator />}
                    </React.Fragment>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </StudentLayout>
  );
}
