'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Code, BarChart3, Smartphone, Cloud, Palette, Trophy, Users, Zap, Award, BookOpen, TrendingUp, Shield, Star, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import CourseCard from '@/components/prototype/shared/CourseCard';
import StarRating from '@/components/prototype/shared/StarRating';
import { useNav } from '@/lib/prototype/navigation';
import { courses, categories, instructor, testimonials, analyticsData } from '@/lib/prototype/mock-data';

const categoryIconMap: Record<string, React.ReactNode> = {
  'Code': <Code className='size-6' />,
  'BarChart3': <BarChart3 className='size-6' />,
  'Smartphone': <Smartphone className='size-6' />,
  'Cloud': <Cloud className='size-6' />,
  'Palette': <Palette className='size-6' />,
};

const benefits = [
  {
    icon: <BookOpen className='size-6' />,
    title: 'Project-Based Learning',
    description: 'Build real-world projects from day one. Every course includes hands-on projects that you can showcase in your portfolio.',
  },
  {
    icon: <Zap className='size-6' />,
    title: 'Up-to-Date Content',
    description: 'Courses are regularly updated with the latest technologies, frameworks, and industry best practices.',
  },
  {
    icon: <Shield className='size-6' />,
    title: 'Lifetime Access',
    description: 'Once you enroll, you get lifetime access to course materials, updates, and any new content added.',
  },
  {
    icon: <TrendingUp className='size-6' />,
    title: 'Career Growth',
    description: 'Our students go on to work at top companies worldwide. Join a community of ambitious learners.',
  },
];

const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

