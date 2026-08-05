'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Search,
  Eye,
  MessageSquare,
  Users,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import InstructorLayout from './InstructorLayout';

interface Student {
  id: string;
  name: string;
  email: string;
  coursesEnrolled: string[];
  lastActive: string;
  progress: number;
  avatar: string;
}

const mockStudents: Student[] = [
  { id: 's1', name: 'Sarah Okonkwo', email: 'sarah.okonkwo@email.com', coursesEnrolled: ['Next.js Masterclass', 'TypeScript Advanced'], lastActive: '2 hours ago', progress: 72, avatar: 'SO' },
  { id: 's2', name: 'Emeka Nwankwo', email: 'emekan@email.com', coursesEnrolled: ['Python Data Science'], lastActive: '3 hours ago', progress: 100, avatar: 'EN' },
  { id: 's3', name: 'Amina Bello', email: 'amina.b@email.com', coursesEnrolled: ['React Native', 'Node.js Backend'], lastActive: '5 hours ago', progress: 45, avatar: 'AB' },
  { id: 's4', name: 'Tunde Adeyemi', email: 'tunde.a@email.com', coursesEnrolled: ['Python Data Science', 'TypeScript Advanced'], lastActive: '6 hours ago', progress: 88, avatar: 'TA' },
  { id: 's5', name: 'Chioma Eze', email: 'chioma.eze@email.com', coursesEnrolled: ['UI/UX Design', 'Next.js Masterclass'], lastActive: '1 day ago', progress: 34, avatar: 'CE' },
  { id: 's6', name: 'Olusegun Bakare', email: 'segun.b@email.com', coursesEnrolled: ['Node.js Backend'], lastActive: '2 days ago', progress: 61, avatar: 'OB' },
  { id: 's7', name: 'Fatima Yusuf', email: 'fatima.y@email.com', coursesEnrolled: ['Python Data Science', 'React Native'], lastActive: '3 days ago', progress: 55, avatar: 'FY' },
  { id: 's8', name: 'Kwame Asante', email: 'kwame.a@email.com', coursesEnrolled: ['TypeScript Advanced'], lastActive: '1 week ago', progress: 22, avatar: 'KA' },
  { id: 's9', name: 'Nneka Okafor', email: 'nneka.o@email.com', coursesEnrolled: ['Next.js Masterclass'], lastActive: '4 days ago', progress: 91, avatar: 'NO' },
  { id: 's10', name: 'Ibrahim Musa', email: 'ibrahim.m@email.com', coursesEnrolled: ['React Native', 'UI/UX Design', 'Python Data Science'], lastActive: '5 hours ago', progress: 67, avatar: 'IM' },
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

function getProgressColor(progress: number) {
  if (progress >= 80) return '[&>div]:bg-emerald-500';
  if (progress >= 50) return '[&>div]:bg-primary';
  if (progress >= 25) return '[&>div]:bg-amber-500';
  return '[&>div]:bg-rose-500';
}

export default function StudentManagement() {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredStudents = mockStudents.filter((student) => {
    return (
      student.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      student.email.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <InstructorLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <motion.div variants={container} initial="hidden" animate="show" className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <motion.div variants={item} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">Student Management</h1>
              <p className="text-muted-foreground mt-1">
                {mockStudents.length} students enrolled across your courses
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="size-4" />
              <span>{mockStudents.length} Total</span>
            </div>
          </motion.div>

          {/* Search */}
          <motion.div variants={item}>
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </motion.div>

          {/* Student Table */}
          <motion.div variants={item}>
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Student Name</TableHead>
                        <TableHead className="text-xs hidden md:table-cell">Email</TableHead>
                        <TableHead className="text-xs hidden lg:table-cell">Courses Enrolled</TableHead>
                        <TableHead className="text-xs hidden sm:table-cell">Last Active</TableHead>
                        <TableHead className="text-xs">Progress</TableHead>
                        <TableHead className="text-xs text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredStudents.map((student) => (
                        <TableRow key={student.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="size-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                                {student.avatar}
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate">{student.name}</p>
                                <p className="text-xs text-muted-foreground md:hidden truncate max-w-[180px]">{student.email}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <span className="text-sm text-muted-foreground">{student.email}</span>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            <div className="flex flex-wrap gap-1">
                              {student.coursesEnrolled.slice(0, 2).map((course) => (
                                <Badge key={course} variant="secondary" className="text-xs font-normal">
                                  {course.length > 20 ? course.substring(0, 20) + '...' : course}
                                </Badge>
                              ))}
                              {student.coursesEnrolled.length > 2 && (
                                <Badge variant="secondary" className="text-xs font-normal">
                                  +{student.coursesEnrolled.length - 2}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <span className="text-sm text-muted-foreground whitespace-nowrap">{student.lastActive}</span>
                          </TableCell>
                          <TableCell>
                            <div className="min-w-[100px]">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-medium">{student.progress}%</span>
                              </div>
                              <Progress value={student.progress} className={`h-2 ${getProgressColor(student.progress)}`} />
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="size-8" title="View Profile">
                                <Eye className="size-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="size-8" title="Message">
                                <MessageSquare className="size-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredStudents.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-12">
                            <p className="text-muted-foreground">No students found matching your search.</p>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      </div>
    </InstructorLayout>
  );
}
