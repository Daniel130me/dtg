'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Users, BookOpen, Star, Award, Calendar, Twitter, Linkedin, Youtube, Globe, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import StarRating from '@/components/prototype/shared/StarRating';
import { useNav } from '@/lib/prototype/navigation';
import { instructor, testimonials } from '@/lib/prototype/mock-data';

const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stats = [
  { icon: <Users className='size-5' />, value: instructor.totalStudents.toLocaleString() + '+', label: 'Students Taught', color: 'bg-blue-500/10 text-blue-600' },
  { icon: <BookOpen className='size-5' />, value: instructor.totalCourses.toString(), label: 'Courses Created', color: 'bg-blue-500/10 text-blue-600' },
  { icon: <Star className='size-5' />, value: instructor.rating.toString(), label: 'Average Rating', color: 'bg-amber-500/10 text-amber-600' },
  { icon: <Calendar className='size-5' />, value: '12+', label: 'Years Experience', color: 'bg-rose-500/10 text-rose-600' },
];

export default function AboutPage() {
  const { navigate } = useNav();

  return (
    <main className='flex-1'>
      {/* Hero Profile Section */}
      <section className='bg-gradient-to-br from-blue-950 via-blue-900 to-slate-950 relative overflow-hidden'>
        <div className='absolute inset-0 opacity-10'>
          <div className='absolute top-20 left-10 size-72 rounded-full bg-blue-400 blur-3xl' />
          <div className='absolute bottom-10 right-20 size-80 rounded-full bg-blue-400 blur-3xl' />
        </div>
        <div className='relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20'>
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className='flex flex-col lg:flex-row items-center lg:items-start gap-8 lg:gap-12'
          >
            {/* Avatar */}
            <div className='shrink-0'>
              <div className='w-40 h-40 sm:w-48 sm:h-48 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-2xl shadow-black/20'>
                <span className='text-5xl sm:text-6xl font-bold text-white/90'>DG</span>
              </div>
            </div>
            {/* Info */}
            <div className='text-center lg:text-left'>
              <Badge className='bg-blue-500/20 text-blue-200 border-blue-500/30 mb-4'>Lead Instructor</Badge>
              <h1 className='text-3xl sm:text-4xl font-bold text-white mb-2'>{instructor.name}</h1>
              <p className='text-blue-200 font-medium mb-4'>{instructor.title}</p>
              <StarRating rating={instructor.rating} size='md' />
              <p className='text-sm text-blue-200/60 mt-1 mb-6'>{instructor.rating} average rating from {instructor.totalStudents.toLocaleString()}+ students</p>
              <div className='flex flex-wrap gap-2 justify-center lg:justify-start'>
                {instructor.socialLinks.twitter && (
                  <Button variant='ghost' size='icon' className='size-9 bg-white/10 hover:bg-white/20 text-white border-white/10'>
                    <Twitter className='size-4' />
                  </Button>
                )}
                {instructor.socialLinks.linkedin && (
                  <Button variant='ghost' size='icon' className='size-9 bg-white/10 hover:bg-white/20 text-white border-white/10'>
                    <Linkedin className='size-4' />
                  </Button>
                )}
                {instructor.socialLinks.youtube && (
                  <Button variant='ghost' size='icon' className='size-9 bg-white/10 hover:bg-white/20 text-white border-white/10'>
                    <Youtube className='size-4' />
                  </Button>
                )}
                {instructor.socialLinks.website && (
                  <Button variant='ghost' size='icon' className='size-9 bg-white/10 hover:bg-white/20 text-white border-white/10'>
                    <Globe className='size-4' />
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stats */}
      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 relative z-10'>
        <motion.div
          initial='hidden'
          whileInView='visible'
          viewport={{ once: true, margin: '-50px' }}
          variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.1 } } }}
          className='grid grid-cols-2 lg:grid-cols-4 gap-4'
        >
          {stats.map((stat, i) => (
            <motion.div key={i} variants={fadeInUp}>
              <Card className='p-5 text-center gap-2'>
                <div className={`mx-auto size-12 rounded-xl ${stat.color} flex items-center justify-center mb-1`}>
                  {stat.icon}
                </div>
                <p className='text-2xl font-bold'>{stat.value}</p>
                <p className='text-xs text-muted-foreground'>{stat.label}</p>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Detailed Bio */}
      <section className='max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16'>
        <motion.div initial='hidden' whileInView='visible' viewport={{ once: true, margin: '-50px' }} variants={fadeInUp}>
          <h2 className='text-2xl font-bold mb-6'>About Daniel</h2>
          <div className='prose prose-sm max-w-none text-muted-foreground leading-relaxed space-y-4'>
            <p>{instructor.bio.split('. ').slice(0, 2).join('. ')}.</p>
            <p>{instructor.bio.split('. ').slice(2, 4).join('. ')}.</p>
            <p>{instructor.bio.split('. ').slice(4).join('. ')}</p>
          </div>
        </motion.div>
      </section>

      {/* Teaching Philosophy */}
      <section className='bg-muted/30 py-16'>
        <div className='max-w-4xl mx-auto px-4 sm:px-6 lg:px-8'>
          <motion.div initial='hidden' whileInView='visible' viewport={{ once: true, margin: '-50px' }} variants={fadeInUp}>
            <h2 className='text-2xl font-bold mb-6'>Teaching Philosophy</h2>
            <div className='space-y-6'>
              <Card className='p-6 gap-4'>
                <div className='flex items-start gap-4'>
                  <div className='size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0'>
                    <Award className='size-5' />
                  </div>
                  <div>
                    <h3 className='font-semibold mb-1'>Learn by Doing</h3>
                    <p className='text-sm text-muted-foreground leading-relaxed'>Every course is built around practical, real-world projects. Theory is important, but the real learning happens when you build things with your own hands.</p>
                  </div>
                </div>
              </Card>
              <Card className='p-6 gap-4'>
                <div className='flex items-start gap-4'>
                  <div className='size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0'>
                    <Users className='size-5' />
                  </div>
                  <div>
                    <h3 className='font-semibold mb-1'>Community-Driven</h3>
                    <p className='text-sm text-muted-foreground leading-relaxed'>Learning is better together. Every course includes a supportive community where students help each other grow and succeed.</p>
                  </div>
                </div>
              </Card>
              <Card className='p-6 gap-4'>
                <div className='flex items-start gap-4'>
                  <div className='size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0'>
                    <Star className='size-5' />
                  </div>
                  <div>
                    <h3 className='font-semibold mb-1'>Quality Over Quantity</h3>
                    <p className='text-sm text-muted-foreground leading-relaxed'>Every lesson is carefully crafted and regularly updated. We focus on delivering exceptional content rather than churning out courses.</p>
                  </div>
                </div>
              </Card>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Student Testimonials */}
      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16'>
        <motion.div
          initial='hidden'
          whileInView='visible'
          viewport={{ once: true, margin: '-50px' }}
          variants={fadeInUp}
          className='text-center mb-12'
        >
          <h2 className='text-2xl font-bold mb-3'>What Students Say</h2>
          <p className='text-muted-foreground'>Hear from our community of learners.</p>
        </motion.div>
        <motion.div
          initial='hidden'
          whileInView='visible'
          viewport={{ once: true, margin: '-50px' }}
          variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.1 } } }}
          className='grid md:grid-cols-3 gap-6'
        >
          {testimonials.map((t, i) => (
            <motion.div key={i} variants={fadeInUp}>
              <Card className='p-6 gap-4 h-full'>
                <Quote className='size-7 text-primary/20' />
                <p className='text-sm text-muted-foreground leading-relaxed flex-1'>{t.quote}</p>
                <Separator />
                <div className='flex items-center gap-3'>
                  <div className='size-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0'>
                    <span className='text-primary text-[10px] font-bold'>{t.name.split(' ').map(n => n[0]).join('')}</span>
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
      </section>

      {/* CTA */}
      <section className='bg-muted/30 py-16'>
        <div className='max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center'>
          <h2 className='text-2xl font-bold mb-3'>Ready to Learn with Daniel?</h2>
          <p className='text-muted-foreground mb-6'>Explore our course catalog and start building your skills today.</p>
          <Button size='lg' onClick={() => navigate('courses')}>
            Browse Courses
          </Button>
        </div>
      </section>
    </main>
  );
}