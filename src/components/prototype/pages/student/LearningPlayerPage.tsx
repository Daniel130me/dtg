'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Circle,
  Play,
  FileText,
  HelpCircle,
  MessageSquare,
  Download,
  File,
  Archive,
  ExternalLink,
  Settings,
  List,
  X,
  Send,
  Video,
  PenTool,
  ChevronDown,
  Clock,
} from 'lucide-react';
import { useNav } from '@/lib/prototype/navigation';
import { courses } from '@/lib/prototype/mock-data';
import type { Lesson } from '@/lib/prototype/types';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const lessonTypeIcons: Record<string, React.ReactNode> = {
  video: <Video className="size-3.5" />,
  text: <FileText className="size-3.5" />,
  quiz: <HelpCircle className="size-3.5" />,
  assignment: <PenTool className="size-3.5" />,
};

const resourceIcons: Record<string, React.ReactNode> = {
  pdf: <File className="size-4 text-red-500" />,
  zip: <Archive className="size-4 text-amber-500" />,
  doc: <FileText className="size-4 text-blue-500" />,
  link: <ExternalLink className="size-4 text-teal-500" />,
};

// Mock Q&A data
const mockQA = [
  {
    id: 'qa-1',
    question: 'How does streaming work with Server Components?',
    askedBy: 'Sarah O.',
    date: '2 days ago',
    replies: 3,
  },
  {
    id: 'qa-2',
    question: 'Can I use Server Actions with form validation?',
    askedBy: 'Emeka N.',
    date: '5 days ago',
    replies: 5,
  },
  {
    id: 'qa-3',
    question: 'What is the recommended project structure for large apps?',
    askedBy: 'Amina B.',
    date: '1 week ago',
    replies: 2,
  },
];

// Mock resources per lesson
const mockResources: Record<string, { name: string; type: 'pdf' | 'zip' | 'doc' | 'link'; size: string }[]> = {
  'les-1': [
    { name: 'Course Slides - Introduction.pdf', type: 'pdf', size: '2.4 MB' },
    { name: 'Source Code Starter Kit.zip', type: 'zip', size: '15.1 MB' },
    { name: 'Next.js 15 Documentation', type: 'link', size: 'External' },
  ],
  'les-6': [
    { name: 'RSC vs CSR Cheat Sheet.pdf', type: 'pdf', size: '1.1 MB' },
    { name: 'Data Fetching Patterns Guide.pdf', type: 'pdf', size: '3.2 MB' },
  ],
};

// Mock lesson content
const lessonDescriptions: Record<string, string> = {
  'les-1': 'In this lesson, we introduce Next.js 15 and explore its key features. We will cover the evolution of Next.js, what\'s new in version 15, and why it\'s the go-to framework for modern web development. By the end of this lesson, you\'ll have a solid understanding of the framework\'s philosophy and architecture.',
  'les-2': 'Setting up your development environment is the first step to becoming productive with Next.js. In this lesson, we install Node.js, set up VS Code with recommended extensions, create a new Next.js project, and explore the default project structure.',
  'les-3': 'The App Router is the modern routing system in Next.js. In this comprehensive lesson, we dive deep into how file-based routing works, nested layouts, loading states, error boundaries, and the mental model shift from Pages Router to App Router.',
  'les-4': 'A well-organized project structure is crucial for maintainability. This text lesson covers best practices for organizing your Next.js project including folder conventions, component colocation, and scaling patterns used in production applications.',
  'les-5': 'Test your understanding of Next.js fundamentals with this quiz. It covers concepts from the first four lessons including setup, routing, and project structure.',
  'les-6': 'Understanding the difference between Server and Client Components is fundamental to Next.js 15. In this lesson, we explore when to use each type, how data flows between them, and the performance implications of your choices.',
  'les-7': 'Data fetching in Next.js 15 has evolved significantly. We cover async/await in Server Components, the cache API, revalidation strategies, and how to build dynamic data flows.',
  'les-8': 'Streaming and Suspense enable progressive rendering. Learn how to stream HTML to the browser, create loading UI with Suspense boundaries, and optimize perceived performance.',
  'les-9': 'Server Actions simplify form handling and mutations. Learn how to define server actions, handle form submissions, work with progressive enhancement, and implement proper error handling.',
  'les-10': 'Put your knowledge into practice by building a full dashboard using React Server Components. This assignment combines data fetching, streaming, and server actions into a real-world project.',
};

