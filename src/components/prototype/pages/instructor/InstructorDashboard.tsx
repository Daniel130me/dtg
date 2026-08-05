'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  BookOpen,
  DollarSign,
  Star,
  TrendingUp,
  UserPlus,
  MessageSquare,
  CheckCircle2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import InstructorLayout from './InstructorLayout';
import { analyticsData, instructor } from '@/lib/prototype/mock-data';

const statsCards = [
  {
    label: 'Total Students',
    value: '12,847',
    icon: <Users className="size-5" />,
    change: '+12.5%',
    color: 'bg-[#1d4ed8]/10 text-[#1d4ed8] dark:text-[#60a5fa]',
    iconBg: 'bg-[#1d4ed8]/10',
  },
  {
    label: 'Active Courses',
    value: '12',
    icon: <BookOpen className="size-5" />,
    change: '+2 this month',
    color: 'bg-[#1d4ed8]/10 text-[#1d4ed8] dark:text-[#60a5fa]',
    iconBg: 'bg-[#1d4ed8]/10',
  },
  {
    label: 'Total Revenue',
    value: '$487,650',
    icon: <DollarSign className="size-5" />,
    change: '+23.1%',
    color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    iconBg: 'bg-amber-500/10',
  },
  {
    label: 'Avg Rating',
    value: '4.8',
    icon: <Star className="size-5" />,
    change: '+0.2 this quarter',
    color: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    iconBg: 'bg-rose-500/10',
  },
];

const activityIcons: Record<string, React.ReactNode> = {
  Enrolled: <UserPlus className="size-4 text-[#1d4ed8]" />,
  Completed: <CheckCircle2 className="size-4 text-primary" />,
  'Submitted Assignment': <MessageSquare className="size-4 text-amber-500" />,
  'Left Review': <Star className="size-4 text-yellow-500" />,
};

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

export default function InstructorDashboard() {
  return (
    <InstructorLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <motion.div variants={container} initial="hidden" animate="show" className="max-w-7xl mx-auto space-y-6">
          {/* Welcome */}
          <motion.div variants={item}>
            <h1 className="text-2xl sm:text-3xl font-bold">Welcome back, {instructor.name.split(' ')[0]}!</h1>
            <p className="text-muted-foreground mt-1">
              Here's what's happening with your courses today.
            </p>
          </motion.div>

          {/* Stats Cards */}
          <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {statsCards.map((stat) => (
              <Card key={stat.label} className="relative overflow-hidden">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground font-medium">{stat.label}</p>
                      <p className="text-2xl font-bold mt-1">{stat.value}</p>
                    </div>
                    <div className={`p-2.5 rounded-lg ${stat.iconBg}`}>
                      <div className={stat.color.split(' ')[1]}>{stat.icon}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-3">
                    <TrendingUp className="size-3.5 text-[#1d4ed8]" />
                    <span className="text-xs font-medium text-[#1d4ed8] dark:text-[#60a5fa]">{stat.change}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </motion.div>

          {/* Charts Row */}
          <motion.div variants={item}>
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold">Enrollment Trends</CardTitle>
                  <Badge variant="secondary" className="text-xs">Last 6 Months</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={analyticsData.monthlyEnrollments}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                      <YAxis className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="count"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2.5}
                        dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 6, strokeWidth: 0 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Bottom Row: Table + Activity */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Course Performance Table */}
            <motion.div variants={item} className="xl:col-span-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Course Performance</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Course Name</TableHead>
                          <TableHead className="text-xs text-right">Enrollments</TableHead>
                          <TableHead className="text-xs text-right">Completion Rate</TableHead>
                          <TableHead className="text-xs text-right">Rating</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {analyticsData.coursePerformance.map((course) => (
                          <TableRow key={course.name}>
                            <TableCell className="font-medium text-sm">{course.name}</TableCell>
                            <TableCell className="text-right text-sm">{course.enrollments.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-sm">
                              <Badge variant="secondary" className="font-mono text-xs">
                                {course.completionRate}%
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Star className="size-3.5 fill-amber-400 text-amber-400" />
                                <span className="text-sm font-medium">{course.rating}</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Recent Activity */}
            <motion.div variants={item}>
              <Card className="h-full">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-4">
                    {analyticsData.recentActivity.map((activity, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className="mt-0.5 p-1.5 rounded-full bg-muted">
                          {activityIcons[activity.action] || <UserPlus className="size-4 text-muted-foreground" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">
                            <span className="font-medium">{activity.user}</span>{' '}
                            <span className="text-muted-foreground">{activity.action.toLowerCase()}</span>
                          </p>
                          {activity.course && (
                            <p className="text-xs text-muted-foreground mt-0.5">{activity.course}</p>
                          )}
                          <p className="text-xs text-muted-foreground/70 mt-0.5">{activity.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </InstructorLayout>
  );
}
