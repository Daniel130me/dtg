'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Code, BarChart3, Smartphone, Cloud, Palette, Trophy, Users, Zap, Award, BookOpen, TrendingUp, Shield, Star, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import CourseCard from '@/components/prototype/shared/CourseCard';
import { CourseCardSkeleton, FetchErrorState } from '@/components/prototype/shared/AsyncStates';
import { useNav } from '@/lib/prototype/navigation';
import { fetchCategories, fetchCourses } from '@/features/catalog/api';
import type { CategoryDto, PaginatedCoursesDto } from '@/contracts/catalog';

const FEATURED_COURSE_LIMIT = 6;

// Static marketing content. Hero stats and the instructor spotlight stay mock
// until the analytics and instructor-profile phases replace them.
const HERO_STUDENT_COUNT = 12847;

const spotlightInstructor = {
  name: 'Daniel T. George',
  title: 'Senior Full-Stack Developer & Educator',
  totalStudents: 12847,
  totalCourses: 12,
  rating: 4.8,
};

const testimonials = [
  {
    name: 'Sarah Okonkwo', role: 'Frontend Developer at TechHub',
    quote: 'DTG courses transformed my career. I went from a junior dev to a senior frontend developer in just 8 months. The practical projects were invaluable.',
  },
  {
    name: 'Emeka Nwankwo', role: 'Data Analyst at DataCorp',
    quote: "The Python for Data Science course gave me the skills I needed to land my dream job. Daniel's teaching style makes complex topics feel approachable.",
  },
  {
    name: 'Amina Bello', role: 'Freelance Mobile Developer',
    quote: "I've tried many online courses, but DTG stands out. The quality of content, the community support, and the real-world projects make all the difference.",
  },
];

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

  // Loading is DERIVED from comparing the request key against the last settled
  // key — the effects only touch state inside async callbacks, so a filter
  // change flips to loading without cascading synchronous setState calls.
  const [featured, setFeatured] = useState<PaginatedCoursesDto | null>(null);
  const [featuredError, setFeaturedError] = useState<string | null>(null);
  const [featuredLoadedKey, setFeaturedLoadedKey] = useState<string | null>(null);
  const [featuredRetrySeed, setFeaturedRetrySeed] = useState(0);
  const featuredKey = `featured#${featuredRetrySeed}`;
  const featuredLoading = featuredLoadedKey !== featuredKey;

  const [categories, setCategories] = useState<CategoryDto[] | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [categoriesLoadedKey, setCategoriesLoadedKey] = useState<string | null>(null);
  const [categoriesRetrySeed, setCategoriesRetrySeed] = useState(0);
  const categoriesKey = `categories#${categoriesRetrySeed}`;
  const categoriesLoading = categoriesLoadedKey !== categoriesKey;

  useEffect(() => {
    let cancelled = false;
    fetchCourses({ sort: 'POPULAR', limit: FEATURED_COURSE_LIMIT })
      .then((res) => {
        if (cancelled) return;
        setFeatured(res);
        setFeaturedError(null);
        setFeaturedLoadedKey(featuredKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFeaturedError(err instanceof Error ? err.message : 'Failed to load courses.');
        setFeaturedLoadedKey(featuredKey);
      });
    return () => {
      cancelled = true;
    };
  }, [featuredKey]);

  useEffect(() => {
    let cancelled = false;
    fetchCategories()
      .then((cats) => {
        if (cancelled) return;
        setCategories(cats);
        setCategoriesError(null);
        setCategoriesLoadedKey(categoriesKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCategoriesError(err instanceof Error ? err.message : 'Failed to load categories.');
        setCategoriesLoadedKey(categoriesKey);
      });
    return () => {
      cancelled = true;
    };
  }, [categoriesKey]);

  return (
    <main className='flex-1'>
      {/* Hero Section */}
      <section className='relative overflow-hidden'>
        <div className='absolute inset-0 bg-gradient-to-br from-[#0a1a3e] via-[#0f2847] to-[#162d50]' />
        <div className='absolute inset-0 opacity-10'>
          <div className='absolute top-20 left-10 size-72 rounded-full bg-[#3b82f6] blur-3xl' />
          <div className='absolute bottom-10 right-20 size-96 rounded-full bg-[#3b82f6] blur-3xl' />
          <div className='absolute top-40 right-1/3 size-64 rounded-full bg-[#60a5fa] blur-3xl' />
        </div>
        <div className='relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-36'>
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className='max-w-3xl'
          >
            <Badge className='bg-[#3b82f6]/20 text-[#93c5fd] border-[#3b82f6]/30 mb-6 text-sm px-3 py-1'>
              <Star className='size-3.5 mr-1.5 fill-[#60a5fa] text-[#60a5fa]' />
              Trusted by {HERO_STUDENT_COUNT.toLocaleString()}+ students
            </Badge>
            <h1 className='text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-bold text-white leading-tight mb-6'>
              Master In-Demand Skills{' '}
              <span className='text-transparent bg-clip-text bg-gradient-to-r from-[#93c5fd] to-[#67e8f9]'>with DTG</span>
            </h1>
            <p className='text-lg sm:text-xl text-[#bfdbfe]/80 leading-relaxed mb-8 max-w-2xl'>
              Build real-world projects, learn from industry experts, and accelerate your tech career with our comprehensive, hands-on courses.
            </p>
            <div className='flex flex-col sm:flex-row gap-3'>
              <Button size='lg' className='bg-white text-[#0a1a3e] hover:bg-white/90 font-semibold text-base px-8' onClick={() => navigate('courses')}>
                Browse Courses <ArrowRight className='ml-1.5 size-4' />
              </Button>
              <Button size='lg' variant='outline' className='border-[#3b82f6]/30 text-[#93c5fd] hover:bg-[#1e3a8a]/50 text-base px-8' onClick={() => navigate('about')}>
                Learn More
              </Button>
            </div>
          </motion.div>

          {/* Stats Bar — static until the analytics phase */}
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
                <div className='text-sm text-[#93c5fd]/70 mt-1'>{stat.label}</div>
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

          {featuredLoading ? (
            <motion.div
              initial='hidden'
              whileInView='visible'
              viewport={{ once: true, margin: '-50px' }}
              variants={staggerContainer}
              className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'
            >
              {Array.from({ length: FEATURED_COURSE_LIMIT }).map((_, i) => (
                <motion.div key={i} variants={fadeInUp}>
                  <CourseCardSkeleton />
                </motion.div>
              ))}
            </motion.div>
          ) : featuredError ? (
            <FetchErrorState
              title="Couldn't load featured courses"
              message={featuredError}
              onRetry={() => setFeaturedRetrySeed((s) => s + 1)}
            />
          ) : featured && featured.items.length > 0 ? (
            <motion.div
              initial='hidden'
              whileInView='visible'
              viewport={{ once: true, margin: '-50px' }}
              variants={staggerContainer}
              className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'
            >
              {featured.items.map((course) => (
                <motion.div key={course.id} variants={fadeInUp}>
                  <CourseCard course={course} />
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <p className='text-center text-muted-foreground py-8'>
              No courses have been published yet — check back soon.
            </p>
          )}

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

          {categoriesLoading ? (
            <motion.div
              initial='hidden'
              whileInView='visible'
              viewport={{ once: true, margin: '-50px' }}
              variants={staggerContainer}
              className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4'
            >
              {Array.from({ length: 5 }).map((_, i) => (
                <motion.div key={i} variants={fadeInUp}>
                  <Card className='p-6 text-center gap-3'>
                    <Skeleton className='mx-auto size-12 rounded-xl' />
                    <Skeleton className='mx-auto h-4 w-24' />
                    <Skeleton className='mx-auto h-3 w-16' />
                  </Card>
                </motion.div>
              ))}
            </motion.div>
          ) : categoriesError ? (
            <FetchErrorState
              title="Couldn't load categories"
              message={categoriesError}
              onRetry={() => setCategoriesRetrySeed((s) => s + 1)}
            />
          ) : (
            <motion.div
              initial='hidden'
              whileInView='visible'
              viewport={{ once: true, margin: '-50px' }}
              variants={staggerContainer}
              className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4'
            >
              {(categories ?? []).map((cat) => (
                <motion.div key={cat.id} variants={fadeInUp}>
                  <Link href={`/courses?category=${cat.slug}`} className='block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring'>
                    <Card className='cursor-pointer p-6 text-center gap-3 hover:shadow-md hover:border-primary/30 transition-all group'>
                      <div className='mx-auto size-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors'>
                        {categoryIconMap[cat.icon] || <BookOpen className='size-6' />}
                      </div>
                      <h3 className='font-semibold text-sm'>{cat.name}</h3>
                      <p className='text-xs text-muted-foreground'>{cat.courseCount} courses</p>
                    </Card>
                  </Link>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </section>

      {/* About Instructor — static spotlight until instructor profiles exist */}
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
                <div className='w-64 h-64 sm:w-80 sm:h-80 rounded-2xl bg-gradient-to-br from-[#1d4ed8] to-[#0a1a3e] flex items-center justify-center'>
                  <span className='text-6xl sm:text-7xl font-bold text-white/90'>DG</span>
                </div>
                <div className='absolute -bottom-4 -right-4 bg-card border rounded-xl p-4 shadow-lg'>
                  <div className='flex items-center gap-3'>
                    <div className='size-10 rounded-full bg-amber-100 flex items-center justify-center'>
                      <Trophy className='size-5 text-amber-600' />
                    </div>
                    <div>
                      <p className='text-sm font-bold'>{spotlightInstructor.totalStudents.toLocaleString()}+</p>
                      <p className='text-xs text-muted-foreground'>Students Taught</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <Badge variant='secondary' className='mb-3'>Meet Your Instructor</Badge>
              <h2 className='text-2xl sm:text-3xl font-bold mb-2'>{spotlightInstructor.name}</h2>
              <p className='text-primary font-medium text-sm mb-4'>{spotlightInstructor.title}</p>
              <p className='text-muted-foreground leading-relaxed mb-6'>
                With over 12 years of experience in software development and 8 years of teaching, Daniel has helped thousands of students master modern web technologies. His practical, project-based approach has earned him a reputation as one of the most effective tech educators.
              </p>
              <div className='flex flex-wrap gap-6 mb-8'>
                {[
                  { icon: <Users className='size-4' />, value: `${spotlightInstructor.totalStudents.toLocaleString()}+`, label: 'Students' },
                  { icon: <BookOpen className='size-4' />, value: `${spotlightInstructor.totalCourses}`, label: 'Courses' },
                  { icon: <Award className='size-4' />, value: spotlightInstructor.rating.toString(), label: 'Rating' },
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
      <section className='py-16 sm:py-20 bg-gradient-to-br from-[#0a1a3e] via-[#0f2847] to-[#162d50] relative overflow-hidden'>
        <div className='absolute inset-0 opacity-10'>
          <div className='absolute top-10 right-10 size-64 rounded-full bg-[#3b82f6] blur-3xl' />
          <div className='absolute bottom-10 left-20 size-80 rounded-full bg-[#3b82f6] blur-3xl' />
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
            <p className='text-[#bfdbfe]/80 text-lg mb-8 max-w-xl mx-auto'>
              Join thousands of students who are already building the future with DTG. Your next career move starts here.
            </p>
            <div className='flex flex-col sm:flex-row gap-3 justify-center'>
              <Button size='lg' className='bg-white text-[#0a1a3e] hover:bg-white/90 font-semibold text-base px-8' onClick={() => navigate('courses')}>
                Explore Courses <ArrowRight className='ml-1.5 size-4' />
              </Button>
              <Button size='lg' variant='outline' className='border-[#3b82f6]/30 text-[#93c5fd] hover:bg-[#1e3a8a]/50 text-base px-8' onClick={() => navigate('register')}>
                Create Free Account
              </Button>
            </div>
          </motion.div>
        </div>
      </section>
    </main>
  );
}
