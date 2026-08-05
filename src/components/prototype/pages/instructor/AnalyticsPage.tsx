'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  BookOpen,
  DollarSign,
  Star,
  TrendingUp,
  Clock,
  Eye,
  Trophy,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import InstructorLayout from './InstructorLayout';
import { analyticsData } from '@/lib/prototype/mock-data';

const overviewStats = [
  { label: 'Total Students', value: analyticsData.totalStudents.toLocaleString(), icon: <Users className="size-5" />, iconBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  { label: 'Total Enrollments', value: analyticsData.totalEnrollments.toLocaleString(), icon: <BookOpen className="size-5" />, iconBg: 'bg-teal-500/10 text-teal-600 dark:text-teal-400' },
  { label: 'Total Revenue', value: `$${analyticsData.revenue.toLocaleString()}`, icon: <DollarSign className="size-5" />, iconBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  { label: 'Completion Rate', value: `${analyticsData.completionRate}%`, icon: <Trophy className="size-5" />, iconBg: 'bg-primary/10 text-primary' },
];

const engagementMetrics = [
  { label: 'Avg. Watch Time', value: '32 min', icon: <Clock className="size-4" /> },
  { label: 'Course Views', value: '45.2K', icon: <Eye className="size-4" /> },
  { label: 'Avg. Rating', value: '4.8/5.0', icon: <Star className="size-4" /> },
  { label: 'Growth Rate', value: '+18.3%', icon: <TrendingUp className="size-4" /> },
];

const completionData = [
  { name: 'Completed', value: analyticsData.completionRate, color: 'hsl(var(--primary))' },
  { name: 'In Progress', value: 100 - analyticsData.completionRate, color: 'hsl(var(--muted))' },
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

export default function AnalyticsPage() {
  return (
    <InstructorLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <motion.div variants={container} initial="hidden" animate="show" className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <motion.div variants={item}>
            <h1 className="text-2xl sm:text-3xl font-bold">Analytics</h1>
            <p className="text-muted-foreground mt-1">
              Track your courses performance and student engagement.
            </p>
          </motion.div>

          {/* Overview Stats */}
          <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {overviewStats.map((stat) => (
              <Card key={stat.label}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground font-medium">{stat.label}</p>
                      <p className="text-2xl font-bold mt-1">{stat.value}</p>
                    </div>
                    <div className={`p-2.5 rounded-lg ${stat.iconBg}`}>
                      {stat.icon}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </motion.div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Enrollment Area Chart */}
            <motion.div variants={item} className="xl:col-span-2">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold">Enrollment Growth</CardTitle>
                    <Badge variant="secondary" className="text-xs">Last 6 Months</Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={analyticsData.monthlyEnrollments}>
                        <defs>
                          <linearGradient id="enrollGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="month" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                        <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            fontSize: '12px',
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="count"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2.5}
                          fill="url(#enrollGradient)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Completion Rate Donut */}
            <motion.div variants={item}>
              <Card className="h-full">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">Completion Rate</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 flex flex-col items-center justify-center">
                  <div className="h-[220px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={completionData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={85}
                          paddingAngle={4}
                          dataKey="value"
                          startAngle={90}
                          endAngle={-270}
                        >
                          {completionData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            fontSize: '12px',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-center -mt-4">
                    <p className="text-3xl font-bold">{analyticsData.completionRate}%</p>
                    <p className="text-sm text-muted-foreground">Average Completion</p>
                  </div>
                  <div className="flex items-center gap-4 mt-4 text-sm">
                    <div className="flex items-center gap-1.5">
                      <div className="size-3 rounded-full bg-primary" />
                      <span className="text-muted-foreground">Completed</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="size-3 rounded-full bg-muted" />
                      <span className="text-muted-foreground">In Progress</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Revenue Bar Chart */}
          <motion.div variants={item}>
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold">Course Revenue</CardTitle>
                  <Badge variant="secondary" className="text-xs">Top 3 Courses</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analyticsData.topCourses} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                      <XAxis type="number" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                      <YAxis type="category" dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} width={150} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                        formatter={(value: number) => [`$${value.toLocaleString()}`, 'Revenue']}
                      />
                      <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} barSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Bottom Row: Top Courses + Engagement */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Performing Courses */}
            <motion.div variants={item}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Top Performing Courses</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-4">
                    {analyticsData.coursePerformance.map((course, i) => (
                      <div key={course.name} className="flex items-center gap-4">
                        <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{course.name}</p>
                          <p className="text-xs text-muted-foreground">{course.enrollments.toLocaleString()} students</p>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="flex items-center gap-1 justify-end">
                            <Star className="size-3.5 fill-amber-400 text-amber-400" />
                            <span className="text-sm font-medium">{course.rating}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{course.completionRate}% completion</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Engagement Metrics */}
            <motion.div variants={item}>
              <Card className="h-full">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Engagement Metrics</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 gap-4">
                    {engagementMetrics.map((metric) => (
                      <div
                        key={metric.label}
                        className="flex flex-col items-center justify-center p-4 rounded-xl bg-muted/50"
                      >
                        <div className="p-2 rounded-lg bg-background mb-2">
                          {metric.icon}
                        </div>
                        <p className="text-lg font-bold">{metric.value}</p>
                        <p className="text-xs text-muted-foreground text-center mt-0.5">{metric.label}</p>
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