export default function HomePage() {
  const { navigate } = useNav();
  const featuredCourses = courses.filter(c => c.isPublished).slice(0, 4);

  return (
    <main className='flex-1'>
      {/* Hero Section */}
      <section className='relative overflow-hidden'>
        <div className='absolute inset-0 bg-gradient-to-br from-blue-950 via-blue-900 to-slate-950' />
        <div className='absolute inset-0 opacity-10'>
          <div className='absolute top-20 left-10 size-72 rounded-full bg-blue-400 blur-3xl' />
          <div className='absolute bottom-10 right-20 size-96 rounded-full bg-blue-400 blur-3xl' />
          <div className='absolute top-40 right-1/3 size-64 rounded-full bg-blue-300 blur-3xl' />
        </div>
        <div className='relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-36'>
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className='max-w-3xl'
          >
            <Badge className='bg-blue-500/20 text-blue-200 border-blue-500/30 mb-6 text-sm px-3 py-1'>
              <Star className='size-3.5 mr-1.5 fill-blue-300 text-blue-300' />
              Trusted by {analyticsData.totalStudents.toLocaleString()}+ students
            </Badge>
            <h1 className='text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-bold text-white leading-tight mb-6'>
              Master In-Demand Skills{' '}
              <span className='text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-cyan-300'>with DTG</span>
            </h1>
            <p className='text-lg sm:text-xl text-blue-100/80 leading-relaxed mb-8 max-w-2xl'>
              Build real-world projects, learn from industry experts, and accelerate your tech career with our comprehensive, hands-on courses.
            </p>
            <div className='flex flex-col sm:flex-row gap-3'>
              <Button size='lg' className='bg-white text-blue-900 hover:bg-white/90 font-semibold text-base px-8' onClick={() => navigate('courses')}>
                Browse Courses <ArrowRight className='ml-1.5 size-4' />
              </Button>
              <Button size='lg' variant='outline' className='border-blue-400/30 text-blue-200 hover:bg-blue-800/50 text-base px-8' onClick={() => navigate('about')}>
                Learn More
              </Button>
            </div>
          </motion.div>

          {/* Stats Bar */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className='mt-16 grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-2xl'
          >
            {[
              { value: '12,847+', label: 'Students' },
              { value: '12', label: 'Courses' },
              { value: '4.8', label: 'Avg. Rating' },
              { value: '67%', label: 'Completion Rate' },
            ].map((stat) => (
              <div key={stat.label} className='text-center'>
                <div className='text-2xl sm:text-3xl font-bold text-white'>{stat.value}</div>
                <div className='text-sm text-blue-300/70 mt-1'>{stat.label}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Featured Courses */}
      <section className='py-16 sm:py-20 lg:py-24'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
          <motion.div
            initial='hidden'
            whileInView='visible'
            viewport={{ once: true, margin: '-50px' }}
            variants={fadeInUp}
            className='text-center mb-12'
          >
            <Badge variant='secondary' className='mb-3'>Featured Courses</Badge>
            <h2 className='text-2xl sm:text-3xl font-bold mb-3'>Popular Among Learners</h2>
            <p className='text-muted-foreground max-w-xl mx-auto'>
              Our most popular courses, chosen by thousands of students to kickstart and advance their tech careers.
            </p>
          </motion.div>

          <motion.div
            initial='hidden'
            whileInView='visible'
            viewport={{ once: true, margin: '-50px' }}
            variants={staggerContainer}
            className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6'
          >
            {featuredCourses.map((course) => (
              <motion.div key={course.id} variants={fadeInUp}>
                <CourseCard course={course} onCourseClick={(id) => navigate('course-detail', { courseId: id })} />
              </motion.div>
            ))}
          </motion.div>

          <motion.div
            initial='hidden'
            whileInView='visible'
            viewport={{ once: true }}
            variants={fadeInUp}
            className='text-center mt-10'
          >
            <Button variant='outline' size='lg' onClick={() => navigate('courses')}>
              View All Courses <ArrowRight className='ml-1.5 size-4' />
            </Button>
          </motion.div>
        </div>
      </section>

      {/* Categories */}
      <section className='py-16 sm:py-20 bg-muted/30'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
          <motion.div
            initial='hidden'
            whileInView='visible'
            viewport={{ once: true, margin: '-50px' }}
            variants={fadeInUp}
            className='text-center mb-12'
          >
            <Badge variant='secondary' className='mb-3'>Categories</Badge>
            <h2 className='text-2xl sm:text-3xl font-bold mb-3'>Explore by Topic</h2>
            <p className='text-muted-foreground max-w-xl mx-auto'>
              Find the perfect course for your goals across our carefully curated categories.
            </p>
          </motion.div>

          <motion.div
            initial='hidden'
            whileInView='visible'
            viewport={{ once: true, margin: '-50px' }}
            variants={staggerContainer}
            className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4'
          >
            {categories.map((cat) => (
              <motion.div key={cat.id} variants={fadeInUp}>
                <Card
                  className='cursor-pointer p-6 text-center gap-3 hover:shadow-md hover:border-primary/30 transition-all group'
                  onClick={() => navigate('courses')}
                >
                  <div className='mx-auto size-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors'>
                    {categoryIconMap[cat.icon] || <BookOpen className='size-6' />}
                  </div>
                  <h3 className='font-semibold text-sm'>{cat.name}</h3>
                  <p className='text-xs text-muted-foreground'>{cat.courseCount} courses</p>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* About Instructor */}
      <section className='py-16 sm:py-20 lg:py-24'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
          <motion.div
            initial='hidden'
            whileInView='visible'
            viewport={{ once: true, margin: '-50px' }}
            variants={fadeInUp}
            className='grid lg:grid-cols-2 gap-12 items-center'
          >
            <div className='flex justify-center lg:justify-start'>
              <div className='relative'>
                <div className='w-64 h-64 sm:w-80 sm:h-80 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center'>
                  <span className='text-6xl sm:text-7xl font-bold text-white/90'>DG</span>
                </div>
                <div className='absolute -bottom-4 -right-4 bg-card border rounded-xl p-4 shadow-lg'>
                  <div className='flex items-center gap-3'>
                    <div className='size-10 rounded-full bg-amber-100 flex items-center justify-center'>
                      <Trophy className='size-5 text-amber-600' />
                    </div>
                    <div>
                      <p className='text-sm font-bold'>{instructor.totalStudents.toLocaleString()}+</p>
                      <p className='text-xs text-muted-foreground'>Students Taught</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <Badge variant='secondary' className='mb-3'>Meet Your Instructor</Badge>
              <h2 className='text-2xl sm:text-3xl font-bold mb-2'>{instructor.name}</h2>
              <p className='text-primary font-medium text-sm mb-4'>{instructor.title}</p>
              <p className='text-muted-foreground leading-relaxed mb-6'>
                With over 12 years of experience in software development and 8 years of teaching, Daniel has helped thousands of students master modern web technologies. His practical, project-based approach has earned him a reputation as one of the most effective tech educators.
              </p>
              <div className='flex flex-wrap gap-6 mb-8'>
                {[
                  { icon: <Users className='size-4' />, value: `${instructor.totalStudents.toLocaleString()}+`, label: 'Students' },
                  { icon: <BookOpen className='size-4' />, value: `${instructor.totalCourses}`, label: 'Courses' },
                  { icon: <Award className='size-4' />, value: instructor.rating.toString(), label: 'Rating' },
                ].map((s) => (
                  <div key={s.label} className='flex items-center gap-2'>
                    <div className='size-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary'>{s.icon}</div>
                    <div>
                      <p className='font-bold text-sm'>{s.value}</p>
                      <p className='text-xs text-muted-foreground'>{s.label}</p>
                    </div>
                  </div>
                ))}
              </div>
              <Button onClick={() => navigate('about')}>
                Learn More <ArrowRight className='ml-1.5 size-4' />
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Testimonials */}
      <section className='py-16 sm:py-20 bg-muted/30'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
          <motion.div
            initial='hidden'
            whileInView='visible'
            viewport={{ once: true, margin: '-50px' }}
            variants={fadeInUp}
            className='text-center mb-12'
          >
            <Badge variant='secondary' className='mb-3'>Testimonials</Badge>
            <h2 className='text-2xl sm:text-3xl font-bold mb-3'>What Our Students Say</h2>
            <p className='text-muted-foreground max-w-xl mx-auto'>
              Real stories from real students who transformed their careers with DTG.
            </p>
          </motion.div>

          <motion.div
            initial='hidden'
            whileInView='visible'
            viewport={{ once: true, margin: '-50px' }}
            variants={staggerContainer}
            className='grid grid-cols-1 md:grid-cols-3 gap-6'
          >
            {testimonials.map((t, i) => (
              <motion.div key={i} variants={fadeInUp}>
                <Card className='p-6 gap-4 h-full'>
                  <Quote className='size-8 text-primary/20 mb-2' />
                  <p className='text-sm text-muted-foreground leading-relaxed mb-4 flex-1'>{t.quote}</p>
                  <div className='flex items-center gap-3 pt-4 border-t'>
                    <div className='size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0'>
                      <span className='text-primary text-xs font-bold'>
                        {t.name.split(' ').map(n => n[0]).join('')}
                      </span>
                    </div>
                    <div className='min-w-0'>
                      <p className='text-sm font-semibold truncate'>{t.name}</p>
                      <p className='text-xs text-muted-foreground truncate'>{t.role}</p>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Benefits */}
      <section className='py-16 sm:py-20 lg:py-24'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
          <motion.div
            initial='hidden'
            whileInView='visible'
            viewport={{ once: true, margin: '-50px' }}
            variants={fadeInUp}
            className='text-center mb-12'
          >
            <Badge variant='secondary' className='mb-3'>Why DTG?</Badge>
            <h2 className='text-2xl sm:text-3xl font-bold mb-3'>The DTG Advantage</h2>
            <p className='text-muted-foreground max-w-xl mx-auto'>
              Everything you need to succeed in your learning journey, all in one place.
            </p>
          </motion.div>

          <motion.div
            initial='hidden'
            whileInView='visible'
            viewport={{ once: true, margin: '-50px' }}
            variants={staggerContainer}
            className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6'
          >
            {benefits.map((b, i) => (
              <motion.div key={i} variants={fadeInUp}>
                <Card className='p-6 gap-4 text-center h-full hover:shadow-md hover:border-primary/30 transition-all group'>
                  <div className='mx-auto size-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors'>
                    {b.icon}
                  </div>
                  <h3 className='font-semibold'>{b.title}</h3>
                  <p className='text-sm text-muted-foreground leading-relaxed'>{b.description}</p>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Final CTA */}
      <section className='py-16 sm:py-20 bg-gradient-to-br from-blue-950 via-blue-900 to-slate-950 relative overflow-hidden'>
        <div className='absolute inset-0 opacity-10'>
          <div className='absolute top-10 right-10 size-64 rounded-full bg-blue-400 blur-3xl' />
          <div className='absolute bottom-10 left-20 size-80 rounded-full bg-blue-400 blur-3xl' />
        </div>
        <div className='relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center'>
          <motion.div
            initial='hidden'
            whileInView='visible'
            viewport={{ once: true, margin: '-50px' }}
            variants={fadeInUp}
          >
            <h2 className='text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-4'>
              Ready to Start Your Learning Journey?
            </h2>
            <p className='text-blue-100/80 text-lg mb-8 max-w-xl mx-auto'>
              Join thousands of students who are already building the future with DTG. Your next career move starts here.
            </p>
            <div className='flex flex-col sm:flex-row gap-3 justify-center'>
              <Button size='lg' className='bg-white text-blue-900 hover:bg-white/90 font-semibold text-base px-8' onClick={() => navigate('courses')}>
                Explore Courses <ArrowRight className='ml-1.5 size-4' />
              </Button>
              <Button size='lg' variant='outline' className='border-blue-400/30 text-blue-200 hover:bg-blue-800/50 text-base px-8' onClick={() => navigate('register')}>
                Create Free Account
              </Button>
            </div>
          </motion.div>
        </div>
      </section>
    </main>
  );
}