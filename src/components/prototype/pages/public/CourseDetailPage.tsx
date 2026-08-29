'use client';

import React from 'react';
import { ArrowLeft, Clock, Users, Globe, PlayCircle, FileText, HelpCircle, ClipboardList, CheckCircle2, Eye, Star, Twitter, Linkedin, Youtube, Globe as GlobeIcon, BookOpen, BarChart3, Smartphone, Code, Cloud, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import StarRating from '@/components/prototype/shared/StarRating';
import { useNav } from '@/lib/prototype/navigation';
import { courses, reviews, enrolments } from '@/lib/prototype/mock-data';

type LessonType = 'video' | 'text' | 'quiz' | 'assignment';

const lessonIconMap: Record<LessonType, React.ReactNode> = {
  video: <PlayCircle className='size-4 text-primary' />,
  text: <FileText className='size-4 text-amber-600' />,
  quiz: <HelpCircle className='size-4 text-orange-500' />,
  assignment: <ClipboardList className='size-4 text-rose-500' />,
};

const categoryGradients: Record<string, string> = {
  'Web Development': 'from-[#1d4ed8] to-[#0a1a3e]',
  'Data Science': 'from-[#2563eb] to-[#0f2847]',
  'Mobile Development': 'from-[#3b82f6] to-[#1e3a8a]',
  'DevOps & Cloud': 'from-[#0f2847] to-[#0a1a3e]',
  'Design & UI/UX': 'from-[#4338ca] to-[#0a1a3e]',
};

const categoryIconMap: Record<string, React.ReactNode> = {
  'Code': <Code className='size-20 text-white/70' />,
  'BarChart3': <BarChart3 className='size-20 text-white/70' />,
  'Smartphone': <Smartphone className='size-20 text-white/70' />,
  'Cloud': <Cloud className='size-20 text-white/70' />,
  'Palette': <Palette className='size-20 text-white/70' />,
};

const categoryIconNameMap: Record<string, string> = {
  'Web Development': 'Code',
  'Data Science': 'BarChart3',
  'Mobile Development': 'Smartphone',
  'DevOps & Cloud': 'Cloud',
  'Design & UI/UX': 'Palette',
};

export default function CourseDetailPage() {
  const { navigate, isAuthenticated, viewParams } = useNav();
  const courseId = viewParams.courseId || 'course-1';
  const course = courses.find(c => c.id === courseId) || courses[0];
  const courseReviews = reviews.filter(r => r.courseId === course.id);
  const enrollment = enrolments.find(e => e.courseId === course.id);

  const gradient = categoryGradients[course.categoryName] || 'from-[#1d4ed8] to-[#0a1a3e]';
  const iconKey = categoryIconNameMap[course.categoryName] || 'Code';

  const handleEnrol = () => {
    if (!isAuthenticated) {
      navigate('login');
      return;
    }
    navigate('learning-player', { courseId: course.id, lessonId: 'les-6' });
  };

  const handleContinue = () => {
    navigate('learning-player', { courseId: course.id, lessonId: enrollment?.currentLessonId || 'les-1' });
  };

  return (
    <main className='flex-1'>
      {/* Back Button */}
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4'>
        <Button variant='ghost' size='sm' onClick={() => navigate('courses')} className='gap-1.5 text-muted-foreground hover:text-foreground'>
          <ArrowLeft className='size-4' /> Back to Courses
        </Button>
      </div>

      {/* Course Header */}
      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6'>
        <div className='grid lg:grid-cols-3 gap-8'>
          <div className='lg:col-span-2'>
            <div className='flex flex-wrap gap-2 mb-3'>
              <Badge>{course.level}</Badge>
              <Badge variant='secondary'>{course.categoryName}</Badge>
              {course.badge === 'popular' && <Badge className='bg-orange-500 text-white border-orange-500'>Popular</Badge>}
              {course.badge === 'new' && <Badge className='bg-amber-500 text-white border-amber-500'>New</Badge>}
            </div>
            <h1 className='text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 leading-tight'>{course.title}</h1>
            <p className='text-muted-foreground leading-relaxed mb-4'>{course.description}</p>
            <StarRating rating={course.rating} size='lg' showCount count={course.reviewCount} />
            <div className='flex items-center gap-2 mt-2 text-sm text-muted-foreground'>
              <span>Created by <button onClick={() => navigate('about')} className='text-primary font-medium hover:underline'>{course.instructor.name}</button></span>
            </div>
            <div className='flex flex-wrap items-center gap-4 mt-4 text-sm text-muted-foreground'>
              <span className='flex items-center gap-1.5'><Users className='size-4' /> {course.studentsEnrolled.toLocaleString()} students</span>
              <span className='flex items-center gap-1.5'><Clock className='size-4' /> {course.duration}</span>
              <span className='flex items-center gap-1.5'><Globe className='size-4' /> {course.language}</span>
              <span className='flex items-center gap-1.5'><BookOpen className='size-4' /> {course.totalLessons} lessons</span>
            </div>
          </div>

          {/* Sidebar Card */}
          <div>
            <Card className='sticky top-20 p-0 overflow-hidden gap-0'>
              <div className={`h-40 bg-gradient-to-br ${gradient} flex items-center justify-center relative`}>
                {categoryIconMap[iconKey] || <Code className='size-20 text-white/70' />}
              </div>
              <CardContent className='p-6'>
                <div className='text-3xl font-bold mb-1'>
                  {course.isFree ? (
                    <span className='text-[#1d4ed8]'>Free</span>
                  ) : (
                    <>${course.price}</>
                  )}
                </div>
                <p className='text-xs text-muted-foreground mb-5'>30-day money-back guarantee</p>

                {enrollment ? (
                  <Button className='w-full' size='lg' onClick={handleContinue}>
                    Continue Learning
                    {enrollment.progress > 0 && <span className='text-primary-foreground/70 ml-2 text-xs'>({enrollment.progress}%)</span>}
                  </Button>
                ) : (
                  <Button className='w-full' size='lg' onClick={handleEnrol}>
                    {isAuthenticated ? 'Enrol Now' : 'Login to Enrol'}
                  </Button>
                )}

                <p className='text-center text-xs text-muted-foreground mt-3'>Includes {course.totalSections} sections &middot; {course.totalLessons} lessons</p>

                <div className='mt-5 space-y-3 text-sm'>
                  <h3 className='font-semibold text-sm'>This course includes:</h3>
                  <ul className='space-y-2 text-muted-foreground'>
                    <li className='flex items-center gap-2'><PlayCircle className='size-4 text-primary shrink-0' /> {course.duration} of video content</li>
                    <li className='flex items-center gap-2'><FileText className='size-4 text-primary shrink-0' /> Downloadable resources</li>
                    <li className='flex items-center gap-2'><HelpCircle className='size-4 text-primary shrink-0' /> Quizzes & assignments</li>
                    <li className='flex items-center gap-2'><CheckCircle2 className='size-4 text-primary shrink-0' /> Certificate of completion</li>
                    <li className='flex items-center gap-2'><Globe className='size-4 text-primary shrink-0' /> Full lifetime access</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* What You'll Learn */}
      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'>
        <Card className='p-6'>
          <h2 className='text-lg font-bold mb-4'>What You'll Learn</h2>
          <div className='grid sm:grid-cols-2 gap-3'>
            {course.whatYouLearn.map((item, i) => (
              <div key={i} className='flex items-start gap-2.5'>
                <CheckCircle2 className='size-5 text-primary shrink-0 mt-0.5' />
                <span className='text-sm text-muted-foreground'>{item}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Curriculum */}
      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'>
        <div className='flex items-center justify-between mb-6'>
          <h2 className='text-lg font-bold'>Course Curriculum</h2>
          <span className='text-sm text-muted-foreground'>{course.sections.length} sections &middot; {course.totalLessons} lessons &middot; {course.duration} total</span>
        </div>
        <Accordion type='multiple' defaultValue={[course.sections[0]?.id]} className='w-full'>
          {course.sections.map((section) => (
              <AccordionItem key={section.id} value={section.id}>
                <AccordionTrigger className='hover:no-underline'>
                  <div className='flex items-center gap-3 text-left'>
                    <span className='text-sm font-semibold'>{section.title}</span>
                    <span className='text-xs text-muted-foreground'>{section.lessons.length} lessons</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className='space-y-1'>
                    {section.lessons.map((lesson) => (
                      <div
                        key={lesson.id}
                        className='flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors group cursor-pointer'
                        onClick={() => isAuthenticated && navigate('learning-player', { courseId: course.id, lessonId: lesson.id })}
                      >
                        <div className='flex items-center gap-3'>
                          {lesson.isCompleted ? (
                            <CheckCircle2 className='size-4 text-[#1d4ed8]' />
                          ) : (
                            lessonIconMap[lesson.type]
                          )}
                          <span className={`text-sm ${lesson.isCompleted ? 'text-muted-foreground line-through' : ''}`}>{lesson.title}</span>
                          {lesson.isPreview && (
                            <Badge variant='secondary' className='text-[10px] gap-1'>
                              <Eye className='size-3' /> Preview
                            </Badge>
                          )}
                        </div>
                        <span className='text-xs text-muted-foreground'>{lesson.duration}</span>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
        </Accordion>
      </section>

      {/* Instructor Card */}
      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'>
        <Card className='p-6'>
          <h2 className='text-lg font-bold mb-4'>Instructor</h2>
          <div className='flex flex-col sm:flex-row gap-5 items-start'>
            <div className='size-16 rounded-xl bg-gradient-to-br from-[#1d4ed8] to-[#0a1a3e] flex items-center justify-center shrink-0'>
              <span className='text-xl font-bold text-white'>DG</span>
            </div>
            <div className='flex-1'>
              <button onClick={() => navigate('about')} className='text-base font-bold hover:text-primary transition-colors'>{course.instructor.name}</button>
              <p className='text-sm text-primary mb-2'>{course.instructor.title}</p>
              <p className='text-sm text-muted-foreground leading-relaxed mb-3'>
                {course.instructor.bio.split('.')[0]}.
              </p>
              <div className='flex flex-wrap gap-4 text-sm mb-3'>
                <span className='flex items-center gap-1'><Star className='size-3.5 fill-amber-400 text-amber-400' /> <span className='font-medium'>{course.instructor.rating}</span> rating</span>
                <span className='flex items-center gap-1'><Users className='size-3.5' /> <span className='font-medium'>{course.instructor.totalStudents.toLocaleString()}</span> students</span>
                <span className='flex items-center gap-1'><BookOpen className='size-3.5' /> <span className='font-medium'>{course.instructor.totalCourses}</span> courses</span>
              </div>
              <div className='flex gap-2'>
                <Button variant='ghost' size='icon' className='size-8'><Twitter className='size-4' /></Button>
                <Button variant='ghost' size='icon' className='size-8'><Linkedin className='size-4' /></Button>
                <Button variant='ghost' size='icon' className='size-8'><Youtube className='size-4' /></Button>
                <Button variant='ghost' size='icon' className='size-8'><GlobeIcon className='size-4' /></Button>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* Reviews */}
      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-16'>
        <div className='flex items-center gap-4 mb-6'>
          <h2 className='text-lg font-bold'>Reviews</h2>
          <Badge variant='secondary'>{courseReviews.length} reviews</Badge>
        </div>

        {courseReviews.length > 0 ? (
          <div className='space-y-4'>
            {courseReviews.map((review) => (
              <Card key={review.id} className='p-6 gap-4'>
                <div className='flex items-start justify-between'>
                  <div className='flex items-center gap-3'>
                    <div className='size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0'>
                      <span className='text-primary text-xs font-bold'>{review.userName.split(' ').map(n => n[0]).join('')}</span>
                    </div>
                    <div>
                      <p className='text-sm font-semibold'>{review.userName}</p>
                      <p className='text-xs text-muted-foreground'>{new Date(review.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                    </div>
                  </div>
                  <StarRating rating={review.rating} size='sm' />
                </div>
                <p className='text-sm text-muted-foreground leading-relaxed'>{review.comment}</p>
                {review.instructorReply && (
                  <div className='ml-10 mt-2 p-3 bg-muted/50 rounded-lg border-l-2 border-primary'>
                    <p className='text-xs font-semibold text-primary mb-1'>Instructor Reply</p>
                    <p className='text-sm text-muted-foreground'>{review.instructorReply}</p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <Card className='p-8 text-center'>
            <p className='text-muted-foreground'>No reviews yet. Be the first to review this course!</p>
          </Card>
        )}
      </section>
    </main>
  );
}