export default function LearningPlayerPage() {
  const { navigate, viewParams } = useNav();
  const [curriculumOpen, setCurriculumOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['sec-1']));
  const [notes, setNotes] = useState('');
  const [question, setQuestion] = useState('');

  // Get course
  const courseId = viewParams.courseId || 'course-1';
  const course = courses.find((c) => c.id === courseId) || courses[0];

  // Get all lessons flat
  const allLessons = useMemo(() => {
    const lessons: (Lesson & { sectionTitle: string; sectionId: string })[] = [];
    course.sections.forEach((sec) => {
      sec.lessons.forEach((les) => {
        lessons.push({ ...les, sectionTitle: sec.title, sectionId: sec.id });
      });
    });
    return lessons;
  }, [course]);

  // Current lesson
  const lessonId = viewParams.lessonId || 'les-1';
  const currentIndex = allLessons.findIndex((l) => l.id === lessonId);
  const currentLesson = allLessons[currentIndex] || allLessons[0];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < allLessons.length - 1;

  // Calculate progress
  const completedCount = allLessons.filter((l) => l.isCompleted).length;
  const progressPercent = Math.round((completedCount / allLessons.length) * 100);

  const toggleSection = (secId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(secId)) {
        next.delete(secId);
      } else {
        next.add(secId);
      }
      return next;
    });
  };

  const selectLesson = (les: Lesson & { sectionId: string }) => {
    navigate('learning-player', { courseId: course.id, lessonId: les.id });
  };

  const goNext = () => {
    if (hasNext) {
      const next = allLessons[currentIndex + 1];
      navigate('learning-player', { courseId: course.id, lessonId: next.id });
    }
  };

  const goPrev = () => {
    if (hasPrev) {
      const prev = allLessons[currentIndex - 1];
      navigate('learning-player', { courseId: course.id, lessonId: prev.id });
    }
  };

  const currentResources = mockResources[currentLesson.id] || [];
  const currentDescription = lessonDescriptions[currentLesson.id] ||
    `This ${currentLesson.type} lesson covers ${currentLesson.title}. Follow along with the instructor to build practical skills and deepen your understanding of the topic.`;

  // Curriculum sidebar content (shared between desktop and mobile)
  const curriculumContent = (
    <div className="space-y-1">
      {/* Course header inside sidebar */}
      <div className="p-4 border-b">
        <h3 className="font-semibold text-sm line-clamp-2">{course.title}</h3>
        <div className="flex items-center gap-2 mt-2">
          <Progress value={progressPercent} className="h-1.5 flex-1" />
          <span className="text-xs font-medium text-muted-foreground shrink-0">
            {progressPercent}%
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          {completedCount} of {allLessons.length} lessons completed
        </p>
      </div>

      <ScrollArea className="h-[calc(100vh-260px)]">
        <div className="p-3 space-y-1">
          {course.sections.map((section) => {
            const isExpanded = expandedSections.has(section.id);
            const sectionCompleted = section.lessons.every((l) => l.isCompleted);
            const sectionLessons = section.lessons.length;
            const sectionDone = section.lessons.filter((l) => l.isCompleted).length;

            return (
              <div key={section.id}>
                <button
                  onClick={() => toggleSection(section.id)}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-muted transition-colors text-left"
                >
                  <ChevronDown
                    className={cn(
                      'size-3.5 text-muted-foreground shrink-0 transition-transform',
                      isExpanded ? 'rotate-0' : '-rotate-90'
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{section.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {sectionDone}/{sectionLessons} lessons
                    </p>
                  </div>
                  {sectionCompleted && (
                    <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                  )}
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="ml-3 pl-3 border-l space-y-0.5 py-1">
                        {section.lessons.map((lesson) => {
                          const isActive = lesson.id === currentLesson.id;
                          return (
                            <button
                              key={lesson.id}
                              onClick={() => {
                                selectLesson({ ...lesson, sectionTitle: section.title, sectionId: section.id });
                                setCurriculumOpen(false);
                              }}
                              className={cn(
                                'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all text-xs',
                                isActive
                                  ? 'bg-primary/10 text-primary font-medium'
                                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                                lesson.isCompleted && !isActive && 'text-emerald-600'
                              )}
                            >
                              {lesson.isCompleted ? (
                                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                              ) : (
                                <Circle className="size-3.5 shrink-0" />
                              )}
                              <span className="flex-1 truncate">{lesson.title}</span>
                              {lessonTypeIcons[lesson.type]}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Bar */}
      <header className="sticky top-0 z-40 bg-card border-b">
        <div className="flex items-center justify-between px-3 sm:px-4 h-14">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => navigate('student-dashboard')}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <div className="min-w-0 hidden sm:block">
              <p className="text-sm font-medium truncate">{course.title}</p>
              <p className="text-xs text-muted-foreground truncate">{currentLesson.title}</p>
            </div>
            <div className="min-w-0 sm:hidden">
              <p className="text-sm font-medium truncate">{currentLesson.title}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Mobile curriculum toggle */}
            <Button
              variant="outline"
              size="sm"
              className="lg:hidden gap-1.5"
              onClick={() => setCurriculumOpen(true)}
            >
              <List className="size-4" />
              <span className="hidden sm:inline">Curriculum</span>
            </Button>

            {/* Progress indicator */}
            <div className="hidden md:flex items-center gap-2 bg-muted rounded-full px-3 py-1.5">
              <Progress value={progressPercent} className="h-1.5 w-24" />
              <span className="text-xs font-medium">{progressPercent}%</span>
            </div>

            <Button variant="ghost" size="icon">
              <Settings className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex">
        {/* Left: Video + Tabs */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Video Placeholder */}
          <div className="relative w-full bg-neutral-900 aspect-video max-h-[60vh] flex items-center justify-center">
            <div className="absolute inset-0 bg-gradient-to-br from-teal-900/30 to-neutral-900" />
            <div className="relative z-10 flex flex-col items-center gap-3">
              <button className="size-16 sm:size-20 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-sm flex items-center justify-center transition-colors border border-white/20">
                <Play className="size-7 sm:size-8 text-white ml-1" />
              </button>
              <p className="text-white/60 text-sm hidden sm:block">
                {currentLesson.type === 'video' ? 'Click to play' : currentLesson.type === 'quiz' ? 'Start Quiz' : currentLesson.type === 'assignment' ? 'View Assignment' : 'Read Lesson'}
              </p>
            </div>
            {/* Duration badge */}
            <div className="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-2 py-1 rounded">
              {currentLesson.duration}
            </div>
            {/* Lesson type badge */}
            <div className="absolute top-3 left-3">
              <Badge
                variant="secondary"
                className="bg-black/50 text-white border-0 text-xs capitalize gap-1"
              >
                {lessonTypeIcons[currentLesson.type]}
                {currentLesson.type}
              </Badge>
            </div>
          </div>

          {/* Lesson Info */}
          <div className="p-4 sm:p-6 border-b">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-lg sm:text-xl font-bold">{currentLesson.title}</h1>
                <p className="text-sm text-muted-foreground mt-1">{currentLesson.sectionTitle}</p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                <Clock className="size-3.5" />
                {currentLesson.duration}
              </div>
            </div>
          </div>

          {/* Tabs: Overview, Resources, Notes, Q&A */}
          <Tabs defaultValue="overview" className="flex-1">
            <div className="px-4 sm:px-6 border-b">
              <TabsList className="h-auto p-0 bg-transparent gap-0">
                <TabsTrigger
                  value="overview"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 py-3 text-sm"
                >
                  Overview
                </TabsTrigger>
                <TabsTrigger
                  value="resources"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 py-3 text-sm"
                >
                  Resources
                  {currentResources.length > 0 && (
                    <Badge variant="secondary" className="ml-1.5 text-xs h-5 px-1.5">
                      {currentResources.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="notes"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 py-3 text-sm"
                >
                  Notes
                </TabsTrigger>
                <TabsTrigger
                  value="qa"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 py-3 text-sm"
                >
                  Q&A
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="p-4 sm:p-6">
              <motion.div
                key={currentLesson.id + '-overview'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="prose prose-sm max-w-none"
              >
                <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
                  {currentDescription}
                </p>
              </motion.div>
            </TabsContent>

            <TabsContent value="resources" className="p-4 sm:p-6">
              <motion.div
                key={currentLesson.id + '-resources'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
              >
                {currentResources.length === 0 ? (
                  <div className="text-center py-10">
                    <File className="size-8 text-muted-foreground/40 mx-auto" />
                    <p className="text-sm text-muted-foreground mt-2">No resources for this lesson</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {currentResources.map((res, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                      >
                        <div className="size-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          {resourceIcons[res.type]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{res.name}</p>
                          <p className="text-xs text-muted-foreground">{res.size}</p>
                        </div>
                        <Button variant="ghost" size="sm" className="shrink-0 gap-1.5 text-xs">
                          <Download className="size-3.5" />
                          Download
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            </TabsContent>

            <TabsContent value="notes" className="p-4 sm:p-6">
              <motion.div
                key={currentLesson.id + '-notes'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Take notes for this lesson. Notes are saved automatically.
                  </p>
                </div>
                <Textarea
                  placeholder="Type your notes here..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-[200px] resize-y"
                />
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <Download className="size-3.5" />
                    Export Notes
                  </Button>
                </div>
              </motion.div>
            </TabsContent>

            <TabsContent value="qa" className="p-4 sm:p-6">
              <motion.div
                key={currentLesson.id + '-qa'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                {/* Question input */}
                <div className="flex gap-2">
                  <Input
                    placeholder="Ask a question about this lesson..."
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    className="flex-1"
                  />
                  <Button size="icon" className="shrink-0">
                    <Send className="size-4" />
                  </Button>
                </div>

                <Separator />

                {/* Q&A List */}
                <div className="space-y-3">
                  {mockQA.map((qa) => (
                    <div
                      key={qa.id}
                      className="flex gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors"
                    >
                      <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <MessageSquare className="size-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{qa.question}</p>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                          <span>Asked by {qa.askedBy}</span>
                          <span>·</span>
                          <span>{qa.date}</span>
                          <span>·</span>
                          <span>{qa.replies} replies</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </TabsContent>
          </Tabs>

          {/* Bottom Navigation */}
          <div className="border-t bg-card p-3 sm:p-4 flex items-center justify-between">
            <Button
              variant="outline"
              onClick={goPrev}
              disabled={!hasPrev}
              className="gap-1.5"
            >
              <ChevronLeft className="size-4" />
              <span className="hidden sm:inline">Previous</span>
            </Button>

            <div className="text-xs text-muted-foreground text-center">
              <span className="font-medium text-foreground">
                {currentIndex + 1}
              </span>
              {' / '}
              {allLessons.length}
            </div>

            <Button
              onClick={goNext}
              disabled={!hasNext}
              className="gap-1.5"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        {/* Right: Curriculum Sidebar (Desktop) */}
        <aside className="hidden lg:flex flex-col w-80 xl:w-96 border-l bg-card shrink-0">
          {curriculumContent}
        </aside>
      </div>

      {/* Mobile Curriculum Drawer */}
      {curriculumOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setCurriculumOpen(false)}
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute right-0 top-0 bottom-0 w-80 sm:w-96 bg-card border-l shadow-xl flex flex-col"
          >
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold">Curriculum</h3>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => setCurriculumOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <ScrollArea className="flex-1">
              {curriculumContent}
            </ScrollArea>
          </motion.aside>
        </div>
      )}
    </div>
  );
}
