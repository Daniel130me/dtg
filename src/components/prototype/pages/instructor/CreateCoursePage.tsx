'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  Upload,
  Plus,
  GripVertical,
  Video,
  FileText,
  HelpCircle,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  Eye,
  Rocket,
  ImageIcon,
  Link,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import InstructorLayout from './InstructorLayout';
import { categories } from '@/lib/prototype/mock-data';

const lessonTypeIcons: Record<string, React.ReactNode> = {
  video: <Video className="size-4" />,
  text: <FileText className="size-4" />,
  quiz: <HelpCircle className="size-4" />,
  assignment: <ClipboardList className="size-4" />,
};

const mockSection = {
  title: 'Getting Started',
  lessons: [
    { id: 'ml-1', title: 'Introduction to the Course', type: 'video', duration: '12:30' },
    { id: 'ml-2', title: 'Course Overview & Objectives', type: 'text', duration: '8 min read' },
    { id: 'ml-3', title: 'Setting Up Your Environment', type: 'video', duration: '18:00' },
    { id: 'ml-4', title: 'Knowledge Check', type: 'quiz', duration: '10 min' },
  ],
};

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

export default function CreateCoursePage() {
  const [sectionOpen, setSectionOpen] = React.useState(true);

  return (
    <InstructorLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <motion.div variants={container} initial="hidden" animate="show" className="max-w-3xl mx-auto space-y-6">
          {/* Header */}
          <motion.div variants={item}>
            <h1 className="text-2xl sm:text-3xl font-bold">Create New Course</h1>
            <p className="text-muted-foreground mt-1">
              Fill in the details below to create your new course.
            </p>
          </motion.div>

          {/* 1. Basic Info */}
          <motion.div variants={item}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">1. Basic Information</CardTitle>
                <CardDescription>Add the core details about your course.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Course Title</Label>
                  <Input id="title" placeholder="e.g., Complete Next.js 15 Masterclass" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Describe what students will learn in this course..."
                    rows={4}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Level</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Select level" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="beginner">Beginner</SelectItem>
                        <SelectItem value="intermediate">Intermediate</SelectItem>
                        <SelectItem value="advanced">Advanced</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="language">Language</Label>
                    <Input id="language" placeholder="e.g., English" defaultValue="English" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* 2. Course Media */}
          <motion.div variants={item}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">2. Course Media</CardTitle>
                <CardDescription>Add a thumbnail and promotional video for your course.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Course Thumbnail</Label>
                  <div className="border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div className="p-3 rounded-full bg-muted mb-3">
                      <ImageIcon className="size-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">Click to upload or drag and drop</p>
                    <p className="text-xs text-muted-foreground mt-1">PNG, JPG or WebP (recommended: 1280×720)</p>
                  </div>
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label htmlFor="promo-video">Promo Video Link</Label>
                  <div className="relative">
                    <Link className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input id="promo-video" placeholder="https://youtube.com/watch?v=..." className="pl-9" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* 3. Curriculum */}
          <motion.div variants={item}>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">3. Curriculum</CardTitle>
                    <CardDescription>Organize your course into sections and lessons.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Mock Section */}
                <div className="border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setSectionOpen(!sectionOpen)}
                    className="w-full flex items-center gap-3 p-3 bg-muted/50 hover:bg-muted transition-colors text-left"
                  >
                    <GripVertical className="size-4 text-muted-foreground shrink-0" />
                    {sectionOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                    <span className="font-medium text-sm flex-1">{mockSection.title}</span>
                    <Badge variant="secondary" className="text-xs">{mockSection.lessons.length} lessons</Badge>
                  </button>
                  {sectionOpen && (
                    <div className="divide-y">
                      {mockSection.lessons.map((lesson) => (
                        <div key={lesson.id} className="flex items-center gap-3 px-3 py-2.5 pl-12 group hover:bg-muted/30 transition-colors">
                          <div className="text-muted-foreground">
                            {lessonTypeIcons[lesson.type] || <FileText className="size-4" />}
                          </div>
                          <span className="text-sm flex-1">{lesson.title}</span>
                          <span className="text-xs text-muted-foreground">{lesson.duration}</span>
                          <Button variant="ghost" size="icon" className="size-7 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Trash2 className="size-3.5 text-muted-foreground" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add Section Button */}
                <Button
                  variant="outline"
                  className="w-full border-dashed"
                >
                  <Plus className="size-4 mr-2" />
                  Add Section
                </Button>
              </CardContent>
            </Card>
          </motion.div>

          {/* 4. Pricing */}
          <motion.div variants={item}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">4. Pricing</CardTitle>
                <CardDescription>Set the price for your course or offer it for free.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="space-y-2 flex-1">
                    <Label htmlFor="price">Price (USD)</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                      <Input id="price" type="number" placeholder="49.99" className="pl-7" />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Checkbox id="free-course" />
                  <Label htmlFor="free-course" className="text-sm font-normal cursor-pointer">
                    This is a free course
                  </Label>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* 5. Publish */}
          <motion.div variants={item}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">5. Publish</CardTitle>
                <CardDescription>Review your course and publish it when ready.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button variant="outline" className="gap-2">
                    <Eye className="size-4" />
                    Preview
                  </Button>
                  <Button className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
                    <Rocket className="size-4" />
                    Publish Course
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Bottom spacing */}
          <div className="h-8" />
        </motion.div>
      </div>
    </InstructorLayout>
  );
}
