'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  Search,
  Eye,
  Pencil,
  Trash2,
  Star,
  MoreHorizontal,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import InstructorLayout from './InstructorLayout';
import { courses, categories } from '@/lib/prototype/mock-data';
import { useNav } from '@/lib/prototype/navigation';

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

export default function CourseManagement() {
  const { navigate } = useNav();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const filteredCourses = courses.filter((course) => {
    const matchesSearch = course.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || course.categoryId === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <InstructorLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <motion.div variants={container} initial="hidden" animate="show" className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <motion.div variants={item} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">Course Management</h1>
              <p className="text-muted-foreground mt-1">
                Manage your {courses.length} courses
              </p>
            </div>
            <Button
              onClick={() => navigate('create-course')}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Plus className="size-4 mr-2" />
              Create New Course
            </Button>
          </motion.div>

          {/* Filters */}
          <motion.div variants={item} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search courses..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant={categoryFilter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCategoryFilter('all')}
                className={categoryFilter === 'all' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''}
              >
                All
              </Button>
              {categories.map((cat) => (
                <Button
                  key={cat.id}
                  variant={categoryFilter === cat.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCategoryFilter(cat.id)}
                  className={categoryFilter === cat.id ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''}
                >
                  {cat.name}
                </Button>
              ))}
            </div>
          </motion.div>

          {/* Course Table */}
          <motion.div variants={item}>
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Title</TableHead>
                        <TableHead className="text-xs hidden md:table-cell">Category</TableHead>
                        <TableHead className="text-xs text-right hidden sm:table-cell">Students</TableHead>
                        <TableHead className="text-xs text-right hidden lg:table-cell">Rating</TableHead>
                        <TableHead className="text-xs text-center">Status</TableHead>
                        <TableHead className="text-xs text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCourses.map((course) => (
                        <TableRow key={course.id} className="group">
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="size-10 rounded-lg bg-gradient-to-br from-primary/20 to-[#0a1a3e]/20 flex items-center justify-center shrink-0">
                                <span className="text-xs font-bold text-primary">{course.totalSections}</span>
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate max-w-[240px]">{course.title}</p>
                                <p className="text-xs text-muted-foreground">{course.level} · {course.duration}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <Badge variant="secondary" className="text-xs whitespace-nowrap">
                              {course.categoryName}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium hidden sm:table-cell">
                            {course.studentsEnrolled.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right hidden lg:table-cell">
                            <div className="flex items-center justify-end gap-1">
                              <Star className="size-3.5 fill-amber-400 text-amber-400" />
                              <span className="text-sm font-medium">{course.rating}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              className={
                                course.isPublished
                                  ? 'bg-[#1d4ed8]/10 text-[#1d4ed8] dark:text-[#60a5fa] border-0'
                                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-0'
                              }
                            >
                              {course.isPublished ? 'Published' : 'Draft'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="size-8">
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem className="gap-2 cursor-pointer">
                                  <Eye className="size-4" /> View
                                </DropdownMenuItem>
                                <DropdownMenuItem className="gap-2 cursor-pointer">
                                  <Pencil className="size-4" /> Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem className="gap-2 cursor-pointer text-destructive focus:text-destructive">
                                  <Trash2 className="size-4" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredCourses.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-12">
                            <p className="text-muted-foreground">No courses found matching your search.</p>
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
